// ต้อง Load และ Validate Environment Variables ก่อน Import อย่างอื่นเสมอ
// (ถ้าค่าที่จำเป็นหายไป ต้อง Fail ทันทีตั้งแต่ Startup ไม่ใช่ตอน Request เข้ามา)
const config = require('./config/env');

const path = require('path');
const express = require('express');
const cors = require('cors');

const requestId = require('./middleware/requestId.middleware');
const webhookRoutes = require('./routes/webhook.routes');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const paymentRoutes = require('./routes/payment.routes');
const adminRoutes = require('./routes/admin.routes');
const reportsRoutes = require('./routes/reports.routes');

const app = express();

// Request ID (S6 Part B) — ต้องมาก่อน Middleware/Route อื่นทั้งหมด เพื่อให้ req.id
// พร้อมใช้ตั้งแต่ต้น Request (รวมถึง Route Webhook ที่ต้องอ่าน Raw Body ด้านล่าง)
app.use(requestId);

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

// ⚠️ Cron Job ทั้งหมดถูกย้ายไปรันที่ src/worker.js แยก Process ต่างหากแล้ว (S6 Group E
// part 2) — Process นี้ (Web Server) "ไม่" Schedule Cron ใดๆ เองอีกต่อไป เพื่อไม่ให้
// Deploy Backend Code ใหม่ไป Restart Cron ที่กำลังรันอยู่ด้วย และไม่ให้ Cron แย่ง CPU/RAM
// กับ Traffic Webhook จริง — ต้องรัน `npm run worker` เป็น Railway Service ที่สองแยกต่างหาก
// ด้วย มิฉะนั้น Cron จะไม่ทำงานเลย (ดู docs/DEPLOYMENT.md)
app.listen(config.app.port, () => {
  console.log(`EasyDCA API Server listening on port ${config.app.port} (${config.app.nodeEnv})`);
});

module.exports = app;
