const cron = require('node-cron');
const reminderService = require('../services/dcaReminder.service');
const lineService = require('../services/line.service');
const flexMessage = require('../utils/flexMessage.util');
const { todayInBangkok } = require('../services/transaction.service');

// ── Push DCA Reminder ที่ครบกำหนดวันนี้ ─────────────────────────────────────
// รันวันละครั้ง 09:00 Asia/Bangkok:
//  1. หา Reminder ที่ครบกำหนดวันนี้และยังไม่ถูก Notify (findDueReminders)
//  2. Push LINE Message ให้ผู้ใช้ "ไปพิมพ์คำสั่งซื้อเอง" (ไม่ซื้ออัตโนมัติ)
//  3. markNotified เฉพาะเมื่อ Push สำเร็จ — ถ้า Push ล้มเหลว "ไม่ mark" เพื่อให้
//     รอบถัดไป (ถ้ามีการรันซ้ำวันเดียวกัน) Retry ได้ แต่ไม่ Retry Loop ในรอบนี้
//  4. try-catch แยกราย Reminder: Push ล้มเหลว 1 ตัว (เช่น User Block บอท) ต้อง
//     ไม่ทำให้ตัวอื่นไม่ถูกส่งต่อ
async function runReminderPush() {
  const today = todayInBangkok();

  let due;
  try {
    due = await reminderService.findDueReminders(today);
  } catch (err) {
    // Query พังทั้งก้อน — Log แล้วจบรอบ (ไม่ throw ออกไปให้ Process ตาย)
    console.error(`[cron:dca-reminder] failed to query due reminders for ${today}: ${err.message}`);
    return;
  }

  let pushed = 0;
  for (const reminder of due) {
    try {
      // ไม่มี lineUserId (Join users ไม่ได้ค่า) — Push ไม่ได้ ข้ามไป
      if (!reminder.lineUserId) {
        console.error(`[cron:dca-reminder] reminder ${reminder.id} has no lineUserId; skipping`);
        continue;
      }

      await lineService.pushMessage(
        reminder.lineUserId,
        flexMessage.buildReminderPushMessage(reminder)
      );

      // ✅ Push สำเร็จแล้วเท่านั้นถึง markNotified (กัน Push ซ้ำวันเดียวกัน)
      await reminderService.markNotified(reminder.id, today);
      pushed += 1;
    } catch (err) {
      // Push/markNotified ราย Reminder ล้มเหลว — Log แล้วไปตัวถัดไป (ไม่ล้มทั้ง Loop)
      // ถ้า Push ล้มเหลวจะยังไม่ mark → รอบถัดไปของวันเดียวกัน (ถ้ามี) Retry ได้เอง
      console.error(`[cron:dca-reminder] failed to push reminder ${reminder.id}: ${err.message}`);
    }
  }

  console.log(`[cron:dca-reminder] pushed ${pushed}/${due.length} due reminder(s) for ${today}`);
}

function scheduleReminderPush() {
  return cron.schedule('0 9 * * *', runReminderPush, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  scheduleReminderPush,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runReminderPush,
};
