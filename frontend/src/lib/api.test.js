import { describe, test, expect, beforeEach } from 'vitest';
import { getToken, setToken, clearToken } from './api.js';

// เก็บ JWT ใน Memory เท่านั้น (docs/SECURITY.md § 1.1 — ห้ามเก็บ localStorage กัน XSS
// ขโมย Token) — Test นี้ยืนยัน getToken/setToken/clearToken ทำงานถูกต้องเป็น In-memory
// Singleton ระดับ Module ไม่มีการอ่าน/เขียน localStorage เกี่ยวกับ Token เลย

beforeEach(() => {
  clearToken();
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
