const { setTimeout: sleep } = require('timers/promises');
const userRepository = require('../repositories/user.repository');
const broadcastLogRepository = require('../repositories/broadcastLog.repository');
const entitlementService = require('./entitlement.service');
const lineService = require('./line.service');

// ค่าที่ถูกต้องของ Broadcast — Export ให้ Controller Reuse ตอน Validate (Source เดียว)
const TARGET_GROUPS = ['all', 'free', 'premium'];
const MESSAGE_TYPES = ['news', 'system_update', 'promotion', 'other'];

// LINE Messaging API: Text Message จำกัด 5,000 อักขระ (นับเป็น UTF-16 code units)
// ยืนยันจาก LINE Docs (developers.line.biz/en/docs/messaging-api/text-character-count)
// ก.ค. 2026 — JavaScript String.length นับ UTF-16 code units อยู่แล้ว จึงเทียบตรง
// กับที่ LINE นับ (ไม่ต้องแปลงเอง)
const MAX_MESSAGE_LENGTH = 5000;

// หน่วงเวลาระหว่าง Push แต่ละคน (ms) — Rate Limit Guard
// LINE Push จำกัด 2,000 req/s ซึ่งการส่งแบบ Sequential await (ทีละคน รอให้เสร็จ
// ก่อนคนถัดไป — Pattern เดียวกับ dcaReminder.job/portfolioSummary.job) ต่ำกว่ามาก
// อยู่แล้ว แต่เพิ่มหน่วงเล็กน้อยเป็น Guard ชั้นสองสำหรับ Batch ใหญ่ในอนาคต
// (Test ส่ง delayMs: 0 เพื่อไม่ให้ Test ช้า)
const DEFAULT_DELAY_MS = 40;

// กรอง User ตามกลุ่มเป้าหมาย โดยใช้ entitlement.service.isPremiumActive เดิม
// (ห้ามเทียบ plan === 'premium' เอง — Pattern เดียวกับ Round 4b)
//   all     = ไม่กรอง (ทุกคน)
//   free    = ผู้ที่ไม่ใช่ Premium Active (รวม Premium ที่หมดอายุแล้ว)
//   premium = ผู้ที่ Premium ยัง Active จริง
function filterByTargetGroup(users, targetGroup) {
  if (targetGroup === 'premium') {
    return users.filter((u) => entitlementService.isPremiumActive(u));
  }
  if (targetGroup === 'free') {
    return users.filter((u) => !entitlementService.isPremiumActive(u));
  }
  return users;
}

// ส่ง Broadcast (Push) หา User ในกลุ่มเป้าหมาย แล้วบันทึก Log
//
// Error Isolation ต่อคน (บังคับตามพรอมต์ — Pattern เดียวกับ dcaReminder.job/
// portfolioSummary.job): User คนหนึ่ง Push ล้มเหลว (เช่น Block บอท) ต้องไม่ทำให้
// คนอื่นไม่ถูกส่ง — วน try/catch แยกราย User ให้ครบทุกคน แล้วสรุปผลท้ายสุด
//
// Reuse lineService.pushMessage เดิม (ห้ามเขียน HTTP Call หา LINE API ใหม่)
async function sendBroadcast(
  { targetGroup, messageType, message, sentBy },
  { delayMs = DEFAULT_DELAY_MS } = {}
) {
  const allUsers = await userRepository.findAll();
  const recipients = filterByTargetGroup(allUsers, targetGroup);

  const lineMessage = { type: 'text', text: message };

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < recipients.length; i += 1) {
    const user = recipients[i];
    try {
      // ทุก user มี line_user_id (NOT NULL ใน DB) แต่กันไว้ — นับเป็นล้มเหลว (ส่งไม่ได้)
      if (!user.lineUserId) {
        throw new Error('user has no lineUserId');
      }
      await lineService.pushMessage(user.lineUserId, lineMessage);
      successCount += 1;
    } catch (err) {
      // Push ราย User ล้มเหลว — Log แล้วไปคนถัดไป (ไม่ล้มทั้ง Batch)
      failureCount += 1;
      console.error(`[broadcast] failed to push to user ${user.id}: ${err.message}`);
    }

    // หน่วงระหว่างคน (ไม่หน่วงหลังคนสุดท้าย) — Rate Limit Guard สำหรับ Batch ใหญ่
    if (delayMs > 0 && i < recipients.length - 1) {
      await sleep(delayMs);
    }
  }

  const totalRecipients = recipients.length;

  // บันทึก Log หลังส่งครบ — ถ้าเขียน DB พลาด "หลังส่งจริงไปแล้ว" ต้องไม่ทำให้ทั้ง
  // Request กลายเป็น 500 (ผู้ใช้ได้รับข้อความไปแล้วจริง) จึง try/catch แล้วยังคืนผล
  // นับตามจริง (ยอมให้ Log หายดีกว่าหลอกว่า Broadcast ล้มเหลวทั้งที่ส่งไปแล้ว)
  try {
    await broadcastLogRepository.create({
      sentBy,
      targetGroup,
      messageType,
      messageContent: message,
      totalRecipients,
      successCount,
      failureCount,
    });
  } catch (err) {
    console.error(`[broadcast] failed to write broadcast_logs: ${err.message}`);
  }

  return { totalRecipients, successCount, failureCount };
}

module.exports = {
  sendBroadcast,
  filterByTargetGroup,
  TARGET_GROUPS,
  MESSAGE_TYPES,
  MAX_MESSAGE_LENGTH,
};
