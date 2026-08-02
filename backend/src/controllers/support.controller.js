const config = require('../config/env');
const userRepository = require('../repositories/user.repository');
const supportRequestFlow = require('../services/supportRequestFlow.service');
const facebookLikeGrantService = require('../services/facebookLikeGrant.service');
const storageService = require('../services/storage.service');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');
const { buildExternalUrl } = require('../utils/externalUrl.util');

// ═══════════════════════════════════════════════════════════════════════
// support.controller — หน้าเว็บ /support (ก่อนเปิด Closed Beta Wave 1)
// ═══════════════════════════════════════════════════════════════════════
// แทนที่ Flow LINE Chat เดิม (พิมพ์ Trigger → ถามข้อความในแชทตรงๆ) เพราะ Webhook
// ตอบอัตโนมัติชนกับตอน Admin เข้าไปตอบมือใน LINE Chat Mode เดียวกัน (Bot ทับคำตอบ
// ของ Admin) — LINE Chat ฝั่งเดิมตอนนี้แค่ตอบ Link มาที่หน้านี้ (ดู
// webhook.controller.js case COMMANDS.CONTACT_SUPPORT)

const STATUS_BY_CODE = {
  SUPPORT_REQUEST_RATE_LIMITED: 429,
  SUPPORT_REQUEST_EMPTY_MESSAGE: 400,
  SUPPORT_REQUEST_MESSAGE_TOO_LONG: 400,
  SUPPORT_REQUEST_INVALID_CATEGORY: 400,
};

function handleSupportError(res, err, context) {
  if (err instanceof supportRequestFlow.SupportRequestError) {
    const status = STATUS_BY_CODE[err.code] ?? 400;
    return res.status(status).json({ error: err.code });
  }

  console.error(`[support] ${context} failed: ${err.message}`);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// POST /api/v1/support/request — Body: { category, message } (requireAuth + requireConsent)
// ตรวจ Category+ข้อความ+Rate Limit ก่อนเสมอ (ไม่ Push ถ้าไม่ผ่าน) → Push หา Admin
// (Best-effort) → บันทึก Log ด้วยผลนับจริง (Best-effort — ไม่ Block Response ถ้า
// Log ล้มเหลว เพราะ Push ถึง Admin คือ Action หลักที่เกิดขึ้นจริงแล้ว) → ตอบผู้ใช้
// ตามผล Push จริง (notified: true/false) ห้ามตอบ true ถ้า Push ไม่ถึง Admin สักคน
async function submitRequest(req, res) {
  let category;
  let message;
  try {
    category = supportRequestFlow.validateCategory(req.body?.category);
    message = supportRequestFlow.validateMessage(req.body?.message);
    await supportRequestFlow.checkRateLimit(req.user.id);
  } catch (err) {
    return handleSupportError(res, err, 'submitRequest');
  }

  // ดึงชื่อผู้ใช้เพื่อแสดงในข้อความหา Admin (req.user จาก JWT มีแค่ id/lineUserId
  // — Pattern เดียวกับ payment.controller.notifyPayment)
  let displayName = null;
  try {
    const owner = await userRepository.findById(req.user.id);
    displayName = owner?.displayName ?? null;
  } catch (err) {
    console.error(`[support] submitRequest: failed to load display name: ${err.message}`);
  }

  const notifiedCount = await supportRequestFlow.pushSupportRequestToAdmins(
    { id: req.user.id, lineUserId: req.user.lineUserId, displayName },
    message,
    category
  );

  // Best-effort — เขียนไม่สำเร็จไม่ควร Block Response (Push ถึง Admin สำเร็จไปแล้ว)
  // แต่ต้อง Log ให้ชัดว่ากระทบ Rate Limit ด้วย เพราะ checkRateLimit เช็คจากตาราง
  // เดียวกันนี้ (findRecentByUser) — ไม่ใช่แค่ "ประวัติหาย" เฉยๆ
  try {
    await supportRequestFlow.recordRequest(req.user.id, message, {
      adminCount: config.payment.adminLineUserIds.length,
      notifiedCount,
      category,
      source: 'web',
    });
  } catch (err) {
    console.error(
      `[support] submitRequest: log failed — Rate Limit (1 ครั้ง/ชม.) จะไม่มีผลกับ ` +
        `user ${req.user.id} จนกว่าจะมีคำขอถัดไปที่ Log สำเร็จ (Push ถึง Admin สำเร็จแล้ว ` +
        `ไม่กระทบ): ${err.message}`
    );
  }

  return res.status(200).json({ notified: notifiedCount > 0 });
}

// ═══════════════════════════════════════════════════════════════════════
// แคมเปญ Premium ฟรี 1 เดือน แลกกด Like Facebook Page (ตรวจมือโดย Admin)
// ═══════════════════════════════════════════════════════════════════════
// อยู่ใน support.controller เพราะผู้ใช้ส่งคำขอผ่าน "ฟอร์มเดียวกัน" กับหน้า /support
// (เลือก Category ใหม่ในฟอร์มเดิม ไม่มีหน้าใหม่แยก) — แต่ข้อมูลลงคนละตารางกับ
// support_requests โดยสิ้นเชิง (คนละ Life Cycle — ดู migration 032)
//
// ตรรกะ Guard/สิทธิ์ทั้งหมดอยู่ใน facebookLikeGrant.service ไฟล์นี้ทำแค่ Map HTTP

// ข้อความไทยต่อเหตุผลที่ขอไม่ได้ — Frontend แสดงตรงๆ ได้ (ไม่โชว์ Code ดิบ)
const FB_LIKE_MESSAGES = {
  FEATURE_DISABLED: 'แคมเปญรับ Premium ฟรีจากการกดไลก์เพจปิดรับแล้วในขณะนี้',
  ACCOUNT_NOT_ELIGIBLE: 'บัญชีนี้ไม่สามารถรับสิทธิ์นี้ได้',
  ALREADY_GRANTED: 'คุณได้รับสิทธิ์จากแคมเปญนี้ไปแล้ว (ใช้ได้ครั้งเดียวเท่านั้น)',
  ALREADY_USED_FREE_TRIAL: 'คุณเคยใช้สิทธิ์ Premium ฟรี 1 เดือนไปแล้ว จึงไม่สามารถรับซ้ำจากแคมเปญนี้ได้',
  ALREADY_PREMIUM: 'คุณเป็นสมาชิก Premium อยู่แล้ว',
  ALREADY_PAID_BEFORE: 'สิทธิ์นี้สำหรับผู้ที่ยังไม่เคยเป็นสมาชิก Premium เท่านั้น — ต่ออายุได้ผ่านการชำระเงินตามปกติ',
  ALREADY_GRANTED_BEFORE: 'คุณเคยได้รับสิทธิ์ Premium ฟรีไปแล้ว',
  REQUEST_ALREADY_PENDING: 'คุณส่งคำขอไปแล้ว ทีมงานกำลังตรวจสอบอยู่ กรุณารอผลก่อนส่งใหม่',
  USER_NOT_FOUND: 'ไม่พบบัญชีผู้ใช้',
  SCREENSHOT_REQUIRED: 'กรุณาแนบรูป Screenshot ที่แสดงว่ากดไลก์เพจแล้ว',
  MESSAGE_TOO_LONG: `ข้อความยาวเกินไป (จำกัด ${facebookLikeGrantService.MAX_MESSAGE_LENGTH} ตัวอักษร)`,
  INVALID_SLIP_CONTENT_TYPE: 'ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น',
  SLIP_TOO_LARGE: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)',
  EMPTY_BODY: 'ไม่พบไฟล์รูป กรุณาเลือกรูปใหม่',
};

// เหตุผลที่ "ผู้ใช้แก้เองไม่ได้" → 403 (Pattern เดียวกับ Free Trial ใน payment.controller)
const FB_LIKE_STATUS_BY_CODE = {
  FEATURE_DISABLED: 403,
  ACCOUNT_NOT_ELIGIBLE: 403,
  ALREADY_GRANTED: 403,
  ALREADY_USED_FREE_TRIAL: 403,
  ALREADY_PREMIUM: 403,
  ALREADY_PAID_BEFORE: 403,
  ALREADY_GRANTED_BEFORE: 403,
  ALREADY_GRANTED_BEFORE_CAMPAIGN: 403,
  // ส่งซ้ำทั้งที่มีคำขอค้าง = ขัดสถานะปัจจุบัน (ไม่ใช่สิทธิ์ไม่พอ) → 409 ตาม API.md
  REQUEST_ALREADY_PENDING: 409,
  USER_NOT_FOUND: 404,
  SCREENSHOT_REQUIRED: 400,
  MESSAGE_TOO_LONG: 400,
};

function handleFbLikeError(res, err, context) {
  if (err instanceof facebookLikeGrantService.FacebookLikeGrantError) {
    const status = FB_LIKE_STATUS_BY_CODE[err.code] ?? 500;
    if (status !== 500) {
      return res.status(status).json({
        error: err.code,
        message: FB_LIKE_MESSAGES[err.code] ?? 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
      });
    }
  }
  // StorageServiceError (MIME/ขนาดไฟล์) — Map ผ่านตารางข้อความเดียวกัน
  if (err && err.name === 'StorageServiceError' && FB_LIKE_MESSAGES[err.code]) {
    const status = err.code === 'SLIP_TOO_LARGE' ? 413 : 415;
    return res.status(status).json({ error: err.code, message: FB_LIKE_MESSAGES[err.code] });
  }

  console.error(`[support] ${context} failed: ${err.message}`);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// GET /api/v1/support/facebook-like — เช็คว่าขอได้ไหม (Frontend ใช้ตัดสินว่าจะโชว์
// Category นี้ในฟอร์มไหม) — ตอบ 200 เสมอแม้ขอไม่ได้ (เป็นการ "ถามสถานะ" ไม่ใช่ Error)
async function getFacebookLikeStatus(req, res) {
  try {
    const user = await userRepository.findById(req.user.id);
    const result = await facebookLikeGrantService.checkEligibility(user);

    return res.status(200).json({
      // enabled = แคมเปญยังเปิดอยู่ไหม (แยกจาก eligible เพื่อให้ Frontend ซ่อน Category
      // ทั้งตัวเลือกตอนแคมเปญปิด แทนที่จะโชว์ตัวเลือกที่เลือกแล้วขึ้น Error)
      enabled: config.payment.facebookLikeGrantEnabled,
      eligible: result.eligible,
      reason: result.reason ?? null,
      message: result.reason ? (FB_LIKE_MESSAGES[result.reason] ?? null) : null,
      pendingRequestId: result.requestId ?? null,
    });
  } catch (err) {
    console.error(`[support] getFacebookLikeStatus failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// POST /api/v1/support/facebook-like/screenshot — อัปโหลดรูปหลักฐาน (Binary ดิบ)
// คืน { screenshotPath } ให้ Frontend ส่งกลับมาพร้อมคำขอในขั้นถัดไป
//
// ⚠️ แยกเป็น 2 ขั้น (อัปโหลดรูป → ส่งคำขอ) เพราะโปรเจกต์นี้ไม่มี multipart parser
// (ไม่มี multer) — ส่งรูป+ข้อความในคำขอเดียวไม่ได้ Pattern เดียวกับ Payment Slip
// (POST /payment/:id/slip แยกจาก /notify) อัปโหลดรูป "ก่อน" สร้างแถวโดยเจตนา เพื่อ
// ไม่ให้เหลือแถว pending ที่ไม่มีรูป (ไฟล์ Orphan ยอมรับได้ — PDPA Erasure กวาดด้วย
// Prefix userId อยู่แล้ว ดู deleteAllFacebookLikeProofsForUser)
async function uploadFacebookLikeScreenshot(req, res) {
  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: 'EMPTY_BODY', message: FB_LIKE_MESSAGES.EMPTY_BODY });
  }

  try {
    // ตรวจสิทธิ์ "ก่อน" อัปโหลดขึ้น Storage — กันคนที่ขอไม่ได้อยู่แล้ว (เคยได้สิทธิ์/
    // แคมเปญปิด) ยิงรูปขึ้นถังจนเปลืองพื้นที่โดยเปล่าประโยชน์
    const user = await userRepository.findById(req.user.id);
    const eligibility = await facebookLikeGrantService.checkEligibility(user);
    if (!eligibility.eligible) {
      const status = FB_LIKE_STATUS_BY_CODE[eligibility.reason] ?? 403;
      return res.status(status).json({
        error: eligibility.reason,
        message: FB_LIKE_MESSAGES[eligibility.reason] ?? null,
      });
    }

    const screenshotPath = await storageService.uploadFacebookLikeProof(
      req.user.id,
      buffer,
      req.get('content-type')
    );

    return res.status(200).json({ status: 'uploaded', screenshotPath });
  } catch (err) {
    return handleFbLikeError(res, err, 'uploadFacebookLikeScreenshot');
  }
}

// POST /api/v1/support/facebook-like — Body: { screenshotPath, message? }
// สร้างคำขอจริง (status='pending') แล้ว Push แจ้ง Admin ทุกคน
//
// userId มาจาก JWT เท่านั้น ไม่เคยรับจาก Body — กันส่งคำขอแทนคนอื่น
async function submitFacebookLikeRequest(req, res) {
  let request;
  try {
    // ⚠️ ตรวจว่า screenshotPath เป็นของผู้ใช้คนนี้จริง — Client ส่ง path อะไรมาก็ได้
    // ถ้าไม่ตรวจจะแนบรูปของคนอื่น (ที่เดาชื่อไฟล์ได้) มาเป็นหลักฐานของตัวเองได้
    // ชื่อไฟล์ถูกกำหนดเป็น "{userId}-{timestamp}.{ext}" เสมอ (uploadFacebookLikeProof)
    const screenshotPath = req.body?.screenshotPath;
    if (typeof screenshotPath !== 'string' || !screenshotPath.startsWith(`${req.user.id}-`)) {
      return res.status(400).json({
        error: 'SCREENSHOT_REQUIRED',
        message: FB_LIKE_MESSAGES.SCREENSHOT_REQUIRED,
      });
    }

    request = await facebookLikeGrantService.submitRequest(
      req.user.id,
      screenshotPath,
      req.body?.message ?? null
    );
  } catch (err) {
    return handleFbLikeError(res, err, 'submitFacebookLikeRequest');
  }

  // ── Push แจ้ง Admin (Best-effort) — คำขอถูกบันทึกแล้ว ห้ามตอบ Error ถ้า Push พัง ──
  let displayName = null;
  try {
    const owner = await userRepository.findById(req.user.id);
    displayName = owner?.displayName ?? null;
  } catch (err) {
    console.error(`[support] submitFacebookLikeRequest: failed to load display name: ${err.message}`);
  }

  const adminIds = config.payment.adminLineUserIds;
  let notifiedCount = 0;
  if (adminIds.length === 0) {
    console.error(
      '[support] submitFacebookLikeRequest: no ADMIN_LINE_USER_IDS configured; nobody notified'
    );
  } else {
    const adminMessage = flexMessage.buildAdminFacebookLikeRequestMessage(
      { displayName, lineUserId: req.user.lineUserId },
      request.message,
      new Date(),
      buildExternalUrl('/admin')
    );
    const results = await Promise.all(
      adminIds.map((adminId) =>
        lineService
          .pushMessage(adminId, adminMessage)
          .then(() => true)
          .catch((pushErr) => {
            console.error(
              `[support] submitFacebookLikeRequest: push to admin ${adminId} failed: ${pushErr.message}`
            );
            return false;
          })
      )
    );
    notifiedCount = results.filter(Boolean).length;
  }

  return res.status(200).json({
    status: 'submitted',
    requestId: request.id,
    notified: notifiedCount > 0,
    message: 'ส่งคำขอเรียบร้อยแล้ว ทีมงานจะตรวจสอบและแจ้งผลทาง LINE ครับ',
  });
}

module.exports = {
  submitRequest,
  getFacebookLikeStatus,
  uploadFacebookLikeScreenshot,
  submitFacebookLikeRequest,
};
