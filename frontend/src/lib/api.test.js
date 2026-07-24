import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { getToken, setToken, clearToken, stashReturnTo, takeReturnTo } from './api.js';

// เก็บ JWT ใน Memory เท่านั้น (docs/SECURITY.md § 1.1 — ห้ามเก็บ localStorage กัน XSS
// ขโมย Token) — Test นี้ยืนยัน getToken/setToken/clearToken ทำงานถูกต้องเป็น In-memory
// Singleton ระดับ Module ไม่มีการอ่าน/เขียน localStorage เกี่ยวกับ Token เลย

// Fake sessionStorage (Map-backed) — Test รันบน node env (ไม่มี window/sessionStorage จริง)
// จึง Stub window ให้ stashReturnTo/takeReturnTo มี Storage ใช้ (Roundtrip ได้จริง)
function makeSessionStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

beforeEach(() => {
  clearToken();
  vi.stubGlobal('window', { sessionStorage: makeSessionStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getToken / setToken / clearToken (In-memory JWT Store)', () => {
  test('ก่อนเรียก setToken() → getToken() คืนค่า null', () => {
    expect(getToken()).toBeNull();
  });

  test('setToken(x) แล้ว getToken() → คืน x', () => {
    setToken('sample-jwt-token');
    expect(getToken()).toBe('sample-jwt-token');
  });

  test('clearToken() หลัง setToken(x) → getToken() กลับเป็น null อีกครั้ง', () => {
    setToken('sample-jwt-token');
    expect(getToken()).toBe('sample-jwt-token');

    clearToken();
    expect(getToken()).toBeNull();
  });
});

// ── Return-To (Hardening) ────────────────────────────────────────────────────
// จำ Path เดิมก่อน Token หาย/401 ให้ Login พากลับหลัง Re-auth (ไม่เด้งไป /dashboard เสมอ)
describe('stashReturnTo / takeReturnTo (จำหน้าเดิมเพื่อพากลับหลัง Re-auth)', () => {
  test('stash Path ภายในแล้ว take → คืน Path เดิม (Roundtrip)', () => {
    stashReturnTo('/premium');
    expect(takeReturnTo()).toBe('/premium');
  });

  test('อ่านครั้งเดียว (Read-once) — take รอบสองคืน null', () => {
    stashReturnTo('/premium');
    expect(takeReturnTo()).toBe('/premium');
    expect(takeReturnTo()).toBeNull();
  });

  test('ไม่เคย stash → take คืน null (Caller Fallback /dashboard เอง)', () => {
    expect(takeReturnTo()).toBeNull();
  });

  test('เก็บ Path ที่มี query string ครบ', () => {
    stashReturnTo('/admin?tab=payments');
    expect(takeReturnTo()).toBe('/admin?tab=payments');
  });

  // กัน Open Redirect: ห้ามเก็บ URL ภายนอก/Protocol-relative/Path ว่าง/'/'
  test.each([
    ['//evil.com', 'protocol-relative'],
    ['https://evil.com', 'absolute URL'],
    ['/', 'หน้า Login เอง (ไม่มีความหมายที่จะจำ)'],
    ['dashboard', 'ไม่ขึ้นต้นด้วย /'],
    ['', 'ว่าง'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('ไม่เก็บค่าที่ไม่ปลอดภัย (%s — %s) → take คืน null', (unsafe) => {
    stashReturnTo(unsafe);
    expect(takeReturnTo()).toBeNull();
  });

  test('ค่าไม่ปลอดภัยที่ถูกยัดเข้า Storage ตรงๆ → take ก็ยังกรองทิ้ง (Defense in depth)', () => {
    window.sessionStorage.setItem('easydca:returnTo', '//evil.com');
    expect(takeReturnTo()).toBeNull();
  });
});
