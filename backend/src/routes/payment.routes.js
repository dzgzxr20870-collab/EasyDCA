const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const paymentController = require('../controllers/payment.controller');

const router = express.Router();

// ── Public: รูป QR PNG (ต้องอยู่ "ก่อน" router.use(requireAuth)) ──────────────
// LINE ต้อง Fetch รูปนี้แสดงใน Flex Message โดยไม่มี Authorization Header — จึง
// วางไว้เหนือ Middleware Auth (Controller ตรวจ payment ต้อง pending เอง, ใช้ยอด
// จาก DB เท่านั้น) ดูเหตุผลด้านความเสี่ยงใน payment.controller.getPaymentQr
router.get('/:id/qr.png', paymentController.getPaymentQr);

// ทุก Route ด้านล่างนี้ต้อง Login ก่อน (Pattern เดียวกับ dashboard.routes)
router.use(requireAuth);

router.post('/request', paymentController.requestPayment);
router.post('/:id/notify', paymentController.notifyPayment);

module.exports = router;
