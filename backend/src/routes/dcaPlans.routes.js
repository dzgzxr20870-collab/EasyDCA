const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const dcaPlansController = require('../controllers/dcaPlans.controller');

const router = express.Router();

// Pattern เดียวกับ transactions.routes — ทุก Route ต้อง Login + ผ่าน PDPA Consent ก่อน
// (Backend คือ Security Boundary เดียว ไม่มี RLS สำหรับ web — userId มาจาก JWT ที่
// requireAuth Verify แล้วเท่านั้น ไม่เคยรับ userId จาก Body/Query; :id ถูก scope ด้วย
// user_id ในชั้น repository ทุก Query กัน IDOR)
router.use(requireAuth);
router.use(requireConsent);

router.post('/', dcaPlansController.createPlan);
router.get('/', dcaPlansController.listPlans);
router.patch('/:id', dcaPlansController.updatePlan);
router.delete('/:id', dcaPlansController.deletePlan);

module.exports = router;
