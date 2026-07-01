const config = require('../config/env');

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

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

module.exports = {
  replyMessage,
};
