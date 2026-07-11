jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const { getAssetProfit, ProfitServiceError } = require('../src/services/profit.service');

const USER_ID = 'user-uuid-1';
const ASSET_BTC = { id: 'asset-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto' };

beforeEach(() => {
  jest.clearAllMocks();
  // Default FX เรตพร้อมใช้ (สำหรับสินทรัพย์ USD) — เคส THB ไม่เรียกใช้
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-11', stale: false });
});

describe('getAssetProfit — Error cases', () => {
  test('Asset ไม่มีในระบบ → ASSET_NOT_FOUND (ไม่แตะ transactions/price feed)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    await expect(getAssetProfit(USER_ID, 'BTC')).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    expect(transactionRepository.findAllByAsset).not.toHaveBeenCalled();
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
  });

  test('Asset มีแต่ขายหมดแล้ว (heldQuantity=0) → NO_HOLDING_TO_CALCULATE_PROFIT (ไม่เรียก Price Feed)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.01, amountThb: 30000 },
      { type: 'sell', quantity: 0.01, amountThb: 40000 },
    ]);

    await expect(getAssetProfit(USER_ID, 'BTC')).rejects.toMatchObject({
      code: 'NO_HOLDING_TO_CALCULATE_PROFIT',
    });

    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
  });

  test('ราคาหาไม่ได้ (หุ้นไทย/Price Feed คืน null) → PRICE_FEED_NOT_IMPLEMENTED', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-ptt',
      userId: USER_ID,
      symbol: 'PTT',
      type: 'stock_th',
    });
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 50, amountThb: 1700 },
    ]);
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    await expect(getAssetProfit(USER_ID, 'PTT')).rejects.toMatchObject({
      code: 'PRICE_FEED_NOT_IMPLEMENTED',
    });
  });
});

describe('getAssetProfit — คำนวณกำไร/ขาดทุน', () => {
  test('กำไร — ราคาปัจจุบันสูงกว่าต้นทุนเฉลี่ย', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    // ถือ 0.01 BTC ต้นทุนรวม 30,000 บาท → avg = 3,000,000
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.01, amountThb: 30000 },
    ]);
    // ราคาปัจจุบัน 4,000,000 → มูลค่า 40,000 → กำไร +10,000 (+33.33%)
    priceFeedService.getCurrentPrice.mockResolvedValue(4000000);

    const result = await getAssetProfit(USER_ID, 'BTC');

    expect(priceFeedService.getCurrentPrice).toHaveBeenCalledWith('BTC');
    expect(result).toEqual({
      symbol: 'BTC',
      // Multi-Currency (Round 10) — สินทรัพย์ THB: currency='THB', fxThb=null
      currency: 'THB',
      fxThb: null,
      heldQuantity: 0.01,
      averageCost: 3000000,
      totalInvested: 30000,
      currentPrice: 4000000,
      currentValue: 40000,
      profitLoss: 10000,
      profitLossPercent: 33.33,
      priceSource: 'coingecko',
      // usd = null สำหรับสินทรัพย์ที่ไม่ใช่ทอง (Phase 3 Round 7)
      usd: null,
      // fund fields = null สำหรับสินทรัพย์ที่ไม่ใช่กองทุน (Round 7)
      fundClassName: null,
      navDate: null,
    });
    // THB ล้วน → ไม่เรียก USD Price Feed / FX
    expect(priceFeedService.getCurrentPriceUsd).not.toHaveBeenCalled();
    expect(fxRateService.getUsdThbRate).not.toHaveBeenCalled();
  });

  // ── Multi-Currency (Round 10): สินทรัพย์ USD คิดกำไรในสกุล USD ไม่ปนบาท ─────────
  test('สินทรัพย์ USD → ต้นทุน/กำไรคิดเป็น USD ล้วน (ใช้ getCurrentPriceUsd) + แนบยอดเทียบบาท', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-msft',
      userId: USER_ID,
      symbol: 'MSFT',
      type: 'stock_us',
    });
    // ถือ 2 หุ้น ต้นทุนรวม 600 USD (avg 300 USD) — ธุรกรรมเป็น USD
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 2, amountThb: 600, currency: 'USD' },
    ]);
    // ราคา USD ปัจจุบัน 400 → มูลค่า 800 USD → กำไร +200 USD (+33.33%)
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(400);

    const result = await getAssetProfit(USER_ID, 'MSFT');

    // ต้องใช้ราคา USD ไม่ใช่ THB (ไม่ปนสกุล)
    expect(priceFeedService.getCurrentPriceUsd).toHaveBeenCalledWith('MSFT');
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      symbol: 'MSFT',
      currency: 'USD',
      averageCost: 300, // USD
      totalInvested: 600, // USD
      currentPrice: 400, // USD
      currentValue: 800, // USD
      profitLoss: 200, // USD
      profitLossPercent: 33.33,
      // ยอดเทียบบาท (600 USD invested × 35 = 21000 ; 800 × 35 = 28000 ; PL 200 × 35 = 7000)
      fxThb: { rate: 35, asOf: '2026-07-11', stale: false, totalInvestedThb: 21000, currentValueThb: 28000, profitLossThb: 7000 },
    });
  });

  test('สินทรัพย์ USD แต่ไม่มี USD Price Feed → PRICE_FEED_NOT_IMPLEMENTED', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-nvda', userId: USER_ID, symbol: 'NVDA', type: 'stock_us',
    });
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 1, amountThb: 900, currency: 'USD' },
    ]);
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);

    await expect(getAssetProfit(USER_ID, 'NVDA')).rejects.toMatchObject({
      code: 'PRICE_FEED_NOT_IMPLEMENTED',
    });
  });

  test('ขาดทุน — ราคาปัจจุบันต่ำกว่าต้นทุนเฉลี่ย', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.01, amountThb: 30000 },
    ]);
    // ราคาปัจจุบัน 2,000,000 → มูลค่า 20,000 → ขาดทุน -10,000 (-33.33%)
    priceFeedService.getCurrentPrice.mockResolvedValue(2000000);

    const result = await getAssetProfit(USER_ID, 'BTC');

    expect(result).toMatchObject({
      symbol: 'BTC',
      currentValue: 20000,
      profitLoss: -10000,
      profitLossPercent: -33.33,
      priceSource: 'coingecko',
    });
  });

  test('รวมหลายธุรกรรม (buy + partial sell) → คำนวณ held/invested/avg ถูกต้อง', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    // buy 0.02 @ 60,000 รวม, sell 0.01 คืนทุน 40,000 → held 0.01, invested 20,000
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.02, amountThb: 60000 },
      { type: 'sell', quantity: 0.01, amountThb: 40000 },
    ]);
    // ราคาปัจจุบัน 3,000,000 → มูลค่า 30,000 → กำไร +10,000 (+50%)
    priceFeedService.getCurrentPrice.mockResolvedValue(3000000);

    const result = await getAssetProfit(USER_ID, 'BTC');

    expect(result).toMatchObject({
      heldQuantity: 0.01,
      totalInvested: 20000,
      averageCost: 2000000,
      currentValue: 30000,
      profitLoss: 10000,
      profitLossPercent: 50,
    });
  });
});

describe('getAssetProfit — priceSource ตาม Asset Type จริง', () => {
  test('BTC (crypto) → priceSource ยังเป็น coingecko เหมือนเดิม (ไม่ Regression)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.01, amountThb: 30000 },
    ]);
    priceFeedService.getCurrentPrice.mockResolvedValue(4000000);

    const result = await getAssetProfit(USER_ID, 'BTC');

    expect(result.priceSource).toBe('coingecko');
  });

  test('AAPL (stock_us) → priceSource เป็น twelvedata ไม่ใช่ coingecko', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-aapl',
      userId: USER_ID,
      symbol: 'AAPL',
      type: 'stock_us',
    });
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 5, amountThb: 30000 },
    ]);
    priceFeedService.getCurrentPrice.mockResolvedValue(7000);

    const result = await getAssetProfit(USER_ID, 'AAPL');

    expect(result.priceSource).toBe('twelvedata');
  });
});

describe('ProfitServiceError', () => {
  test('มี code และ details ติดไปกับ Error', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    const error = await getAssetProfit(USER_ID, 'BTC').catch((e) => e);

    expect(error).toBeInstanceOf(ProfitServiceError);
    expect(error.code).toBe('ASSET_NOT_FOUND');
    expect(error.details).toMatchObject({ symbol: 'BTC' });
  });
});

describe('getAssetProfit — ทองคำ (Phase 3 Round 7)', () => {
  const ASSET_GOLD = { id: 'asset-gold', userId: USER_ID, symbol: 'GOLD', type: 'gold_bar' };
  const ASSET_GOLDORN = { id: 'asset-goldorn', userId: USER_ID, symbol: 'GOLDORN', type: 'gold_ornament' };

  test('กำไรทอง → ใช้ราคา "รับซื้อคืน" (buy) เป็นราคาปัจจุบัน (ไม่ใช่ sell)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_GOLD);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 1, amountThb: 70000 }, // ต้นทุน 70,000
    ]);
    priceFeedService.getGoldPriceThb.mockResolvedValue({ buy: 70950, sell: 71150, updatedAt: 'x' });
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const result = await getAssetProfit(USER_ID, 'GOLD');

    expect(priceFeedService.getGoldPriceThb).toHaveBeenCalledWith('gold_bar');
    // ใช้ buy (70950) เป็นราคาปัจจุบัน → มูลค่า 70950, กำไร 950
    expect(result.currentPrice).toBe(70950);
    expect(result.currentValue).toBe(70950);
    expect(result.profitLoss).toBe(950);
    expect(result.priceSource).toBe('thaigold');
    // ไม่หลงไปเรียก getCurrentPrice (Path ทองแยกออกมา)
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
  });

  test('ทอง → Enrich USD (ราคา/มูลค่าปัจจุบันเป็น USD) ด้วย getUsdThbFxRate', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_GOLD);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 2, amountThb: 140000 },
    ]);
    priceFeedService.getGoldPriceThb.mockResolvedValue({ buy: 70000, sell: 71000, updatedAt: 'x' });
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const result = await getAssetProfit(USER_ID, 'GOLD');

    // currentPrice 70000 THB → 2000 USD ; currentValue 140000 THB → 4000 USD
    expect(result.usd).toEqual({
      usdThbRate: 35,
      currentPriceUsd: 2000,
      currentValueUsd: 4000,
    });
  });

  test('ทอง + ดึง FX ไม่ได้ (null) → usd = null แต่ยังคำนวณกำไร THB ได้ปกติ', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_GOLD);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 1, amountThb: 70000 },
    ]);
    priceFeedService.getGoldPriceThb.mockResolvedValue({ buy: 70950, sell: 71150, updatedAt: 'x' });
    priceFeedService.getUsdThbFxRate.mockResolvedValue(null);

    const result = await getAssetProfit(USER_ID, 'GOLD');

    expect(result.currentPrice).toBe(70950);
    expect(result.usd).toBeNull();
  });

  test('ดึงราคาทองไม่ได้ (feed throw) → GOLD_PRICE_UNAVAILABLE (ไม่ใช่ PRICE_FEED_NOT_IMPLEMENTED)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_GOLD);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 1, amountThb: 70000 },
    ]);
    priceFeedService.getGoldPriceThb.mockRejectedValue(
      Object.assign(new Error('feed down'), { code: 'GOLD_PRICE_UNAVAILABLE' })
    );

    await expect(getAssetProfit(USER_ID, 'GOLD')).rejects.toMatchObject({
      code: 'GOLD_PRICE_UNAVAILABLE',
    });
  });

  test('ทองรูปพรรณ (gold_ornament) → เรียก getGoldPriceThb ด้วย type ที่ถูก ไม่ปนกับทองคำแท่ง', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_GOLDORN);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 1, amountThb: 71000 },
    ]);
    priceFeedService.getGoldPriceThb.mockResolvedValue({ buy: 69523.76, sell: 71950, updatedAt: 'x' });
    priceFeedService.getUsdThbFxRate.mockResolvedValue(35);

    const result = await getAssetProfit(USER_ID, 'GOLDORN');

    expect(priceFeedService.getGoldPriceThb).toHaveBeenCalledWith('gold_ornament');
    expect(result.currentPrice).toBe(69523.76);
  });
});

describe('getAssetProfit — กองทุนรวมไทย (Round 7 Mark-to-market)', () => {
  const ASSET_FUND = {
    id: 'asset-fund', userId: USER_ID, symbol: 'K-SELECT', type: 'fund',
    projId: 'M0001', fundClassName: 'K-SELECT-A(A)',
  };

  test('(e) กำไรกองทุน → ใช้ NAV ล่าสุด (last_val) เป็นราคาปัจจุบัน + priceSource secnav', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_FUND);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 100, amountThb: 1000 }, // ต้นทุนเฉลี่ย 10
    ]);
    priceFeedService.getMutualFundNav.mockResolvedValue({ navDate: '2024-11-22', lastVal: 12.5 });

    const result = await getAssetProfit(USER_ID, 'K-SELECT');

    expect(priceFeedService.getMutualFundNav).toHaveBeenCalledWith('M0001', 'K-SELECT-A(A)');
    expect(result.currentPrice).toBe(12.5);
    expect(result.currentValue).toBe(1250); // 100 * 12.5
    expect(result.profitLoss).toBe(250);
    expect(result.priceSource).toBe('secnav');
    expect(result.fundClassName).toBe('K-SELECT-A(A)');
    expect(result.navDate).toBe('2024-11-22');
    // ไม่หลงไปเรียก getCurrentPrice (Path กองทุนแยกออกมา)
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
  });

  test('(f) ดึง NAV ไม่ได้ → MUTUAL_FUND_NAV_UNAVAILABLE (ไม่ใช่ PRICE_FEED_NOT_IMPLEMENTED)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_FUND);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 100, amountThb: 1000 }]);
    priceFeedService.getMutualFundNav.mockRejectedValue(
      Object.assign(new Error('down'), { code: 'MUTUAL_FUND_NAV_UNAVAILABLE' })
    );

    await expect(getAssetProfit(USER_ID, 'K-SELECT')).rejects.toMatchObject({
      code: 'MUTUAL_FUND_NAV_UNAVAILABLE',
    });
  });

  test('SEC ไม่ config → SEC_NOT_CONFIGURED (ข้อความไทยแยกจาก NAV ล่ม)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_FUND);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 100, amountThb: 1000 }]);
    priceFeedService.getMutualFundNav.mockRejectedValue(
      Object.assign(new Error('nc'), { code: 'SEC_NOT_CONFIGURED' })
    );

    await expect(getAssetProfit(USER_ID, 'K-SELECT')).rejects.toMatchObject({ code: 'SEC_NOT_CONFIGURED' });
  });

  test('fund แบบ Manual (ไม่มี projId) → ตกไป path ปกติ (getCurrentPrice) ไม่เรียก NAV', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'a', userId: USER_ID, symbol: 'XFUND', type: 'fund', projId: null, fundClassName: null,
    });
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 10, amountThb: 100 }]);
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    await expect(getAssetProfit(USER_ID, 'XFUND')).rejects.toMatchObject({
      code: 'PRICE_FEED_NOT_IMPLEMENTED',
    });
    expect(priceFeedService.getMutualFundNav).not.toHaveBeenCalled();
  });
});
