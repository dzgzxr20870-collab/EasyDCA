const cron = require('node-cron');
const transactionSlipSession = require('../services/transactionSlipSession.service');

// ── Purge Session "รอรูปสลิป" ที่หมดอายุค้างในตาราง (migration 040) ──────────
// Session เป็น Ephemeral Working State — getActiveSession กรอง Session ที่หมดอายุ
// (เกิน TTL 10 นาที) ออกให้อยู่แล้ว "ที่ชั้นอ่านทุกครั้ง" Cron นี้จึงเป็นแค่การเก็บ
// กวาดแถวตายไม่ให้ตารางบวม ไม่ใช่กลไกความถูกต้อง — ต่อให้ Cron ไม่ทำงานเลย รูปที่
// ผู้ใช้ส่งมาหลังหมดอายุก็จะไหลเข้า AI OCR ตามปกติอยู่ดี
// (Pattern เดียวกับ guidedBuyCleanup.job.js / reminderSetupCleanup.job.js ทุกประการ)
//
// ⚠️ ตารางนี้มี user_id เป็น PRIMARY KEY อยู่แล้ว จำนวนแถวจึงมีเพดานตายตัวเท่ากับ
// จำนวนผู้ใช้ทั้งระบบ (1 คน 1 แถว เขียนทับตัวเอง) — Cron นี้ "ไม่ใช่" ตัวกันตาราง
// โตไม่จำกัดเหมือน Job อื่นในกลุ่มนี้ แต่ยังมีไว้เพื่อไม่ให้เหลือแถวที่ไม่มีความหมาย
// ค้างในฐาน (และเพื่อความสม่ำเสมอกับ Session ตัวอื่นของระบบ)
//
// รันวันละ 1 ครั้งตอนตี 3 เวลา Asia/Bangkok (ช่วง Traffic ต่ำสุด — เวลาเดียวกับ
// Session Cleanup ตัวอื่น)
async function runPurgeStaleTransactionSlipSessions() {
  try {
    const count = await transactionSlipSession.purgeStale();
    console.log(`[cron:purge-slip-session] purged ${count} stale transaction slip session(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Worker Crash ตาม
    console.error(`[cron:purge-slip-session] failed: ${err.message}`);
  }
}

function schedulePurgeStaleTransactionSlipSessions() {
  return cron.schedule('0 3 * * *', runPurgeStaleTransactionSlipSessions, {
    timezone: 'Asia/Bangkok',
  });
}

module.exports = {
  schedulePurgeStaleTransactionSlipSessions,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPurgeStaleTransactionSlipSessions,
};
