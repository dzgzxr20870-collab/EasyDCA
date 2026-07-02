const reminderRepository = require('../repositories/dcaReminder.repository');
const { dayOfWeekOf, lastDayOfMonthOf, parseDateParts } = require('../utils/thaiDate.util');

// Error ที่มี code (Pattern เดียวกับ TransactionServiceError/UndoTransactionError —
// API.md § 5) เพื่อให้ Controller (Webhook) Map เป็นข้อความไทยได้ ไม่ปล่อย Error
// ดิบถึง Client
class DcaReminderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DcaReminderError';
    this.code = code;
    this.details = details;
  }
}

const VALID_FREQUENCIES = ['weekly', 'monthly'];

// ตรวจ params ที่ Parser ส่งมาให้ครบ/อยู่ในช่วงที่ DB ยอมรับ ก่อนแตะ DB
// (day_of_week 0-6 / day_of_month 1-31 ตาม CHECK ใน migration 002) — ถ้าไม่ผ่าน
// throw INVALID_REMINDER ให้ Controller แปลเป็นข้อความไทยแนะนำรูปแบบที่ถูกต้อง
function validateCreateParams(params) {
  const { symbol, frequency, dayOfWeek, dayOfMonth, amountThb } = params;

  if (!symbol || typeof symbol !== 'string') {
    throw new DcaReminderError('INVALID_REMINDER', 'symbol is required', { params });
  }

  if (!VALID_FREQUENCIES.includes(frequency)) {
    throw new DcaReminderError('INVALID_REMINDER', `frequency must be one of ${VALID_FREQUENCIES.join('/')}`, {
      frequency,
    });
  }

  if (!Number.isFinite(amountThb) || amountThb <= 0) {
    throw new DcaReminderError('INVALID_REMINDER', 'amountThb must be a positive number', { amountThb });
  }

  if (frequency === 'weekly') {
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new DcaReminderError('INVALID_REMINDER', 'dayOfWeek must be an integer 0-6 for weekly', {
        dayOfWeek,
      });
    }
  } else {
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      throw new DcaReminderError('INVALID_REMINDER', 'dayOfMonth must be an integer 1-31 for monthly', {
        dayOfMonth,
      });
    }
  }
}

// สร้าง Reminder ใหม่ — ถ้า Symbol เดิมมี Reminder Active อยู่แล้วให้ปิดตัวเก่า
// (active=false) ก่อน แล้วค่อยสร้างใหม่ เพื่อไม่ให้มีหลายอัน Active ต่อ Symbol
// เดียว (สอดคล้อง Unique Partial Index idx_dca_reminders_one_active)
async function createReminder(userId, params) {
  validateCreateParams(params);

  // ปิดของเก่าก่อนเสมอ — กันชน Unique Index และเป็นพฤติกรรม "ตั้งใหม่ทับของเดิม"
  await reminderRepository.deactivateActive(userId, params.symbol);

  return reminderRepository.insert({
    userId,
    symbol: params.symbol,
    frequency: params.frequency,
    // เก็บเฉพาะ Field ที่ตรงกับ frequency (อีก Field เป็น null) ให้ผ่าน
    // CHECK dca_reminders_day_consistency ใน migration 002
    dayOfWeek: params.frequency === 'weekly' ? params.dayOfWeek : null,
    dayOfMonth: params.frequency === 'monthly' ? params.dayOfMonth : null,
    amountThb: params.amountThb,
  });
}

// คืนเฉพาะ Reminder ที่ active=true ของ User
async function listReminders(userId) {
  return reminderRepository.findActiveByUser(userId);
}

// Soft-delete — ปิด Reminder Active ของ Symbol นั้น ถ้าไม่มี Active เลย throw
// REMINDER_NOT_FOUND ให้ Controller แปลเป็นข้อความไทย
async function deleteReminder(userId, symbol) {
  const deactivated = await reminderRepository.deactivateActive(userId, symbol);

  if (deactivated === 0) {
    throw new DcaReminderError('REMINDER_NOT_FOUND', `No active reminder found for ${symbol}`, {
      userId,
      symbol,
    });
  }

  return { symbol, deactivated };
}

// ตรวจว่า Reminder ตรงกับวันนี้ไหม (แยกออกมาเพื่อ Test ง่ายและอ่านชัด)
//  - weekly: day_of_week ตรงกับวันในสัปดาห์ของวันนี้
//  - monthly: day_of_month ตรง — และถ้าเดือนนี้ไม่มีวันนั้น (เช่นตั้ง 31 แต่ ก.พ.
//    มีถึง 28) ให้เลื่อนมา "วันสุดท้ายของเดือน" แทน ด้วย min(day_of_month, lastDom)
//    (migration 002: App Layer จัดการ Logic เลื่อนวันสิ้นเดือน)
function isDueOn(reminder, dow, dom, lastDom) {
  if (reminder.frequency === 'weekly') {
    return Number(reminder.dayOfWeek) === dow;
  }

  if (reminder.frequency === 'monthly') {
    const effectiveDay = Math.min(Number(reminder.dayOfMonth), lastDom);
    return effectiveDay === dom;
  }

  return false;
}

// หา Reminder ที่ครบกำหนดวันนี้และยังไม่ถูก Notify วันนี้
// today: สตริง 'YYYY-MM-DD' ตาม Asia/Bangkok (Cron ส่ง todayInBangkok() มา)
// วันในสัปดาห์/วันสุดท้ายของเดือนคำนวณแบบ Timezone-safe (thaiDate.util ใช้ Date.UTC)
async function findDueReminders(today) {
  const dow = dayOfWeekOf(today);
  const { day: dom } = parseDateParts(today);
  const lastDom = lastDayOfMonthOf(today);

  // Repository กรอง active + last_notified_date !== today ให้แล้ว (กัน Push ซ้ำ)
  // ที่นี่กรองต่อว่าตรง "วันนี้" ตามรอบ (day_of_week / day_of_month + สิ้นเดือน)
  const candidates = await reminderRepository.findActiveDueCandidates(today);
  return candidates.filter((reminder) => isDueOn(reminder, dow, dom, lastDom));
}

// อัปเดต last_notified_date หลัง Push สำเร็จ (Cron เรียกเฉพาะเมื่อ Push ผ่าน)
async function markNotified(reminderId, date) {
  return reminderRepository.markNotified(reminderId, date);
}

module.exports = {
  DcaReminderError,
  VALID_FREQUENCIES,
  createReminder,
  listReminders,
  deleteReminder,
  findDueReminders,
  isDueOn,
  markNotified,
};
