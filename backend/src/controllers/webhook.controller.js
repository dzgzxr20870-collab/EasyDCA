const config = require('../config/env');
const userRepository = require('../repositories/user.repository');
const commandParser = require('../services/commandParser.service');
const portfolioService = require('../services/portfolio.service');
const profitService = require('../services/profit.service');
const historyService = require('../services/history.service');
const undoService = require('../services/undoTransaction.service');
const reminderService = require('../services/dcaReminder.service');
const reminderSetupFlow = require('../services/reminderSetupFlow.service');
const pendingService = require('../services/pendingTransaction.service');
const paymentService = require('../services/payment.service');
const entitlement = require('../services/entitlement.service');
const symbolRegistry = require('../services/symbolRegistry.service');
const mutualFundService = require('../services/mutualFund.service');
const assetRepository = require('../repositories/asset.repository');
const lineWebhookEventRepository = require('../repositories/lineWebhookEvent.repository');
const lineService = require('../services/line.service');
const storageService = require('../services/storage.service');
const bulkImportSession = require('../services/bulkImportSession.service');
const bulkImportService = require('../services/bulkImport.service');
const reportExportService = require('../services/reportExport.service');
const slipOcrService = require('../services/slipOcr.service');
const flexMessage = require('../utils/flexMessage.util');
const logger = require('../utils/logger.util');

const { COMMANDS } = commandParser;
const { STEPS } = reminderSetupFlow;

// แปลง Text ที่ผู้ใช้พิมพ์ (จำนวนเงิน/วันที่) เป็นตัวเลข — รองรับเลขไทย + Comma
// ผ่าน commandParser.normalizeText แล้วดึงเฉพาะตัวเลขตัวแรก (เผื่อพิมพ์ "1000 บาท")
// คืน NaN ถ้าไม่มีตัวเลข ให้ Service ปลายทาง (handleAmountEntered/handleDaySelected)
// เป็นผู้ตัดสิน INVALID_AMOUNT/INVALID_DAY เอง
function parseNumericText(text) {
  const normalized = commandParser.normalizeText(text).replace(/,/g, '');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

// DATABASE.md — users.display_name เป็น NOT NULL ใช้ชื่อชั่วคราวนี้เป็น
// Fallback เมื่อดึง LINE Profile API ไม่สำเร็จ (pictureUrl nullable อยู่แล้ว
// จึงยังส่ง null ได้ตามปกติ)
const DEFAULT_DISPLAY_NAME = 'LINE User';

async function resolveUser(lineUserId) {
  const existing = await userRepository.findByLineUserId(lineUserId);
  if (existing) {
    // แก้บั๊กชื่อ Fallback ค้างถาวร: ถ้าตอนสมัครครั้งแรก getProfile ล้มเหลวชั่วคราว
    // จนได้ชื่อ Default ไป แต่รอบนี้ดึง Profile จริงได้แล้ว ให้ Sync ชื่อทันที —
    // getProfile ห้าม throw (คืน null ถ้า API ล้มเหลว) จึงต้องเช็ค profile ก่อน
    // เข้าถึง .displayName เสมอ (ต่างจาก auth.controller ที่ profile ไม่มีทาง null)
    // ถ้ารอบนี้ก็ดึงไม่ได้อีก (profile เป็น null) หรือ User มีชื่อจริงอยู่แล้ว
    // (ไม่ใช่ Fallback) → ไม่แตะ คืน existing เดิม
    if (existing.displayName === DEFAULT_DISPLAY_NAME) {
      const profile = await lineService.getProfile(lineUserId);
      if (profile?.displayName) {
        return userRepository.updateDisplayName(
          existing.id,
          profile.displayName,
          profile.pictureUrl ?? existing.pictureUrl
        );
      }
    }
    return existing;
  }

  // Auto-register ตาม SRS.md § 2.3 [1] — พยายามดึง Profile จริงจาก LINE ก่อน
  // แต่ getProfile ห้าม throw (คืน null แทนถ้า API ล้มเหลว) เพื่อไม่ให้
  // การสมัครทั้งกระบวนการพังตาม จึง Fallback เป็นค่า Default ได้เสมอ
  const profile = await lineService.getProfile(lineUserId);
  const displayName = profile?.displayName ?? DEFAULT_DISPLAY_NAME;
  const pictureUrl = profile?.pictureUrl ?? null;

  return userRepository.create(lineUserId, displayName, pictureUrl);
}

// ดึงพารามิเตอร์ซื้อจาก params (จำนวนเงิน หรือ จำนวน+ราคา) — ใช้พก/สร้าง Pending
// ของกองทุน (กองทุนไม่รองรับ priceCurrency USD — NAV เป็น THB อยู่แล้ว)
function extractBuyParams(params) {
  if (params.amountThb !== undefined && params.amountThb !== null) {
    return { amountThb: params.amountThb };
  }
  return { quantity: params.quantity, pricePerUnit: params.pricePerUnit };
}

// ถอดพารามิเตอร์ซื้อจาก Postback (amt / qty+price) ที่ Class Picker ส่งมา
function decodeBuyParamsFromPostback(qs) {
  const amt = qs.get('amt');
  if (amt !== null) return { amountThb: Number(amt) };
  return { quantity: Number(qs.get('qty')), pricePerUnit: Number(qs.get('price')) };
}

// สร้าง Pending Preview ของกองทุน (หลังได้ Class ครบแล้ว) — Reuse createPending เดิม
async function createFundPendingReply(user, { projId, fundClassName, symbol, name, buy }) {
  const parsed = {
    command: COMMANDS.BUY,
    params: { symbol, type: 'fund', projId, fundClassName, name, ...buy },
  };
  const pending = await pendingService.createPending(user.id, parsed, {
    plan: user.plan,
    planExpiresAt: user.planExpiresAt,
  });
  return flexMessage.buildPreviewMessage(pending);
}

// พยายามจัดการคำสั่งซื้อกองทุน (Round 7) — เรียกเฉพาะ BUY ที่ Symbol ไม่ใช่ประเภท
// Static (Crypto/หุ้น/ทอง) คืน:
//   - Flex Message (Class Picker) ถ้าต้องถามเลือก Class → Controller ตอบเลย
//   - null ถ้า "จัดการเสร็จในตัว params แล้ว" (เติม type/projId/class ให้ parsed) →
//     ให้ Flow createPending เดิมทำต่อ | หรือ "ไม่ใช่กองทุน/ค้นไม่ได้" → ปล่อยผ่าน
//     ให้ createPending throw VALIDATION_ERROR (ไม่รู้จักสินทรัพย์) ตามเดิม
async function tryResolveFundBuy(user, parsed) {
  const symbol = parsed.params.symbol;
  const portfolioId = parsed.params.portfolioId ?? null;

  // 1) ถือกองทุนนี้อยู่แล้ว → Reuse Class เดิม (ไม่ถามซ้ำ) เติม projId/class ให้ parsed
  const existing = await assetRepository.findByUserAndSymbol(user.id, symbol, portfolioId);
  if (existing) {
    if (existing.type === 'fund' && existing.projId && existing.fundClassName) {
      parsed.params.type = 'fund';
      parsed.params.projId = existing.projId;
      parsed.params.fundClassName = existing.fundClassName;
      parsed.params.name = existing.name;
    }
    // Asset เดิม (ชนิดใดก็ตาม) — ปล่อยให้ createPending ทำต่อ (มี Asset อยู่แล้ว)
    return null;
  }

  // 2) Symbol ใหม่ — ลองค้น SEC Master List (SEC ไม่ config/ล่ม → ปล่อยผ่านเงียบๆ
  //    ไม่ให้กระทบ Flow ซื้อสินทรัพย์อื่น — Fail Isolated)
  let result;
  try {
    result = await mutualFundService.resolveFundForBuy(symbol);
  } catch (err) {
    console.error(`[webhook] fund resolve failed for ${symbol}: ${err.code ?? err.message}`);
    return null;
  }

  if (result.status === 'not_found') return null; // ไม่ใช่กองทุน → generic unknown asset

  const buy = extractBuyParams(parsed.params);

  if (result.status === 'multiple') {
    // หลาย Class → ถามผู้ใช้ผ่าน Quick Reply (มีปุ่ม "ไม่แน่ใจ")
    return flexMessage.buildFundClassPickerMessage(result.project, buy);
  }

  // single → เติม params ให้ครบแล้วปล่อยให้ createPending สร้าง Preview เลย
  const fc = result.fundClass;
  parsed.params.type = 'fund';
  parsed.params.projId = fc.projId;
  parsed.params.fundClassName = fc.fundClassName;
  parsed.params.name = result.project.projNameTh || result.project.projAbbrName || symbol;
  return null;
}

async function routeCommand(user, parsed) {
  switch (parsed.command) {
    case COMMANDS.BUY:
    case COMMANDS.SELL: {
      // Command Parser ไม่ Parse type ออกมา แต่ transaction.service ต้องใช้ type
      // ตอนสร้าง Asset ใหม่ (เฉพาะ BUY) — เติมจาก Symbol Registry ให้ก่อน ถ้า
      // รู้จัก Symbol นั้น ถ้าไม่รู้จัก (lookupType คืน null) ปล่อยให้ service
      // throw VALIDATION_ERROR ตามเดิม ไม่เดา type มั่ว
      if (parsed.command === COMMANDS.BUY && !parsed.params.type) {
        const type = symbolRegistry.lookupType(parsed.params.symbol);
        if (type) parsed.params.type = type;
      }

      // กองทุนรวม (Round 7) — BUY Symbol ที่ยังไม่รู้ type (ไม่ใช่ Crypto/หุ้น/ทอง)
      // อาจเป็นกองทุน → Resolve จาก SEC ก่อน (อาจตอบ Class Picker กลับไปเลย)
      if (parsed.command === COMMANDS.BUY && !parsed.params.type) {
        const fundReply = await tryResolveFundBuy(user, parsed);
        if (fundReply) return fundReply;
      }

      // Round 10-B.1: Manual Quantity Fallback — ผู้ใช้ระบุจำนวนหุ้นเอง (quantity + ยอดรวม
      // โดยไม่มีราคาต่อหน่วย = ไม่ต้องพึ่ง Price Feed) แต่ Symbol ไม่อยู่ใน Registry (เช่นหุ้น
      // Small-cap อย่าง EOSE/OKLO) → สร้าง Asset ได้เลยโดยเดา type จากสกุลเงิน เพื่อไม่ให้
      // validateBuy โยน VALIDATION_ERROR (ไม่มี type ตอนสร้าง Asset ใหม่). Dynamic Symbol
      // Resolution (Round 10-C) จะมาแทนการ "เดา" นี้ด้วยการ Verify Symbol + ดึงราคาจริง
      // เงื่อนไขเจาะจง "มี amountThb และไม่มี pricePerUnit" เท่านั้น — คง Guard เดิมของรูปแบบ
      // "ราคา" (DETAILED: quantity + pricePerUnit) ที่ Symbol ไม่รู้จักต้องยังโยน VALIDATION_ERROR
      if (
        parsed.command === COMMANDS.BUY &&
        !parsed.params.type &&
        parsed.params.quantity !== undefined && parsed.params.quantity !== null &&
        parsed.params.amountThb !== undefined && parsed.params.amountThb !== null &&
        (parsed.params.pricePerUnit === undefined || parsed.params.pricePerUnit === null)
      ) {
        parsed.params.type = parsed.params.currency === 'USD' ? 'stock_us' : 'stock_th';
      }

      // Flow ใหม่ (SRS.md § 2.3 [4-5]): ไม่บันทึกทันที — Validate แล้วสร้าง
      // Pending รอ Confirm ส่ง Preview พร้อมปุ่มยืนยัน/แก้ไข/ยกเลิกกลับไป
      // ถ้า Validate ไม่ผ่าน (Limit/type/ยอดไม่พอ) createPending จะ throw
      // ให้ตัว catch ด้านล่างแปลเป็นข้อความไทย โดยไม่มี Pending ค้าง
      const pending = await pendingService.createPending(user.id, parsed, {
        plan: user.plan,
        planExpiresAt: user.planExpiresAt,
      });
      return flexMessage.buildPreviewMessage(pending);
    }

    case COMMANDS.PORTFOLIO: {
      const summary = await portfolioService.getPortfolioSummary(user.id);
      return flexMessage.buildPortfolioMessage(summary);
    }

    case COMMANDS.HISTORY: {
      const transactions = await historyService.getRecentHistory(user.id);
      return flexMessage.buildHistoryMessage(transactions);
    }

    case COMMANDS.PROFIT: {
      // Price Feed พร้อมแล้ว (รองรับเฉพาะ Crypto) — คำนวณกำไร/ขาดทุนจริง
      // ถ้าไม่มี Holding/ราคาหาไม่ได้ service จะ throw ให้ catch แปลเป็นข้อความไทย
      const profit = await profitService.getAssetProfit(user.id, parsed.params.symbol);
      return flexMessage.buildProfitMessage(profit);
    }

    case COMMANDS.UNDO_LAST: {
      // Command History (PRD.md) — ย้อนรายการที่ Commit แล้วด้วย Reversal
      // (DATABASE.md § 8) ถ้าไม่มีรายการ/ย้อนไปแล้ว/ยอดไม่พอ service จะ throw
      // ให้ catch แปลเป็นข้อความไทย
      const undo = await undoService.undoLastTransaction(user.id);
      return flexMessage.buildUndoMessage(undo);
    }

    case COMMANDS.SET_REMINDER: {
      // ตั้งเตือน DCA (Push อย่างเดียว — ไม่ซื้อ/บันทึกให้อัตโนมัติ) ถ้ารูปแบบ/ช่วง
      // วันไม่ถูกต้อง service จะ throw INVALID_REMINDER ให้ catch แปลเป็นข้อความไทย
      const reminder = await reminderService.createReminder(user.id, parsed.params);
      return flexMessage.buildReminderSetMessage(reminder);
    }

    case COMMANDS.LIST_REMINDERS: {
      const reminders = await reminderService.listReminders(user.id);
      return flexMessage.buildReminderListMessage(reminders);
    }

    case COMMANDS.DELETE_REMINDER: {
      // Soft-delete (active=false) — ถ้าไม่พบ Reminder Active service จะ throw
      // REMINDER_NOT_FOUND ให้ catch แปลเป็นข้อความไทย
      const deleted = await reminderService.deleteReminder(user.id, parsed.params.symbol);
      return flexMessage.buildReminderDeletedMessage(deleted.symbol);
    }

    // ── Bulk Import (Phase 3 Round 6) — ข้อความที่ 1 ของ Flow 2 ข้อความ ─────────
    // เริ่ม Session รอรับ Batch (ข้อความถัดไปของ User คนนี้) แล้วอธิบาย Format
    // + ตัวอย่างให้พิมพ์ต่อ (routeText เป็นผู้ดักข้อความที่ 2 ด้วย Session นี้)
    case COMMANDS.IMPORT_PORTFOLIO: {
      await bulkImportSession.startSession(user.id);
      return flexMessage.buildBulkImportInstructionsMessage();
    }

    // ── Export รายงาน (Phase 3 Round 8) — ข้อความที่ 1: เลือกช่วงเวลาจากคำสั่ง ───
    // Premium-only เช็ค isPremiumActive (Reuse entitlement.service) ก่อนถามรูปแบบไฟล์
    // ผ่านแล้ว → Quick Reply เลือก PDF/Excel (Postback พก range ไปสร้างไฟล์ต่อ)
    case COMMANDS.EXPORT_REPORT: {
      // Parse ช่วงเวลาไม่ผ่าน → บอกวิธีใช้ที่ถูกต้อง (ไม่ Error ดิบ — Design ข้อ 1)
      if (parsed.params.invalid) {
        return flexMessage.buildExportFormatHelpMessage();
      }
      if (!entitlement.isPremiumActive(user)) {
        return flexMessage.buildExportPremiumRequiredMessage();
      }
      // Resolve เพื่อได้ label ไทยแสดงยืนยันช่วง + Validate (custom from<=to) อีกชั้น
      const resolved = reportExportService.resolveRange(parsed.params);
      return flexMessage.buildExportFormatQuickReply(parsed.params, resolved.label);
    }

    case COMMANDS.UNKNOWN:
    default:
      return flexMessage.buildUnknownCommandMessage();
  }
}


// ประมวลผล Postback จากปุ่มในข้อความ Preview (ยืนยัน/แก้ไข/ยกเลิก)
// data รูปแบบ "action=<confirm|edit|cancel>&pendingId=<uuid>" (flexMessage.util)
async function routePostback(user, data) {
  const params = new URLSearchParams(data ?? '');
  const action = params.get('action');
  const pendingId = params.get('pendingId');

  switch (action) {
    case 'confirm': {
      const { commandType, result } = await pendingService.confirmPending(pendingId, {
        plan: user.plan,
        planExpiresAt: user.planExpiresAt,
      });
      // ⚠️ ถ้ามาถึงบรรทัดนี้ = Transaction จริงถูกบันทึกลง DB สำเร็จแล้ว
      // (pendingService.confirmPending คืน result ก็ต่อเมื่อ Commit สำเร็จ) —
      // กรณี attachTransaction พังทีหลัง Service จะ Swallow ไว้แล้ว (ดู Comment
      // ใน pendingTransaction.service) เราจึงตอบผู้ใช้ว่า "สำเร็จ" ได้เสมอ
      // และ "ห้าม Retry" เด็ดขาด เพราะ pending ถูก Claim ไปแล้ว การกดซ้ำจะได้
      // PENDING_ALREADY_RESOLVED (ไม่สร้าง Transaction ซ้ำ)
      return commandType === 'buy'
        ? flexMessage.buildBuyConfirmMessage(result)
        : flexMessage.buildSellConfirmMessage(result);
    }

    case 'cancel': {
      await pendingService.cancelPending(pendingId);
      return flexMessage.buildCancelledMessage();
    }

    case 'edit': {
      // Phase นี้ยังไม่มี Stateful Edit — ยกเลิกรายการเดิมแบบ Best-effort
      // (ถ้า resolve ไปแล้วก็ไม่เป็นไร) แล้วแนะนำให้พิมพ์คำสั่งใหม่
      try {
        await pendingService.cancelPending(pendingId);
      } catch (cancelErr) {
        console.error(`[webhook] edit: best-effort cancel failed: ${cancelErr.message}`);
      }
      return flexMessage.buildEditHintMessage();
    }

    // ── DCA Reminder Setup Flow (Quick Reply หลายขั้นตอน) ────────────────────
    // เริ่ม Flow จากปุ่ม Rich Menu "⏰ ตั้งเตือน DCA"
    case 'start_reminder_setup': {
      // พอร์ตว่าง → startFlow throw PORTFOLIO_EMPTY_FOR_REMINDER ให้ catch แปลไทย
      const { symbols } = await reminderSetupFlow.startFlow(user.id);
      return flexMessage.buildSymbolQuickReply(symbols);
    }

    case 'reminder_symbol': {
      // ถ้า Session หมดอายุ/ผิดขั้น service จะ throw SETUP_SESSION_NOT_FOUND/WRONG_STEP
      await reminderSetupFlow.handleSymbolSelected(user.id, params.get('symbol'));
      return flexMessage.buildFrequencyQuickReply();
    }

    case 'reminder_freq': {
      const frequency = params.get('frequency');
      await reminderSetupFlow.handleFrequencySelected(user.id, frequency);
      // รายสัปดาห์ → ถามวันในสัปดาห์; รายเดือน → ถามวันของเดือน
      return frequency === 'weekly'
        ? flexMessage.buildDayOfWeekQuickReply()
        : flexMessage.buildDayOfMonthQuickReply();
    }

    case 'reminder_day': {
      // ปุ่มส่ง dayOfWeek (รายสัปดาห์) หรือ dayOfMonth (รายเดือน) มาอย่างใดอย่างหนึ่ง
      // service ใช้ session.frequency เป็นตัวตัดสินว่าเก็บลง Field ไหน
      const dayOfWeek = params.get('dayOfWeek');
      const dayValue = dayOfWeek !== null ? Number(dayOfWeek) : Number(params.get('dayOfMonth'));
      const session = await reminderSetupFlow.handleDaySelected(user.id, dayValue);
      return flexMessage.buildAskAmountMessage(session.symbol);
    }

    case 'cancel_reminder_setup': {
      await reminderSetupFlow.cancelFlow(user.id);
      return flexMessage.buildReminderSetupCancelledMessage();
    }

    // ── Admin อนุมัติ/ปฏิเสธคำขอชำระเงิน (Payment Approval) ────────────────────
    // adminLineUserId = user.lineUserId (คนที่กดปุ่มจริง — resolveUser มาจาก
    // event.source.userId) ไม่ใช่เจ้าของ Payment | service ตรวจสิทธิ์ Admin เอง
    // NOT_AUTHORIZED/ALREADY_RESOLVED จะ throw ขึ้นไปให้ replyWithError แปลไทย
    case 'approve_payment': {
      const { payment, user: owner, newExpiry } = await paymentService.approvePayment(
        params.get('paymentId'),
        user.lineUserId
      );

      // Push แจ้งเจ้าของ Payment แบบ Best-effort — plan ถูกอัปเดตแล้ว (Source of
      // Truth คือ DB) ถ้า Push พังห้ามทำให้ Admin เห็น Error ว่าอนุมัติไม่สำเร็จ
      try {
        if (owner?.lineUserId) {
          await lineService.pushMessage(
            owner.lineUserId,
            flexMessage.buildPaymentApprovedMessage(payment, newExpiry)
          );
        }
      } catch (pushErr) {
        console.error(`[webhook] approve_payment: push to owner failed: ${pushErr.message}`);
      }

      return flexMessage.buildAdminApproveAckMessage(payment, newExpiry);
    }

    case 'reject_payment': {
      const { payment, user: owner } = await paymentService.rejectPayment(
        params.get('paymentId'),
        user.lineUserId
      );

      try {
        if (owner?.lineUserId) {
          await lineService.pushMessage(
            owner.lineUserId,
            flexMessage.buildPaymentRejectedMessage(payment)
          );
        }
      } catch (pushErr) {
        console.error(`[webhook] reject_payment: push to owner failed: ${pushErr.message}`);
      }

      return flexMessage.buildAdminRejectAckMessage(payment);
    }

    // ── ปุ่ม Premium (Rich Menu) — แตกเป็น 3 เคสตามสถานะผู้ใช้ ─────────────────
    // ลำดับความสำคัญ: มีคำขอ pending ค้าง (ต้องจ่ายให้จบก่อน) > เป็น Premium Active
    // > ยังไม่ Premium — จัดลำดับแบบนี้กันสร้างคำขอซ้อน และให้ผู้ใช้เห็น QR เดิม
    // ที่ค้างจ่ายอยู่เป็นอันดับแรก (ครอบคลุมทั้งเคสต่ออายุที่จ่ายไม่จบด้วย)
    case 'premium_menu': {
      const pending = await paymentService.findPendingByUserId(user.id);
      if (pending) {
        // เคส 3: มีคำขอ pending ค้าง → ส่ง QR ของคำขอเดิมซ้ำ (ไม่สร้างใหม่ซ้อน)
        return flexMessage.buildPaymentQrMessage(pending, paymentService.buildQrImageUrl(pending.id));
      }
      if (entitlement.isPremiumActive(user)) {
        // เคส 2: Premium Active → แสดงสถานะ + วันหมดอายุ (ไทย/พ.ศ.) + ปุ่มต่ออายุ
        return flexMessage.buildPremiumStatusMessage(user.planExpiresAt);
      }
      // เคส 1: ยังไม่ Premium + ไม่มีคำขอค้าง → เสนอแพ็กเกจรายเดือน/รายปี
      return flexMessage.buildPremiumOfferMessage();
    }

    // ── ผู้ใช้เลือกแพ็กเกจ → สร้างคำขอ + QR (paymentService จัดสรรเลขสตางค์เอง) ──
    // requestPayment ใช้ Stacking Logic ต่ออายุจากวันหมดอายุเดิมให้แล้วตอน Admin
    // อนุมัติ ไม่ต้องเขียน Logic ต่ออายุซ้ำที่นี่ | period มาจากปุ่มของเราเอง
    case 'request_payment': {
      const period = params.get('period');
      const result = await paymentService.requestPayment(user.id, period);
      // result = { paymentId, amountThb, qrPayload, expiresAt } — ประกอบ object
      // ให้ตรงกับที่ buildPaymentQrMessage ต้องใช้ (id/amountThb/billingPeriod/expiresAt)
      const payment = {
        id: result.paymentId,
        amountThb: result.amountThb,
        billingPeriod: period,
        expiresAt: result.expiresAt,
      };
      return flexMessage.buildPaymentQrMessage(payment, paymentService.buildQrImageUrl(result.paymentId));
    }

    // ── ผู้ใช้กด "แจ้งชำระแล้ว" → Validate คำขอ แล้ว Push แจ้ง Admin ทุกคน ────────
    // ตอบผู้ใช้ (reply) ว่ารอตรวจสอบ; Push หา Admin แบบ Best-effort (1 คนล้มไม่
    // กระทบคนอื่น/การตอบผู้ใช้) — Error (PAYMENT_NOT_FOUND/PAYMENT_NOT_PENDING)
    // ทะลุขึ้นไปให้ replyWithError แปลเป็นข้อความไทยตาม error code
    case 'notify_payment': {
      const payment = await paymentService.notifyPaymentSubmitted(
        params.get('paymentId'),
        user.id
      );

      const adminIds = config.payment.adminLineUserIds;
      if (adminIds.length === 0) {
        console.error('[webhook] notify_payment: no ADMIN_LINE_USER_IDS configured; nobody notified');
      } else {
        const adminMessage = flexMessage.buildAdminPaymentRequestMessage(
          payment,
          user.displayName,
          paymentService.buildQrImageUrl(payment.id)
        );
        await Promise.all(
          adminIds.map((adminId) =>
            lineService.pushMessage(adminId, adminMessage).catch((pushErr) => {
              console.error(`[webhook] notify_payment: push to admin ${adminId} failed: ${pushErr.message}`);
            })
          )
        );
      }

      return flexMessage.buildPaymentNotifySubmittedMessage();
    }

    // ── Bulk Import (Phase 3 Round 6) — ปุ่มยืนยัน/ยกเลิก Preview ทั้ง Batch ─────
    // batchId (ไม่ใช่ pendingId) — ผูก N แถว pending_transactions ที่มาจาก Batch
    // เดียวกัน (migration 008) ปุ่มเดียวจัดการทั้งก้อน — Error (BATCH_NOT_FOUND
    // ถ้า Batch ไม่พบเลย) ทะลุขึ้นไปให้ replyWithError แปลไทยตามปกติ
    case 'confirm_bulk_import': {
      const result = await bulkImportService.confirmBatch(params.get('batchId'), {
        plan: user.plan,
        planExpiresAt: user.planExpiresAt,
      });
      return flexMessage.buildBulkImportConfirmedMessage(result);
    }

    case 'cancel_bulk_import': {
      await bulkImportService.cancelBatch(params.get('batchId'));
      return flexMessage.buildCancelledMessage();
    }

    // ── กองทุนรวม (Round 7): ผู้ใช้เลือกชนิดหน่วยลงทุน (Class) จาก Quick Reply ────
    // fund_buy = เลือก Class เจาะจง | fund_buy_auto = "ไม่แน่ใจ" ให้ระบบเลือกตาม
    // Priority — ทั้งคู่ Re-derive รายละเอียดจาก Master List (Cache) แล้วสร้าง Preview
    // Error (SEC_NOT_CONFIGURED/MUTUAL_FUND_*/FUND_CLASS_NOT_FOUND) ทะลุขึ้นไปให้
    // replyWithError แปลไทย
    case 'fund_buy': {
      const fc = await mutualFundService.getFundClass(params.get('projId'), params.get('class'));
      return createFundPendingReply(user, {
        projId: fc.projId,
        fundClassName: fc.fundClassName,
        symbol: fc.projAbbrName || params.get('projId'),
        name: fc.projNameTh || fc.projAbbrName || fc.fundClassName,
        buy: decodeBuyParamsFromPostback(params),
      });
    }

    case 'fund_buy_auto': {
      const project = await mutualFundService.getProjectById(params.get('projId'));
      const fc = mutualFundService.autoSelectClass(project);
      return createFundPendingReply(user, {
        projId: project.projId,
        fundClassName: fc.fundClassName,
        symbol: project.projAbbrName || project.projId,
        name: project.projNameTh || project.projAbbrName || fc.fundClassName,
        buy: decodeBuyParamsFromPostback(params),
      });
    }

    // ── ปุ่ม Dashboard (Rich Menu) → ส่งลิงก์เปิด LIFF Dashboard ────────────────
    // ประกอบ URL จาก config.liff.id (ไม่ Hardcode) — Fallback ไป FRONTEND_URL
    // ถ้ายังไม่ได้ตั้ง LIFF_ID
    case 'open_dashboard': {
      const dashboardUrl = config.liff.id
        ? `https://liff.line.me/${config.liff.id}`
        : config.app.frontendUrl || '';
      return flexMessage.buildDashboardLinkMessage(dashboardUrl);
    }

    // ── ปุ่ม "เพิ่มรายการ" (Rich Menu) → สอนวิธีพิมพ์คำสั่งซื้อ/ขายตรงๆ ──────────
    // Postback (ไม่ใช่ message('ซื้อ')) กันข้อความเปล่าหลุดเข้า Command Parser
    // แล้วตก UNKNOWN โดยไม่ได้ตั้งใจ (ดู Comment ใน setupRichMenu.js)
    case 'add_guide': {
      return flexMessage.buildAddGuideMessage();
    }

    // ── Export รายงาน (Phase 3 Round 8) — ข้อความที่ 2: เลือกรูปแบบไฟล์แล้ว ──────
    // เช็ค Premium ซ้ำ (กันสถานะเปลี่ยนระหว่างกดปุ่ม) → Generate ไฟล์ (Reuse Logic
    // เดียวกับ LIFF) → อัปโหลด Storage Bucket 'reports' (Private) + Signed URL 15 นาที
    // → ตอบการ์ดปุ่มดาวน์โหลด
    case 'export_report': {
      if (!entitlement.isPremiumActive(user)) {
        return flexMessage.buildExportPremiumRequiredMessage();
      }

      const format = params.get('format');
      const rt = params.get('rt');
      const range =
        rt === 'custom'
          ? { range: 'custom', from: params.get('from'), to: params.get('to') }
          : { range: rt };

      // ห่อ Generate+Upload: Error ที่มี code เฉพาะอยู่แล้ว (ReportServiceError เช่น
      // EXPORT_INVALID_RANGE/EXPORT_INVALID_FORMAT) ปล่อยผ่านให้ replyWithError แปลตรงๆ
      // ส่วน Error ที่ไม่มี code (เช่น storageService.uploadReport ที่ throw Error ธรรมดา
      // — Bucket ไม่มี/Sign ล้มเหลว) แปลงเป็น EXPORT_GENERATION_FAILED เพื่อให้ผู้ใช้เห็น
      // ข้อความเฉพาะ "สร้างรายงานไม่สำเร็จ" แทน INTERNAL_ERROR ทั่วไป
      try {
        const { buffer } = await reportExportService.generatePortfolioReport(user.id, {
          format,
          range,
        });
        const resolved = reportExportService.resolveRange(range);
        const upload = await storageService.uploadReport(user.id, buffer, format);

        return flexMessage.buildReportReadyMessage({
          signedUrl: upload.signedUrl,
          format,
          rangeLabel: resolved.label,
          expiresMinutes: Math.round(upload.expiresInSeconds / 60),
        });
      } catch (err) {
        if (err.code) throw err; // ReportServiceError ที่มี code เฉพาะ → คงไว้
        throw Object.assign(new Error(`export report failed: ${err.message}`), {
          code: 'EXPORT_GENERATION_FAILED',
        });
      }
    }

    // ── AI Slip OCR (Round 9): ผู้ใช้กด "ยืนยันบันทึก" จากการ์ดที่ AI อ่านสลิป ────────
    // เช็ค Premium ซ้ำ (กันสถานะเปลี่ยนระหว่างกดปุ่ม) → ประกอบเป็นคำสั่ง BUY/SELL แล้ว
    // "Route ผ่าน routeCommand เดิม" (Reuse type resolution + fund + createPending +
    // validateBuy/validateSell ทั้งหมด) → เข้า Preview→Confirm ปกติเหมือนคำสั่งพิมพ์เอง
    // ทุกประการ ไม่ Skip Validation ใดๆ (ตาม Design ข้อ 6)
    case 'ocr_confirm': {
      if (!entitlement.isPremiumActive(user)) {
        return flexMessage.buildOcrPremiumRequiredMessage();
      }

      const side = params.get('side') === 'sell' ? 'sell' : 'buy';
      const command = side === 'sell' ? COMMANDS.SELL : COMMANDS.BUY;

      const commandParams = { symbol: String(params.get('sym') ?? '').toUpperCase() };
      const amt = params.get('amt');
      if (amt !== null) {
        commandParams.amountThb = Number(amt);
      } else {
        commandParams.quantity = Number(params.get('qty'));
        commandParams.pricePerUnit = Number(params.get('price'));
      }
      // Multi-Currency (Round 10) — สลิปสกุล USD: เก็บเป็น USD ตามจริง (Default THB)
      if (params.get('cur') === 'USD') commandParams.currency = 'USD';
      const dateIso = params.get('date');
      if (dateIso) commandParams.date = dateIso; // ISO 'YYYY-MM-DD' (createPending ใช้ตรงๆ)

      // Manual Quantity Fallback (Round 10-B) — สลิป Amount-only ของสินทรัพย์ที่ไม่ใช่
      // Crypto: ถ้ายืนยันตรงๆ แล้วระบบหาราคาตลาดไม่ได้ (ไม่มี Price Feed / SEC ไม่ config /
      // ราคาตลาดล่ม) ไม่โยน Error ทั่วไป (ที่บอกให้พิมพ์คำสั่งใหม่ทั้งหมด) แต่ชี้ทางให้ผู้ใช้
      // "กรอกจำนวนหุ้นเอง" แทน — ระบบจะคำนวณราคาต่อหน่วยจากยอดรวมให้ (Bypass Price Feed)
      const amountOnlyManual =
        amt !== null && symbolRegistry.lookupType(commandParams.symbol) !== 'crypto';
      try {
        return await routeCommand(user, { command, params: commandParams });
      } catch (err) {
        const MANUAL_FALLBACK_CODES = [
          'PRICE_FEED_NOT_IMPLEMENTED',
          'SEC_NOT_CONFIGURED',
          'MARKET_PRICE_UNAVAILABLE',
          'MUTUAL_FUND_NAV_UNAVAILABLE',
        ];
        if (amountOnlyManual && MANUAL_FALLBACK_CODES.includes(err.code)) {
          const curSuffix = commandParams.currency === 'USD' ? ' USD' : '';
          const prefill = `${side === 'sell' ? 'ขาย' : 'ซื้อ'} ${commandParams.symbol} <จำนวนหุ้น> หุ้น รวม ${amt}${curSuffix}`;
          return flexMessage.buildOcrManualQuantityMessage(prefill);
        }
        throw err;
      }
    }

    // ── AI Slip OCR (Round 9): ผู้ใช้กด "แก้ไข" → ตอบข้อความ Prefill ให้ Copy ไปแก้ ───
    // ประกอบรูปแบบคำสั่งซื้อ/ขายเดิม (Reuse Command Parser เดิม ไม่เขียนใหม่) ค่าที่ AI
    // อ่านไม่ได้ (qty/price ไม่มีใน Postback) แทนด้วย <...> ให้ผู้ใช้กรอกแล้วส่งกลับมา
    case 'ocr_edit': {
      const sideLabel = params.get('side') === 'sell' ? 'ขาย' : 'ซื้อ';
      const sym = String(params.get('sym') ?? '').toUpperCase();
      const amt = params.get('amt');
      // Multi-Currency (Round 10) — ต่อท้ายหน่วย USD ให้ Command Parser อ่านสกุลถูก
      // (THB ไม่ต้องต่อหน่วย — เป็น Default) เพื่อให้ Copy กลับมาส่งได้ตรงสกุลเดิม
      const curSuffix = params.get('cur') === 'USD' ? ' USD' : '';

      let prefill;
      if (amt !== null) {
        // Manual Quantity Fallback (Round 10-B) — Amount-only ของสินทรัพย์ที่ไม่ใช่ Crypto
        // (หุ้น ฯลฯ) มักไม่มี Price Feed อัตโนมัติ → Prefill รูปแบบ "จำนวน + ยอดรวม" ให้ผู้ใช้
        // เติมแค่จำนวนหุ้น ระบบคำนวณราคาต่อหน่วยเองจากยอดรวม (ตอบด้วยการ์ดแนะนำเฉพาะทาง)
        if (symbolRegistry.lookupType(sym) !== 'crypto') {
          prefill = `${sideLabel} ${sym} <จำนวนหุ้น> หุ้น รวม ${amt}${curSuffix}`;
          return flexMessage.buildOcrManualQuantityMessage(prefill);
        }
        prefill = `${sideLabel} ${sym} ${amt}${curSuffix}`;
      } else {
        const qty = params.get('qty') ?? '<จำนวน>';
        const price = params.get('price') ?? '<ราคา>';
        prefill = `${sideLabel} ${sym} ${qty} หุ้น ราคา ${price}${curSuffix}`;
      }

      return flexMessage.buildOcrEditPrefillMessage(prefill);
    }

    default:
      return flexMessage.buildUnknownCommandMessage();
  }
}

// ประมวลผล Text Message — ต้อง "เช็ค Setup Session ก่อน parseCommand เสมอ"
// (Requirement ข้อ 5) เพื่อไม่ให้ข้อความตัวเลขทั่วไปถูก Flow ตั้งเตือนดักจับผิดๆ
// หลักการ:
//  - คำสั่งที่ parseCommand จำได้ (เช่น "พอต") "ชนะเสมอ" — ทำงานตามปกติแม้มี Session
//    ค้างอยู่ และไม่ auto-cancel Session (Requirement ข้อ 3)
//  - เฉพาะ Text ที่ parseCommand ไม่รู้จัก + มี Session ค้างในขั้นที่รับ Text ได้
//    เท่านั้น ที่ถูกตีความเป็น Input ของ Flow (จำนวนเงิน / วันที่ของเดือนที่พิมพ์เอง)
async function routeText(user, text) {
  const session = await reminderSetupFlow.getCurrentSession(user.id);
  const parsed = commandParser.parseCommand(text);

  // คำสั่งปกติชนะเสมอ (ไม่ถูก Flow ดักจับ)
  if (parsed.command !== COMMANDS.UNKNOWN) {
    return routeCommand(user, parsed);
  }

  // Text ไม่ใช่คำสั่งที่รู้จัก + มี Session ค้าง → อาจเป็น Input ของ Flow
  if (session) {
    if (session.step === STEPS.AWAITING_AMOUNT) {
      const reminder = await reminderSetupFlow.handleAmountEntered(user.id, parseNumericText(text));
      return flexMessage.buildReminderSetMessage(reminder);
    }

    // รายเดือน: อนุญาตให้พิมพ์วันที่เอง (นอกเหนือปุ่มยอดนิยม)
    if (session.step === STEPS.AWAITING_DAY && session.frequency === 'monthly') {
      const updated = await reminderSetupFlow.handleDaySelected(user.id, parseNumericText(text));
      return flexMessage.buildAskAmountMessage(updated.symbol);
    }
  }

  // Bulk Import (Phase 3 Round 6) — ข้อความที่ 2 ของ Flow (Batch หลายบรรทัด)
  // ตรวจแยกจาก Reminder Session ข้างต้น (คนละตาราง คนละ Flow) — ถ้า Reminder
  // Session ข้างบน Match Step ได้แล้วจะ Return ไปก่อนถึงตรงนี้เสมอ
  const bulkSession = await bulkImportSession.getCurrentSession(user.id);
  if (bulkSession) {
    return handleBulkImportBatchText(user, text);
  }

  // ไม่เข้าเงื่อนไข Flow → ตอบข้อความ "ไม่เข้าใจคำสั่ง" ตามปกติ
  return flexMessage.buildUnknownCommandMessage();
}

// ประมวลผลข้อความที่ 2 ของ Flow นำเข้าพอร์ต (Batch หลายบรรทัด) — เรียก
// bulkImportService.previewBatch (Parse + Validate + Persist Pending Batch ในทีเดียว)
// ล้าง Session เฉพาะตอนสำเร็จเท่านั้น — Parse/Validate ไม่ผ่าน "ไม่ลบ" Session
// เพื่อให้ผู้ใช้ส่ง Batch แก้ไขใหม่ได้ทันทีโดยไม่ต้องพิมพ์ "นำเข้าพอร์ต" ซ้ำ
// (Pattern เดียวกับ reminderSetupFlow.handleAmountEntered ตอน INVALID_AMOUNT)
async function handleBulkImportBatchText(user, text) {
  const result = await bulkImportService.previewBatch(user.id, text, {
    plan: user.plan,
    planExpiresAt: user.planExpiresAt,
  });

  if (!result.ok) {
    if (result.empty) {
      return flexMessage.buildBulkImportEmptyMessage();
    }
    return flexMessage.buildBulkImportRejectedMessage(result.errors);
  }

  await bulkImportSession.clearSession(user.id);
  return flexMessage.buildBulkImportPreviewMessage(result);
}

// แปล Error เป็นข้อความไทยแล้วตอบกลับ (ใช้ร่วมกันทั้ง Text และ Postback)
// Error ที่มี code (TransactionServiceError/PendingTransactionError) → ข้อความ
// เฉพาะ; Error อื่นที่ไม่คาดคิด → INTERNAL_ERROR (ไม่โชว์รายละเอียดดิบให้ผู้ใช้)
//
// webhookEventId (Optional) — Correlation Key ของ Event ต้นตอ (S6 Part B) ใช้ตาม
// event.webhookEventId แทน HTTP Request ID เพราะ LINE อาจ Batch หลาย Event มาในคำขอ
// HTTP เดียว (ดู logger.util.js หัวไฟล์)
async function replyWithError(replyToken, err, webhookEventId) {
  const code = err.code ?? 'INTERNAL_ERROR';
  logger.error('handleEvent failed', { webhookEventId, code, error: err.message });
  await lineService.replyMessage(replyToken, flexMessage.buildErrorMessage(code));
}

// ประมวลผล Image Message — แยก 2 กรณีตามลำดับความสำคัญ:
//  1) มีคำขอชำระเงิน pending ค้าง → สลิปโอนเงิน Premium (Round 5) — ผูกรูปเข้าคำขอ
//  2) ไม่มีคำขอ pending → สลิปซื้อ/ขายสินทรัพย์ (Round 9 — AI OCR, Premium เท่านั้น)
//
// การจัดลำดับ "มี pending payment ก่อน" ทำให้ Flow Round 5 เดิมไม่ถูกกระทบ (ผู้ใช้ที่
// กำลังจ่ายเงินและส่งสลิปโอน ยังเข้าทางเดิมเสมอ) — เฉพาะกรณี "ไม่มีคำขอชำระเงินค้าง"
// เท่านั้นที่ตีความรูปเป็นสลิปสินทรัพย์
async function handleImage(event) {
  logger.info('processing image message', { webhookEventId: event.webhookEventId });

  const user = await resolveUser(event.source?.userId);

  const pending = await paymentService.findPendingByUserId(user.id);
  if (pending) {
    return handlePaymentSlipImage(event, pending);
  }

  return handleAssetSlipImage(event, user);
}

// ── (Round 5) สลิปโอนเงิน Premium — มีคำขอ pending ค้าง ────────────────────
// ⚠️ ตอบยืนยันเฉพาะเมื่อ "บันทึกสำเร็จ" เท่านั้น ถ้าขั้นใดล้มเหลว (LINE Content API/
// Storage ล่ม) จะ throw ขึ้นไปให้ handleEvent จับ Log ไว้เฉย ๆ โดยไม่แจ้งผู้ใช้ว่าพลาด
// (Admin แค่จะไม่เห็นรูปตอนอนุมัติ ซึ่งไม่ Block การอนุมัติได้ตามปกติ)
//
// ⚠️ Payment Beta — Duplicate Slip Detection (migration 015): คำนวณ slip_hash ก่อน
// อัปโหลดขึ้น Storage เสมอ แล้วเช็คว่าเคยถูกใช้กับคำขอที่อนุมัติแล้ว (confirmed) มาก่อน
// ไหม — ต่างจากความล้มเหลวทางเทคนิคด้านบน กรณีนี้ "ต้องตอบผู้ใช้" เพราะเป็นการกระทำที่
// ผู้ใช้ตั้งใจทำ (ส่งสลิปเดิมซ้ำ) ไม่ใช่ความผิดพลาดของระบบ — ถ้าซ้ำ ให้จบ Flow ทันที
// ไม่อัปโหลด/ไม่บันทึกอะไรเพิ่ม
async function handlePaymentSlipImage(event, pending) {
  const { buffer, contentType } = await lineService.getMessageContent(event.message.id);
  const slipHash = paymentService.hashSlipImage(buffer);

  try {
    await paymentService.assertSlipNotReused(slipHash);
  } catch (err) {
    if (err.code === 'SLIP_ALREADY_USED') {
      await lineService.replyMessage(event.replyToken, flexMessage.buildErrorMessage(err.code));
      return;
    }
    throw err;
  }

  const slipImageUrl = await storageService.uploadPaymentSlip(pending.id, buffer, contentType);
  await paymentService.attachSlipImage(pending.id, slipImageUrl, slipHash);

  await lineService.replyMessage(event.replyToken, flexMessage.buildSlipReceivedMessage());
}

// ── (Round 9) สลิปซื้อ/ขายสินทรัพย์ — AI OCR (Premium เท่านั้น) ──────────────
// ไม่ใช่ Premium → ตอบชวนอัพเกรดทันที (ไม่เรียก Claude — ประหยัดค่าใช้จ่าย)
// Premium → ดึงรูป → slipOcr.extractSlip (มี Rate Limit + Quota + เรียก Claude Vision)
//           → ตอบการ์ด Preview พร้อมปุ่มยืนยัน/แก้ไข
//
// ต่างจาก Payment Slip: กรณีนี้ "ตอบผู้ใช้เสมอ" (รวม Error) จึงห่อ try/catch เองในนี้
// แล้วแปลง code เป็นข้อความไทยเฉพาะผ่าน buildOcrErrorMessage (Quota เต็ม/ไม่ใช่สลิป/
// หลายรายการ/Rate Limit/ล้มเหลว) — replyMessage เองไม่ throw อยู่แล้ว
async function handleAssetSlipImage(event, user) {
  if (!entitlement.isPremiumActive(user)) {
    await lineService.replyMessage(event.replyToken, flexMessage.buildOcrPremiumRequiredMessage());
    return;
  }

  try {
    const { buffer, contentType } = await lineService.getMessageContent(event.message.id);
    const ocr = await slipOcrService.extractSlip(user.id, buffer, contentType);
    // Manual Quantity Fallback (Round 10-B) — เติมชนิดสินทรัพย์ให้ Preview ตัดสินใจว่าจะ
    // เสนอปุ่ม "กรอกจำนวนหุ้น" ไหม (Amount-only + ไม่ใช่ Crypto = ไม่มี Price Feed อัตโนมัติ)
    ocr.assetType = symbolRegistry.lookupType(ocr.symbol);
    await lineService.replyMessage(event.replyToken, flexMessage.buildOcrPreviewMessage(ocr));
  } catch (err) {
    // getMessageContent (ไม่มี code) → OCR_FAILED | SlipOcrError → code เฉพาะ
    console.error(`[webhook] asset slip OCR failed (code=${err.code ?? 'OCR_FAILED'}): ${err.message}`);
    await lineService.replyMessage(event.replyToken, flexMessage.buildOcrErrorMessage(err.code));
  }
}

// ประมวลผล 1 Event จาก LINE — ต้องไม่ throw ออกไป เพื่อไม่ให้ Event อื่น
// หรือ Webhook Handler ทั้งตัวพังตาม (SRS.md § 6.4)
async function handleEvent(event) {
  // ── กันประมวลผลซ้ำ (migration 013) ──────────────────────────────────────
  // LINE Retry ส่ง Event เดิมซ้ำถ้า Server ตอบ 200 ไม่ทัน (ดู webhook.routes.js)
  // Claim event_id แบบ Atomic ก่อน Logic ใดๆ ทั้งหมด — Claim ไม่ได้ (เคยประมวลผล
  // แล้ว) ให้ข้ามทันที ไม่ทำอะไรต่อ (ไม่ reply ซ้ำ ไม่สร้าง Transaction ซ้ำ)
  //
  // Guard ด้วย if แทนสมมติว่ามีเสมอ — Event ทดสอบจากปุ่ม "Verify" ใน LINE
  // Developers Console อาจไม่มี webhookEventId หรือใช้ค่า Synthetic จึงต้องไม่ให้
  // Field ที่หายไปทำให้ Handler พัง (Error Isolation เดียวกับส่วนอื่นของฟังก์ชันนี้)
  if (event.webhookEventId) {
    const claimed = await lineWebhookEventRepository.claimEvent(event.webhookEventId);
    if (!claimed) {
      logger.info('duplicate event skipped', { webhookEventId: event.webhookEventId });
      return;
    }
  }

  // รองรับ Text Message, Postback (ปุ่ม) และ Image Message (สลิปโอนเงิน)
  // Event อื่น (follow/unfollow/sticker ฯลฯ) ข้ามไปก่อน
  const isText = event.type === 'message' && event.message?.type === 'text';
  const isPostback = event.type === 'postback';
  const isImage = event.type === 'message' && event.message?.type === 'image';

  // Image แยกจาก Text/Postback: ห้าม reply ข้อความ Error หาผู้ใช้ (รูปอาจไม่เกี่ยวกับ
  // การชำระเงิน) — พลาดตรงไหนแค่ Log แล้วปล่อยผ่าน (Error Isolation เต็มรูปแบบ)
  if (isImage) {
    try {
      await handleImage(event);
    } catch (err) {
      logger.error('handleImage failed', {
        webhookEventId: event.webhookEventId,
        error: err.message,
      });
    }
    return;
  }

  if (!isText && !isPostback) {
    return;
  }

  const { replyToken } = event;

  try {
    const user = await resolveUser(event.source?.userId);
    const message = isText
      ? await routeText(user, event.message.text)
      : await routePostback(user, event.postback?.data);
    await lineService.replyMessage(replyToken, message);
  } catch (err) {
    await replyWithError(replyToken, err, event.webhookEventId);
  }
}

module.exports = {
  handleEvent,
};
