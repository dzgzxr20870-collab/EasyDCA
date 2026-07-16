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

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  // Token หมดอายุ/ไม่ถูกต้อง → เคลียร์แล้วบังคับ Login ใหม่ทันที
  if (response.status === 401) {
    clearToken();
    window.location.href = '/';
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
    clearToken();
    window.location.href = '/';
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
    clearToken();
    window.location.href = '/';
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

export { getToken, setToken, clearToken, apiGet, apiPost, apiDownload };
