const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

const router = express.Router();

// ทุก Route ในไฟล์นี้ต้อง Login ก่อน (requireAuth) แล้วจึงตรวจสิทธิ์ Admin (requireAdmin)
// เสมอ — Mount 2 Middleware ต่อกันครั้งเดียวที่นี่ (ไม่ Verify JWT / เช็ค role ซ้ำใน Route)
router.use(requireAuth);
router.use(requireAdmin);

router.get('/ping', adminController.ping);

// Admin Dashboard (Round 4b) — ทุก Endpoint Read-only (ไม่มี Write/Mutation)
router.get('/users', adminController.listUsers);
router.get('/payments', adminController.listPayments);
router.get('/stats', adminController.getStats);

module.exports = router;
