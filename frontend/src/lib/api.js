// Helper กลางสำหรับเรียก Backend API — ทุก Component ต้องเรียกผ่านที่นี่
// ห้ามเขียน fetch() กระจายเอง เพื่อให้ Logic แนบ Token / จัดการ 401 มีที่เดียว
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// เก็บ JWT ไว้ใน Memory เท่านั้น (ตัวแปรระดับ Module) — "ห้าม" เก็บใน localStorage
// (docs/SECURITY.md § 1.1) เพราะ localStorage อ่านได้ตรงๆ ด้วย Script ที่แทรกผ่าน XSS
// ส่วนตัวแปรใน Memory หายไปเองเมื่อ Refresh หน้า/ปิด Tab (Trade-off ที่ตั้งใจ — ไม่ใช่ Bug)
// Login.jsx จัดการ Re-auth ให้อัตโนมัติผ่าน LIFF Session เดิมอยู่แล้วเมื่อ Token หายไป
let currentToken = null;

function getToken() {
  return currentToken;
}

function setToken(token) {
  currentToken = token;
}

function clearToken() {
  currentToken = null;
}

// ── Return-To (Hardening) ────────────────────────────────────────────────────
// เมื่อ Token ใน Memory หาย/ถูกปฏิเสธ (401) ระบบจะ Full-Reload กลับหน้า Login เพื่อ
// Re-auth ผ่าน LIFF — เดิม Login เด้งไป /dashboard เสมอ ทำให้ผู้ใช้ที่กำลังอยู่หน้าอื่น
// (เช่น /premium) "เด้งหลุดกลับ Dashboard" ทุกครั้ง เราจึงจำ Path เดิมไว้ใน
// sessionStorage (รอด Full Reload ได้ ต่างจากตัวแปร Memory) ให้ Login พากลับหลัง Re-auth
//
// ⚠️ เก็บเฉพาะ Path ภายในเท่านั้น (ขึ้นต้น '/' ตัวเดียว ไม่ใช่ '//' หรือ URL เต็ม) เพื่อกัน
// Open Redirect — และเป็นแค่ "เส้นทางในเว็บ" ไม่ใช่ข้อมูล Sensitive (ไม่ขัด SECURITY.md
// § 1.1 ที่ห้ามเก็บ "Token" ใน Storage — นี่ไม่ใช่ Token)
const RETURN_TO_KEY = 'easydca:returnTo';

// true ถ้าเป็น Path ภายในที่ปลอดภัยจะ Redirect ไป (กัน Open Redirect + ไม่เก็บ '/' เอง
// เพราะ '/' คือหน้า Login อยู่แล้ว ไม่มีความหมายที่จะจำ)
function isSafeInternalPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && path !== '/';
}

// จำ Path ปัจจุบันไว้พากลับหลัง Re-auth — เรียกก่อน Redirect ไป Login ทุกจุด
function stashReturnTo(path) {
  try {
    if (isSafeInternalPath(path)) {
      window.sessionStorage.setItem(RETURN_TO_KEY, path);
    }
  } catch {
    // sessionStorage อาจถูกปิด (Private Mode/นโยบายเบราว์เซอร์) — ข้ามไปเงียบๆ ไม่ให้พัง
  }
}

// อ่าน Path ที่จำไว้ "ครั้งเดียว" (อ่านแล้วลบทันที กัน Redirect ค้างรอบถัดไป) — คืน null
// ถ้าไม่มี/ไม่ปลอดภัย ให้ Caller Fallback ไป /dashboard เอง
function takeReturnTo() {
  try {
    const value = window.sessionStorage.getItem(RETURN_TO_KEY);
    if (value) window.sessionStorage.removeItem(RETURN_TO_KEY);
    return isSafeInternalPath(value) ? value : null;
  } catch {
    return null;
  }
}

// รวม Logic "เจอ 401 → กลับ Login" ไว้ที่เดียว: เคลียร์ Token → จำ Path เดิม → Full Reload
// ไป '/' (Login) — Full Reload จำเป็นเพราะ api.js ไม่มี Router ในมือ แต่ตอนนี้ Path เดิม
// ถูกจำไว้ใน sessionStorage แล้ว Login จะพากลับให้เอง
function redirectToLoginOn401() {
  clearToken();
  stashReturnTo(window.location.pathname + window.location.search);
  window.location.href = '/';
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  // Token หมดอายุ/ไม่ถูกต้อง → เคลียร์แล้วบังคับ Login ใหม่ทันที
  if (response.status === 401) {
    redirectToLoginOn401();
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

// POST พร้อมแนบ Token/จัดการ 401 แบบเดียวกับ apiGet (Logic แนบ Token มีที่เดียว)
// Error จาก Backend (เช่น 400 INVALID_MESSAGE) โยนเป็น Error(message = error code) ให้
// Caller แสดงผลเองได้
async function apiPost(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });

  // Token หมดอายุ/ไม่ถูกต้อง → เคลียร์แล้วบังคับ Login ใหม่ทันที (เหมือน apiGet)
  if (response.status === 401) {
    redirectToLoginOn401();
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

// PATCH พร้อมแนบ Token/จัดการ 401 แบบเดียวกับ apiPost (S8 R3 รอบ 3 — จัดการแผน DCA
// ต้องใช้แก้ active/currency/frequency ของแผนที่มีอยู่แล้ว ไม่ใช่สร้างใหม่)
async function apiPatch(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    redirectToLoginOn401();
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

// DELETE พร้อมแนบ Token/จัดการ 401 แบบเดียวกับ apiGet/apiPost (S8 R3 รอบ 3 — ลบแผน
// DCA จริง ไม่มี Body ส่งไป)
async function apiDelete(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (response.status === 401) {
    redirectToLoginOn401();
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

// อัปโหลดไฟล์ Binary (เช่น รูปสลิปโอนเงินในหน้า Premium) — ส่ง File/Blob ดิบเป็น Body
// พร้อม Content-Type = ชนิดไฟล์จริง (Backend ใช้ express.raw รับเป็น Buffer) คง Logic
// แนบ Token/จัดการ 401 แบบเดียวกับ apiPost — โยน Error(code) ให้ Caller แสดงผลเอง
async function apiUpload(path, file) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      // ชนิดไฟล์จริง (image/jpeg ฯลฯ) — Backend ตรวจ Allowlist จาก header นี้
      'Content-Type': file.type || 'application/octet-stream',
      Authorization: `Bearer ${getToken()}`,
    },
    body: file,
  });

  if (response.status === 401) {
    redirectToLoginOn401();
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

// ดาวน์โหลดไฟล์ Binary (เช่น รายงาน PDF/Excel) — แยกจาก apiGet เพราะ Response เป็น
// Blob ไม่ใช่ JSON (Round 8) คง Logic แนบ Token/จัดการ 401 แบบเดียวกัน คืน
// { blob, filename } (filename ดึงจาก Content-Disposition ที่ Backend ตั้งมา)
async function apiDownload(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (response.status === 401) {
    redirectToLoginOn401();
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    // Error Body เป็น JSON ({ error: CODE }) — โยน code ให้ Caller แสดงผลเอง
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed: ${response.status}`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : 'EasyDCA-Report';
  return { blob, filename };
}

export {
  getToken,
  setToken,
  clearToken,
  stashReturnTo,
  takeReturnTo,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  apiUpload,
  apiDownload,
  API_BASE_URL,
};
