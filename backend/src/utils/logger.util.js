// Structured Logging Foundation (S6 Part B, ก่อน Beta Launch)
//
// Wrapper บาง ๆ รอบ console.log/console.warn/console.error ให้ Log แต่ละบรรทัดมี Shape
// เดียวกัน (JSON) เพื่อ Grep/Filter ได้ง่ายใน Railway Log Viewer เมื่อ Traffic จริงเริ่มมี
// ปริมาณมากพอที่ Log แบบ Free-text เดิม (`console.log('[webhook] ...')`) เริ่มไล่ตามยาก —
// ไม่เพิ่ม Dependency ใหม่ (Winston/Pino ฯลฯ) Transport ยังเป็น stdout/stderr เดิมทุกประการ
// (Railway Capture ตรงอยู่แล้ว ไม่ต้องมี File Transport/External Log Shipper)
//
// ⚠️ Scope ตั้งใจแคบมาก: Wire เข้าเฉพาะจุดที่มีมูลค่าสูงสุด (ดู webhook.controller.js —
// handleEvent/handleImage/replyWithError, payment.service.js — approvePayment/
// rejectPayment/expireOverduePayments, และ requestId.middleware.js เอง) — "ไม่ใช่" การ
// Migrate console.* ทั้ง ~25 ไฟล์ที่เหลือในโปรเจกต์ (Scope ใหญ่กว่านี้มาก เป็นงานแยกต่างหาก)
//
// meta รับ requestId (HTTP Request ปกติ) และ/หรือ webhookEventId (LINE Webhook Event —
// Correlation Key ที่เหมาะกว่าสำหรับ Log ที่มาจาก handleEvent/handleImage เพราะ LINE อาจ
// Batch หลาย Event มาในคำขอ HTTP เดียว ทำให้ requestId ระดับ HTTP ไม่ผูกกับ 1 Event เป๊ะ)
// หรือ Field อื่นตามบริบท (เช่น paymentId) — ไม่บังคับ Shape ตายตัวเกินไป
function writeLog(level, message, meta = {}) {
  // Merge meta ก่อน แล้วค่อย Set timestamp/level/message ทับท้ายสุดเสมอ — กัน Caller
  // ที่ (พลาด) ส่ง meta ที่มี Key ชื่อชนกัน (เช่น { message: '...' }) มาเบียด Field หลัก
  const line = {
    ...meta,
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  const output = JSON.stringify(line);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function info(message, meta) {
  writeLog('info', message, meta);
}

function warn(message, meta) {
  writeLog('warn', message, meta);
}

function error(message, meta) {
  writeLog('error', message, meta);
}

module.exports = { info, warn, error };
