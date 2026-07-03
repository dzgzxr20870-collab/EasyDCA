const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const paymentController = require('../controllers/payment.controller');

const router = express.Router();

// ทุก Route ต้อง Login ก่อน (Pattern เดียวกับ dashboard.routes) — Mount รวมครั้งเดียว
router.use(requireAuth);

router.post('/request', paymentController.requestPayment);
router.post('/:id/notify', paymentController.notifyPayment);

module.exports = router;
