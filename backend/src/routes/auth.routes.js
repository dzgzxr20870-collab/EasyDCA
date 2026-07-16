const express = require('express');
const authController = require('../controllers/auth.controller');
const requireAuth = require('../middleware/auth.middleware');

const router = express.Router();

// POST /api/v1/auth/liff-verify — แลก LIFF Access Token เป็น JWT ของระบบ
router.post('/liff-verify', authController.liffVerify);

// POST /api/v1/auth/pdpa-consent — ต้อง Login แล้ว (requireAuth) แต่ "ไม่" ผ่าน
// requireConsent เพราะ Endpoint นี้คือทางเดียวที่จะทำให้ผ่าน Gate นั้นได้
router.post('/pdpa-consent', requireAuth, authController.pdpaConsent);

module.exports = router;
