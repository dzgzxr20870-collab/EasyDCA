const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const assetsController = require('../controllers/assets.controller');

const router = express.Router();

// Pattern เดียวกับ dashboard.routes — ทุก Route ต้อง Login + ผ่าน PDPA Consent ก่อน
router.use(requireAuth);
router.use(requireConsent);

router.get('/symbols', assetsController.getSymbols);

// Stage 8 (Design Doc § 4.4) — จัดการ "ป้ายกำกับ" ของสินทรัพย์ที่ถืออยู่
// ⚠️ ต้องอยู่ "หลัง" /symbols เสมอ ไม่งั้น '/symbols' จะถูก '/:id' จับไปก่อน
// (Express จับคู่ตามลำดับที่ประกาศ) — /symbols เป็น Static Path จึงต้องมาก่อน
router.get('/', assetsController.listAssets);
router.patch('/:id', assetsController.updateAsset);

module.exports = router;
