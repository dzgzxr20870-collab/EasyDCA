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

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ หางของบั๊กเดียวกัน (รอบที่ 2) — "ระบุโบรกแล้วข้ามด่านพอร์ตทั้งหมด"
// ═══════════════════════════════════════════════════════════════════════════
// พบตอนรีวิว 27 ส.ค. 2569 · เป็น **บั๊กคลาสเดียวกันเป๊ะ** กับข้างบน ไม่ใช่บั๊กใหม่
//
// ── บั๊ก ──────────────────────────────────────────────────────────────────
// resolveOwnedAsset เคยเรียงลำดับเป็น [กรองโบรก → return] แล้วค่อยมีด่านพอร์ต
// อยู่ "ข้างล่างจุด return" — พอผู้ใช้ตอบโบรกมาแล้ว (brokerId !== undefined)
// การตัดสินจึงจบที่ `.find()` ซึ่ง **หยิบแถวแรกตาม created_at เงียบๆ**
// → ถือ BTC @ Bitkub อยู่ทั้งพอร์ต A และพอร์ต B (ถูกต้องตาม UNIQUE ของ 046
//   เพราะ portfolio_id ต่างกัน) → เขียนธุรกรรมเข้าพอร์ตผิด → ต้นทุนเฉลี่ยของ
//   **ทั้งสองพอร์ตเพี้ยนพร้อมกัน** โดยไม่มี Error ให้เห็น
//
// ── ทำไม 18 เคสข้างบนจับไม่ได้ ────────────────────────────────────────────
// ทุกเคสข้างบนเป็น "พอร์ตกำกวม แต่ไม่ได้ระบุโบรก" หรือ "โบรกกำกวม แต่พอร์ตเดียว"
// **ไม่มีเคสไหนผสมสองมิติพร้อมกัน** (ระบุโบรก + Symbol อยู่ 2 พอร์ต) เลยแม้แต่เคสเดียว
//
// ⚠️ คนที่แยกพอร์ต "ระยะสั้น/ระยะยาว" แต่ใช้ Exchange เดียว = การใช้งานปกติมาก
// ไม่ใช่ Edge Case ที่ต้องจงใจสร้าง

const BK = 'cccccccc-3333-4333-8333-333333333333'; // โบรก Bitkub
const BN = 'dddddddd-4444-4444-8444-444444444444'; // โบรก Binance

// ถือ BTC ที่ **โบรกเดียวกัน** แต่คนละพอร์ต — นี่คือรูปแบบที่พังเงียบ
const BTC_BK_P1 = { ...BTC_BEFORE_044, id: 'asset-btc-bk-p1', portfolioId: P1, brokerId: BK };
const BTC_BK_P2 = { ...BTC_BEFORE_044, id: 'asset-btc-bk-p2', portfolioId: P2, brokerId: BK };
// ถือ BTC 2 โบรกใน **พอร์ตเดียวกัน** — เคสปกติของ Stage 5 (ต้องไม่เปลี่ยนพฤติกรรม)
const BTC_BN_P1 = { ...BTC_BEFORE_044, id: 'asset-btc-bn-p1', portfolioId: P1, brokerId: BN };

describe('⭐ ระบุโบรกแล้ว แต่ Symbol อยู่หลายพอร์ต — ห้ามหยิบแถวแรกเงียบๆ', () => {
  beforeEach(() => installRepo([BTC_BK_P1, BTC_BK_P2]));

  // ⭐⭐ เคสสำคัญที่สุดของบล็อกนี้ — ถ้าแดงแปลว่าธุรกรรมกำลังเข้าพอร์ตผิด
  test('⭐ resolveOwnedAsset: brokerId=Bitkub + BTC อยู่ 2 พอร์ต → ต้องถาม ไม่ใช่หยิบแถวแรก', async () => {
    await expect(
      assetResolution.resolveOwnedAsset(USER_ID, 'BTC', { brokerId: BK })
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });
  });

  // assert ว่า "ไม่มีอะไรถูกเขียนลง DB เลย" ไม่ใช่แค่ assert ว่า throw
  test('⭐ validateBuy: ระบุโบรกแล้วยังกำกวมพอร์ต → ห้ามเขียน DB แม้แต่แถวเดียว', async () => {
    await expect(
      transactionService.validateBuy(USER_ID, { ...BUY, brokerId: BK }, FREE_USER)
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('⭐ processBuyCommand: เส้นทาง Commit จริงก็ต้องถูกดักเหมือนกัน', async () => {
    await expect(
      transactionService.processBuyCommand(USER_ID, { ...BUY, brokerId: BK }, FREE_USER)
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ขายก็ต้องถูกดัก — ไม่ใช่ตัดยอดพอร์ตผิด', async () => {
    await expect(
      transactionService.validateSell(USER_ID, {
        symbol: 'BTC',
        quantity: 1,
        pricePerUnit: 1200,
        brokerId: BK,
      })
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  // Error ต้องพกตัวเลือกไปให้ชั้นบนสร้างปุ่มได้ โดยเหลือเฉพาะตัวเลือกที่ยังเป็นไปได้
  test('candidates ที่พกไปต้องเหลือเฉพาะแถวของโบรกที่ผู้ใช้ตอบมาแล้ว', async () => {
    const err = await assetResolution
      .resolveOwnedAsset(USER_ID, 'BTC', { brokerId: BK })
      .catch((e) => e);

    expect(err.details.candidates).toEqual([
      { assetId: 'asset-btc-bk-p1', portfolioId: P1, brokerId: BK },
      { assetId: 'asset-btc-bk-p2', portfolioId: P2, brokerId: BK },
    ]);
  });

  // ⚠️ กฎยืนข้อ 10 — ตอบครบทั้งสองมิติแล้วห้ามถามอะไรอีก
  test('ระบุทั้ง brokerId และ portfolioId → เจอแถวเดียวเป๊ะ ไม่ถามอะไรเลย', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', {
      brokerId: BK,
      portfolioId: P2,
    });

    expect(asset.id).toBe('asset-btc-bk-p2');
  });

  // โบรกใหม่ที่ยังไม่เคยถือ แต่ Symbol นี้กระจายอยู่ 2 พอร์ต → ปลายทางของแถวใหม่
  // ยังกำกวมอยู่ดี (จะสร้างใน P1 หรือ P2?) จึงต้องถาม ไม่ใช่ลงพอร์ต Default เงียบๆ
  test('โบรกใหม่ + Symbol กระจาย 2 พอร์ต → ยังต้องถามพอร์ตก่อนสร้างแถวใหม่', async () => {
    await expect(
      assetResolution.resolveOwnedAsset(USER_ID, 'BTC', { brokerId: BN })
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });
  });
});

describe('พฤติกรรม Stage 5 เดิม (โบรกหลายเจ้าในพอร์ตเดียว) ต้องไม่เปลี่ยน', () => {
  beforeEach(() => installRepo([BTC_BK_P1, BTC_BN_P1]));

  test('ระบุ brokerId + Symbol อยู่พอร์ตเดียว (แต่หลายโบรก) → เจอแถวถูก ไม่ถามซ้ำ', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', { brokerId: BN });

    expect(asset.id).toBe('asset-btc-bn-p1');
  });

  test('ไม่ระบุโบรก + พอร์ตเดียวแต่หลายโบรก → ถามโบรก (ไม่ใช่ถามพอร์ต)', async () => {
    await expect(
      assetResolution.resolveOwnedAsset(USER_ID, 'BTC')
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_BROKER' });
  });

  test('ระบุ brokerId ที่ยังไม่เคยถือ (พอร์ตเดียว) → asset = null ให้ Caller สร้างใหม่', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', {
      brokerId: 'eeeeeeee-5555-4555-8555-555555555555',
    });

    expect(asset).toBeNull();
  });

  test('ระบุ brokerId + ไม่เคยถือ Symbol นี้เลย → asset = null', async () => {
    const { asset, candidates } = await assetResolution.resolveOwnedAsset(USER_ID, 'ETH', {
      brokerId: BK,
    });

    expect(asset).toBeNull();
    expect(candidates).toEqual([]);
  });
});

// ⚠️ เคสนี้คือเหตุผลที่เลือก "กรองโบรกก่อน แล้วค่อยตรวจพอร์ต" แทนการตรวจ
// candidates ทั้งชุดก่อนเสมอ — ถ้าตรวจทั้งชุดก่อน เคสนี้จะถามพอร์ตทั้งที่คำตอบ
// เหลือทางเดียวอยู่แล้ว = เพิ่ม Latency บน Live Path โดยไม่จำเป็น (กฎยืนข้อ 10)
describe('กฎยืนข้อ 10 — โบรกที่ตอบมาแล้วชี้พอร์ตได้ทางเดียว ห้ามถามซ้ำ', () => {
  // BTC @ Bitkub อยู่พอร์ต 1 · BTC @ Binance อยู่พอร์ต 2 (คนละโบรก คนละพอร์ต)
  beforeEach(() => installRepo([BTC_BK_P1, { ...BTC_BN_P1, portfolioId: P2 }]));

  test('ตอบ Bitkub แล้ว → ปลายทางเหลือพอร์ต 1 ทางเดียว ต้องไม่ถามพอร์ต', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', { brokerId: BK });

    expect(asset.id).toBe('asset-btc-bk-p1');
    expect(asset.portfolioId).toBe(P1);
  });

  test('ยังไม่ตอบโบรก → กำกวมทั้งสองมิติ ต้องถาม **พอร์ตก่อน** ไม่ใช่โบรกก่อน', async () => {
    await expect(
      assetResolution.resolveOwnedAsset(USER_ID, 'BTC')
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });
  });

  // ตอบพอร์ตแล้ว candidates ถูกกรองตั้งแต่ Repository → มิติโบรกเหลือทางเดียวเอง
  test('ตอบพอร์ตแล้ว → มิติโบรกเหลือทางเดียวเอง ไม่ต้องถามรอบสอง', async () => {
    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', {
      portfolioId: P2,
    });

    expect(asset.brokerId).toBe(BN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// destinationPortfolioId — ช่อง "บันทึกลงพอร์ต" บนฟอร์มเว็บ (29 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// เคสจริงที่ Founder เจอ: สร้างพอร์ตใหม่ → เลือกเป็นปลายทาง → ซื้อสินทรัพย์ใหม่
// → รายการไปโผล่ "พอร์ตหลัก" แทน เพราะเว็บไม่เคยส่งพอร์ตปลายทางมาเลยสักครั้ง
//
// ⚠️⚠️ ไฟล์นี้คือที่ที่เทสต์ชุดนี้ต้องอยู่ — เพราะวิธีแก้ที่ "ตรงตัวที่สุด" (ยัด
// พอร์ตที่ผู้ใช้เลือกลง params.portfolioId ตรงๆ) จะปลุกบั๊กของไฟล์นี้ขึ้นมาใหม่
// เป๊ะๆ: portfolioId เป็นขอบเขตการค้นหาด้วย การหดขอบเขตจะทำให้ "หาแถวเดิมไม่เจอ
// → สร้างแถวซ้ำข้ามพอร์ต" ซึ่งคือ Post-mortem ของไฟล์นี้ทั้งไฟล์
//
// ── RED-GREEN ────────────────────────────────────────────────────────────
//   • เปลี่ยน newAssetPortfolioId กลับเป็น portfolioId เฉยๆ → เคส ⭐ (1) แดง
//   • ส่ง destinationPortfolioId ลง resolveOwnedAsset ด้วย → เคส ⭐⭐ (2) แดง
describe('⭐ destinationPortfolioId — เลือกพอร์ตปลายทางจากฟอร์มเว็บ', () => {
  const P2_PORTFOLIO = { ...DEFAULT_PORTFOLIO, id: P2, name: 'Dime', isDefault: false };

  beforeEach(() => {
    // ผู้ใช้มี 2 พอร์ต และ **ทั้งคู่เขียนได้** (Premium ที่ยัง Active)
    portfolioRepository.findAllByUser.mockResolvedValue([DEFAULT_PORTFOLIO, P2_PORTFOLIO]);
    portfolioRepository.findByIdForUser.mockResolvedValue(P2_PORTFOLIO);
  });

  const PREMIUM = { plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' };

  // ⭐ (1) เคสที่ Founder เจอ — สินทรัพย์ใหม่ที่ไม่เคยถือ ต้องลงพอร์ตที่เลือกจริง
  test('⭐ ซื้อสินทรัพย์ใหม่ + เลือกพอร์ต "Dime" → ลงพอร์ตนั้น ไม่ใช่พอร์ตหลัก', async () => {
    installRepo([]); // ยังไม่เคยถือ ETH ที่ไหนเลย
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);

    const result = await transactionService.validateBuy(
      USER_ID,
      { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto', destinationPortfolioId: P2 },
      PREMIUM
    );

    expect(result.newAsset).toBe(true);
    expect(result.portfolioId).toBe(P2);
  });

  // ⭐⭐ (2) หัวใจของการแก้ — ต้องไม่ปลุกบั๊ก "สร้างแถวซ้ำข้ามพอร์ต" ขึ้นมาใหม่
  // ถือ BTC อยู่พอร์ตหลักแล้ว แต่ผู้ใช้เลือกปลายทางเป็น Dime → ต้อง **รวมเข้า
  // แถวเดิมที่พอร์ตหลัก** ไม่ใช่สร้าง BTC แถวที่สองใน Dime
  // (ตรงกับข้อความที่ฟอร์มบอกผู้ใช้ไว้: "ถ้ามีอยู่แล้วในพอร์ตอื่น ระบบจะรวมไว้ที่เดิม")
  // ⚠️⚠️ **มติ Founder 29 ส.ค. 2569 เปลี่ยนพฤติกรรมตรงนี้โดยตั้งใจ**
  // เดิม: ถือ Symbol นี้อยู่พอร์ตอื่น + เลือกปลายทางใหม่ → **รวมเข้าแถวเดิมเงียบๆ**
  // ใหม่: **หยุดถามผู้ใช้ก่อน** แล้วให้เลือกเองว่าจะแยกหรือรวม
  //
  // ⭐ นี่ไม่ใช่การย้อนกลับไปสร้างบั๊กของไฟล์นี้ — บั๊กเดิมคือ "สร้างแถวซ้ำเงียบๆ
  // เพราะค้นหาไม่เจอแถวเดิม" ที่นี่ **ค้นเจอครบเหมือนเดิมทุกประการ** (เทสต์
  // ด้านล่างยืนยันว่ายังเจอ asset-btc) แล้วหยุดถาม · เส้นแบ่งคือ "เจตนาของผู้ใช้"
  test('⭐⭐ ถือ BTC ที่พอร์ตหลัก + เลือกปลายทาง Dime + ยังไม่ตอบ → ต้องหยุดถามก่อน', async () => {
    installRepo([BTC_AFTER_044]);

    await expect(
      transactionService.validateBuy(USER_ID, { ...BUY, destinationPortfolioId: P2 }, PREMIUM)
    ).rejects.toMatchObject({
      code: 'ASSET_EXISTS_IN_OTHER_PORTFOLIO',
      // ต้องบอกได้ว่า "ของเดิมอยู่พอร์ตไหน" เพื่อให้ UI ประกอบประโยคถามผู้ใช้ได้
      details: { symbol: 'BTC', existingPortfolioId: P1, destinationPortfolioId: P2 },
    });
  });

  test('⭐⭐ ยังไม่ตอบ → ห้ามเขียนอะไรลง DB เลยแม้แต่แถวเดียว', async () => {
    installRepo([BTC_AFTER_044]);

    await expect(
      transactionService.processBuyCommand(USER_ID, { ...BUY, destinationPortfolioId: P2 }, PREMIUM)
    ).rejects.toMatchObject({ code: 'ASSET_EXISTS_IN_OTHER_PORTFOLIO' });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  // ⭐ ตอบว่า "รวมพอร์ตเดิม" (false) → พฤติกรรมเดิมทุกประการ
  // ⚠️ false ต้องแยกจาก undefined ให้ขาด ไม่งั้นผู้ใช้ที่เลือกรวมจะโดนถามซ้ำไม่รู้จบ
  test('⭐⭐ ตอบว่า "รวมพอร์ตเดิม" → รวมแถวเดิม ห้ามสร้างซ้ำ (พฤติกรรมเดิม)', async () => {
    installRepo([BTC_AFTER_044]);

    const result = await transactionService.validateBuy(
      USER_ID,
      { ...BUY, destinationPortfolioId: P2, confirmSeparatePortfolio: false },
      PREMIUM
    );

    expect(result.newAsset).toBe(false);
    expect(result.asset.id).toBe('asset-btc');
    // ปลายทางจริงคือพอร์ตของแถวเดิม ไม่ใช่พอร์ตที่ผู้ใช้เลือก
    expect(result.asset.portfolioId).toBe(P1);
  });

  test('⭐⭐ ตอบว่า "รวมพอร์ตเดิม" → processBuyCommand ไม่เรียก create เลย', async () => {
    installRepo([BTC_AFTER_044]);

    await transactionService.processBuyCommand(
      USER_ID,
      { ...BUY, destinationPortfolioId: P2, confirmSeparatePortfolio: false },
      PREMIUM
    );

    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  // ⭐⭐ ตอบว่า "แยกพอร์ต" (true) → สร้างแถวใหม่ในพอร์ตปลายทางจริง
  test('⭐⭐ ตอบว่า "แยกพอร์ต" → สร้างแถวใหม่ใน Dime (แถวเดิมที่พอร์ตหลักไม่ถูกแตะ)', async () => {
    installRepo([BTC_AFTER_044]);

    const result = await transactionService.validateBuy(
      USER_ID,
      { ...BUY, destinationPortfolioId: P2, confirmSeparatePortfolio: true },
      PREMIUM
    );

    expect(result.newAsset).toBe(true);
    expect(result.portfolioId).toBe(P2);
  });

  test('⭐⭐ ตอบว่า "แยกพอร์ต" → create ถูกเรียกด้วยพอร์ตปลายทาง และไม่แตะแถวเดิม', async () => {
    installRepo([BTC_AFTER_044]);

    await transactionService.processBuyCommand(
      USER_ID,
      { ...BUY, destinationPortfolioId: P2, confirmSeparatePortfolio: true },
      PREMIUM
    );

    // Argument ที่ 2 ของ create คือพอร์ตที่แถวใหม่จะไปสังกัด
    expect(assetRepository.create.mock.calls[0][1]).toBe(P2);
    // ⚠️ แถวเดิมต้องไม่ถูกแก้ไขเลย — การแยกคือ "เพิ่มแถวใหม่" ไม่ใช่ "ย้ายของเดิม"
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });

  // ⚠️ ปลายทาง = พอร์ตเดียวกับที่ถืออยู่แล้ว → ไม่ใช่เคส "คนละพอร์ต" ห้ามถาม
  test('ปลายทางตรงกับพอร์ตที่ถืออยู่แล้ว → รวมตามปกติ ไม่ต้องถาม', async () => {
    installRepo([BTC_AFTER_044]);

    const result = await transactionService.validateBuy(
      USER_ID,
      { ...BUY, destinationPortfolioId: P1 },
      PREMIUM
    );

    expect(result.newAsset).toBe(false);
    expect(result.asset.id).toBe('asset-btc');
  });

  // ถือกระจายหลายพอร์ต → ยังต้องถามผู้ใช้เหมือนเดิม ห้ามให้ปลายทางที่เลือกมา
  // "กลบ" ความกำกวมไปเงียบๆ (กฎยืนข้อ 11)
  test('ถือ BTC กระจาย 2 พอร์ต + เลือกปลายทาง → ยังต้อง AMBIGUOUS_ASSET_PORTFOLIO', async () => {
    installRepo([BTC_AFTER_044, BTC_IN_P2]);

    await expect(
      transactionService.validateBuy(USER_ID, { ...BUY, destinationPortfolioId: P2 }, PREMIUM)
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_PORTFOLIO' });
  });

  // ไม่ส่ง Key มาเลย = เส้นทางเดิมทุกช่องทาง (LINE/Bulk/เว็บก่อนรอบนี้)
  test('ไม่ส่ง destinationPortfolioId → ลงพอร์ตหลักเหมือนเดิมเป๊ะ (Backward Compat)', async () => {
    installRepo([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);

    const result = await transactionService.validateBuy(
      USER_ID,
      { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
      PREMIUM
    );

    expect(result.newAsset).toBe(true);
    expect(result.portfolioId).toBe(P1);
  });
});
