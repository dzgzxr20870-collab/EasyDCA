jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/priceFeed.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const {
  processBuyCommand,
  processSellCommand,
  calculateHeldQuantity,
  TransactionServiceError,
  MAX_FREE_ASSETS,
} = require('../src/services/transaction.service');

const USER_ID = 'user-uuid-1';
const ASSET = { id: 'asset-uuid-1', userId: USER_ID, symbol: 'PTT', type: 'stock_th' };

beforeEach(() => {
  jest.clearAllMocks();
  // Default: create คืน record ที่มี id — Test แต่ละเคส Override ตามต้องการ
  transactionRepository.create.mockResolvedValue({ id: 'tx-uuid-1' });
  assetRepository.create.mockResolvedValue(ASSET);
  // Default: Price Feed หาราคาไม่ได้ (null) — เคสที่ต้องการราคาจริง Override เอง
  // เพื่อคง Behavior เดิมของ PRICE_FEED_NOT_IMPLEMENTED เมื่อไม่มีราคา
  priceFeedService.getCurrentPrice.mockResolvedValue(null);
});

describe('processBuyCommand', () => {
  test('ซื้อสำเร็จ — Asset เก่าที่มีอยู่แล้ว (ไม่สร้าง Asset ใหม่)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET);

    const result = await processBuyCommand(USER_ID, {
      symbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
    });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(assetRepository.countActiveByUser).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        assetId: ASSET.id,
        type: 'buy',
        quantity: 50,
        pricePerUnit: 34,
        amountThb: 1700,
        source: 'line',
      })
    );
    expect(result).toMatchObject({
      symbol: 'PTT',
      quantity: 50,
      amountThb: 1700,
      newAssetCreated: false,
    });
  });

  test('ซื้อสำเร็จ — สร้าง Asset ใหม่ (ยังไม่ถึง Freemium Limit)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.countActiveByUser.mockResolvedValue(1);

    const result = await processBuyCommand(
      USER_ID,
      { symbol: 'PTT', quantity: 50, pricePerUnit: 34, type: 'stock_th', name: 'PTT PCL' },
      { plan: 'free' }
    );

    expect(assetRepository.countActiveByUser).toHaveBeenCalledWith(USER_ID);
    expect(assetRepository.create).toHaveBeenCalledWith(
      USER_ID,
      null,
      'PTT',
      'PTT PCL',
      'stock_th'
    );
    expect(result.newAssetCreated).toBe(true);
  });

  test('ซื้อเกิน Freemium Limit — Free ที่มี 2 Asset แล้ว สร้าง Symbol ใหม่ → ASSET_LIMIT_REACHED', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.countActiveByUser.mockResolvedValue(MAX_FREE_ASSETS);

    await expect(
      processBuyCommand(
        USER_ID,
        { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
        { plan: 'free' }
      )
    ).rejects.toMatchObject({ code: 'ASSET_LIMIT_REACHED' });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Premium ไม่ติด Freemium Limit แม้มี Asset เกิน 2', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    const result = await processBuyCommand(
      USER_ID,
      { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
      { plan: 'premium' }
    );

    expect(assetRepository.countActiveByUser).not.toHaveBeenCalled();
    expect(result.newAssetCreated).toBe(true);
  });

  test('รูปแบบจำนวนเงินล้วน (amountThb) + Price Feed หาราคาไม่ได้ → PRICE_FEED_NOT_IMPLEMENTED ก่อนเขียน DB', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET);
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    await expect(
      processBuyCommand(USER_ID, { symbol: 'BTC', amountThb: 1000 })
    ).rejects.toMatchObject({ code: 'PRICE_FEED_NOT_IMPLEMENTED' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  test('รูปแบบจำนวนเงินล้วน (amountThb) + Price Feed สำเร็จ → คำนวณ quantity จากราคาจริง', async () => {
    const ASSET_BTC = { id: 'asset-uuid-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto' };
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    // ราคา 2,000,000 บาท/BTC → ซื้อด้วย 1,000 บาท ได้ 0.0005 BTC
    priceFeedService.getCurrentPrice.mockResolvedValue(2000000);

    const result = await processBuyCommand(USER_ID, { symbol: 'BTC', amountThb: 1000 });

    expect(priceFeedService.getCurrentPrice).toHaveBeenCalledWith('BTC');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'buy',
        assetId: ASSET_BTC.id,
        quantity: 0.0005,
        pricePerUnit: 2000000,
        amountThb: 1000,
        source: 'line',
      })
    );
    expect(result).toMatchObject({
      symbol: 'BTC',
      quantity: 0.0005,
      pricePerUnit: 2000000,
      amountThb: 1000,
    });
  });

  test('amountThb หารด้วยราคาไม่ลงตัว → quantity ถูกปัดเศษ 8 ตำแหน่ง (ไม่เกิน Precision NUMERIC(20,8))', async () => {
    const ASSET_BTC = { id: 'asset-uuid-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto' };
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    // 1000 / 3400000 = 0.0002941176470588235 (ทศนิยม 19 ตำแหน่ง) → ปัดเหลือ 0.00029412
    priceFeedService.getCurrentPrice.mockResolvedValue(3400000);

    const result = await processBuyCommand(USER_ID, { symbol: 'BTC', amountThb: 1000 });

    expect(result.quantity).toBe(0.00029412);
    // ยืนยันว่าปัดจริง ไม่ใช่ทศนิยมยาวเกิน 8 ตำแหน่ง
    expect(Number.isInteger(result.quantity * 1e8)).toBe(true);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 0.00029412, pricePerUnit: 3400000, amountThb: 1000 })
    );
  });

  test('สร้าง Asset ใหม่แต่ไม่ส่ง type มา → VALIDATION_ERROR (ไม่เดา type)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.countActiveByUser.mockResolvedValue(0);

    await expect(
      processBuyCommand(USER_ID, { symbol: 'DOGE', quantity: 10, pricePerUnit: 5 }, { plan: 'free' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

describe('processSellCommand', () => {
  test('ขายสำเร็จ — ขายไม่เกินยอดคงเหลือ', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 100 },
      { type: 'sell', quantity: 20 },
    ]);

    const result = await processSellCommand(USER_ID, {
      symbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
    });

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', quantity: 50, assetId: ASSET.id, source: 'line' })
    );
    // ยอดคงเหลือก่อนขาย = 100 - 20 = 80 → หลังขาย 50 เหลือ 30
    expect(result).toMatchObject({ symbol: 'PTT', quantity: 50, remainingQuantity: 30 });
  });

  test('ขายเกินยอดคงเหลือ → INSUFFICIENT_QUANTITY (ไม่บันทึก Transaction)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 30 }]);

    await expect(
      processSellCommand(USER_ID, { symbol: 'PTT', quantity: 50, pricePerUnit: 34 })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_QUANTITY' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขาย Asset ที่ไม่มีอยู่ → ASSET_NOT_FOUND', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    await expect(
      processSellCommand(USER_ID, { symbol: 'XRP', quantity: 5, pricePerUnit: 20 })
    ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    expect(transactionRepository.findAllByAsset).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขายรูปแบบจำนวนเงินล้วน (amountThb) → PRICE_FEED_NOT_IMPLEMENTED', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET);

    await expect(
      processSellCommand(USER_ID, { symbol: 'PTT', amountThb: 500 })
    ).rejects.toMatchObject({ code: 'PRICE_FEED_NOT_IMPLEMENTED' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขายพอดียอดคงเหลือทั้งหมด (Boundary) → สำเร็จ เหลือ 0', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 50 }]);

    const result = await processSellCommand(USER_ID, {
      symbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
    });

    expect(result.remainingQuantity).toBe(0);
    expect(transactionRepository.create).toHaveBeenCalled();
  });
});

describe('calculateHeldQuantity', () => {
  test('Σ(buy) - Σ(sell) พื้นฐาน', () => {
    expect(
      calculateHeldQuantity([
        { type: 'buy', quantity: 100 },
        { type: 'buy', quantity: 50 },
        { type: 'sell', quantity: 30 },
      ])
    ).toBe(120);
  });

  test('ไม่มีประวัติ → 0', () => {
    expect(calculateHeldQuantity([])).toBe(0);
  });

  test('ปัดเศษกัน Floating Point: buy 0.1 + buy 0.2 = 0.3 (ไม่ใช่ 0.30000000000000004)', () => {
    const held = calculateHeldQuantity([
      { type: 'buy', quantity: 0.1 },
      { type: 'buy', quantity: 0.2 },
    ]);
    expect(held).toBe(0.3);
    // ยืนยันว่าปัดจริง ไม่ใช่แค่บังเอิญเท่ากันด้วย toBeCloseTo
    expect(Number.isInteger(held * 100)).toBe(true);
  });

  test('ปัดเศษฝั่งลบ: buy 0.3 - sell 0.1 = 0.2', () => {
    expect(
      calculateHeldQuantity([
        { type: 'buy', quantity: 0.3 },
        { type: 'sell', quantity: 0.1 },
      ])
    ).toBe(0.2);
  });

  test('quantity เป็น String (จาก DB NUMERIC) ก็ Sum ได้', () => {
    expect(
      calculateHeldQuantity([
        { type: 'buy', quantity: '100' },
        { type: 'sell', quantity: '40' },
      ])
    ).toBe(60);
  });
});

describe('TransactionServiceError', () => {
  test('มี code และ details ติดไปกับ Error', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    const error = await processSellCommand(USER_ID, {
      symbol: 'XRP',
      quantity: 5,
      pricePerUnit: 20,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(TransactionServiceError);
    expect(error.code).toBe('ASSET_NOT_FOUND');
    expect(error.details).toMatchObject({ symbol: 'XRP' });
  });
});
