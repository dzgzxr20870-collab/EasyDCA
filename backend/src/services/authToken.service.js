const jwt = require('jsonwebtoken');
const config = require('../config/env');

// ออก JWT ให้ผู้ใช้หลัง LIFF Login สำเร็จ — เก็บ user.id (sub) และ line_user_id
// ไว้ใน Payload เพื่อให้ requireAuth (auth.middleware) แนบ req.user ได้โดยไม่ต้อง
// Query DB ซ้ำทุก Request
function issueUserToken(user) {
  // รองรับทั้ง object จาก user.repository (toUser → camelCase lineUserId) และ
  // Raw Row จาก DB (snake_case line_user_id) เพื่อไม่ให้ได้ค่า undefined ใน Payload
  const lineUserId = user.lineUserId ?? user.line_user_id;

  return jwt.sign(
    { sub: user.id, lineUserId },
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
