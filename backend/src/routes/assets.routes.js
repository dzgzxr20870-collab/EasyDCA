const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const assetsController = require('../controllers/assets.controller');

const router = express.Router();

// Pattern เดียวกับ dashboard.routes — ทุก Route ต้อง Login + ผ่าน PDPA Consent ก่อน
router.use(requireAuth);
router.use(requireConsent);

router.get('/symbols', assetsController.getSymbols);

module.exports = router;
