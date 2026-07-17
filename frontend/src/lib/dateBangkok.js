// ═══════════════════════════════════════════════════════════════════════
// dateBangkok — วันที่ปัจจุบันตามเขตเวลา Asia/Bangkok เป็น 'YYYY-MM-DD' (S8 R1b)
// ═══════════════════════════════════════════════════════════════════════
// ใช้เป็นค่า Default + max ของช่อง "วันที่ลงทุน" ในฟอร์มบันทึก DCA — ต้องตรงกับ
// นิยาม "วันนี้" ฝั่ง Backend (transaction.service.todayInBangkok ใน backend เดิม
// ก็ใช้ Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok'}) แบบเดียวกัน) เพื่อ
// ไม่ให้ Client กับ Server เห็น "วันนี้" ไม่ตรงกันช่วงเที่ยงคืน — Pattern เดียวกับ
// frontend/src/pages/Dashboard.jsx (formatThaiDate) ที่ใช้ en-CA + timeZone อยู่แล้ว
//
// นี่คือ Presentation/Validation Boundary (ขอบเขตวันที่กรอกได้) ไม่ใช่การคำนวณเงิน
export function todayBangkokIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}
