const userRepository = require('../repositories/user.repository');
const commandParser = require('../services/commandParser.service');
const transactionService = require('../services/transaction.service');
const symbolRegistry = require('../services/symbolRegistry.service');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');

const { COMMANDS } = commandParser;

// ฟีเจอร์ที่ยังไม่ Implement ใน Phase นี้ (พอต/กำไร/ประวัติ)
const COMING_SOON_MESSAGE = {
  type: 'text',
  text: 'ฟีเจอร์นี้กำลังพัฒนาอยู่ 🚧 เร็วๆ นี้',
};

// DATABASE.md — users.display_name เป็น NOT NULL ใช้ชื่อชั่วคราวนี้แทน
// จนกว่าจะดึง displayName จริงจาก LINE Profile API ได้ (pictureUrl nullable
// อยู่แล้ว จึงยังส่ง null ได้ตามปกติ)
const DEFAULT_DISPLAY_NAME = 'LINE User';

async function resolveUser(lineUserId) {
  const existing = await userRepository.findByLineUserId(lineUserId);
  if (existing) return existing;

  // Auto-register ตาม SRS.md § 2.3 [1] — ยังไม่ดึง displayName/pictureUrl
  // จาก LINE Profile API ในขั้นนี้
  return userRepository.create(lineUserId, DEFAULT_DISPLAY_NAME, null);
}

async function routeCommand(user, parsed) {
  switch (parsed.command) {
    case COMMANDS.BUY: {
      // Command Parser ไม่ Parse type ออกมา แต่ transaction.service ต้องใช้ type
      // ตอนสร้าง Asset ใหม่ — เติมจาก Symbol Registry ให้ก่อน ถ้ารู้จัก Symbol นั้น
      // ถ้าไม่รู้จัก (lookupType คืน null) ปล่อยให้ service throw VALIDATION_ERROR
      // ตามเดิม ไม่เดา type มั่ว
      if (!parsed.params.type) {
        const type = symbolRegistry.lookupType(parsed.params.symbol);
        if (type) parsed.params.type = type;
      }

      const result = await transactionService.processBuyCommand(user.id, parsed.params, {
        plan: user.plan,
      });
      return flexMessage.buildBuyConfirmMessage(result);
    }

    case COMMANDS.SELL: {
      const result = await transactionService.processSellCommand(user.id, parsed.params);
      return flexMessage.buildSellConfirmMessage(result);
    }

    case COMMANDS.PORTFOLIO:
    case COMMANDS.PROFIT:
    case COMMANDS.HISTORY:
      return COMING_SOON_MESSAGE;

    case COMMANDS.UNKNOWN:
    default:
      return flexMessage.buildUnknownCommandMessage();
  }
}

// ประมวลผล 1 Event จาก LINE — ต้องไม่ throw ออกไป เพื่อไม่ให้ Event อื่น
// หรือ Webhook Handler ทั้งตัวพังตาม (SRS.md § 6.4)
async function handleEvent(event) {
  // รองรับเฉพาะ Text Message — Event อื่น (follow/unfollow/image) ข้ามไปก่อน
  if (event.type !== 'message' || event.message?.type !== 'text') {
    return;
  }

  const { replyToken } = event;

  try {
    const user = await resolveUser(event.source?.userId);
    const parsed = commandParser.parseCommand(event.message.text);
    const message = await routeCommand(user, parsed);
    await lineService.replyMessage(replyToken, message);
  } catch (err) {
    // Error ที่มี code (เช่น TransactionServiceError) → แปลเป็นข้อความไทย
    // Error อื่นที่ไม่คาดคิด → INTERNAL_ERROR (ไม่โชว์รายละเอียดดิบให้ผู้ใช้)
    const code = err.code ?? 'INTERNAL_ERROR';
    console.error(`[webhook] handleEvent failed (code=${code}): ${err.message}`);
    await lineService.replyMessage(replyToken, flexMessage.buildErrorMessage(code));
  }
}

module.exports = {
  handleEvent,
};
