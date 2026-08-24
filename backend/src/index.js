// ต้อง Load และ Validate Environment Variables ก่อน Import อย่างอื่นเสมอ
// (ถ้าค่าที่จำเป็นหายไป ต้อง Fail ทันทีตั้งแต่ Startup ไม่ใช่ตอน Request เข้ามา)
const config = require('./config/env');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const requestId = require('./middleware/requestId.middleware');
const webhookRoutes = require('./routes/webhook.routes');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const paymentRoutes = require('./routes/payment.routes');
const adminRoutes = require('./routes/admin.routes');
const reportsRoutes = require('./routes/reports.routes');
const assetsRoutes = require('./routes/assets.routes');
const brokersRoutes = require('./routes/brokers.routes');
const portfoliosRoutes = require('./routes/portfolios.routes');
const transactionsRoutes = require('./routes/transactions.routes');
const dcaPlansRoutes = require('./routes/dcaPlans.routes');
const supportRoutes = require('./routes/support.routes');
const healthAlertService = require('./services/healthAlert.service');

// ⚠️ Fail-fast ตั้งแต่ Boot ถ้าไม่ได้ตั้ง FRONTEND_URL — เดิม Fallback เป็น '*'
// (เปิดให้ทุก Origin เรียก API ได้) ซึ่งเป็นค่าชั่วคราวสมัยยังไม่รู้ URL ของ React App
// ตอน Deploy ครั้งแรก แต่ตอนนี้ตั้งค่าจริงครบทั้ง 2 Service บน Railway แล้ว การคง
// Fallback ไว้มีแต่ความเสี่ยง: ถ้าวันหนึ่ง Variable หายไป (ตั้งชื่อผิด/ลืม Copy ตอน
// สร้าง Environment ใหม่) ระบบจะ "เปิด CORS ให้ทุกเว็บเงียบๆ" โดยไม่มีสัญญาณเตือนเลย
//
// เลือก Fail-fast ที่นี่แทนการใส่ FRONTEND_URL ลง REQUIRED_ENV_VARS ใน config/env.js
// โดยเจตนา เพราะ CORS เป็นเรื่องของ Web Server ตัวนี้เท่านั้น — worker.js (Cron) ไม่ได้
// เปิด HTTP Server จึงไม่ควรถูกบังคับให้มี Variable ที่ตัวเองไม่ได้ใช้ (ถ้าใส่ที่ env.js
// จะทำให้ทั้ง Worker และ Test ที่ requireActual('config/env') พังตามไปด้วยทั้งชุด)
if (!config.app.frontendUrl) {
  throw new Error(
    'Missing required environment variable: FRONTEND_URL\n' +
      'จำเป็นต่อการจำกัด CORS Origin (ห้าม Fallback เป็น Wildcard) — ' +
      'ดูรายละเอียดที่ docs/ENV_VARIABLES.md'
  );
}

const app = express();

// Request ID (S6 Part B) — ต้องมาก่อน Middleware/Route อื่นทั้งหมด เพื่อให้ req.id
// พร้อมใช้ตั้งแต่ต้น Request (รวมถึง Route Webhook ที่ต้องอ่าน Raw Body ด้านล่าง)
app.use(requestId);

// ── Trust Proxy (จำเป็นต่อ Rate Limit ด้านล่าง) ────────────────────────────────
// Railway วาง Reverse Proxy ไว้หน้า Container เสมอ → req.ip เป็น IP ของ Proxy
// (เหมือนกันหมดทุกคน) ถ้าไม่ตั้งค่านี้ Rate Limit แบบต่อ IP จะกลายเป็น "ถังเดียว
// รวมทุกคนบนโลก" ซึ่งอันตรายกว่าไม่มี Rate Limit เลย (ผู้ใช้คนเดียวยิงจนเต็มโควตา
// แล้วทุกคนโดนบล็อกตาม) ตั้ง 1 = เชื่อ Proxy ชั้นแรกชั้นเดียว (ของ Railway)
app.set('trust proxy', 1);

// ── Security Headers (Offensive Review Round 2 — G1) ───────────────────────
// เดิมไม่มี Header ด้านความปลอดภัยเลยสักตัว (ยืนยันด้วยการยิง Production จริง:
// ไม่มี HSTS/CSP/X-Frame-Options และมี x-powered-by: Express บอกยี่ห้อ Stack ให้ฟรีๆ)
//
// ⚠️ crossOriginResourcePolicy ต้องเป็น 'cross-origin' เท่านั้น — Default ของ helmet
// คือ 'same-origin' ซึ่งจะบล็อก GET /api/v1/payment/:id/qr.png ที่ LINE ต้อง Fetch
// ข้าม Origin มาแสดงใน Flex Message (เป็น Subresource Load แบบ no-cors ที่ CORP
// บังคับใช้จริง ต่างจาก fetch() ของ Frontend ที่ใช้ CORS ปกติจึงไม่โดน CORP)
// ถ้าปล่อย Default ไว้ = ปุ่ม Premium พังทั้งเส้นโดยไม่มี Error ให้เห็นฝั่ง Server
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
// helmet ลบ x-powered-by ให้อยู่แล้ว — ประกาศซ้ำเพื่อไม่ให้ Header นี้กลับมาเงียบๆ
// ถ้าวันหนึ่งมีคนปรับ Option ของ helmet (Defense in Depth ราคาถูกมาก)
app.disable('x-powered-by');

// จำกัด Origin ที่เรียก API ได้ (ไม่มี Fallback Wildcard แล้ว — เช็คไว้ด้านบน)
app.use(
  cors({
    origin: config.app.frontendUrl,
  })
);

// ── Rate Limit ระดับ App (ด่านกว้างกันยิงรัวทั้งระบบ) ──────────────────────────
// เพดานตั้งไว้ "หลวมพอที่ผู้ใช้จริงไม่มีวันชน" (300 ครั้ง/15 นาที/IP ≈ 20 ครั้ง/นาที)
// จุดประสงค์คือกัน Abuse/Scraping ไม่ใช่คุมโควตารายฟีเจอร์ — ฟีเจอร์ที่ต้องคุมเข้ม
// (อัปโหลดรูป Screenshot) มี Limiter เฉพาะทางของตัวเองที่ support.routes.js
//
// ⚠️ ต้อง skip 2 เส้นทางนี้เสมอ:
//   - /api/v1/webhook  = LINE ยิงมาจาก IP ของ LINE เอง (ผู้ใช้ทุกคนรวมกันเป็น IP
//     เดียวกันหมด) ถ้านับรวมด้วยจะบล็อก Event ของผู้ใช้จริงตอนมีคนใช้งานพร้อมกันเยอะ
//     — ด่านจริงของเส้นทางนี้คือ HMAC Signature (lineSignature.middleware) ซึ่งของปลอม
//     ผ่านไม่ได้อยู่แล้ว **แต่ไม่ได้แปลว่าไม่ต้องมีเพดานเลย** — ดู webhookLimiter ด้านล่าง
//   - /health = Railway/UptimeRobot Poll ถี่ตลอดเวลา ถ้าโดนบล็อกจะกลายเป็น False Alarm
//     ว่าระบบล่มทั้งที่ปกติดี
//
// ⚠️ Offensive Review Round 2 (F6): เดิม skip ด้วย `req.path.startsWith('/api/v1/webhook')`
// ซึ่ง "กว้างเกินความจำเป็น" — ยืนยันด้วยการยิง Production จริงแล้วว่า
// GET /api/v1/webhookZZZ (Path ที่ไม่มี Route รองรับ) ก็หลุด Rate Limit ไปด้วย
// เปลี่ยนเป็นเทียบ Path เป๊ะแทน (รับทั้งมีและไม่มี Trailing Slash เพราะ Express
// Router แบบ non-strict Match ทั้งสองแบบให้ Route เดียวกันอยู่แล้ว)
const WEBHOOK_PATH = '/api/v1/webhook';
function isWebhookPath(req) {
  return req.path === WEBHOOK_PATH || req.path === `${WEBHOOK_PATH}/`;
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || isWebhookPath(req),
  message: { error: 'TOO_MANY_REQUESTS' },
});
app.use(globalLimiter);

// ── Rate Limit เฉพาะ Webhook (เพดานสูงมาก — เป็น "ตาข่ายรองชั้นสุดท้าย") ──────
// เหตุผลที่ต้องมีทั้งที่ HMAC กันของปลอมได้อยู่แล้ว: HMAC ทำงาน "หลัง" อ่าน Body
// เข้ามาแล้ว คนที่ไม่มีบัญชีเลยจึงยิง POST เปล่าๆ เข้ามาได้ไม่จำกัดจำนวนครั้ง
// แต่ละครั้งกิน JSON Parse + HMAC-SHA256 ก่อนถูกปฏิเสธ (ยืนยันด้วยการยิงจริง:
// Endpoint นี้ไม่มี Header ratelimit เลย = ไม่มีเพดานใดๆ ทั้งสิ้น)
//
// เพดานตั้งไว้ "สูงจนทราฟฟิก LINE จริงไม่มีทางชน": 6,000 ครั้ง/15 นาที/IP (~400/นาที)
// OA ขนาด Beta มี Event จริงหลักหน่วยต่อนาที และ LINE รวมหลาย Event ไว้ใน Request
// เดียวอยู่แล้ว — ตัวเลขนี้จึงเป็นการกัน Flood ล้วนๆ ไม่ได้คุมทราฟฟิกปกติ
//
// ⚠️ ต้องวาง "ก่อน" express.json เสมอ — คนที่ชนเพดานต้องถูกปฏิเสธตั้งแต่ยังไม่ทัน
// อ่าน Body 100KB เข้า Memory (Pattern เดียวกับ screenshotUploadLimiter ที่
// support.routes.js ซึ่งวางก่อน rawScreenshotBody ด้วยเหตุผลเดียวกันเป๊ะ)
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS' },
});

// Route Webhook ต้องเก็บ Raw Body ไว้คำนวณ HMAC ก่อน Parse JSON เสมอ
// (ดู docs/SECURITY.md § 4) จึงแยก JSON Parser เฉพาะ Route นี้ออกจาก Route อื่น
app.use(
  '/api/v1/webhook',
  webhookLimiter,
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  webhookRoutes
);

app.use(express.json());

// ⚠️ Offensive Review Round 2 (F5): ถอด express.static('../public') ออกแล้ว พร้อมกับ
// ลบ backend/public/liff/index.html ทิ้งทั้งไฟล์ — หน้านั้นเขียนกำกับตัวเองไว้ว่า
// "Deprecated ... ไม่ได้ใช้งานจริงแล้วหลัง Deploy React App สำเร็จ" แต่ยัง Live อยู่บน
// Production จริง (ยืนยันแล้ว: GET /liff/index.html → 200) และเก็บ JWT ลง
// localStorage ของ Origin เดียวกับ API ซึ่งขัดกับ docs/SECURITY.md § 1.1 ตรงๆ
// (frontend/src/lib/api.js เก็บไว้ใน Memory เท่านั้นด้วยเหตุผลนี้)
// ตอนนี้ backend/public ไม่มีไฟล์อะไรเหลือแล้ว การ Serve Static จึงไม่มีเหตุผลให้คงไว้

// Mount Auth Routes (Phase 2 — LIFF Login) ที่ /api/v1/auth
app.use('/api/v1/auth', authRoutes);

// Mount Dashboard Routes (Phase 2 — Web Dashboard) ที่ /api/v1/dashboard
app.use('/api/v1/dashboard', dashboardRoutes);

// Mount Assets Routes (S8 Round 1a — Dropdown ค้นหาสินทรัพย์บนเว็บ) ที่ /api/v1/assets
app.use('/api/v1/assets', assetsRoutes);

// Mount Brokers Routes (Stage 1 — โบรก/Exchange ต่อ User, migration 042) ที่
// /api/v1/brokers — ใช้ผูกกับ assets.broker_id เพื่อทำ Broker Allocation บนเว็บ
// ทุก Endpoint เป็น Free (ดู brokers.controller.js)
app.use('/api/v1/brokers', brokersRoutes);

// Mount Portfolios Routes (Stage 8 — Multi-Portfolio, migration 044) ที่
// /api/v1/portfolios — GET เป็น Free เพราะหลัง Backfill ทุกคนมีพอร์ต Default
// ตัวคุมสิทธิ์จริงคือ POST (Free สร้างพอร์ตที่ 2 ไม่ได้) ดู portfolios.controller.js
app.use('/api/v1/portfolios', portfoliosRoutes);

// Mount Transactions Routes (S8 Round 1a — กล่องบันทึก DCA บนเว็บ) ที่ /api/v1/transactions
// บันทึกผ่าน transaction.service ตัวเดียวกับ LINE ทุกประการ (ดู transactions.controller.js)
app.use('/api/v1/transactions', transactionsRoutes);

// Mount DCA Plans Routes (S8 Round 3 — แผน DCA บนเว็บ) ที่ /api/v1/dca-plans
// อ่าน/เขียนตาราง dca_reminders ตัวเดียวกับ reminder ที่ตั้งผ่าน LINE (ดู dcaPlans.controller.js)
app.use('/api/v1/dca-plans', dcaPlansRoutes);

// Mount Payment Routes (Phase 2 Step 3 — Premium ผ่าน PromptPay QR) ที่ /api/v1/payment
app.use('/api/v1/payment', paymentRoutes);

// Mount Admin Routes (Phase 3 Round 4a — Admin Auth) ที่ /api/v1/admin
// ทุก Route ภายในผ่าน requireAuth + requireAdmin (ดู admin.routes.js)
app.use('/api/v1/admin', adminRoutes);

// Mount Reports Routes (Phase 3 Round 8 — Export PDF/Excel) ที่ /api/v1/reports
// ทุก Route ผ่าน requireAuth + เช็ค Premium ในชั้น Controller (ดู reports.controller.js)
app.use('/api/v1/reports', reportsRoutes);

// Mount Support Routes (ติดต่อ Admin/Support ก่อนเปิด Closed Beta Wave 1) ที่
// /api/v1/support — แทนที่ Flow LINE Chat เดิมที่ชนกับ Admin ตอบมือ (ดู
// support.routes.js / webhook.controller.js case COMMANDS.CONTACT_SUPPORT)
app.use('/api/v1/support', supportRoutes);

// Railway Health Check (ดู docs/DEPLOYMENT.md § 3.1) — ไม่ต้อง Auth (UptimeRobot/
// Railway ต้องเรียกได้จากภายนอกโดยตรง) เช็คว่า Database (Supabase) เชื่อมต่อได้จริง
// จริง ไม่ใช่แค่ Process ยังไม่ตาย — คืน 503 ถ้าเชื่อมต่อไม่ได้ (ให้ UptimeRobot/
// Railway จับได้จริงว่าระบบมีปัญหา) พร้อม Push แจ้ง Admin ผ่าน LINE แบบ Debounce
// (ดู healthAlert.service — Push แค่ตอนเปลี่ยนสถานะ ไม่ Push ซ้ำระหว่างยังพังต่อเนื่อง)
//
// "Process ยังรันอยู่" ไม่ต้องเช็คแยก — ถ้า Process ตายจริง Route นี้จะไม่ตอบอะไร
// เลย (Connection Refused/Timeout) ซึ่ง UptimeRobot จับเป็น Down ได้อยู่แล้วเช่นกัน
app.get('/health', async (req, res) => {
  try {
    const { healthy } = await healthAlertService.checkAndAlert();
    if (!healthy) {
      return res.status(503).json({ success: false, data: { status: 'degraded' } });
    }
    return res.status(200).json({ success: true, data: { status: 'ok' } });
  } catch (err) {
    // ไม่ควรเกิด (checkAndAlert Catch ไว้แล้วภายใน) แต่กันพลาดไม่ให้ Route นี้เอง
    // ทำให้ Process Crash — ตอบ 503 เสมอถ้ามี Error ที่ไม่คาดคิดหลุดออกมา
    console.error(`[health] unexpected error: ${err.message}`);
    return res.status(503).json({ success: false, data: { status: 'error' } });
  }
});

// ⚠️ Cron Job ทั้งหมดถูกย้ายไปรันที่ src/worker.js แยก Process ต่างหากแล้ว (S6 Group E
// part 2) — Process นี้ (Web Server) "ไม่" Schedule Cron ใดๆ เองอีกต่อไป เพื่อไม่ให้
// Deploy Backend Code ใหม่ไป Restart Cron ที่กำลังรันอยู่ด้วย และไม่ให้ Cron แย่ง CPU/RAM
// กับ Traffic Webhook จริง — ต้องรัน `npm run worker` เป็น Railway Service ที่สองแยกต่างหาก
// ด้วย มิฉะนั้น Cron จะไม่ทำงานเลย (ดู docs/DEPLOYMENT.md)
// ⚠️ Listen เฉพาะตอนถูกรันเป็น Entry Point จริง (`node src/index.js` ตาม npm start /
// npm run dev — Railway ใช้ทั้งคู่) — ไม่ใช่ตอนถูก require เข้ามา
//
// จำเป็นสำหรับ Integration Test ที่ต้องยก "App จริงทั้งก้อน" ขึ้นมาทดสอบ (ดู
// tests/idorEndToEnd.regression.test.js — Offensive Review Round 2 Q1): ถ้า listen
// ตอน import ทุกไฟล์เทสต์ที่ require App จะไปแย่ง Port เดียวกันแล้วพังสลับกันไปมา
// พฤติกรรมบน Production ไม่เปลี่ยนแม้แต่นิดเดียว (require.main === module เสมอ)
if (require.main === module) {
  app.listen(config.app.port, () => {
    console.log(`EasyDCA API Server listening on port ${config.app.port} (${config.app.nodeEnv})`);
  });
}

module.exports = app;
