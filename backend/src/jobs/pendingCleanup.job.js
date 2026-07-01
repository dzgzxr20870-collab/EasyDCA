const cron = require('node-cron');
const pendingService = require('../services/pendingTransaction.service');

// ── Expire Pending ที่หมดอายุ (SRS.md § 2.3 [5] — Timeout 5 นาที) ─────────
// รันทุก 1 นาที: ต้องเร็วพอสมควรเทียบกับ Timeout 5 นาที เพื่อไม่ให้ User
// กดยืนยัน Pending ที่หมดอายุไปนานแล้วโดยไม่รู้ตัว (ความคลาดเคลื่อนสูงสุด
// ~1 นาทีระหว่างรอบ Cron ยอมรับได้เมื่อเทียบกับ Window 5 นาที)
//
// หมายเหตุ: confirmPending() มี claimForConfirm ที่เช็ค expires_at แบบ Atomic
// อยู่แล้วเป็นด่านสุดท้าย (กัน Race Condition จริง) — Cron นี้เป็นเพียงการ
// Sync สถานะ 'pending' ที่ค้างให้ตรงกับความจริงเร็วที่สุดเท่านั้น ไม่ใช่กลไก
// ความถูกต้องหลัก
async function runExpirePending() {
  try {
    const count = await pendingService.expireOverduePending();
    console.log(`[cron:expire-pending] expired ${count} overdue pending transaction(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Server ที่กำลังรับ
    // Webhook อยู่ Crash ตาม (Unhandled Rejection)
    console.error(`[cron:expire-pending] failed: ${err.message}`);
  }
}

// ── Purge Pending เก่าที่ Resolve แล้ว (DATABASE.md § 8 — Retention 24 ชม.) ─
// รันวันละ 1 ครั้งตอนตี 3 เวลา Asia/Bangkok (ช่วง Traffic ต่ำสุด)
async function runPurgeOldPending() {
  try {
    const count = await pendingService.purgeOldPending();
    console.log(`[cron:purge-pending] purged ${count} resolved pending transaction(s)`);
  } catch (err) {
    console.error(`[cron:purge-pending] failed: ${err.message}`);
  }
}

function scheduleExpirePending() {
  return cron.schedule('* * * * *', runExpirePending);
}

function schedulePurgeOld() {
  return cron.schedule('0 3 * * *', runPurgeOldPending, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  scheduleExpirePending,
  schedulePurgeOld,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runExpirePending,
  runPurgeOldPending,
};
