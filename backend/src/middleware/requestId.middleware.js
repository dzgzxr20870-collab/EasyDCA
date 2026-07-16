const crypto = require('crypto');
const logger = require('../utils/logger.util');

// สร้าง/สืบทอด Request ID ต่อ 1 HTTP Request (S6 Part B) — ใช้ Correlate Log หลาย
// บรรทัดที่มาจาก Request เดียวกัน แนบ req.id ให้ Handler ถัดไปใช้ต่อ + Echo กลับเป็น
// Response Header X-Request-Id ให้ Client อ้างอิงตอนแจ้งปัญหาได้ (Support/Debug)
//
// ถ้า Request มี Header X-Request-Id ติดมาอยู่แล้ว (เช่นในอนาคตมี Load Balancer/Reverse
// Proxy แนบ Trace ID มาก่อนถึง Server นี้) ใช้ค่านั้นต่อแทนการสร้างใหม่ทับ — ไม่ทิ้ง
// Trace ID ที่ต้นทางตั้งใจส่งมาให้ ใช้ crypto.randomUUID() ในตัว Node ไม่ต้องเพิ่ม
// Dependency (เช่น uuid) ใหม่
//
// หมายเหตุ: สำหรับ Traffic หลักของระบบ (LINE Webhook) requestId ระดับ HTTP นี้ "ไม่ใช่"
// Correlation Key หลักที่ควรใช้ระดับ Business Logic เพราะ LINE อาจ Batch หลาย Event มาใน
// คำขอ HTTP เดียว (1 Request → N Event) — webhook.controller.js ใช้ event.webhookEventId
// เป็น Correlation Key แทนที่จุดนั้น (ดู handleEvent/handleImage) Middleware นี้ยัง Log
// ระดับ HTTP Request ไว้เป็น Baseline ทุก Route (รวม Webhook) เผื่อ Debug ชั้น Transport
function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = incoming && incoming.trim() ? incoming.trim() : crypto.randomUUID();

  res.setHeader('X-Request-Id', req.id);

  logger.info(`${req.method} ${req.path}`, { requestId: req.id });

  next();
}

module.exports = requestId;
