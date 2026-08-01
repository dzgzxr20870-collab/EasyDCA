import { describe, test, expect } from 'vitest';
import { buildHoldings, findHolding, buildSellPayload, parseNumberInput, formatUnits } from './sellForm.js';

// allocation ตามรูปแบบจริงของ GET /api/v1/dashboard/overview (API.md §15.4)
const ALLOCATION = [
  {
    type: 'stock_us',
    valueByCurrency: { THB: 0, USD: 5000 },
    valueThbEquivalent: 175000,
    assets: [
      { symbol: 'AAPL', name: 'AAPL', currency: 'USD', units: 12.5, value: 3000, priceUnavailable: false },
      // ขายออกไปหมดแล้ว — แถวยังอยู่แต่ไม่มีอะไรให้ขาย
      { symbol: 'TSLA', name: 'TSLA', currency: 'USD', units: 0, value: 0, priceUnavailable: false },
    ],
  },
  {
    type: 'crypto',
    valueByCurrency: { THB: 128000, USD: 0 },
    valueThbEquivalent: 128000,
    assets: [
      { symbol: 'BTC', name: 'BTC', currency: 'THB', units: 0.05231467, value: 128000, priceUnavailable: false },
    ],
  },
];

describe('buildHoldings', () => {
  test('แบนราบ allocation → รูปแบบเดียวกับ symbols ของ AssetPicker (symbol/name/type)', () => {
    expect(buildHoldings(ALLOCATION)).toEqual([
      { symbol: 'AAPL', name: 'AAPL', type: 'stock_us', units: 12.5, currency: 'USD' },
      { symbol: 'BTC', name: 'BTC', type: 'crypto', units: 0.05231467, currency: 'THB' },
    ]);
  });

  test('ตัดสินทรัพย์ที่ยอดคงเหลือ ≤ 0 ออก (ขายหมดแล้ว = ไม่มีอะไรให้ขาย)', () => {
    const symbols = buildHoldings(ALLOCATION).map((h) => h.symbol);
    expect(symbols).not.toContain('TSLA');
  });

  test('สกุลเงินยึดตามที่ Backend ส่งมา (USD คงเป็น USD, อย่างอื่น Default THB)', () => {
    const holdings = buildHoldings([
      { type: 'crypto', assets: [{ symbol: 'ETH', name: 'ETH', units: 1, currency: undefined }] },
    ]);
    expect(holdings[0].currency).toBe('THB');
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['ไม่ใช่ Array', {}],
    ['Array ว่าง', []],
  ])('allocation %s → [] (พอร์ตว่าง ไม่ Throw)', (_label, value) => {
    expect(buildHoldings(value)).toEqual([]);
  });

  test('group ที่ไม่มี assets → ข้ามไป ไม่ Throw', () => {
    expect(buildHoldings([{ type: 'crypto' }])).toEqual([]);
  });
});

describe('findHolding', () => {
  const HOLDINGS = buildHoldings(ALLOCATION);

  test('เจอ → คืน Object ที่มี units จริง', () => {
    expect(findHolding(HOLDINGS, 'BTC').units).toBe(0.05231467);
  });

  test('ไม่เจอ / symbol undefined → null (ไม่ Throw)', () => {
    expect(findHolding(HOLDINGS, 'DOGE')).toBeNull();
    expect(findHolding(HOLDINGS, undefined)).toBeNull();
  });
});

describe('parseNumberInput', () => {
  test.each([
    ['1000', 1000],
    ['1,250.50', 1250.5],
    ['0.05231467', 0.05231467],
  ])('%s → %s', (raw, expected) => {
    expect(parseNumberInput(raw)).toBe(expected);
  });

  test.each([['', null], ['abc', null], [null, null], [undefined, null]])(
    'ค่าที่ใช้ไม่ได้ (%s) → null',
    (raw, expected) => {
      expect(parseNumberInput(raw)).toBe(expected);
    }
  );
});

describe('formatUnits', () => {
  test('ไม่ตัดทศนิยมของคริปโต (สูงสุด 8 ตำแหน่งตรงกับ NUMERIC(20,8))', () => {
    expect(formatUnits(0.05231467)).toBe((0.05231467).toLocaleString('th-TH', { maximumFractionDigits: 8 }));
  });

  test('ค่าที่ไม่ใช่ตัวเลข → "-" (ไม่โชว์ NaN ให้ผู้ใช้)', () => {
    expect(formatUnits(undefined)).toBe('-');
  });
});

describe('buildSellPayload', () => {
  const BTC = { symbol: 'BTC', name: 'BTC', type: 'crypto', units: 0.05231467, currency: 'THB' };
  const AAPL = { symbol: 'AAPL', name: 'AAPL', type: 'stock_us', units: 12.5, currency: 'USD' };
  const TODAY = '2026-08-01';

  test('ยังไม่เลือกสินทรัพย์ → error (ไม่สร้าง payload)', () => {
    const result = buildSellPayload({ holding: null, quantityInput: '1', priceInput: '1' });
    expect(result.payload).toBeUndefined();
    expect(result.error).toMatch(/เลือกสินทรัพย์/);
  });

  test('กรอกครบ → payload side=sell พร้อมจำนวนหน่วย + ราคา + สกุลของสินทรัพย์', () => {
    const { payload } = buildSellPayload({
      holding: BTC,
      quantityInput: '0.02',
      priceInput: '2,450,000',
      date: TODAY,
      today: TODAY,
      note: '  ขายทำกำไร  ',
    });

    expect(payload).toEqual({
      side: 'sell',
      symbol: 'BTC',
      date: TODAY,
      note: 'ขายทำกำไร',
      quantity: 0.02,
      pricePerUnit: 2450000,
      currency: 'THB',
    });
  });

  test('สกุลเงินล็อกตามสินทรัพย์ที่ถืออยู่ (USD) — ผู้ใช้เลือกเองไม่ได้', () => {
    const { payload } = buildSellPayload({
      holding: AAPL,
      quantityInput: '2',
      priceInput: '190.5',
      date: TODAY,
      today: TODAY,
    });
    expect(payload.currency).toBe('USD');
  });

  test('note ว่าง/มีแต่ช่องว่าง → ไม่ใส่ Key note ลง payload เลย', () => {
    const { payload } = buildSellPayload({
      holding: BTC,
      quantityInput: '0.01',
      priceInput: '100',
      note: '   ',
    });
    expect(payload).not.toHaveProperty('note');
  });

  test('"ขายทั้งหมด" → ส่งแค่ sellAll:true ไม่ส่งจำนวน/ราคา/สกุลที่หน้าเว็บอ่านมา', () => {
    const { payload } = buildSellPayload({
      holding: BTC,
      sellAll: true,
      // แม้ผู้ใช้จะพิมพ์ค้างไว้ ก็ต้องไม่หลุดไปกับ payload (Backend หายอดจริงเอง)
      quantityInput: '0.01',
      priceInput: '999',
      date: TODAY,
      today: TODAY,
    });

    expect(payload).toEqual({ side: 'sell', symbol: 'BTC', date: TODAY, sellAll: true });
    expect(payload).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('pricePerUnit');
    expect(payload).not.toHaveProperty('currency');
  });

  test.each([
    ['ไม่กรอกจำนวน', ''],
    ['จำนวน = 0', '0'],
    ['จำนวนติดลบ', '-1'],
    ['จำนวนไม่ใช่ตัวเลข', 'abc'],
  ])('%s → error ที่ช่อง quantity', (_label, quantityInput) => {
    const result = buildSellPayload({ holding: BTC, quantityInput, priceInput: '100' });
    expect(result.payload).toBeUndefined();
    expect(result.field).toBe('quantity');
  });

  test('ขายเกินยอดที่ถืออยู่ → error พร้อมบอกยอดจริง (เตือนก่อนยิง API)', () => {
    const result = buildSellPayload({ holding: BTC, quantityInput: '1', priceInput: '100' });
    expect(result.payload).toBeUndefined();
    expect(result.field).toBe('quantity');
    expect(result.error).toMatch(/ขายเกินจำนวนที่ถืออยู่/);
    expect(result.error).toContain('BTC');
  });

  test('ขายเท่ายอดคงเหลือพอดี → ผ่าน (ไม่ใช่ "เกิน")', () => {
    const { payload } = buildSellPayload({
      holding: BTC,
      quantityInput: '0.05231467',
      priceInput: '100',
    });
    expect(payload.quantity).toBe(0.05231467);
  });

  test.each([
    ['ไม่กรอกราคา', ''],
    ['ราคา = 0', '0'],
    ['ราคาไม่ใช่ตัวเลข', 'abc'],
  ])('%s → error ที่ช่อง price พร้อมชี้ทาง "ขายทั้งหมด"', (_label, priceInput) => {
    const result = buildSellPayload({ holding: BTC, quantityInput: '0.01', priceInput });
    expect(result.payload).toBeUndefined();
    expect(result.field).toBe('price');
    expect(result.error).toMatch(/ขายทั้งหมด/);
  });

  test('วันที่อนาคต → error ที่ช่อง date (กฎเดียวกับฝั่งซื้อ)', () => {
    const result = buildSellPayload({
      holding: BTC,
      quantityInput: '0.01',
      priceInput: '100',
      date: '2026-08-02',
      today: TODAY,
    });
    expect(result.payload).toBeUndefined();
    expect(result.field).toBe('date');
  });

  test('วันที่อนาคตถูกดักก่อนแม้กด "ขายทั้งหมด" (ไม่ Bypass การตรวจวันที่)', () => {
    const result = buildSellPayload({
      holding: BTC,
      sellAll: true,
      date: '2026-08-02',
      today: TODAY,
    });
    expect(result.payload).toBeUndefined();
    expect(result.field).toBe('date');
  });
});
