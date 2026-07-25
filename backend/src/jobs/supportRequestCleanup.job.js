const cron = require('node-cron');
const supportRequestFlow = require('../services/supportRequestFlow.service');

// ── Purge Support Request Session ที่หมดอายุค้างในตาราง ─────────────────────
// Session เป็น Ephemeral Working State (migration 024) — getCurrentSession กรอง
// Session ที่หมดอายุ (เกิน TTL 5 นาที) ออกให้อยู่แล้ว Cron นี้เพียงเก็บกวาดแถวตาย
// (created_at เก่ากว่า Retention) ไม่ให้ตารางบวม — Pattern เดียวกับ
// guidedBuyCleanup.job.js / bulkImportCleanup.job.js ทุกประการ
//
// รันวันละ 1 ครั้งตอนตี 3 เวลา Asia/Bangkok (ช่วง Traffic ต่ำสุด)
async function runPurgeStaleSupportRequestSessions() {
  try {
    const count = await supportRequestFlow.purgeStaleSessions();
    console.log(`[cron:purge-support-request] purged ${count} stale support request session(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Server ที่กำลังรับ
    // Webhook อยู่ Crash ตาม (Unhandled Rejection)
    console.error(`[cron:purge-support-request] failed: ${err.message}`);
  }
}

function schedulePurgeStaleSupportRequestSessions() {
  return cron.schedule('0 3 * * *', runPurgeStaleSupportRequestSessions, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  schedulePurgeStaleSupportRequestSessions,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPurgeStaleSupportRequestSessions,
};
