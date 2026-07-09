const cron = require('node-cron');
const bulkImportSession = require('../services/bulkImportSession.service');

// ── Purge Bulk Import Session ที่หมดอายุค้างในตาราง ──────────────────────────
// Session เป็น Ephemeral Working State (migration 007) — getCurrentSession กรอง
// Session ที่หมดอายุ (เกิน TTL 5 นาที) ออกให้อยู่แล้ว Cron นี้เพียงเก็บกวาดแถวตาย
// (updated_at เก่ากว่า Retention) ไม่ให้ตารางบวม เทียบเท่า
// reminderSetupCleanup.job.js / purgeOldPending
//
// รันวันละ 1 ครั้งตอนตี 3 เวลา Asia/Bangkok (ช่วง Traffic ต่ำสุด) — Pattern
// เดียวกับ Cron Purge อื่นๆ ในโปรเจกต์
async function runPurgeStaleBulkImportSessions() {
  try {
    const count = await bulkImportSession.purgeStaleSessions();
    console.log(`[cron:purge-bulk-import] purged ${count} stale bulk import session(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Server ที่กำลังรับ
    // Webhook อยู่ Crash ตาม (Unhandled Rejection)
    console.error(`[cron:purge-bulk-import] failed: ${err.message}`);
  }
}

function schedulePurgeStaleBulkImportSessions() {
  return cron.schedule('0 3 * * *', runPurgeStaleBulkImportSessions, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  schedulePurgeStaleBulkImportSessions,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPurgeStaleBulkImportSessions,
};
