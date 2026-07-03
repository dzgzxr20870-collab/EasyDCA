const config = require('../config/env');

// LINE Platform Endpoints (Phase 2 — LIFF Login)
const VERIFY_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/verify';
const PROFILE_URL = 'https://api.line.me/v2/profile';

// Error ที่มี code (Pattern เดียวกับ UndoTransactionError/DcaReminderError) เพื่อให้
// Controller (auth.controller) Map เป็น HTTP Status + code ตอบ Client ได้ ไม่ปล่อย
// Error ดิบ/Stack Trace หลุดถึง Client
class LiffAuthError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LiffAuthError';
    this.code = code;
    this.details = details;
  }
}

// ตรวจสอบความถูกต้องของ LIFF Access Token กับ LINE Platform โดยตรง
// (ใช้ global fetch — Node 22+ มีในตัว ไม่ต้องติดตั้ง Library เพิ่ม)
//
// อาจ throw: INVALID_TOKEN / CHANNEL_MISMATCH / TOKEN_EXPIRED
async function verifyLiffAccessToken(accessToken) {
  const url = `${VERIFY_TOKEN_URL}?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);

  // (a) Response ต้อง 200 — ไม่เช่นนั้น Token ใช้ไม่ได้ (ผิดรูปแบบ/ถูกเพิกถอน ฯลฯ)
  if (response.status !== 200) {
    throw new LiffAuthError(
      'INVALID_TOKEN',
      'LINE token verification failed',
      { status: response.status }
    );
  }

  const data = await response.json();

  // (b) จุดสำคัญที่สุดด้าน Security: client_id ต้องตรงกับ Channel ของเราเป๊ะ —
  // ป้องกัน Access Token ที่ออกจาก LIFF App อื่นมาสวมสิทธิ์เข้าระบบเรา
  if (data.client_id !== config.liff.channelId) {
    throw new LiffAuthError(
      'CHANNEL_MISMATCH',
      'Access token was not issued for this channel',
      { expected: config.liff.channelId, received: data.client_id }
    );
  }

  // (c) Token ต้องยังไม่หมดอายุ
  if (!(data.expires_in > 0)) {
    throw new LiffAuthError(
      'TOKEN_EXPIRED',
      'Access token has expired',
      { expiresIn: data.expires_in }
    );
  }

  return data;
}

// ดึง Profile ของผู้ใช้จาก LINE ด้วย Access Token ที่ Verify แล้ว
//
// อาจ throw: PROFILE_FETCH_FAILED
async function fetchLiffProfile(accessToken) {
  let response;
  try {
    response = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new LiffAuthError(
      'PROFILE_FETCH_FAILED',
      'Failed to reach LINE profile endpoint',
      { cause: err.message }
    );
  }

  if (response.status !== 200) {
    throw new LiffAuthError(
      'PROFILE_FETCH_FAILED',
      'Failed to fetch LINE profile',
      { status: response.status }
    );
  }

  const data = await response.json();

  return {
    userId: data.userId,
    displayName: data.displayName,
    pictureUrl: data.pictureUrl,
  };
}

module.exports = { LiffAuthError, verifyLiffAccessToken, fetchLiffProfile };
