const cron = require('node-cron');
const lineWebhookEventRepository = require('../repositories/lineWebhookEvent.repository');

// ── Purge LINE Webhook Event ที่เก่ากว่า Retention (migration 013) ─────────
// ตารางนี้เก็บไว้แค่กันประมวลผล Event ซ้ำตอน LINE Retry (Retry Window วัดเป็น
// นาที/ชั่วโมง ไม่ใช่วัน) — Retention 7 วันให้ Margin ปลอดภัยมาก โดยไม่ปล่อยให้
// ตารางบวมไม่จำกัด (Pattern เดียวกับ pendingCleanup.job.js / bulkImportCleanup.job.js)
//
// รันวันละ 1 ครั้งตอนตี 3 เวลา Asia/Bangkok (ช่วง Traffic ต่ำสุด) — เวลาเดียวกับ
// Cron Purge อื่นๆ ในโปรเจกต์
const RETENTION_DAYS = 7;

async function runPurgeStaleWebhookEvents() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const count = await lineWebhookEventRepository.purgeOlderThan(cutoff);
    console.log(`[cron:purge-webhook-events] purged ${count} stale webhook event(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Server ที่กำลังรับ
    // Webhook อยู่ Crash ตาม (Unhandled Rejection)
    console.error(`[cron:purge-webhook-events] failed: ${err.message}`);
  }
}

function schedulePurgeStaleWebhookEvents() {
  return cron.schedule('0 3 * * *', runPurgeStaleWebhookEvents, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  schedulePurgeStaleWebhookEvents,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPurgeStaleWebhookEvents,
};
