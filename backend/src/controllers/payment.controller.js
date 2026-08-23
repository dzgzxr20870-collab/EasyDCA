const config = require('../config/env');
const paymentService = require('../services/payment.service');
const freeTrialService = require('../services/freeTrial.service');
const promptpayQrService = require('../services/promptpayQr.service');
const qrImageService = require('../services/qrImage.service');
const storageService = require('../services/storage.service');
const userRepository = require('../repositories/user.repository');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');
const { buildExternalUrl } = require('../utils/externalUrl.util');

// Map PaymentServiceError.code → HTTP Status (Pattern เดียวกับ dashboard.controller
// ที่ Map ProfitServiceError → 404) code ที่ไม่อยู่ในตารางถือเป็น 500 INTERNAL_ERROR
const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  PAYMENT_NOT_CONFIGURED: 503,
  SATANG_POOL_EXHAUSTED: 409,
  ALLOCATION_CONFLICT: 409,
  // มีคำขอค้างอยู่แล้ว (F1) — requestPayment จัดการเองแบบเจาะจงเพื่อแนบคำขอเดิมกลับไป
  // ด้วย ตัวนี้เป็น Fallback เผื่อมี Path อื่นมาใช้ handlePaymentError ในอนาคต
  PENDING_PAYMENT_EXISTS: 409,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_NOT_PENDING: 409,
  SLIP_NOT_ATTACHED: 409,
  NOT_AUTHORIZED: 403,
  // Web slip upload (Feature 3) — สลิปซ้ำ/ชนิดไฟล์ผิด/ใหญ่เกิน
  SLIP_ALREADY_USED: 409,
  INVALID_SLIP_CONTENT_TYPE: 415,
  SLIP_TOO_LARGE: 413,
  EMPTY_BODY: 400,
};

function handlePaymentError(res, err, context) {
  // รับทั้ง PaymentServiceError และ StorageServiceError (Web slip upload) — Map ผ่าน
  // code เดียวกัน (STATUS_BY_CODE ครอบทั้งสองชุด) code ที่ไม่รู้จัก → 500 เสมอ
  const isKnownServiceError =
    err instanceof paymentService.PaymentServiceError ||
    (err && err.name === 'StorageServiceError');

  if (isKnownServiceError) {
    const status = STATUS_BY_CODE[err.code];
    if (status) {
      // PAYMENT_NOT_PENDING เท่านั้นที่ต้องส่ง status ต่อให้ Frontend เลือกข้อความ
      // ตาม approved/rejected/reviewing/expired (บั๊ค "ถูกดำเนินการไปแล้ว" ไม่บอก
      // ว่าอนุมัติหรือถูกปฏิเสธ) — payment.service.js แนบ err.details = { paymentId,
      // status } มาอยู่แล้วตอน throw (notifyPaymentSubmitted/
      // assertPaymentClaimableByUser) ที่นี่แค่ส่งต่อ ไม่มี Query/Logic ใหม่ · Code
      // อื่นไม่แตะ (คง Response Shape เดิม `{ error }` เป๊ะ กันพัง Test/Contract เดิม)
      if (err.code === 'PAYMENT_NOT_PENDING' && err.details?.status) {
        return res.status(status).json({ error: err.code, details: { status: err.details.status } });
      }
      return res.status(status).json({ error: err.code });
    }
  }

  console.error(`[payment] ${context} failed: ${err.message}`);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// POST /api/v1/payment/request — Body: { billingPeriod } (requireAuth)
// สร้างคำขอ + QR คืนยอดที่ต้องโอน (พร้อมเศษสตางค์เฉพาะ) ให้ Frontend สร้าง QR แสดง
async function requestPayment(req, res) {
  try {
    const result = await paymentService.requestPayment(req.user.id, req.body?.billingPeriod);
    return res.status(200).json(result);
  } catch (err) {
    // ── มีคำขอค้างอยู่แล้ว (F1) → 409 พร้อม "คำขอเดิม" ครบชุด ─────────────────
    // ตอบแค่ { error } เฉยๆ ไม่พอ: ผู้ใช้จะค้างอยู่หน้าเดิมโดยไม่รู้ว่าต้องทำอะไรต่อ
    // ทั้งที่คำขอที่ค้างอยู่เป็นของตัวเอง — ส่ง Payload รูปแบบเดียวกับตอนสำเร็จ (200)
    // กลับไปด้วย เพื่อให้ Frontend พาไปหน้าจ่ายเงินใบเดิมได้ทันที (UX เดียวกับฝั่ง
    // LINE ที่ premium_menu ส่ง QR ของคำขอเดิมซ้ำแทนการขึ้น Error)
    if (
      err instanceof paymentService.PaymentServiceError &&
      err.code === 'PENDING_PAYMENT_EXISTS'
    ) {
      const { paymentId, amountThb, qrPayload, expiresAt, billingPeriod } = err.details ?? {};
      return res.status(409).json({
        error: err.code,
        payment: { paymentId, amountThb, qrPayload, expiresAt, billingPeriod },
      });
    }

    return handlePaymentError(res, err, 'requestPayment');
  }
}

// POST /api/v1/payment/:id/notify — (requireAuth) ผู้ใช้แจ้งว่าโอนแล้ว
// → Validate ผ่าน service แล้ว Push แจ้ง Admin ทุกคนใน config.payment.adminLineUserIds
async function notifyPayment(req, res) {
  let payment;
  try {
    payment = await paymentService.notifyPaymentSubmitted(req.params.id, req.user.id);
  } catch (err) {
    return handlePaymentError(res, err, 'notifyPayment');
  }

  // ดึงชื่อผู้ใช้เพื่อแสดงในข้อความหา Admin (req.user จาก JWT มีแค่ id/lineUserId)
  let displayName = null;
  try {
    const owner = await userRepository.findById(req.user.id);
    displayName = owner?.displayName ?? null;
  } catch (err) {
    // ดึงชื่อไม่ได้ไม่ใช่เรื่องคอขวด — แจ้ง Admin ต่อได้ด้วยชื่อว่าง
    console.error(`[payment] notifyPayment: failed to load display name: ${err.message}`);
  }

  const adminIds = config.payment.adminLineUserIds;
  if (adminIds.length === 0) {
    // ไม่มี Admin ตั้งค่าไว้ — คำขอถูกบันทึกแล้วแต่จะไม่มีใครได้รับแจ้ง (ต้องตั้ง
    // ADMIN_LINE_USER_IDS) Log ไว้ให้เห็นชัด แต่ยังตอบ 200 (คำขอสร้างสำเร็จจริง)
    console.error('[payment] notifyPayment: no ADMIN_LINE_USER_IDS configured; nobody notified');
    return res.status(200).json({ status: 'notified' });
  }

  // ⚠️ F4: payment.slipImageUrl ที่มาจาก DB เป็น "Storage path" แล้ว (Bucket Private)
  // ต้องเซ็นเป็น Signed URL อายุ 5 นาทีก่อนแนบเป็น Hero ของการ์ด — เซ็นไม่สำเร็จก็ยัง
  // Push ต่อได้ (การ์ดแค่ไม่มีรูป ซึ่งดีกว่าไม่แจ้ง Admin เลย) เพราะฟังก์ชันคืน null
  const adminMessage = flexMessage.buildAdminPaymentRequestMessage(
    { ...payment, slipImageUrl: await storageService.createPaymentSlipSignedUrl(payment.slipImageUrl) },
    displayName,
    paymentService.buildQrImageUrl(payment.id)
  );
  // Push ราย Admin แบบ Best-effort — 1 คนล้มเหลว (บล็อกบอท ฯลฯ) ไม่กระทบคนอื่น
  // และไม่ทำให้ Endpoint ตอบ Error (คำขอถูกบันทึกแล้ว)
  await Promise.all(
    adminIds.map((adminId) =>
      lineService.pushMessage(adminId, adminMessage).catch((err) => {
        console.error(`[payment] notifyPayment: push to admin ${adminId} failed: ${err.message}`);
      })
    )
  );

  return res.status(200).json({ status: 'notified' });
}

// POST /api/v1/payment/:id/slip — (requireAuth) เว็บอัปโหลดรูปสลิปแนบคำขอ
// Body เป็น Binary รูปภาพดิบ (express.raw ที่ Route — req.body เป็น Buffer,
// Content-Type ของ Request = ชนิดรูปจริง) มิเรอร์ Flow LINE (handlePaymentSlipImage)
// ทุกขั้น: ตรวจ Ownership+pending → hash → assertSlipNotReused → upload → attach
// ต่างจาก LINE แค่ "ทางเข้ารูป" (HTTP Binary แทน LINE Content API) Service/Storage
// เดียวกันเป๊ะ (ห้ามสร้าง Logic คู่ขนาน) จากนั้นผู้ใช้ค่อยกด "แจ้งชำระแล้ว" (notify)
async function uploadSlip(req, res) {
  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: 'EMPTY_BODY' });
  }
  const contentType = req.get('content-type');

  try {
    // 1) คำขอต้องเป็นของผู้ใช้คนนี้ + ยัง pending (กันแนบสลิปคำขอคนอื่น/ที่ Resolve แล้ว)
    await paymentService.assertPaymentClaimableByUser(req.params.id, req.user.id);

    // 2) กันสลิปโอนเงินใบเดียวถูกใช้ซ้ำกับคำขอที่อนุมัติแล้ว (Fraud Vector) — เหมือน LINE
    const slipHash = paymentService.hashSlipImage(buffer);
    await paymentService.assertSlipNotReused(slipHash);

    // 3) Upload (Validate MIME/ขนาดในตัว) แล้วผูก path+hash เข้าคำขอ (Service เดียวกับ LINE)
    // ⚠️ F4: uploadPaymentSlip คืน "Storage path" แล้ว (Bucket Private) — path คือสิ่งที่
    // เก็บลง DB ส่วนที่ตอบกลับ Frontend ต้องเป็น Signed URL อายุสั้น เพื่อให้ผู้ใช้เห็น
    // Preview รูปที่เพิ่งอัปโหลดของตัวเองได้ตามเดิม (ห้ามตอบ path ดิบกลับไป — Frontend
    // เอาไปแสดงเป็น <img src> ตรงๆ ไม่ได้ และ path ไม่มีความหมายนอกฝั่ง Backend)
    const slipPath = await storageService.uploadPaymentSlip(req.params.id, buffer, contentType);
    await paymentService.attachSlipImage(req.params.id, req.user.id, slipPath, slipHash);

    const slipImageUrl = await storageService.createPaymentSlipSignedUrl(slipPath);
    return res.status(200).json({ status: 'slip_attached', slipImageUrl });
  } catch (err) {
    return handlePaymentError(res, err, 'uploadSlip');
  }
}

// GET /api/v1/payment/:id/qr.png — (ไม่ต้อง requireAuth: LINE ต้อง Fetch รูปได้
// โดยไม่มี Header พิเศษ, ความเสี่ยงต่ำเพราะ QR เข้ารหัสแค่บัญชีรับเงิน+ยอด ไม่มี
// ข้อมูลส่วนตัว) — Render รูป QR PNG จากยอดที่เก็บใน DB เท่านั้น
//
// ⚠️ ความปลอดภัย: ห้ามเชื่อ Query Param ยอดเงินใด ๆ (เช่น ?amount=) เด็ดขาด —
// ดึง payment จาก DB ด้วย :id แล้วใช้ payment.amountThb จริงประกอบ Payload
// (กันคนแก้ URL ให้ QR โชว์ยอดอื่น) ถ้าไม่พบ/สถานะไม่ใช่ pending → 404
async function getPaymentQr(req, res) {
  let payment;
  try {
    payment = await paymentService.getPendingPaymentForQr(req.params.id);
  } catch (err) {
    if (
      err instanceof paymentService.PaymentServiceError &&
      err.code === 'PAYMENT_NOT_FOUND'
    ) {
      return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
    }
    console.error(`[payment] getPaymentQr failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }

  const promptpayId = config.payment.promptpayId;
  if (!promptpayId) {
    return res.status(503).json({ error: 'PAYMENT_NOT_CONFIGURED' });
  }

  try {
    // ยอดมาจาก DB (payment.amountThb) เท่านั้น — ไม่แตะ req.query
    const qrPayload = promptpayQrService.buildPromptPayPayload(promptpayId, payment.amountThb);
    const pngBuffer = await qrImageService.renderPng(qrPayload);

    res.set('Content-Type', 'image/png');
    // ห้าม Cache ที่ Proxy/Browser — ยอดผูกกับคำขอเฉพาะราย ไม่ควรถูกใช้ซ้ำข้ามคำขอ
    res.set('Cache-Control', 'no-store');
    return res.status(200).send(pngBuffer);
  } catch (err) {
    console.error(`[payment] getPaymentQr render failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Self-service Free Trial — ผู้ใช้กดรับ Premium ฟรี 1 เดือนเอง (แคมเปญชั่วคราว)
// ═══════════════════════════════════════════════════════════════════════════
// อยู่ใน payment.controller เพราะเป็น "อีกทางหนึ่งของการได้ Premium" คู่กับการซื้อ
// ผ่าน QR (Frontend หน้า /premium เรียกทั้งสองอย่างจาก Route Prefix เดียวกัน) —
// ตรรกะ Guard/สิทธิ์ทั้งหมดอยู่ใน freeTrial.service ไฟล์นี้ทำแค่ Map HTTP

// ข้อความไทยต่อเหตุผลที่กดรับไม่ได้ — Frontend แสดงตรงๆ ได้ (ไม่โชว์ Code ดิบ)
const FREE_TRIAL_MESSAGES = {
  FEATURE_DISABLED: 'แคมเปญรับ Premium ฟรีปิดรับแล้วในขณะนี้',
  ACCOUNT_NOT_ELIGIBLE: 'บัญชีนี้ไม่สามารถรับสิทธิ์นี้ได้',
  ALREADY_CLAIMED: 'คุณใช้สิทธิ์รับ Premium ฟรีไปแล้ว (ใช้ได้ครั้งเดียวเท่านั้น)',
  ALREADY_PREMIUM: 'คุณเป็นสมาชิก Premium อยู่แล้ว',
  ALREADY_PAID_BEFORE: 'สิทธิ์นี้สำหรับผู้ที่ยังไม่เคยเป็นสมาชิก Premium เท่านั้น — ต่ออายุได้ผ่านการชำระเงินตามปกติ',
  ALREADY_GRANTED_BEFORE: 'คุณเคยได้รับสิทธิ์ Premium ฟรีไปแล้ว',
  USER_NOT_FOUND: 'ไม่พบบัญชีผู้ใช้',
};

// เหตุผลที่ "ผู้ใช้แก้เองไม่ได้" → 403 (สิทธิ์ไม่พอ) ตาม API.md § 5-6
// USER_NOT_FOUND เป็น 404 ตามความหมายจริง
const FREE_TRIAL_STATUS_BY_CODE = {
  FEATURE_DISABLED: 403,
  ACCOUNT_NOT_ELIGIBLE: 403,
  ALREADY_CLAIMED: 403,
  ALREADY_PREMIUM: 403,
  ALREADY_PAID_BEFORE: 403,
  ALREADY_GRANTED_BEFORE: 403,
  USER_NOT_FOUND: 404,
};

// GET /api/v1/payment/free-trial — เช็คว่ากดรับได้ไหม (Frontend ใช้ตัดสินว่าโชว์ Banner)
//
// ตอบ 200 เสมอแม้กดไม่ได้ (ไม่ใช่ Error — เป็นการ "ถามสถานะ") พร้อม reason ให้
// Frontend เลือกข้อความ/ซ่อน Banner ได้เอง
//
// ⚠️ แยกจาก GET /dashboard/me โดยเจตนา: การตรวจสิทธิ์ต้อง Query payments +
// premium_grant_logs เพิ่ม ซึ่ง /dashboard/me เป็น Hot Path ที่โหลดทุกครั้งที่เปิด
// Dashboard — ไม่ควรแบกน้ำหนักของหน้า /premium ที่เข้านานๆ ครั้ง
async function getFreeTrialStatus(req, res) {
  try {
    const user = await userRepository.findById(req.user.id);
    const result = await freeTrialService.checkEligibility(user);

    return res.status(200).json({
      // enabled = แคมเปญยังเปิดอยู่ไหม (แยกจาก eligible เพื่อให้ Frontend ซ่อน Banner
      // ทั้งก้อนตอนแคมเปญปิด แทนที่จะโชว์ปุ่มที่กดแล้วขึ้น Error)
      enabled: config.payment.freeTrialEnabled,
      eligible: result.eligible,
      reason: result.reason ?? null,
      message: result.reason ? (FREE_TRIAL_MESSAGES[result.reason] ?? null) : null,
      claimedAt: result.claimedAt ?? user?.freeTrialClaimedAt ?? null,
    });
  } catch (err) {
    console.error(`[payment] getFreeTrialStatus failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// POST /api/v1/payment/free-trial/claim — กดรับจริง (Body ว่าง)
//
// userId มาจาก JWT (req.user.id) เท่านั้น ไม่เคยรับจาก Body — กันกดรับแทนคนอื่น
async function claimFreeTrial(req, res) {
  try {
    const { user, newExpiry } = await freeTrialService.claimFreeTrial(req.user.id);

    // Push แจ้งผู้ใช้แบบ Best-effort (Pattern เดียวกับ webhook.controller
    // approve_payment) — สิทธิ์ถูกให้แล้วจริง (Source of Truth คือ DB) ถ้า Push พัง
    // ห้ามทำให้ Endpoint ตอบ Error เพราะผู้ใช้จะเข้าใจผิดว่ากดรับไม่สำเร็จทั้งที่ได้แล้ว
    try {
      if (user.lineUserId) {
        await lineService.pushMessage(
          user.lineUserId,
          flexMessage.buildFreeTrialClaimedMessage(
            user.freeTrialClaimedAt,
            newExpiry,
            buildExternalUrl('/premium')
          )
        );
      }
    } catch (pushErr) {
      console.error(`[payment] claimFreeTrial: push to user failed: ${pushErr.message}`);
    }

    return res.status(200).json({
      status: 'claimed',
      plan: user.plan,
      planExpiresAt: newExpiry.toISOString(),
      message: 'รับ Premium ฟรี 1 เดือนเรียบร้อยแล้ว',
    });
  } catch (err) {
    if (err instanceof freeTrialService.FreeTrialError) {
      const status = FREE_TRIAL_STATUS_BY_CODE[err.code] ?? 500;
      return res.status(status).json({
        error: err.code,
        message: FREE_TRIAL_MESSAGES[err.code] ?? 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
      });
    }

    console.error(`[payment] claimFreeTrial failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = {
  requestPayment,
  notifyPayment,
  getPaymentQr,
  uploadSlip,
  getFreeTrialStatus,
  claimFreeTrial,
};
