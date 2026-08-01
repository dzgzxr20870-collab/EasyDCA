const config = require('../config/env');
const entitlement = require('./entitlement.service');
const userRepository = require('../repositories/user.repository');
const paymentRepository = require('../repositories/payment.repository');
const premiumGrantLogRepository = require('../repositories/premiumGrantLog.repository');
const logger = require('../utils/logger.util');

// ═══════════════════════════════════════════════════════════════════════════
// freeTrial.service — ผู้ใช้กดรับ Premium ฟรี 1 เดือนด้วยตัวเอง (แคมเปญชั่วคราว)
// ═══════════════════════════════════════════════════════════════════════════
// ต่างจาก adminGrant.service (Admin กดให้ทีละคน) 3 เรื่องหลัก:
//   1) ผู้ใช้กดเองได้ → ต้องมี Guard เข้มมาก (Admin เชื่อถือได้ ผู้ใช้ทั่วไปไม่ใช่)
//   2) "ครั้งเดียวตลอดชีพ" → ไม่ Stack ไม่ต่ออายุ ไม่มีข้อยกเว้น
//   3) ปิดได้ด้วย Flag โดยไม่ต้อง Deploy Code (แคมเปญชั่วคราว)
//
// ── สิ่งที่ Reuse ทั้งหมด (ไม่เขียน Logic การเงิน/สิทธิ์ใหม่แม้แต่บรรทัดเดียว) ──
//   - entitlement.computeRenewalExpiry  → คำนวณวันหมดอายุ (ตัวเดียวกับ Payment จริง)
//   - entitlement.isPremiumActive       → ตัดสินว่าเป็น Premium อยู่ไหม
//   - userRepository.claimFreeTrial     → Atomic Claim (กัน Race — ดู Comment ที่นั่น)
//   - premiumGrantLogRepository         → Audit Trail (ตารางเดียวกับ Admin Grant)
//   - planDowngrade.job (ไม่ต้องแก้)    → หมดอายุแล้วลดกลับเป็น Free อัตโนมัติ เพราะ
//     Job นั้นอ่าน users.plan_expires_at คอลัมน์เดียวกันเป๊ะกับที่เราเขียน
//
// ── ผลกระทบต่อ /admin/stats (AI_WORK_POLICY § 4.2) ──────────────────────────
//   - totalRevenue / revenueThisMonth: ❌ ไม่กระทบ — นับจาก payments.status='confirmed'
//     เท่านั้น และ Service นี้ "ไม่สร้างแถวใน payments เลย" (เหตุผลเดียวกับ
//     adminGrant.service: แถวปลอมจะทำให้ตัวเลขรายได้เพี้ยน)
//   - premiumUsers / freeUsers: ⚠️ กระทบตามจริง — คนกดรับจะถูกนับเป็น Premium
//     (ถูกต้องตามความหมาย แต่ต้องรู้ว่า "Premium ≠ คนจ่ายเงิน" ในช่วงแคมเปญนี้)

// รอบบิลของ Free Trial — คงที่ 1 เดือนเสมอ ไม่เปิดให้เลือก (ข้อกำหนด "1 เดือนเท่านั้น")
const FREE_TRIAL_BILLING_PERIOD = 'monthly';

// granted_by ของ premium_grant_logs — ตารางนั้นออกแบบให้เก็บ "LINE User ID ของ Admin"
// แต่เคสนี้ไม่มี Admin (ผู้ใช้กดเอง) จึงใส่ Marker คงที่แทน แยกแยะได้ชัดเจนตอนสืบย้อนหลัง
// ว่าแถวไหนมาจากแคมเปญนี้ (ไม่ใช่ Admin คนไหนกดให้)
const GRANTED_BY_SELF_SERVICE = 'self_service_free_trial';

class FreeTrialError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FreeTrialError';
    this.code = code;
    this.details = details;
  }
}

// ── ตรวจสิทธิ์ (อ่านอย่างเดียว ไม่เขียน DB) ────────────────────────────────────
// คืน { eligible: true } หรือ { eligible: false, reason: <CODE> }
//
// ใช้ 2 ที่: (1) GET eligibility ให้ Frontend ตัดสินว่าจะโชว์ Banner ไหม
//            (2) claimFreeTrial เรียกซ้ำก่อน Claim จริง — "ห้าม" เชื่อผลจากข้อ (1)
//               เพราะ Client อาจยิง POST ตรงโดยไม่ผ่าน GET (Backend คือด่านตัดสินจริง)
//
// ⚠️ ลำดับการเช็คมีความหมาย: เรียงจาก "ถูกที่สุด/ไม่แตะ DB" ไปหา "แพงที่สุด" และให้
// เหตุผลที่ผู้ใช้ควบคุมไม่ได้ (Flag ปิด/บัญชีถูกล็อก) มาก่อนเหตุผลเชิงประวัติ
async function checkEligibility(user) {
  // 1) Flag ปิดอยู่ — ไม่แตะ DB เลย (แคมเปญจบแล้ว/ยังไม่เปิด)
  if (!config.payment.freeTrialEnabled) {
    return { eligible: false, reason: 'FEATURE_DISABLED' };
  }

  if (!user) {
    return { eligible: false, reason: 'USER_NOT_FOUND' };
  }

  // 2) บัญชีถูกล็อก หรือถูกลบข้อมูลตาม PDPA แล้ว — ไม่ให้สิทธิ์ใหม่กับบัญชีที่ไม่ Active
  if (user.isLocked || user.anonymizedAt) {
    return { eligible: false, reason: 'ACCOUNT_NOT_ELIGIBLE' };
  }

  // 3) เคยกดรับไปแล้ว — Guard หลัก (ค่าเดียวกับที่ Atomic Claim ใช้) เช็คตรงนี้ด้วย
  //    เพื่อให้ตอบเหตุผลที่ตรงจริงกับผู้ใช้ ไม่ใช่รอให้ Claim Fail แล้วเดาเอา
  if (user.freeTrialClaimedAt) {
    return { eligible: false, reason: 'ALREADY_CLAIMED', claimedAt: user.freeTrialClaimedAt };
  }

  // 4) ตอนนี้เป็น Premium อยู่ (จากทางไหนก็ตาม) — Free Trial มีไว้ให้ "คนที่ยังไม่เคยลอง"
  //    ไม่ใช่ตัวต่ออายุให้คนที่มีอยู่แล้ว (ถ้าปล่อยผ่านจะกลายเป็นแจกฟรีให้ลูกค้าที่จ่ายเงิน)
  if (entitlement.isPremiumActive(user)) {
    return { eligible: false, reason: 'ALREADY_PREMIUM' };
  }

  // 5) เคยจ่ายเงินสำเร็จมาก่อน — ลูกค้าเก่าที่ Premium หมดอายุแล้วต้องต่อผ่าน QR จริง
  //    เท่านั้น ไม่ใช่มากดฟรีต่อ (ข้อกำหนด: "ต้องผ่าน QR จ่ายเงินจริงถ้าจะต่อ")
  const payments = await paymentRepository.findAllByUserId(user.id);
  if (payments.some((p) => p.status === 'confirmed')) {
    return { eligible: false, reason: 'ALREADY_PAID_BEFORE' };
  }

  // 6) เคยได้ Premium ฟรีจาก Admin มาก่อน (Beta Wave 1) — ถือว่า "เคยได้ลองแล้ว"
  //    เช่นกัน ไม่ให้ซ้อนอีกรอบ
  const grants = await premiumGrantLogRepository.findAllByUserId(user.id);
  if (grants.length > 0) {
    return { eligible: false, reason: 'ALREADY_GRANTED_BEFORE' };
  }

  return { eligible: true };
}

// ── กดรับจริง ─────────────────────────────────────────────────────────────────
// โยน FreeTrialError(reason) ถ้าไม่ผ่าน Guard — คืน { user, newExpiry } ถ้าสำเร็จ
async function claimFreeTrial(userId, now = new Date()) {
  const user = await userRepository.findById(userId);

  const eligibility = await checkEligibility(user);
  if (!eligibility.eligible) {
    throw new FreeTrialError(eligibility.reason, `Free trial not available: ${eligibility.reason}`, {
      userId,
    });
  }

  // วันหมดอายุ = now + 1 เดือน เป๊ะ — ส่ง null เป็น currentExpiresAt โดยเจตนา (ไม่ใช่
  // user.planExpiresAt แบบ adminGrant/payment) เพื่อ "ตัด Stacking ทิ้งที่ระดับ Input"
  // ไม่ให้มีทางบวกทบวันเก่าได้เลย แม้ Guard ข้อ 4 (ALREADY_PREMIUM) จะพลาดหลุดมาก็ตาม
  // — Defense in Depth: ข้อกำหนดคือ "1 เดือนเท่านั้น" ไม่มีเงื่อนไขใดที่ควรได้มากกว่านี้
  const newExpiry = entitlement.computeRenewalExpiry(null, FREE_TRIAL_BILLING_PERIOD, now);

  // Atomic Claim — ให้สิทธิ์ + ปั๊มว่าใช้สิทธิ์แล้ว ใน UPDATE เดียว (กันกดรัวพร้อมกัน)
  const updatedUser = await userRepository.claimFreeTrial(userId, newExpiry, now);
  if (!updatedUser) {
    // 0 แถว = มี Request อื่นชิง Claim ไปก่อนเสี้ยววินาที (เช่นกดรัว/เปิดสองแท็บ)
    // ผลลัพธ์ที่ถูกต้องคือ "ได้สิทธิ์ครั้งเดียว" ซึ่งเกิดขึ้นแล้วโดย Request ตัวแรก
    throw new FreeTrialError('ALREADY_CLAIMED', 'Free trial was already claimed', { userId });
  }

  // ── Audit Trail (Best-effort) — เขียน "หลัง" สิทธิ์ถูกให้จริงแล้ว ───────────────
  // Trade-off เดียวกับ adminGrant.service เป๊ะ: ถ้าเขียน Log พลาดหลังผู้ใช้ได้สิทธิ์ไป
  // แล้ว ต้องไม่ตอบ Error (ผู้ใช้จะกดซ้ำแล้วเจอ ALREADY_CLAIMED สับสน ทั้งที่ได้สิทธิ์
  // ไปเรียบร้อย) — Source of Truth ของ "เคยรับแล้วหรือยัง" คือ users.free_trial_claimed_at
  // ที่ถูกเขียนแบบ Atomic ไปแล้ว ไม่ใช่ตาราง Log นี้
  try {
    await premiumGrantLogRepository.create({
      userId: updatedUser.id,
      grantedBy: GRANTED_BY_SELF_SERVICE,
      billingPeriod: FREE_TRIAL_BILLING_PERIOD,
      newExpiresAt: newExpiry,
    });
  } catch (err) {
    logger.error('failed to write premium_grant_logs for free trial', {
      userId: updatedUser.id,
      error: err.message,
    });
  }

  logger.info('free trial claimed', {
    userId: updatedUser.id,
    newExpiry: newExpiry.toISOString(),
  });

  return { user: updatedUser, newExpiry };
}

module.exports = {
  FreeTrialError,
  FREE_TRIAL_BILLING_PERIOD,
  GRANTED_BY_SELF_SERVICE,
  checkEligibility,
  claimFreeTrial,
};
