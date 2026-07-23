const { supabaseAdmin } = require('../config/supabase');
const lineService = require('./line.service');
const config = require('../config/env');

// ── Infra ก่อน Beta — /health + Error Alert เข้า LINE ─────────────────────────
// เช็คว่า Database (Supabase) เชื่อมต่อได้จริง — ใช้ Query เบาที่สุดเท่าที่ทำได้
// (SELECT id LIMIT 1 จากตาราง users ที่มีอยู่แน่นอน) ไม่ใช่แค่เช็คว่า Process
// ยังไม่ตาย (Route /health เดิมก่อนหน้านี้ตอบ 200 เสมอโดยไม่เช็คอะไรเลย)
async function checkDatabaseHealthy() {
  try {
    const { error } = await supabaseAdmin.from('users').select('id').limit(1);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error(`[health] database health check failed: ${err.message}`);
    return false;
  }
}

// ส่ง Push แจ้ง Admin ทุกคนที่ตั้งไว้ — Reuse ADMIN_LINE_USER_IDS เดิม (ตัวเดียวกับ
// ที่ payment.service ใช้แจ้ง Admin เรื่องคำขอชำระเงินอยู่แล้ว) ไม่สร้าง Config ใหม่
// Best-effort ทีละคน: 1 คน Push ไม่สำเร็จ (บล็อกบอท/Rate Limit) ไม่กระทบคนอื่น
async function pushAdminAlert(text) {
  const adminIds = config.payment.adminLineUserIds;
  if (adminIds.length === 0) {
    console.error(`[health] alert suppressed (no ADMIN_LINE_USER_IDS configured): ${text}`);
    return;
  }

  const message = { type: 'text', text };
  await Promise.all(
    adminIds.map((adminId) =>
      lineService.pushMessage(adminId, message).catch((err) => {
        console.error(`[health] failed to push admin alert to ${adminId}: ${err.message}`);
      })
    )
  );
}

// Debounce State (In-memory) — กัน Push รัวทุกครั้งที่ /health ถูกเรียกระหว่าง
// Database ยังล่มต่อเนื่อง (เช่น UptimeRobot Ping ทุก 5 นาที) ต้อง Push แค่ 2 ครั้ง
// ต่อ 1 เหตุการณ์: ตอน "เพิ่งเจอปัญหา" (ปกติ→ล่ม) และตอน "กลับมาปกติ" (ล่ม→ปกติ)
// ไม่ Push ซ้ำระหว่างที่ยังพังต่อเนื่อง (ล่ม→ล่ม)
//
// ⚠️ Best-effort เท่านั้น: State อยู่ใน Memory ของ Process เดียว ถ้า Process
// Restart กลางที่ Database กำลังล่มอยู่ จะนับเป็น "เพิ่งเจอปัญหา" ใหม่อีกครั้ง
// (Push ซ้ำ 1 ครั้ง) — ยอมรับได้เพราะจุดประสงค์แค่กัน Spam ถี่เกินไป ไม่ใช่การ
// รับประกันที่ต้องเป๊ะ 100%
let lastKnownHealthy = true;

// เช็ค Database + Push แจ้ง Admin เฉพาะตอนเปลี่ยนสถานะ (Debounce ด้านบน) — คืน
// { healthy } ให้ Route /health ใช้ตัดสิน Status Code (200/503) ต่อ
async function checkAndAlert() {
  const healthy = await checkDatabaseHealthy();

  if (!healthy && lastKnownHealthy) {
    await pushAdminAlert('🔴 EasyDCA: เชื่อมต่อ Database ไม่ได้ กรุณาตรวจสอบด่วน');
  } else if (healthy && !lastKnownHealthy) {
    await pushAdminAlert('🟢 EasyDCA: ระบบกลับมาเชื่อมต่อ Database ได้ปกติแล้ว');
  }
  lastKnownHealthy = healthy;

  return { healthy };
}

// สำหรับ Test เท่านั้น — Reset Debounce State กลับเป็นค่าเริ่มต้นระหว่าง Test Case
function __resetDebounceStateForTest() {
  lastKnownHealthy = true;
}

module.exports = {
  checkDatabaseHealthy,
  pushAdminAlert,
  checkAndAlert,
  __resetDebounceStateForTest,
};
