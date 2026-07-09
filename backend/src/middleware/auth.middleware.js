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

  // role มาจาก JWT Payload ที่ Backend ใส่ตอนออก Token (คำนวณจาก ADMIN_LINE_USER_IDS)
  // Token เก่าก่อน Round 4a จะไม่มี role → undefined = ไม่ใช่ Admin (Fail Safe)
  req.user = { id: payload.sub, lineUserId: payload.lineUserId, role: payload.role };
  return next();
}

// ต้องรันต่อจาก requireAuth เสมอ (เรียกคู่กัน) — ไม่ Verify JWT ซ้ำเอง แค่ตรวจ role
// ที่ requireAuth แนบไว้ใน req.user แล้ว ถ้าไม่ใช่ 'admin' → 403 FORBIDDEN
// (ไม่ใส่ Message ละเอียดที่หลุดข้อมูลภายในหรือบอกใบ้ว่ามี Route ลับอยู่)
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  return next();
}

// requireAuth เป็น Default Export เดิม (dashboard/payment routes import แบบ Function ตรงๆ)
// — คง Signature เดิมไว้ แล้วแนบ requireAdmin เป็น Property เพิ่มเพื่อไม่ Break importer เดิม
module.exports = requireAuth;
module.exports.requireAdmin = requireAdmin;
