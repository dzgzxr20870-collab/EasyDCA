// ต้อง Load และ Validate Environment Variables ก่อน Import อย่างอื่นเสมอ
// (ถ้าค่าที่จำเป็นหายไป ต้อง Fail ทันทีตั้งแต่ Startup ไม่ใช่ตอน Request เข้ามา)
const config = require('./config/env');

const path = require('path');
const express = require('express');
const cors = require('cors');

const webhookRoutes = require('./routes/webhook.routes');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const paymentRoutes = require('./routes/payment.routes');
const adminRoutes = require('./routes/admin.routes');
const reportsRoutes = require('./routes/reports.routes');
const { scheduleExpirePending, schedulePurgeOld } = require('./jobs/pendingCleanup.job');
const { scheduleExpirePayments } = require('./jobs/paymentExpiry.job');
const { schedulePlanDowngrade } = require('./jobs/planDowngrade.job');
const { scheduleReminderPush } = require('./jobs/dcaReminder.job');
const { schedulePurgeStaleSetupSessions } = require('./jobs/reminderSetupCleanup.job');
const { schedulePurgeStaleBulkImportSessions } = require('./jobs/bulkImportCleanup.job');
const {
  scheduleWeeklySummaryPush,
  scheduleMonthlySummaryPush,
} = require('./jobs/portfolioSummary.job');
const { schedulePortfolioSnapshot } = require('./jobs/portfolioSnapshot.job');

const app = express();

// Fallback '*' เป็นค่าชั่วคราวเท่านั้น (ยังไม่รู้ Frontend URL จนกว่าจะ Deploy
// React App สำเร็จ) ต้องตั้ง FRONTEND_URL จริงบน Railway ก่อน Production ใช้งานจริง
// เพื่อความปลอดภัย (จำกัด Origin ที่เรียก API ได้ ไม่เปิดทุก Origin แบบ Wildcard)
app.use(
  cors({
    origin: config.app.frontendUrl || '*',
  })
);

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

// Mount Dashboard Routes (Phase 2 — Web Dashboard) ที่ /api/v1/dashboard
app.use('/api/v1/dashboard', dashboardRoutes);

// Mount Payment Routes (Phase 2 Step 3 — Premium ผ่าน PromptPay QR) ที่ /api/v1/payment
app.use('/api/v1/payment', paymentRoutes);

// Mount Admin Routes (Phase 3 Round 4a — Admin Auth) ที่ /api/v1/admin
// ทุก Route ภายในผ่าน requireAuth + requireAdmin (ดู admin.routes.js)
app.use('/api/v1/admin', adminRoutes);

// Mount Reports Routes (Phase 3 Round 8 — Export PDF/Excel) ที่ /api/v1/reports
// ทุก Route ผ่าน requireAuth + เช็ค Premium ในชั้น Controller (ดู reports.controller.js)
app.use('/api/v1/reports', reportsRoutes);

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
  // Purge Bulk Import Session ที่หมดอายุค้าง ตี 3 (bulkImportCleanup.job.js —
  // Phase 3 Round 6) — Pending Batch เองถูก Cron pendingCleanup.job.js Cover ให้แล้ว
  schedulePurgeStaleBulkImportSessions();
  // Push สรุปพอร์ตรายสัปดาห์ (อาทิตย์ 08:00) และรายเดือน (วันที่ 1 08:00)
  // Asia/Bangkok (portfolioSummary.job.js)
  scheduleWeeklySummaryPush();
  scheduleMonthlySummaryPush();
  // Mark คำขอชำระเงินที่หมดอายุ (24 ชม.) เป็น 'expired' ทุกชั่วโมง (paymentExpiry.job.js)
  scheduleExpirePayments();
  // Downgrade ผู้ใช้ Premium ที่หมดอายุกลับเป็น Free ทุกวันตี 1 (planDowngrade.job.js)
  schedulePlanDowngrade();
  // เก็บ Snapshot มูลค่าพอตของทุก User ทุกวันเที่ยงคืน Asia/Bangkok (portfolioSnapshot.job.js)
  schedulePortfolioSnapshot();
});

module.exports = app;
