jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/portfolioSummary.service');
jest.mock('../src/services/fxRate.service');
jest.mock('../src/repositories/transaction.repository');

const portfolioService = require('../src/services/portfolio.service');
const portfolioSummaryService = require('../src/services/portfolioSummary.service');
const fxRateService = require('../src/services/fxRate.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const dashboardOverview = require('../src/services/dashboardOverview.service');

const USER_ID = 'user-uuid-1';

// Holding ตัวอย่าง (Shape ตามที่ portfolio.service.getPortfolioSummary คืนจริง)
function holding(overrides = {}) {
  return {
    symbol: 'AAPL',
    name: 'Apple',
    type: 'stock_us',
    currency: 'THB',
    heldQuantity: 10,
    totalInvested: 1000,
    averageCost: 100,
    realizedPnL: 0,
    projId: null,
    fundClassName: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-07-17T05:00:00Z'), doNotFake: ['performance'] });

  transactionRepository.findAllByUser.mockResolvedValue([]);
  portfolioService.getPortfolioSummary.mockResolvedValue({
    holdings: [],
    investedByCurrency: { THB: 0, USD: 0 },
    totalInvested: 0,
    isEmpty: true,
  });
  portfolioSummaryService.buildSummaryForUser.mockResolvedValue(null);
  portfolioSummaryService.priceHoldings.mockResolvedValue([]);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-17', stale: false });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('getOverview — พอร์ตว่าง', () => {
  test('ไม่มีสินทรัพย์ → portfolio.isEmpty = true และไม่พังทั้ง Endpoint', async () => {
    const result = await dashboardOverview.getOverview(USER_ID);

    expect(result.portfolio).toEqual({ isEmpty: true });
    expect(result.streakMonths).toBe(0);
    expect(result.allocation).toEqual([]);
    expect(result.recent).toEqual([]);
    expect(result.monthlyInvested).toHaveLength(12);
  });

  test('พอร์ต THB ล้วน → ไม่ยิง FX เลย (คง Behavior เดิมของระบบ)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding()],
      investedByCurrency: { THB: 1000, USD: 0 },
      totalInvested: 1000,
      isEmpty: false,
    });
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue({
      totalCurrentValue: 1200,
      totalProfitLoss: 200,
      totalProfitLossPercent: 20,
      excludedCount: 0,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
    });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      { holding: holding(), currency: 'THB', price: 120, priceUnavailable: false },
    ]);

    const result = await dashboardOverview.getOverview(USER_ID);

    expect(fxRateService.getUsdThbRate).not.toHaveBeenCalled();
    expect(result.fxRate).toBeNull();
    expect(result.fxUnavailableForUsd).toBe(false);
  });
});

describe('getOverview — มูลค่าพอร์ต + P&L (Reuse ไม่คำนวณใหม่)', () => {
  test('ค่ามาจาก buildSummaryForUser ตรงๆ ไม่ถูกคำนวณซ้ำ', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding({ realizedPnL: 150 })],
      investedByCurrency: { THB: 1000, USD: 0 },
      totalInvested: 1000,
      isEmpty: false,
    });
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue({
      totalCurrentValue: 1234.56,
      totalProfitLoss: 234.56,
      totalProfitLossPercent: 23.46,
      excludedCount: 1,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
    });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      { holding: holding({ realizedPnL: 150 }), currency: 'THB', price: 123, priceUnavailable: false },
    ]);

    const result = await dashboardOverview.getOverview(USER_ID);

    expect(result.portfolio.totalCurrentValue).toBe(1234.56);
    expect(result.portfolio.unrealizedPnL).toBe(234.56);
    expect(result.portfolio.unrealizedPnLPercent).toBe(23.46);
    expect(result.portfolio.excludedCount).toBe(1);
    // Realized P&L รวมจาก holdings ที่ portfolio.service คำนวณไว้แล้ว
    expect(result.portfolio.realizedPnLByCurrency.THB).toBe(150);
  });
});

describe('getOverview — Allocation', () => {
  test('Group ตามประเภท + หุ้นไทยที่ไม่มีราคาสด ตีมูลค่าที่ต้นทุน + flag รายตัว', async () => {
    const us = holding({ symbol: 'AAPL', type: 'stock_us', heldQuantity: 10, totalInvested: 1000 });
    const th = holding({ symbol: 'PTT', type: 'stock_th', heldQuantity: 50, totalInvested: 1700 });

    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [us, th],
      investedByCurrency: { THB: 2700, USD: 0 },
      totalInvested: 2700,
      isEmpty: false,
    });
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue({
      totalCurrentValue: 1200,
      totalProfitLoss: 200,
      totalProfitLossPercent: 20,
      excludedCount: 1,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
    });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      { holding: us, currency: 'THB', price: 120, priceUnavailable: false },
      // หุ้นไทย — ไม่มี Price Feed
      { holding: th, currency: 'THB', price: null, priceUnavailable: true },
    ]);

    const result = await dashboardOverview.getOverview(USER_ID);

    const byType = Object.fromEntries(result.allocation.map((a) => [a.type, a]));

    // หุ้นสหรัฐ: มูลค่าตลาด = 10 × 120
    expect(byType.stock_us.valueThbEquivalent).toBe(1200);
    expect(byType.stock_us.assets[0].priceUnavailable).toBe(false);

    // หุ้นไทย: ไม่มีราคา → ตีที่ "ต้นทุน" 1700 (ไม่ใช่ 0 และไม่หายไปจาก Allocation)
    expect(byType.stock_th.valueThbEquivalent).toBe(1700);
    expect(byType.stock_th.assets[0].priceUnavailable).toBe(true);
    expect(byType.stock_th.assets[0].value).toBe(1700);
  });

  test('เรียงจากมูลค่ามาก → น้อย', async () => {
    const small = holding({ symbol: 'BTC', type: 'crypto', heldQuantity: 1, totalInvested: 100 });
    const big = holding({ symbol: 'AAPL', type: 'stock_us', heldQuantity: 10, totalInvested: 1000 });

    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [small, big],
      investedByCurrency: { THB: 1100, USD: 0 },
      totalInvested: 1100,
      isEmpty: false,
    });
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue({
      totalCurrentValue: 1100,
      totalProfitLoss: 0,
      totalProfitLossPercent: 0,
      excludedCount: 0,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
    });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      { holding: small, currency: 'THB', price: 100, priceUnavailable: false },
      { holding: big, currency: 'THB', price: 120, priceUnavailable: false },
    ]);

    const result = await dashboardOverview.getOverview(USER_ID);

    expect(result.allocation.map((a) => a.type)).toEqual(['stock_us', 'crypto']);
  });

  test('พอร์ตมี USD แต่ดึงเรตไม่ได้ → fxUnavailableForUsd = true (ไม่โชว์ยอดรวมที่ผิด)', async () => {
    const us = holding({ symbol: 'AAPL', currency: 'USD', heldQuantity: 10, totalInvested: 100 });

    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [us],
      investedByCurrency: { THB: 0, USD: 100 },
      totalInvested: 0,
      isEmpty: false,
    });
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue({
      totalCurrentValue: 0,
      totalProfitLoss: 0,
      totalProfitLossPercent: null,
      excludedCount: 0,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
    });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      { holding: us, currency: 'USD', price: 12, priceUnavailable: false },
    ]);
    fxRateService.getUsdThbRate.mockResolvedValue(null); // ดึงเรตไม่ได้

    const result = await dashboardOverview.getOverview(USER_ID);

    expect(result.fxRate).toBeNull();
    expect(result.fxUnavailableForUsd).toBe(true);
    // ยอด USD ยังคงอยู่ในรูปสกุลเดิม ไม่ถูกเดาเป็นบาท
    expect(result.allocation[0].valueByCurrency.USD).toBe(120);
  });
});

describe('getOverview — รายการล่าสุด', () => {
  test('คืน 5 รายการล่าสุดตามลำดับที่ Repository เรียงมา (รวม Reversal ตามความจริง)', async () => {
    const txs = Array.from({ length: 8 }, (_, i) => ({
      id: `tx-${i}`,
      symbol: 'AAPL',
      type: 'buy',
      amountThb: 100 + i,
      currency: 'THB',
      date: `2026-07-1${i}`,
      createdAt: `2026-07-1${i}T10:00:00.000Z`,
      note: null,
      source: 'web',
    }));
    transactionRepository.findAllByUser.mockResolvedValue(txs);

    const result = await dashboardOverview.getOverview(USER_ID);

    expect(result.recent).toHaveLength(5);
    expect(result.recent[0].id).toBe('tx-0');
    expect(result.recent[0]).toEqual(
      expect.objectContaining({ symbol: 'AAPL', side: 'buy', currency: 'THB', source: 'web' })
    );
  });
});

describe('getOverview — สถิติ DCA', () => {
  test('lifetime/thisMonth/streak/กราฟ มาจาก transactions จริง', async () => {
    transactionRepository.findAllByUser.mockResolvedValue([
      { id: 't1', symbol: 'AAPL', type: 'buy', amountThb: 1000, currency: 'THB', date: '2026-07-01', note: null },
      { id: 't2', symbol: 'AAPL', type: 'buy', amountThb: 2000, currency: 'THB', date: '2026-06-01', note: null },
    ]);

    const result = await dashboardOverview.getOverview(USER_ID);

    expect(result.lifetime).toEqual({ count: 2, amountByCurrency: { THB: 3000, USD: 0 } });
    expect(result.thisMonth).toEqual({
      month: '2026-07',
      count: 1,
      amountByCurrency: { THB: 1000, USD: 0 },
    });
    expect(result.streakMonths).toBe(2);

    const july = result.monthlyInvested.find((m) => m.month === '2026-07');
    expect(july.amountByCurrency.THB).toBe(1000);
    expect(july.cumulativeByCurrency.THB).toBe(3000);
  });
});
