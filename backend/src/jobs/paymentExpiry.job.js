const cron = require('node-cron');
const paymentService = require('../services/payment.service');

// ── Expire คำขอชำระเงินที่หมดอายุ (payments.expires_at = สร้าง + 24 ชม.) ──────
// รันทุกชั่วโมง: ไม่ต้องถี่เท่า Pending Transaction (TTL 5 นาที) เพราะคำขอชำระเงิน
// มี TTL ยาว 24 ชม. — ความคลาดเคลื่อน ~1 ชม. ยอมรับได้
//
// หมายเหตุ: markExpired เป็น Atomic (status='pending' guard) กันชนกับ Admin ที่
// กดอนุมัติพร้อมกัน — Cron นี้เป็นเพียงการ Sync สถานะที่ค้างให้ตรงความจริง ไม่ Push
// แจ้งใคร (คำขอหมดอายุเงียบๆ พอ ผู้ใช้ขอใหม่ได้เสมอ)
async function runExpirePayments() {
  try {
    const count = await paymentService.expireOverduePayments();
    console.log(`[cron:expire-payments] expired ${count} overdue payment request(s)`);
  } catch (err) {
    // ต้อง catch เสมอ — Cron พังรอบเดียวไม่ควรทำให้ Server ที่กำลังรับ Webhook Crash
    console.error(`[cron:expire-payments] failed: ${err.message}`);
  }
}

function scheduleExpirePayments() {
  // '0 * * * *' = นาทีที่ 0 ของทุกชั่วโมง
  return cron.schedule('0 * * * *', runExpirePayments);
}

module.exports = {
  scheduleExpirePayments,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runExpirePayments,
};
