const config = require('../config/env');
const userRepository = require('../repositories/user.repository');
const supportRequestFlow = require('../services/supportRequestFlow.service');

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

module.exports = { submitRequest };
