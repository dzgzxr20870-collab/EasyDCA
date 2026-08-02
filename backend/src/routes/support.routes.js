const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const supportController = require('../controllers/support.controller');
const supportRequestFlow = require('../services/supportRequestFlow.service');

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

// ── Rate Limit เฉพาะการอัปโหลดรูป: 1 ครั้ง/ชม./User ────────────────────────────
// โควตาเท่ากับ supportRequestFlow.checkRateLimit (RATE_LIMIT_HOURS) โดยอ่านค่าจาก
// ค่าคงที่ตัวเดียวกัน ไม่ Hardcode เลข 1 ซ้ำ — ฟอร์มนี้เป็นฟอร์มเดียวกับหน้า /support
// ผู้ใช้จึงควรเจอเพดานเดียวกันไม่ว่าจะส่งข้อความหรือแนบรูป
//
// ⚠️ ทำไมไม่ Reuse checkRateLimit ตรงๆ: ฟังก์ชันนั้นนับจากตาราง support_requests
// (นับ "คำขอที่บันทึกแล้ว") แต่การอัปโหลดรูปไม่ได้สร้างแถวในตารางไหนเลย — ถ้าเรียก
// ตัวนั้นจะกลายเป็นว่าคนที่เพิ่งส่งข้อความ Support ไปอัปโหลดรูปไม่ได้ (คนละเรื่องกัน)
// จึงใช้ express-rate-limit นับแยกของตัวเอง แต่ยึดโควตาจากค่าคงที่เดียวกัน
//
// Key = user.id จาก JWT (ไม่ใช่ IP) — Limiter นี้อยู่หลัง requireAuth เสมอ จึงมี
// req.user ให้ใช้แน่นอน และทำให้ผู้ใช้หลังเน็ตเดียวกัน (Office/มือถือ NAT) ไม่โดน
// นับรวมกัน ส่วนคนที่พยายามยิงรัวก็เปลี่ยน IP หนีไม่ได้เพราะผูกกับบัญชี
const screenshotUploadLimiter = rateLimit({
  windowMs: supportRequestFlow.RATE_LIMIT_HOURS * 60 * 60 * 1000,
  limit: 1,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: {
    error: 'SCREENSHOT_UPLOAD_RATE_LIMITED',
    message: 'อัปโหลดรูปได้ 1 ครั้งต่อชั่วโมง กรุณารอสักครู่แล้วลองใหม่อีกครั้งครับ',
  },
});

// rawScreenshotBody ต้องมาก่อน Controller เพื่อแปลง Body เป็น Buffer
// Limiter วางไว้ "ก่อน" rawScreenshotBody โดยเจตนา — คนที่เกินโควตาจะถูกปฏิเสธตั้งแต่
// ยังไม่ทันอ่าน Body 10MB เข้ามาใน Memory (ถ้าวางหลังจะเสียแบนด์วิดท์/RAM ฟรีทุกครั้ง)
router.post(
  '/facebook-like/screenshot',
  screenshotUploadLimiter,
  rawScreenshotBody,
  supportController.uploadFacebookLikeScreenshot
);
router.post('/facebook-like', supportController.submitFacebookLikeRequest);

module.exports = router;
// Export Limiter ตรงๆ ให้ Test ประกอบ App จำลองมาทดสอบโควตาจริงได้ โดยไม่ต้องยก
// Route ทั้งชุด (ที่ต้องมี JWT/DB) ขึ้นมาทั้งก้อน — Router เดิมยังเป็น Default Export
// เหมือนเดิมทุกประการ (Additive ไม่กระทบ index.js ที่ Mount อยู่)
module.exports.screenshotUploadLimiter = screenshotUploadLimiter;
