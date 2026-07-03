const config = require('../config/env');
const paymentService = require('../services/payment.service');
const userRepository = require('../repositories/user.repository');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');

// Map PaymentServiceError.code → HTTP Status (Pattern เดียวกับ dashboard.controller
// ที่ Map ProfitServiceError → 404) code ที่ไม่อยู่ในตารางถือเป็น 500 INTERNAL_ERROR
const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  PAYMENT_NOT_CONFIGURED: 503,
  SATANG_POOL_EXHAUSTED: 409,
  ALLOCATION_CONFLICT: 409,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_NOT_PENDING: 409,
  NOT_AUTHORIZED: 403,
};

function handlePaymentError(res, err, context) {
  if (err instanceof paymentService.PaymentServiceError) {
    const status = STATUS_BY_CODE[err.code];
    if (status) {
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

  const adminMessage = flexMessage.buildAdminPaymentRequestMessage(payment, displayName);
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

module.exports = { requestPayment, notifyPayment };
