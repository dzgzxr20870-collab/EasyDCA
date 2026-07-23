jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/profit.service');
jest.mock('../src/services/fxRate.service');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/storage.service');

const portfolioService = require('../src/services/portfolio.service');
const profitService = require('../src/services/profit.service');
const fxRateService = require('../src/services/fxRate.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const userRepository = require('../src/repositories/user.repository');
const storageService = require('../src/services/storage.service');
const {
  getPortfolio,
  getHistory,
  getProfit,
  getMe,
  getTransactionSlip,
} = require('../src/controllers/dashboard.controller');

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
  test('พอร์ต THB ล้วน → 200 + ไม่ยิง FX + fxRate=null, investedThbEquivalent=THB (Backward Compat)', async () => {
    const summary = {
      holdings: [{ symbol: 'BTC', heldQuantity: 1, totalInvested: 1000, averageCost: 1000, currency: 'THB' }],
      investedByCurrency: { THB: 1000, USD: 0 },
      totalInvested: 1000,
      isEmpty: false,
    };
    portfolioService.getPortfolioSummary.mockResolvedValue(summary);

    const req = mockReq();
    const res = mockRes();
    await getPortfolio(req, res);

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(USER_ID);
    // ไม่มี USD → ไม่ยิง FX
    expect(fxRateService.getUsdThbRate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ...summary,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
      fxUnavailableForUsd: false,
      investedThbEquivalent: 1000,
    });
  });

  test('พอร์ตมี USD ปน → ยิง FX + แนบ fxRate/fxAsOf + investedThbEquivalent เทียบบาท', async () => {
    const summary = {
      holdings: [
        { symbol: 'BTC', heldQuantity: 0.01, totalInvested: 30000, averageCost: 3000000, currency: 'THB' },
        { symbol: 'MSFT', heldQuantity: 2, totalInvested: 600, averageCost: 300, currency: 'USD' },
      ],
      investedByCurrency: { THB: 30000, USD: 600 },
      totalInvested: 30000,
      isEmpty: false,
    };
    portfolioService.getPortfolioSummary.mockResolvedValue(summary);
    fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-11', stale: false });

    const req = mockReq();
    const res = mockRes();
    await getPortfolio(req, res);

    expect(fxRateService.getUsdThbRate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      ...summary,
      fxRate: 35,
      fxAsOf: '2026-07-11',
      fxStale: false,
      fxUnavailableForUsd: false,
      // 30000 + 600×35 = 51000
      investedThbEquivalent: 51000,
    });
  });

  test('มี USD แต่ดึงเรตไม่ได้ → fxUnavailableForUsd=true + investedThbEquivalent = THB เท่านั้น', async () => {
    const summary = {
      holdings: [{ symbol: 'MSFT', heldQuantity: 2, totalInvested: 600, averageCost: 300, currency: 'USD' }],
      investedByCurrency: { THB: 0, USD: 600 },
      totalInvested: 0,
      isEmpty: false,
    };
    portfolioService.getPortfolioSummary.mockResolvedValue(summary);
    fxRateService.getUsdThbRate.mockResolvedValue(null);

    const req = mockReq();
    const res = mockRes();
    await getPortfolio(req, res);

    expect(res.json).toHaveBeenCalledWith({
      ...summary,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
      fxUnavailableForUsd: true,
      investedThbEquivalent: 0,
    });
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

  // S8 — getHistory เติมธง hasSlip (Additive) ให้ทุกแถว และตัด slipImagePath ออกจาก
  // Response (ไม่เปิดเผยโครงสร้าง Storage ให้ Client) — Helper นี้ทำให้ Test เดิม
  // ยังตรวจ "ข้อมูลธุรกรรมที่คืนออกไป" ได้เหมือนเดิมโดยไม่ต้องเขียน field ซ้ำทุกที่
  const withSlip = (txs) => txs.map(({ slipImagePath, ...tx }) => ({
    ...tx,
    hasSlip: Boolean(slipImagePath),
  }));

  test('สำเร็จ (ไม่มี Query Param) → 200 { transactions } ทั้งหมด', async () => {
    transactionRepository.findAllByUser.mockResolvedValue(ALL_TX);

    const req = mockReq();
    const res = mockRes();
    await getHistory(req, res);

    expect(transactionRepository.findAllByUser).toHaveBeenCalledWith(USER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ transactions: withSlip(ALL_TX) });
  });

  test('Filter ด้วย ?symbol=BTC → คืนเฉพาะรายการ BTC', async () => {
    transactionRepository.findAllByUser.mockResolvedValue(ALL_TX);

    const req = mockReq({ query: { symbol: 'btc' } });
    const res = mockRes();
    await getHistory(req, res);

    expect(res.json).toHaveBeenCalledWith({
      transactions: withSlip([ALL_TX[0], ALL_TX[2]]),
    });
  });

  test('?limit=1 → จำกัดจำนวนผลลัพธ์', async () => {
    transactionRepository.findAllByUser.mockResolvedValue(ALL_TX);

    const req = mockReq({ query: { limit: '1' } });
    const res = mockRes();
    await getHistory(req, res);

    expect(res.json).toHaveBeenCalledWith({ transactions: withSlip([ALL_TX[0]]) });
  });

  // ── แนบรูปสลิป (S8) ────────────────────────────────────────────────────
  test('แถวที่มี slipImagePath → hasSlip:true และ "ไม่" ส่ง path ออกไปให้ Client', async () => {
    transactionRepository.findAllByUser.mockResolvedValue([
      { ...ALL_TX[0], slipImagePath: 'user-1-1750000000000.jpg' },
      ALL_TX[1],
    ]);

    const req = mockReq();
    const res = mockRes();
    await getHistory(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.transactions[0].hasSlip).toBe(true);
    expect(body.transactions[1].hasSlip).toBe(false);
    // Path ต้องไม่รั่วออกไป (Bucket เป็น Private — เปิดผ่าน Endpoint เฉพาะเท่านั้น)
    expect(body.transactions[0]).not.toHaveProperty('slipImagePath');
    expect(JSON.stringify(body)).not.toContain('1750000000000.jpg');
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

// ═══════════════════════════════════════════════════════════════════════
// getTransactionSlip — เปิดรูปสลิปต้นฉบับ (S8)
// ═══════════════════════════════════════════════════════════════════════
describe('getTransactionSlip', () => {
  const TX_WITH_SLIP = {
    id: 'tx-1',
    userId: USER_ID,
    slipImagePath: 'user-uuid-1-1750000000000.jpg',
  };

  test('มีสลิป + เป็นเจ้าของ → 200 { signedUrl } (Sign สดตอนกด ไม่เก็บ URL ไว้ใน DB)', async () => {
    transactionRepository.findByIdForUser.mockResolvedValue(TX_WITH_SLIP);
    storageService.createTransactionSlipSignedUrl.mockResolvedValue('https://signed.example/slip.jpg?token=abc');
    storageService.TRANSACTION_SLIP_SIGNED_URL_TTL_SECONDS = 300;

    const req = mockReq({ params: { id: 'tx-1' } });
    const res = mockRes();
    await getTransactionSlip(req, res);

    // ตรวจความเป็นเจ้าของที่ชั้น Query (ส่ง userId ไปกรองด้วย ไม่ใช่ดึงมาแล้วเทียบทีหลัง)
    expect(transactionRepository.findByIdForUser).toHaveBeenCalledWith('tx-1', USER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      signedUrl: 'https://signed.example/slip.jpg?token=abc',
      expiresInSeconds: 300,
    });
  });

  test('ธุรกรรมของคนอื่น (findByIdForUser คืน null) → 404 ไม่บอกใบ้ว่า id มีจริง + ไม่ Sign', async () => {
    transactionRepository.findByIdForUser.mockResolvedValue(null);

    const req = mockReq({ params: { id: 'tx-ของคนอื่น' } });
    const res = mockRes();
    await getTransactionSlip(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'SLIP_NOT_FOUND' });
    expect(storageService.createTransactionSlipSignedUrl).not.toHaveBeenCalled();
  });

  test('ธุรกรรมมีจริงแต่ไม่มีสลิป (พิมพ์เอง) → 404 SLIP_NOT_FOUND ไม่ Sign', async () => {
    transactionRepository.findByIdForUser.mockResolvedValue({ id: 'tx-2', slipImagePath: null });

    const req = mockReq({ params: { id: 'tx-2' } });
    const res = mockRes();
    await getTransactionSlip(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(storageService.createTransactionSlipSignedUrl).not.toHaveBeenCalled();
  });

  test('มีสลิปแต่ Sign ไม่สำเร็จ (ไฟล์หาย/Storage ล่ม) → 502 (แยกจาก 404 "ไม่มีสลิป")', async () => {
    transactionRepository.findByIdForUser.mockResolvedValue(TX_WITH_SLIP);
    storageService.createTransactionSlipSignedUrl.mockResolvedValue(null);

    const req = mockReq({ params: { id: 'tx-1' } });
    const res = mockRes();
    await getTransactionSlip(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'SLIP_UNAVAILABLE' });
  });
});
