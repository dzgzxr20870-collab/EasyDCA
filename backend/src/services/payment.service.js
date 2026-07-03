const config = require('../config/env');
const entitlement = require('./entitlement.service');
const promptpayQrService = require('./promptpayQr.service');
const paymentRepository = require('../repositories/payment.repository');
const userRepository = require('../repositories/user.repository');

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

// พยายามจัดสรรเลขสตางค์ซ้ำสูงสุดกี่ครั้งเมื่อชนกัน (Partial Unique Index Reject)
const ALLOCATE_MAX_ATTEMPTS = 3;

// ตรวจว่า Error จากการ insert เป็น Unique Violation หรือไม่ (Partial Unique
// Index amount_thb WHERE status='pending' ชนกัน) — เช็คทั้ง code Postgres 23505
// และข้อความ Fallback (เผื่อ Client บาง Path ไม่ส่ง code มา)
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key|unique constraint|already exists/i.test(err.message || '');
}

// เลือกเลขสตางค์ 1-99 ที่ยังไม่ถูกจอง (ไม่มีคำขอ pending ยอดเดียวกันถืออยู่)
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
async function approvePayment(paymentId, adminLineUserId) {
  assertAdmin(adminLineUserId);

  // Atomic Claim — ถ้า null แปลว่ามีคน (หรือ Cron หมดอายุ) จัดการไปก่อนแล้ว
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

  return { payment, user: updatedUser, newExpiry };
}

// Admin ปฏิเสธคำขอ — เหมือน approve แต่ไม่แตะ plan/วันหมดอายุของผู้ใช้
// (ยังคืน user เพื่อให้ Controller Push แจ้งผู้ใช้ว่าถูกปฏิเสธได้)
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
      console.error(`[payment] failed to expire payment ${payment.id}: ${err.message}`);
    }
  }

  return expired;
}

module.exports = {
  PaymentServiceError,
  PAYMENT_TTL_MS,
  allocateSatangTag,
  requestPayment,
  notifyPaymentSubmitted,
  approvePayment,
  rejectPayment,
  expireOverduePayments,
};
