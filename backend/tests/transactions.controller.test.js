jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const transactionService = require('../src/services/transaction.service');
const { createTransaction, undoLast } = require('../src/controllers/transactions.controller');

const USER_ID = 'user-uuid-1';
const USER_RECORD = { id: USER_ID, plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' };

function mockReq(body = {}, userRecord = USER_RECORD) {
  return { user: { id: USER_ID }, userRecord, body };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ดึง Body ที่ตอบกลับไป
function jsonOf(res) {
  return res.json.mock.calls[0][0];
}
function statusOf(res) {
  return res.status.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-07-17T05:00:00Z'), doNotFake: ['performance'] });

  assetRepository.findByUserAndSymbol.mockResolvedValue({
    id: 'asset-1',
    symbol: 'AAPL',
    type: 'stock_us',
  });
  assetRepository.countActiveByUser.mockResolvedValue(1);
  transactionRepository.findAllByUser.mockResolvedValue([]);
  transactionRepository.findAllByAsset.mockResolvedValue([]);
  transactionRepository.create.mockImplementation(async (data) => ({
    ...data,
    id: 'txn-1',
    createdAt: '2026-07-17T12:00:00.000Z',
  }));
  priceFeedService.getCurrentPrice.mockResolvedValue(100);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(100);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-17', stale: false });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('POST /transactions — Validation', () => {
  test('symbol นอก Registry → 400 SYMBOL_NOT_SUPPORTED + ข้อความไทย', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'NOTAREALSYMBOL', amountTotal: 1000 }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('SYMBOL_NOT_SUPPORTED');
    expect(jsonOf(res).message).toMatch(/ยังไม่รองรับสินทรัพย์นี้/);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test.each([
    ['ไม่ส่ง amountTotal', { symbol: 'AAPL' }],
    ['amountTotal = 0', { symbol: 'AAPL', amountTotal: 0 }],
    ['amountTotal ติดลบ', { symbol: 'AAPL', amountTotal: -100 }],
    ['amountTotal ไม่ใช่ตัวเลข', { symbol: 'AAPL', amountTotal: 'abc' }],
    ['amountTotal เป็น String ว่าง', { symbol: 'AAPL', amountTotal: '' }],
    ['amountTotal เป็น boolean', { symbol: 'AAPL', amountTotal: true }],
    ['amountTotal เป็น Array', { symbol: 'AAPL', amountTotal: [] }],
    ['amountTotal = Infinity', { symbol: 'AAPL', amountTotal: Infinity }],
  ])('%s → 400 VALIDATION_ERROR', async (_label, body) => {
    const res = mockRes();
    await createTransaction(mockReq(body), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('หุ้นไทยไม่ส่งราคา → 400 PRICE_REQUIRED_FOR_ASSET (ไม่ใช่ 503 ของ Price Feed)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'a', symbol: 'PTT', type: 'stock_th' });

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'PTT', amountTotal: 1000 }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('PRICE_REQUIRED_FOR_ASSET');
    expect(jsonOf(res).message).toMatch(/ราคาต่อหน่วย/);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('หุ้นไทยส่งราคามาด้วย → บันทึกได้ (ไม่แตะ Price Feed เลย)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'a', symbol: 'PTT', type: 'stock_th' });

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'PTT', amountTotal: 1700, pricePerUnit: 34 }), res);

    expect(statusOf(res)).toBe(201);
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 50, pricePerUnit: 34, amountThb: 1700 })
    );
  });

  test('วันที่อนาคต (เทียบเวลาไทย) → 400 DATE_IN_FUTURE', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000, date: '2026-07-18' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('DATE_IN_FUTURE');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('วันนี้ (ตามเวลาไทย) → บันทึกได้ ไม่ถือเป็นอนาคต', async () => {
    // 2026-07-17T05:00:00Z = เที่ยงวันที่ 17 ตามเวลาไทย → '2026-07-17' ต้องผ่าน
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000, date: '2026-07-17' }), res);

    expect(statusOf(res)).toBe(201);
  });

  test('วันที่ย้อนหลัง → บันทึกด้วยวันนั้น (เส้นทางเดียวกับ Bulk Import)', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000, date: '2025-12-31' }), res);

    expect(statusOf(res)).toBe(201);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2025-12-31' })
    );
  });

  test.each([
    ['รูปแบบผิด', '17/07/2026'],
    ['วันที่ไม่มีจริง', '2026-02-31'],
    ['เดือนเกิน', '2026-13-01'],
  ])('date %s → 400 VALIDATION_ERROR', async (_label, date) => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000, date }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
  });

  test('USD กับหุ้นไทย → 400 CURRENCY_NOT_SUPPORTED_FOR_ASSET', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'a', symbol: 'PTT', type: 'stock_th' });

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'PTT', amountTotal: 1000, pricePerUnit: 34, currency: 'USD' }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('CURRENCY_NOT_SUPPORTED_FOR_ASSET');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('USD กับทองคำ → 400 (ทองเป็นราคาบาททองคำ THB เท่านั้น)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'a', symbol: 'GOLD', type: 'gold_bar' });

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'GOLD', amountTotal: 1000, currency: 'USD' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('CURRENCY_NOT_SUPPORTED_FOR_ASSET');
  });

  test('currency ที่ไม่รู้จัก → 400 VALIDATION_ERROR', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000, currency: 'EUR' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
  });

  test('note ขึ้นต้นด้วย Marker ของระบบ (UNDO_OF:) → 400 NOTE_RESERVED_PREFIX', async () => {
    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', amountTotal: 1000, note: 'UNDO_OF:some-id' }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('NOTE_RESERVED_PREFIX');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('note ยาวเกินกำหนด → 400 VALIDATION_ERROR', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000, note: 'x'.repeat(501) }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
  });

  test('จำนวนเงินน้อยจนคำนวณหน่วยไม่ได้ → 400 (ไม่ปล่อยให้ DB CHECK quantity > 0 พัง)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'a', symbol: 'PTT', type: 'stock_th' });

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'PTT', amountTotal: 0.0000001, pricePerUnit: 1000000 }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('AMOUNT_TOO_SMALL_FOR_PRICE');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

describe('POST /transactions — Success', () => {
  test('บันทึกสำเร็จ → 201 + การ์ดข้อมูล + สรุปเดือนนี้', async () => {
    transactionRepository.findAllByUser.mockResolvedValue([
      { id: 'txn-1', type: 'buy', date: '2026-07-17', amountThb: 1000, currency: 'THB', note: null },
      { id: 'txn-0', type: 'buy', date: '2026-07-02', amountThb: 500, currency: 'THB', note: null },
    ]);

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', amountTotal: 1000, currency: 'THB', note: 'DCA รายเดือน' }),
      res
    );

    expect(statusOf(res)).toBe(201);
    const body = jsonOf(res);
    expect(body.transaction).toEqual(
      expect.objectContaining({
        id: 'txn-1',
        symbol: 'AAPL',
        units: 10,
        pricePerUnit: 100,
        amountTotal: 1000,
        currency: 'THB',
        date: '2026-07-17',
        note: 'DCA รายเดือน',
      })
    );
    expect(body.monthSummary).toEqual({
      month: '2026-07',
      count: 2,
      amountByCurrency: { THB: 1500, USD: 0 },
    });
  });

  test('บันทึกด้วย source = web (แยกช่องทางจาก LINE ใน Ledger)', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000 }), res);

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'web' })
    );
  });

  test('symbol ตัวพิมพ์เล็ก + มีช่องว่าง → Normalize ก่อนบันทึก', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: '  aapl  ', amountTotal: 1000 }), res);

    expect(statusOf(res)).toBe(201);
    expect(jsonOf(res).transaction.symbol).toBe('AAPL');
  });
});

describe('POST /transactions — Error จาก Service', () => {
  test('Free Plan เกิน Asset Limit → 403 ASSET_LIMIT_REACHED', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null); // Asset ใหม่
    assetRepository.countActiveByUser.mockResolvedValue(2);

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', amountTotal: 1000 }, { id: USER_ID, plan: 'free', planExpiresAt: null }),
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('ASSET_LIMIT_REACHED');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ดึงราคาตลาดไม่ได้ → 503 PRICE_FEED_NOT_IMPLEMENTED (ไม่เดาราคา ไม่บันทึก)', async () => {
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000 }), res);

    expect(statusOf(res)).toBe(503);
    expect(jsonOf(res).error).toBe('PRICE_FEED_NOT_IMPLEMENTED');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Error ที่ไม่คาดคิด → 500 INTERNAL_ERROR (ไม่หลุด Error ดิบถึง Client)', async () => {
    transactionRepository.create.mockRejectedValue(new Error('boom: secret internals'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000 }), res);

    expect(statusOf(res)).toBe(500);
    expect(jsonOf(res).error).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(jsonOf(res))).not.toMatch(/secret internals/);
    console.error.mockRestore();
  });
});

describe('POST /transactions/undo-last', () => {
  test('ยกเลิกสำเร็จ → 200 + บอกชัดว่ายกเลิกรายการไหน + สร้าง Reversal (ไม่ลบของเดิม)', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([
      {
        id: 'txn-latest',
        assetId: 'asset-1',
        type: 'buy',
        quantity: 10,
        pricePerUnit: 100,
        amountThb: 1000,
        note: null,
      },
    ]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'txn-latest', assetId: 'asset-1', type: 'buy', quantity: 10, note: null },
    ]);
    assetRepository.findByIds.mockResolvedValue([{ id: 'asset-1', symbol: 'AAPL' }]);

    const res = mockRes();
    await undoLast(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).undone).toEqual(
      expect.objectContaining({ transactionId: 'txn-latest', type: 'buy', symbol: 'AAPL' })
    );
    // Immutable Ledger — ต้อง INSERT รายการตรงข้าม ไม่ใช่ DELETE
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', quantity: 10, note: 'UNDO_OF:txn-latest', source: 'web' })
    );
  });

  test('ไม่มีรายการให้ยกเลิก → 400 NO_TRANSACTION_TO_UNDO', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([]);

    const res = mockRes();
    await undoLast(mockReq(), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('NO_TRANSACTION_TO_UNDO');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('กดยกเลิกซ้ำ (รายการล่าสุดเป็น Reversal อยู่แล้ว) → 400 ALREADY_UNDONE', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([
      { id: 'txn-rev', assetId: 'asset-1', type: 'sell', quantity: 10, note: 'UNDO_OF:txn-old' },
    ]);

    const res = mockRes();
    await undoLast(mockReq(), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('ALREADY_UNDONE');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

describe('Contract กับ transaction.service (กันการ Refactor ทำสัญญาพัง)', () => {
  test('deriveQuantityFromAmount ใช้กฎปัดเศษ 8 ตำแหน่งเดียวกับ Service', () => {
    expect(transactionService.deriveQuantityFromAmount(1000, 190.5)).toBe(5.24934383);
    expect(transactionService.deriveQuantityFromAmount(1700, 34)).toBe(50);
  });
});
