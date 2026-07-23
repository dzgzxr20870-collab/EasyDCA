const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

// ทุก Route ในไฟล์นี้ต้อง Login ก่อนเสมอ — Mount Middleware รวมครั้งเดียว
router.use(requireAuth);
// PDPA Compliance (migration 017) — ต้องกดยืนยัน Privacy Policy ก่อนเห็นข้อมูลจริง
router.use(requireConsent);

// S8 Round 1a — ข้อมูลทั้งหน้า Dashboard ใหม่ในครั้งเดียว (การ์ดสรุป/Allocation/
// Streak/รายการล่าสุด/กราฟรายเดือน) Route เดิมด้านล่างยังอยู่ครบตามเดิม
router.get('/overview', dashboardController.getOverview);

router.get('/portfolio', dashboardController.getPortfolio);
router.get('/history', dashboardController.getHistory);
router.get('/profit/:symbol', dashboardController.getProfit);
router.get('/me', dashboardController.getMe);
// S8 — เปิดรูปสลิปต้นฉบับของธุรกรรม (302 → Signed URL อายุสั้น) ผ่าน requireAuth +
// requireConsent เหมือน Route อื่นทุกตัวในไฟล์นี้ (Mount รวมไว้ด้านบนแล้ว)
router.get('/transactions/:id/slip', dashboardController.getTransactionSlip);

module.exports = router;
