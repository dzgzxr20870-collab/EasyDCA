const authTokenService = require('../services/authToken.service');

// ป้องกัน Route ที่ต้อง Login — ตรวจ JWT จาก Header Authorization: Bearer <token>
// ถ้าผ่าน แนบ req.user = { id, lineUserId } ให้ Route ถัดไปใช้งานต่อ
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  let payload;
  try {
    payload = authTokenService.verifyUserToken(token);
  } catch (err) {
    // Token ปลอม/หมดอายุ/ผิดรูปแบบ (jwt.verify throw) → 401 INVALID_TOKEN
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }

  req.user = { id: payload.sub, lineUserId: payload.lineUserId };
  return next();
}

module.exports = requireAuth;
