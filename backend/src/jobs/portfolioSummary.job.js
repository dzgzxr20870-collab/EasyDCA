const cron = require('node-cron');
const assetRepository = require('../repositories/asset.repository');
const portfolioSummaryService = require('../services/portfolioSummary.service');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');

// ── Push สรุปพอร์ตรายสัปดาห์/รายเดือน ──────────────────────────────────────
// Logic ของทั้งสองรอบเหมือนกันเป๊ะ ต่างแค่ periodLabel ('weekly'/'monthly') ที่
// ส่งเข้า Service ใช้ตกแต่งข้อความ:
//  1. findUserIdsWithActiveAssets → รายชื่อ User (Distinct) + lineUserId ที่ Join
//     มาแล้ว (กัน N+1 Query ตอน Push)
//  2. วนแต่ละ User: buildSummaryForUser — ถ้าคืน null (พอร์ตว่าง) ให้ Skip ไม่ Push
//  3. Push ผ่าน lineService.pushMessage (throw เมื่อล้มเหลวตาม Design เดิม)
//  4. try-catch แยกราย User: 1 User Push ล้มเหลว (เช่น User Block บอท) ต้องไม่
//     ทำให้ User อื่นไม่ถูกประมวลผลต่อ — Pattern เดียวกับ dcaReminder.job
//  5. Log สรุปจำนวนที่ Push สำเร็จ/ทั้งหมด ท้ายรอบ
async function runSummaryPush(periodLabel) {
  let users;
  try {
    users = await assetRepository.findUserIdsWithActiveAssets();
  } catch (err) {
    // Query พังทั้งก้อน — Log แล้วจบรอบ (ไม่ throw ออกไปให้ Process ตาย)
    console.error(
      `[cron:portfolio-summary:${periodLabel}] failed to query users with active assets: ${err.message}`
    );
    return;
  }

  let pushed = 0;
  for (const user of users) {
    try {
      // ไม่มี lineUserId (Join users ไม่ได้ค่า) — Push ไม่ได้ ข้ามไป
      if (!user.lineUserId) {
        console.error(
          `[cron:portfolio-summary:${periodLabel}] user ${user.userId} has no lineUserId; skipping`
        );
        continue;
      }

      const summary = await portfolioSummaryService.buildSummaryForUser(user.userId, periodLabel);

      // พอร์ตว่าง (ทุก Asset ขายหมด) → ไม่มีอะไรจะสรุป ข้ามไม่ Push
      if (!summary) continue;

      await lineService.pushMessage(
        user.lineUserId,
        flexMessage.buildPortfolioSummaryPushMessage(summary)
      );
      pushed += 1;
    } catch (err) {
      // Push/คำนวณราย User ล้มเหลว — Log แล้วไป User ถัดไป (ไม่ล้มทั้ง Loop)
      console.error(
        `[cron:portfolio-summary:${periodLabel}] failed to push summary for user ${user.userId}: ${err.message}`
      );
    }
  }

  console.log(
    `[cron:portfolio-summary:${periodLabel}] pushed ${pushed}/${users.length} summary(ies)`
  );
}

// รันทุกวันอาทิตย์ 08:00 Asia/Bangkok
async function runWeeklySummaryPush() {
  return runSummaryPush('weekly');
}

// รันวันที่ 1 ของทุกเดือน 08:00 Asia/Bangkok
async function runMonthlySummaryPush() {
  return runSummaryPush('monthly');
}

function scheduleWeeklySummaryPush() {
  return cron.schedule('0 8 * * 0', runWeeklySummaryPush, { timezone: 'Asia/Bangkok' });
}

function scheduleMonthlySummaryPush() {
  return cron.schedule('0 8 1 * *', runMonthlySummaryPush, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  scheduleWeeklySummaryPush,
  scheduleMonthlySummaryPush,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runWeeklySummaryPush,
  runMonthlySummaryPush,
};
