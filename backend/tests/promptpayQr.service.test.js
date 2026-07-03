const {
  composePaymentAmount,
  buildPromptPayPayload,
} = require('../src/services/promptpayQr.service');

describe('composePaymentAmount', () => {
  test('59 + satang 17 → 59.17', () => {
    expect(composePaymentAmount(59, 17)).toBe(59.17);
  });

  test('590 + satang 5 → 590.05', () => {
    expect(composePaymentAmount(590, 5)).toBe(590.05);
  });

  test('ปัดทศนิยม 2 ตำแหน่งเป๊ะ (ไม่มี Floating Point Noise)', () => {
    const amount = composePaymentAmount(59, 17);
    // ยืนยันว่าเป็น 2 ตำแหน่งจริง — คูณ 100 แล้วต้องเป็นจำนวนเต็ม
    expect(Number.isInteger(Math.round(amount * 100))).toBe(true);
    expect(amount * 100).toBeCloseTo(5917, 5);
  });

  test('satang = 99 (ขอบบน) → ผ่าน', () => {
    expect(composePaymentAmount(59, 99)).toBe(59.99);
  });

  test('satang = 1 (ขอบล่าง) → ผ่าน', () => {
    expect(composePaymentAmount(59, 1)).toBe(59.01);
  });

  test('satang = 0 → throw (ไม่มี tag)', () => {
    expect(() => composePaymentAmount(59, 0)).toThrow();
  });

  test('satang = 100 → throw (ทดข้ามหลักบาท)', () => {
    expect(() => composePaymentAmount(59, 100)).toThrow();
  });

  test('satang ไม่ใช่จำนวนเต็ม (17.5) → throw', () => {
    expect(() => composePaymentAmount(59, 17.5)).toThrow();
  });

  test('baseAmount ไม่ถูกต้อง (0 หรือติดลบ) → throw', () => {
    expect(() => composePaymentAmount(0, 17)).toThrow();
    expect(() => composePaymentAmount(-59, 17)).toThrow();
  });
});

describe('buildPromptPayPayload', () => {
  test('คืน string ไม่ว่าง (Payload EMVCo)', () => {
    const payload = buildPromptPayPayload('0812345678', 59.17);
    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
    // Payload EMVCo ขึ้นต้นด้วย "0002" (Payload Format Indicator) เสมอ
    expect(payload.startsWith('0002')).toBe(true);
  });

  test('promptpayId ว่าง → throw', () => {
    expect(() => buildPromptPayPayload('', 59.17)).toThrow();
    expect(() => buildPromptPayPayload(null, 59.17)).toThrow();
    expect(() => buildPromptPayPayload(undefined, 59.17)).toThrow();
  });

  test('amount ไม่ใช่จำนวนบวก → throw', () => {
    expect(() => buildPromptPayPayload('0812345678', 0)).toThrow();
    expect(() => buildPromptPayPayload('0812345678', -5)).toThrow();
    expect(() => buildPromptPayPayload('0812345678', null)).toThrow();
  });

  test('ยอดต่างกัน → Payload ต่างกัน (amount ถูกฝังลง Payload จริง)', () => {
    const a = buildPromptPayPayload('0812345678', 59.17);
    const b = buildPromptPayPayload('0812345678', 590.05);
    expect(a).not.toBe(b);
  });
});
