import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
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
} from './api.js';

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

// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ สัญญารูปร่าง Error ของทุก Helper (บั๊กคลาส "อ่าน Error Code ผิดตำแหน่ง")
// ═══════════════════════════════════════════════════════════════════════════
// เคสจริง (30 ส.ค. 2569): `CreatePortfolioModal` เขียน `err?.code` ตามสัญชาตญาณ
// แต่ api.js **ไม่เคยแนบ `.code` ให้เลยแม้แต่ Helper เดียว** (Error Code อยู่ใน
// `.message` แทน) → Error Mapping ไม่เคยทำงาน ผู้ใช้เห็นโค้ดดิบ
// `"PORTFOLIO_NAME_EXISTS"` และปุ่ม "ดูแพ็กเกจ Premium" ไม่เคยโผล่ (กระทบรายได้)
//
// ⚠️ ชุดนี้ต้องครอบ **ทุก Helper** ไม่ใช่แค่ตัวที่มีคนใช้วันนี้ — บั๊กเดิมเกิดเพราะ
// แต่ละตัวสร้าง Error เองแยกกัน 6 ที่แล้วหลุดไม่เท่ากัน (`.details` มีเฉพาะ
// apiPost/apiUpload) ถ้าเทสต์เฉพาะตัวที่ใช้อยู่ ตัวที่เหลือจะ Drift กลับได้อีก
const ERR_BODY = { error: 'PORTFOLIO_NAME_EXISTS', details: { limit: 1, current: 1 } };

function stubFailingFetch(body = ERR_BODY, status = 409) {
  vi.stubGlobal('fetch', async () => ({
    ok: false,
    status,
    json: async () => body,
    blob: async () => null,
    headers: { get: () => '' },
  }));
}

// ทุก Helper ที่โยน Error จาก Response Body ของ Backend (401 เป็นเส้นทางแยกที่
// Redirect ไป Login จึงไม่อยู่ในชุดนี้)
const HELPERS = [
  ['apiGet', () => apiGet('/x')],
  ['apiPost', () => apiPost('/x', {})],
  ['apiPatch', () => apiPatch('/x', {})],
  ['apiDelete', () => apiDelete('/x')],
  ['apiUpload', () => apiUpload('/x', { type: 'image/jpeg' })],
  ['apiDownload', () => apiDownload('/x')],
];

describe('⭐⭐ Error ที่ทุก Helper โยน ต้องมีรูปร่างเดียวกันครบทุกช่อง', () => {
  test.each(HELPERS)('%s → มี .code เป็น Error Code จาก Backend', async (_name, call) => {
    setToken('t');
    stubFailingFetch();

    const err = await call().catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('PORTFOLIO_NAME_EXISTS');
  });

  // ⚠️ `.message` คือช่องที่จุดใช้งานส่วนใหญ่อ่านอยู่จริงวันนี้ (MoveAssetPortfolioDialog,
  // PortfolioSettingsPanel, RecordTransactionModal, Premium) — การเพิ่ม `.code`
  // ต้องเป็น Additive ล้วน **ห้ามทำให้ `.message` เปลี่ยนแม้แต่ตัวเดียว**
  test.each(HELPERS)('%s → .message ยังเป็น Error Code เหมือนเดิมเป๊ะ (Additive ล้วน)', async (_name, call) => {
    setToken('t');
    stubFailingFetch();

    const err = await call().catch((e) => e);

    expect(err.message).toBe('PORTFOLIO_NAME_EXISTS');
  });

  test.each(HELPERS)('%s → .details ถูกส่งต่อครบ ไม่ตกหล่น', async (_name, call) => {
    setToken('t');
    stubFailingFetch();

    const err = await call().catch((e) => e);

    expect(err.details).toEqual({ limit: 1, current: 1 });
  });

  // ⚠️ ต้องแยก "Backend ปฏิเสธด้วยเหตุผล X" ออกจาก "ยิงไม่ถึง/ตอบไม่เป็น JSON" ได้
  // ไม่งั้น Caller จะ Map Error ผิดประเภทแล้วโชว์ข้อความที่ไม่เกี่ยวกับปัญหาจริง
  test.each(HELPERS)('%s → Body ไม่ใช่ JSON (Network/502) → .code เป็น undefined ไม่ใช่ค่ามั่ว', async (_name, call) => {
    setToken('t');
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
      blob: async () => null,
      headers: { get: () => '' },
    }));

    const err = await call().catch((e) => e);

    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
    expect(err.message).toBe('Request failed: 502');
  });
});
