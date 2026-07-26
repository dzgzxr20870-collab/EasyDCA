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
// In-memory Map) → Push หา Admin → บันทึก Log พร้อมผลนับจริง (adminCount/
// notifiedCount) → คืนผลให้ Caller (web/LINE) ตอบผู้ใช้ตามจริง

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

// ── Push หา Admin ─────────────────────────────────────────────────────────
// Push การ์ดแจ้งข้อความหา Admin ทุกคนใน ADMIN_LINE_USER_IDS — Pattern เดียวกับ
// pushPaymentRequestToAdmins ใน webhook.controller.js (Best-effort ทีละคน คืน
// จำนวนที่ Push สำเร็จจริง) ย้ายมาอยู่ที่นี่ (เดิมอยู่ใน webhook.controller.js)
// เพื่อให้เรียกได้ทั้งจาก support.controller.js (เว็บ) และ webhook.controller.js
// (LINE — ถ้าจำเป็นต้องใช้อีกในอนาคต) โดยไม่ต้องเขียนซ้ำเป็นชุดที่ 3
async function pushSupportRequestToAdmins(user, message, category = null) {
  const adminIds = config.payment.adminLineUserIds;
  if (adminIds.length === 0) {
    console.error(
      `[supportRequestFlow] no ADMIN_LINE_USER_IDS configured; nobody notified (userId=${user.id})`
    );
    return 0;
  }

  const adminMessage = flexMessage.buildAdminSupportRequestMessage(user, message, new Date(), category);

  const results = await Promise.all(
    adminIds.map((adminId) =>
      lineService
        .pushMessage(adminId, adminMessage)
        .then(() => true)
        .catch((pushErr) => {
          console.error(
            `[supportRequestFlow] push to admin ${adminId} failed: ${pushErr.message}`
          );
          return false;
        })
    )
  );

  return results.filter(Boolean).length;
}

// บันทึก Log — เรียก "หลัง" Push หา Admin เสร็จแล้วเท่านั้น (ผลนับจริง
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
  pushSupportRequestToAdmins,
  recordRequest,
};
