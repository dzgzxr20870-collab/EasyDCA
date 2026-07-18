// ═══════════════════════════════════════════════════════════════════════
// Integration Test — Dynamic Symbol Resolution (แก้ Root Cause "Symbol ใหม่ไม่มีราคา")
// ═══════════════════════════════════════════════════════════════════════
// Bug Class ที่ Test นี้ล็อกไว้ (เจอซ้ำกับ EOSE แล้ว OKLO — Whack-a-mole):
//   Asset ที่ถูกซื้อผ่าน Manual Quantity Fallback (Round 10-B) จะมี assets.type
//   ถูกต้องอยู่แล้วใน DB (เช่น 'stock_us' ที่เดาจากสกุลเงินตอนสร้าง) แต่ตอน "อ่าน"
//   ราคาภายหลัง โค้ดกลับไปถาม symbolRegistry.lookupType(symbol) ใหม่ ซึ่งยังไม่รู้จัก
//   Symbol นั้น (ยังไม่มีใคร Manual เพิ่มเข้า Registry) → คืน null → "ไม่มีราคาตลาด"
//   ทั้งที่ Type ที่ถูกต้องอยู่ในมือแล้วแท้ๆ
//
// Test นี้ Mock "แค่ boundary" (asset/transaction repository + global.fetch) — ไม่ Mock
// priceFeed.service เพื่อให้ Routing จริงใน priceFeed ทำงานเต็ม Chain
// (profit.service → priceFeed.service → Twelve Data) ต่างจาก profit.service.test.js
// ที่ Mock priceFeed ทั้งก้อน จึงมองไม่เห็น Bug ชั้น Routing นี้เลย
//
// ⚠️ Symbol ที่ใช้ทดสอบต้อง "ไม่มีใน symbolRegistry จริง" เสมอ (ZZZNEW) — ถ้าวันหน้า
// มีใครเผลอเพิ่มเข้า Registry จะทำให้ Test นี้ผ่านด้วยเหตุผลผิด (Registry รู้จักแล้ว)
// แทนที่จะพิสูจน์ว่า asset.type ถูกใช้จริง จึงมี Assertion ยืนยันไว้ด้านล่าง

jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const fxRateService = require('../src/services/fxRate.service');
const symbolRegistry = require('../src/services/symbolRegistry.service');
const { getAssetProfit } = require('../src/services/profit.service');
const portfolioSummaryService = require('../src/services/portfolioSummary.service');

const USER_ID = 'user-dsr-1';

// Symbol ที่ Registry ไม่รู้จักแน่นอน แต่ DB มี type='stock_us' บันทึกไว้แล้ว
// (จำลองสภาพของ EOSE "ก่อน" ถูก Manual เพิ่มเข้า Registry)
const UNREGISTERED_SYMBOL = 'ZZZNEW';

// Mock Twelve Data: /quote คืนราคา USD (String ตาม Response จริง), /exchange_rate คืนเรต
function mockTwelveData({ closeUsd = '12.50', rate = 36 } = {}) {
  return jest.spyOn(global, 'fetch').mockImplementation((url) => {
    if (url.includes('/quote')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          symbol: UNREGISTERED_SYMBOL,
          exchange: 'NASDAQ',
          currency: 'USD',
          close: closeUsd,
          is_market_open: false,
        }),
      });
    }
    if (url.includes('/exchange_rate')) {
      return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USD/THB', rate }) });
    }
    return Promise.resolve({ ok: false, status: 404, text: async () => 'unexpected url' });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  jest.resetModules();
  process.env.TWELVE_DATA_API_KEY = 'test-twelve-key';
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 36, asOf: '2026-07-17', stale: false });
});

afterEach(() => {
  delete process.env.TWELVE_DATA_API_KEY;
});

describe('Dynamic Symbol Resolution — เชื่อ assets.type แทน symbolRegistry ตอน "อ่าน" ราคา', () => {
  test('Precondition: Symbol ทดสอบต้องไม่อยู่ใน symbolRegistry จริง (กัน Test ผ่านด้วยเหตุผลผิด)', () => {
    expect(symbolRegistry.lookupType(UNREGISTERED_SYMBOL)).toBeNull();
  });

  // ── หัวใจของงานนี้ (Red ก่อนแก้ / Green หลังแก้) ────────────────────────────
  test('getAssetProfit: Asset สกุล USD ที่ Registry ไม่รู้จัก แต่ DB มี type=stock_us → ดึงราคาจาก Twelve Data ได้สำเร็จ', async () => {
    const fetchMock = mockTwelveData({ closeUsd: '12.50' });

    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-zzznew',
      userId: USER_ID,
      symbol: UNREGISTERED_SYMBOL,
      type: 'stock_us', // ← Type ที่ถูกต้อง บันทึกไว้ตอนสร้าง Asset (Manual Quantity Fallback)
      projId: null,
      fundClassName: null,
    });
    // ถือ 10 หน่วย ต้นทุนรวม 100 USD → avg = 10 USD/หน่วย
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 10, amountThb: 100, currency: 'USD' },
    ]);

    const result = await getAssetProfit(USER_ID, UNREGISTERED_SYMBOL);

    // ก่อนแก้: getCurrentPriceUsd → lookupType(null) → คืน null → โยน
    //          PRICE_FEED_NOT_IMPLEMENTED (Test นี้ Fail ตรงนี้ = Red)
    // หลังแก้: ส่ง asset.type เข้าไป → Route ไป Twelve Data ได้ราคา 12.50 USD
    expect(result.currency).toBe('USD');
    expect(result.currentPrice).toBeCloseTo(12.5, 5);
    expect(result.currentValue).toBeCloseTo(125, 2); // 10 × 12.50
    expect(result.profitLoss).toBeCloseTo(25, 2); // 125 − 100
    expect(result.priceSource).toBe('twelvedata');

    // ยืนยันว่ายิง Twelve Data จริง (ไม่ใช่แค่ไม่ Error)
    const quoteCall = fetchMock.mock.calls.find(([u]) => u.includes('/quote'));
    expect(quoteCall[0]).toContain(`symbol=${UNREGISTERED_SYMBOL}`);
  });

  test('getAssetProfit: Asset สกุล THB ที่ Registry ไม่รู้จัก แต่ DB มี type=stock_us → แปลง USD→THB ได้', async () => {
    mockTwelveData({ closeUsd: '12.50', rate: 36 });

    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-zzznew-thb',
      userId: USER_ID,
      symbol: UNREGISTERED_SYMBOL,
      type: 'stock_us',
      projId: null,
      fundClassName: null,
    });
    // ธุรกรรมเป็น THB (ไม่มี currency='USD') → currency = 'THB' → ใช้ getCurrentPrice
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 10, amountThb: 4000 },
    ]);

    const result = await getAssetProfit(USER_ID, UNREGISTERED_SYMBOL);

    expect(result.currency).toBe('THB');
    // 12.50 USD × 36 = 450 THB/หน่วย → 10 หน่วย = 4,500 THB
    expect(result.currentPrice).toBeCloseTo(450, 5);
    expect(result.currentValue).toBeCloseTo(4500, 2);
    expect(result.profitLoss).toBeCloseTo(500, 2); // 4500 − 4000
  });

  test('priceHoldings (Dashboard/Cron): Holding ที่ Registry ไม่รู้จัก แต่มี type=stock_us → ได้ราคา ไม่ถูกนับเป็น priceUnavailable', async () => {
    mockTwelveData({ closeUsd: '12.50' });

    const priced = await portfolioSummaryService.priceHoldings([
      {
        symbol: UNREGISTERED_SYMBOL,
        type: 'stock_us',
        currency: 'USD',
        heldQuantity: 10,
        totalInvested: 100,
        projId: null,
        fundClassName: null,
      },
    ]);

    expect(priced).toHaveLength(1);
    expect(priced[0].priceUnavailable).toBe(false);
    expect(priced[0].price).toBeCloseTo(12.5, 5);
  });

  // ── Fallback (Defense in Depth): type ผิดปกติ → ยังถอยไปใช้ Registry ได้ ──────
  test('Fallback: asset.type เป็น null (Data เก่าผิดปกติ) แต่ Symbol อยู่ใน Registry → ยังดึงราคาได้ผ่าน Registry', async () => {
    mockTwelveData({ closeUsd: '200.00', rate: 36 });

    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-aapl-notype',
      userId: USER_ID,
      symbol: 'AAPL', // อยู่ใน Registry (stock_us)
      type: null, // ← Type หายไป (Data ผิดปกติ) — ต้อง Fallback ไป Registry
      projId: null,
      fundClassName: null,
    });
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 2, amountThb: 300, currency: 'USD' },
    ]);

    const result = await getAssetProfit(USER_ID, 'AAPL');

    expect(result.currentPrice).toBeCloseTo(200, 5);
    expect(result.priceSource).toBe('twelvedata');
  });

  test('Fallback: type ที่ไม่รู้จักเลย และ Symbol ก็ไม่อยู่ใน Registry → คืน null ตามเดิม (ไม่เดาราคา)', async () => {
    const fetchMock = mockTwelveData({ closeUsd: '12.50' });

    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'asset-bogus',
      userId: USER_ID,
      symbol: UNREGISTERED_SYMBOL,
      type: 'something_weird', // ไม่ใช่ Type ที่ระบบรู้จัก
      projId: null,
      fundClassName: null,
    });
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 10, amountThb: 100, currency: 'USD' },
    ]);

    await expect(getAssetProfit(USER_ID, UNREGISTERED_SYMBOL)).rejects.toMatchObject({
      code: 'PRICE_FEED_NOT_IMPLEMENTED',
    });

    // ต้องไม่ยิง API เลย (ไม่เดา Route จาก Type ที่ไม่รู้จัก)
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
