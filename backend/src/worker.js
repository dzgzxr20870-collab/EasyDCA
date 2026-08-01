// Worker Process — รัน Cron Job ทั้งหมดแยกจาก Express Web Server (S6 Group E part 2)
//
// เดิมทุก Cron Job ถูก Schedule อยู่ใน index.js ภายใน app.listen() Callback เดียวกับที่
// รับ LINE Webhook Traffic — ทำให้ (1) Deploy Backend Code ใหม่ทีไร Cron ที่กำลังรันอยู่
// ถูก Restart ไปด้วยเสมอ (แม้จะไม่ได้แก้ Logic ของ Cron เลย) และ (2) Cron แย่ง CPU/RAM
// กับ Traffic Webhook จริงบน Process เดียวกัน
//
// ไฟล์นี้เป็น Entrypoint แยกต่างหาก (ไม่ require('express')/ไม่ app.listen() เลย) — แค่
// Import ฟังก์ชัน schedule* จากไฟล์ Job เดิมทุกไฟล์แล้วเรียกให้ครบ ตรรกะภายใน Job แต่ละ
// ตัว (run* Functions, Query, LINE Push ฯลฯ) "ไม่ถูกแก้เลย" งานนี้ย้ายแค่ "จุดที่เรียก
// Schedule" จาก index.js มาที่นี่เท่านั้น
//
// ⚠️ ต้อง Deploy เป็น Railway Service ที่สอง แยกจาก Service เดิม (ดู docs/DEPLOYMENT.md)
// Start Command: `npm run worker` — ถ้ายังไม่มี Service นี้รันอยู่ Cron Job "ทั้งหมด" จะ
// ไม่ทำงานเลย โดยไม่มี Error/Crash ให้เห็น (Silent) ต้องตรวจสอบให้แน่ใจว่า Service ที่สอง
// พร้อมรับก่อน Deploy Code ชุดนี้ขึ้น Production

// ต้อง Load และ Validate Environment Variables ก่อน Import อย่างอื่นเสมอ (Pattern
// เดียวกับ index.js) — ถ้าค่าที่จำเป็นหายไป ต้อง Fail ทันทีตั้งแต่ Startup
require('./config/env');

const logger = require('./utils/logger.util');

const { scheduleExpirePending, schedulePurgeOld } = require('./jobs/pendingCleanup.job');
const { scheduleExpirePayments, scheduleAutoReleaseStaleAmounts } = require('./jobs/paymentExpiry.job');
const { schedulePlanDowngrade } = require('./jobs/planDowngrade.job');
const { schedulePremiumExpiryReminder } = require('./jobs/premiumExpiryReminder.job');
const { scheduleReminderPush } = require('./jobs/dcaReminder.job');
const { schedulePurgeStaleSetupSessions } = require('./jobs/reminderSetupCleanup.job');
const { schedulePurgeStaleBulkImportSessions } = require('./jobs/bulkImportCleanup.job');
const { schedulePurgeStaleGuidedBuySessions } = require('./jobs/guidedBuyCleanup.job');
const {
  scheduleWeeklySummaryPush,
  scheduleMonthlySummaryPush,
} = require('./jobs/portfolioSummary.job');
const { schedulePortfolioSnapshot } = require('./jobs/portfolioSnapshot.job');
const { schedulePurgeStaleWebhookEvents } = require('./jobs/webhookEventCleanup.job');
const { scheduleNightlyBackup } = require('./jobs/dbBackup.job');

// Schedule Cron Job ทั้งหมด — ลำดับไม่มีผล (แต่ละตัวลงทะเบียนอิสระต่อกัน) คงลำดับ/
// Comment เดิมจาก index.js ไว้เพื่อให้ยังรู้ที่มา/รอบเวลาของแต่ละตัวได้ง่าย
//
// ⚠️ เก็บผลลัพธ์ของแต่ละ schedule*() ไว้ใน Object (Key = ชื่อ Job) แทนการปล่อยเป็น
// Statement ลอยๆ เพื่อให้นับจำนวน Job ที่ Schedule จริงได้จาก Object.keys(...).length
// เดิม Log ท้ายไฟล์นี้ Hardcode jobCount ตรงๆ แล้วมีคนเพิ่ม Job ใหม่ทีหลัง (เช่น
// scheduleAutoReleaseStaleAmounts / schedulePurgeOld) โดยไม่ได้แก้เลขนี้ตาม ทำให้ Log
// ไม่ตรงกับจำนวนจริง (Audit เจอว่า Hardcode ไว้ 12 แต่ของจริงคือ 14) — Derive จาก
// ของจริงเพื่อกัน Drift แบบนี้ซ้ำ
function scheduleAllJobs() {
  return {
    // (pendingCleanup.job.js)
    expirePending: scheduleExpirePending(),
    purgeOldPending: schedulePurgeOld(),
    // Push DCA Reminder ที่ครบกำหนดทุกวัน 09:00 Asia/Bangkok (dcaReminder.job.js)
    reminderPush: scheduleReminderPush(),
    // Purge Reminder Setup Session ที่หมดอายุค้าง ตี 3 (reminderSetupCleanup.job.js)
    purgeStaleSetupSessions: schedulePurgeStaleSetupSessions(),
    // Purge Bulk Import Session ที่หมดอายุค้าง ตี 3 (bulkImportCleanup.job.js —
    // Phase 3 Round 6) — Pending Batch เองถูก Cron pendingCleanup.job.js Cover ให้แล้ว
    purgeStaleBulkImportSessions: schedulePurgeStaleBulkImportSessions(),
    // Purge Guided Buy Session ที่หมดอายุค้าง ตี 3 (guidedBuyCleanup.job.js — S8 R2
    // รอบ 2) — Pending ที่ Flow นี้สร้างถูก Cron pendingCleanup.job.js Cover ให้แล้ว
    purgeStaleGuidedBuySessions: schedulePurgeStaleGuidedBuySessions(),
    // Push สรุปพอร์ตรายสัปดาห์ (อาทิตย์ 08:00) และรายเดือน (วันที่ 1 08:00)
    // Asia/Bangkok (portfolioSummary.job.js)
    weeklySummaryPush: scheduleWeeklySummaryPush(),
    monthlySummaryPush: scheduleMonthlySummaryPush(),
    // Mark คำขอชำระเงินที่หมดอายุ (24 ชม.) เป็น 'expired' ทุกชั่วโมง (paymentExpiry.job.js)
    expirePayments: scheduleExpirePayments(),
    // Auto-release Safety Valve (migration 016 Lock-Until-Resolved) — ปล่อยยอดคำขอที่
    // unresolved เกิน 7 วันคืนทุกชั่วโมง (paymentExpiry.job.js)
    autoReleaseStaleAmounts: scheduleAutoReleaseStaleAmounts(),
    // Downgrade ผู้ใช้ Premium ที่หมดอายุกลับเป็น Free ทุกวันตี 1 (planDowngrade.job.js)
    planDowngrade: schedulePlanDowngrade(),
    // Push เตือน "Premium ใกล้หมดอายุ" ล่วงหน้า 3 วัน ทุกวันตี 2 — หลัง planDowngrade
    // เพื่อไม่ให้คนที่หมดอายุไปแล้วถูกหยิบมาเตือนซ้ำ (premiumExpiryReminder.job.js)
    premiumExpiryReminder: schedulePremiumExpiryReminder(),
    // เก็บ Snapshot มูลค่าพอตของทุก User ทุกวันเที่ยงคืน Asia/Bangkok (portfolioSnapshot.job.js)
    portfolioSnapshot: schedulePortfolioSnapshot(),
    // Purge LINE Webhook Event ที่เก่ากว่า 7 วันค้าง (Idempotency Guard — migration 013) ตี 3
    // (webhookEventCleanup.job.js)
    purgeStaleWebhookEvents: schedulePurgeStaleWebhookEvents(),
    // pg_dump ฐานข้อมูล → บีบอัด → อัปโหลด Cloudflare R2 → ลบ Backup เก่าเกิน Retention
    // ทุกคืนตี 3 Asia/Bangkok (dbBackup.job.js — Infra ก่อน Beta)
    nightlyBackup: scheduleNightlyBackup(),
  };
}

const scheduledJobs = scheduleAllJobs();

// node-cron ลงทะเบียน Timer ไว้แล้ว (Event Loop มี Task ค้างอยู่) Process จึงมีชีวิตอยู่
// เองตามธรรมชาติ ไม่ต้องมี setInterval/Sleep Loop เทียมเพื่อ "กันไม่ให้ Process ตาย"
logger.info('worker process started', { jobCount: Object.keys(scheduledJobs).length });

module.exports = { scheduleAllJobs };
