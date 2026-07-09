const config = require('../config/env');

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_PROFILE_URL = 'https://api.line.me/v2/bot/profile';
// Content API อยู่คนละ Host (api-data) กับ Messaging API ปกติ (api) — ใช้ดึง Binary
// ของ Image/Video/File Message (เช่น รูปสลิปโอนเงิน)
const LINE_CONTENT_URL = 'https://api-data.line.me/v2/bot/message';

// ส่งข้อความตอบกลับผ่าน LINE Reply API
// สำคัญ: ห้าม throw ออกไป ไม่ว่า LINE จะตอบผิดพลาดอย่างไร เพราะ Webhook
// Handler ต้องตอบ 200 OK ให้ LINE เสมอ (SRS.md § 2.1) — Error แค่ Log ไว้
async function replyMessage(replyToken, messages) {
  const payload = {
    replyToken,
    messages: Array.isArray(messages) ? messages : [messages],
  };

  try {
    const response = await fetch(LINE_REPLY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.line.channelAccessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[line] Reply API failed: ${response.status} ${detail}`);
    }
  } catch (err) {
    console.error(`[line] Reply API request error: ${err.message}`);
  }
}

// ดึง LINE Profile (displayName/pictureUrl) ของ userId ด้วย Get Profile API
// สำคัญ: ห้าม throw ออกไป — Auto-register ต้องทำงานต่อได้แม้ LINE API
// จะล้มเหลว (Rate Limit, Network, User บล็อกบัญชี ฯลฯ) จึงคืน null แทน
// เพื่อให้ Caller Fallback ไปใช้ค่า Default ได้เสมอ
async function getProfile(userId) {
  try {
    const response = await fetch(`${LINE_PROFILE_URL}/${userId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.line.channelAccessToken}`,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[line] Get Profile API failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    return { displayName: data.displayName, pictureUrl: data.pictureUrl ?? null };
  } catch (err) {
    console.error(`[line] Get Profile API request error: ${err.message}`);
    return null;
  }
}

// ส่งข้อความแบบ Push ผ่าน LINE Push API (ใช้กับ Cron แจ้งเตือน DCA — ไม่มี
// replyToken เพราะไม่ได้ตอบกลับข้อความของผู้ใช้)
//
// ⚠️ ต่างจาก replyMessage โดยตั้งใจ: ที่นี่ "ต้อง throw เมื่อล้มเหลว" เพื่อให้
// Caller (Cron) รู้ว่า Push ไม่สำเร็จ แล้ว "ไม่ markNotified" (จะได้ Retry รอบ
// ถัดไป) — replyMessage ต้องเงียบเพราะ Webhook ต้องตอบ 200 ให้ LINE เสมอ แต่
// Cron ไม่มีข้อจำกัดนั้น จึงให้ Error ทะลุขึ้นไปให้ Loop ราย Reminder จัดการเอง
async function pushMessage(to, messages) {
  const payload = {
    to,
    messages: Array.isArray(messages) ? messages : [messages],
  };

  const response = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.line.channelAccessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LINE Push API failed: ${response.status} ${detail}`);
  }
}

// ดึง Binary Content ของ Message (รูปภาพ/ไฟล์) จาก LINE Content API
// คืน { buffer, contentType } — buffer เป็น Node Buffer, contentType จาก Response Header
//
// ⚠️ ต่างจาก getProfile โดยตั้งใจ: ที่นี่ "ต้อง throw เมื่อล้มเหลว" เพื่อให้ Caller
// (Webhook image handler) รู้ว่าดึงสลิปไม่ได้ แล้วข้ามการอัปโหลด/บันทึกไป — Caller
// เป็นผู้ห่อ try/catch เองเพื่อไม่ให้ Webhook ทั้งก้อนพัง (Pattern เดียวกับ pushMessage)
async function getMessageContent(messageId) {
  const response = await fetch(`${LINE_CONTENT_URL}/${messageId}/content`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.line.channelAccessToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LINE Content API failed: ${response.status} ${detail}`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

module.exports = {
  replyMessage,
  pushMessage,
  getProfile,
  getMessageContent,
};
