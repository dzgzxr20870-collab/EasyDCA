jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/priceFeed.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const { getAssetProfit, ProfitServiceError } = require('../src/services/profit.service');

const USER_ID = 'user-uuid-1';
const ASSET_BTC = { id: 'asset-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto' };

beforeEach(() => {
  jest.clearAllMocks();
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
      heldQuantity: 0.01,
      averageCost: 3000000,
      totalInvested: 30000,
      currentPrice: 4000000,
      currentValue: 40000,
      profitLoss: 10000,
      profitLossPercent: 33.33,
      priceSource: 'coingecko',
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

describe('ProfitServiceError', () => {
  test('มี code และ details ติดไปกับ Error', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);

    const error = await getAssetProfit(USER_ID, 'BTC').catch((e) => e);

    expect(error).toBeInstanceOf(ProfitServiceError);
    expect(error.code).toBe('ASSET_NOT_FOUND');
    expect(error.details).toMatchObject({ symbol: 'BTC' });
  });
});
