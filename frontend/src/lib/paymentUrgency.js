// ═══════════════════════════════════════════════════════════════════════
// paymentUrgency — ฟังก์ชันบริสุทธิ์ (Pure) สำหรับ Admin Dashboard แสดงความเร่งด่วนของ
// คำขอชำระเงินที่ยัง Unresolved (Lock-Until-Resolved, migration 016 ฝั่ง Backend)
// ═══════════════════════════════════════════════════════════════════════
// แยกออกจาก Admin.jsx เพื่อ Test ตรรกะได้โดยไม่ต้อง Render React (Pattern เดียวกับ
// portfolioMath.js) — ค่า Threshold ทั้งหมดอ้างอิงจาก AMOUNT_LOCK_MAX_AGE_MS (7 วัน)
// ใน backend/src/services/payment.service.js ต้องแก้คู่กันถ้าฝั่ง Backend เปลี่ยนค่านี้

const LOCK_MAX_AGE_HOURS = 168; // 7 วัน — ตรงกับ AMOUNT_LOCK_MAX_AGE_MS ฝั่ง Backend
const WARNING_THRESHOLD_HOURS = 48; // เหลือ <=48 ชม. ก่อนครบ 7 วัน → เหลือง
const URGENT_THRESHOLD_HOURS = 24; // เหลือ <=24 ชม. (รวมติดลบ = เลยกำหนดแล้ว) → แดง

// ระดับความเร่งด่วนของคำขอที่ยัง Unresolved นับจาก createdAt — 'normal' | 'warning' | 'urgent'
// เวลาที่เหลือติดลบ (เลย 7 วันไปแล้วแต่ Cron ยังไม่รัน Auto-release) ถือเป็น 'urgent' เสมอ
export function getUrgencyLevel(createdAt, now = new Date()) {
  const elapsedHours = (new Date(now).getTime() - new Date(createdAt).getTime()) / 3_600_000;
  const remainingHours = LOCK_MAX_AGE_HOURS - elapsedHours;

  if (remainingHours <= URGENT_THRESHOLD_HOURS) return 'urgent';
  if (remainingHours <= WARNING_THRESHOLD_HOURS) return 'warning';
  return 'normal';
}

// คำขอถูก "Auto-release" โดย Cron 7 วันหรือไม่ (ไม่มี Admin คนไหนมา Approve/Reject เลย) —
// amountReleasedAt ถูกตั้งค่าแล้ว (ปล่อยยอดคืน) แต่ confirmedBy ยังว่าง (ไม่มีใคร Resolve
// ผ่านปุ่ม Approve/Reject จริง) ต่างจากคำขอที่ Admin กด Approve/Reject เอง (confirmedBy
// ถูกตั้งค่าเสมอในกรณีนั้น — ดู payment.repository.claimForApproval/claimForRejection)
export function isAutoReleased(payment) {
  return Boolean(payment?.amountReleasedAt) && !payment?.confirmedBy;
}

// ตรวจว่าวันที่ (ISO String) อยู่ภายใน days วันล่าสุดนับจาก now หรือไม่ — ใช้กรอง
// ประวัติ Auto-release "30 วันล่าสุด" ใน Admin Dashboard
export function isWithinDays(dateStr, days, now = new Date()) {
  if (!dateStr) return false;
  const elapsedMs = new Date(now).getTime() - new Date(dateStr).getTime();
  return elapsedMs >= 0 && elapsedMs <= days * 24 * 3_600_000;
}
