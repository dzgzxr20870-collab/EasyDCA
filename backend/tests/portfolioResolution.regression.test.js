jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');

const transactionService = require('../src/services/transaction.service');
const profitService = require('../src/services/profit.service');
const assetResolution = require('../src/services/assetResolution.service');

// ═══════════════════════════════════════════════════════════════════════════
// Asset Resolution — บั๊กที่บล็อกการ Apply migration 044
// ═══════════════════════════════════════════════════════════════════════════
// พบตอนรีวิวโค้ด 24 ส.ค. 2569 · Post-mortem: docs/POSTMORTEM_PORTFOLIO_RESOLUTION.md
//
// ── บั๊ก ──────────────────────────────────────────────────────────────────
// migration 044 Backfill ให้สินทรัพย์ทุกแถวมี portfolio_id → ไม่เหลือแถวที่
// portfolio_id IS NULL อีกเลย · แต่โค้ดค้นหาด้วย .is('portfolio_id', null) เสมอ
// เพราะทุก Caller เขียน `params.portfolioId ?? null` ตามกันหมด และ
// resolveOwnedAsset มี Default Parameter `portfolioId = null`
// → หาสินทรัพย์เดิมไม่เจอทุกครั้ง → **ซื้อแล้วสร้างแถวซ้ำ** = ประวัติแตกคนละ
// asset_id → Moving Average Cost Basis เห็นครึ่งเดียว → ต้นทุน/P&L ผิดแบบเงียบ
//
// ── ⭐ ทำไมเทสต์ 2,624 ตัวเดิมจับไม่ได้เลยแม้แต่ตัวเดียว ────────────────────
// **ทุก Fixture เดิมจำลอง "โลกก่อน 044"** — สินทรัพย์ในเทสต์ไม่มี portfolioId
// หรือเป็น null ซึ่งตรงกับที่โค้ดค้นหาพอดี จึงเขียวสนิททั้งที่บั๊กมีอยู่จริง
// ไฟล์นี้จึงมี Fixture **"โลกหลัง 044"** เป็นหัวใจ: ทุกแถวมี portfolio_id จริง
// และ Repository จำลองการกรองแบบเดียวกับ PostgREST เป๊ะ
//
// ⚠️ ห้ามแก้ Fixture ให้ portfolioId เป็น null เพื่อให้เทสต์ผ่าน — นั่นคือการ
// ลบคุณค่าทั้งหมดของไฟล์นี้ทิ้ง

const USER_ID = 'user-uuid-1';
const P1 = 'aaaaaaaa-1111-4111-8111-111111111111'; // พอร์ต Default หลัง Backfill
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222'; // พอร์ตที่ 2 (Premium)

const DEFAULT_PORTFOLIO = {
  id: P1,
  userId: USER_ID,
  name: 'พอร์ตของฉัน',
  type: 'custom',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// ── สินทรัพย์ "โลกก่อน 044" — portfolio_id เป็น NULL ทุกแถว ────────────────
const BTC_BEFORE_044 = {
  id: 'asset-btc',
  userId: USER_ID,
  symbol: 'BTC',
  type: 'crypto',
  brokerId: null,
  portfolioId: null,
};

// ── สินทรัพย์ "โลกหลัง 044" — ทุกแถวสังกัดพอร์ตแล้ว ⭐ หัวใจของไฟล์นี้ ──────
const BTC_AFTER_044 = { ...BTC_BEFORE_044, portfolioId: P1 };
const BTC_IN_P2 = { ...BTC_BEFORE_044, id: 'asset-btc-p2', portfolioId: P2 };

// จำลอง findAllByUserAndSymbol ให้กรองแบบเดียวกับ PostgREST เป๊ะ:
//   undefined → ไม่กรอง portfolio_id เลย (คืนทุกแถวของ Symbol นั้น)
//   null      → .is('portfolio_id', null)
//   '<uuid>'  → .eq('portfolio_id', uuid)
//
// ⚠️ ตัวจำลองนี้คือสิ่งที่ทำให้เทสต์จับบั๊กได้ — ถ้าเขียนให้ยุบ undefined กับ null
// เข้าด้วยกัน (แบบที่โค้ดเดิมทำ) เทสต์จะเขียวทั้งที่บั๊กยังอยู่
function installRepo(rows) {
  assetRepository.findAllByUserAndSymbol.mockImplementation(
    async (_userId, symbol, portfolioId) => {
      const bySymbol = rows.filter((r) => r.symbol === symbol);
      if (portfolioId === undefined) return bySymbol;
      if (portfolioId === null) return bySymbol.filter((r) => (r.portfolioId ?? null) === null);
      return bySymbol.filter((r) => r.portfolioId === portfolioId);
    }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  portfolioRepository.findAllByUser.mockResolvedValue([DEFAULT_PORTFOLIO]);
  portfolioRepository.findDefaultByUser.mockResolvedValue(DEFAULT_PORTFOLIO);
  portfolioRepository.findByIdForUser.mockResolvedValue(DEFAULT_PORTFOLIO);
  assetRepository.findActiveSymbolsByUser.mockResolvedValue(['BTC']);
  assetRepository.create.mockResolvedValue(BTC_AFTER_044);
  transactionRepository.create.mockResolvedValue({ id: 'tx-1' });
  transactionRepository.findAllByAsset.mockResolvedValue([
    { id: 'tx-0', type: 'buy', quantity: 1, amountThb: 1000, pricePerUnit: 1000, date: '2026-01-05' },
  ]);
  priceFeedService.getCurrentPrice.mockResolvedValue(1000);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-24', stale: false });
});

const FREE_USER = { plan: 'free', planExpiresAt: null };
const BUY = { symbol: 'BTC', quantity: 1, pricePerUnit: 1000, type: 'crypto' };

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ โลกหลัง migration 044 — ทุกแถวมี portfolio_id แล้ว', () => {
  beforeEach(() => installRepo([BTC_AFTER_044]));

  // ⭐⭐ เคสสำคัญที่สุดของทั้งไฟล์ — บั๊กที่แตะเงินจริงและพังเงียบ
  // assert ว่า create **ไม่ถูกเรียก** ไม่ใช่แค่ assert ว่าผลลัพธ์ดูถูก
  // (ผลลัพธ์จะ "ดูถูก" ได้แม้บั๊กยังอยู่ เพราะแถวใหม่ก็มี symbol เดียวกัน)
  test('⭐ ซื้อ Symbol ที่ถืออยู่แล้ว → เจอแถวเดิม **ห้ามสร้างแถวใหม่**', async () => {
    const result = await transactionService.validateBuy(USER_ID, BUY, FREE_USER);

    expect(result.newAsset).toBe(false);
    expect(result.asset.id).toBe('asset-btc');
    expect(result.asset.portfolioId).toBe(P1);
  });

  test('⭐ processBuyCommand → ไม่เรียก assetRepository.create เลย (ไม่มีแถวซ้ำเกิดขึ้น)', async () => {
    await transactionService.processBuyCommand(USER_ID, BUY, FREE_USER);

    // นี่คือ Assertion ที่จับบั๊กได้จริง — บั๊กเดิมจะเรียก create เพราะคิดว่าเป็น Asset ใหม่
    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-btc', type: 'buy' })
    );
  });

  test('ขาย Symbol ที่ถืออยู่ → เจอ ไม่ใช่ ASSET_NOT_FOUND', async () => {
    const result = await transactionService.validateSell(USER_ID, {
      symbol: 'BTC',
      quantity: 1,
      pricePerUnit: 1200,
    });

    expect(result.asset.id).toBe('asset-btc');
  });

  test('"ดูกำไร" → เจอสินทรัพย์ (profit.service ไม่ส่ง portfolioId มาเลย)', async () => {
    const result = await profitService.getAssetProfit(USER_ID, 'BTC');

    expect(result.symbol).toBe('BTC');
  });

  test('resolveOwnedAsset ไม่ระบุพอร์ต → ต้องเจอแถวที่สังกัดพอร์ตอยู่', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC');

    expect(asset).not.toBeNull();
    expect(asset.portfolioId).toBe(P1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('โลกก่อน migration 044 — พฤติกรรมต้องเหมือนเดิมเป๊ะ', () => {
  // ⚠️ โค้ดที่แก้แล้วต้องทำงานถูกทั้งก่อนและหลัง 044 เพราะลำดับ Deploy คือ
  // "Deploy โค้ดก่อน → ค่อย Apply 044" (ดูหัวไฟล์ migration 044)
  beforeEach(() => installRepo([BTC_BEFORE_044]));

  test('ซื้อ Symbol ที่ถืออยู่แล้ว → เจอแถวเดิม ไม่สร้างใหม่', async () => {
    const result = await transactionService.validateBuy(USER_ID, BUY, FREE_USER);

    expect(result.newAsset).toBe(false);
    expect(result.asset.id).toBe('asset-btc');
  });

  test('ขาย → เจอ', async () => {
    const result = await transactionService.validateSell(USER_ID, {
      symbol: 'BTC',
      quantity: 1,
      pricePerUnit: 1200,
    });

    expect(result.asset.id).toBe('asset-btc');
  });

  test('Symbol ที่ยังไม่เคยถือ → สร้างใหม่ตามปกติ', async () => {
    const result = await transactionService.validateBuy(
      USER_ID,
      { ...BUY, symbol: 'ETH' },
      FREE_USER
    );

    expect(result.newAsset).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('กติกา portfolioId — undefined / null / uuid ต้องแยกกัน 3 ทาง', () => {
  // ⚠️ กติกาเดียวกับ brokerId ของ Stage 5 เป๊ะ (ไม่ใช่ Pattern ใหม่):
  //   undefined = "ยังไม่ระบุ / พอร์ตไหนก็ได้"
  //   null      = "เจาะจงว่าไม่มีพอร์ต"
  //   uuid      = เจาะจงพอร์ตนั้น
  beforeEach(() => installRepo([BTC_AFTER_044, { ...BTC_BEFORE_044, id: 'asset-btc-nullport' }]));

  test('undefined → เห็นทุกแถวข้ามพอร์ต (จึงกำกวมเมื่อมีหลายแถว)', async () => {
    await expect(assetResolution.resolveOwnedAsset(USER_ID, 'BTC')).rejects.toMatchObject({
      code: 'AMBIGUOUS_ASSET_PORTFOLIO',
    });
  });

  // ⚠️ เคสนี้กันคนแก้แล้วยุบ 3 กรณีเหลือ 2 อีกรอบ
  test('⚠️ null แบบเจาะจง → ได้เฉพาะแถวที่ portfolio_id IS NULL', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', {
      portfolioId: null,
    });

    expect(asset.id).toBe('asset-btc-nullport');
  });

  test('uuid → ได้เฉพาะแถวของพอร์ตนั้น', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', {
      portfolioId: P1,
    });

    expect(asset.id).toBe('asset-btc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ ถือ Symbol เดียวกันข้ามพอร์ต — ห้ามเดา (กฎยืนข้อ 11)', () => {
  beforeEach(() => installRepo([BTC_AFTER_044, BTC_IN_P2]));

  // ⭐ ถ้าเงียบๆ ไปสร้างแถวใหม่ในพอร์ต Default = บั๊กเดิมกลับมาในรูปใหม่
  test('⭐ ซื้อโดยไม่ระบุพอร์ต ขณะถือ BTC อยู่ 2 พอร์ต → ต้องถาม ไม่ใช่เดา', async () => {
    await expect(
      transactionService.validateBuy(USER_ID, BUY, FREE_USER)
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Error พก candidates (assetId + portfolioId) ไปให้ชั้นบนสร้างตัวเลือกได้', async () => {
    const err = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC').catch((e) => e);

    expect(err.code).toBe('AMBIGUOUS_ASSET_PORTFOLIO');
    expect(err.details.candidates).toEqual([
      { assetId: 'asset-btc', portfolioId: P1, brokerId: null },
      { assetId: 'asset-btc-p2', portfolioId: P2, brokerId: null },
    ]);
  });

  test('ระบุพอร์ตมาแล้ว → ไม่กำกวม บันทึกได้ปกติ', async () => {
    const result = await transactionService.validateBuy(
      USER_ID,
      { ...BUY, portfolioId: P2 },
      FREE_USER
    );

    expect(result.asset.id).toBe('asset-btc-p2');
  });

  test('ขายโดยไม่ระบุพอร์ต ขณะถือ 2 พอร์ต → ถาม ไม่ใช่ตัดยอดพอร์ตผิด', async () => {
    await expect(
      transactionService.validateSell(USER_ID, { symbol: 'BTC', quantity: 1, pricePerUnit: 1200 })
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});
