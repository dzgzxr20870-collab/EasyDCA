const authTokenService = require('../services/authToken.service');
const userRepository = require('../repositories/user.repository');

// ป้องกัน Route ที่ต้อง Login — ตรวจ JWT จาก Header Authorization: Bearer <token>
// ถ้าผ่าน แนบ req.user = { id, lineUserId, role } (จาก JWT Payload เดิม ไม่เปลี่ยน
// Shape) และ req.userRecord = Row เต็มจาก DB (ใหม่ — PDPA Erasure/Consent) ให้ Route
// ถัดไปใช้งานต่อ
//
// ⚠️ PDPA Self-Service Erasure (migration 018): เพิ่ม DB Lookup 1 ครั้งต่อ Request
// (เดิมเป็น Pure JWT Verify ไม่แตะ DB เลย) เพื่อให้ "ลบข้อมูล" มีผล Force Logout
// ทันทีในคำขอถัดไป ไม่ต้องรอ JWT หมดอายุตามธรรมชาติ (สูงสุด 24 ชม.) — Trade-off
// ที่ตั้งใจยอมรับ: ทุก Endpoint ที่ผ่าน requireAuth มี DB Query เพิ่ม 1 ครั้งถาวร
async function requireAuth(req, res, next) {
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

  let userRecord;
  try {
    userRecord = await userRepository.findById(payload.sub);
  } catch (err) {
    console.error(`[auth] requireAuth: failed to load user ${payload.sub}: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }

  // ไม่พบ User (Row หายไปจริง — แทบเป็นไปไม่ได้เพราะ Anonymize ไม่ลบ Row) หรือถูก
  // Anonymize ไปแล้ว (anonymizedAt ไม่ใช่ null) → ปฏิเสธทันที ไม่ว่า JWT จะยัง Valid
  // อยู่แค่ไหนก็ตาม — Client (frontend/src/lib/api.js) จัดการ 401 ทั่วไปอยู่แล้ว
  // (clearToken + Redirect ไป Login) โดยไม่ต้องแก้ Frontend เพิ่มเลย
  if (!userRecord || userRecord.anonymizedAt) {
    return res.status(401).json({ error: 'ACCOUNT_ERASED' });
  }

  // ── บัญชีถูกล็อก (Offensive Review Round 2 — F7, migration 039) ─────────────
  // ต้องอยู่ "ตรงนี้" คู่กับ anonymizedAt เท่านั้น — ก่อนถึง Route Handler ใดๆ ทั้งสิ้น
  // เพื่อให้ครอบทุก Endpoint ที่ผ่าน requireAuth ในคราวเดียว ไม่ต้องไล่แปะทีละที่
  // (เดิม is_locked ถูกเช็คแค่ 2 จุด: freeTrial.service กับ facebookLikeGrant.service
  // แปลว่าบัญชีที่ถูกล็อกยังใช้งานทุกอย่างที่เหลือได้ตามปกติ — Flag ที่แทบไม่มีผลจริง)
  //
  // ⚠️ 403 ไม่ใช่ 401 โดยเจตนา: Frontend (frontend/src/lib/api.js) จัดการ 401 ด้วยการ
  // ล้าง Token + เด้งไป Login ซึ่งผิดความหมายที่นี่ — ผู้ใช้ที่ถูกล็อกยืนยันตัวตนผ่านแล้ว
  // (Token ยัง Valid สมบูรณ์) แค่ "ไม่มีสิทธิ์ใช้งาน" ถ้าตอบ 401 ผู้ใช้จะวนเข้า Login
  // ซ้ำๆ ไม่รู้จบโดยไม่มีข้อความอธิบายอะไรเลย
  //
  // ส่ง reason กลับไปด้วยเพื่อให้หน้าเว็บอธิบายผู้ใช้ได้ว่าทำไมถึงใช้งานไม่ได้ (สิทธิ์
  // ได้รับคำอธิบายตาม PDPA) — เหตุผลนี้เป็นข้อความที่ Admin เขียนเองตอนสั่งล็อก
  // จึงไม่มีข้อมูลภายในระบบหลุดไปโดยอัตโนมัติ
  if (userRecord.isLocked) {
    return res.status(403).json({
      error: 'ACCOUNT_LOCKED',
      reason: userRecord.lockReason ?? null,
    });
  }

  // role มาจาก JWT Payload ที่ Backend ใส่ตอนออก Token (คำนวณจาก ADMIN_LINE_USER_IDS)
  // Token เก่าก่อน Round 4a จะไม่มี role → undefined = ไม่ใช่ Admin (Fail Safe)
  req.user = { id: payload.sub, lineUserId: payload.lineUserId, role: payload.role };
  // Row เต็มจาก DB — requireConsent ใช้ต่อ (pdpaConsentedAt) โดยไม่ต้อง Query ซ้ำ
  req.userRecord = userRecord;
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

// PDPA Compliance (migration 017) — ต้องรันต่อจาก requireAuth เสมอ (ใช้
// req.userRecord ที่ requireAuth Query มาให้แล้ว ไม่ Query ซ้ำ) บังคับให้ User
// ต้องกดยืนยัน Privacy Policy แบบ Express Opt-in ก่อนเข้าถึง Route ที่มีข้อมูล
// จริงใดๆ (Dashboard/Payment/Admin/Reports) — ไม่ครอบคลุม auth.routes.js เพราะ
// Endpoint POST /pdpa-consent คือทางเดียวที่จะทำให้ผ่าน Gate นี้ได้
function requireConsent(req, res, next) {
  if (!req.userRecord || !req.userRecord.pdpaConsentedAt) {
    return res.status(403).json({ error: 'CONSENT_REQUIRED' });
  }
  return next();
}

// requireAuth เป็น Default Export เดิม (dashboard/payment routes import แบบ Function ตรงๆ)
// — คง Signature เดิมไว้ แล้วแนบ requireAdmin/requireConsent เป็น Property เพิ่ม
// เพื่อไม่ Break importer เดิม
module.exports = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireConsent = requireConsent;
