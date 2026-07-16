const crypto = require('crypto');
const config = require('../config/env');
const entitlement = require('./entitlement.service');
const promptpayQrService = require('./promptpayQr.service');
const paymentRepository = require('../repositories/payment.repository');
const userRepository = require('../repositories/user.repository');
const logger = require('../utils/logger.util');

// Error ที่มี code ตาม Pattern เดิม (TransactionServiceError/ProfitServiceError)
// เพื่อให้ Controller/Postback Map เป็น HTTP Status / ข้อความไทยได้
class PaymentServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PaymentServiceError';
    this.code = code;
    this.details = details;
  }
}

// คำขอหมดอายุใน 24 ชั่วโมง (PROJECT_BRIEF § 10 / รอบ 1 Schema payments.expires_at)
const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;

// Auto-release Safety Valve (migration 016 Lock-Until-Resolved): ถ้าคำขอค้าง
// unresolved (amount_released_at IS NULL) เกิน 7 วันนับจาก created_at โดยไม่มี Admin
// Resolve เลย ปล่อยยอดคืนอัตโนมัติ กันยอดล็อกค้างตลอดไปถ้าผู้ใช้ทิ้ง Flow กลางคัน
const AMOUNT_LOCK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// พยายามจัดสรรเลขสตางค์ซ้ำสูงสุดกี่ครั้งเมื่อชนกัน (Partial Unique Index Reject)
const ALLOCATE_MAX_ATTEMPTS = 3;

// ตรวจว่า Error จากการ insert เป็น Unique Violation หรือไม่ (Partial Unique Index
// amount_thb WHERE amount_released_at IS NULL ชนกัน — migration 016 Lock-Until-
// Resolved, เดิม Scope ตาม status='pending') — เช็คทั้ง code Postgres 23505
// และข้อความ Fallback (เผื่อ Client บาง Path ไม่ส่ง code มา)
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key|unique constraint|already exists/i.test(err.message || '');
}

// เลือกเลขสตางค์ 1-99 ที่ยังไม่ถูกจอง (ไม่มีคำขอที่ยัง unresolved ยอดเดียวกันถืออยู่ —
// migration 016: unresolved = amount_released_at IS NULL ไม่ว่า status จะเป็น
// pending หรือ expired-แต่-ยังไม่ Resolve ก็ตาม เดิมเช็คแค่ status='pending')
// throw SATANG_POOL_EXHAUSTED ถ้าเต็มหมดทั้ง 99 ตัว (แทบไม่เกิดใน MVP แต่กันไว้)
async function allocateSatangTag(baseAmountThb) {
  const reserved = new Set(
    await paymentRepository.findPendingSatangTagsByBaseAmount(baseAmountThb)
  );

  const available = [];
  for (let n = 1; n <= 99; n += 1) {
    if (!reserved.has(n)) available.push(n);
  }

  if (available.length === 0) {
    throw new PaymentServiceError(
      'SATANG_POOL_EXHAUSTED',
      `All satang tags (1-99) for base amount ${baseAmountThb} are currently reserved`,
      { baseAmountThb }
    );
  }

  return available[Math.floor(Math.random() * available.length)];
}

// สร้างคำขอชำระเงิน + QR — จัดสรรเลขสตางค์ให้ยอดไม่ซ้ำกับคำขอ pending อื่น
// (หัวใจที่ทำให้ Admin แมตช์ยอดในบัญชีกลับหาคำขอได้ — DB การันตี Atomic)
async function requestPayment(userId, billingPeriod) {
  if (billingPeriod !== 'monthly' && billingPeriod !== 'yearly') {
    throw new PaymentServiceError(
      'VALIDATION_ERROR',
      `Invalid billingPeriod: ${billingPeriod} (expected 'monthly' or 'yearly')`,
      { billingPeriod }
    );
  }

  // ต้องตั้งค่าบัญชีรับเงินก่อน มิฉะนั้นสร้าง QR ไม่ได้ — Fail เร็วก่อนแตะ DB
  const promptpayId = config.payment.promptpayId;
  if (!promptpayId) {
    throw new PaymentServiceError(
      'PAYMENT_NOT_CONFIGURED',
      'PROMPTPAY_ID is not configured on the server'
    );
  }

  const baseAmountThb =
    billingPeriod === 'monthly'
      ? config.payment.premiumPriceMonthly
      : config.payment.premiumPriceYearly;

  const expiresAt = new Date(Date.now() + PAYMENT_TTL_MS);

  // Race Condition: ระหว่าง allocateSatangTag (อ่านเลขว่าง) กับ insert จริง อาจมี
  // อีก Request แทรกเลขเดียวกันไปก่อน → Partial Unique Index Reject (23505)
  // จึง Retry จัดสรรเลขใหม่ + insert ใหม่ สูงสุด ALLOCATE_MAX_ATTEMPTS ครั้ง
  let lastErr;
  for (let attempt = 1; attempt <= ALLOCATE_MAX_ATTEMPTS; attempt += 1) {
    const satangTag = await allocateSatangTag(baseAmountThb);
    const amountThb = promptpayQrService.composePaymentAmount(baseAmountThb, satangTag);

    try {
      const payment = await paymentRepository.create({
        userId,
        billingPeriod,
        baseAmountThb,
        satangTag,
        amountThb,
        expiresAt,
      });

      const qrPayload = promptpayQrService.buildPromptPayPayload(promptpayId, amountThb);

      return {
        paymentId: payment.id,
        amountThb,
        qrPayload,
        expiresAt,
      };
    } catch (err) {
      // เฉพาะ Unique Violation เท่านั้นที่ Retry ได้ (เลขชนกัน) — Error อื่นโยนต่อ
      if (!isUniqueViolation(err)) {
        throw err;
      }
      lastErr = err;
    }
  }

  throw new PaymentServiceError(
    'ALLOCATION_CONFLICT',
    `Failed to allocate a unique amount after ${ALLOCATE_MAX_ATTEMPTS} attempts`,
    { baseAmountThb, cause: lastErr?.message }
  );
}

// ผู้ใช้แจ้งว่าโอนเงินแล้ว (แนบสลิป/กดยืนยันในเว็บ) — Validate ว่าคำขอมีจริง
// เป็นของผู้ใช้คนนี้ และยัง pending คืน payment ให้ Controller ไปสร้างข้อความ
// Push หา Admin เอง (ไม่ยิง LINE API ที่ Service Layer ตาม Pattern เดิมของโปรเจค)
async function notifyPaymentSubmitted(paymentId, userId) {
  const payment = await paymentRepository.findById(paymentId);

  // ตรวจ user_id ตรงกับผู้ขอ — กันคนอื่นมา notify คำขอที่ไม่ใช่ของตน
  // (ตอบ NOT_FOUND เหมือนกันทั้งกรณีไม่มีจริงและไม่ใช่เจ้าของ กัน Enumerate)
  if (!payment || payment.userId !== userId) {
    throw new PaymentServiceError('PAYMENT_NOT_FOUND', `Payment ${paymentId} not found`, {
      paymentId,
    });
  }

  if (payment.status !== 'pending') {
    throw new PaymentServiceError(
      'PAYMENT_NOT_PENDING',
      `Payment ${paymentId} is ${payment.status}, not pending`,
      { paymentId, status: payment.status }
    );
  }

  // ต้องมีสลิปแนบมาก่อนถึงจะแจ้ง Admin ได้ — ปิดช่องที่ User กด "แจ้งชำระแล้ว" ได้โดย
  // ไม่เคยส่งรูปสลิปมาเลย (เดิมเช็คแค่ status ทำให้ Admin ได้การ์ดที่ไม่มีสลิปให้ตรวจ)
  // อยู่ที่ Service Layer เพื่อให้ครอบคลุมทั้ง 2 ทางเข้า (HTTP notifyPayment กับ LINE
  // Postback notify_payment) ด้วยการแก้จุดเดียว
  if (!payment.slipImageUrl) {
    throw new PaymentServiceError(
      'SLIP_NOT_ATTACHED',
      `Payment ${paymentId} has no slip attached yet`,
      { paymentId }
    );
  }

  return payment;
}

// ดึงคำขอที่ยัง pending ล่าสุดของผู้ใช้ (หรือ null) — ปุ่ม "Premium" ใช้ตัดสินว่า
// มีคำขอค้างอยู่ไหม (จะได้ไม่สร้างซ้อน) ทำเป็น Wrapper บาง ๆ ให้ Controller เรียก
// ผ่าน Service Layer แทนแตะ Repository ตรง (Layering เดียวกับ requestPayment)
async function findPendingByUserId(userId) {
  return paymentRepository.findPendingByUserId(userId);
}

// ผูก URL รูปสลิปเข้ากับคำขอ (Wrapper บาง ๆ ให้ Controller เรียกผ่าน Service Layer
// แทนแตะ Repository ตรง — Layering เดียวกับ findPendingByUserId) ไม่ยิง LINE/Storage
// API ที่ชั้นนี้ (Controller เป็นผู้ดึง Content + อัปโหลดแล้วส่ง URL ที่ได้เข้ามา)
// slipHash (Payment Beta — migration 015) เป็น Optional: Controller คำนวณผ่าน
// hashSlipImage แล้วส่งเข้ามาพร้อมกัน เพื่อบันทึกไว้ตรวจจับการส่งสลิปซ้ำในอนาคต
async function attachSlipImage(paymentId, slipImageUrl, slipHash) {
  return paymentRepository.updateSlipImageUrl(paymentId, slipImageUrl, slipHash);
}

// คำนวณ SHA-256 Hash (Hex) ของรูปสลิป — ใช้ Node built-in crypto (ไม่เพิ่ม Dependency)
// Controller เรียกก่อนอัปโหลดขึ้น Storage เสมอ (ดู webhook.controller.handlePaymentSlipImage)
function hashSlipImage(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ตรวจว่าสลิปนี้ (slip_hash) เคยถูกใช้กับคำขอที่ "อนุมัติแล้ว" (status='confirmed') มา
// ก่อนหรือไม่ — ป้องกัน Fraud Vector: ส่งสลิปโอนเงินจริงใบเดียวมาขอ Premium สองรอบ
// throw SLIP_ALREADY_USED ถ้าพบ ให้ Controller ดักจับแล้วตอบผู้ใช้เป็นข้อความไทย
//
// ⚠️ ตั้งใจ "ไม่" กันการส่งสลิปเดิมซ้ำกับคำขอที่ rejected/expired/pending — คำขอเหล่านี้
// ยังไม่เคยอนุมัติจริง ผู้ใช้ที่ถูก Admin Reject (เช่นยอด/รูปไม่ชัด) ต้องส่งสลิปใบเดิมซ้ำ
// ได้ตามปกติเมื่อกด "Premium" ขอคำขอใหม่ (requestPayment สร้าง Payment Row ใหม่ทุกครั้ง
// ไม่มี Flow "เปิดคำขอเดิมซ้ำ" — ดู payment.repository.findConfirmedBySlipHash)
async function assertSlipNotReused(slipHash) {
  const existing = await paymentRepository.findConfirmedBySlipHash(slipHash);
  if (existing) {
    throw new PaymentServiceError(
      'SLIP_ALREADY_USED',
      'This slip image has already been used for an approved payment',
      { slipHash, existingPaymentId: existing.id }
    );
  }
}

// ดึงคำขอเพื่อ "สร้างรูป QR ซ้ำ" ให้ Endpoint qr.png — ต้องยัง pending เท่านั้น
// throw PAYMENT_NOT_FOUND ทั้งกรณีไม่พบและกรณีสถานะไม่ใช่ pending (Endpoint แปลง
// เป็น 404 เหมือนกัน) — ผู้เรียกต้องใช้ payment.amountThb จากที่นี่ (ค่าใน DB)
// สร้าง QR เท่านั้น ห้ามเชื่อยอดจาก Query String ใด ๆ (กันปลอมยอดในรูป QR)
async function getPendingPaymentForQr(paymentId) {
  const payment = await paymentRepository.findById(paymentId);

  if (!payment || payment.status !== 'pending') {
    throw new PaymentServiceError(
      'PAYMENT_NOT_FOUND',
      `Payment ${paymentId} not found or not pending`,
      { paymentId }
    );
  }

  return payment;
}

// ตรวจว่า LINE User ID ที่กดปุ่มเป็น Admin ที่ได้รับอนุญาต ไม่งั้น throw NOT_AUTHORIZED
function assertAdmin(adminLineUserId) {
  if (!adminLineUserId || !config.payment.adminLineUserIds.includes(adminLineUserId)) {
    throw new PaymentServiceError('NOT_AUTHORIZED', 'You are not authorized to review payments', {
      adminLineUserId,
    });
  }
}

// Admin อนุมัติคำขอ → ต่ออายุ Premium ให้ผู้ใช้ (Stacking ผ่าน entitlement)
// เขียนวันหมดอายุลง users.plan_expires_at เดิม (ผ่าน updatePlan) — ที่เดียวกับที่
// entitlement.isPremiumActive อ่าน (ไม่มีคอลัมน์ผีแยกต่างหาก)
// migration 016 (Lock-Until-Resolved): claimForApproval รับทั้ง status เดิม 'pending'
// และ 'expired' (Admin ยัง Resolve คำขอที่ Cron หมดอายุไปแล้วได้ตามปกติ) และปล่อยยอด
// amount_thb คืน (amount_released_at) ให้คำขอใหม่ใช้เศษสตางค์เดิมซ้ำได้ทันทีในตัว
async function approvePayment(paymentId, adminLineUserId) {
  assertAdmin(adminLineUserId);

  // Atomic Claim — ถ้า null แปลว่ามีคน Resolve ไปก่อนแล้ว (Cron หมดอายุไม่นับ — ยัง
  // Claim ได้ตามปกติ ดู payment.repository.claimForApproval)
  const payment = await paymentRepository.claimForApproval(paymentId, adminLineUserId);
  if (!payment) {
    throw new PaymentServiceError(
      'ALREADY_RESOLVED',
      `Payment ${paymentId} has already been resolved`,
      { paymentId }
    );
  }

  const user = await userRepository.findById(payment.userId);
  if (!user) {
    // แทบเป็นไปไม่ได้ (FK บังคับอยู่) แต่กันไว้ — คำขอถูก Claim เป็น confirmed แล้ว
    throw new PaymentServiceError('USER_NOT_FOUND', `User ${payment.userId} not found`, {
      paymentId,
      userId: payment.userId,
    });
  }

  // Stacking: ต่อจากวันหมดอายุเดิมถ้ายังเหลือ มิฉะนั้นเริ่มจากตอนนี้
  const newExpiry = entitlement.computeRenewalExpiry(user.planExpiresAt, payment.billingPeriod);
  const updatedUser = await userRepository.updatePlan(user.id, 'premium', newExpiry);

  // ธุรกรรมการเงิน — Log ไว้เสมอเพื่อ Traceability (S6 Part B)
  logger.info('payment approved', {
    paymentId,
    adminLineUserId,
    userId: user.id,
    billingPeriod: payment.billingPeriod,
    newExpiry: newExpiry.toISOString(),
  });

  return { payment, user: updatedUser, newExpiry };
}

// Admin ปฏิเสธคำขอ — เหมือน approve แต่ไม่แตะ plan/วันหมดอายุของผู้ใช้
// (ยังคืน user เพื่อให้ Controller Push แจ้งผู้ใช้ว่าถูกปฏิเสธได้) — claimForRejection
// ปล่อยยอดคืน (amount_released_at) เหมือน claimForApproval ทุกประการ
async function rejectPayment(paymentId, adminLineUserId) {
  assertAdmin(adminLineUserId);

  const payment = await paymentRepository.claimForRejection(paymentId, adminLineUserId);
  if (!payment) {
    throw new PaymentServiceError(
      'ALREADY_RESOLVED',
      `Payment ${paymentId} has already been resolved`,
      { paymentId }
    );
  }

  const user = await userRepository.findById(payment.userId);

  // ธุรกรรมการเงิน — Log ไว้เสมอเพื่อ Traceability (S6 Part B)
  logger.info('payment rejected', { paymentId, adminLineUserId, userId: payment.userId });

  return { payment, user };
}

// Cron: ทำเครื่องหมายคำขอ pending ที่หมดอายุทั้งหมดเป็น 'expired'
// Error Isolation รายตัว (เหมือน dcaReminder.job) — 1 ตัว Fail ไม่กระทบตัวอื่น
// คืนจำนวนที่ Mark สำเร็จ
async function expireOverduePayments(now = new Date()) {
  const overdue = await paymentRepository.findExpiredPending(now);

  let expired = 0;
  for (const payment of overdue) {
    try {
      const marked = await paymentRepository.markExpired(payment.id);
      // marked === null แปลว่าถูก Admin จัดการไปก่อนแล้วระหว่าง Loop (ไม่นับ)
      if (marked) expired += 1;
    } catch (err) {
      logger.error('failed to expire payment', { paymentId: payment.id, error: err.message });
    }
  }

  logger.info('expireOverduePayments completed', { expiredCount: expired, totalOverdue: overdue.length });

  return expired;
}

// Cron: Auto-release Safety Valve (migration 016) — ปล่อยยอดคืนของคำขอที่ยัง
// unresolved (amount_released_at IS NULL ไม่ว่า status จะเป็น pending หรือ expired)
// แต่ created_at เก่ากว่า 7 วัน ไม่แตะ status เลย (Reporting ยังโชว์ค่าจริงต่อไป) —
// คำขอที่ Resolve แล้ว (confirmed/rejected) ถูกปล่อยไปแล้วตอน Admin กดปุ่ม จึงไม่ถูก
// Query จับซ้ำ (amount_released_at ไม่ใช่ NULL แล้ว) ไม่มี Error/ไม่มีอะไรให้ทำเพิ่ม
// คืนจำนวนที่ปล่อยยอดคืนสำเร็จ
async function autoReleaseStaleAmounts(now = new Date()) {
  const cutoff = new Date(now.getTime() - AMOUNT_LOCK_MAX_AGE_MS);
  const released = await paymentRepository.releaseStaleAmounts(cutoff.toISOString());

  logger.info('autoReleaseStaleAmounts completed', {
    releasedCount: released.length,
    cutoff: cutoff.toISOString(),
  });

  return released.length;
}

// ประกอบ URL รูป QR ที่ LINE จะ Fetch มาแสดงใน Flex Message (Public Endpoint)
// ใช้ PUBLIC_BASE_URL (config.app.publicBaseUrl) เป็นฐาน — ต้องตั้งค่าบน Railway ให้
// เป็น URL ของ Backend ตัวนี้ก่อนใช้งานจริง (มิฉะนั้นรูปจะโหลดไม่ขึ้น) ย้ายมาจาก
// webhook.controller.js เดิม (เคยมี Copy ซ้ำเฉพาะที่นั่น) เพื่อให้ payment.controller.js
// เรียกใช้ตัวเดียวกันได้ตอนประกอบการ์ด Admin ที่ต้องแนบรูป QR คู่กับสลิป
function buildQrImageUrl(paymentId) {
  const base = config.app.publicBaseUrl;
  if (!base) {
    // Log ให้เห็นชัดเจนตอน Dev/Deploy ที่ลืมตั้งค่า — ยังคืน Path สัมพัทธ์ไว้กัน Crash
    logger.error('PUBLIC_BASE_URL is not configured; QR image will not load in LINE', { paymentId });
  }
  return `${base ?? ''}/api/v1/payment/${paymentId}/qr.png`;
}

module.exports = {
  PaymentServiceError,
  PAYMENT_TTL_MS,
  AMOUNT_LOCK_MAX_AGE_MS,
  allocateSatangTag,
  requestPayment,
  findPendingByUserId,
  attachSlipImage,
  hashSlipImage,
  assertSlipNotReused,
  getPendingPaymentForQr,
  notifyPaymentSubmitted,
  approvePayment,
  rejectPayment,
  expireOverduePayments,
  autoReleaseStaleAmounts,
  buildQrImageUrl,
};
