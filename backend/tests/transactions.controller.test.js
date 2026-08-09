jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');
// storage.service ถูก Mock เพื่อทดสอบ uploadTransactionSlip โดยไม่ยิง Supabase จริง —
// entitlement.service จงใจ "ไม่" Mock (เป็น Pure Logic อยากทดสอบ Gate จริง)
jest.mock('../src/services/storage.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const storageService = require('../src/services/storage.service');
const transactionService = require('../src/services/transaction.service');
const {
  createTransaction,
  undoLast,
  uploadTransactionSlip,
} = require('../src/controllers/transactions.controller');

const USER_ID = 'user-uuid-1';
const USER_RECORD = { id: USER_ID, plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' };
// Free (ไม่มีวันหมดอายุ) — entitlement.isPremiumActive() คืน false → โดน Gate
const FREE_RECORD = { id: USER_ID, plan: 'free', planExpiresAt: null };

function mockReq(body = {}, userRecord = USER_RECORD) {
  return { user: { id: USER_ID }, userRecord, body };
}

// UUID ถูกต้อง (transactions.id เป็น uuid column) — Controller Validate รูปแบบก่อน Query
const TXN_UUID = '11111111-1111-4111-8111-111111111111';

// req สำหรับ Route แนบสลิป (Body เป็น Buffer, มี params.id + get('content-type'))
function mockSlipReq({
  id = TXN_UUID,
  body = Buffer.from('fake-image-bytes'),
  contentType = 'image/jpeg',
  userRecord = USER_RECORD,
} = {}) {
  return {
    user: { id: USER_ID },
    userRecord,
    params: { id },
    body,
    get: (header) => (header.toLowerCase() === 'content-type' ? contentType : undefined),
  };
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

// ═══════════════════════════════════════════════════════════════════════════
// POST /transactions/:id/slip — แนบสลิปหลักฐาน (Premium เท่านั้น, เก็บรูปเฉยๆ ไม่ OCR)
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /transactions/:id/slip — แนบสลิปหลักฐาน (Premium Gate)', () => {
  beforeEach(() => {
    // Default: เป็นเจ้าของรายการ + ยังไม่มีสลิป + ไม่ใช่ Reversal + Upload สำเร็จ
    // (แต่ละ test Override เฉพาะที่ต้องการ) — slipImagePath: null สำคัญต่อ Guard กันแนบทับ
    transactionRepository.findByIdForUser.mockResolvedValue({
      id: TXN_UUID,
      userId: USER_ID,
      slipImagePath: null,
      note: null,
    });
    storageService.uploadTransactionSlip.mockResolvedValue({
      path: `${USER_ID}-1752730000000.jpg`,
      token: '1752730000000.jpg',
    });
    transactionRepository.attachSlipImagePath.mockResolvedValue({ id: TXN_UUID });
    storageService.deleteTransactionSlip.mockResolvedValue(undefined);
  });

  // ── Unit: Entitlement Gate ──────────────────────────────────────────────
  test('Free User → 403 TRANSACTION_SLIP_PREMIUM_REQUIRED (ไม่แตะ Storage/DB เลย)', async () => {
    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq({ userRecord: FREE_RECORD }), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('TRANSACTION_SLIP_PREMIUM_REQUIRED');
    expect(jsonOf(res).message).toMatch(/Premium/);
    // Gate ต้องตัดก่อน "ทุกอย่าง" — ไม่ยิง Storage และไม่แตะ DB (Security Boundary จริง)
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
    expect(transactionRepository.findByIdForUser).not.toHaveBeenCalled();
    expect(transactionRepository.attachSlipImagePath).not.toHaveBeenCalled();
  });

  test('Premium (plan=premium แต่ planExpiresAt หมดอายุแล้ว) → ยังโดน Gate 403', async () => {
    const res = mockRes();
    const expired = { id: USER_ID, plan: 'premium', planExpiresAt: '2000-01-01T00:00:00.000Z' };
    await uploadTransactionSlip(mockSlipReq({ userRecord: expired }), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('TRANSACTION_SLIP_PREMIUM_REQUIRED');
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
  });

  // ── Integration: Premium แนบสำเร็จ ──────────────────────────────────────
  test('Premium + รายการเป็นของตัวเอง + ไฟล์ถูกต้อง → 200 + แนบ path เข้าธุรกรรม', async () => {
    const res = mockRes();
    const buffer = Buffer.from('fake-image-bytes');
    await uploadTransactionSlip(mockSlipReq({ id: TXN_UUID, body: buffer }), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).status).toBe('slip_attached');
    // ตรวจ Ownership ที่ชั้น Query (กรอง user_id พร้อมกัน)
    expect(transactionRepository.findByIdForUser).toHaveBeenCalledWith(TXN_UUID, USER_ID);
    // Upload ด้วย userId ที่ Authenticate แล้ว (ไม่ใช่ค่าจาก Client) + buffer + content-type จริง
    expect(storageService.uploadTransactionSlip).toHaveBeenCalledWith(USER_ID, buffer, 'image/jpeg');
    // แนบ path ที่ Storage คืนมาเข้าธุรกรรม (slip_image_path — migration 021)
    expect(transactionRepository.attachSlipImagePath).toHaveBeenCalledWith(
      TXN_UUID,
      `${USER_ID}-1752730000000.jpg`,
      USER_ID
    );
  });

  // ── Integration: ไม่ใช่เจ้าของ → กันแนบสลิปเข้าธุรกรรมคนอื่นด้วยการเดา id ──────
  test('Premium แต่ id ไม่ใช่ของตัวเอง (findByIdForUser → null) → 404 (ไม่ Upload)', async () => {
    transactionRepository.findByIdForUser.mockResolvedValue(null);

    const res = mockRes();
    // id เป็น UUID ถูกต้อง (ผ่าน Format Guard) แต่ไม่ใช่ของ User → findByIdForUser คืน null
    await uploadTransactionSlip(mockSlipReq({ id: '22222222-2222-4222-8222-222222222222' }), res);

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('TRANSACTION_NOT_FOUND');
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
    expect(transactionRepository.attachSlipImagePath).not.toHaveBeenCalled();
  });

  // ── P2-4: id รูปแบบผิด (ไม่ใช่ UUID) → 404 ก่อนแตะ DB (ไม่ใช่ 500 จาก Postgres 22P02) ──
  test('id ไม่ใช่ UUID → 404 TRANSACTION_NOT_FOUND (ไม่เรียก findByIdForUser)', async () => {
    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq({ id: 'not-a-uuid' }), res);

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('TRANSACTION_NOT_FOUND');
    expect(transactionRepository.findByIdForUser).not.toHaveBeenCalled();
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
  });

  // ── P1-2: กันแนบทับหลักฐานเดิม (โดยเฉพาะรายการจาก LINE OCR ที่มีสลิปแล้ว) ──────
  test('รายการมี slip_image_path อยู่แล้ว → 409 SLIP_ALREADY_ATTACHED (ไม่ Upload/ไม่ทับ)', async () => {
    transactionRepository.findByIdForUser.mockResolvedValue({
      id: TXN_UUID,
      userId: USER_ID,
      slipImagePath: `${USER_ID}-1700000000000.jpg`, // มาจาก LINE OCR เดิม
      note: null,
    });

    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq(), res);

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('SLIP_ALREADY_ATTACHED');
    // สำคัญ: ต้องไม่อัปโหลดไฟล์ใหม่ (ไม่ทับ path เดิม = หลักฐานเดิมไม่หาย, ไม่เกิด Orphan)
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
    expect(transactionRepository.attachSlipImagePath).not.toHaveBeenCalled();
  });

  // ── P2-5: ไม่แนบให้รายการย้อน (Reversal — note ขึ้นต้น UNDO_OF:) ─────────────
  test('รายการเป็น Reversal (note = UNDO_OF:...) → 409 CANNOT_ATTACH_TO_REVERSAL (ไม่ Upload)', async () => {
    transactionRepository.findByIdForUser.mockResolvedValue({
      id: TXN_UUID,
      userId: USER_ID,
      slipImagePath: null,
      note: 'UNDO_OF:99999999-9999-4999-8999-999999999999',
    });

    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq(), res);

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('CANNOT_ATTACH_TO_REVERSAL');
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
  });

  // ── P1-3: attach ล้มเหลว "หลัง" upload สำเร็จ → ลบไฟล์ที่เพิ่งอัปโหลด (กัน Orphan) ──
  test('attachSlipImagePath throw หลัง upload สำเร็จ → 500 + ลบไฟล์ที่อัปโหลด (Compensating)', async () => {
    transactionRepository.attachSlipImagePath.mockRejectedValue(new Error('DB down'));

    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq(), res);

    expect(statusOf(res)).toBe(500);
    expect(jsonOf(res).error).toBe('INTERNAL_ERROR');
    // ไฟล์ที่ uploadTransactionSlip คืน path มาแล้ว ต้องถูกลบทิ้ง (ไม่ปล่อย Orphan)
    expect(storageService.deleteTransactionSlip).toHaveBeenCalledWith(
      `${USER_ID}-1752730000000.jpg`
    );
  });

  test('attach ล้มเหลว "และ" ลบไฟล์ก็ล้มเหลว → ยัง 500 + Log path Orphan ไว้ตามเก็บ', async () => {
    transactionRepository.attachSlipImagePath.mockRejectedValue(new Error('DB down'));
    storageService.deleteTransactionSlip.mockRejectedValue(new Error('storage down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq(), res);

    expect(statusOf(res)).toBe(500);
    // ต้อง Log path ที่ค้าง (ORPHAN) ให้ตามเก็บได้ — ห้ามหายเงียบ
    const loggedOrphan = errSpy.mock.calls.some(
      (c) => String(c[0]).includes('ORPHAN') && String(c[0]).includes(`${USER_ID}-1752730000000.jpg`)
    );
    expect(loggedOrphan).toBe(true);
    errSpy.mockRestore();
  });

  // ── Unit: Body ว่าง / ชนิดไฟล์ผิด / ใหญ่เกิน ─────────────────────────────
  test('Body ว่าง (ไม่มีไฟล์) → 400 EMPTY_BODY (ไม่แตะ DB/Storage)', async () => {
    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq({ body: Buffer.alloc(0) }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('EMPTY_BODY');
    expect(transactionRepository.findByIdForUser).not.toHaveBeenCalled();
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
  });

  test('ชนิดไฟล์ไม่ใช่รูป (StorageServiceError) → 415 INVALID_SLIP_CONTENT_TYPE (ไม่แนบ path)', async () => {
    const err = new Error('bad type');
    err.name = 'StorageServiceError';
    err.code = 'INVALID_SLIP_CONTENT_TYPE';
    storageService.uploadTransactionSlip.mockRejectedValue(err);

    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq({ contentType: 'application/pdf' }), res);

    expect(statusOf(res)).toBe(415);
    expect(jsonOf(res).error).toBe('INVALID_SLIP_CONTENT_TYPE');
    expect(transactionRepository.attachSlipImagePath).not.toHaveBeenCalled();
  });

  test('ไฟล์ใหญ่เกิน 10MB (StorageServiceError) → 413 SLIP_TOO_LARGE (ไม่แนบ path)', async () => {
    const err = new Error('too large');
    err.name = 'StorageServiceError';
    err.code = 'SLIP_TOO_LARGE';
    storageService.uploadTransactionSlip.mockRejectedValue(err);

    const res = mockRes();
    await uploadTransactionSlip(mockSlipReq(), res);

    expect(statusOf(res)).toBe(413);
    expect(jsonOf(res).error).toBe('SLIP_TOO_LARGE');
    expect(transactionRepository.attachSlipImagePath).not.toHaveBeenCalled();
  });
});

// ── Regression (Red-Green): การแนบสลิปเป็น "Optional" — ต้องไม่ทำ Flow เดิมพัง ──────
describe('Regression — บันทึก DCA โดยไม่แนบสลิป (Use Case เดิม) ยังทำงานปกติ', () => {
  test('createTransaction ไม่แตะ Logic สลิปเลย (ไม่เรียก uploadTransactionSlip/attachSlipImagePath)', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000 }), res);

    expect(statusOf(res)).toBe(201);
    // เส้นทางบันทึกปกติต้องไม่ยุ่งกับสลิปใดๆ — แนบสลิปเป็นขั้นแยกที่ผู้ใช้เลือกทำหรือไม่ก็ได้
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
    expect(transactionRepository.attachSlipImagePath).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ฝั่งขาย (side='sell') — แตะ Ledger โดยตรง (AI_WORK_POLICY § 4.1)
// ═══════════════════════════════════════════════════════════════════════════
// Controller ไม่คำนวณเงินเองแม้แต่บรรทัดเดียว — ทุกเคสด้านล่างจึงยืนยัน 2 อย่างคู่กัน
// เสมอ: (1) Response ที่ผู้ใช้เห็น (2) Argument ที่ไหลถึง transactionRepository.create
// (= แถวที่จะถูก INSERT จริงลง Ledger) ไม่ใช่แค่ Status Code

// ประวัติธุรกรรมของ Asset (calculateHeldQuantity อ่าน type + quantity, deriveAssetCurrency
// อ่าน currency) — ใช้ตั้ง "ยอดคงเหลือจริง" ที่ validateSell จะคำนวณได้
function holdingHistory(quantity, currency = 'THB') {
  return [{ id: 'txn-buy-1', assetId: 'asset-1', type: 'buy', quantity, currency }];
}

describe('POST /transactions (side=sell) — Validation', () => {
  test.each([
    ['side ไม่รู้จัก', { symbol: 'AAPL', side: 'short', quantity: 1, pricePerUnit: 100 }],
    ['ไม่ส่ง quantity', { symbol: 'AAPL', side: 'sell', pricePerUnit: 100 }],
    ['quantity = 0', { symbol: 'AAPL', side: 'sell', quantity: 0, pricePerUnit: 100 }],
    ['quantity ติดลบ', { symbol: 'AAPL', side: 'sell', quantity: -1, pricePerUnit: 100 }],
    ['quantity ไม่ใช่ตัวเลข', { symbol: 'AAPL', side: 'sell', quantity: 'abc', pricePerUnit: 100 }],
    ['quantity เป็น boolean', { symbol: 'AAPL', side: 'sell', quantity: true, pricePerUnit: 100 }],
  ])('%s → 400 VALIDATION_ERROR (ไม่แตะ Ledger)', async (_label, body) => {
    const res = mockRes();
    await createTransaction(mockReq(body), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขายโดยไม่กรอกราคา → 400 SELL_PRICE_REQUIRED (ชี้ทางออกให้กด "ขายทั้งหมด")', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', side: 'sell', quantity: 1 }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('SELL_PRICE_REQUIRED');
    expect(jsonOf(res).message).toMatch(/ราคาที่ขายได้ต่อหน่วย/);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขายวันที่อนาคต → 400 DATE_IN_FUTURE (กฎเดียวกับฝั่งซื้อ)', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(10));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', side: 'sell', quantity: 1, pricePerUnit: 100, date: '2026-07-18' }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('DATE_IN_FUTURE');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('sellAll ต้องเป็น true แท้ๆ — ส่ง "true" (String) ไม่นับ จึงยังบังคับ quantity', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', side: 'sell', sellAll: 'true' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

describe('POST /transactions (side=sell) — Business Rule จาก validateSell', () => {
  test('ไม่เคยถือสินทรัพย์นี้ → 400 ASSET_NOT_FOUND (ไม่ใช่ 500)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', side: 'sell', quantity: 1, pricePerUnit: 100 }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('ASSET_NOT_FOUND');
    expect(jsonOf(res).message).toMatch(/ยังไม่มีสินทรัพย์นี้ในพอร์ต/);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขายเกินยอดที่ถืออยู่จริง → 400 INSUFFICIENT_QUANTITY + บอกยอดจริงใน details', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(2));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', side: 'sell', quantity: 5, pricePerUnit: 100 }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('INSUFFICIENT_QUANTITY');
    expect(jsonOf(res).message).toMatch(/เกินจำนวนที่ถืออยู่จริง/);
    expect(jsonOf(res).details).toEqual({ requested: 5, held: 2 });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขายเท่ายอดคงเหลือพอดี → ผ่าน (ไม่ใช่ "เกิน")', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(2));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', side: 'sell', quantity: 2, pricePerUnit: 100 }),
      res
    );

    expect(statusOf(res)).toBe(201);
    expect(jsonOf(res).transaction.remainingQuantity).toBe(0);
  });

  test('"ขายทั้งหมด" แต่ขายออกไปหมดแล้ว → 400 NOTHING_TO_SELL', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 't1', type: 'buy', quantity: 3, currency: 'THB' },
      { id: 't2', type: 'sell', quantity: 3, currency: 'THB' },
    ]);

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', side: 'sell', sellAll: true }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('NOTHING_TO_SELL');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('"ขายทั้งหมด" แต่ดึงราคาตลาดไม่ได้ → 503 MARKET_PRICE_UNAVAILABLE (ไม่เดาราคา)', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(2));
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', side: 'sell', sellAll: true }), res);

    expect(statusOf(res)).toBe(503);
    expect(jsonOf(res).error).toBe('MARKET_PRICE_UNAVAILABLE');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

describe('POST /transactions (side=sell) — บันทึกสำเร็จ', () => {
  test('ขายตามจำนวนหน่วย + ราคาที่ขายได้ → INSERT type=sell, source=web, ยอดเงิน = หน่วย × ราคา', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(10));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', side: 'sell', quantity: 4, pricePerUnit: 250, note: 'ขายทำกำไร' }),
      res
    );

    expect(statusOf(res)).toBe(201);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset-1',
        type: 'sell',
        quantity: 4,
        pricePerUnit: 250,
        amountThb: 1000,
        currency: 'THB',
        date: '2026-07-17',
        note: 'ขายทำกำไร',
        source: 'web',
      })
    );
    expect(jsonOf(res).transaction).toEqual(
      expect.objectContaining({
        side: 'sell',
        symbol: 'AAPL',
        units: 4,
        pricePerUnit: 250,
        amountTotal: 1000,
        currency: 'THB',
        // Service คำนวณให้ (10 - 4) — Controller/Frontend ไม่ลบเอง
        remainingQuantity: 6,
      })
    );
    // ขายต้องไม่สร้าง Asset ใหม่เด็ดขาด
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  test('ขายหุ้นไทย (ไม่มี Price Feed) → บันทึกได้ โดยไม่แตะ Price Feed เลย', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'asset-1', symbol: 'PTT', type: 'stock_th' });
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(100));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'PTT', side: 'sell', quantity: 50, pricePerUnit: 36 }),
      res
    );

    expect(statusOf(res)).toBe(201);
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', quantity: 50, pricePerUnit: 36, amountThb: 1800 })
    );
  });

  test('"ขายทั้งหมด" → Service ดึงยอดคงเหลือ + ราคาตลาดเอง เหลือ 0 ไม่มีเศษค้าง', async () => {
    // ยอดที่มีเศษทศนิยมยาว — ถ้า Frontend คิดจำนวนเองจะเหลือฝุ่นค้างในพอร์ต
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(0.05231467));
    priceFeedService.getCurrentPrice.mockResolvedValue(2450000);

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', side: 'sell', sellAll: true }), res);

    expect(statusOf(res)).toBe(201);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', quantity: 0.05231467, pricePerUnit: 2450000 })
    );
    expect(jsonOf(res).transaction.remainingQuantity).toBe(0);
  });

  test('"ขายทั้งหมด" ของสินทรัพย์ USD → บันทึกเป็น USD ตามประวัติจริง แม้ Client ไม่ส่ง currency', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(3, 'USD'));
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(200);

    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', side: 'sell', sellAll: true }), res);

    expect(statusOf(res)).toBe(201);
    // ราคาต้องมาจาก Feed สกุล USD ไม่ใช่ getCurrentPrice (THB) — ไม่ปนข้ามสกุล
    expect(priceFeedService.getCurrentPriceUsd).toHaveBeenCalledWith('AAPL');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', currency: 'USD', quantity: 3, amountThb: 600 })
    );
  });

  test('ขายเป็น USD (ระบุราคาเอง) → เก็บเป็น USD ตามจริง ไม่แปลงเป็นบาทตอนบันทึก', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(10, 'USD'));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'AAPL', side: 'sell', quantity: 2, pricePerUnit: 190.5, currency: 'USD' }),
      res
    );

    expect(statusOf(res)).toBe(201);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', currency: 'USD', quantity: 2, amountThb: 381 })
    );
  });

  test('Free Plan ที่ใช้สินทรัพย์เต็มโควตาแล้ว ยังขายได้ (Asset Limit คุมแค่การสร้างใหม่)', async () => {
    assetRepository.countActiveByUser.mockResolvedValue(99);
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(10));

    const res = mockRes();
    await createTransaction(
      mockReq(
        { symbol: 'AAPL', side: 'sell', quantity: 1, pricePerUnit: 100 },
        { id: USER_ID, plan: 'free', planExpiresAt: null }
      ),
      res
    );

    expect(statusOf(res)).toBe(201);
  });

  test('Symbol นอก Registry แต่ถืออยู่จริง (Dynamic Symbol) → ขายได้ ไม่ติด SYMBOL_NOT_SUPPORTED', async () => {
    // เคสจริง: หุ้น Small-cap ที่ถูกสร้างผ่าน Manual Quantity Fallback ทาง LINE
    // (Round 10-B) — ถ้ากั้นด้วย Registry ผู้ใช้จะซื้อได้แต่ขายไม่ได้
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'asset-1', symbol: 'EOSE', type: 'stock_us' });
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(100));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'EOSE', side: 'sell', quantity: 40, pricePerUnit: 5 }),
      res
    );

    expect(statusOf(res)).toBe(201);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', quantity: 40, pricePerUnit: 5 })
    );
  });
});

// ── Regression (Red-Green): เพิ่มปุ่มขายต้องไม่ทำ Payload เดิมของฝั่งซื้อเพี้ยน ──────
describe('Regression — Payload เดิมที่ไม่มี side ต้องเป็น "ซื้อ" เหมือนเดิมทุกประการ', () => {
  test('ไม่ส่ง side → type=buy และคง Field เดิมของฝั่งซื้อไว้ครบ', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000 }), res);

    expect(statusOf(res)).toBe(201);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'buy', source: 'web' })
    );
    expect(jsonOf(res).transaction.side).toBe('buy');
    // Field เดิมของฝั่งซื้อต้องยังอยู่ (Frontend เดิมอ่าน newAssetCreated)
    expect(jsonOf(res).transaction).toHaveProperty('newAssetCreated');
    expect(jsonOf(res).transaction).not.toHaveProperty('remainingQuantity');
  });

  test('ส่ง side=buy ตรงๆ → แถวที่ INSERT ลง Ledger เท่ากับตอนไม่ส่ง side เป๊ะ', async () => {
    const resImplicit = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000 }), resImplicit);
    const implicitArgs = transactionRepository.create.mock.calls[0][0];

    transactionRepository.create.mockClear();

    const resExplicit = mockRes();
    await createTransaction(mockReq({ symbol: 'AAPL', amountTotal: 1000, side: 'buy' }), resExplicit);
    const explicitArgs = transactionRepository.create.mock.calls[0][0];

    expect(explicitArgs).toEqual(implicitArgs);
  });
});

describe('POST /transactions (side=sell) — currency ที่ถูกละเว้นเมื่อ sellAll', () => {
  test('sellAll + Client ส่ง currency ที่สินทรัพย์ไม่รองรับ → ไม่ Reject (ค่านั้นถูกละเว้นอยู่แล้ว)', async () => {
    // ทองบันทึกเป็น USD ไม่ได้ (CURRENCY_NOT_SUPPORTED_FOR_ASSET ฝั่งซื้อ) — แต่เมื่อ
    // sellAll ค่า currency ที่ Client ส่งมาไม่ถูกใช้เลย (Service อนุมานจากประวัติจริง)
    // การปฏิเสธ Request เพราะ Field ที่ไม่ได้ใช้ = Error ที่ผู้ใช้แก้ตามไม่ถูก
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'asset-1', symbol: 'GOLD', type: 'gold_bar' });
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(2));
    priceFeedService.getCurrentPrice.mockResolvedValue(52000);
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'GOLD', side: 'sell', sellAll: true, currency: 'USD' }),
      res
    );

    expect(statusOf(res)).toBe(201);
    // บันทึกเป็น THB ตามประวัติจริงของสินทรัพย์ ไม่ใช่ USD ที่ Client ส่งมา
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', currency: 'THB', quantity: 2 })
    );
  });

  test('ขายระบุจำนวนเอง + currency USD กับทอง → ยัง Reject ตามเดิม (ค่านั้นถูกใช้จริง)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'asset-1', symbol: 'GOLD', type: 'gold_bar' });
    transactionRepository.findAllByAsset.mockResolvedValue(holdingHistory(2));

    const res = mockRes();
    await createTransaction(
      mockReq({ symbol: 'GOLD', side: 'sell', quantity: 1, pricePerUnit: 52000, currency: 'USD' }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('CURRENCY_NOT_SUPPORTED_FOR_ASSET');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});
