// ═══════════════════════════════════════════════════════════════════════
// dcaPlansErrors — ตาราง Error Code → ข้อความไทย สำหรับหน้าจัดการแผน DCA บนเว็บ
// (S8 R3 รอบ 3) — Pattern เดียวกับ frontend/src/lib/dcaErrors.js (แยกตาราง
// เพราะเป็นคนละ Endpoint/Error Code Set กัน) ข้อความตรงกับ WEB_ERROR_MESSAGES ใน
// backend/src/controllers/dcaPlans.controller.js (docs/API.md §15.5)

const DCA_PLAN_ERROR_MESSAGES = {
  VALIDATION_ERROR: 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  SYMBOL_NOT_SUPPORTED: 'ระบบยังไม่รองรับสินทรัพย์นี้ กรุณาเลือกจากรายการสินทรัพย์ที่มีให้',
  INVALID_FREQUENCY: 'ความถี่ต้องเป็น "รายสัปดาห์" หรือ "รายเดือน" เท่านั้น',
  INVALID_FREQUENCY_VALUE:
    'วันที่เลือกไม่ถูกต้อง (รายสัปดาห์เลือกวันอาทิตย์–เสาร์ / รายเดือนเลือกวันที่ 1–31)',
  CURRENCY_NOT_SUPPORTED_FOR_ASSET:
    'สินทรัพย์นี้ตั้งแผนเป็นสกุล USD ไม่ได้ รองรับเฉพาะคริปโตและหุ้นสหรัฐ',
  PLAN_NOT_FOUND: 'ไม่พบแผน DCA ที่ต้องการ (อาจถูกลบไปแล้ว)',
  // DCA Planner Gate (Business Model Beta) — Free จำกัด 1 แผน (ชวนอัพเกรด ไม่ใช่ Error ดิบ)
  PLAN_LIMIT_REACHED: 'แผน DCA ฟรีจำกัด 1 แผน — อัพเกรดเป็น Premium เพื่อตั้งแผนได้ไม่จำกัด',
  UNAUTHORIZED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

// true ถ้า code นี้เป็น "ต้องอัพเกรด Premium" (Frontend โชว์ปุ่มลิงก์ไปหน้าอัพเกรด
// แทนข้อความ Error เฉยๆ) — ใช้ร่วมกับ Export Gate (EXPORT_PREMIUM_REQUIRED)
export function isUpgradeRequiredError(code) {
  return code === 'PLAN_LIMIT_REACHED';
}

// code ที่ไม่รู้จัก → Fallback ข้อความกลางๆ เสมอ (ห้ามโชว์ Error Code ดิบ)
export function dcaPlanErrorMessage(code) {
  return DCA_PLAN_ERROR_MESSAGES[code] ?? DCA_PLAN_ERROR_MESSAGES.INTERNAL_ERROR;
}
