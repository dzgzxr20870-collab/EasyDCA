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

// ── Auto-release Safety Valve (migration 016 Lock-Until-Resolved) ────────────
// ปล่อยยอด (amount_released_at) ของคำขอที่ยัง unresolved เกิน 7 วันนับจาก created_at
// คืนอัตโนมัติ — กันยอดล็อกค้างตลอดไปถ้าผู้ใช้ทิ้ง Flow กลางคัน (ไม่จ่ายจริง ไม่มี Admin
// มา Resolve เลย) รันพร้อม Cron หมดอายุเดิม ทุกชั่วโมงพอ ไม่ต้องถี่กว่านี้สำหรับ Cutoff
// ยาวถึง 7 วัน — releaseStaleAmounts เป็น Bulk Atomic UPDATE เดียว ไม่ชนกับ Admin ที่
// Resolve พร้อมกัน (WHERE amount_released_at IS NULL กันซ้ำเอง)
async function runAutoReleaseStaleAmounts() {
  try {
    const count = await paymentService.autoReleaseStaleAmounts();
    console.log(`[cron:auto-release-amounts] released ${count} stale payment amount(s)`);
  } catch (err) {
    // ต้อง catch เสมอ — Cron พังรอบเดียวไม่ควรทำให้ Server ที่กำลังรับ Webhook Crash
    console.error(`[cron:auto-release-amounts] failed: ${err.message}`);
  }
}

function scheduleAutoReleaseStaleAmounts() {
  return cron.schedule('0 * * * *', runAutoReleaseStaleAmounts);
}

module.exports = {
  scheduleExpirePayments,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runExpirePayments,
  scheduleAutoReleaseStaleAmounts,
  runAutoReleaseStaleAmounts,
};
