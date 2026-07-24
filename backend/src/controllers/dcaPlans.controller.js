const dcaReminderService = require('../services/dcaReminder.service');
const symbolRegistry = require('../services/symbolRegistry.service');

// ═══════════════════════════════════════════════════════════════════════════
// dcaPlans.controller — แผน DCA จากเว็บ (S8 R3) — /api/v1/dca-plans
// ═══════════════════════════════════════════════════════════════════════════
// "แผน DCA" = แถวใน dca_reminders (migration 002) — ตารางเดียวกับ reminder ที่ตั้ง
// ผ่าน LINE ทุกประการ (Single Source of Truth, web=LINE). Controller นี้ทำแค่
// Validate Input + Map → เรียก dcaReminder.service (Reuse createReminder เดิม +
// ฟังก์ชันเว็บใหม่ listPlans/updatePlan/deletePlanById)
//
// ⚠️ ตารางนี้เป็น "Config ของ User" ไม่ใช่ Immutable Ledger เหมือน transactions —
// PATCH/DELETE ปกติได้ (ไม่ Reversal Pattern)
//
// Error Response Shape เหมือน transactions.controller: { error: CODE, message: ไทย,
// details? } (Flat — Frontend อ่าน body.error/body.message ตรงๆ)

const WEB_ERROR_MESSAGES = {
  VALIDATION_ERROR: 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  SYMBOL_NOT_SUPPORTED: 'ระบบยังไม่รองรับสินทรัพย์นี้ กรุณาเลือกจากรายการสินทรัพย์ที่มีให้',
  INVALID_FREQUENCY: 'ความถี่ต้องเป็น "รายสัปดาห์" หรือ "รายเดือน" เท่านั้น',
  INVALID_FREQUENCY_VALUE:
    'วันที่เลือกไม่ถูกต้อง (รายสัปดาห์เลือกวันอาทิตย์–เสาร์ / รายเดือนเลือกวันที่ 1–31)',
  CURRENCY_NOT_SUPPORTED_FOR_ASSET:
    'สินทรัพย์นี้ตั้งแผนเป็นสกุล USD ไม่ได้ รองรับเฉพาะคริปโตและหุ้นสหรัฐ',
  PLAN_NOT_FOUND: 'ไม่พบแผน DCA ที่ต้องการ (อาจถูกลบไปแล้ว)',
  // DCA Planner Gate (Business Model Beta) — Free จำกัดจำนวนแผน Active (ชวนอัพเกรด
  // ไม่ใช่ Error ดิบ) Frontend อ่าน code นี้แล้วโชว์ปุ่มลิงก์ไปหน้าอัพเกรด Premium
  PLAN_LIMIT_REACHED:
    'แผน DCA ฟรีจำกัด 2 แผน — อัพเกรดเป็น Premium เพื่อตั้งแผน DCA ได้ไม่จำกัด',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  SYMBOL_NOT_SUPPORTED: 400,
  INVALID_FREQUENCY: 400,
  INVALID_FREQUENCY_VALUE: 400,
  CURRENCY_NOT_SUPPORTED_FOR_ASSET: 400,
  PLAN_NOT_FOUND: 404,
  // 403 = สิทธิ์ไม่พอ (ต้อง Premium) — Frontend แยกจาก 400 (ข้อมูลผิด) เพื่อโชว์ CTA
  PLAN_LIMIT_REACHED: 403,
};

function fail(res, code, details = {}) {
  const status = ERROR_STATUS[code] ?? 500;
  return res.status(status).json({
    error: code,
    message: WEB_ERROR_MESSAGES[code] ?? WEB_ERROR_MESSAGES.INTERNAL_ERROR,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  });
}

// ตัวเลข > 0 จริง — กัน NaN/Infinity/'abc'/true/null/[] (เหมือน transactions.controller)
function toPositiveNumber(value) {
  if (typeof value === 'boolean' || value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value) || typeof value === 'object') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

// รับ frequencyValue เป็นจำนวนเต็ม (จาก body ที่อาจเป็น string) — คืน null ถ้าไม่ใช่
function toInteger(value) {
  if (typeof value === 'boolean' || value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value) || typeof value === 'object') return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

// แปลง DcaReminderError → HTTP response (code ของ service ตรงกับ ERROR_STATUS ฝั่งเว็บ)
// createReminder เดิมโยน INVALID_REMINDER (Path LINE) — Map เป็น VALIDATION_ERROR
// ฝั่งเว็บ (Defense: เว็บ Validate ครบก่อนเรียกอยู่แล้ว โดยปกติจะไม่ถึงตรงนี้)
function failFromServiceError(res, err) {
  if (err instanceof dcaReminderService.DcaReminderError) {
    const code = err.code === 'INVALID_REMINDER' ? 'VALIDATION_ERROR' : err.code;
    return fail(res, code, err.details ?? {});
  }
  console.error(`[dca-plans] unexpected error: ${err.message}`);
  return fail(res, 'INTERNAL_ERROR');
}

// POST /api/v1/dca-plans — สร้างแผนใหม่ (Reuse createReminder → 1 active ต่อ symbol)
async function createPlan(req, res) {
  const body = req.body ?? {};

  // 1) symbol ต้องอยู่ใน Registry (แหล่งตัดสินเดียวกับกล่องบันทึก DCA)
  const rawSymbol = body.symbol;
  if (typeof rawSymbol !== 'string' || rawSymbol.trim() === '') {
    return fail(res, 'VALIDATION_ERROR', { field: 'symbol' });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbolRegistry.lookupType(symbol)) {
    return fail(res, 'SYMBOL_NOT_SUPPORTED', { symbol });
  }

  // 2) amountTotal > 0
  const amountTotal = toPositiveNumber(body.amountTotal);
  if (amountTotal === null) {
    return fail(res, 'VALIDATION_ERROR', { field: 'amountTotal' });
  }

  // 3) currency (default THB, USD เฉพาะ crypto/stock_us)
  const currency = body.currency ?? 'THB';
  if (currency !== 'THB' && currency !== 'USD') {
    return fail(res, 'VALIDATION_ERROR', { field: 'currency' });
  }
  if (!dcaReminderService.isCurrencySupportedForSymbol(symbol, currency)) {
    return fail(res, 'CURRENCY_NOT_SUPPORTED_FOR_ASSET', { symbol, currency });
  }

  // 4) frequency + frequencyValue (weekly 0-6 / monthly 1-31)
  const { frequency } = body;
  const frequencyValue = toInteger(body.frequencyValue);
  if (frequencyValue === null) {
    return fail(res, 'INVALID_FREQUENCY_VALUE', { frequencyValue: body.frequencyValue });
  }
  const freqError = dcaReminderService.frequencyValueError(frequency, frequencyValue);
  if (freqError) {
    return fail(res, freqError, { frequency, frequencyValue });
  }

  try {
    const plan = await dcaReminderService.createPlan(req.user.id, {
      symbol,
      amountThb: amountTotal,
      currency,
      frequency,
      dayOfWeek: frequency === 'weekly' ? frequencyValue : null,
      dayOfMonth: frequency === 'monthly' ? frequencyValue : null,
    });
    return res.status(201).json({ plan });
  } catch (err) {
    return failFromServiceError(res, err);
  }
}

// GET /api/v1/dca-plans — รายการแผนทั้งหมด (active + paused, ล่าสุดต่อ symbol)
async function listPlans(req, res) {
  try {
    const plans = await dcaReminderService.listPlans(req.user.id);
    return res.status(200).json({ plans });
  } catch (err) {
    console.error(`[dca-plans] listPlans failed: ${err.message}`);
    return fail(res, 'INTERNAL_ERROR');
  }
}

// PATCH /api/v1/dca-plans/:id — แก้ไข/หยุด-เปิดแผน (ทุก field optional)
async function updatePlan(req, res) {
  const body = req.body ?? {};
  const patch = {};

  if (body.amountTotal !== undefined) {
    const amt = toPositiveNumber(body.amountTotal);
    if (amt === null) return fail(res, 'VALIDATION_ERROR', { field: 'amountTotal' });
    patch.amountThb = amt;
  }

  if (body.currency !== undefined) {
    if (body.currency !== 'THB' && body.currency !== 'USD') {
      return fail(res, 'VALIDATION_ERROR', { field: 'currency' });
    }
    patch.currency = body.currency;
  }

  if (body.frequency !== undefined) patch.frequency = body.frequency;
  if (body.frequencyValue !== undefined) {
    const fv = toInteger(body.frequencyValue);
    if (fv === null) return fail(res, 'INVALID_FREQUENCY_VALUE', { frequencyValue: body.frequencyValue });
    patch.frequencyValue = fv;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return fail(res, 'VALIDATION_ERROR', { field: 'active' });
    }
    patch.active = body.active;
  }

  if (Object.keys(patch).length === 0) {
    return fail(res, 'VALIDATION_ERROR', { reason: 'no updatable fields provided' });
  }

  try {
    const plan = await dcaReminderService.updatePlan(req.user.id, req.params.id, patch);
    return res.status(200).json({ plan });
  } catch (err) {
    return failFromServiceError(res, err);
  }
}

// DELETE /api/v1/dca-plans/:id — ลบแผนจริง (Hard delete — Config ไม่ใช่ Ledger)
async function deletePlan(req, res) {
  try {
    const result = await dcaReminderService.deletePlanById(req.user.id, req.params.id);
    return res.status(200).json({ deleted: { id: result.id } });
  } catch (err) {
    return failFromServiceError(res, err);
  }
}

module.exports = { createPlan, listPlans, updatePlan, deletePlan };
