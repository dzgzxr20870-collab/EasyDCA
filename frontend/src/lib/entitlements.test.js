import { describe, test, expect } from 'vitest';
import {
  fromMeResponse,
  canCreatePortfolio,
  portfolioWriteState,
  UNKNOWN_ENTITLEMENTS,
} from './entitlements.js';

// ═══════════════════════════════════════════════════════════════════════════
// Stage 9 — สิทธิ์จริงจาก Backend (แทน lib/demo/planEntitlements.js ของปลอม)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ไฟล์ที่ทดสอบต้อง **ไม่ Hardcode ตัวเลขเพดานใดๆ** — ทุกตัวเลขมาจาก /me
// เทสต์ชุดนี้จึงพิสูจน์ว่ามัน "ใช้ค่าที่ส่งมา" จริง ไม่ได้แอบมีค่าคงที่ของตัวเอง

describe('fromMeResponse — อ่านเพดานจาก Backend ห้าม Hardcode', () => {
  test('ใช้ค่าที่ Backend ส่งมาตรงๆ (ไม่ว่าเลขจะเป็นเท่าไหร่)', () => {
    const e = fromMeResponse({
      plan: 'premium',
      isPremiumActive: true,
      assetLimit: null,
      portfolioLimit: 50,
      role: 'user',
    });

    expect(e.portfolioLimit).toBe(50);
    expect(e.isPremiumActive).toBe(true);
    expect(e.loaded).toBe(true);
  });

  test('⚠️ เพดานสมมติที่ไม่ใช่ค่ามาตรฐาน → ต้องใช้ตามนั้น (พิสูจน์ว่าไม่ Hardcode)', () => {
    const e = fromMeResponse({ portfolioLimit: 7, assetLimit: 3 });

    expect(e.portfolioLimit).toBe(7);
    expect(e.assetLimit).toBe(3);
  });

  test('Backend ไม่ส่งเพดานมา → null (ไม่เดาค่าเอง)', () => {
    const e = fromMeResponse({ plan: 'free' });

    expect(e.portfolioLimit).toBeNull();
    expect(e.assetLimit).toBeNull();
  });

  test('Response ใช้ไม่ได้ → UNKNOWN (Fail-closed เป็น free)', () => {
    expect(fromMeResponse(null)).toBe(UNKNOWN_ENTITLEMENTS);
    expect(fromMeResponse(undefined).isPremiumActive).toBe(false);
    expect(fromMeResponse('nonsense').loaded).toBe(false);
  });
});

describe('canCreatePortfolio', () => {
  const free = fromMeResponse({ plan: 'free', isPremiumActive: false, portfolioLimit: 1 });
  const premium = fromMeResponse({ plan: 'premium', isPremiumActive: true, portfolioLimit: 50 });

  test('Free ยังไม่มีพอร์ต → กดได้', () => {
    expect(canCreatePortfolio(free, 0)).toEqual({ allowed: true, reason: null });
  });

  test('Free มีพอร์ตครบแล้ว → reason = limit (ชวนอัปเกรดได้)', () => {
    expect(canCreatePortfolio(free, 1)).toEqual({ allowed: false, reason: 'limit' });
  });

  // ⭐ Premium ที่จ่ายเงินอยู่แล้วห้ามโดนชวนอัปเกรด
  test('⚠️ Premium ชน Cap → reason = cap (ไม่ใช่ limit)', () => {
    expect(canCreatePortfolio(premium, 50)).toEqual({ allowed: false, reason: 'cap' });
  });

  test('⚠️ ยังโหลด /me ไม่เสร็จ → Disable ไว้ก่อน ไม่เดาว่าเป็น Premium', () => {
    expect(canCreatePortfolio(UNKNOWN_ENTITLEMENTS, 0)).toEqual({
      allowed: false,
      reason: 'unknown',
    });
  });

  test('ไม่รู้จำนวนพอร์ต → unknown (ไม่เดา)', () => {
    expect(canCreatePortfolio(free, undefined).reason).toBe('unknown');
  });
});

describe('⭐ portfolioWriteState — "ขายได้เสมอ" ห้ามพลาดเด็ดขาด', () => {
  test('พอร์ตที่เขียนได้ → เพิ่มของใหม่ได้ + ลดของเดิมได้', () => {
    expect(portfolioWriteState({ canWrite: true })).toEqual({
      canAdd: true,
      canReduce: true,
      isLocked: false,
    });
  });

  // ⭐ ข้อนี้สำคัญที่สุดในไฟล์ — ถ้า UI ซ่อนปุ่มขายตอนพอร์ตถูกล็อก ผู้ใช้จะคิดว่า
  // ติดกับ แล้วไม่บันทึกการขายที่เกิดขึ้นจริง → ยอดในพอร์ตผิดถาวร
  test('⭐ พอร์ตที่ถูกล็อก → เพิ่มไม่ได้ แต่ canReduce ต้องยังเป็น true', () => {
    expect(portfolioWriteState({ canWrite: false })).toEqual({
      canAdd: false,
      canReduce: true,
      isLocked: true,
    });
  });

  test('⭐ ไม่ว่าข้อมูลจะเป็นอะไร canReduce ต้องเป็น true เสมอ', () => {
    for (const p of [undefined, null, {}, { canWrite: false }, { canWrite: true }]) {
      expect(portfolioWriteState(p).canReduce).toBe(true);
    }
  });

  test('ไม่รู้สถานะ (ยังไม่โหลด) → เพิ่มไม่ได้ แต่ยังไม่ถือว่าถูกล็อก', () => {
    expect(portfolioWriteState(undefined)).toEqual({
      canAdd: false,
      canReduce: true,
      isLocked: false,
    });
  });

  // ⚠️ canWrite ต้องมาจาก Backend เท่านั้น ห้ามคำนวณเองจาก plan
  test('⚠️ ไม่สนใจ plan ของผู้ใช้เลย — ดูแค่ canWrite ที่ Backend ส่งมา', () => {
    expect(portfolioWriteState({ canWrite: true, plan: 'free' }).canAdd).toBe(true);
    expect(portfolioWriteState({ canWrite: false, plan: 'premium' }).canAdd).toBe(false);
  });
});
