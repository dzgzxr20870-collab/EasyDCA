const userRepository = require('../repositories/user.repository');
const commandParser = require('../services/commandParser.service');
const portfolioService = require('../services/portfolio.service');
const historyService = require('../services/history.service');
const pendingService = require('../services/pendingTransaction.service');
const symbolRegistry = require('../services/symbolRegistry.service');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');

const { COMMANDS } = commandParser;

// ฟีเจอร์ที่ยังไม่ Implement ใน Phase นี้ (กำไร)
const COMING_SOON_MESSAGE = {
  type: 'text',
  text: 'ฟีเจอร์นี้กำลังพัฒนาอยู่ 🚧 เร็วๆ นี้',
};

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

    case COMMANDS.PROFIT:
      return COMING_SOON_MESSAGE;

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

    default:
      return flexMessage.buildUnknownCommandMessage();
  }
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
      ? await routeCommand(user, commandParser.parseCommand(event.message.text))
      : await routePostback(user, event.postback?.data);
    await lineService.replyMessage(replyToken, message);
  } catch (err) {
    await replyWithError(replyToken, err);
  }
}

module.exports = {
  handleEvent,
};
