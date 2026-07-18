// ═══════════════════════════════════════════════════════════════════════
// transactionNote — แปลง tx.note ให้อ่านง่ายก่อนแสดงผล (S8 R3)
// ═══════════════════════════════════════════════════════════════════════
// รายการ Reversal (จากกด "ยกเลิกรายการล่าสุด") ถูกสร้างเป็น Transaction ตรงข้าม
// พร้อม note = 'UNDO_OF:<originalTransactionId>' ตาม Convention เดียวกับ
// backend/src/services/undoTransaction.service.js (UNDO_MARKER) — ห้ามโชว์ UUID
// ดิบให้ผู้ใช้เห็น (ไม่มีประโยชน์กับผู้ใช้ทั่วไป) จึงแปลงเป็นข้อความอ่านง่ายแทน
// ส่วน Note ปกติที่ผู้ใช้พิมพ์เอง แสดงตามที่พิมพ์จริงตรงๆ ไม่แก้ไข
const UNDO_MARKER_PREFIX = 'UNDO_OF:';

export function isReversalNote(note) {
  return typeof note === 'string' && note.startsWith(UNDO_MARKER_PREFIX);
}

// คืน null ถ้าไม่มี Note ให้แสดง (Caller เป็นคนตัดสินใจว่าจะโชว์ '-' หรือเว้นว่าง)
export function formatTransactionNote(note) {
  if (!note) return null;
  if (isReversalNote(note)) return '↩︎ ยกเลิกรายการ';
  return note;
}
