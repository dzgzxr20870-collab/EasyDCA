const supportRequestRepository = require('../repositories/supportRequest.repository');
const lineService = require('./line.service');
const flexMessage = require('../utils/flexMessage.util');
const config = require('../config/env');

// ═══════════════════════════════════════════════════════════════════════
// supportRequestFlow.service — ติดต่อ Admin/Support (ก่อนเปิด Closed Beta Wave 1)
// ═══════════════════════════════════════════════════════════════════════
// ⚠️ Pivot จาก LINE Chat Inline (พิมพ์ Trigger → ถามข้อความ → รอ Input ใน Session
// — Migration 024) เป็นหน้าเว็บ /support แยกต่างหาก เพราะ Webhook ตอบอัตโนมัติชน
// กับตอน Admin เข้าไปตอบมือใน LINE Chat Mode เดียวกัน (Bot ทับคำตอบของ Admin) —
// LINE Chat ฝั่งเดิมตอนนี้แค่พิมพ์ Trigger แล้วได้ Link ไปหน้าเว็บทันที ไม่มีการรอ
// Input ใน Session อีกต่อไป (ดู Migration 027 ที่ Drop ตาราง Session ทิ้ง)
//
// Flow ปัจจุบัน: ตรวจ Category+ข้อความ → เช็ค Rate Limit (จากตาราง Log จริง ไม่ใช้
// In-memory Map) → Push เข้ากลุ่มแชททีมผ่าน LINE OA "EasyDCA Support" → บันทึก Log
// พร้อมผลนับจริง (adminCount/notifiedCount) → คืนผลให้ Caller (web/LINE) ตอบผู้ใช้ตามจริง
//
// ⚠️ เปลี่ยนปลายทาง Push จาก "Admin แต่ละคนทาง LINE ส่วนตัวผ่าน Bot หลัก"
// (config.payment.adminLineUserIds) เป็น "กลุ่มแชททีม ผ่าน OA แยกต่างหาก
// EasyDCA Support" (config.support) ทั้งหมดแล้ว ตามมติ Founder — ปิดพร้อมกันไม่มี
// Push คู่ขนานไปหา Admin ส่วนตัวอีกต่อไป (Facebook-Like Grant Flow ใน
// support.controller.js ยังคง Push หา Admin ส่วนตัวเหมือนเดิม เป็นคนละ Flow กัน
// ไม่ถูกกระทบ)

const RATE_LIMIT_HOURS = 1;
const MAX_MESSAGE_LENGTH = 500;

// หมวดปัญหา — ตรงกับ Dropdown บนหน้าเว็บ /support (payment.controller/Support.jsx)
const CATEGORIES = ['payment_premium', 'ocr', 'portfolio_ledger', 'other'];

// Error ที่มี code (Pattern เดียวกับ GuidedBuyError/ReminderSetupError — API.md § 5)
// เพื่อให้ Controller (Web/LINE) Map เป็นข้อความไทยได้ ไม่ปล่อย Error ดิบถึงผู้ใช้
class SupportRequestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SupportRequestError';
    this.code = code;
    this.details = details;
  }
}

function rateLimitCutoffIso() {
  return new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();
}

// เช็ค Rate Limit 1 ครั้ง/ชม./User จากตาราง support_requests จริง (ไม่ใช้ In-memory
// Map แบบ slipOcr.service เพราะมีตาราง Log ถาวรอยู่แล้วพอดี ไม่มีปัญหาข้ามรอบ
// Restart/หลาย Instance) — throw ทันทีถ้าเกิน ไม่ผ่านค่อยให้ Caller ทำขั้นถัดไป
async function checkRateLimit(userId) {
  const recent = await supportRequestRepository.findRecentByUser(userId, rateLimitCutoffIso());
  if (recent) {
    throw new SupportRequestError(
      'SUPPORT_REQUEST_RATE_LIMITED',
      'User already sent a support request within the last hour',
      { userId, lastRequestAt: recent.createdAt }
    );
  }
}

// ตรวจข้อความที่ผู้ใช้พิมพ์แจ้ง — คืนข้อความที่ Trim แล้ว หรือ throw
//  - ว่างเปล่า (เผื่อพิมพ์แต่ช่องว่าง) → SUPPORT_REQUEST_EMPTY_MESSAGE
//  - ยาวเกิน MAX_MESSAGE_LENGTH → SUPPORT_REQUEST_MESSAGE_TOO_LONG
function validateMessage(rawMessage) {
  const trimmed = typeof rawMessage === 'string' ? rawMessage.trim() : '';

  if (!trimmed) {
    throw new SupportRequestError('SUPPORT_REQUEST_EMPTY_MESSAGE', 'Message cannot be empty');
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new SupportRequestError(
      'SUPPORT_REQUEST_MESSAGE_TOO_LONG',
      `Message exceeds ${MAX_MESSAGE_LENGTH} characters`,
      { length: trimmed.length, max: MAX_MESSAGE_LENGTH }
    );
  }

  return trimmed;
}

// ตรวจหมวดปัญหา — ต้องเป็นค่าใน CATEGORIES เท่านั้น (Dropdown ฝั่งเว็บส่งมาตรงๆ
// อยู่แล้ว แต่ Backend ต้องไม่เชื่อ Client เสมอ — ค่ามั่ว/ว่าง → throw)
function validateCategory(rawCategory) {
  if (!CATEGORIES.includes(rawCategory)) {
    throw new SupportRequestError('SUPPORT_REQUEST_INVALID_CATEGORY', 'Invalid category', {
      category: rawCategory,
    });
  }
  return rawCategory;
}

// ── Push เข้ากลุ่มแชททีมผ่าน LINE OA "EasyDCA Support" ─────────────────────
// Push การ์ดแจ้งข้อความ Support Request ครั้งเดียวเข้ากลุ่มแชททีม (ไม่ Loop หา Admin
// ทีละคนอีกต่อไป) ด้วย Channel Access Token ของ OA "EasyDCA Support" (คนละตัวกับ
// Bot หลัก — ดู line.service.js § pushMessage accessToken override) — Best-effort
// เหมือนเดิม (Push ไม่ถึงไม่ throw แค่ Log แล้วคืน 0) คืน 1 ถ้า Push สำเร็จ, 0 ถ้า
// ไม่สำเร็จหรือยังไม่ได้ตั้งค่า SUPPORT_LINE_CHANNEL_ACCESS_TOKEN/SUPPORT_LINE_GROUP_ID
// (ค่า Return ยังเป็นตัวเลขเหมือนเดิมเพื่อให้เข้ากับ notifiedCount ที่ recordRequest
// ใช้อยู่ — ไม่ทุบ Signature ของ recordRequest)
async function pushSupportRequestToOaGroup(user, message, category = null) {
  const { lineChannelAccessToken, groupId } = config.support;
  if (!lineChannelAccessToken || !groupId) {
    console.error(
      '[supportRequestFlow] SUPPORT_LINE_CHANNEL_ACCESS_TOKEN/SUPPORT_LINE_GROUP_ID not ' +
        `configured; nobody notified (userId=${user.id})`
    );
    return 0;
  }

  const groupMessage = flexMessage.buildAdminSupportRequestMessage(user, message, new Date(), category);

  try {
    await lineService.pushMessage(groupId, groupMessage, lineChannelAccessToken);
    return 1;
  } catch (pushErr) {
    console.error(`[supportRequestFlow] push to OA group failed: ${pushErr.message}`);
    return 0;
  }
}

// บันทึก Log — เรียก "หลัง" Push เข้ากลุ่มเสร็จแล้วเท่านั้น (ผลนับจริง
// adminCount/notifiedCount ต้องรู้ค่าสุดท้ายก่อน Insert ครั้งเดียว ไม่มี UPDATE ตามมา)
async function recordRequest(userId, message, { adminCount, notifiedCount, category, source }) {
  return supportRequestRepository.create({ userId, message, adminCount, notifiedCount, category, source });
}

module.exports = {
  RATE_LIMIT_HOURS,
  MAX_MESSAGE_LENGTH,
  CATEGORIES,
  SupportRequestError,
  checkRateLimit,
  validateMessage,
  validateCategory,
  pushSupportRequestToOaGroup,
  recordRequest,
};
