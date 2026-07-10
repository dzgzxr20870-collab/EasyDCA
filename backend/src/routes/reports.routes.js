const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const reportsController = require('../controllers/reports.controller');

const router = express.Router();

// ทุก Route ต้อง Login ก่อน (Premium ถูกเช็คในชั้น Controller อีกชั้น)
router.use(requireAuth);

router.get('/export', reportsController.exportReport);

module.exports = router;
