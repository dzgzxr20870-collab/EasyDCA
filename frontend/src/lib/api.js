// Helper กลางสำหรับเรียก Backend API — ทุก Component ต้องเรียกผ่านที่นี่
// ห้ามเขียน fetch() กระจายเอง เพื่อให้ Logic แนบ Token / จัดการ 401 มีที่เดียว
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const TOKEN_KEY = 'easydca_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  // Token หมดอายุ/ไม่ถูกต้อง → เคลียร์แล้วบังคับ Login ใหม่ทันที
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
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
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/';
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

export { getToken, apiGet, apiPost };
