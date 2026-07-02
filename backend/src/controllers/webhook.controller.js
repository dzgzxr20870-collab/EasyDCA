const userRepository = require('../repositories/user.repository');
const commandParser = require('../services/commandParser.service');
const portfolioService = require('../services/portfolio.service');
const profitService = require('../services/profit.service');
const historyService = require('../services/history.service');
const undoService = require('../services/undoTransaction.service');
const reminderService = require('../services/dcaReminder.service');
const reminderSetupFlow = require('../services/reminderSetupFlow.service');
const pendingService = require('../services/pendingTransaction.service');
const symbolRegistry = require('../services/symbolRegistry.service');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');

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
  if (existing) return existing;

  // Auto-register ตาม SRS.md § 2.3 [1] — พยายามดึง Profile จริงจาก LINE ก่อน
  // แต่ getProfile ห้าม throw (คืน null แทนถ้า API ล้มเหลว) เพื่อไม่ให้
  // การสมัครทั้งกระบวนการพังตาม จึง Fallback เป็นค่า Default ได้เสมอ
  const profile = await lineService.getProfile(lineUserId);
  const displayName = profile?.displayName ?? DEFAULT_DISPLAY_NAME;
  const pictureUrl = profile?.pictureUrl ?? null;

  return userRepository.create(lineUserId, displayName, pictureUrl);
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

      // Flow ใหม่ (SRS.md § 2.3 [4-5]): ไม่บันทึกทันที — Validate แล้วสร้าง
      // Pending รอ Confirm ส่ง Preview พร้อมปุ่มยืนยัน/แก้ไข/ยกเลิกกลับไป
      // ถ้า Validate ไม่ผ่าน (Limit/type/ยอดไม่พอ) createPending จะ throw
      // ให้ตัว catch ด้านล่างแปลเป็นข้อความไทย โดยไม่มี Pending ค้าง
      const pending = await pendingService.createPending(user.id, parsed, { plan: user.plan });
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

  // ไม่เข้าเงื่อนไข Flow → ตอบข้อความ "ไม่เข้าใจคำสั่ง" ตามปกติ
  return flexMessage.buildUnknownCommandMessage();
}

// แปล Error เป็นข้อความไทยแล้วตอบกลับ (ใช้ร่วมกันทั้ง Text และ Postback)
// Error ที่มี code (TransactionServiceError/PendingTransactionError) → ข้อความ
// เฉพาะ; Error อื่นที่ไม่คาดคิด → INTERNAL_ERROR (ไม่โชว์รายละเอียดดิบให้ผู้ใช้)
async function replyWithError(replyToken, err) {
  const code = err.code ?? 'INTERNAL_ERROR';
  console.error(`[webhook] handleEvent failed (code=${code}): ${err.message}`);
  await lineService.replyMessage(replyToken, flexMessage.buildErrorMessage(code));
}

// ประมวลผล 1 Event จาก LINE — ต้องไม่ throw ออกไป เพื่อไม่ให้ Event อื่น
// หรือ Webhook Handler ทั้งตัวพังตาม (SRS.md § 6.4)
async function handleEvent(event) {
  // รองรับ Text Message และ Postback (ปุ่มยืนยัน/แก้ไข/ยกเลิก) — Event อื่น
  // (follow/unfollow/image) ข้ามไปก่อน
  const isText = event.type === 'message' && event.message?.type === 'text';
  const isPostback = event.type === 'postback';
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
    await replyWithError(replyToken, err);
  }
}

module.exports = {
  handleEvent,
};
