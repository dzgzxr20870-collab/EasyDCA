const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

// ทุก Route ในไฟล์นี้ต้อง Login ก่อนเสมอ — Mount Middleware รวมครั้งเดียว
router.use(requireAuth);

router.get('/portfolio', dashboardController.getPortfolio);
router.get('/history', dashboardController.getHistory);
router.get('/profit/:symbol', dashboardController.getProfit);

module.exports = router;
