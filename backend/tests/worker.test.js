const fs = require('fs');
const path = require('path');

// Mock ทุกไฟล์ Job ที่ worker.js Require (Automock — ทุก Export กลายเป็น jest.fn())
// เพื่อยืนยันว่า worker.js เรียก schedule* function ของแต่ละไฟล์ครบทุกตัว "อย่างละ 1
// ครั้งพอดี" โดยไม่ต้องรัน node-cron จริง (Regression Test สำหรับ S6 Group E part 2 —
// ป้องกัน "ลืมย้าย Schedule มาบางตัว" หรือ "เผลอเหลือค้างซ้ำทั้งสองที่")
jest.mock('../src/jobs/pendingCleanup.job');
jest.mock('../src/jobs/paymentExpiry.job');
jest.mock('../src/jobs/planDowngrade.job');
jest.mock('../src/jobs/dcaReminder.job');
jest.mock('../src/jobs/reminderSetupCleanup.job');
jest.mock('../src/jobs/bulkImportCleanup.job');
jest.mock('../src/jobs/guidedBuyCleanup.job');
jest.mock('../src/jobs/portfolioSummary.job');
jest.mock('../src/jobs/portfolioSnapshot.job');
jest.mock('../src/jobs/webhookEventCleanup.job');
jest.mock('../src/utils/logger.util');

const pendingCleanup = require('../src/jobs/pendingCleanup.job');
const paymentExpiry = require('../src/jobs/paymentExpiry.job');
const planDowngrade = require('../src/jobs/planDowngrade.job');
const dcaReminder = require('../src/jobs/dcaReminder.job');
const reminderSetupCleanup = require('../src/jobs/reminderSetupCleanup.job');
const bulkImportCleanup = require('../src/jobs/bulkImportCleanup.job');
const guidedBuyCleanup = require('../src/jobs/guidedBuyCleanup.job');
const portfolioSummary = require('../src/jobs/portfolioSummary.job');
const portfolioSnapshot = require('../src/jobs/portfolioSnapshot.job');
const webhookEventCleanup = require('../src/jobs/webhookEventCleanup.job');
const logger = require('../src/utils/logger.util');

describe('worker.js — Schedule ทุก Cron Job ครบ (แยกจาก Web Server Process)', () => {
  test('require worker.js → เรียก schedule* function ของทั้ง 10 ไฟล์ Job อย่างละ 1 ครั้งพอดี', () => {
    require('../src/worker');

    // pendingCleanup.job.js — 2 Function
    expect(pendingCleanup.scheduleExpirePending).toHaveBeenCalledTimes(1);
    expect(pendingCleanup.schedulePurgeOld).toHaveBeenCalledTimes(1);
    // paymentExpiry.job.js — 2 Function (Expire เดิม + Auto-release Safety Valve
    // migration 016 Lock-Until-Resolved)
    expect(paymentExpiry.scheduleExpirePayments).toHaveBeenCalledTimes(1);
    expect(paymentExpiry.scheduleAutoReleaseStaleAmounts).toHaveBeenCalledTimes(1);
    // planDowngrade.job.js
    expect(planDowngrade.schedulePlanDowngrade).toHaveBeenCalledTimes(1);
    // dcaReminder.job.js
    expect(dcaReminder.scheduleReminderPush).toHaveBeenCalledTimes(1);
    // reminderSetupCleanup.job.js
    expect(reminderSetupCleanup.schedulePurgeStaleSetupSessions).toHaveBeenCalledTimes(1);
    // bulkImportCleanup.job.js
    expect(bulkImportCleanup.schedulePurgeStaleBulkImportSessions).toHaveBeenCalledTimes(1);
    // guidedBuyCleanup.job.js (migration 022 — S8 R2 รอบ 2)
    expect(guidedBuyCleanup.schedulePurgeStaleGuidedBuySessions).toHaveBeenCalledTimes(1);
    // portfolioSummary.job.js — 2 Function
    expect(portfolioSummary.scheduleWeeklySummaryPush).toHaveBeenCalledTimes(1);
    expect(portfolioSummary.scheduleMonthlySummaryPush).toHaveBeenCalledTimes(1);
    // portfolioSnapshot.job.js
    expect(portfolioSnapshot.schedulePortfolioSnapshot).toHaveBeenCalledTimes(1);
    // webhookEventCleanup.job.js (migration 013 — เพิ่มหลัง Spec นี้ถูกร่างไว้ ต้องย้ายมาด้วย)
    expect(webhookEventCleanup.schedulePurgeStaleWebhookEvents).toHaveBeenCalledTimes(1);
  });

  test('Log ยืนยัน Startup ผ่าน logger.info หลัง Schedule ครบ', () => {
    expect(logger.info).toHaveBeenCalledWith(
      'worker process started',
      expect.objectContaining({ jobCount: expect.any(Number) })
    );
  });
});

// ตรวจแบบ Static (อ่าน Source ตรงๆ ไม่ Require index.js จริง) แทนการรัน index.js จริง
// เพราะ index.js เรียก app.listen() ผูก Port จริงตอน Require — ยังไม่มี Test Harness
// สำหรับ Mock Express App นี้อยู่ก่อนแล้ว การสร้างขึ้นมาใหม่ทั้งชุดเกินขอบเขตงานนี้
// (แค่ย้าย Cron ออก ไม่ใช่ปรับ Test Infra ของ Web Server) วิธีนี้ปลอดภัยกว่าและตรวจสิ่ง
// เดียวกันได้: ยืนยันว่าไม่มี Reference ของ schedule* function หรือ require('./jobs/...')
// หลงเหลืออยู่ใน index.js เลย (กันเคส "ลืมลบ" หรือ "เหลือค้างซ้ำทั้งสองที่")
describe('index.js — ไม่มี Cron Scheduling หลงเหลืออยู่อีกต่อไป', () => {
  test('Source ของ index.js ไม่มีชื่อ schedule* function หรือ require jobs/* เลย', () => {
    const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');

    const scheduleFunctionNames = [
      'scheduleExpirePending',
      'schedulePurgeOld',
      'scheduleReminderPush',
      'schedulePurgeStaleSetupSessions',
      'schedulePurgeStaleBulkImportSessions',
      'schedulePurgeStaleGuidedBuySessions',
      'scheduleWeeklySummaryPush',
      'scheduleMonthlySummaryPush',
      'scheduleExpirePayments',
      'scheduleAutoReleaseStaleAmounts',
      'schedulePlanDowngrade',
      'schedulePortfolioSnapshot',
      'schedulePurgeStaleWebhookEvents',
    ];

    for (const name of scheduleFunctionNames) {
      expect(indexSource).not.toContain(name);
    }
    expect(indexSource).not.toMatch(/require\(['"]\.\/jobs\//);
  });
});
