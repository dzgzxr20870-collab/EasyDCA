const config = require('../config/env');

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_PROFILE_URL = 'https://api.line.me/v2/bot/profile';

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

module.exports = {
  replyMessage,
  getProfile,
};
