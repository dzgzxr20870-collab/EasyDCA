jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const { getPortfolioSummary } = require('../src/services/portfolio.service');

const USER_ID = 'user-uuid-1';

// Helper สร้าง transaction record แบบย่อ (พอสำหรับการคำนวณพอร์ต)
function tx(type, quantity, amountThb) {
  return { type, quantity, amountThb };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPortfolioSummary — พอร์ตว่างเปล่า', () => {
  test('ไม่มี Asset เลย → isEmpty = true, holdings ว่าง, totalInvested = 0', async () => {
    assetRepository.findActiveByUser.mockResolvedValue([]);

    const summary = await getPortfolioSummary(USER_ID);

    expect(summary.isEmpty).toBe(true);
    expect(summary.holdings).toEqual([]);
    expect(summary.totalInvested).toBe(0);
    expect(transactionRepository.findAllByAsset).not.toHaveBeenCalled();
  });
});

describe('getPortfolioSummary — พอร์ตมีหลาย Asset ที่ยังถืออยู่', () => {
  test('คำนวณ heldQuantity, totalInvested, averageCost ต่อ Asset และสรุปรวม', async () => {
    assetRepository.findActiveByUser.mockResolvedValue([
      { id: 'a-ptt', symbol: 'PTT', name: 'PTT', type: 'stock_th' },
      { id: 'a-btc', symbol: 'BTC', name: 'BTC', type: 'crypto' },
    ]);

    transactionRepository.findAllByAsset.mockImplementation(async (assetId) => {
      if (assetId === 'a-ptt') {
        // ซื้อ 50 @ 34 = 1700, ขาย 10 @ 40 = 400 → เหลือ 40, ลงทุนสุทธิ 1300
        return [tx('buy', 50, 1700), tx('sell', 10, 400)];
      }
      // BTC: ซื้อ 0.01 @ 3,400,000 = 34000 → เหลือ 0.01
      return [tx('buy', 0.01, 34000)];
    });

    const summary = await getPortfolioSummary(USER_ID);

    expect(summary.isEmpty).toBe(false);
    expect(summary.holdings).toHaveLength(2);

    const ptt = summary.holdings.find((h) => h.symbol === 'PTT');
    expect(ptt.heldQuantity).toBe(40);
    expect(ptt.totalInvested).toBe(1300);
    expect(ptt.averageCost).toBe(32.5); // 1300 / 40

    const btc = summary.holdings.find((h) => h.symbol === 'BTC');
    expect(btc.heldQuantity).toBe(0.01);
    expect(btc.totalInvested).toBe(34000);
    expect(btc.averageCost).toBe(3400000); // 34000 / 0.01

    // รวมเงินลงทุนทั้งพอร์ต = 1300 + 34000
    expect(summary.totalInvested).toBe(35300);
  });
});

describe('getPortfolioSummary — Asset ที่ขายหมดแล้ว', () => {
  test('heldQuantity = 0 → ไม่ปรากฏในผลลัพธ์ แม้ is_active ยัง true', async () => {
    assetRepository.findActiveByUser.mockResolvedValue([
      { id: 'a-ptt', symbol: 'PTT', name: 'PTT', type: 'stock_th' },
      { id: 'a-sold', symbol: 'AOT', name: 'AOT', type: 'stock_th' },
    ]);

    transactionRepository.findAllByAsset.mockImplementation(async (assetId) => {
      if (assetId === 'a-ptt') return [tx('buy', 50, 1700)];
      // AOT: ซื้อ 20 แล้วขาย 20 → เหลือ 0 (ขายหมด)
      return [tx('buy', 20, 1000), tx('sell', 20, 1100)];
    });

    const summary = await getPortfolioSummary(USER_ID);

    expect(summary.holdings).toHaveLength(1);
    expect(summary.holdings[0].symbol).toBe('PTT');
    expect(summary.holdings.find((h) => h.symbol === 'AOT')).toBeUndefined();
    // totalInvested รวมเฉพาะ Asset ที่ยังถือ (ไม่รวม AOT ที่ขายหมด)
    expect(summary.totalInvested).toBe(1700);
  });

  test('ทุก Asset ขายหมด → พอร์ตว่าง (isEmpty = true)', async () => {
    assetRepository.findActiveByUser.mockResolvedValue([
      { id: 'a-sold', symbol: 'AOT', name: 'AOT', type: 'stock_th' },
    ]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      tx('buy', 20, 1000),
      tx('sell', 20, 1100),
    ]);

    const summary = await getPortfolioSummary(USER_ID);

    expect(summary.isEmpty).toBe(true);
    expect(summary.holdings).toEqual([]);
    expect(summary.totalInvested).toBe(0);
  });
});

describe('getPortfolioSummary — averageCost ป้องกันหารด้วยศูนย์', () => {
  test('Asset ที่ยังถือ heldQuantity > 0 → averageCost เป็นตัวเลขเสมอ ไม่ใช่ Infinity/NaN', async () => {
    assetRepository.findActiveByUser.mockResolvedValue([
      { id: 'a-ptt', symbol: 'PTT', name: 'PTT', type: 'stock_th' },
    ]);
    transactionRepository.findAllByAsset.mockResolvedValue([tx('buy', 50, 1700)]);

    const summary = await getPortfolioSummary(USER_ID);

    const ptt = summary.holdings[0];
    expect(Number.isFinite(ptt.averageCost)).toBe(true);
    expect(ptt.averageCost).toBe(34); // 1700 / 50
  });
});

// ── Multi-Currency (Round 10): เงินลงทุนแยกสกุล ไม่ถัวข้ามสกุล ──────────────────
describe('getPortfolioSummary — แยกสกุลเงิน (Round 10)', () => {
  // tx พร้อม currency
  const txc = (type, quantity, amountThb, currency) => ({ type, quantity, amountThb, currency });

  test('พอร์ตปน THB (BTC) + USD (MSFT) → investedByCurrency แยกกัน + holding.currency ถูกต้อง', async () => {
    assetRepository.findActiveByUser.mockResolvedValue([
      { id: 'a-btc', symbol: 'BTC', name: 'Bitcoin', type: 'crypto' },
      { id: 'a-msft', symbol: 'MSFT', name: 'Microsoft', type: 'stock_us' },
    ]);
    transactionRepository.findAllByAsset.mockImplementation(async (assetId) =>
      assetId === 'a-btc'
        ? [txc('buy', 0.01, 30000, 'THB')]
        : [txc('buy', 2, 600, 'USD')]
    );

    const summary = await getPortfolioSummary(USER_ID);

    const btc = summary.holdings.find((h) => h.symbol === 'BTC');
    const msft = summary.holdings.find((h) => h.symbol === 'MSFT');
    expect(btc.currency).toBe('THB');
    expect(msft.currency).toBe('USD');
    // avg cost คำนวณในสกุลของตัวเอง ไม่ปน (MSFT = 600/2 = 300 USD)
    expect(msft.averageCost).toBe(300);

    // เงินลงทุนแยกสกุล — ไม่รวม 30000 บาท กับ 600 USD เป็นก้อนเดียว
    expect(summary.investedByCurrency).toEqual({ THB: 30000, USD: 600 });
    // totalInvested (backward compat) = เฉพาะส่วน THB
    expect(summary.totalInvested).toBe(30000);
  });
});
