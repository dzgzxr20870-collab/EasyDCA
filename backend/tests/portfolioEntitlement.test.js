const entitlement = require('../src/services/entitlement.service');

// ═══════════════════════════════════════════════════════════════════════════
// Stage 8 — เพดาน/สิทธิ์ของพอร์ต (Pure Logic ไม่ต้อง Mock อะไรเลย)
// ═══════════════════════════════════════════════════════════════════════════
// มติ Founder 23 ส.ค. 2569 § 8.1 — ห้ามเปลี่ยนตัวเลขในไฟล์นี้โดยไม่ถามก่อน

const FREE = { plan: 'free', planExpiresAt: null };
const PREMIUM = { plan: 'premium', planExpiresAt: new Date(Date.now() + 864e5).toISOString() };
const EXPIRED = { plan: 'premium', planExpiresAt: new Date(Date.now() - 864e5).toISOString() };
// plan = premium แต่ไม่มีวันหมดอายุ → entitlement ถือเป็น Free มาแต่เดิม
const PREMIUM_NO_EXPIRY = { plan: 'premium', planExpiresAt: null };

const p = (id, createdAt) => ({ id, createdAt });

describe('getActivePortfolioLimit', () => {
  test('Free → 1 พอร์ต (AI_CONTEXT.md บรรทัด 95: Multiple Portfolio Free ❌)', () => {
    expect(entitlement.getActivePortfolioLimit(FREE)).toBe(1);
  });

  test('Premium Active → Sanity Cap 50 (กัน abuse ไม่ใช่ Monetization Cap)', () => {
    expect(entitlement.getActivePortfolioLimit(PREMIUM)).toBe(50);
  });

  test('Premium หมดอายุ → ถือเป็น Free (1)', () => {
    expect(entitlement.getActivePortfolioLimit(EXPIRED)).toBe(1);
  });

  test('premium ที่ไม่มีวันหมดอายุ → ถือเป็น Free (1) ตามนิยามเดิมของ isPremiumActive', () => {
    expect(entitlement.getActivePortfolioLimit(PREMIUM_NO_EXPIRY)).toBe(1);
  });

  // ⚠️ ต่างจาก getActiveAssetLimit/getActiveDcaPlanLimit ที่คืน null = ไม่จำกัด
  // ตั้งใจให้ไม่มีวันคืน null เพื่อให้ Caller ไม่ต้องมี Branch "null = ไม่จำกัด"
  test('⚠️ ไม่มีวันคืน null — แม้แต่ Premium ก็มีเพดาน', () => {
    expect(entitlement.getActivePortfolioLimit(PREMIUM)).not.toBeNull();
    expect(entitlement.getActivePortfolioLimit(FREE)).not.toBeNull();
  });
});

describe('getWritablePortfolioIds — "อ่านได้ เขียนไม่ได้" ตอน Premium หมดอายุ', () => {
  const THREE = [
    p('c', '2026-03-01T00:00:00.000Z'),
    p('a', '2026-01-01T00:00:00.000Z'),
    p('b', '2026-02-01T00:00:00.000Z'),
  ];

  test('⚠️ Premium หมดอายุ + 3 พอร์ต → เขียนได้เฉพาะพอร์ตที่ created_at เก่าที่สุด', () => {
    const writable = entitlement.getWritablePortfolioIds(EXPIRED, THREE);

    expect(writable.has('a')).toBe(true);
    expect(writable.has('b')).toBe(false);
    expect(writable.has('c')).toBe(false);
  });

  test('⚠️ ไม่ขึ้นกับลำดับที่ส่งเข้ามา — สลับ input แล้วต้องได้ผลเดิมเป๊ะ', () => {
    const shuffled = [THREE[1], THREE[2], THREE[0]];

    expect([...entitlement.getWritablePortfolioIds(EXPIRED, shuffled)]).toEqual(
      [...entitlement.getWritablePortfolioIds(EXPIRED, THREE)]
    );
  });

  // ⚠️ Tie-break จำเป็นจริง ไม่ใช่กันเหนียว: migration 044 Backfill สร้างพอร์ตให้
  // ทุกคนใน Transaction เดียว ซึ่ง now() ของ Postgres คงที่ทั้ง Transaction →
  // created_at เท่ากันทุกตัวอักษร ถ้าไม่ Tie-break ลำดับจะขึ้นกับ Physical Row
  // Order ของ Postgres ซึ่งเปลี่ยนได้หลัง VACUUM/UPDATE
  test('⚠️ created_at เท่ากันเป๊ะ → Tie-break ด้วย id (Deterministic เสมอ)', () => {
    const SAME = '2026-01-01T00:00:00.000Z';
    const same = [p('zzz', SAME), p('aaa', SAME), p('mmm', SAME)];

    for (const order of [same, [...same].reverse()]) {
      const writable = entitlement.getWritablePortfolioIds(EXPIRED, order);
      expect([...writable]).toEqual(['aaa']);
    }
  });

  test('Premium Active + 3 พอร์ต → เขียนได้ทั้งหมด', () => {
    const writable = entitlement.getWritablePortfolioIds(PREMIUM, THREE);

    expect(writable.size).toBe(3);
  });

  test('Free ที่มีพอร์ต Default อันเดียว → เขียนได้ (ไม่ถูกล็อกทั้งที่มีพอร์ตเดียว)', () => {
    const writable = entitlement.getWritablePortfolioIds(FREE, [p('only', '2026-01-01')]);

    expect(writable.has('only')).toBe(true);
  });

  test('Premium Active ที่มี 60 พอร์ต (เกิน Cap) → เขียนได้ 50 อันแรกตาม created_at', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      p(`p${String(i).padStart(2, '0')}`, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`)
    );

    const writable = entitlement.getWritablePortfolioIds(PREMIUM, many);

    expect(writable.size).toBe(50);
    expect(writable.has('p00')).toBe(true);
    expect(writable.has('p49')).toBe(true);
    expect(writable.has('p50')).toBe(false);
  });

  test('รายการว่าง / undefined → Set ว่าง ไม่ throw', () => {
    expect(entitlement.getWritablePortfolioIds(FREE, []).size).toBe(0);
    expect(entitlement.getWritablePortfolioIds(FREE, undefined).size).toBe(0);
  });

  test('ไม่แก้ Array ต้นฉบับ (ไม่ sort in-place ทับของ Caller)', () => {
    const input = [...THREE];
    const before = input.map((x) => x.id);

    entitlement.getWritablePortfolioIds(EXPIRED, input);

    expect(input.map((x) => x.id)).toEqual(before);
  });
});
