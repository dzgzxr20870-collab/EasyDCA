const express = require('express');
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

// ทุก Route ด้านล่างนี้ต้อง Login ก่อน (Pattern เดียวกับ dashboard.routes)
router.use(requireAuth);
// PDPA Compliance (migration 017) — ต้องกดยืนยัน Privacy Policy ก่อนทำรายการชำระเงิน
router.use(requireConsent);

router.post('/request', paymentController.requestPayment);
// เว็บอัปโหลดสลิป (Feature 3) — rawSlipBody ต้องมาก่อน Controller เพื่อแปลง Body เป็น Buffer
router.post('/:id/slip', rawSlipBody, paymentController.uploadSlip);
router.post('/:id/notify', paymentController.notifyPayment);

module.exports = router;
