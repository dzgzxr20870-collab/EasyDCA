const userRepository = require('../repositories/user.repository');
const liffAuthService = require('../services/liffAuth.service');
const authTokenService = require('../services/authToken.service');

// ชื่อสำรองกรณี LINE ไม่คืน displayName (สอดคล้องกับ webhook.controller)
const DEFAULT_DISPLAY_NAME = 'LINE User';

// หา User เดิมจาก lineUserId — ถ้ายังไม่มีให้สร้างใหม่ (Auto-register) โดย Reuse
// ฟังก์ชันเดียวกับ Webhook (findByLineUserId + create) เพื่อให้ User จากเว็บ (LIFF)
// กับจาก LINE Chat เป็น Record เดียวกันเสมอ ไม่เกิด Record ซ้ำ
async function resolveUser(profile) {
  const existing = await userRepository.findByLineUserId(profile.userId);
  if (existing) {
    // แก้บั๊กชื่อ Fallback ค้างถาวร: ถ้าตอนสมัครครั้งแรก getProfile/fetchLiffProfile
    // ล้มเหลวชั่วคราวจนได้ชื่อ Default ไป แต่รอบนี้ Profile จริงมาแล้ว ให้ Sync ชื่อ
    // ให้ทันที — ถ้า User มีชื่อจริงอยู่แล้ว (ไม่ใช่ Fallback) ไม่แตะ (ไม่ใช่ Name Sync
    // ทั่วไปทุกครั้งที่ Login)
    if (existing.displayName === DEFAULT_DISPLAY_NAME && profile.displayName) {
      return userRepository.updateDisplayName(
        existing.id,
        profile.displayName,
        profile.pictureUrl ?? existing.pictureUrl
      );
    }
    return existing;
  }

  const displayName = profile.displayName ?? DEFAULT_DISPLAY_NAME;
  const pictureUrl = profile.pictureUrl ?? null;

  return userRepository.create(profile.userId, displayName, pictureUrl);
}

// POST /api/v1/auth/liff-verify
// รับ LIFF Access Token จากหน้าเว็บ → Verify กับ LINE → ออก JWT ของระบบเราคืน
async function liffVerify(req, res) {
  const { accessToken } = req.body || {};

  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken is required' });
  }

  try {
    // Verify Token + client_id ก่อน แล้วจึงดึง Profile (ตามลำดับ)
    await liffAuthService.verifyLiffAccessToken(accessToken);
    const profile = await liffAuthService.fetchLiffProfile(accessToken);

    const user = await resolveUser(profile);
    const token = authTokenService.issueUserToken(user);

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        displayName: user.displayName,
        pictureUrl: user.pictureUrl,
        // PDPA Compliance (migration 017) — Login.jsx ใช้ตัดสินว่าต้องแสดงหน้า
        // Consent (Express Opt-in) ก่อนเข้า Dashboard ไหม (null = ยังไม่เคยกดยืนยัน)
        pdpaConsentedAt: user.pdpaConsentedAt,
      },
    });
  } catch (err) {
    // Error ที่คาดไว้จาก LIFF (Token ผิด/Channel ไม่ตรง/หมดอายุ/ดึง Profile ไม่ได้)
    // → 401 พร้อม code ให้ Client รู้สาเหตุ
    if (err instanceof liffAuthService.LiffAuthError) {
      return res.status(401).json({ error: err.code });
    }

    // Error อื่นที่ไม่คาดคิด → 500 (ไม่ปล่อย Stack Trace หลุดถึง Client)
    console.error(`[auth] liffVerify failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// POST /api/v1/auth/pdpa-consent — (requireAuth เท่านั้น ไม่ผ่าน requireConsent
// เพราะหน้าที่ Endpoint นี้คือการ "ทำให้ผ่าน" Gate นั้นเอง) User กดยืนยัน Privacy
// Policy ครั้งแรกจากหน้า Consent ใน Login.jsx
async function pdpaConsent(req, res) {
  try {
    const user = await userRepository.setPdpaConsent(req.user.id);
    return res.status(200).json({
      user: {
        id: user.id,
        displayName: user.displayName,
        pictureUrl: user.pictureUrl,
        pdpaConsentedAt: user.pdpaConsentedAt,
      },
    });
  } catch (err) {
    console.error(`[auth] pdpaConsent failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { liffVerify, pdpaConsent };
