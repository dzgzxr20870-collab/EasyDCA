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
//
// ⚠️ ใช้คำว่า "ยกเลิก" ไม่ใช่ "ย้อน" (พรอมต์รวมคำ 30 ส.ค. 2569 — Founder ต้องการ
// คำเดียวที่ใช้เรียกฟีเจอร์นี้ทั้งเว็บ/LINE คือ "ยกเลิกรายการล่าสุด") — กลับคำจาก
// fix/misleading-messages ข้อ 2 เดิม (ตอนนั้นใช้ "ย้อน" เพราะกลัวชนกับ "ยกเลิก"
// ของ Pending ที่ไม่เคยบันทึก) คำว่า "ล่าสุด" ที่ต่อท้ายในทุกจุดที่พูดถึงฟีเจอร์นี้
// เป็นตัวแยกความกำกวมอยู่แล้ว (buildCancelledMessage ของ Pending ไม่มีคำว่า
// "ล่าสุด" ต่อท้าย) จึงใช้ "ยกเลิก" ร่วมกันได้โดยไม่ชนกัน
export function formatTransactionNote(note) {
  if (!note) return null;
  if (isReversalNote(note)) return '↩︎ ยกเลิกรายการ';
  return note;
}
