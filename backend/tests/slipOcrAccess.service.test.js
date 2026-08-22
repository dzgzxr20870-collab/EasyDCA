const slipOcrAccess = require('../src/services/slipOcrAccess.service');

const { FREE_TRIAL_OCR_LIMIT, FREE_TRIAL_CALL_LIMIT, decideAccess } = slipOcrAccess;

// ═══════════════════════════════════════════════════════════════════════
// slipOcrAccess.decideAccess — ตรรกะล้วน (ไม่แตะ DB) ของสิทธิ์ใช้ AI อ่านสลิป
// ═══════════════════════════════════════════════════════════════════════
describe('slipOcrAccess.decideAccess', () => {
  describe('Premium', () => {
    it('ผ่านเสมอ ไม่สนใจยอดใช้งานสะสมเลย (โควตารายเดือนบังคับใน slipOcr.service แทน)', () => {
      const result = decideAccess({
        isPremiumActive: true,
        lifetimeCount: 9999,
        lifetimeCallCount: 9999,
      });

      expect(result).toEqual({ allowed: true, mode: 'premium' });
    });
  });

  describe('Free — โควตาทดลอง', () => {
    it('ผู้ใช้ใหม่ (ยังไม่เคยใช้) ได้สิทธิ์ทดลองครบตามเพดาน', () => {
      const result = decideAccess({
        isPremiumActive: false,
        lifetimeCount: 0,
        lifetimeCallCount: 0,
      });

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('trial');
      expect(result.trialRemaining).toBe(FREE_TRIAL_OCR_LIMIT);
    });

    it('ใช้ไปแล้วบางส่วน — ยังผ่าน และนับสิทธิ์คงเหลือถูกต้อง', () => {
      const result = decideAccess({
        isPremiumActive: false,
        lifetimeCount: FREE_TRIAL_OCR_LIMIT - 1,
        lifetimeCallCount: FREE_TRIAL_OCR_LIMIT - 1,
      });

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('trial');
      expect(result.trialRemaining).toBe(1);
    });

    it('ใช้ครบเพดานพอดี → ไม่ผ่าน (TRIAL_EXHAUSTED)', () => {
      const result = decideAccess({
        isPremiumActive: false,
        lifetimeCount: FREE_TRIAL_OCR_LIMIT,
        lifetimeCallCount: FREE_TRIAL_OCR_LIMIT,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('TRIAL_EXHAUSTED');
      expect(result.trialRemaining).toBe(0);
    });

    it('ใช้เกินเพดาน (ข้อมูลเก่า/Edge) → ยังไม่ผ่าน และ trialRemaining ไม่ติดลบ', () => {
      const result = decideAccess({
        isPremiumActive: false,
        lifetimeCount: FREE_TRIAL_OCR_LIMIT + 5,
        lifetimeCallCount: FREE_TRIAL_OCR_LIMIT + 5,
      });

      expect(result.allowed).toBe(false);
      expect(result.trialRemaining).toBe(0);
    });
  });

  describe('Free — เพดานคุมต้นทุน (call_count)', () => {
    // นี่คือช่องที่ count เดิมปิดไม่ได้: ส่งรูปที่ "อ่านไม่ออก" จะไม่ถูกนับใน count เลย
    // (slipOcr.service นับ count เฉพาะอ่านสำเร็จ) แต่จ่ายเงินค่า Claude ไปแล้วทุกครั้ง
    it('โควตาทดลองยังเหลือ แต่ชนเพดานการเรียกจริง → ไม่ผ่าน (TRIAL_CALL_LIMIT)', () => {
      const result = decideAccess({
        isPremiumActive: false,
        lifetimeCount: 0, // ยังไม่เคยอ่านสำเร็จสักครั้ง
        lifetimeCallCount: FREE_TRIAL_CALL_LIMIT, // แต่ยิง Claude ไปแล้วเต็มเพดาน
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('TRIAL_CALL_LIMIT');
      // สิทธิ์ทดลองยัง "เหลือ" อยู่จริง — แค่ถูกบล็อกด้วยเพดานต้นทุนคนละตัว
      expect(result.trialRemaining).toBe(FREE_TRIAL_OCR_LIMIT);
    });

    it('ต่ำกว่าเพดานการเรียก 1 ครั้ง → ยังผ่าน', () => {
      const result = decideAccess({
        isPremiumActive: false,
        lifetimeCount: 0,
        lifetimeCallCount: FREE_TRIAL_CALL_LIMIT - 1,
      });

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('trial');
    });

    it('เพดานการเรียกต้องสูงกว่าโควตาทดลองเสมอ — ไม่งั้นผู้ใช้สุจริตโดนบล็อกทั้งที่โควตาเหลือ', () => {
      expect(FREE_TRIAL_CALL_LIMIT).toBeGreaterThan(FREE_TRIAL_OCR_LIMIT);
    });
  });

  describe('ค่าคงที่ต้องตรงกับที่ Founder อนุมัติ', () => {
    it('ทดลองฟรี 3 ครั้งตลอดอายุบัญชี', () => {
      expect(FREE_TRIAL_OCR_LIMIT).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// checkAccess — ตัวห่อที่แตะ DB (Mock repository)
// ═══════════════════════════════════════════════════════════════════════
jest.mock('../src/repositories/aiOcrUsage.repository');
const aiOcrUsageRepository = require('../src/repositories/aiOcrUsage.repository');

describe('slipOcrAccess.checkAccess', () => {
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Premium — ไม่ยิง Query ยอดใช้งานเลย (ประหยัด Query ที่ไม่ได้ใช้ผล)', async () => {
    const result = await slipOcrAccess.checkAccess({
      id: 'u1',
      plan: 'premium',
      planExpiresAt: futureDate,
    });

    expect(result).toEqual({ allowed: true, mode: 'premium' });
    expect(aiOcrUsageRepository.getLifetimeUsage).not.toHaveBeenCalled();
  });

  it('Free — รวมยอดใช้งานทุกเดือนจากถังเดียวกับ Premium (ไม่ใช่ตัวนับใหม่)', async () => {
    aiOcrUsageRepository.getLifetimeUsage.mockResolvedValue({ count: 1, callCount: 2 });

    const result = await slipOcrAccess.checkAccess({ id: 'u2', plan: 'free', planExpiresAt: null });

    expect(aiOcrUsageRepository.getLifetimeUsage).toHaveBeenCalledWith('u2');
    expect(result.allowed).toBe(true);
    expect(result.mode).toBe('trial');
    expect(result.trialRemaining).toBe(FREE_TRIAL_OCR_LIMIT - 1);
  });

  it('Premium ที่หมดอายุแล้ว ถือเป็น Free (Reuse entitlement.isPremiumActive ตัวเดิม)', async () => {
    aiOcrUsageRepository.getLifetimeUsage.mockResolvedValue({ count: 0, callCount: 0 });

    const result = await slipOcrAccess.checkAccess({
      id: 'u3',
      plan: 'premium',
      planExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(result.mode).toBe('trial');
  });

  // ⚠️ Fail-closed: ตรงนี้ "ยังไม่จ่ายเงิน" — เดินต่อทั้งที่บังคับเพดานไม่ได้ =
  // เปิดช่องยิง Claude ฟรีไม่จำกัดแค่ทำให้ DB ล่ม
  it('อ่านยอดใช้งานไม่ได้ (DB ล่ม) → ไม่ให้ผ่าน (Fail-closed)', async () => {
    aiOcrUsageRepository.getLifetimeUsage.mockRejectedValue(new Error('db down'));

    const result = await slipOcrAccess.checkAccess({ id: 'u4', plan: 'free', planExpiresAt: null });

    expect(result.allowed).toBe(false);
  });
});
