const express = require('express');
const authController = require('../controllers/auth.controller');

const router = express.Router();

// POST /api/v1/auth/liff-verify — แลก LIFF Access Token เป็น JWT ของระบบ
router.post('/liff-verify', authController.liffVerify);

module.exports = router;
