const express = require('express');
const crypto = require('crypto');
const config = require('../config/env');

const router = express.Router();

// ⚠️⚠️ ชั่วคราวเพื่อ Debug เท่านั้น — ไม่ใช่ Feature ถาวร ⚠️⚠️
// จุดประสงค์: ดักหา `groupId` ของกลุ่มแชททีมที่เชิญ LINE OA "EasyDCA Support" เข้าไป
// (จาก `source.groupId` ใน Webhook Event Payload ตอนมีคนพิมพ์ข้อความในกลุ่ม) เพื่อเอาไป
// ใช้เป็นค่า SUPPORT_LINE_GROUP_ID ในพรอมต์ Push Support Ticket ที่รอทำอยู่
//
// Channel/Token ของ OA "EasyDCA Support" เป็นคนละตัวกับ Bot หลัก (คนละ Channel Secret)
// จึงต้องมี Route แยกต่างหาก ใช้ Route Webhook เดิมของ Bot หลัก (webhook.routes.js /
// lineSignature.middleware.js) ไม่ได้ — Signature ผูกกับ Channel Secret คนละตัว
//
// Handler ไม่ทำอะไรนอกจาก Log Payload ดิบแล้วตอบ 200 กลับ (LINE ต้องได้ 200 เสมอ ไม่
// เช่นนั้นจะ Retry ส่ง Event ซ้ำ) — ไม่มีการประมวลผล/บันทึกข้อมูลใดๆ ต่อ
//
// ⚠️ ต้องลบ Route นี้ทิ้งในรอบถัดไปที่ทำพรอมต์ Support Ticket จริง (ห้ามปล่อย Endpoint
// Log ดิบไม่มี Auth ค้างไว้ใน Production ถาวร)
router.post('/', (req, res) => {
  const secret = config.supportLine.channelSecret;

  if (secret) {
    const signature = req.headers['x-line-signature'];

    if (!signature || !req.rawBody) {
      console.warn('[debug-support-oa-webhook] Missing x-line-signature header or raw body');
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Missing x-line-signature header or request body', details: {} },
      });
    }

    const expectedSignature = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
    const receivedBuffer = Buffer.from(signature, 'base64');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');
    const isValid =
      receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

    if (!isValid) {
      console.warn('[debug-support-oa-webhook] Invalid LINE signature received');
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'LINE webhook signature validation failed', details: {} },
      });
    }
  } else {
    // ⚠️ ชั่วคราว: ยังไม่ได้ตั้งค่า SUPPORT_LINE_CHANNEL_SECRET ใน Env จึงข้ามการ Validate
    // Signature ไปก่อน — ยอมรับได้เพราะ Route นี้เป็น Debug ชั่วคราว ไม่ได้แตะ Ledger/
    // เงิน/Entitlement ใดๆ และจะถูกลบทิ้งทันทีที่ได้ groupId แล้ว
    console.warn(
      '[debug-support-oa-webhook] SUPPORT_LINE_CHANNEL_SECRET not set — skipping signature validation (temporary debug route)'
    );
  }

  console.log(JSON.stringify(req.body, null, 2));
  res.status(200).json({ success: true, data: null });
});

module.exports = router;
