jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const { getRecentHistory } = require('../src/services/history.service');

const USER_ID = 'user-uuid-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getRecentHistory — ไม่มีประวัติเลย', () => {
  test('User ยังไม่เคยทำธุรกรรม → คืน Array ว่าง ไม่ Query Asset ต่อ', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([]);

    const history = await getRecentHistory(USER_ID);

    expect(history).toEqual([]);
    expect(assetRepository.findByIds).not.toHaveBeenCalled();
  });
});

describe('getRecentHistory — มีประวัติทั้ง buy และ sell ปนกัน', () => {
  test('Map assetId → symbol ถูกต้อง และคืนครบทุก Field', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([
      {
        id: 'tx-3',
        assetId: 'a-ptt',
        type: 'sell',
        quantity: 10,
        pricePerUnit: 40,
        amountThb: 400,
        date: '2026-07-03',
      },
      {
        id: 'tx-2',
        assetId: 'a-btc',
        type: 'buy',
        quantity: 0.01,
        pricePerUnit: 3400000,
        amountThb: 34000,
        date: '2026-07-02',
      },
      {
        id: 'tx-1',
        assetId: 'a-ptt',
        type: 'buy',
        quantity: 50,
        pricePerUnit: 34,
        amountThb: 1700,
        date: '2026-07-01',
      },
    ]);
    assetRepository.findByIds.mockResolvedValue([
      { id: 'a-ptt', symbol: 'PTT' },
      { id: 'a-btc', symbol: 'BTC' },
    ]);

    const history = await getRecentHistory(USER_ID, 5);

    // ดึง Asset ด้วย Query เดียว ครอบคลุม assetId ที่ไม่ซ้ำกันทั้งหมด
    expect(assetRepository.findByIds).toHaveBeenCalledTimes(1);
    expect(new Set(assetRepository.findByIds.mock.calls[0][0])).toEqual(
      new Set(['a-ptt', 'a-btc'])
    );

    expect(history).toEqual([
      { symbol: 'PTT', type: 'sell', quantity: 10, pricePerUnit: 40, amountThb: 400, date: '2026-07-03' },
      { symbol: 'BTC', type: 'buy', quantity: 0.01, pricePerUnit: 3400000, amountThb: 34000, date: '2026-07-02' },
      { symbol: 'PTT', type: 'buy', quantity: 50, pricePerUnit: 34, amountThb: 1700, date: '2026-07-01' },
    ]);
  });
});

describe('getRecentHistory — เรียงลำดับล่าสุดไปเก่าสุด', () => {
  test('คงลำดับเดิมจาก findRecentByUser (repository เรียง date desc มาแล้ว)', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([
      { id: 'tx-latest', assetId: 'a-1', type: 'buy', quantity: 1, pricePerUnit: 100, amountThb: 100, date: '2026-07-05' },
      { id: 'tx-mid', assetId: 'a-1', type: 'sell', quantity: 1, pricePerUnit: 90, amountThb: 90, date: '2026-07-03' },
      { id: 'tx-oldest', assetId: 'a-1', type: 'buy', quantity: 2, pricePerUnit: 80, amountThb: 160, date: '2026-07-01' },
    ]);
    assetRepository.findByIds.mockResolvedValue([{ id: 'a-1', symbol: 'PTT' }]);

    const history = await getRecentHistory(USER_ID);

    expect(history.map((h) => h.date)).toEqual(['2026-07-05', '2026-07-03', '2026-07-01']);
  });

  test('ใช้ limit ที่ระบุ (Default = 5) ส่งต่อให้ repository', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([]);

    await getRecentHistory(USER_ID);
    expect(transactionRepository.findRecentByUser).toHaveBeenCalledWith(USER_ID, 5);

    await getRecentHistory(USER_ID, 10);
    expect(transactionRepository.findRecentByUser).toHaveBeenCalledWith(USER_ID, 10);
  });
});
