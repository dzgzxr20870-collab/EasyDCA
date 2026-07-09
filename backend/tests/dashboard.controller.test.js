jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/profit.service');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/user.repository');

const portfolioService = require('../src/services/portfolio.service');
const profitService = require('../src/services/profit.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const userRepository = require('../src/repositories/user.repository');
const { getPortfolio, getHistory, getProfit, getMe } = require('../src/controllers/dashboard.controller');

// profit.service เป็น Automock — ต้องประกาบ ProfitServiceError เองเพราะ
// jest.mock automock ทำให้ Class เดิมหายไป (Pattern เดียวกับที่ต้องระวังใน
// Automock Error Class อื่นๆ ของโปรเจค)
class MockProfitServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProfitServiceError';
    this.code = code;
    this.details = details;
  }
}
profitService.ProfitServiceError = MockProfitServiceError;

const USER_ID = 'user-uuid-1';

function mockReq(overrides = {}) {
  return {
    user: { id: USER_ID, lineUserId: 'U123' },
    query: {},
    params: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPortfolio', () => {
  test('สำเร็จ → 200 พร้อมผลลัพธ์จาก portfolioService.getPortfolioSummary ตรงๆ', async () => {
    const summary = {
      holdings: [{ symbol: 'BTC', heldQuantity: 1, totalInvested: 1000, averageCost: 1000 }],
      totalInvested: 1000,
      isEmpty: false,
    };
    portfolioService.getPortfolioSummary.mockResolvedValue(summary);

    const req = mockReq();
    const res = mockRes();
    await getPortfolio(req, res);

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(USER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(summary);
  });

  test('Error ไม่คาดคิด → 500 INTERNAL_ERROR ไม่หลุด Stack Trace', async () => {
    portfolioService.getPortfolioSummary.mockRejectedValue(new Error('db down'));

    const req = mockReq();
    const res = mockRes();
    await getPortfolio(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
    const jsonArg = res.json.mock.calls[0][0];
    expect(JSON.stringify(jsonArg)).not.toContain('db down');
  });
});

describe('getHistory', () => {
  const ALL_TX = [
    { id: 'tx-1', symbol: 'BTC', type: 'buy', amountThb: 1000, date: '2026-07-03' },
    { id: 'tx-2', symbol: 'ETH', type: 'buy', amountThb: 500, date: '2026-07-02' },
    { id: 'tx-3', symbol: 'BTC', type: 'sell', amountThb: 200, date: '2026-07-01' },
  ];

  test('สำเร็จ (ไม่มี Query Param) → 200 { transactions } ทั้งหมด', async () => {
    transactionRepository.findAllByUser.mockResolvedValue(ALL_TX);

    const req = mockReq();
    const res = mockRes();
    await getHistory(req, res);

    expect(transactionRepository.findAllByUser).toHaveBeenCalledWith(USER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ transactions: ALL_TX });
  });

  test('Filter ด้วย ?symbol=BTC → คืนเฉพาะรายการ BTC', async () => {
    transactionRepository.findAllByUser.mockResolvedValue(ALL_TX);

    const req = mockReq({ query: { symbol: 'btc' } });
    const res = mockRes();
    await getHistory(req, res);

    expect(res.json).toHaveBeenCalledWith({
      transactions: [ALL_TX[0], ALL_TX[2]],
    });
  });

  test('?limit=1 → จำกัดจำนวนผลลัพธ์', async () => {
    transactionRepository.findAllByUser.mockResolvedValue(ALL_TX);

    const req = mockReq({ query: { limit: '1' } });
    const res = mockRes();
    await getHistory(req, res);

    expect(res.json).toHaveBeenCalledWith({ transactions: [ALL_TX[0]] });
  });

  test('Error ไม่คาดคิด → 500 INTERNAL_ERROR', async () => {
    transactionRepository.findAllByUser.mockRejectedValue(new Error('db down'));

    const req = mockReq();
    const res = mockRes();
    await getHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});

describe('getProfit', () => {
  test('สำเร็จ → 200 พร้อมผลลัพธ์จาก profitService.getAssetProfit ตรงๆ', async () => {
    const profit = {
      symbol: 'BTC',
      heldQuantity: 1,
      averageCost: 1000000,
      totalInvested: 1000000,
      currentPrice: 1200000,
      currentValue: 1200000,
      profitLoss: 200000,
      profitLossPercent: 20,
      priceSource: 'coingecko',
    };
    profitService.getAssetProfit.mockResolvedValue(profit);

    const req = mockReq({ params: { symbol: 'BTC' } });
    const res = mockRes();
    await getProfit(req, res);

    expect(profitService.getAssetProfit).toHaveBeenCalledWith(USER_ID, 'BTC');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(profit);
  });

  test('Symbol ตัวพิมพ์เล็ก (btc) → เรียก profitService ด้วยตัวพิมพ์ใหญ่ (BTC)', async () => {
    profitService.getAssetProfit.mockResolvedValue({ symbol: 'BTC' });

    const req = mockReq({ params: { symbol: 'btc' } });
    const res = mockRes();
    await getProfit(req, res);

    expect(profitService.getAssetProfit).toHaveBeenCalledWith(USER_ID, 'BTC');
  });

  test('Symbol ไม่มีในพอร์ต → 404 { error: "ASSET_NOT_FOUND" } (Error Code เดิม)', async () => {
    profitService.getAssetProfit.mockRejectedValue(
      new MockProfitServiceError('ASSET_NOT_FOUND', 'Asset PTT not found for this user', {
        symbol: 'PTT',
      })
    );

    const req = mockReq({ params: { symbol: 'PTT' } });
    const res = mockRes();
    await getProfit(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'ASSET_NOT_FOUND' });
  });

  test('ไม่มี Price Feed → 404 { error: "PRICE_FEED_NOT_IMPLEMENTED" } (Error Code เดิม)', async () => {
    profitService.getAssetProfit.mockRejectedValue(
      new MockProfitServiceError(
        'PRICE_FEED_NOT_IMPLEMENTED',
        'No live price feed available for PTT',
        { symbol: 'PTT' }
      )
    );

    const req = mockReq({ params: { symbol: 'PTT' } });
    const res = mockRes();
    await getProfit(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'PRICE_FEED_NOT_IMPLEMENTED' });
  });

  test('Error ไม่คาดคิด (ไม่ใช่ ProfitServiceError) → 500 INTERNAL_ERROR', async () => {
    profitService.getAssetProfit.mockRejectedValue(new Error('db down'));

    const req = mockReq({ params: { symbol: 'BTC' } });
    const res = mockRes();
    await getProfit(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});

// entitlement.service ไม่ Mock (Pure Logic ไม่มี DB Call) — ใช้ตัวจริงเพื่อยืนยัน
// ว่า getMe เรียก isPremiumActive/getActiveAssetLimit จริง ไม่เทียบ plan เอง
describe('getMe', () => {
  test('Premium Active จริง (plan=premium + planExpiresAt อนาคต) → isPremiumActive: true, assetLimit: null', async () => {
    userRepository.findById.mockResolvedValue({
      id: USER_ID,
      plan: 'premium',
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const req = mockReq();
    const res = mockRes();
    await getMe(req, res);

    expect(userRepository.findById).toHaveBeenCalledWith(USER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ isPremiumActive: true, assetLimit: null })
    );
  });

  test('plan=premium แต่ planExpiresAt หมดอายุแล้ว → isPremiumActive: false, assetLimit: 2', async () => {
    userRepository.findById.mockResolvedValue({
      id: USER_ID,
      plan: 'premium',
      planExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const req = mockReq();
    const res = mockRes();
    await getMe(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ isPremiumActive: false, assetLimit: 2 })
    );
  });

  test('User Free ปกติ → isPremiumActive: false, assetLimit: 2', async () => {
    userRepository.findById.mockResolvedValue({
      id: USER_ID,
      plan: 'free',
      planExpiresAt: null,
    });

    const req = mockReq();
    const res = mockRes();
    await getMe(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'free', isPremiumActive: false, assetLimit: 2 })
    );
  });

  test('คืน role จาก req.user (JWT) ตรงๆ — Admin เห็น role: admin ใน /me', async () => {
    userRepository.findById.mockResolvedValue({ id: USER_ID, plan: 'free', planExpiresAt: null });

    const req = mockReq({ user: { id: USER_ID, lineUserId: 'Uadmin1', role: 'admin' } });
    const res = mockRes();
    await getMe(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
  });

  test('User ไม่พบ (findById คืน null) → 404 USER_NOT_FOUND', async () => {
    userRepository.findById.mockResolvedValue(null);

    const req = mockReq();
    const res = mockRes();
    await getMe(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'USER_NOT_FOUND' });
  });

  test('findById throw Error → 500 INTERNAL_ERROR', async () => {
    userRepository.findById.mockRejectedValue(new Error('db down'));

    const req = mockReq();
    const res = mockRes();
    await getMe(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});
