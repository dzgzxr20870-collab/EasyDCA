// ═══════════════════════════════════════════════════════════════════════
// dcaPlanCurrency — ตรวจว่าสินทรัพย์ประเภทไหนตั้งแผน DCA เป็น USD ได้ (S8 R3 รอบ 3)
// ═══════════════════════════════════════════════════════════════════════
// มิเรอร์ตรงจาก USD_SUPPORTED_TYPES ใน backend/src/services/dcaReminder.service.js
// (คนละตัวกับ USD_TOGGLE_TYPES ใน DcaForm.jsx ซึ่งเป็น UX Choice ที่แคบกว่าโดยตั้งใจ
// เฉพาะฟอร์มบันทึกรายการ — ฟอร์มสร้างแผน DCA รอบนี้ Requirement สั่งให้ Reuse Logic
// isCurrencySupportedForSymbol ตัวเต็มจริงตามที่ Backend Validate จริง)
export const PLAN_USD_SUPPORTED_TYPES = ['crypto', 'stock_us'];

export function isCurrencySupportedForSymbol(type) {
  return PLAN_USD_SUPPORTED_TYPES.includes(type);
}
