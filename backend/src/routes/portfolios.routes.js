const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const portfoliosController = require('../controllers/portfolios.controller');

const router = express.Router();

// Pattern เดียวกับ brokers.routes — ทุก Route ต้อง Login + ผ่าน PDPA Consent ก่อน
// (Backend คือ Security Boundary เดียว ไม่มี RLS สำหรับ web — userId มาจาก JWT ที่
// requireAuth Verify แล้วเท่านั้น ไม่เคยรับ userId จาก Body/Query; :id ถูก scope ด้วย
// user_id ในชั้น repository ทุก Query ผ่าน queryForUser กัน IDOR)
router.use(requireAuth);
router.use(requireConsent);

// ⚠️ GET ทั้งสองตัวเป็น **Free** โดยเจตนา (แก้ Spec เดิมของ API.md § 14.2 ที่เขียนไว้
// เป็น Premium) — หลัง migration 044 ผู้ใช้ทุกคนรวม Free มีพอร์ต Default แล้ว
// ถ้าคืน 403 หน้า Dashboard ของ Free จะพังตั้งแต่โหลดหน้าแรก
//
// ตัวคุมสิทธิ์ Multi-portfolio จริงคือ POST (Free สร้างพอร์ตที่ 2 ไม่ได้) ซึ่งบังคับ
// อยู่ในชั้น Service ผ่าน entitlement.getActivePortfolioLimit ไม่ใช่ Middleware —
// เพราะกติกาไม่ใช่ "Premium เท่านั้น" ตรงๆ แต่เป็นเพดานจำนวน (Free 1 / Premium 50)
router.get('/', portfoliosController.listPortfolios);
router.get('/:id', portfoliosController.getPortfolio);
router.post('/', portfoliosController.createPortfolio);
router.patch('/:id', portfoliosController.updatePortfolio);
router.delete('/:id', portfoliosController.deletePortfolio);

module.exports = router;
