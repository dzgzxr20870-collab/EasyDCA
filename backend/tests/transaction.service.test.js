jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/priceFeed.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const {
  processBuyCommand,
  processSellCommand,
  validateBuy,
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
      priceSource: 'user',
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

  test('Premium ที่ยัง Active ไม่ติด Freemium Limit แม้มี Asset เกิน 2', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    // ผ่าน entitlement: premium ต้องมี planExpiresAt อนาคตจึงถือว่า Active
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await processBuyCommand(
      USER_ID,
      { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
      { plan: 'premium', planExpiresAt: future }
    );

    expect(assetRepository.countActiveByUser).not.toHaveBeenCalled();
    expect(result.newAssetCreated).toBe(true);
  });

  test('Premium ที่หมดอายุแล้ว → ถือเป็น free ติด Freemium Limit (entitlement)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.countActiveByUser.mockResolvedValue(MAX_FREE_ASSETS);

    // plan=premium แต่วันหมดอายุเป็นอดีต → entitlement ถือเป็น free → บังคับ Limit
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await expect(
      processBuyCommand(
        USER_ID,
        { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
        { plan: 'premium', planExpiresAt: past }
      )
    ).rejects.toMatchObject({ code: 'ASSET_LIMIT_REACHED' });

    expect(assetRepository.countActiveByUser).toHaveBeenCalledWith(USER_ID);
    expect(assetRepository.create).not.toHaveBeenCalled();
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
      priceSource: 'coingecko',
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
    expect(result.priceSource).toBe('coingecko');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 0.00029412, pricePerUnit: 3400000, amountThb: 1000 })
    );
  });

  test('รูปแบบจำนวนเงินล้วน (amountThb) กับหุ้นสหรัฐ (AAPL) → priceSource เป็น twelvedata ไม่ใช่ coingecko', async () => {
    const ASSET_AAPL = { id: 'asset-uuid-aapl', userId: USER_ID, symbol: 'AAPL', type: 'stock_us' };
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_AAPL);
    priceFeedService.getCurrentPrice.mockResolvedValue(7000);

    const result = await processBuyCommand(USER_ID, { symbol: 'AAPL', amountThb: 14000 });

    expect(result.priceSource).toBe('twelvedata');
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
    expect(result).toMatchObject({
      symbol: 'PTT',
      quantity: 50,
      remainingQuantity: 30,
      priceSource: 'user',
    });
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

  // Regression: ขาย Crypto บางส่วนแล้วเหลือยอดน้อยกว่า 0.01 — remainingQuantity
  // ต้องคงทศนิยม 8 ตำแหน่ง ไม่ถูกปัดเป็น 0 (ก่อนแก้ใช้ roundToTwo จะได้ 0)
  test('ขาย Crypto บางส่วนเหลือยอดน้อยกว่า 0.01 → remainingQuantity ไม่ปัดเป็น 0', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 0.001 }]);

    const result = await processSellCommand(USER_ID, {
      symbol: 'BTC',
      quantity: 0.0005,
      pricePerUnit: 2000000,
    });

    // ยอดคงเหลือก่อนขาย = 0.001 → หลังขาย 0.0005 เหลือ 0.0005
    expect(result.remainingQuantity).toBe(0.0005);
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

  // Regression: Crypto ยอดน้อยกว่า 0.01 ต้องไม่ถูกปัดเป็น 0 (DATABASE.md NUMERIC(20,8))
  // ก่อนแก้ (roundToTwo) เคสเหล่านี้จะได้ 0 → Asset หายจากพอร์ต/คำนวณกำไรไม่ได้
  test('Crypto ยอดน้อย 0.00049068 (BTC) ต้องคงค่าไว้ ไม่ปัดเป็น 0', () => {
    expect(calculateHeldQuantity([{ type: 'buy', quantity: 0.00049068 }])).toBe(0.00049068);
  });

  test('Crypto ยอดน้อย 0.0001749 ต้องคงค่าไว้ ไม่ปัดเป็น 0', () => {
    expect(calculateHeldQuantity([{ type: 'buy', quantity: 0.0001749 }])).toBe(0.0001749);
  });

  test('ยอดคงเหลือ Crypto ต่ำกว่า 0.01 หลังหักขายบางส่วน ต้องมากกว่า 0', () => {
    const held = calculateHeldQuantity([
      { type: 'buy', quantity: 0.001 },
      { type: 'sell', quantity: 0.0005 },
    ]);
    expect(held).toBe(0.0005);
    expect(held).toBeGreaterThan(0);
  });

  test('quantity เป็น String ยอดน้อย (จาก DB NUMERIC(20,8)) ต้องคงทศนิยม 8 ตำแหน่ง', () => {
    expect(calculateHeldQuantity([{ type: 'buy', quantity: '0.00049068' }])).toBe(0.00049068);
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

// ── Round 2: "ขายทั้งหมด" (params.sellAll) ──────────────────────────────────
describe('processSellCommand — ขายทั้งหมด (sellAll)', () => {
  const ASSET_BTC = { id: 'asset-uuid-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto' };

  test('คำนวณ amountThb = heldQuantity × ราคาตลาดปัจจุบัน (ขายหมดเหลือ 0)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    // ยอดคงเหลือ = 0.5 (จากประวัติ — Reuse calculateHeldQuantity)
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.3 },
      { type: 'buy', quantity: 0.2 },
    ]);
    // ราคาตลาด ณ ตอนนี้ = 2,000,000 บาท/BTC
    priceFeedService.getCurrentPrice.mockResolvedValue(2000000);

    const result = await processSellCommand(USER_ID, { symbol: 'BTC', sellAll: true });

    expect(priceFeedService.getCurrentPrice).toHaveBeenCalledWith('BTC');
    // 0.5 × 2,000,000 = 1,000,000
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sell',
        assetId: ASSET_BTC.id,
        quantity: 0.5,
        pricePerUnit: 2000000,
        amountThb: 1000000,
        source: 'line',
      })
    );
    expect(result).toMatchObject({
      symbol: 'BTC',
      quantity: 0.5,
      amountThb: 1000000,
      remainingQuantity: 0,
      // ราคามาจาก Price Feed (ไม่ใช่ที่ User พิมพ์) → priceSource ตาม Type จริง
      priceSource: 'coingecko',
    });
  });

  test('หุ้นสหรัฐ (NVDA) ขายทั้งหมด → priceSource เป็น twelvedata', async () => {
    const ASSET_NVDA = { id: 'asset-nvda', userId: USER_ID, symbol: 'NVDA', type: 'stock_us' };
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_NVDA);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 3 }]);
    priceFeedService.getCurrentPrice.mockResolvedValue(3500);

    const result = await processSellCommand(USER_ID, { symbol: 'NVDA', sellAll: true });

    expect(result).toMatchObject({ quantity: 3, amountThb: 10500, priceSource: 'twelvedata' });
  });

  test('Symbol ไม่มีในพอร์ตเลย (ไม่เคยซื้อ) → ASSET_NOT_FOUND', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    await expect(
      processSellCommand(USER_ID, { symbol: 'DOGE', sellAll: true })
    ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    expect(transactionRepository.findAllByAsset).not.toHaveBeenCalled();
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Holding เป็น 0 อยู่แล้ว (ขายไปหมดก่อนหน้า) → NOTHING_TO_SELL', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    // buy 0.5 แล้ว sell 0.5 → held = 0
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.5 },
      { type: 'sell', quantity: 0.5 },
    ]);

    await expect(
      processSellCommand(USER_ID, { symbol: 'BTC', sellAll: true })
    ).rejects.toMatchObject({ code: 'NOTHING_TO_SELL' });

    // ยังไม่ทันดึงราคา/บันทึก
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ดึงราคาตลาดไม่ได้ (Price Feed คืน null) → MARKET_PRICE_UNAVAILABLE (ไม่เดาราคา/0)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 0.5 }]);
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    await expect(
      processSellCommand(USER_ID, { symbol: 'BTC', sellAll: true })
    ).rejects.toMatchObject({ code: 'MARKET_PRICE_UNAVAILABLE' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

// ── Round 2: ราคาเป็น USD (priceCurrency: 'USD') ────────────────────────────
describe('ราคาเป็น USD → แปลงเป็น THB ด้วย FX Rate', () => {
  const ASSET_MSFT = { id: 'asset-msft', userId: USER_ID, symbol: 'MSFT', type: 'stock_us' };

  test('processBuyCommand: 2 หุ้น × 300 USD, rate 35 → บันทึกเป็น THB (10500/หน่วย, รวม 21000)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_MSFT);
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const result = await processBuyCommand(USER_ID, {
      symbol: 'MSFT',
      quantity: 2,
      pricePerUnit: 300,
      priceCurrency: 'USD',
    });

    expect(priceFeedService.getUsdThbFxRate).toHaveBeenCalled();
    // amountThb ที่บันทึกลง DB ต้องเป็น THB เสมอ
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'buy',
        quantity: 2,
        pricePerUnit: 10500,
        amountThb: 21000,
      })
    );
    expect(result).toMatchObject({ quantity: 2, pricePerUnit: 10500, amountThb: 21000, priceSource: 'user' });
  });

  test('validateBuy คืน amounts.fx (USD ที่พิมพ์ + เรต) สำหรับ Preview', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_MSFT);
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const { amounts } = await validateBuy(USER_ID, {
      symbol: 'MSFT',
      quantity: 2,
      pricePerUnit: 300,
      priceCurrency: 'USD',
    });

    expect(amounts).toMatchObject({
      quantity: 2,
      pricePerUnit: 10500,
      amountThb: 21000,
      priceSource: 'user',
      fx: { currency: 'USD', rate: 35, pricePerUnitOriginal: 300, amountOriginal: 600 },
    });
  });

  test('ดึง FX Rate ไม่ได้ (null) → FX_RATE_UNAVAILABLE (ไม่บันทึก ไม่เดาเรต)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_MSFT);
    priceFeedService.getUsdThbFxRate.mockResolvedValue(null);

    await expect(
      processBuyCommand(USER_ID, { symbol: 'MSFT', quantity: 2, pricePerUnit: 300, priceCurrency: 'USD' })
    ).rejects.toMatchObject({ code: 'FX_RATE_UNAVAILABLE' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ไม่ระบุ USD (Default THB) → ไม่เรียก FX Rate, ราคาคงเดิม', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_MSFT);

    const result = await processBuyCommand(USER_ID, {
      symbol: 'MSFT',
      quantity: 2,
      pricePerUnit: 300,
    });

    expect(priceFeedService.getUsdThbFxRate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ pricePerUnit: 300, amountThb: 600 });
  });
});

describe('ทองคำ (Phase 3 Round 7) — BUY ใช้ราคา sell เป็น Default, แสดง USD', () => {
  const GOLD_BAR_ASSET = { id: 'asset-gold', userId: USER_ID, symbol: 'GOLD', type: 'gold_bar' };
  const GOLD_ORN_ASSET = { id: 'asset-goldorn', userId: USER_ID, symbol: 'GOLDORN', type: 'gold_ornament' };

  test('ซื้อทองด้วยจำนวนเงิน (ไม่พิมพ์ราคา) → ใช้ราคา "ขายออก" (sell) หาร quantity + priceSource thaigold', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(GOLD_BAR_ASSET);
    priceFeedService.getGoldPriceThb.mockResolvedValue({ buy: 70950, sell: 71150, updatedAt: 'x' });
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const result = await processBuyCommand(USER_ID, { symbol: 'GOLD', amountThb: 71150 });

    // ใช้ sell (71150) ไม่ใช่ buy (70950) → quantity = 71150/71150 = 1
    expect(priceFeedService.getGoldPriceThb).toHaveBeenCalledWith('gold_bar');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'buy', quantity: 1, pricePerUnit: 71150, amountThb: 71150 })
    );
    expect(result).toMatchObject({ quantity: 1, pricePerUnit: 71150, priceSource: 'thaigold' });
  });

  test('ทองรูปพรรณ (GOLDORN) → เรียก getGoldPriceThb ด้วย gold_ornament (ไม่ปนกับ gold_bar)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(GOLD_ORN_ASSET);
    priceFeedService.getGoldPriceThb.mockResolvedValue({ buy: 69523.76, sell: 71950, updatedAt: 'x' });
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    await processBuyCommand(USER_ID, { symbol: 'GOLDORN', amountThb: 71950 });

    expect(priceFeedService.getGoldPriceThb).toHaveBeenCalledWith('gold_ornament');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ pricePerUnit: 71950, quantity: 1 })
    );
  });

  test('ซื้อทองด้วยจำนวนเงินแต่ดึงราคาทองไม่ได้ (feed throw) → GOLD_PRICE_UNAVAILABLE, ไม่บันทึก', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(GOLD_BAR_ASSET);
    priceFeedService.getGoldPriceThb.mockRejectedValue(
      Object.assign(new Error('feed down'), { code: 'GOLD_PRICE_UNAVAILABLE' })
    );

    await expect(
      processBuyCommand(USER_ID, { symbol: 'GOLD', amountThb: 71150 })
    ).rejects.toMatchObject({ code: 'GOLD_PRICE_UNAVAILABLE' });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  // goldUsd อยู่ใน amounts (Path ของ Preview ผ่าน validateBuy→createPending) ไม่ใช่
  // ผลลัพธ์ commit ของ processBuyCommand — จึงตรวจผ่าน validateBuy โดยตรง
  test('ซื้อทองพิมพ์ราคาต้นทุนเอง → priceSource user + goldUsd (ราคาอ้างอิง USD) แนบใน amounts', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(GOLD_BAR_ASSET);
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const { amounts } = await validateBuy(USER_ID, { symbol: 'GOLD', quantity: 1, pricePerUnit: 70000 });

    // ผู้ใช้พิมพ์ราคาเอง → ไม่เรียก getGoldPriceThb, priceSource เป็น user
    expect(priceFeedService.getGoldPriceThb).not.toHaveBeenCalled();
    expect(amounts).toMatchObject({ quantity: 1, pricePerUnit: 70000, priceSource: 'user' });
    // goldUsd อ้างอิง = 70000/35 = 2000 USD/บาททองคำ
    expect(amounts.goldUsd).toEqual({ usdThbRate: 35, pricePerUnitUsd: 2000 });
  });

  test('FX Rate ดึงไม่ได้ (null) → goldUsd = null แต่ยังซื้อได้ตามปกติ (USD เป็นแค่ข้อมูลอ้างอิง)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(GOLD_BAR_ASSET);
    priceFeedService.getUsdThbFxRate.mockResolvedValue(null);

    const { amounts } = await validateBuy(USER_ID, { symbol: 'GOLD', quantity: 1, pricePerUnit: 70000 });

    expect(amounts).toMatchObject({ quantity: 1, pricePerUnit: 70000, priceSource: 'user' });
    expect(amounts.goldUsd).toBeNull();
  });

  test('ราคาซื้อ (sell) ≠ ราคาขาย (buy): ขายทองด้วยจำนวนเงินใช้ราคา buy (รับซื้อคืน)', async () => {
    // validateSell path — side='sell' → ใช้ gold.buy (70950) ไม่ใช่ sell (71150)
    assetRepository.findByUserAndSymbol.mockResolvedValue(GOLD_BAR_ASSET);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 2, amountThb: 140000 },
    ]);
    priceFeedService.getGoldPriceThb.mockResolvedValue({ buy: 70950, sell: 71150, updatedAt: 'x' });
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const result = await processSellCommand(USER_ID, { symbol: 'GOLD', amountThb: 70950 });

    // ขายด้วยเงิน 70950 ที่ราคารับซื้อคืน 70950 → quantity = 1
    expect(result).toMatchObject({ pricePerUnit: 70950, quantity: 1 });
  });
});
