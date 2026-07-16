const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

// ทุก Route ในไฟล์นี้ต้อง Login ก่อนเสมอ — Mount Middleware รวมครั้งเดียว
router.use(requireAuth);
// PDPA Compliance (migration 017) — ต้องกดยืนยัน Privacy Policy ก่อนเห็นข้อมูลจริง
router.use(requireConsent);

router.get('/portfolio', dashboardController.getPortfolio);
router.get('/history', dashboardController.getHistory);
router.get('/profit/:symbol', dashboardController.getProfit);
router.get('/me', dashboardController.getMe);

module.exports = router;
