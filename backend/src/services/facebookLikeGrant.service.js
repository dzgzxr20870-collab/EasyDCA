const config = require('../config/env');
const entitlement = require('./entitlement.service');
const userRepository = require('../repositories/user.repository');
const paymentRepository = require('../repositories/payment.repository');
const premiumGrantLogRepository = require('../repositories/premiumGrantLog.repository');
const requestRepository = require('../repositories/facebookLikeGrantRequest.repository');
const logger = require('../utils/logger.util');

// ═══════════════════════════════════════════════════════════════════════════
// facebookLikeGrant.service — Premium ฟรี 1 เดือน แลกกับการกด Like Facebook Page
// ═══════════════════════════════════════════════════════════════════════════
// Facebook ไม่มี API ให้เช็คว่าใครกด Like Page แล้วบ้าง (ยืนยันแล้ว — ไม่ทำ Integration
// ใดๆ กับ Facebook ทั้งสิ้น) แคมเปญนี้จึงเป็น "ตรวจด้วยตา 100%": ผู้ใช้ส่ง Screenshot
// เป็นหลักฐาน → Admin เปิดดูรูปแล้วกด Approve/Reject เอง
//
// ── ต่างจาก freeTrial.service (แคมเปญพี่น้องกัน) อย่างไร ────────────────────────
//   1) ผู้ใช้ "ขอ" ไม่ใช่ "กดรับ" — มีขั้นตอน Admin ตรวจคั่นกลาง (2 Phase ไม่ใช่ทันที)
//   2) Guard คนละคอลัมน์ (users.facebook_like_granted_at — migration 031) เพราะเป็น
//      คนละแคมเปญ คนที่เคยกด Free Trial ต้องยังขอแคมเปญนี้ได้ (ดูข้อ 5 ด้านล่าง)
//   3) มีตารางคำขอของตัวเอง (facebook_like_grant_requests — migration 032) ที่มี
//      Life Cycle จริง pending → approved/rejected
//
// ── สิ่งที่ Reuse ทั้งหมด (ไม่เขียน Logic การเงิน/สิทธิ์ใหม่แม้แต่บรรทัดเดียว) ──
//   - entitlement.computeRenewalExpiry  → คำนวณวันหมดอายุ (ตัวเดียวกับ Payment จริง)
//   - entitlement.isPremiumActive       → ตัดสินว่าเป็น Premium อยู่ไหม
//   - userRepository.grantFacebookLikePremium → Atomic Grant (กัน Admin กดรัว)
//   - premiumGrantLogRepository         → Audit Trail (ตารางเดียวกับ Admin Grant)
//   - planDowngrade.job (ไม่ต้องแก้)    → หมดอายุแล้วลดกลับเป็น Free อัตโนมัติ
//
// ── ผลกระทบต่อ /admin/stats (AI_WORK_POLICY § 4.2) ──────────────────────────
//   - totalRevenue / revenueThisMonth: ❌ ไม่กระทบ — นับจาก payments.status='confirmed'
//     เท่านั้น และ Service นี้ "ไม่สร้างแถวใน payments เลย" (เหตุผลเดียวกับ
//     adminGrant.service / freeTrial.service: แถวปลอมจะทำให้ตัวเลขรายได้เพี้ยน)
//   - premiumUsers / freeUsers: ⚠️ กระทบตามจริง — คนที่ได้รับอนุมัติถูกนับเป็น Premium
//     (ถูกต้องตามความหมาย แต่ต้องรู้ว่า "Premium ≠ คนจ่ายเงิน" ในช่วงแคมเปญนี้)

// รอบบิลของแคมเปญนี้ — คงที่ 1 เดือนเสมอ เท่ากับ Free Trial (ข้อกำหนด "1 เดือน")
const BILLING_PERIOD = 'monthly';

// granted_by ของ premium_grant_logs — ตารางนั้นออกแบบให้เก็บ "LINE User ID ของ Admin"
// ซึ่งเคสนี้มี Admin จริง (ต่างจาก freeTrial ที่ใช้ Marker คงที่) แต่เราต้องแยกแยะได้ว่า
// แถวไหนมาจากแคมเปญนี้ จึง Prefix ด้วยชื่อแคมเปญแล้วตามด้วย LINE User ID ของ Admin
const GRANTED_BY_PREFIX = 'facebook_like_campaign';

function buildGrantedBy(adminLineUserId) {
  return `${GRANTED_BY_PREFIX}:${adminLineUserId ?? 'unknown'}`;
}

// เพดานความยาวข้อความเสริมที่ผู้ใช้พิมพ์มากับคำขอ (เช่น "Like ด้วยชื่อ FB ว่า ...")
// ตั้งเท่ากับ supportRequestFlow.MAX_MESSAGE_LENGTH เพื่อความสอดคล้องของฟอร์มเดียวกัน
const MAX_MESSAGE_LENGTH = 500;

class FacebookLikeGrantError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FacebookLikeGrantError';
    this.code = code;
    this.details = details;
  }
}

// ── ตรวจสิทธิ์ "ขอ" ได้ไหม (อ่านอย่างเดียว ไม่เขียน DB) ──────────────────────────
// คืน { eligible: true } หรือ { eligible: false, reason: <CODE> }
//
// ใช้ 2 ที่: (1) GET eligibility ให้ Frontend ตัดสินว่าจะโชว์ Category นี้ในฟอร์มไหม
//            (2) submitRequest เรียกซ้ำก่อนสร้างคำขอจริง — "ห้าม" เชื่อผลจากข้อ (1)
//               เพราะ Client อาจยิง POST ตรงโดยไม่ผ่าน GET (Backend คือด่านตัดสินจริง)
//
// ⚠️ ลำดับการเช็คมีความหมาย: เรียงจาก "ถูกที่สุด/ไม่แตะ DB" ไปหา "แพงที่สุด" และให้
// เหตุผลที่ผู้ใช้ควบคุมไม่ได้ (Flag ปิด/บัญชีถูกล็อก) มาก่อนเหตุผลเชิงประวัติ
// (โครงเดียวกับ freeTrial.checkEligibility เพื่อให้อ่านเทียบกันได้ทันที)
async function checkEligibility(user) {
  // 1) Flag ปิดอยู่ — ไม่แตะ DB เลย (แคมเปญจบแล้ว/ยังไม่เปิด)
  if (!config.payment.facebookLikeGrantEnabled) {
    return { eligible: false, reason: 'FEATURE_DISABLED' };
  }

  if (!user) {
    return { eligible: false, reason: 'USER_NOT_FOUND' };
  }

  // 2) บัญชีถูกล็อก หรือถูกลบข้อมูลตาม PDPA แล้ว — ไม่ให้สิทธิ์ใหม่กับบัญชีที่ไม่ Active
  if (user.isLocked || user.anonymizedAt) {
    return { eligible: false, reason: 'ACCOUNT_NOT_ELIGIBLE' };
  }

  // 3) เคยได้สิทธิ์จากแคมเปญนี้ไปแล้ว — Guard หลัก (คอลัมน์เดียวกับที่ Atomic Grant ใช้)
  //    เช็คตรงนี้ด้วยเพื่อให้ตอบเหตุผลที่ตรงจริงกับผู้ใช้ ไม่ใช่รอให้ Grant Fail แล้วเดา
  if (user.facebookLikeGrantedAt) {
    return {
      eligible: false,
      reason: 'ALREADY_GRANTED',
      grantedAt: user.facebookLikeGrantedAt,
    };
  }

  // 4) เคยกดรับ Free Trial ไปแล้ว — กันข้ามแคมเปญ (Cross-campaign Guard)
  //    เจตนา: แจก "1 เดือนฟรีต่อคน" ไม่ใช่ "1 เดือนต่อแคมเปญ" — ถ้าปล่อยผ่านคนหนึ่ง
  //    จะได้ฟรีรวม 2 เดือนจากสองแคมเปญ ซึ่งเกินที่ตั้งใจ
  //
  //    ⚠️ ทิศทางกลับกัน (ได้แคมเปญนี้แล้วจะกด Free Trial ไม่ได้) ทำงานเองอยู่แล้ว
  //    โดยไม่ต้องแก้ freeTrial.service เลย — Guard ข้อ 6 ที่นั่นเช็ค premium_grant_logs
  //    ซึ่งแคมเปญนี้เขียนลงไปด้วย (ดู approveRequest)
  if (user.freeTrialClaimedAt) {
    return { eligible: false, reason: 'ALREADY_USED_FREE_TRIAL' };
  }

  // 5) ตอนนี้เป็น Premium อยู่ (จากทางไหนก็ตาม) — แคมเปญนี้มีไว้ให้ "คนที่ยังไม่ได้ใช้"
  //    ไม่ใช่ตัวต่ออายุให้คนที่มีอยู่แล้ว (ถ้าปล่อยผ่านจะกลายเป็นแจกฟรีให้ลูกค้าที่จ่ายเงิน)
  if (entitlement.isPremiumActive(user)) {
    return { eligible: false, reason: 'ALREADY_PREMIUM' };
  }

  // 6) เคยจ่ายเงินสำเร็จมาก่อน — ลูกค้าเก่าที่ Premium หมดอายุแล้วต้องต่อผ่าน QR จริง
  //    เท่านั้น ไม่ใช่มาขอฟรีต่อ (กฎเดียวกับ Free Trial)
  const payments = await paymentRepository.findAllByUserId(user.id);
  if (payments.some((p) => p.status === 'confirmed')) {
    return { eligible: false, reason: 'ALREADY_PAID_BEFORE' };
  }

  // 7) เคยได้ Premium ฟรีจาก Admin มาก่อน (Beta Wave 1 / แคมเปญอื่น) — ถือว่าเคยได้ลองแล้ว
  const grants = await premiumGrantLogRepository.findAllByUserId(user.id);
  if (grants.length > 0) {
    return { eligible: false, reason: 'ALREADY_GRANTED_BEFORE' };
  }

  // 8) มีคำขอค้างรอ Admin ตรวจอยู่แล้ว — ไม่ให้ส่งซ้ำ (ตรงกับ Partial Unique Index
  //    ที่ระดับ DB) เช็คที่นี่เพื่อ "ตอบเหตุผลที่เข้าใจง่าย" ก่อนไปชน Constraint จริง
  const pending = await requestRepository.findPendingByUserId(user.id);
  if (pending) {
    return { eligible: false, reason: 'REQUEST_ALREADY_PENDING', requestId: pending.id };
  }

  return { eligible: true };
}

// ── ผู้ใช้ส่งคำขอ (แนบ Screenshot แล้ว) ────────────────────────────────────────
// screenshotPath = Path ใน Private Bucket ที่ storage.service อัปโหลดไว้แล้ว
// โยน FacebookLikeGrantError(reason) ถ้าไม่ผ่าน Guard — คืน request ถ้าสำเร็จ
async function submitRequest(userId, screenshotPath, rawMessage = null) {
  if (!screenshotPath) {
    throw new FacebookLikeGrantError('SCREENSHOT_REQUIRED', 'Screenshot is required');
  }

  const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new FacebookLikeGrantError(
      'MESSAGE_TOO_LONG',
      `Message exceeds ${MAX_MESSAGE_LENGTH} characters`,
      { length: message.length, max: MAX_MESSAGE_LENGTH }
    );
  }

  const user = await userRepository.findById(userId);
  const eligibility = await checkEligibility(user);
  if (!eligibility.eligible) {
    throw new FacebookLikeGrantError(
      eligibility.reason,
      `Facebook like grant not available: ${eligibility.reason}`,
      { userId }
    );
  }

  let request;
  try {
    request = await requestRepository.create({
      userId,
      screenshotPath,
      message: message || null,
    });
  } catch (err) {
    // 23505 = unique_violation จาก uniq_facebook_like_pending_per_user — เกิดเมื่อมี
    // Request อื่นชิงสร้างคำขอไปก่อนเสี้ยววินาที (กดรัว/สองแท็บ) ผลลัพธ์ที่ถูกต้องคือ
    // "มีคำขอค้างอยู่แล้ว" ซึ่งเกิดขึ้นจริงแล้วโดย Request ตัวแรก — ห้ามตอบ 500
    if (err.code === '23505') {
      throw new FacebookLikeGrantError(
        'REQUEST_ALREADY_PENDING',
        'User already has a pending request',
        { userId }
      );
    }
    throw err;
  }

  logger.info('facebook like grant request submitted', {
    requestId: request.id,
    userId,
  });

  return request;
}

// ── Admin อนุมัติ → ให้ Premium 1 เดือน ─────────────────────────────────────────
// คืน { request, user, newExpiry } — โยน FacebookLikeGrantError ถ้าไม่สำเร็จ
//
// ลำดับสำคัญ (Claim ก่อน Grant): Claim คำขอแบบ Atomic ก่อนเสมอ เพื่อให้ Admin สองคน
// กดพร้อมกันมีแค่คนเดียวที่ผ่านด่านแรก — ถ้า Grant ก่อนแล้วค่อย Claim จะมีช่วงที่ทั้งคู่
// ผ่าน Grant ไปแล้ว (แม้ Grant เองจะ Atomic อีกชั้นก็ตาม การเรียงแบบนี้ทำให้เหตุผลที่
// ตอบกลับตรงความจริงมากกว่า: "คนอื่น Resolve ไปแล้ว" ไม่ใช่ "ผู้ใช้ได้สิทธิ์ไปแล้ว")
async function approveRequest(requestId, adminLineUserId, now = new Date()) {
  const existing = await requestRepository.findById(requestId);
  if (!existing) {
    throw new FacebookLikeGrantError('REQUEST_NOT_FOUND', `Request ${requestId} not found`, {
      requestId,
    });
  }

  const user = await userRepository.findById(existing.userId);
  if (!user) {
    throw new FacebookLikeGrantError('USER_NOT_FOUND', `User ${existing.userId} not found`, {
      requestId,
      userId: existing.userId,
    });
  }

  // ตรวจสิทธิ์ซ้ำ ณ เวลาที่ Admin กดจริง (ไม่ใช่ตอนผู้ใช้ส่งคำขอ) — สถานะอาจเปลี่ยนไป
  // ระหว่างรอตรวจ เช่นผู้ใช้ไปจ่ายเงินจริง/กด Free Trial ในระหว่างนั้น
  //
  // ⚠️ ยกเว้น REQUEST_ALREADY_PENDING โดยเจตนา: คำขอที่กำลังจะอนุมัตินี้ "คือ" ตัวที่
  // ทำให้ checkEligibility คืนเหตุผลนั้น ถ้าไม่ยกเว้นจะอนุมัติอะไรไม่ได้เลยสักใบ
  const eligibility = await checkEligibility(user);
  if (!eligibility.eligible && eligibility.reason !== 'REQUEST_ALREADY_PENDING') {
    throw new FacebookLikeGrantError(
      eligibility.reason,
      `User no longer eligible at approval time: ${eligibility.reason}`,
      { requestId, userId: user.id }
    );
  }

  // Atomic Claim — pending → approved (กัน Admin สองคนกดพร้อมกัน)
  const claimed = await requestRepository.claimForReview(requestId, {
    status: 'approved',
    reviewedBy: adminLineUserId,
    now,
  });
  if (!claimed) {
    throw new FacebookLikeGrantError(
      'ALREADY_RESOLVED',
      `Request ${requestId} has already been resolved`,
      { requestId }
    );
  }

  // วันหมดอายุ = now + 1 เดือน เป๊ะ — ส่ง null เป็น currentExpiresAt โดยเจตนา (ไม่ใช่
  // user.planExpiresAt แบบ adminGrant/payment) เพื่อ "ตัด Stacking ทิ้งที่ระดับ Input"
  // เหตุผลเดียวกับ freeTrial.service: ข้อกำหนดคือ "1 เดือนเท่านั้น" ไม่มีเงื่อนไขใดที่
  // ควรได้มากกว่านี้ แม้ Guard ข้อ 5 (ALREADY_PREMIUM) จะพลาดหลุดมาก็ตาม
  const newExpiry = entitlement.computeRenewalExpiry(null, BILLING_PERIOD, now);

  // Atomic Grant — ให้สิทธิ์ + ปั๊มว่าใช้สิทธิ์แคมเปญนี้แล้ว ใน UPDATE เดียว
  const updatedUser = await userRepository.grantFacebookLikePremium(user.id, newExpiry, now);
  if (!updatedUser) {
    // 0 แถว = คอลัมน์ Guard ไม่ NULL แล้ว (เคยได้สิทธิ์แคมเปญนี้ไปแล้ว) — Backstop
    // ชั้นสุดท้ายที่ไม่ควรถึงในทางปฏิบัติ (checkEligibility ข้อ 3 ดักไปแล้ว) แต่ถ้าถึง
    // แปลว่ามี Race ที่หลุดมาจริง ต้องไม่ให้สิทธิ์ซ้ำเด็ดขาด
    throw new FacebookLikeGrantError(
      'ALREADY_GRANTED',
      `User ${user.id} already received this campaign grant`,
      { requestId, userId: user.id }
    );
  }

  // ── Audit Trail (Best-effort) — เขียน "หลัง" สิทธิ์ถูกให้จริงแล้ว ───────────────
  // Trade-off เดียวกับ adminGrant.service / freeTrial.service เป๊ะ: ถ้าเขียน Log พลาด
  // หลังผู้ใช้ได้สิทธิ์ไปแล้ว ต้องไม่ตอบ Error (Admin จะกดซ้ำแล้วเจอ ALREADY_GRANTED
  // สับสน ทั้งที่ผู้ใช้ได้สิทธิ์ไปเรียบร้อย) — Source of Truth ของสิทธิ์คือ
  // users.plan_expires_at + facebook_like_granted_at ที่เขียนแบบ Atomic ไปแล้ว
  //
  // ⚠️ แถวนี้ยังทำหน้าที่เป็น Cross-campaign Guard ให้ freeTrial.service (Guard ข้อ 6
  // ที่นั่นเช็ค premium_grant_logs) — ถ้าเขียนพลาด ผู้ใช้อาจกด Free Trial ได้อีก 1 เดือน
  // จึง Log ระดับ error ให้เห็นชัด ไม่ใช่ warn
  try {
    await premiumGrantLogRepository.create({
      userId: updatedUser.id,
      grantedBy: buildGrantedBy(adminLineUserId),
      billingPeriod: BILLING_PERIOD,
      newExpiresAt: newExpiry,
    });
  } catch (err) {
    logger.error('failed to write premium_grant_logs for facebook like grant', {
      userId: updatedUser.id,
      requestId,
      error: err.message,
    });
  }

  logger.info('facebook like grant approved', {
    requestId,
    userId: updatedUser.id,
    adminLineUserId,
    newExpiry: newExpiry.toISOString(),
  });

  return { request: claimed, user: updatedUser, newExpiry };
}

// ── Admin ปฏิเสธ — ไม่แตะ plan/สิทธิ์ของผู้ใช้เลย ────────────────────────────────
// ผู้ใช้ส่งคำขอใหม่ได้ทันทีหลังถูกปฏิเสธ (Partial Unique Index ครอบเฉพาะ pending)
async function rejectRequest(requestId, adminLineUserId, rejectReason = null, now = new Date()) {
  const claimed = await requestRepository.claimForReview(requestId, {
    status: 'rejected',
    reviewedBy: adminLineUserId,
    rejectReason,
    now,
  });

  if (!claimed) {
    // แยกไม่ออกระหว่าง "ไม่มีคำขอนี้" กับ "ถูก Resolve ไปแล้ว" จาก Claim อย่างเดียว
    // จึงอ่านซ้ำเพื่อตอบเหตุผลให้ตรง (ไม่ใช่ Hot Path — Admin กดทีละใบ)
    const existing = await requestRepository.findById(requestId);
    if (!existing) {
      throw new FacebookLikeGrantError('REQUEST_NOT_FOUND', `Request ${requestId} not found`, {
        requestId,
      });
    }
    throw new FacebookLikeGrantError(
      'ALREADY_RESOLVED',
      `Request ${requestId} has already been resolved`,
      { requestId }
    );
  }

  logger.info('facebook like grant rejected', {
    requestId,
    userId: claimed.userId,
    adminLineUserId,
  });

  return { request: claimed };
}

module.exports = {
  FacebookLikeGrantError,
  BILLING_PERIOD,
  GRANTED_BY_PREFIX,
  MAX_MESSAGE_LENGTH,
  checkEligibility,
  submitRequest,
  approveRequest,
  rejectRequest,
};
