import { describe, test, expect } from 'vitest';
import {
  toThb,
  aggregatePortfolioValueThb,
  donutInvestedThb,
  monthBuyTotalThb,
  monthlyBuyTotalsThb,
  cumulativePrincipalThb,
} from './portfolioMath.js';

// ครอบคลุม 2 กรณีหลักตาม Requirement: พอร์ต THB ล้วน (Backward Compat — usdRate ไม่มีผล)
// และพอร์ตที่มี USD ปน (ต้องแปลงด้วย usdRate ก่อนรวม ไม่บวกดิบข้ามสกุล)

describe('toThb', () => {
  test('THB คืนค่าเดิม (usdRate ไม่มีผล)', () => {
    expect(toThb(1000, 'THB', 35)).toBe(1000);
    expect(toThb(1000, 'THB', null)).toBe(1000);
    expect(toThb(1000, undefined, null)).toBe(1000); // ไม่มี currency = THB
  });

  test('USD + มีเรต → คูณเรต', () => {
    expect(toThb(300, 'USD', 35)).toBe(10500);
  });

  test('USD + ไม่มีเรต → null (แปลงไม่ได้)', () => {
    expect(toThb(300, 'USD', null)).toBeNull();
    expect(toThb(300, 'USD', undefined)).toBeNull();
  });

  test('ค่าไม่ใช่ตัวเลข → null', () => {
    expect(toThb(undefined, 'THB', 35)).toBeNull();
  });
});

describe('aggregatePortfolioValueThb', () => {
  const holdings = [
    { symbol: 'BTC', currency: 'THB' },
    { symbol: 'MSFT', currency: 'USD' },
  ];

  test('พอร์ต THB ล้วน → รวมตรงๆ (usdRate=null ไม่กระทบ)', () => {
    const thbHoldings = [{ symbol: 'BTC', currency: 'THB' }, { symbol: 'PTT', currency: 'THB' }];
    const profits = {
      BTC: { currentValue: 40000, profitLoss: 10000 },
      PTT: { currentValue: 2000, profitLoss: 300 },
    };
    expect(aggregatePortfolioValueThb(thbHoldings, profits, null)).toEqual({
      currentValue: 42000,
      profitLoss: 10300,
      fxUnavailable: false,
      hasAny: true,
    });
  });

  test('พอร์ตปน USD → แปลง USD เป็นบาทก่อนรวม (ไม่บวกดิบ)', () => {
    const profits = {
      BTC: { currentValue: 40000, profitLoss: 10000 }, // THB
      MSFT: { currentValue: 800, profitLoss: 200 }, // USD (Native)
    };
    // BTC 40000 + MSFT 800×35=28000 = 68000 ; PL 10000 + 200×35=7000 = 17000
    expect(aggregatePortfolioValueThb(holdings, profits, 35)).toEqual({
      currentValue: 68000,
      profitLoss: 17000,
      fxUnavailable: false,
      hasAny: true,
    });
  });

  test('มี USD แต่ไม่มีเรต → ข้าม USD + fxUnavailable=true (รวมเฉพาะ THB)', () => {
    const profits = {
      BTC: { currentValue: 40000, profitLoss: 10000 },
      MSFT: { currentValue: 800, profitLoss: 200 },
    };
    expect(aggregatePortfolioValueThb(holdings, profits, null)).toEqual({
      currentValue: 40000,
      profitLoss: 10000,
      fxUnavailable: true,
      hasAny: true,
    });
  });

  test('ไม่มี Holding ไหนมี Profit → currentValue/profitLoss = null', () => {
    expect(aggregatePortfolioValueThb(holdings, {}, 35)).toEqual({
      currentValue: null,
      profitLoss: null,
      fxUnavailable: false,
      hasAny: false,
    });
  });
});

describe('donutInvestedThb', () => {
  test('พอร์ต THB ล้วน → data = totalInvested ตรงๆ', () => {
    const holdings = [
      { symbol: 'BTC', currency: 'THB', totalInvested: 30000 },
      { symbol: 'PTT', currency: 'THB', totalInvested: 1700 },
    ];
    expect(donutInvestedThb(holdings, null)).toEqual({
      labels: ['BTC', 'PTT'],
      data: [30000, 1700],
      fxUnavailable: false,
    });
  });

  test('ปน USD → แปลงเป็นบาทเดียวกันทั้งวง', () => {
    const holdings = [
      { symbol: 'BTC', currency: 'THB', totalInvested: 30000 },
      { symbol: 'MSFT', currency: 'USD', totalInvested: 600 },
    ];
    // MSFT 600×35 = 21000
    expect(donutInvestedThb(holdings, 35)).toEqual({
      labels: ['BTC', 'MSFT'],
      data: [30000, 21000],
      fxUnavailable: false,
    });
  });

  test('USD แต่ไม่มีเรต → ข้าม USD ออกจากวง + fxUnavailable=true', () => {
    const holdings = [
      { symbol: 'BTC', currency: 'THB', totalInvested: 30000 },
      { symbol: 'MSFT', currency: 'USD', totalInvested: 600 },
    ];
    expect(donutInvestedThb(holdings, null)).toEqual({
      labels: ['BTC'],
      data: [30000],
      fxUnavailable: true,
    });
  });
});

describe('monthBuyTotalThb', () => {
  const txs = [
    { type: 'buy', date: '2026-07-05', amountThb: 1000, currency: 'THB' },
    { type: 'buy', date: '2026-07-20', amountThb: 100, currency: 'USD' }, // 100×35 = 3500
    { type: 'sell', date: '2026-07-25', amountThb: 500, currency: 'THB' }, // ไม่นับ (ไม่ใช่ buy)
    { type: 'buy', date: '2026-06-30', amountThb: 9999, currency: 'THB' }, // คนละเดือน
  ];

  test('รวมยอดซื้อเดือน 2026-07 เทียบบาท (แปลง USD ก่อนรวม)', () => {
    expect(monthBuyTotalThb(txs, 35, '2026-07')).toEqual({ sum: 4500, fxUnavailable: false });
  });

  test('THB ล้วน (usdRate=null) ก็รวมได้ปกติ', () => {
    const thbOnly = [{ type: 'buy', date: '2026-07-05', amountThb: 1000, currency: 'THB' }];
    expect(monthBuyTotalThb(thbOnly, null, '2026-07')).toEqual({ sum: 1000, fxUnavailable: false });
  });

  test('USD แต่ไม่มีเรต → ไม่นับ USD + fxUnavailable=true', () => {
    expect(monthBuyTotalThb(txs, null, '2026-07')).toEqual({ sum: 1000, fxUnavailable: true });
  });
});

describe('monthlyBuyTotalsThb', () => {
  test('แยกยอดตามเดือน + แปลง USD', () => {
    const txs = [
      { type: 'buy', date: '2026-06-10', amountThb: 500, currency: 'THB' },
      { type: 'buy', date: '2026-07-10', amountThb: 100, currency: 'USD' }, // 3500
      { type: 'buy', date: '2026-07-15', amountThb: 1000, currency: 'THB' },
    ];
    const { sums, fxUnavailable } = monthlyBuyTotalsThb(txs, 35, ['2026-06', '2026-07']);
    expect(sums).toEqual({ '2026-06': 500, '2026-07': 4500 });
    expect(fxUnavailable).toBe(false);
  });
});

describe('cumulativePrincipalThb', () => {
  test('เงินต้นสะสมเทียบบาท (buy + / sell −) แปลง USD ก่อน', () => {
    const txs = [
      { type: 'buy', date: '2026-07-01', amountThb: 1000, currency: 'THB' },
      { type: 'buy', date: '2026-07-03', amountThb: 100, currency: 'USD' }, // +3500 → 4500
      { type: 'sell', date: '2026-07-05', amountThb: 20, currency: 'USD' }, // −700 → 3800
    ];
    const { points, fxUnavailable } = cumulativePrincipalThb(txs, 35);
    expect(points.map((p) => p.cumulative)).toEqual([1000, 4500, 3800]);
    expect(fxUnavailable).toBe(false);
  });

  test('เรียงตามวันที่เองก่อนสะสม (input ไม่เรียง)', () => {
    const txs = [
      { type: 'buy', date: '2026-07-05', amountThb: 200, currency: 'THB' },
      { type: 'buy', date: '2026-07-01', amountThb: 1000, currency: 'THB' },
    ];
    const { points } = cumulativePrincipalThb(txs, null);
    expect(points).toEqual([
      { date: '2026-07-01', cumulative: 1000 },
      { date: '2026-07-05', cumulative: 1200 },
    ]);
  });

  test('USD ไม่มีเรต → contribute 0 + fxUnavailable=true (ยังคงเส้น THB)', () => {
    const txs = [
      { type: 'buy', date: '2026-07-01', amountThb: 1000, currency: 'THB' },
      { type: 'buy', date: '2026-07-03', amountThb: 100, currency: 'USD' },
    ];
    const { points, fxUnavailable } = cumulativePrincipalThb(txs, null);
    expect(points.map((p) => p.cumulative)).toEqual([1000, 1000]);
    expect(fxUnavailable).toBe(true);
  });
});
