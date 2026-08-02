const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const supportController = require('../controllers/support.controller');

const router = express.Router();

// เพดานขนาดรูป Screenshot ที่รับผ่าน HTTP (ตรงกับ storage.service.MAX_SLIP_SIZE_BYTES
// = 10MB) — express.raw ปฏิเสธ Body ใหญ่เกินนี้ด้วย 413 ก่อนถึง Controller
// (Storage ตรวจซ้ำอีกชั้น) Pattern เดียวกับ payment.routes rawSlipBody
const SCREENSHOT_MAX_UPLOAD = '10mb';

// Parser รับรูปเป็น Binary ดิบ (req.body = Buffer) — scope เฉพาะ Route screenshot
// เท่านั้น ไม่กระทบ express.json() ระดับ App
const rawScreenshotBody = express.raw({ type: () => true, limit: SCREENSHOT_MAX_UPLOAD });

// ทุก Route ต้อง Login ก่อน (Pattern เดียวกับ payment.routes/dashboard.routes)
router.use(requireAuth);
// PDPA Compliance (migration 017) — ต้องกดยืนยัน Privacy Policy ก่อนติดต่อทีมงาน
// (Route นี้แนบ lineUserId/displayName ไปหา Admin เหมือนกัน จึงอยู่ใต้ Gate เดียวกัน)
router.use(requireConsent);

router.post('/request', supportController.submitRequest);

// ── แคมเปญ Premium ฟรี (Like Facebook) — ผู้ใช้ส่งคำขอผ่านฟอร์มหน้า /support เดิม ──
// ปิดแคมเปญได้ด้วย FACEBOOK_LIKE_GRANT_ENABLED โดยไม่ต้อง Deploy (Service ตรวจ Flag เอง)
router.get('/facebook-like', supportController.getFacebookLikeStatus);
// rawScreenshotBody ต้องมาก่อน Controller เพื่อแปลง Body เป็น Buffer
router.post(
  '/facebook-like/screenshot',
  rawScreenshotBody,
  supportController.uploadFacebookLikeScreenshot
);
router.post('/facebook-like', supportController.submitFacebookLikeRequest);

module.exports = router;
