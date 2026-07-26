const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const supportController = require('../controllers/support.controller');

const router = express.Router();

// ทุก Route ต้อง Login ก่อน (Pattern เดียวกับ payment.routes/dashboard.routes)
router.use(requireAuth);
// PDPA Compliance (migration 017) — ต้องกดยืนยัน Privacy Policy ก่อนติดต่อทีมงาน
// (Route นี้แนบ lineUserId/displayName ไปหา Admin เหมือนกัน จึงอยู่ใต้ Gate เดียวกัน)
router.use(requireConsent);

router.post('/request', supportController.submitRequest);

module.exports = router;
