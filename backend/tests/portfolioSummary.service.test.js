jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/priceFeed.service');

const portfolioService = require('../src/services/portfolio.service');
const priceFeedService = require('../src/services/priceFeed.service');
const { buildSummaryForUser } = require('../src/services/portfolioSummary.service');

const USER_ID = 'user-uuid-1';

// Helper สร้าง holding แบบย่อ (พอสำหรับการคำนวณสรุป)
function holding(symbol, heldQuantity, totalInvested) {
  return { symbol, name: symbol, type: 'crypto', heldQuantity, totalInvested, averageCost: 1 };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildSummaryForUser — พอร์ตว่างเปล่า', () => {
  test('isEmpty = true → คืน null (Caller ต้อง Skip ไม่ Push)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [],
      totalInvested: 0,
      isEmpty: true,
    });

    const result = await buildSummaryForUser(USER_ID, 'weekly');

    expect(result).toBeNull();
    // ไม่ต้องไปเรียกราคาถ้าพอร์ตว่าง
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
  });
});

describe('buildSummaryForUser — พอร์ตมี Asset ที่มีราคาตลาด', () => {
  test('รวม currentValue + คำนวณกำไร/ขาดทุนจาก investedWithPriceFeed', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [
        holding('BTC', 0.01, 30000), // 0.01 * 4,000,000 = 40,000
        holding('ETH', 1, 50000), // 1 * 60,000 = 60,000
      ],
      totalInvested: 80000,
      isEmpty: false,
    });
    priceFeedService.getCurrentPrice.mockImplementation(async (symbol) => {
      if (symbol === 'BTC') return 4000000;
      if (symbol === 'ETH') return 60000;
      return null;
    });

    const result = await buildSummaryForUser(USER_ID, 'weekly');

    expect(result.totalInvestedAllAssets).toBe(80000);
    expect(result.totalCurrentValue).toBe(100000); // 40,000 + 60,000
    expect(result.totalProfitLoss).toBe(20000); // 100,000 - 80,000
    expect(result.totalProfitLossPercent).toBe(25); // 20,000 / 80,000 * 100
    expect(result.excludedCount).toBe(0);
    expect(result.periodLabel).toBe('weekly');
  });

  test('ขาดทุน → totalProfitLoss ติดลบ, percent ติดลบ', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding('BTC', 0.01, 50000)], // 0.01 * 4,000,000 = 40,000
      totalInvested: 50000,
      isEmpty: false,
    });
    priceFeedService.getCurrentPrice.mockResolvedValue(4000000);

    const result = await buildSummaryForUser(USER_ID, 'monthly');

    expect(result.totalCurrentValue).toBe(40000);
    expect(result.totalProfitLoss).toBe(-10000);
    expect(result.totalProfitLossPercent).toBe(-20); // -10,000 / 50,000 * 100
    expect(result.periodLabel).toBe('monthly');
  });
});

describe('buildSummaryForUser — Asset บางตัวไม่มีราคาตลาด (หุ้นไทย)', () => {
  test('Asset ที่ราคา null ถูกข้าม → นับ excludedCount, ไม่รวมเข้ายอดคำนวณ', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [
        holding('BTC', 0.01, 30000), // มีราคา
        holding('PTT', 50, 1700), // หุ้นไทย ไม่มี Feed
      ],
      totalInvested: 31700,
      isEmpty: false,
    });
    priceFeedService.getCurrentPrice.mockImplementation(async (symbol) => {
      if (symbol === 'BTC') return 4000000;
      return null; // PTT
    });

    const result = await buildSummaryForUser(USER_ID, 'weekly');

    // totalInvestedAllAssets ยังรวมทั้งพอร์ต (รวม PTT)
    expect(result.totalInvestedAllAssets).toBe(31700);
    // แต่ยอดคำนวณกำไร/ขาดทุนรวมเฉพาะ BTC
    expect(result.totalCurrentValue).toBe(40000); // 0.01 * 4,000,000
    expect(result.totalProfitLoss).toBe(10000); // 40,000 - 30,000
    expect(result.totalProfitLossPercent).toBe(33.33); // 10,000 / 30,000 * 100
    expect(result.excludedCount).toBe(1);
  });
});

describe('buildSummaryForUser — พอร์ตมีเฉพาะหุ้นไทยที่ไม่มี Price Feed เลย', () => {
  test('ทุก Asset ราคา null → investedWithPriceFeed = 0 → percent เป็น null ไม่ Error', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding('PTT', 50, 1700), holding('AOT', 20, 1200)],
      totalInvested: 2900,
      isEmpty: false,
    });
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    const result = await buildSummaryForUser(USER_ID, 'weekly');

    expect(result).not.toBeNull();
    expect(result.totalInvestedAllAssets).toBe(2900);
    expect(result.totalCurrentValue).toBe(0);
    expect(result.totalProfitLoss).toBe(0);
    // หารด้วยศูนย์ถูกป้องกัน → null แทน Infinity/NaN
    expect(result.totalProfitLossPercent).toBeNull();
    expect(result.excludedCount).toBe(2);
  });
});

describe('buildSummaryForUser — กองทุนรวมไทย (Round 7 Mark-to-market)', () => {
  test('(e) กองทุน → ใช้ NAV (last_val) เข้ายอด Current Value ไม่ใช่ getCurrentPrice', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      totalInvested: 1000,
      holdings: [
        { symbol: 'K-SELECT', type: 'fund', projId: 'M0001', fundClassName: 'K-SELECT-A(A)', heldQuantity: 100, totalInvested: 1000 },
      ],
    });
    priceFeedService.getMutualFundNav.mockResolvedValue({ navDate: '2024-11-22', lastVal: 12.5 });

    const result = await buildSummaryForUser('user-1', 'weekly');

    expect(priceFeedService.getMutualFundNav).toHaveBeenCalledWith('M0001', 'K-SELECT-A(A)');
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
    expect(result.totalCurrentValue).toBe(1250); // 100 * 12.5
    expect(result.totalProfitLoss).toBe(250);
    expect(result.excludedCount).toBe(0);
  });

  test('(f) กองทุน NAV ดึงไม่ได้ → นับเป็น excluded (ไม่พังทั้งงาน, Fail Isolated)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      totalInvested: 1000,
      holdings: [
        { symbol: 'K-SELECT', type: 'fund', projId: 'M0001', fundClassName: 'K-SELECT-A(A)', heldQuantity: 100, totalInvested: 1000 },
      ],
    });
    priceFeedService.getMutualFundNav.mockRejectedValue(
      Object.assign(new Error('down'), { code: 'MUTUAL_FUND_NAV_UNAVAILABLE' })
    );

    const result = await buildSummaryForUser('user-1', 'weekly');

    expect(result.excludedCount).toBe(1);
    expect(result.totalCurrentValue).toBe(0);
  });
});
