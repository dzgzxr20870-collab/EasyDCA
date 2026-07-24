const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireAdmin, requireConsent } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

const router = express.Router();

// ทุก Route ในไฟล์นี้ต้อง Login ก่อน (requireAuth) แล้วจึงตรวจสิทธิ์ Admin (requireAdmin)
// เสมอ — Mount Middleware ต่อกันครั้งเดียวที่นี่ (ไม่ Verify JWT / เช็ค role ซ้ำใน Route)
// PDPA Compliance (migration 017) — Admin ก็เป็น User ที่ต้อง Consent เช่นกัน
router.use(requireAuth);
router.use(requireConsent);
router.use(requireAdmin);

router.get('/ping', adminController.ping);

// Admin Dashboard (Round 4b) — ทุก Endpoint Read-only (ไม่มี Write/Mutation)
router.get('/users', adminController.listUsers);
router.get('/payments', adminController.listPayments);
router.get('/stats', adminController.getStats);

// Broadcast (Round 4c) — ยิง Push หา User จริงจำนวนมาก (Write/Side-effect)
// Validate + 2-Step Confirm ฝั่ง Frontend + Validate ซ้ำใน Controller ก่อนส่งจริง
router.post('/broadcast', adminController.broadcast);

// Grant Premium ฟรี (Business Model Beta) — Admin ให้ Premium ทีละคนสำหรับ Beta Wave 1
// Update users.plan ตรงๆ (ไม่ผ่าน payments/ไม่นับรายได้) + บันทึก premium_grant_logs
router.post('/users/:id/grant-premium', adminController.grantPremium);

module.exports = router;
