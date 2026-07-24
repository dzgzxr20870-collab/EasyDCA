const entitlement = require('./entitlement.service');
const userRepository = require('../repositories/user.repository');
const premiumGrantLogRepository = require('../repositories/premiumGrantLog.repository');
const logger = require('../utils/logger.util');

// ═══════════════════════════════════════════════════════════════════════════
// adminGrant.service — Admin กด "ให้ Premium ฟรี" ให้ผู้ใช้ตรงๆ (Business Model Beta)
// ═══════════════════════════════════════════════════════════════════════════
// สำหรับ Beta Wave 1 (5 คน) — ให้ Premium ฟรีโดย "ไม่ผ่าน Payment Flow จริง" (ไม่มี
// เงินเข้า ไม่ใช่การจ่าย) จึง "ห้าม" สร้างแถวใน payments ที่มี amount_thb/confirmed_at
// เพราะ GET /api/v1/admin/stats นับรายได้จาก payments status='confirmed' — แถวปลอมจะ
// ทำให้ตัวเลขรายได้เพี้ยน วิธีที่ถูกคือ Update users.plan/plan_expires_at ตรงๆ (ที่เดียว
// กับที่ entitlement.isPremiumActive อ่าน) แล้วบันทึกร่องรอยไว้ที่ premium_grant_logs
//
// Stacking: Reuse entitlement.computeRenewalExpiry เดียวกับที่ payment.approvePayment
// ใช้ตอน Admin อนุมัติ Payment จริง (ต่อจากวันหมดอายุเดิมถ้ายังเหลือ ไม่งั้นเริ่มจาก now)
// — ห้ามเขียน Stacking Logic คู่ขนานใหม่
//
// หมดอายุแล้ว: planDowngrade.job เดิมจับ Case นี้ได้เองอัตโนมัติ (เช็ค plan_expires_at
// คอลัมน์เดียวกัน) ไม่ต้องแก้ Job

class AdminGrantError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdminGrantError';
    this.code = code;
    this.details = details;
  }
}

// Grant Premium ให้ผู้ใช้ 1 รอบบิล (monthly/yearly) — grantedBy = LINE User ID ของ
// Admin (Audit) คืน { user, newExpiry } ให้ Controller ตอบกลับ
async function grantPremium(userId, billingPeriod, grantedBy) {
  if (billingPeriod !== 'monthly' && billingPeriod !== 'yearly') {
    throw new AdminGrantError(
      'VALIDATION_ERROR',
      `Invalid billingPeriod: ${billingPeriod} (expected 'monthly' or 'yearly')`,
      { billingPeriod }
    );
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    throw new AdminGrantError('USER_NOT_FOUND', `User ${userId} not found`, { userId });
  }

  // Stacking เดียวกับ payment จริง — ต่อจากวันหมดอายุเดิมถ้ายังเหลือ ไม่งั้นเริ่มจาก now
  // ── Action หลัก: อัพเกรด Plan จริง (เขียน users.plan_expires_at ตรงๆ) ──────────
  const newExpiry = entitlement.computeRenewalExpiry(user.planExpiresAt, billingPeriod);
  const updatedUser = await userRepository.updatePlan(user.id, 'premium', newExpiry);

  // ── Audit Trail (Best-effort) — เขียน "หลัง" Action หลักสำเร็จ ────────────────
  // ⚠️ Trade-off ที่ตั้งใจ (Pattern เดียวกับ broadcast.service เขียน broadcast_logs):
  // updatePlan กับ premium_grant_logs.create เป็น DB Call แยกกัน "ไม่มี Transaction
  // ครอบ" (Supabase JS Client ไม่รองรับ Multi-statement Transaction — ทั้งโปรเจกต์ไม่มี
  // RPC/Transaction เลย แม้แต่ payment.approvePayment ก็เขียน claim+updatePlan แยกกัน)
  // ถ้าเขียน Log พลาด "หลังจากที่ User ได้ Premium จริงไปแล้ว" ต้อง "ไม่" ทำให้ทั้ง
  // Request กลายเป็น 500 — เพราะ Grant สำเร็จจริง (Plan อัพเกรดแล้ว) การตอบ 500 จะหลอก
  // Admin ว่าล้มเหลวทั้งหมดแล้วกดซ้ำ กลายเป็น Stacking ซ้อนเกินตั้งใจ (บั๊กหนักกว่า Log หาย)
  // จึง try/catch แล้ว console.error ไว้สืบย้อนหลัง — ยอมให้ Log ขาดเป็นครั้งคราวดีกว่า
  // (Audit เป็นข้อมูลรอง — Source of Truth ของสิทธิ์คือ users.plan_expires_at อยู่แล้ว)
  try {
    await premiumGrantLogRepository.create({
      userId: user.id,
      grantedBy,
      billingPeriod,
      newExpiresAt: newExpiry,
    });
  } catch (err) {
    console.error(`[adminGrant] failed to write premium_grant_logs: ${err.message}`);
  }

  // ธุรกรรมสิทธิ์ — Log ไว้เสมอเพื่อ Traceability (คู่กับตาราง Audit; ตัวนี้ไม่แตะ DB
  // จึงไม่มีทางล้มเหลวแบบ Partial — เป็น Backstop ถ้าตาราง Audit เขียนพลาด)
  logger.info('premium granted by admin', {
    userId: user.id,
    grantedBy,
    billingPeriod,
    newExpiry: newExpiry.toISOString(),
  });

  return { user: updatedUser, newExpiry };
}

module.exports = { AdminGrantError, grantPremium };
