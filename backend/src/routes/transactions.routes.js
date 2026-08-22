const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const transactionsController = require('../controllers/transactions.controller');

const router = express.Router();

// เพดานขนาดรูปสลิป (ตรงกับ storage.service.MAX_SLIP_SIZE_BYTES = 10MB) — express.raw
// ปฏิเสธ Body ใหญ่เกินนี้ด้วย 413 ก่อนถึง Controller (Storage ตรวจซ้ำอีกชั้น) Pattern
// เดียวกับ payment.routes (แนบสลิปโอนเงิน) เป๊ะ
const SLIP_MAX_UPLOAD = '10mb';
// รับรูปสลิปเป็น Binary ดิบ (req.body = Buffer) scope เฉพาะ Route slip เท่านั้น ไม่กระทบ
// express.json() ระดับ App — type: () => true = รับทุก Content-Type (Controller ตรวจ
// ชนิดที่อนุญาตจาก header จริง)
const rawSlipBody = express.raw({ type: () => true, limit: SLIP_MAX_UPLOAD });

// Pattern เดียวกับ dashboard.routes — ทุก Route ต้อง Login + ผ่าน PDPA Consent ก่อน
// (Backend คือ Security Boundary เดียว ไม่มี RLS — userId มาจาก JWT ที่ requireAuth
// Verify แล้วเท่านั้น ไม่เคยรับ userId จาก Body/Query ของ Client)
router.use(requireAuth);
router.use(requireConsent);

router.post('/', transactionsController.createTransaction);

// ยกเลิกรายการ "ล่าสุดของตัวเอง" — จงใจไม่มี :id ใน Path (ดู undoTransaction.service:
// Immutable Ledger ไม่มี DELETE by id และ Service หารายการล่าสุดจาก userId เอง)
router.post('/undo-last', transactionsController.undoLast);

// ให้ AI อ่านสลิปแล้วคืนค่าที่อ่านได้ (ยังไม่บันทึกลง Ledger — ผู้ใช้ต้องตรวจ+ยืนยันก่อน)
// Premium หรือผู้ใช้ Free ที่ยังเหลือสิทธิ์ทดลอง (Gate ตรวจใน Controller ผ่าน
// slipOcrAccess ตัวเดียวกับฝั่ง LINE) — ต้องมาก่อน '/:id/slip' ไม่ได้ เพราะ Path
// คนละรูปแบบกัน (ไม่มี Param ชนกัน) แต่วางไว้ติดกันเพื่อให้อ่านง่าย
router.post('/slip-ocr', rawSlipBody, transactionsController.scanSlipWithAi);

// แนบรูปสลิปหลักฐานให้รายการที่บันทึกแล้ว (Premium — Gate ตรวจใน Controller)
// rawSlipBody ต้องมาก่อน Controller เพื่อแปลง Body เป็น Buffer (มิเรอร์ payment.routes)
router.post('/:id/slip', rawSlipBody, transactionsController.uploadTransactionSlip);

module.exports = router;
