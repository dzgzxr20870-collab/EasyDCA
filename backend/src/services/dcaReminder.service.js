const reminderRepository = require('../repositories/dcaReminder.repository');
const userRepository = require('../repositories/user.repository');
const entitlement = require('./entitlement.service');
const symbolRegistry = require('./symbolRegistry.service');
const {
  dayOfWeekOf,
  lastDayOfMonthOf,
  parseDateParts,
  dowToDayName,
} = require('../utils/thaiDate.util');

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

// สกุล USD ใช้ได้เฉพาะประเภทที่มีราคา USD จริง (crypto/stock_us) — ตรงกับ
// USD_SUPPORTED_TYPES ใน transactions.controller เพื่อให้แผน DCA ที่ตั้งเป็น USD
// สร้างธุรกรรม USD ได้จริงตอนกด "บันทึกเลย" (ทอง/หุ้นไทยเป็น THB)
const USD_SUPPORTED_TYPES = ['crypto', 'stock_us'];

// currency รองรับสำหรับ symbol นี้ไหม — THB ได้เสมอ / USD เฉพาะ type ที่รองรับ
// ใช้ร่วมกันทั้ง createPlan (controller) และ updatePlan (service) — Single Source
function isCurrencySupportedForSymbol(symbol, currency) {
  if (currency === 'THB') return true;
  if (currency !== 'USD') return false;
  return USD_SUPPORTED_TYPES.includes(symbolRegistry.lookupType(symbol));
}

// ตรวจ (frequency, frequencyValue) ให้อยู่ในช่วงที่ DB ยอมรับ (CHECK migration 002)
// คืน Error Code (string) หรือ null ถ้าผ่าน — ให้ Caller (controller/service) Map เอง
// weekly: frequencyValue = day_of_week 0-6 / monthly: frequencyValue = day_of_month 1-31
function frequencyValueError(frequency, frequencyValue) {
  if (!VALID_FREQUENCIES.includes(frequency)) return 'INVALID_FREQUENCY';
  if (!Number.isInteger(frequencyValue)) return 'INVALID_FREQUENCY_VALUE';
  if (frequency === 'weekly' && (frequencyValue < 0 || frequencyValue > 6)) {
    return 'INVALID_FREQUENCY_VALUE';
  }
  if (frequency === 'monthly' && (frequencyValue < 1 || frequencyValue > 31)) {
    return 'INVALID_FREQUENCY_VALUE';
  }
  return null;
}

// สร้างข้อความไทย "ความถี่ + วัน" สำหรับแสดงใน Panel วันนี้ถึงรอบ / รายการแผน
//   weekly → "ทุกวันพฤหัสบดี" / monthly → "ทุกวันที่ 16 ของเดือน"
function buildDayLabel(reminder) {
  if (reminder.frequency === 'weekly') {
    return `ทุกวัน${dowToDayName(Number(reminder.dayOfWeek)) ?? ''}`.trim();
  }
  return `ทุกวันที่ ${Number(reminder.dayOfMonth)} ของเดือน`;
}

// แปลง reminder record → "plan view" ที่ Contract เว็บใช้ (API.md §15.5) — Presentation
// ล้วน: เติม name (จาก registry) + dayLabel + เปลี่ยนชื่อ amountThb → amountTotal
// (ให้ตรง Contract เว็บ §15.2 ที่ใช้ amountTotal + currency)
function toPlanView(reminder) {
  return {
    id: reminder.id,
    symbol: reminder.symbol,
    name: symbolRegistry.lookupName(reminder.symbol) ?? reminder.symbol,
    amountTotal: Number(reminder.amountThb),
    currency: reminder.currency ?? 'THB',
    frequency: reminder.frequency,
    dayOfWeek: reminder.dayOfWeek,
    dayOfMonth: reminder.dayOfMonth,
    dayLabel: buildDayLabel(reminder),
    active: reminder.active,
  };
}

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

  // currency (migration 020) — Default THB (LINE ไม่ส่ง currency = THB เสมอ) ตรวจ
  // เชิงป้องกันว่าเป็น THB/USD เท่านั้น (การตรวจ "USD รองรับ type นี้ไหม" อยู่ที่
  // Web Controller ก่อนเรียกเข้ามา — ไม่ตรวจที่นี่เพื่อไม่ให้กระทบ LINE Path)
  const currency = params.currency ?? 'THB';
  if (currency !== 'THB' && currency !== 'USD') {
    throw new DcaReminderError('INVALID_REMINDER', 'currency must be THB or USD', { currency });
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
// ── DCA Planner Gate (Business Model Beta) ──────────────────────────────────
// Free จำกัดจำนวน "แผน Active พร้อมกัน" (entitlement.FREE_TIER_DCA_PLAN_LIMIT) —
// ตรวจ "ที่นี่ที่เดียว" เพราะ createReminder เป็น Chokepoint ร่วมของทุกทางเข้า
// (เว็บ createPlan, LINE คำสั่งพิมพ์ SET_REMINDER, LINE Guided reminderSetupFlow)
// จึงกันครบทั้งเว็บและ LINE ด้วยจุดแก้จุดเดียว (ไม่มีช่องโหว่ทางใดทางหนึ่งหลุด)
//
// นับเฉพาะ "symbol ที่ต่างกัน" ของแผน Active — การตั้งแผนของ symbol เดิมซ้ำถือเป็น
// "แก้ไขทับ" (createReminder deactivate ตัวเก่าแล้ว insert ใหม่ จำนวน Active สุทธิ
// ไม่เพิ่ม) จึงอนุญาตเสมอ ไม่ให้ Free ที่มีแผน BTC อยู่แล้วแก้ยอด BTC ไม่ได้
//
// Premium (isPremiumActive) → ไม่จำกัด (getActiveDcaPlanLimit คืน null) ข้ามการนับ
// throw PLAN_LIMIT_REACHED ให้ Caller Map เป็นข้อความไทยชวนอัพเกรด (Controller เว็บ
// → 403 / flexMessage.ERROR_MESSAGES → การ์ด LINE) — ไม่ปล่อย Error ดิบถึงผู้ใช้
async function assertWithinPlanLimit(userId, symbol) {
  const user = await userRepository.findById(userId);
  const limit = entitlement.getActiveDcaPlanLimit(user);
  if (limit === null) return; // Premium Active — ไม่จำกัด

  const active = await reminderRepository.findActiveByUser(userId);
  const activeSymbols = new Set((active ?? []).map((r) => r.symbol));

  // ตั้งทับ symbol เดิมที่ Active อยู่แล้ว = แก้ไข ไม่ใช่เพิ่มแผนใหม่ → อนุญาต
  if (activeSymbols.has(symbol)) return;

  if (activeSymbols.size >= limit) {
    throw new DcaReminderError(
      'PLAN_LIMIT_REACHED',
      `Free plan allows at most ${limit} active DCA plan(s); user already has ${activeSymbols.size}`,
      { limit, current: activeSymbols.size }
    );
  }
}

async function createReminder(userId, params) {
  validateCreateParams(params);

  // Gate ก่อนแตะ DB ใดๆ (Free จำกัดจำนวนแผน Active) — ทุกทางเข้าผ่านจุดนี้
  await assertWithinPlanLimit(userId, params.symbol);

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
    // ส่ง currency ต่อ "เฉพาะเมื่อ Caller ส่งมา" (เว็บ) — LINE ไม่ส่ง = insert payload
    // เท่าเดิมทุกประการ (repository Default 'THB' ให้เอง) ไม่กระทบพฤติกรรม/เทสต์เดิม
    ...(params.currency ? { currency: params.currency } : {}),
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

// ═══════════════════════════════════════════════════════════════════════════
// Web DCA Planner (S8 R3) — CRUD รายแผน by id สำหรับ /api/v1/dca-plans
// ═══════════════════════════════════════════════════════════════════════════
// ตารางนี้เป็น "Config" ไม่ใช่ Ledger → UPDATE/DELETE ปกติได้ (ไม่ Reversal Pattern)
// ต่างจาก Path LINE ที่จัดการ by symbol (createReminder/deleteReminder soft-delete)

// สร้างแผนจากเว็บ — Reuse createReminder เดิม (deactivate ตัวเก่า + insert, 1 active
// ต่อ symbol) แล้วคืน plan view ตรงๆ (ไม่ต้อง Query รายการทั้งหมดซ้ำ)
async function createPlan(userId, params) {
  const created = await createReminder(userId, params);
  return toPlanView(created);
}

// รายการแผนทั้งหมดของ User (active + paused) — แถวล่าสุดต่อ symbol (ซ่อน tombstone
// เก่าที่ createReminder ทิ้งไว้). Presentation-ready ผ่าน toPlanView
async function listPlans(userId) {
  const plans = await reminderRepository.findLatestPerSymbolByUser(userId);
  return plans.map(toPlanView);
}

// แก้ไข/หยุด-เปิดแผน by id (scope user_id เสมอ) — patch มี field ไหนก็แก้เฉพาะนั้น:
//   amountThb?, currency?, frequency?, frequencyValue?, active?
// throw DcaReminderError (PLAN_NOT_FOUND / INVALID_* / CURRENCY_NOT_SUPPORTED_FOR_ASSET)
async function updatePlan(userId, id, patch) {
  const existing = await reminderRepository.findByIdForUser(id, userId);
  if (!existing) {
    throw new DcaReminderError('PLAN_NOT_FOUND', `Plan ${id} not found for this user`, { id });
  }

  const dbPatch = {};

  if (patch.amountThb !== undefined) {
    if (!Number.isFinite(patch.amountThb) || patch.amountThb <= 0) {
      throw new DcaReminderError('VALIDATION_ERROR', 'amountThb must be a positive number', {
        amountThb: patch.amountThb,
      });
    }
    dbPatch.amount_thb = patch.amountThb;
  }

  if (patch.currency !== undefined) {
    // currency ที่จะใช้ตรวจ support = ค่าใหม่ / symbol คงเดิม (เปลี่ยน symbol ไม่ได้)
    if (!isCurrencySupportedForSymbol(existing.symbol, patch.currency)) {
      throw new DcaReminderError(
        'CURRENCY_NOT_SUPPORTED_FOR_ASSET',
        `Currency ${patch.currency} not supported for ${existing.symbol}`,
        { symbol: existing.symbol, currency: patch.currency }
      );
    }
    dbPatch.currency = patch.currency;
  }

  // frequency/day: ถ้าแก้อย่างใดอย่างหนึ่ง ต้องเซ็ตให้ครบคู่ให้ผ่าน CHECK
  // dca_reminders_day_consistency (weekly→day_of_week set/day_of_month null, กลับกัน)
  if (patch.frequency !== undefined || patch.frequencyValue !== undefined) {
    const nextFreq = patch.frequency ?? existing.frequency;

    // ── การเลือก nextValue (⚠️ ระวังบั๊กที่เคยเกิด — ห้ามแก้กลับ) ─────────────────
    // เปลี่ยน frequency ไป "คนละแบบกับเดิม" ต้องส่ง frequencyValue มาด้วยเสมอ:
    // แถวเดิมมี Field ของอีกแบบเป็น null อยู่แล้วตาม DB Constraint (แถว monthly มี
    // day_of_week=null / แถว weekly มี day_of_month=null) เอามาใช้แทนกันไม่ได้ —
    // ถ้าเดาจากค่าเดิม (null) แล้วผ่าน Number(null)=0 จะ "บังเอิญ" ผ่าน Range ของ
    // weekly (0-6, 0=อาทิตย์) กลายเป็นแผนวันอาทิตย์แบบเงียบๆ ที่ไม่มีใครตั้งใจ
    // (Monthly ไม่โดนเพราะ Range 1-31 ไม่รวม 0 — ความไม่สมมาตรนี้คือตัวบั๊กเดิม)
    // จึงบังคับให้เป็น null → Error ด้านล่างชัดเจน แทนการเดา
    const frequencyChanged =
      patch.frequency !== undefined && patch.frequency !== existing.frequency;
    let nextValue;
    if (patch.frequencyValue !== undefined) {
      nextValue = patch.frequencyValue;
    } else if (frequencyChanged) {
      nextValue = null; // บังคับ INVALID_FREQUENCY_VALUE ด้านล่าง (ไม่เดาจาก Field เดิม)
    } else {
      // frequency คงเดิม (หรือส่งมาเท่าเดิม) — ขยับเฉพาะวันของ Field ที่ตรงกับ freq เดิม
      nextValue = nextFreq === 'weekly' ? existing.dayOfWeek : existing.dayOfMonth;
    }

    // ⚠️ ส่ง nextValue "ดิบ" (ไม่ห่อ Number()) ให้ frequencyValueError — เพราะ
    // Number(null)=0 จะผ่าน Number.isInteger + Range weekly (คือต้นตอบั๊ก) ส่วน null
    // ดิบทำให้ Number.isInteger(null)=false → INVALID_FREQUENCY_VALUE ตามต้องการ
    const err = frequencyValueError(nextFreq, nextValue);
    if (err) {
      throw new DcaReminderError(err, `Invalid ${nextFreq} frequency value ${nextValue}`, {
        frequency: nextFreq,
        frequencyValue: nextValue,
      });
    }

    dbPatch.frequency = nextFreq;
    if (nextFreq === 'weekly') {
      dbPatch.day_of_week = Number(nextValue);
      dbPatch.day_of_month = null;
    } else {
      dbPatch.day_of_month = Number(nextValue);
      dbPatch.day_of_week = null;
    }
  }

  if (patch.active !== undefined) {
    // Reactivate (paused→active): ปิดแผน active อื่นของ symbol เดียวกันก่อน กันชน
    // unique index idx_dca_reminders_one_active (1 active ต่อ user+symbol) — จากนั้น
    // updateByIdForUser เซ็ตแถวนี้ active=true (ครอบ deactivateActive ที่เพิ่งปิดไป)
    if (patch.active === true) {
      await reminderRepository.deactivateActive(userId, existing.symbol);
    }
    dbPatch.active = patch.active;
  }

  const updated = await reminderRepository.updateByIdForUser(id, userId, dbPatch);
  // เผื่อแถวถูกลบไประหว่างทาง (Race) — updateByIdForUser คืน null
  if (!updated) {
    throw new DcaReminderError('PLAN_NOT_FOUND', `Plan ${id} not found for this user`, { id });
  }

  return toPlanView(updated);
}

// ลบแผน by id จริง (Hard delete — Config ไม่ใช่ Ledger) scope user_id
async function deletePlanById(userId, id) {
  const deleted = await reminderRepository.deleteByIdForUser(id, userId);
  if (deleted === 0) {
    throw new DcaReminderError('PLAN_NOT_FOUND', `Plan ${id} not found for this user`, { id });
  }
  return { id, deleted };
}

// แผนที่ "ถึงรอบวันนี้" ของ User คนเดียว — สำหรับ Panel วันนี้ถึงรอบ DCA + Prefill
// ฟอร์ม (dashboard overview). Reuse findActiveByUser + isDueOn เดิม (Logic เดียวกับ
// Cron findDueReminders ที่เป็น Global) today = 'YYYY-MM-DD' ตาม Asia/Bangkok
async function getTodayDuePlansForUser(userId, today) {
  const dow = dayOfWeekOf(today);
  const { day: dom } = parseDateParts(today);
  const lastDom = lastDayOfMonthOf(today);

  const active = await reminderRepository.findActiveByUser(userId);
  return active.filter((r) => isDueOn(r, dow, dom, lastDom)).map(toPlanView);
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
  // Web DCA Planner (S8 R3)
  createPlan,
  listPlans,
  updatePlan,
  deletePlanById,
  getTodayDuePlansForUser,
  // Validators/helpers ที่ Controller Reuse (Single Source)
  isCurrencySupportedForSymbol,
  frequencyValueError,
  USD_SUPPORTED_TYPES,
};
