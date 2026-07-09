jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/portfolioSnapshot.repository');
jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/profit.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const portfolioSnapshotRepository = require('../src/repositories/portfolioSnapshot.repository');
const portfolioService = require('../src/services/portfolio.service');
const profitService = require('../src/services/profit.service');
const { runPortfolioSnapshot } = require('../src/jobs/portfolioSnapshot.job');

const DATE = '2026-07-09';

// Holding ที่ getPortfolioSummary คืน (มีแค่ Field ที่ Job ใช้จริง: symbol)
function holding(symbol) {
  return { symbol, name: symbol, type: 'crypto', heldQuantity: 1, totalInvested: 1000, averageCost: 1000 };
}

// ผลลัพธ์ getAssetProfit ที่ Job ใช้ (currentValue + profitLoss)
function profit(overrides = {}) {
  return { currentValue: 50000, profitLoss: 10000, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  portfolioSnapshotRepository.upsertSnapshot.mockResolvedValue(undefined);
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runPortfolioSnapshot', () => {
  test('ไม่มี User ที่มี Transaction เลย → ไม่ Process ไม่สร้าง Snapshot', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue([]);

    const result = await runPortfolioSnapshot(DATE);

    expect(result).toEqual({ successCount: 0, errorCount: 0 });
    expect(portfolioService.getPortfolioSummary).not.toHaveBeenCalled();
    expect(portfolioSnapshotRepository.upsertSnapshot).not.toHaveBeenCalled();
  });

  test('User มี Holding แต่ isEmpty (ขายหมดแล้ว) → Skip ไม่สร้าง Snapshot', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue(['u1']);
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [], totalInvested: 0, isEmpty: true });

    const result = await runPortfolioSnapshot(DATE);

    expect(result).toEqual({ successCount: 0, errorCount: 0 });
    expect(profitService.getAssetProfit).not.toHaveBeenCalled();
    expect(portfolioSnapshotRepository.upsertSnapshot).not.toHaveBeenCalled();
  });

  test('Holding มีข้อมูล Profit ครบทุกตัว → Snapshot ด้วยค่ารวมถูกต้อง', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue(['u1']);
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding('BTC'), holding('ETH')],
      totalInvested: 30000,
      isEmpty: false,
    });
    profitService.getAssetProfit.mockImplementation(async (userId, symbol) => {
      if (symbol === 'BTC') return profit({ currentValue: 50000, profitLoss: 10000 });
      return profit({ currentValue: 25000, profitLoss: 5000 });
    });

    const result = await runPortfolioSnapshot(DATE);

    expect(result).toEqual({ successCount: 1, errorCount: 0 });
    expect(portfolioSnapshotRepository.upsertSnapshot).toHaveBeenCalledTimes(1);
    expect(portfolioSnapshotRepository.upsertSnapshot).toHaveBeenCalledWith({
      userId: 'u1',
      snapshotDate: DATE,
      totalInvested: 30000,
      totalCurrentValue: 75000,
      totalProfitLoss: 15000,
      excludedAssetCount: 0,
    });
  });

  test('Holding บางตัวไม่มีข้อมูล Profit (หุ้นไทย) → รวมเฉพาะที่มี + excludedAssetCount ถูกต้อง', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue(['u1']);
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding('BTC'), holding('PTT')],
      totalInvested: 30000,
      isEmpty: false,
    });
    profitService.getAssetProfit.mockImplementation(async (userId, symbol) => {
      if (symbol === 'PTT') throw new Error('PRICE_FEED_NOT_IMPLEMENTED');
      return profit({ currentValue: 50000, profitLoss: 10000 });
    });

    await runPortfolioSnapshot(DATE);

    expect(portfolioSnapshotRepository.upsertSnapshot).toHaveBeenCalledWith({
      userId: 'u1',
      snapshotDate: DATE,
      totalInvested: 30000,
      totalCurrentValue: 50000,
      totalProfitLoss: 10000,
      excludedAssetCount: 1,
    });
  });

  test('ทุก Holding ไม่มีข้อมูล Profit เลย → totalCurrentValue/totalProfitLoss เป็น null', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue(['u1']);
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding('PTT'), holding('KBANK')],
      totalInvested: 20000,
      isEmpty: false,
    });
    profitService.getAssetProfit.mockRejectedValue(new Error('PRICE_FEED_NOT_IMPLEMENTED'));

    await runPortfolioSnapshot(DATE);

    expect(portfolioSnapshotRepository.upsertSnapshot).toHaveBeenCalledWith({
      userId: 'u1',
      snapshotDate: DATE,
      totalInvested: 20000,
      totalCurrentValue: null,
      totalProfitLoss: null,
      excludedAssetCount: 2,
    });
  });

  test('Error Isolation: 1 User พัง (DB Error) → User อื่นยังถูก Snapshot ต่อ', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue(['bad', 'ok']);
    portfolioService.getPortfolioSummary.mockImplementation(async (userId) => {
      if (userId === 'bad') throw new Error('db read failed');
      return { holdings: [holding('BTC')], totalInvested: 1000, isEmpty: false };
    });
    profitService.getAssetProfit.mockResolvedValue(profit({ currentValue: 1500, profitLoss: 500 }));

    const result = await runPortfolioSnapshot(DATE);

    expect(result).toEqual({ successCount: 1, errorCount: 1 });
    // User ok ยังถูกบันทึก แม้ bad ล้ม
    expect(portfolioSnapshotRepository.upsertSnapshot).toHaveBeenCalledTimes(1);
    expect(portfolioSnapshotRepository.upsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'ok', totalCurrentValue: 1500, totalProfitLoss: 500 })
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db read failed'));
  });

  test('ดึงรายชื่อ User ล้มเหลว (DB down) → catch ไว้ ไม่ throw คืน 0/0', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockRejectedValue(new Error('db down'));

    const result = await runPortfolioSnapshot(DATE);

    expect(result).toEqual({ successCount: 0, errorCount: 0 });
    expect(portfolioService.getPortfolioSummary).not.toHaveBeenCalled();
    expect(portfolioSnapshotRepository.upsertSnapshot).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  test('ใช้ todayInBangkok เป็น Default เมื่อไม่ส่ง snapshotDate (รูปแบบ YYYY-MM-DD)', async () => {
    transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue(['u1']);
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [holding('BTC')],
      totalInvested: 1000,
      isEmpty: false,
    });
    profitService.getAssetProfit.mockResolvedValue(profit({ currentValue: 1500, profitLoss: 500 }));

    await runPortfolioSnapshot();

    const call = portfolioSnapshotRepository.upsertSnapshot.mock.calls[0][0];
    expect(call.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
