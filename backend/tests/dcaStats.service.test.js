const dcaStats = require('../src/services/dcaStats.service');
const { buildReversalNote } = require('../src/services/undoTransaction.service');

// ── Helper สร้างธุรกรรมแบบสั้น ────────────────────────────────────────────────
let seq = 0;
function buy(date, amount = 1000, extra = {}) {
  seq += 1;
  return {
    id: extra.id ?? `tx-${seq}`,
    type: 'buy',
    date,
    amountThb: amount,
    currency: 'THB',
    note: null,
    ...extra,
  };
}
function sell(date, amount = 1000, extra = {}) {
  return buy(date, amount, { ...extra, type: 'sell' });
}

// ตรึงเวลาเครื่องไว้ เพื่อให้ "เดือนนี้" Deterministic — ใช้เวลาจริงของระบบแปลงเป็น
// โซนไทยตามโค้ดจริง (ไม่ Mock todayInBangkok) เพื่อให้เทสต์พิสูจน์ Logic Timezone จริง
function freezeAt(iso) {
  jest.useFakeTimers({ now: new Date(iso), doNotFake: ['performance'] });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('getMonthSummary — DCA เดือนนี้ (Asia/Bangkok)', () => {
  test('นับเฉพาะรายการซื้อของเดือนปัจจุบัน + แยกยอดตามสกุล', () => {
    freezeAt('2026-07-17T05:00:00Z'); // = 12:00 ของวันที่ 17 ก.ค. 2026 ตามเวลาไทย

    const txs = [
      buy('2026-07-01', 1000),
      buy('2026-07-15', 2000),
      buy('2026-07-10', 50, { currency: 'USD' }),
      buy('2026-06-30', 9999), // เดือนก่อน — ไม่นับ
      sell('2026-07-12', 500), // ขาย — ไม่นับเป็น DCA
    ];

    const result = dcaStats.getMonthSummary(txs);

    expect(result.month).toBe('2026-07');
    expect(result.count).toBe(3);
    expect(result.amountByCurrency).toEqual({ THB: 3000, USD: 50 });
  });

  test('ขอบเขตเดือนใช้เวลาไทย ไม่ใช่ UTC (คืนวันสิ้นเดือนช่วงดึก)', () => {
    // 2026-07-31T17:30:00Z = 2026-08-01 00:30 ตามเวลาไทย → "เดือนนี้" ต้องเป็น ส.ค.
    // ถ้าโค้ดเผลอใช้ UTC จะได้ '2026-07' แล้วเทสต์นี้จะแดง
    freezeAt('2026-07-31T17:30:00Z');

    const result = dcaStats.getMonthSummary([buy('2026-08-01', 1000), buy('2026-07-31', 500)]);

    expect(result.month).toBe('2026-08');
    expect(result.count).toBe(1);
    expect(result.amountByCurrency.THB).toBe(1000);
  });

  test('รายการที่ถูกยกเลิกแล้วไม่ถูกนับ (ทั้งตัวต้นฉบับและตัว Reversal)', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const original = buy('2026-07-05', 1000, { id: 'tx-original' });
    const reversal = sell('2026-07-06', 1000, { note: buildReversalNote('tx-original') });

    const result = dcaStats.getMonthSummary([original, reversal, buy('2026-07-07', 2000)]);

    // เหลือแค่รายการ 2000 ที่ไม่ได้ถูกยกเลิก
    expect(result.count).toBe(1);
    expect(result.amountByCurrency.THB).toBe(2000);
  });
});

describe('getStreakMonths', () => {
  test('เดือนนี้มีรายการ → นับรวมเดือนนี้ แล้วไล่ย้อนติดต่อกัน', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const streak = dcaStats.getStreakMonths([
      buy('2026-07-01'),
      buy('2026-06-10'),
      buy('2026-05-20'),
    ]);

    expect(streak).toBe(3);
  });

  test('เดือนนี้ยังไม่มีรายการ → เริ่มนับจากเดือนก่อน (ไม่ตกเป็น 0 ทันที)', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const streak = dcaStats.getStreakMonths([buy('2026-06-10'), buy('2026-05-20')]);

    expect(streak).toBe(2);
  });

  test('ขาดเดือนกลาง → Streak จบที่ช่องว่างนั้น', () => {
    freezeAt('2026-07-17T05:00:00Z');

    // ก.ค. + มิ.ย. ติดกัน แต่ พ.ค. หายไป → นับได้ 2
    const streak = dcaStats.getStreakMonths([
      buy('2026-07-01'),
      buy('2026-06-10'),
      buy('2026-04-20'),
    ]);

    expect(streak).toBe(2);
  });

  test('ข้ามปีนับต่อเนื่องถูกต้อง (ม.ค. → ธ.ค. ปีก่อน)', () => {
    freezeAt('2026-01-10T05:00:00Z');

    const streak = dcaStats.getStreakMonths([
      buy('2026-01-05'),
      buy('2025-12-05'),
      buy('2025-11-05'),
    ]);

    expect(streak).toBe(3);
  });

  test('ไม่มีรายการเลย → 0', () => {
    freezeAt('2026-07-17T05:00:00Z');
    expect(dcaStats.getStreakMonths([])).toBe(0);
  });

  test('เดือนนี้และเดือนก่อนไม่มีเลย → 0 (Streak ขาดแล้ว)', () => {
    freezeAt('2026-07-17T05:00:00Z');
    expect(dcaStats.getStreakMonths([buy('2026-05-01')])).toBe(0);
  });

  test('รายการที่ถูกยกเลิกไม่ต่อ Streak ให้', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const original = buy('2026-06-05', 1000, { id: 'tx-undone' });
    const reversal = sell('2026-06-06', 1000, { note: buildReversalNote('tx-undone') });

    // ก.ค. มีจริง / มิ.ย. มีแต่รายการที่ถูกยกเลิก → Streak = 1 (ไม่ใช่ 2)
    const streak = dcaStats.getStreakMonths([buy('2026-07-01'), original, reversal]);

    expect(streak).toBe(1);
  });
});

describe('getLifetimeSummary', () => {
  test('รวมทุกเดือน + แยกสกุล + ไม่นับรายการที่ยกเลิก', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const original = buy('2026-03-01', 700, { id: 'tx-x' });
    const reversal = sell('2026-03-02', 700, { note: buildReversalNote('tx-x') });

    const result = dcaStats.getLifetimeSummary([
      buy('2025-01-01', 1000),
      buy('2026-07-01', 2000),
      buy('2026-07-02', 25, { currency: 'USD' }),
      original,
      reversal,
    ]);

    expect(result.count).toBe(3);
    expect(result.amountByCurrency).toEqual({ THB: 3000, USD: 25 });
  });
});

describe('getMonthlyInvestedSeries', () => {
  test('คืนครบ 12 เดือนต่อเนื่อง (เดือนที่ไม่มีรายการ = 0) และจบที่เดือนปัจจุบัน', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const series = dcaStats.getMonthlyInvestedSeries([buy('2026-07-01', 1000)], 12);

    expect(series).toHaveLength(12);
    expect(series[0].month).toBe('2025-08');
    expect(series[11].month).toBe('2026-07');
    expect(series[0].amountByCurrency.THB).toBe(0);
    expect(series[11].amountByCurrency.THB).toBe(1000);
  });

  test('cumulative สะสมวิ่งขึ้นตามเดือน และแยกสกุลไม่ปนกัน', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const series = dcaStats.getMonthlyInvestedSeries(
      [
        buy('2026-05-01', 1000),
        buy('2026-06-01', 2000),
        buy('2026-06-02', 10, { currency: 'USD' }),
        buy('2026-07-01', 3000),
      ],
      12
    );

    const byMonth = Object.fromEntries(series.map((s) => [s.month, s]));
    expect(byMonth['2026-05'].cumulativeByCurrency).toEqual({ THB: 1000, USD: 0 });
    expect(byMonth['2026-06'].cumulativeByCurrency).toEqual({ THB: 3000, USD: 10 });
    expect(byMonth['2026-07'].cumulativeByCurrency).toEqual({ THB: 6000, USD: 10 });
    // ยอด USD ไม่ถูกบวกเข้า THB (ห้ามเดา FX ย้อนหลัง)
    expect(byMonth['2026-07'].amountByCurrency).toEqual({ THB: 3000, USD: 0 });
  });

  test('รายการเก่ากว่าหน้าต่าง 12 เดือนไม่ถูกนับเข้า series', () => {
    freezeAt('2026-07-17T05:00:00Z');

    const series = dcaStats.getMonthlyInvestedSeries([buy('2024-01-01', 9999)], 12);

    expect(series.every((s) => s.amountByCurrency.THB === 0)).toBe(true);
  });
});

describe('shiftMonth', () => {
  test('ถอยข้ามปีถูกต้อง', () => {
    expect(dcaStats.shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(dcaStats.shiftMonth('2026-01', -13)).toBe('2024-12');
    expect(dcaStats.shiftMonth('2026-12', -12)).toBe('2025-12');
  });
});
