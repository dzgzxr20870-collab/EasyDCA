import { describe, test, expect } from 'vitest';
import { resolvePrefillState } from './dcaPlanPrefill.js';

const SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple แอปเปิล', type: 'stock_us' },
  { symbol: 'PTT', name: 'ปตท.', type: 'stock_th' },
  { symbol: 'BTC', name: 'Bitcoin บิตคอยน์', type: 'crypto' },
];

describe('resolvePrefillState', () => {
  test('null signal → null (ไม่มีอะไรให้ Prefill)', () => {
    expect(resolvePrefillState(null, SYMBOLS)).toBeNull();
  });

  test('หา asset เต็มจาก symbols ได้ถูกต้อง + format จำนวนเงินแบบไทย', () => {
    const result = resolvePrefillState(
      { symbol: 'AAPL', amountTotal: 3000, currency: 'THB', nonce: 111 },
      SYMBOLS
    );
    expect(result).toEqual({
      picked: SYMBOLS[0],
      amountInputStr: (3000).toLocaleString('th-TH'),
      currency: 'THB',
    });
  });

  test('currency USD ผ่านมาตรงๆ (หุ้น US รองรับ USD)', () => {
    const result = resolvePrefillState(
      { symbol: 'AAPL', amountTotal: 100, currency: 'USD', nonce: 222 },
      SYMBOLS
    );
    expect(result.currency).toBe('USD');
  });

  test('currency ไม่มีมาด้วย → Fallback เป็น THB', () => {
    const result = resolvePrefillState({ symbol: 'BTC', amountTotal: 500 }, SYMBOLS);
    expect(result.currency).toBe('THB');
  });

  test('symbol ไม่พบใน symbols (เช่น Registry ลบไปแล้ว) → picked เป็น null ไม่ Throw', () => {
    const result = resolvePrefillState(
      { symbol: 'GONE', amountTotal: 1000, currency: 'THB', nonce: 333 },
      SYMBOLS
    );
    expect(result.picked).toBeNull();
    expect(result.amountInputStr).toBe((1000).toLocaleString('th-TH'));
  });

  test('เรียกซ้ำด้วยค่าเดิมสองครั้งติด (นับเป็น Object ใหม่ทุกครั้งจาก nonce ต่างกัน) → Resolve ผลเหมือนเดิมทุกครั้ง (ไม่ขึ้นกับ State ค้าง)', () => {
    const first = resolvePrefillState(
      { symbol: 'PTT', amountTotal: 2000, currency: 'THB', nonce: 1000 },
      SYMBOLS
    );
    const second = resolvePrefillState(
      { symbol: 'PTT', amountTotal: 2000, currency: 'THB', nonce: 2000 },
      SYMBOLS
    );
    expect(first).toEqual(second);
    expect(second).toEqual({
      picked: SYMBOLS[1],
      amountInputStr: (2000).toLocaleString('th-TH'),
      currency: 'THB',
    });
  });
});
