const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const paymentController = require('../controllers/payment.controller');

const router = express.Router();

// เพดานขนาดรูปสลิปที่รับผ่าน HTTP (ตรงกับ storage.service.MAX_SLIP_SIZE_BYTES = 10MB)
// — express.raw ปฏิเสธ Body ใหญ่เกินนี้ด้วย 413 ก่อนถึง Controller (Storage ตรวจซ้ำอีกชั้น)
const SLIP_MAX_UPLOAD = '10mb';

// Parser รับรูปสลิปเป็น Binary ดิบทุกชนิด (req.body = Buffer) — scope เฉพาะ Route slip
// เท่านั้น ไม่กระทบ express.json() ระดับ App (JSON Parser ข้าม Content-Type รูปภาพอยู่แล้ว)
// type: () => true = รับทุก Content-Type (Controller ตรวจว่าเป็นรูปที่อนุญาตจาก header จริง)
const rawSlipBody = express.raw({ type: () => true, limit: SLIP_MAX_UPLOAD });

// ── Public: รูป QR PNG (ต้องอยู่ "ก่อน" router.use(requireAuth)) ──────────────
// LINE ต้อง Fetch รูปนี้แสดงใน Flex Message โดยไม่มี Authorization Header — จึง
// วางไว้เหนือ Middleware Auth (Controller ตรวจ payment ต้อง pending เอง, ใช้ยอด
// จาก DB เท่านั้น) ดูเหตุผลด้านความเสี่ยงใน payment.controller.getPaymentQr
router.get('/:id/qr.png', paymentController.getPaymentQr);

// ── Rate Limit เฉพาะการอัปโหลดสลิป: 1 ครั้ง/ชม./User (Offensive Review R2 — F3) ──
// ยกโครงมาจาก screenshotUploadLimiter (support.routes.js) ทั้งดุ้น ไม่คิดใหม่
//
// เหตุผล: uploadSlip ตั้งชื่อไฟล์ใหม่ทุกครั้ง (upsert: false — เก็บทุกรูปไว้กัน Race
// โดยเจตนา ดู storage.service) และไม่มีเพดานจำนวนครั้งเลย ผู้ใช้ที่มีคำขอ pending 1 ใบ
// จึงอัปโหลดรูป 10MB เข้า Storage ได้ไม่จำกัดจำนวนครั้ง — เปลืองพื้นที่/ค่า Storage
// โดยที่มีแค่รูปล่าสุดใบเดียวที่ถูกอ้างถึงจริง (payments.slip_image_url เขียนทับทุกครั้ง)
//
// จงใจไม่แตะพฤติกรรม "เก็บทุกรูป" ของ storage.service — เพดานนี้คุมที่ "อัตราการยิง"
// ซึ่งเป็นต้นตอจริง ไม่ใช่ไปเปลี่ยนเจตนาการเก็บไฟล์ที่ตั้งใจออกแบบไว้
//
// Key = user.id จาก JWT (ไม่ใช่ IP) — Limiter อยู่หลัง requireAuth เสมอ จึงมี req.user
// แน่นอน ผู้ใช้หลัง NAT เดียวกันไม่โดนนับรวม และคนที่ยิงรัวเปลี่ยน IP หนีไม่ได้
//
// 1 ครั้ง/ชม. เพียงพอกับการใช้งานจริง: ผู้ใช้ส่งสลิปโอนเงิน 1 ใบต่อคำขอ 1 ใบ (ซึ่ง
// ตอนนี้จำกัดไว้ 1 ใบค้างต่อ user แล้วด้วย — ดู F1) กรณีส่งรูปผิดแล้วต้องแก้จริงๆ
// ยังส่งผ่าน LINE ได้ทันทีโดยไม่ติดเพดานนี้ (คนละเส้นทาง) จึงไม่มีทางตัน
const slipUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 1,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: {
    error: 'SLIP_UPLOAD_RATE_LIMITED',
    message: 'อัปโหลดสลิปได้ 1 ครั้งต่อชั่วโมง กรุณารอสักครู่แล้วลองใหม่อีกครั้งครับ',
  },
});

// ทุก Route ด้านล่างนี้ต้อง Login ก่อน (Pattern เดียวกับ dashboard.routes)
router.use(requireAuth);
// PDPA Compliance (migration 017) — ต้องกดยืนยัน Privacy Policy ก่อนทำรายการชำระเงิน
router.use(requireConsent);

// ── Self-service Free Trial (แคมเปญชั่วคราว — ปิดด้วย PREMIUM_FREE_TRIAL_ENABLED) ──
// อยู่หลัง requireAuth + requireConsent เหมือน Route อื่นทั้งหมดในไฟล์นี้ (userId มา
// จาก JWT เท่านั้น ไม่รับจาก Body) — วางไว้ "ก่อน" Route ที่มี :id เพื่อไม่ให้
// 'free-trial' ถูกตีความเป็น payment id
router.get('/free-trial', paymentController.getFreeTrialStatus);
router.post('/free-trial/claim', paymentController.claimFreeTrial);

router.post('/request', paymentController.requestPayment);
// เว็บอัปโหลดสลิป (Feature 3) — rawSlipBody ต้องมาก่อน Controller เพื่อแปลง Body เป็น Buffer
//
// ⚠️ slipUploadLimiter ต้องมาก่อน rawSlipBody เสมอ (ดูเหตุผลที่นิยามด้านบน)
router.post('/:id/slip', slipUploadLimiter, rawSlipBody, paymentController.uploadSlip);
router.post('/:id/notify', paymentController.notifyPayment);

module.exports = router;
// Export Limiter ตรงๆ ให้ Test ประกอบ App จำลองมาทดสอบโควตาจริงได้ โดยไม่ต้องยก
// Route ทั้งชุด (ที่ต้องมี JWT/DB) ขึ้นมาทั้งก้อน — Pattern เดียวกับ
// support.routes.screenshotUploadLimiter (Additive ไม่กระทบ index.js ที่ Mount อยู่)
module.exports.slipUploadLimiter = slipUploadLimiter;
