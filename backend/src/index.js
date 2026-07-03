// ต้อง Load และ Validate Environment Variables ก่อน Import อย่างอื่นเสมอ
// (ถ้าค่าที่จำเป็นหายไป ต้อง Fail ทันทีตั้งแต่ Startup ไม่ใช่ตอน Request เข้ามา)
const config = require('./config/env');

const path = require('path');
const express = require('express');
const cors = require('cors');

const webhookRoutes = require('./routes/webhook.routes');
const authRoutes = require('./routes/auth.routes');
const { scheduleExpirePending, schedulePurgeOld } = require('./jobs/pendingCleanup.job');
const { scheduleReminderPush } = require('./jobs/dcaReminder.job');
const { schedulePurgeStaleSetupSessions } = require('./jobs/reminderSetupCleanup.job');
const {
  scheduleWeeklySummaryPush,
  scheduleMonthlySummaryPush,
} = require('./jobs/portfolioSummary.job');

const app = express();

app.use(cors());

// Route Webhook ต้องเก็บ Raw Body ไว้คำนวณ HMAC ก่อน Parse JSON เสมอ
// (ดู docs/SECURITY.md § 4) จึงแยก JSON Parser เฉพาะ Route นี้ออกจาก Route อื่น
app.use(
  '/api/v1/webhook',
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  webhookRoutes
);

app.use(express.json());

// Serve Static Files (Phase 2 — หน้า LIFF Login ที่ backend/public/liff/index.html)
// วางหลัง cors/json แต่ก่อน Route API อื่นๆ
app.use(express.static(path.join(__dirname, '../public')));

// Mount Auth Routes (Phase 2 — LIFF Login) ที่ /api/v1/auth
app.use('/api/v1/auth', authRoutes);

// Railway Health Check (ดู docs/DEPLOYMENT.md § 3.1)
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok' } });
});

app.listen(config.app.port, () => {
  console.log(`EasyDCA API Server listening on port ${config.app.port} (${config.app.nodeEnv})`);

  // Schedule Cron Job หลัง Server เริ่มรับ Webhook ได้แล้ว — ไม่ต้องรอ Cron
  // พร้อมก่อน Server จะ Listen (pendingCleanup.job.js)
  scheduleExpirePending();
  schedulePurgeOld();
  // Push DCA Reminder ที่ครบกำหนดทุกวัน 09:00 Asia/Bangkok (dcaReminder.job.js)
  scheduleReminderPush();
  // Purge Reminder Setup Session ที่หมดอายุค้าง ตี 3 (reminderSetupCleanup.job.js)
  schedulePurgeStaleSetupSessions();
  // Push สรุปพอร์ตรายสัปดาห์ (อาทิตย์ 08:00) และรายเดือน (วันที่ 1 08:00)
  // Asia/Bangkok (portfolioSummary.job.js)
  scheduleWeeklySummaryPush();
  scheduleMonthlySummaryPush();
});

module.exports = app;
