const sessionRepository = require('../repositories/bulkImportSession.repository');

// TTL 5 นาที (Pattern เดียวกับ pending_transactions / dca_reminder_setup_sessions)
// Sliding นับจาก updated_at — ผู้ใช้พิมพ์ "นำเข้าพอร์ต" แล้วต้องส่ง Batch ภายใน
// เวลานี้ มิฉะนั้น Session ถือว่าหมดอายุ ต้องพิมพ์คำสั่งใหม่
const BULK_IMPORT_SESSION_TTL_MINUTES = 5;

function ttlCutoffIso() {
  return new Date(Date.now() - BULK_IMPORT_SESSION_TTL_MINUTES * 60 * 1000).toISOString();
}

// เริ่ม Session ใหม่ (ปุ่ม/คำสั่ง "นำเข้าพอร์ต") — เขียนทับของเก่าเสมอ (UPSERT)
async function startSession(userId) {
  return sessionRepository.upsert(userId);
}

// คืน Session ปัจจุบันที่ "ยังไม่หมดอายุ" หรือ null (หมดอายุ/ไม่มี ให้ผลเหมือนกัน)
async function getCurrentSession(userId) {
  return sessionRepository.findValidByUser(userId, ttlCutoffIso());
}

// ลบ Session ทิ้ง — เรียกเมื่อ Batch ถูกยอมรับเข้าสู่ Preview สำเร็จเท่านั้น
// (Parse/Validate ไม่ผ่าน "ไม่ลบ" เพื่อให้ผู้ใช้ส่ง Batch แก้ไขใหม่ได้ทันทีโดยไม่ต้อง
// พิมพ์ "นำเข้าพอร์ต" ซ้ำ — Pattern เดียวกับ reminderSetupFlow.handleAmountEntered)
async function clearSession(userId) {
  await sessionRepository.deleteByUser(userId);
}

// ── สำหรับ Cron (bulkImportCleanup.job.js) ────────────────────────────────
const PURGE_RETENTION_MINUTES = 60;

async function purgeStaleSessions(retentionMinutes = PURGE_RETENTION_MINUTES) {
  const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000).toISOString();
  return sessionRepository.purgeStaleBefore(cutoff);
}

module.exports = {
  BULK_IMPORT_SESSION_TTL_MINUTES,
  PURGE_RETENTION_MINUTES,
  startSession,
  getCurrentSession,
  clearSession,
  purgeStaleSessions,
};
