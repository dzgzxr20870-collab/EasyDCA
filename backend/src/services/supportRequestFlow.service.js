const sessionRepository = require('../repositories/supportRequestSession.repository');
const supportRequestRepository = require('../repositories/supportRequest.repository');

// ═══════════════════════════════════════════════════════════════════════
// supportRequestFlow.service — ติดต่อ Admin/Support ฉุกเฉินผ่าน LINE Chat
// (ก่อนเปิด Closed Beta Wave 1)
// ═══════════════════════════════════════════════════════════════════════
// Flow เดียว ขั้นตอนเดียว (ต่างจาก Guided Buy/Reminder Setup ที่มีหลายขั้น):
// พิมพ์ Trigger ("ติดต่อแอดมิน" ฯลฯ) → startFlow (เช็ค Rate Limit + สร้าง Session)
// → พิมพ์ข้อความถัดไป → validateMessage → (Controller Push หา Admin + เรียก
// recordRequest) → cancelFlow (ลบ Session ทิ้ง จบ Flow)
//
// ⚠️ Service นี้ "ไม่รู้จัก LINE/Flex Message" เลย — Push หา Admin เป็นหน้าที่ของ
// webhook.controller.js (Pattern เดียวกับ pushPaymentRequestToAdmins ที่ Push การ์ด
// คำขอชำระเงินหา Admin) เพราะ Service Layer ในโปรเจกต์นี้ไม่ Build Flex Message เอง
// (ดู healthAlert.service/broadcast.service ที่ Push แค่ Text ธรรมดา ไม่ใช่ Flex)

const RATE_LIMIT_HOURS = 1;
const SESSION_TTL_MINUTES = 5;
const MAX_MESSAGE_LENGTH = 500;

// Retention สำหรับ Cron Purge — ค่าเดียวกับ Flow อื่นทั้งหมดในระบบ
const PURGE_RETENTION_MINUTES = 60;

// Error ที่มี code (Pattern เดียวกับ GuidedBuyError/ReminderSetupError — API.md § 5)
// เพื่อให้ Controller Map เป็นข้อความไทยได้ ไม่ปล่อย Error ดิบถึงผู้ใช้
class SupportRequestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SupportRequestError';
    this.code = code;
    this.details = details;
  }
}

function ttlCutoffIso() {
  return new Date(Date.now() - SESSION_TTL_MINUTES * 60 * 1000).toISOString();
}

function rateLimitCutoffIso() {
  return new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();
}

// คืน Session ปัจจุบันที่ "ยังไม่หมดอายุ" หรือ null (หมดอายุ/ไม่มี ให้ผลเหมือนกัน)
async function getCurrentSession(userId) {
  return sessionRepository.findValidByUser(userId, ttlCutoffIso());
}

// เริ่ม Flow — เช็ค Rate Limit ก่อนเสมอ (1 ครั้ง/ชม./User) ไม่ผ่าน throw ทันที
// โดย "ยังไม่สร้าง Session" (กันผู้ใช้เสียเวลาพิมพ์ข้อความยาวๆ แล้วโดนบล็อกทีหลัง)
//
// ⚠️ ไม่เช็ค Session ของ Flow อื่นค้างอยู่ไหม (ต่างจาก guidedBuyFlow.findBlockingSession)
// โดยตั้งใจ — นี่คือช่องทางฉุกเฉิน ไม่ควรถูกกันด้วยการที่ผู้ใช้เผลอค้าง Flow อื่นไว้
// ครึ่งทาง Session เดิมจะไม่ถูกลบ แค่ถูกข้ามความสำคัญไปชั่วคราว (ดู routeText)
async function startFlow(userId) {
  const recent = await supportRequestRepository.findRecentByUser(userId, rateLimitCutoffIso());
  if (recent) {
    throw new SupportRequestError(
      'SUPPORT_REQUEST_RATE_LIMITED',
      'User already sent a support request within the last hour',
      { userId, lastRequestAt: recent.createdAt }
    );
  }

  await sessionRepository.upsert(userId);
}

// ตรวจข้อความที่ผู้ใช้พิมพ์แจ้ง — คืนข้อความที่ Trim แล้ว หรือ throw
//  - ว่างเปล่า (เผื่อพิมพ์แต่ช่องว่าง) → SUPPORT_REQUEST_EMPTY_MESSAGE
//  - ยาวเกิน MAX_MESSAGE_LENGTH → SUPPORT_REQUEST_MESSAGE_TOO_LONG
// ทั้งคู่ "ไม่ลบ Session" (ให้พิมพ์ใหม่ได้ในขั้นเดิม — Pattern เดียวกับ
// reminderSetupFlow.handleAmountEntered ตอน INVALID_AMOUNT)
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

// บันทึก Log — เรียก "หลัง" Controller Push หา Admin เสร็จแล้วเท่านั้น (ผลนับจริง
// adminCount/notifiedCount ต้องรู้ค่าสุดท้ายก่อน Insert ครั้งเดียว ไม่มี UPDATE ตามมา)
async function recordRequest(userId, message, { adminCount, notifiedCount }) {
  return supportRequestRepository.create({ userId, message, adminCount, notifiedCount });
}

// ลบ Session ทิ้งกลางทาง (ผู้ใช้กดปุ่มยกเลิก / จบ Flow สำเร็จ) — Idempotent
async function cancelFlow(userId) {
  await sessionRepository.deleteByUser(userId);
}

// ── สำหรับ Cron (supportRequestCleanup.job.js) ────────────────────────────
async function purgeStaleSessions(retentionMinutes = PURGE_RETENTION_MINUTES) {
  const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000).toISOString();
  return sessionRepository.purgeStaleBefore(cutoff);
}

module.exports = {
  RATE_LIMIT_HOURS,
  SESSION_TTL_MINUTES,
  MAX_MESSAGE_LENGTH,
  PURGE_RETENTION_MINUTES,
  SupportRequestError,
  getCurrentSession,
  startFlow,
  validateMessage,
  recordRequest,
  cancelFlow,
  purgeStaleSessions,
};
