const sessionRepository = require('../repositories/guidedBuySession.repository');
const portfolioService = require('./portfolio.service');
const commandParser = require('./commandParser.service');
const reminderSetupFlow = require('./reminderSetupFlow.service');
const bulkImportSession = require('./bulkImportSession.service');

// ── State Machine ของ Flow บันทึก DCA แบบ Quick Reply หลายขั้นตอน (S8 R2 รอบ 2) ──
// AWAITING_SYMBOL → AWAITING_AMOUNT → (จบ: ส่งพารามิเตอร์ให้ Controller Route เข้า
// routeCommand(BUY) ของเดิม → pendingTransaction.createPending → การ์ด Preview)
//
// ⚠️ Service นี้ "ห้ามคำนวณเงิน/สร้าง Transaction เอง" เด็ดขาด — หน้าที่เดียวคือ
// รวบรวม Input ทีละขั้นแล้วคืนพารามิเตอร์ชุดเดียวกับที่ Expert Path (คำสั่งพิมพ์
// "ซื้อ BTC 1000") ส่งเข้า routeCommand ทุกประการ ปลายทางจึงเป็นโค้ดเส้นเดียวกัน
// 100% (Pattern เดียวกับ reminderSetupFlow ที่จบด้วย dcaReminderService.createReminder)
const STEPS = {
  AWAITING_SYMBOL: 'AWAITING_SYMBOL',
  AWAITING_AMOUNT: 'AWAITING_AMOUNT',
};

// TTL 5 นาที — ค่าเดียวกับ reminderSetupFlow.SETUP_SESSION_TTL_MINUTES และ
// bulkImportSession.BULK_IMPORT_SESSION_TTL_MINUTES (ตรวจจากโค้ดจริงแล้ว ไม่เดา)
// Sliding นับจาก updated_at (กิจกรรมล่าสุด) เพื่อให้ผู้ใช้มีเวลาแต่ละขั้น
const GUIDED_BUY_SESSION_TTL_MINUTES = 5;

// Error ที่มี code (Pattern เดียวกับ ReminderSetupError/TransactionServiceError —
// API.md § 5) เพื่อให้ Controller Map เป็นข้อความไทยได้ ไม่ปล่อย Error ดิบถึงผู้ใช้
class GuidedBuyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GuidedBuyError';
    this.code = code;
    this.details = details;
  }
}

// จำนวน Symbol สูงสุดที่แสดงเป็นปุ่มได้ — LINE จำกัด 13 items/ข้อความ และเราต้อง
// กันที่ไว้ให้ปุ่ม "พิมพ์ชื่อเอง" + "ยกเลิก" อีก 2 ปุ่มเสมอ
const MAX_SYMBOL_BUTTONS = 11;

// Symbol ที่ยาวเกินนี้ไม่ใช่ชื่อสินทรัพย์จริง (ชื่อย่อกองทุนไทยยาวสุดราว 15-18 ตัว
// เช่น SCBRMGOLDH) — กันผู้ใช้พิมพ์ประโยคทั้งประโยคเข้ามาเป็น Symbol
const MAX_SYMBOL_LENGTH = 20;

function ttlCutoffIso() {
  return new Date(Date.now() - GUIDED_BUY_SESSION_TTL_MINUTES * 60 * 1000).toISOString();
}

// คืน Session ปัจจุบันที่ "ยังไม่หมดอายุ" หรือ null (หมดอายุ/ไม่มี ให้ผลเหมือนกัน)
async function getCurrentSession(userId) {
  return sessionRepository.findValidByUser(userId, ttlCutoffIso());
}

// ดึง Session ที่ต้องมีอยู่จริง + อยู่ในขั้นที่คาดหวัง มิฉะนั้นโยน Error ที่เหมาะสม
//  - ไม่มี/หมดอายุ → GUIDED_BUY_SESSION_NOT_FOUND (โค้ดแยกจาก SETUP_SESSION_NOT_FOUND
//    ของ Flow ตั้งเตือน เพราะข้อความแนะนำปุ่มที่ให้กดเริ่มใหม่คนละปุ่มกัน)
//  - อยู่คนละขั้น (กดปุ่มเก่าซ้ำจากประวัติแชท) → WRONG_STEP (Reuse ข้อความกลางเดิม)
async function requireSessionAtStep(userId, expectedStep) {
  const session = await getCurrentSession(userId);

  if (!session) {
    throw new GuidedBuyError(
      'GUIDED_BUY_SESSION_NOT_FOUND',
      'No active guided buy session (missing or expired)',
      { userId }
    );
  }

  if (session.step !== expectedStep) {
    throw new GuidedBuyError(
      'WRONG_STEP',
      `Expected step ${expectedStep} but session is at ${session.step}`,
      { expected: expectedStep, actual: session.step }
    );
  }

  return session;
}

// ── Session Collision Guard (ตอน "เริ่ม" Flow ไม่ใช่แค่ตอน Route ข้อความ) ──────
// ตัดสินใจแล้วว่า "บล็อกไม่ให้เริ่ม" แทนการเขียนทับเงียบๆ:
// Flow ตั้งเตือน/นำเข้าพอร์ตเก็บ Input ที่ผู้ใช้กรอกมาแล้วบางส่วนไว้ใน Session ของมัน
// ถ้าปล่อยให้ Guided Buy เริ่มทับได้ ผู้ใช้จะเสีย Input เดิมไปโดยไม่มีใครบอก (เงียบ) —
// เป็นบั๊กประเภทเดียวกับปุ่มยกเลิกข้าม Flow ที่เจอใน S8 R2 รอบ 1
// Controller เป็นผู้ตอบข้อความพร้อมปุ่ม "ยกเลิกรายการเดิม แล้วเริ่มใหม่" ซึ่งจะเรียก
// startFlow({ force: true }) เพื่อล้าง Session เดิมให้อย่างชัดแจ้ง (ผู้ใช้เป็นคนสั่งเอง)
async function findBlockingSession(userId) {
  const reminder = await reminderSetupFlow.getCurrentSession(userId);
  if (reminder) return { kind: 'reminder_setup' };

  const bulk = await bulkImportSession.getCurrentSession(userId);
  if (bulk) return { kind: 'bulk_import' };

  return null;
}

// เริ่ม Flow ใหม่ — คืนรายการ Symbol ที่ User ถืออยู่จริงเพื่อสร้างปุ่ม Quick Reply
//
// ต่างจาก reminderSetupFlow.startFlow ตรงที่ "พอร์ตว่างก็เริ่มได้" (ไม่ throw
// PORTFOLIO_EMPTY) — คนที่ยังไม่มีสินทรัพย์เลยคือคนที่ต้องการ Flow นี้มากที่สุด
// (ซื้อครั้งแรก) เขาจะได้ปุ่ม "พิมพ์ชื่อเอง" เป็นทางเดียวแทน
async function startFlow(userId, { force = false } = {}) {
  if (force) {
    // ผู้ใช้สั่งล้างเองอย่างชัดแจ้ง — ยกเลิก Session ที่ค้างทั้ง 2 ชนิด (Idempotent
    // ทั้งคู่ ลบซ้ำไม่เป็นไร) แล้วค่อยเริ่ม Flow ใหม่
    await reminderSetupFlow.cancelFlow(userId);
    await bulkImportSession.clearSession(userId);
  } else {
    const blocking = await findBlockingSession(userId);
    if (blocking) {
      throw new GuidedBuyError(
        'GUIDED_BUY_SESSION_BUSY',
        `Another session (${blocking.kind}) is still active`,
        blocking
      );
    }
  }

  const summary = await portfolioService.getPortfolioSummary(userId);
  const symbols = (summary.holdings ?? []).map((h) => h.symbol).slice(0, MAX_SYMBOL_BUTTONS);

  // UPSERT — เขียนทับ Guided Buy Session ของตัวเองถ้ามี (เริ่มใหม่ทับได้เสมอ
  // เหมือน reminderSetupFlow.startFlow) การทับ "Session ของ Flow ตัวเอง" ไม่ใช่
  // การชนข้าม Flow จึงไม่ต้องเตือน
  await sessionRepository.upsert({
    userId,
    step: STEPS.AWAITING_SYMBOL,
    symbol: null,
  });

  return { symbols };
}

// ตรวจและ Normalize Symbol ที่มาจากปุ่ม/ข้อความ — คืนตัวพิมพ์ใหญ่ หรือโยน
// GUIDED_BUY_INVALID_SYMBOL ถ้าไม่ใช่รูปแบบชื่อย่อสินทรัพย์
//
// ใช้ commandParser.normalizeText ตัวเดียวกับ Expert Path (รองรับเลขไทย + ยุบช่องว่าง)
// เพื่อให้ "พิมพ์ btc" ผ่าน Guided Flow ได้ผลเท่ากับพิมพ์ "ซื้อ BTC 1000" เป๊ะ
function normalizeSymbol(rawSymbol) {
  const text = commandParser.normalizeText(rawSymbol);

  // ต้องเป็นคำเดียว ไม่ว่าง ไม่ใช่ตัวเลขล้วน (กฎเดียวกับ commandParser.isValidSymbol)
  // และไม่ยาวเกินชื่อย่อสินทรัพย์จริง
  if (
    !text ||
    /\s/.test(text) ||
    /^[\d,.]+$/.test(text) ||
    text.length > MAX_SYMBOL_LENGTH
  ) {
    throw new GuidedBuyError('GUIDED_BUY_INVALID_SYMBOL', 'Invalid asset symbol input', {
      rawSymbol,
    });
  }

  return text.toUpperCase();
}

// ขั้น 1 — ได้ Symbol แล้ว (จากปุ่มพอร์ตตัวเอง หรือจากข้อความที่ผู้ใช้พิมพ์เอง)
// Symbol ไม่ถูกต้อง → โยน Error โดย "ไม่อัปเดต Session" (ยังอยู่ขั้นเดิม พิมพ์ใหม่ได้
// ทันที — Pattern เดียวกับ reminderSetupFlow.handleDaySelected ตอน INVALID_DAY)
async function handleSymbolSelected(userId, rawSymbol) {
  await requireSessionAtStep(userId, STEPS.AWAITING_SYMBOL);

  const symbol = normalizeSymbol(rawSymbol);

  return sessionRepository.updateByUser(userId, {
    symbol,
    step: STEPS.AWAITING_AMOUNT,
  });
}

// ผู้ใช้กด "พิมพ์ชื่อเอง" — ไม่เดินขั้น (ยังรอ Symbol อยู่เหมือนเดิม) แค่ยืนยันว่า
// Session ยังอยู่จริงก่อนที่ Controller จะตอบข้อความชวนพิมพ์
async function requireAwaitingSymbol(userId) {
  return requireSessionAtStep(userId, STEPS.AWAITING_SYMBOL);
}

// ผู้ใช้กด "กำหนดเอง" ที่ขั้นจำนวนเงิน — เช่นเดียวกัน ไม่เดินขั้น
async function requireAwaitingAmount(userId) {
  return requireSessionAtStep(userId, STEPS.AWAITING_AMOUNT);
}

// ขั้น 2 (ขั้นสุดท้าย) — ได้จำนวนเงินแล้ว คืนพารามิเตอร์ให้ Controller Route ต่อ
//
// ⚠️ "ไม่ลบ Session ที่นี่" โดยเจตนา: การบันทึกจริงยังไม่เกิดขึ้น ณ จุดนี้ (routeCommand
// อาจ throw ASSET_LIMIT_REACHED / ราคาตลาดล่ม ฯลฯ) ถ้าลบทิ้งก่อน ผู้ใช้จะตกจาก Flow
// ทันทีและต้องเริ่มใหม่ทั้งหมด — Controller เป็นผู้ลบ Session หลัง routeCommand สำเร็จ
// (Pattern เดียวกับ reminderSetupFlow.handleAmountEntered ที่ลบหลัง createReminder ผ่าน)
async function handleAmountEntered(userId, amountThb) {
  const session = await requireSessionAtStep(userId, STEPS.AWAITING_AMOUNT);

  if (!Number.isFinite(amountThb) || amountThb <= 0) {
    throw new GuidedBuyError('INVALID_AMOUNT', 'amountThb must be a positive number', {
      amountThb,
    });
  }

  // Multi-Currency (Round 10) — รอบนี้ Guided Flow เป็น THB เสมอ (ตัด Scope โดยตั้งใจ
  // ดู Comment ที่ buildGuidedBuyAmountQuickReply) จึง "ไม่ใส่ Key currency" เลย
  // เพื่อให้ Shape params ตรงกับ Expert Path Path THB เดิมทุกประการ
  return { symbol: session.symbol, amountThb };
}

// ลบ Session ทิ้งกลางทาง (ผู้ใช้กดปุ่มยกเลิก / จบ Flow สำเร็จ) — Idempotent
async function cancelFlow(userId) {
  await sessionRepository.deleteByUser(userId);
}

// Retention สำหรับ Cron Purge — ค่าเดียวกับ reminderSetupFlow.PURGE_RETENTION_MINUTES
const PURGE_RETENTION_MINUTES = 60;

// ── สำหรับ Cron (guidedBuyCleanup.job.js) ─────────────────────────────────
async function purgeStaleSessions(retentionMinutes = PURGE_RETENTION_MINUTES) {
  const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000).toISOString();
  return sessionRepository.purgeStaleBefore(cutoff);
}

module.exports = {
  STEPS,
  GUIDED_BUY_SESSION_TTL_MINUTES,
  PURGE_RETENTION_MINUTES,
  MAX_SYMBOL_BUTTONS,
  GuidedBuyError,
  getCurrentSession,
  findBlockingSession,
  startFlow,
  handleSymbolSelected,
  requireAwaitingSymbol,
  requireAwaitingAmount,
  handleAmountEntered,
  cancelFlow,
  purgeStaleSessions,
};
