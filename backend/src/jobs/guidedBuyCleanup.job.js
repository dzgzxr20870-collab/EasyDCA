const cron = require('node-cron');
const guidedBuyFlow = require('../services/guidedBuyFlow.service');

// ── Purge Guided Buy Session ที่หมดอายุค้างในตาราง (S8 R2 รอบ 2) ─────────────
// Session เป็น Ephemeral Working State (migration 022) — getCurrentSession กรอง
// Session ที่หมดอายุ (เกิน TTL 5 นาที) ออกให้อยู่แล้ว Cron นี้เพียงเก็บกวาดแถวตาย
// (updated_at เก่ากว่า Retention) ไม่ให้ตารางบวม — Pattern เดียวกับ
// reminderSetupCleanup.job.js / bulkImportCleanup.job.js ทุกประการ
//
// รันวันละ 1 ครั้งตอนตี 3 เวลา Asia/Bangkok (ช่วง Traffic ต่ำสุด)
async function runPurgeStaleGuidedBuySessions() {
  try {
    const count = await guidedBuyFlow.purgeStaleSessions();
    console.log(`[cron:purge-guided-buy] purged ${count} stale guided buy session(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Server ที่กำลังรับ
    // Webhook อยู่ Crash ตาม (Unhandled Rejection)
    console.error(`[cron:purge-guided-buy] failed: ${err.message}`);
  }
}

function schedulePurgeStaleGuidedBuySessions() {
  return cron.schedule('0 3 * * *', runPurgeStaleGuidedBuySessions, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  schedulePurgeStaleGuidedBuySessions,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPurgeStaleGuidedBuySessions,
};
