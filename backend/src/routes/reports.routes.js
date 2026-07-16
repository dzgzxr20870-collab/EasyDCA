const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const reportsController = require('../controllers/reports.controller');

const router = express.Router();

// ทุก Route ต้อง Login ก่อน (Premium ถูกเช็คในชั้น Controller อีกชั้น)
router.use(requireAuth);
// PDPA Compliance (migration 017) — ต้องกดยืนยัน Privacy Policy ก่อนส่งออกรายงาน
router.use(requireConsent);

router.get('/export', reportsController.exportReport);

module.exports = router;
