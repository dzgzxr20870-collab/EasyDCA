const cron = require('node-cron');
const reminderSetupFlow = require('../services/reminderSetupFlow.service');

// ── Purge Reminder Setup Session ที่หมดอายุค้างในตาราง ──────────────────────
// Session เป็น Ephemeral Working State (migration 003) — getCurrentSession กรอง
// Session ที่หมดอายุ (เกิน TTL 5 นาที) ออกให้อยู่แล้ว Cron นี้เพียงเก็บกวาดแถวตาย
// (updated_at เก่ากว่า Retention) ไม่ให้ตารางบวม เทียบเท่า purge-pending ของ
// pending_transactions
//
// รันวันละ 1 ครั้งตอนตี 3 เวลา Asia/Bangkok (ช่วง Traffic ต่ำสุด) — Pattern
// เดียวกับ schedulePurgeOld ใน pendingCleanup.job.js
async function runPurgeStaleSetupSessions() {
  try {
    const count = await reminderSetupFlow.purgeStaleSessions();
    console.log(`[cron:purge-reminder-setup] purged ${count} stale reminder setup session(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Server ที่กำลังรับ
    // Webhook อยู่ Crash ตาม (Unhandled Rejection)
    console.error(`[cron:purge-reminder-setup] failed: ${err.message}`);
  }
}

function schedulePurgeStaleSetupSessions() {
  return cron.schedule('0 3 * * *', runPurgeStaleSetupSessions, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  schedulePurgeStaleSetupSessions,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPurgeStaleSetupSessions,
};
