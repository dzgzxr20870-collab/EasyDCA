const sessionRepository = require('../repositories/reminderSetupSession.repository');
const portfolioService = require('./portfolio.service');
const dcaReminderService = require('./dcaReminder.service');

// ── State Machine ของ Flow ตั้งเตือน DCA แบบ Quick Reply หลายขั้นตอน ─────────
// AWAITING_SYMBOL → AWAITING_FREQUENCY → AWAITING_DAY → AWAITING_AMOUNT → (จบ)
// จบแล้วเรียก dcaReminderService.createReminder() ของเดิม (ห้ามเขียน Logic สร้าง
// Reminder ซ้ำใหม่) แล้วลบ Session ทิ้ง
const STEPS = {
  AWAITING_SYMBOL: 'AWAITING_SYMBOL',
  AWAITING_FREQUENCY: 'AWAITING_FREQUENCY',
  AWAITING_DAY: 'AWAITING_DAY',
  AWAITING_AMOUNT: 'AWAITING_AMOUNT',
};

// TTL 5 นาทีเหมือน pending_transactions — Sliding นับจาก updated_at (กิจกรรมล่าสุด)
// เพื่อให้ผู้ใช้มีเวลาแต่ละขั้น ถ้าเงียบเกิน 5 นาที Session ถือว่าหมดอายุ
const SETUP_SESSION_TTL_MINUTES = 5;

// Error ที่มี code (Pattern เดียวกับ TransactionServiceError/DcaReminderError —
// API.md § 5) เพื่อให้ Controller Map เป็นข้อความไทยได้ ไม่ปล่อย Error ดิบถึง Client
class ReminderSetupError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReminderSetupError';
    this.code = code;
    this.details = details;
  }
}

const VALID_FREQUENCIES = ['weekly', 'monthly'];

// cutoff ISO สำหรับกรอง Session ที่ยังไม่หมดอายุ (now - TTL)
function ttlCutoffIso() {
  return new Date(Date.now() - SETUP_SESSION_TTL_MINUTES * 60 * 1000).toISOString();
}

// คืน Session ปัจจุบันที่ "ยังไม่หมดอายุ" หรือ null (หมดอายุ/ไม่มี ให้ผลเหมือนกัน)
async function getCurrentSession(userId) {
  return sessionRepository.findValidByUser(userId, ttlCutoffIso());
}

// ดึง Session ที่ต้องมีอยู่จริง + อยู่ในขั้นที่คาดหวัง มิฉะนั้นโยน Error ที่เหมาะสม
//  - ไม่มี/หมดอายุ → SETUP_SESSION_NOT_FOUND (แนะนำให้กด "ตั้งเตือน DCA" ใหม่)
//  - อยู่คนละขั้น (กดปุ่มเก่า/ปุ่มขั้นก่อนหน้าซ้ำ) → WRONG_STEP
async function requireSessionAtStep(userId, expectedStep) {
  const session = await getCurrentSession(userId);

  if (!session) {
    throw new ReminderSetupError(
      'SETUP_SESSION_NOT_FOUND',
      'No active reminder setup session (missing or expired)',
      { userId }
    );
  }

  if (session.step !== expectedStep) {
    throw new ReminderSetupError(
      'WRONG_STEP',
      `Expected step ${expectedStep} but session is at ${session.step}`,
      { expected: expectedStep, actual: session.step }
    );
  }

  return session;
}

// เริ่ม Flow ใหม่ — เขียนทับ Session เก่าที่ค้างอยู่เสมอ (UPSERT) คืนรายการ Symbol
// ที่ User ถืออยู่จริงเพื่อสร้างปุ่ม Quick Reply ถ้าพอร์ตว่าง → PORTFOLIO_EMPTY_FOR_REMINDER
async function startFlow(userId) {
  const summary = await portfolioService.getPortfolioSummary(userId);

  if (summary.isEmpty) {
    throw new ReminderSetupError(
      'PORTFOLIO_EMPTY_FOR_REMINDER',
      'Cannot start reminder setup with an empty portfolio',
      { userId }
    );
  }

  const symbols = summary.holdings.map((h) => h.symbol);

  // UPSERT — เขียนทับของเก่าถ้ามี ไม่ throw (Requirement: เริ่มใหม่ทับได้เสมอ)
  await sessionRepository.upsert({
    userId,
    step: STEPS.AWAITING_SYMBOL,
    symbol: null,
    frequency: null,
    dayOfWeek: null,
    dayOfMonth: null,
  });

  return { symbols };
}

async function handleSymbolSelected(userId, symbol) {
  await requireSessionAtStep(userId, STEPS.AWAITING_SYMBOL);

  return sessionRepository.updateByUser(userId, {
    symbol,
    step: STEPS.AWAITING_FREQUENCY,
  });
}

async function handleFrequencySelected(userId, frequency) {
  await requireSessionAtStep(userId, STEPS.AWAITING_FREQUENCY);

  // frequency มาจากปุ่มของเราเอง (weekly/monthly) — Guard เชิงป้องกันไว้กัน Data เพี้ยน
  if (!VALID_FREQUENCIES.includes(frequency)) {
    throw new ReminderSetupError('WRONG_STEP', `Unexpected frequency value ${frequency}`, {
      frequency,
    });
  }

  return sessionRepository.updateByUser(userId, {
    frequency,
    step: STEPS.AWAITING_DAY,
  });
}

// dayValue เป็นตัวเลขเดียว — เก็บลง day_of_week หรือ day_of_month ตาม frequency
// ที่เลือกไว้ก่อนหน้า (session.frequency เป็น Source of Truth) ตรวจช่วงให้ตรงชนิด
// ถ้านอกช่วง → INVALID_DAY และ "ไม่อัปเดต Session" (ให้ผู้ใช้เลือก/พิมพ์ใหม่ได้)
async function handleDaySelected(userId, dayValue) {
  const session = await requireSessionAtStep(userId, STEPS.AWAITING_DAY);

  if (session.frequency === 'weekly') {
    if (!Number.isInteger(dayValue) || dayValue < 0 || dayValue > 6) {
      throw new ReminderSetupError('INVALID_DAY', 'dayOfWeek must be an integer 0-6', { dayValue });
    }
    return sessionRepository.updateByUser(userId, {
      day_of_week: dayValue,
      step: STEPS.AWAITING_AMOUNT,
    });
  }

  // monthly
  if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) {
    throw new ReminderSetupError('INVALID_DAY', 'dayOfMonth must be an integer 1-31', { dayValue });
  }
  return sessionRepository.updateByUser(userId, {
    day_of_month: dayValue,
    step: STEPS.AWAITING_AMOUNT,
  });
}

// ขั้นสุดท้าย — ตรวจจำนวนเงิน ถ้าไม่ผ่าน INVALID_AMOUNT และ "ไม่ลบ Session"
// (ให้พิมพ์ใหม่ได้ในขั้นเดิม) ถ้าผ่าน: เรียก createReminder() ของเดิมด้วยข้อมูลที่
// สะสมไว้ทั้งหมด แล้วลบ Session ทิ้ง (จบ Flow) คืน Reminder ที่สร้าง
async function handleAmountEntered(userId, amountThb) {
  const session = await requireSessionAtStep(userId, STEPS.AWAITING_AMOUNT);

  if (!Number.isFinite(amountThb) || amountThb <= 0) {
    throw new ReminderSetupError('INVALID_AMOUNT', 'amountThb must be a positive number', {
      amountThb,
    });
  }

  // ใช้ Service เดิมสร้าง Reminder จริง (ห้ามเขียน Logic ซ้ำ) — Flow นี้เป็นเพียง
  // ตัวรวบรวม Input ทีละขั้นแล้วส่งต่อพารามิเตอร์ชุดเดียวกับที่คำสั่งพิมพ์ตรงๆ ใช้
  const reminder = await dcaReminderService.createReminder(userId, {
    symbol: session.symbol,
    frequency: session.frequency,
    dayOfWeek: session.dayOfWeek,
    dayOfMonth: session.dayOfMonth,
    amountThb,
  });

  // สร้างสำเร็จแล้วค่อยลบ Session — ถ้า createReminder throw จะไม่มาถึงบรรทัดนี้
  // Session จึงค้างที่ AWAITING_AMOUNT ให้ลองใหม่ได้ (ไม่ตกหล่นกลางทาง)
  await sessionRepository.deleteByUser(userId);

  return reminder;
}

// ลบ Session ทิ้งกลางทาง (ผู้ใช้กดปุ่มยกเลิก) — Idempotent ลบซ้ำไม่เป็นไร
async function cancelFlow(userId) {
  await sessionRepository.deleteByUser(userId);
}

// Retention สำหรับ Cron Purge — ลบ Session ที่ updated_at เก่ากว่านี้ (เลย TTL
// 5 นาทีไปนานแล้ว) ตั้งไว้ 60 นาทีเผื่อ Buffer ให้ getCurrentSession มองว่าหมดอายุ
// ไปก่อนนานแล้วค่อยลบทิ้งจริง (getCurrentSession กรองด้วย TTL อยู่แล้ว Purge เป็น
// แค่การเก็บกวาดแถวตายให้ตารางไม่บวม — เทียบเท่า purgeOldPending ของ pending)
const PURGE_RETENTION_MINUTES = 60;

// ── สำหรับ Cron (reminderSetupCleanup.job.js) ─────────────────────────────
async function purgeStaleSessions(retentionMinutes = PURGE_RETENTION_MINUTES) {
  const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000).toISOString();
  return sessionRepository.purgeStaleBefore(cutoff);
}

module.exports = {
  STEPS,
  SETUP_SESSION_TTL_MINUTES,
  PURGE_RETENTION_MINUTES,
  ReminderSetupError,
  getCurrentSession,
  startFlow,
  handleSymbolSelected,
  handleFrequencySelected,
  handleDaySelected,
  handleAmountEntered,
  cancelFlow,
  purgeStaleSessions,
};
