const cron = require('node-cron');
const userRepository = require('../repositories/user.repository');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');
const logger = require('../utils/logger.util');
const { buildExternalUrl } = require('../utils/externalUrl.util');

// ═══════════════════════════════════════════════════════════════════════════
// premiumExpiryReminder.job — Push เตือนก่อน Premium หมดอายุ (ชวนต่ออายุ)
// ═══════════════════════════════════════════════════════════════════════════
// เดิมระบบมีแต่ Push "หลัง" หมดอายุแล้ว (planDowngrade.job — สายเกินจะต่อทัน) Job นี้
// เติมช่องว่างนั้น: เตือนล่วงหน้า REMINDER_DAYS_BEFORE วัน พร้อมปุ่มไปหน้า /premium
//
// ใช้กับ Premium "ทุกคน" เท่ากัน ไม่ว่าจะได้มาจากทางไหน (จ่ายเงินจริง / Admin Grant /
// Self-service Free Trial) เพราะกรองจาก users.plan + plan_expires_at ซึ่งเป็นคอลัมน์
// เดียวที่ทุก Path เขียนลงไป — ไม่มี Path ไหนถูกลืม
//
// ── กันส่งซ้ำ (Idempotency) ────────────────────────────────────────────────────
// Job รันทุกวัน และเงื่อนไข "เหลือ ≤ 3 วัน" เป็นจริงติดกัน 3 วันรวด ถ้าไม่มีตัวจำจะ
// สแปมผู้ใช้ 3 ใบ — users.expiry_reminder_sent_at (migration 030) ถูกปั๊มหลังส่งสำเร็จ
// และ Query กรอง IS NULL ออกไปแล้ว จึงส่งได้ใบเดียวต่อรอบบิล
//
// เมื่อผู้ใช้ต่ออายุ คอลัมน์นี้ถูก Reset เป็น null ที่ userRepository.updatePlan
// (Choke Point เดียวของการเขียน plan) → รอบบิลถัดไปเตือนได้อีกตามปกติ
//
// ── AI_WORK_POLICY § 4.4 (Cron) ────────────────────────────────────────────────
//   - Error Isolation รายคน: 1 คนพัง (Push/DB) ต้องไม่หยุดทั้ง Batch
//   - Structured Log ผ่าน logger.util (ไม่ใช้ console.log ดิบ)
//   - ไม่ Hardcode จำนวน Job (worker.js Derive จาก Object.keys เองอยู่แล้ว)

// เตือนล่วงหน้ากี่วันก่อนหมดอายุ — 3 วันให้เวลาพอสมควรที่จะโอนเงิน/แนบสลิป และรอ
// Admin อนุมัติทัน (Payment Flow นี้เป็น Manual Approval ไม่ใช่ตัดบัตรอัตโนมัติ)
const REMINDER_DAYS_BEFORE = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// จำนวนวันที่เหลือแบบ "ปัดขึ้น" — ผู้ใช้ที่เหลือ 2.3 วันควรเห็น "อีก 3 วัน" ไม่ใช่
// "อีก 2 วัน" (ปัดลงจะทำให้คนที่เหลือไม่ถึงวันเห็น "อีก 0 วัน" ซึ่งอ่านแล้วงง)
function daysLeftUntil(expiresAt, now) {
  const diffMs = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(1, Math.ceil(diffMs / MS_PER_DAY));
}

async function runPremiumExpiryReminder(now = new Date()) {
  const cutoff = new Date(now.getTime() + REMINDER_DAYS_BEFORE * MS_PER_DAY);

  let dueUsers = [];
  try {
    dueUsers = await userRepository.findPremiumExpiringBefore(cutoff, now);
  } catch (err) {
    // ดึงรายชื่อไม่ได้ = ทำอะไรต่อไม่ได้ทั้งรอบ — Log แล้วจบ (ไม่ throw ให้ Worker ล่ม)
    logger.error('premium expiry reminder: failed to load due users', { error: err.message });
    return 0;
  }

  // ประกอบ URL ครั้งเดียวใช้ทั้ง Batch (ค่าคงที่ต่อรอบ ไม่ต้องคำนวณซ้ำต่อคน)
  // null ได้ถ้ายังไม่ได้ตั้ง FRONTEND_URL → การ์ดจะไม่มีปุ่ม แต่ยังเตือนได้ (ดีกว่าไม่เตือน)
  const premiumUrl = buildExternalUrl('/premium');
  if (!premiumUrl) {
    logger.warn('premium expiry reminder: FRONTEND_URL not configured; sending without CTA button');
  }

  let sent = 0;
  for (const user of dueUsers) {
    try {
      // ไม่มี lineUserId (บัญชีถูก Anonymize ตาม PDPA) → ข้ามไปเงียบๆ ไม่นับว่าพัง
      if (!user.lineUserId) continue;

      const daysLeft = daysLeftUntil(user.planExpiresAt, now);
      await lineService.pushMessage(
        user.lineUserId,
        flexMessage.buildPremiumExpiringSoonMessage(daysLeft, user.planExpiresAt, premiumUrl)
      );

      // ปั๊ม "หลัง" Push สำเร็จเท่านั้น — ถ้าปั๊มก่อนแล้ว Push พัง ผู้ใช้จะไม่ได้รับการ
      // เตือนเลยทั้งรอบบิล (แย่กว่าเสี่ยงเตือนซ้ำ 1 ใบในกรณีที่ปั๊มพังหลัง Push สำเร็จ)
      await userRepository.markExpiryReminderSent(user.id, now);
      sent += 1;
    } catch (err) {
      // 1 คน Fail ไม่กระทบคนอื่น (Error Isolation) — ไม่ปั๊ม sent_at จึงถูกหยิบมา
      // ลองใหม่ในรอบพรุ่งนี้เอง ตราบใดที่ยังไม่หมดอายุ
      logger.error('premium expiry reminder: failed for user', {
        userId: user.id,
        error: err.message,
      });
    }
  }

  logger.info('premium expiry reminder finished', {
    due: dueUsers.length,
    sent,
    daysBefore: REMINDER_DAYS_BEFORE,
  });
  return sent;
}

function schedulePremiumExpiryReminder() {
  // '0 2 * * *' = ตี 2 ทุกวัน — หลัง planDowngrade (ตี 1) เพื่อให้คนที่ "หมดอายุแล้ว"
  // ถูกลดชั้นเป็น Free ไปก่อน จะได้ไม่ถูกหยิบมาเตือนซ้ำโดยไม่จำเป็น (Query กรอง
  // plan='premium' + ยังไม่หมดอายุอยู่แล้ว — ลำดับนี้เป็นการกันซ้อนอีกชั้น)
  return cron.schedule('0 2 * * *', () => runPremiumExpiryReminder());
}

module.exports = {
  schedulePremiumExpiryReminder,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPremiumExpiryReminder,
  REMINDER_DAYS_BEFORE,
};
