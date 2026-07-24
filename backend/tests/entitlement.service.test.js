const {
  isPremiumActive,
  getActiveAssetLimit,
  getActiveDcaPlanLimit,
  computeRenewalExpiry,
  FREE_TIER_ASSET_LIMIT,
  FREE_TIER_DCA_PLAN_LIMIT,
} = require('../src/services/entitlement.service');

// ค่าคงที่วันสำหรับทดสอบ (UTC ล้วน) — ใช้ Date คงที่กัน Flaky
const DAY = 24 * 60 * 60 * 1000;

describe('isPremiumActive', () => {
  test('premium + วันหมดอายุอนาคต → true', () => {
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    expect(isPremiumActive({ plan: 'premium', planExpiresAt: future })).toBe(true);
  });

  test('premium + วันหมดอายุอดีต (หมดแล้ว) → false', () => {
    const past = new Date(Date.now() - DAY).toISOString();
    expect(isPremiumActive({ plan: 'premium', planExpiresAt: past })).toBe(false);
  });

  test('premium + planExpiresAt = null → false', () => {
    expect(isPremiumActive({ plan: 'premium', planExpiresAt: null })).toBe(false);
  });

  test('premium + planExpiresAt = undefined → false', () => {
    expect(isPremiumActive({ plan: 'premium' })).toBe(false);
  });

  test('free → false (แม้จะมีวันหมดอายุอนาคตหลงมา)', () => {
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    expect(isPremiumActive({ plan: 'free', planExpiresAt: future })).toBe(false);
  });

  test('user เป็น null/undefined → false (ไม่ throw)', () => {
    expect(isPremiumActive(null)).toBe(false);
    expect(isPremiumActive(undefined)).toBe(false);
  });

  test('รับ Date object โดยตรง (ไม่ใช่ ISO string) ได้', () => {
    const future = new Date(Date.now() + DAY);
    expect(isPremiumActive({ plan: 'premium', planExpiresAt: future })).toBe(true);
  });
});

describe('getActiveAssetLimit', () => {
  test('premium ที่ Active → null (ไม่จำกัด)', () => {
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    expect(getActiveAssetLimit({ plan: 'premium', planExpiresAt: future })).toBeNull();
  });

  test('free → 2 (ตรงกับ FREE_TIER_ASSET_LIMIT)', () => {
    expect(getActiveAssetLimit({ plan: 'free' })).toBe(2);
    expect(getActiveAssetLimit({ plan: 'free' })).toBe(FREE_TIER_ASSET_LIMIT);
  });

  test('premium ที่หมดอายุแล้ว → 2 (ถือเป็น free)', () => {
    const past = new Date(Date.now() - DAY).toISOString();
    expect(getActiveAssetLimit({ plan: 'premium', planExpiresAt: past })).toBe(2);
  });
});

// DCA Planner Gate (Business Model Beta) — Free จำกัด 2 แผน Active (ตรงกับ Asset Limit)
describe('getActiveDcaPlanLimit', () => {
  test('premium ที่ Active → null (ไม่จำกัด)', () => {
    const future = new Date(Date.now() + 30 * DAY).toISOString();
    expect(getActiveDcaPlanLimit({ plan: 'premium', planExpiresAt: future })).toBeNull();
  });

  test('free → 2 (ตรงกับ FREE_TIER_ASSET_LIMIT)', () => {
    expect(getActiveDcaPlanLimit({ plan: 'free' })).toBe(2);
    expect(getActiveDcaPlanLimit({ plan: 'free' })).toBe(FREE_TIER_DCA_PLAN_LIMIT);
    expect(FREE_TIER_DCA_PLAN_LIMIT).toBe(FREE_TIER_ASSET_LIMIT);
  });

  test('premium ที่หมดอายุแล้ว → 2 (ถือเป็น free)', () => {
    const past = new Date(Date.now() - DAY).toISOString();
    expect(getActiveDcaPlanLimit({ plan: 'premium', planExpiresAt: past })).toBe(2);
  });
});

describe('computeRenewalExpiry', () => {
  test('ไม่มี expiry เดิม (null) — monthly เริ่มนับจาก now + 1 เดือน', () => {
    const now = new Date('2026-03-15T00:00:00.000Z');
    const result = computeRenewalExpiry(null, 'monthly', now);
    expect(result.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  test('ไม่มี expiry เดิม (null) — yearly เริ่มนับจาก now + 1 ปี', () => {
    const now = new Date('2026-03-15T00:00:00.000Z');
    const result = computeRenewalExpiry(null, 'yearly', now);
    expect(result.toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });

  test('Stacking: expiry เดิมอยู่อนาคต — ต้องบวกต่อจากวันเดิม ไม่ใช่จาก now (monthly)', () => {
    const now = new Date('2026-03-15T00:00:00.000Z');
    const current = new Date('2026-05-10T00:00:00.000Z'); // ยังเหลืออีกเกือบ 2 เดือน
    const result = computeRenewalExpiry(current, 'monthly', now);
    // ต้องต่อจาก 10 พ.ค. → 10 มิ.ย. (ไม่ใช่ 15 เม.ย. ที่นับจาก now)
    expect(result.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  test('Stacking: expiry เดิมอยู่อนาคต — yearly บวกต่อจากวันเดิม', () => {
    const now = new Date('2026-03-15T00:00:00.000Z');
    const current = new Date('2026-05-10T00:00:00.000Z');
    const result = computeRenewalExpiry(current, 'yearly', now);
    expect(result.toISOString()).toBe('2027-05-10T00:00:00.000Z');
  });

  test('expiry เดิมเลยวันแล้ว (อดีต) — ต้องเริ่มนับจาก now ไม่ใช่ต่อวันเก่า', () => {
    const now = new Date('2026-03-15T00:00:00.000Z');
    const expired = new Date('2026-01-01T00:00:00.000Z'); // หมดไปแล้ว
    const result = computeRenewalExpiry(expired, 'monthly', now);
    // เริ่มจาก now (15 มี.ค.) → 15 เม.ย. ไม่ใช่ต่อจาก 1 ม.ค.
    expect(result.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  test('Rollover ปกติของ JS: 31 ม.ค. + 1 เดือน → เลื่อนไปต้น มี.ค. (ยอมรับได้)', () => {
    const now = new Date('2026-01-31T00:00:00.000Z');
    const result = computeRenewalExpiry(null, 'monthly', now);
    // 31 ก.พ. ไม่มีจริง → JS เลื่อนเป็น 2/3 มี.ค. (2026 ก.พ. มี 28 วัน → +3 วัน)
    expect(result.toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  test('billingPeriod ไม่ถูกต้อง → throw', () => {
    const now = new Date('2026-03-15T00:00:00.000Z');
    expect(() => computeRenewalExpiry(null, 'weekly', now)).toThrow();
  });

  test('ไม่ Mutate อาร์กิวเมนต์ currentExpiresAt เดิม', () => {
    const now = new Date('2026-03-15T00:00:00.000Z');
    const current = new Date('2026-05-10T00:00:00.000Z');
    const snapshot = current.toISOString();
    computeRenewalExpiry(current, 'monthly', now);
    expect(current.toISOString()).toBe(snapshot);
  });
});
