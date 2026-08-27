const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const brokersController = require('../controllers/brokers.controller');

const router = express.Router();

// Pattern เดียวกับ dcaPlans.routes — ทุก Route ต้อง Login + ผ่าน PDPA Consent ก่อน
// (Backend คือ Security Boundary เดียว ไม่มี RLS สำหรับ web — userId มาจาก JWT ที่
// requireAuth Verify แล้วเท่านั้น ไม่เคยรับ userId จาก Body/Query; :id ถูก scope ด้วย
// user_id ในชั้น repository ทุก Query ผ่าน queryForUser กัน IDOR)
router.use(requireAuth);
router.use(requireConsent);

// ทั้ง 4 Endpoint เป็น Free — โบรกเป็นป้ายกำกับสินทรัพย์ ไม่ใช่ฟีเจอร์ Premium
// (Rate Limit ใช้ globalLimiter ของ src/index.js เหมือน Route /api/v1 อื่นทั้งหมด)
router.get('/', brokersController.listBrokers);
router.post('/', brokersController.createBroker);
router.patch('/:id', brokersController.updateBroker);
router.delete('/:id', brokersController.deleteBroker);

module.exports = router;
