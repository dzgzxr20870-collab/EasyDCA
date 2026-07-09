const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { isAdminLineUserId } = require('../utils/admin.util');

// ออก JWT ให้ผู้ใช้หลัง LIFF Login สำเร็จ — เก็บ user.id (sub), line_user_id และ role
// ไว้ใน Payload เพื่อให้ requireAuth (auth.middleware) แนบ req.user ได้โดยไม่ต้อง
// Query DB ซ้ำทุก Request
function issueUserToken(user) {
  // รองรับทั้ง object จาก user.repository (toUser → camelCase lineUserId) และ
  // Raw Row จาก DB (snake_case line_user_id) เพื่อไม่ให้ได้ค่า undefined ใน Payload
  const lineUserId = user.lineUserId ?? user.line_user_id;

  // Role คำนวณจาก ADMIN_LINE_USER_IDS ฝั่ง Backend เองทุกครั้งที่ออก Token เท่านั้น
  // (ไม่รับ role จาก Client) — ใส่ 'user' อย่างชัดเจนแทนการละ Field เพื่อให้
  // req.user.role มีค่าเสมอ (Middleware/Frontend ตรวจได้ตรงไปตรงมา ไม่ต้องเดา undefined)
  const role = isAdminLineUserId(lineUserId) ? 'admin' : 'user';

  return jwt.sign(
    { sub: user.id, lineUserId, role },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
}

// ตรวจสอบ JWT — ถ้า Invalid/หมดอายุ jwt.verify จะ throw ตามปกติ (ไม่ Wrap Error เอง
// ให้ auth.middleware เป็นคน Handle → ตอบ 401 INVALID_TOKEN)
function verifyUserToken(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}

module.exports = { issueUserToken, verifyUserToken };
