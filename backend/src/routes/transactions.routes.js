const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const transactionsController = require('../controllers/transactions.controller');

const router = express.Router();

// Pattern เดียวกับ dashboard.routes — ทุก Route ต้อง Login + ผ่าน PDPA Consent ก่อน
// (Backend คือ Security Boundary เดียว ไม่มี RLS — userId มาจาก JWT ที่ requireAuth
// Verify แล้วเท่านั้น ไม่เคยรับ userId จาก Body/Query ของ Client)
router.use(requireAuth);
router.use(requireConsent);

router.post('/', transactionsController.createTransaction);

// ยกเลิกรายการ "ล่าสุดของตัวเอง" — จงใจไม่มี :id ใน Path (ดู undoTransaction.service:
// Immutable Ledger ไม่มี DELETE by id และ Service หารายการล่าสุดจาก userId เอง)
router.post('/undo-last', transactionsController.undoLast);

module.exports = router;
