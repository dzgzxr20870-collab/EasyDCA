const cron = require('node-cron');
const userRepository = require('../repositories/user.repository');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');

// ── Downgrade ผู้ใช้ Premium ที่หมดอายุกลับเป็น Free (PROJECT_BRIEF § 9) ──────
// รันวันละครั้ง (ตี 1): หา user ที่ plan='premium' AND plan_expires_at < now()
// แล้วปรับกลับเป็น Free (จำกัด 2 สินทรัพย์) — "ห้ามลบข้อมูล" (เก็บครบ แค่ล็อกสิทธิ์
// การเพิ่มสินทรัพย์เกินโควตาผ่าน entitlement) จากนั้น Push แจ้งผู้ใช้ให้ต่ออายุได้
//
// Error Isolation รายคน (Pattern เดียวกับ dcaReminder.job / expireOverduePayments):
// 1 คนพัง (updatePlan/Push ล้มเหลว) ต้องไม่กระทบคนอื่น — Log ต่อรายแล้วไปต่อ
// หมายเหตุ: ลำดับ updatePlan ก่อน Push โดยตั้งใจ — การลดชั้นสิทธิ์คือสิ่งที่ต้อง
// เกิดจริง (Source of Truth = DB) ส่วน Push เป็น Best-effort ถ้า Push พังก็ไม่ Rollback
async function runPlanDowngrade(now = new Date()) {
  let downgraded = 0;
  let expiredUsers = [];

  try {
    expiredUsers = await userRepository.findExpiredPremiumUsers(now);
  } catch (err) {
    // ดึงรายชื่อไม่ได้ = ทำอะไรต่อไม่ได้ทั้งรอบ — Log แล้วจบ (ไม่ throw ให้ Server ล่ม)
    console.error(`[cron:plan-downgrade] failed to load expired premium users: ${err.message}`);
    return 0;
  }

  for (const user of expiredUsers) {
    try {
      await userRepository.updatePlan(user.id, 'free', null);
      downgraded += 1;

      // Push แจ้งผู้ใช้แบบ Best-effort — ล้มเหลวไม่ Rollback การลดชั้น (DB เปลี่ยนแล้ว)
      try {
        if (user.lineUserId) {
          await lineService.pushMessage(user.lineUserId, flexMessage.buildPlanDowngradedMessage());
        }
      } catch (pushErr) {
        console.error(`[cron:plan-downgrade] push to user ${user.id} failed: ${pushErr.message}`);
      }
    } catch (err) {
      // 1 คน Fail ไม่กระทบคนอื่น (Error Isolation)
      console.error(`[cron:plan-downgrade] failed to downgrade user ${user.id}: ${err.message}`);
    }
  }

  console.log(`[cron:plan-downgrade] downgraded ${downgraded} expired premium user(s) to free`);
  return downgraded;
}

function schedulePlanDowngrade() {
  // '0 1 * * *' = ตี 1 ทุกวัน (ความคลาดเคลื่อนระดับวันยอมรับได้ — Grace ผ่าน
  // entitlement.isPremiumActive ตัดสิน Real-time อยู่แล้ว Cron แค่ Sync plan ใน DB)
  return cron.schedule('0 1 * * *', () => runPlanDowngrade());
}

module.exports = {
  schedulePlanDowngrade,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPlanDowngrade,
};
