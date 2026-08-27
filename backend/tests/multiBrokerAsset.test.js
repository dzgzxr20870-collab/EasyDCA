// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 (migration 046) — ถือ Symbol เดียวกันได้หลายโบรก
// ═══════════════════════════════════════════════════════════════════════════
// ครอบ 2 เรื่องที่ "ผิดแล้วเงินเพี้ยนเงียบๆ" ซึ่งเกิดจากการเปลี่ยน UNIQUE Key เป็น
//   UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id)
//
//   1) การแปลง Symbol → asset row (assetResolution.service) — ห้ามเดาแทนผู้ใช้
//      เมื่อ Symbol ตรงหลายแถว เพราะเดาผิด = ธุรกรรมลงโบรกผิด → ต้นทุนเฉลี่ยของ
//      สินทรัพย์สองก้อนเพี้ยนพร้อมกันโดยไม่มี Error ให้เห็น
//
//   2) เพดาน Free Plan ต้องนับ "จำนวน Symbol ที่ต่างกัน" ไม่ใช่จำนวนแถว
//      (มติ Founder 23 ส.ค. 2569: ถือ BTC ที่ 2 โบรก = 1 สินทรัพย์)
//
// ── RED-GREEN (พิสูจน์แล้วว่าเทสต์ชุดนี้ "แดงจริง" ถ้าถอด Fix ออก) ──────────────
//   • ถอด `throw AMBIGUOUS_ASSET_BROKER` ใน assetResolution.resolveOwnedAsset ออก
//     (เปลี่ยนเป็น `return { asset: candidates[0], candidates }` = หยิบแถวแรก
//     แบบ Silent Default) → describe 'resolveOwnedAsset' แดง 3 เคส
//   • เปลี่ยน validateBuy กลับไปนับแถว (`activeSymbols.length` → จำนวนแถวของ
//     assets) หรือถอดเงื่อนไข `isNewSymbol &&` ออก → describe 'เพดาน Free Plan'
//     แดงที่เคส "เพิ่มโบรกที่ 3 ให้ BTC ได้แม้เต็มเพดาน"
//   • ถอด `brokerId` ออกจาก return ของ validateBuy/validateSell → describe
//     'brokerId ต้องรอดข้าม Preview → Confirm' แดง

// Stage 8-fix (บั๊ก Asset Resolution) — validateBuy ต้อง Resolve พอร์ต Default
// ตอนสร้างสินทรัพย์ใหม่ (Invariant migration 044/045: สินทรัพย์ทุกแถวสังกัดพอร์ต)
// จึงต้อง Mock portfolio.repository ด้วย · Automock คืน undefined = "ยังไม่มีพอร์ต"
// ซึ่งตรงกับสภาพก่อน Apply 044 พอดี → พฤติกรรมของเทสต์เดิมไม่เปลี่ยน
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');

const assetResolution = require('../src/services/assetResolution.service');
const {
  validateBuy,
  validateSell,
  processBuyCommand,
  TransactionServiceError,
  MAX_FREE_ASSETS,
} = require('../src/services/transaction.service');

const USER_ID = 'user-uuid-1';
const BROKER_A = 'broker-aaaa-1111';
const BROKER_B = 'broker-bbbb-2222';
const BROKER_C = 'broker-cccc-3333';

// BTC ถือไว้ 2 โบรก (คนละแถว คนละ asset_id = คนละก้อนต้นทุน ตามดีไซน์)
const BTC_AT_A = { id: 'asset-btc-a', userId: USER_ID, symbol: 'BTC', type: 'crypto', brokerId: BROKER_A };
const BTC_AT_B = { id: 'asset-btc-b', userId: USER_ID, symbol: 'BTC', type: 'crypto', brokerId: BROKER_B };
// แถว "ไม่ระบุโบรก" (broker_id IS NULL) — เป็นค่าของทุกแถวเดิมในระบบวันนี้
const BTC_NO_BROKER = { id: 'asset-btc-n', userId: USER_ID, symbol: 'BTC', type: 'crypto', brokerId: null };

beforeEach(() => {
  jest.clearAllMocks();
  transactionRepository.create.mockResolvedValue({ id: 'tx-uuid-1' });
  transactionRepository.findAllByAsset.mockResolvedValue([]);
  assetRepository.create.mockResolvedValue({ ...BTC_AT_A });
  priceFeedService.getCurrentPrice.mockResolvedValue(null);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-24', stale: false });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('assetResolution.resolveOwnedAsset — "Symbol นี้หมายถึงแถวไหน"', () => {
  test('ยังไม่เคยถือ Symbol นี้เลย → asset = null (Caller ไปสร้างใหม่/โยน NOT_FOUND เอง)', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);

    const { asset, candidates } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC');

    expect(asset).toBeNull();
    expect(candidates).toEqual([]);
  });

  // กฎยืนข้อ 10 — ห้ามเพิ่มขั้นตอน/Latency บน Live Path โดยไม่จำเป็น
  test('⚠️ ถือโบรกเดียว → ห้ามถาม ต้องคืนแถวนั้นตรงๆ แม้ไม่ได้ระบุ brokerId มา', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A]);

    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC');

    expect(asset).toBe(BTC_AT_A);
  });

  // ⚠️ หัวใจของ Stage 5 — ถ้าเคสนี้เขียวโดยไม่ throw แปลว่าระบบกำลังเดาโบรกให้ผู้ใช้
  test('⚠️ ถือ 2 โบรก + ไม่ระบุ brokerId → ต้อง throw AMBIGUOUS_ASSET_BROKER (ห้ามหยิบแถวแรก)', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);

    await expect(assetResolution.resolveOwnedAsset(USER_ID, 'BTC')).rejects.toMatchObject({
      code: 'AMBIGUOUS_ASSET_BROKER',
    });
  });

  test('Error ที่โยนต้องพก candidates (assetId + brokerId) ไปให้ชั้นบนสร้างปุ่มได้เลย', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);

    const err = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC').catch((e) => e);

    expect(err.details.symbol).toBe('BTC');
    expect(err.details.candidates).toEqual([
      { assetId: 'asset-btc-a', brokerId: BROKER_A },
      { assetId: 'asset-btc-b', brokerId: BROKER_B },
    ]);
  });

  test('ระบุ brokerId มาแล้ว → เจาะจงแถวนั้น ไม่ throw', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);

    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', { brokerId: BROKER_B });

    expect(asset).toBe(BTC_AT_B);
  });

  // undefined (ยังไม่ได้ถาม) ≠ null (ตอบแล้วว่าไม่ระบุโบรก) — ความต่างนี้คือสิ่งที่
  // กัน "สร้างสินทรัพย์ซ้ำแถวใหม่" ซึ่งเป็นบั๊กเดียวกับที่ migration 014 เคยแก้
  test('⚠️ brokerId = null (ผู้ใช้ตอบว่า "ไม่ระบุโบรก") → เจาะจงแถวที่ broker_id IS NULL', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_NO_BROKER, BTC_AT_A]);

    const { asset } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', { brokerId: null });

    expect(asset).toBe(BTC_NO_BROKER);
  });

  test('ระบุโบรกที่ยังไม่เคยถือ Symbol นี้ → asset = null (buy จะไปสร้างแถวใหม่ของโบรกนั้น)', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);

    const { asset, candidates } = await assetResolution.resolveOwnedAsset(USER_ID, 'BTC', {
      brokerId: BROKER_C,
    });

    expect(asset).toBeNull();
    expect(candidates).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('เพดาน Free Plan นับ "Symbol ที่ต่างกัน" ไม่ใช่จำนวนแถว', () => {
  // สถานการณ์ตามโจทย์: Free ถือ BTC 2 โบรก + ETH 1 โบรก
  //   จำนวนแถวจริงใน assets = 3 (เกินเพดาน 2 ถ้านับแถว)
  //   จำนวนสินทรัพย์ตามนิยาม Founder = 2 (BTC, ETH) = เต็มเพดานพอดี
  const HELD_SYMBOLS = ['BTC', 'ETH'];
  const FREE = { plan: 'free', planExpiresAt: null };

  test('เพิ่มสินทรัพย์ตัวที่ 3 (SOL) ไม่ได้ — เต็มเพดาน Free', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue(HELD_SYMBOLS);

    await expect(
      validateBuy(USER_ID, { symbol: 'SOL', type: 'crypto', quantity: 1, pricePerUnit: 100 }, FREE)
    ).rejects.toMatchObject({ code: 'ASSET_LIMIT_REACHED', details: { limit: MAX_FREE_ASSETS, current: 2 } });
  });

  // ⚠️ เคสสำคัญที่สุดของ describe นี้ — ถ้าแดง แปลว่ากลับไปนับแถวแล้ว
  test('⚠️ แต่เพิ่ม "โบรกที่ 3" ให้ BTC ได้ แม้เต็มเพดานอยู่ (ไม่ได้เพิ่มจำนวนสินทรัพย์เลย)', async () => {
    // โบรก C ยังไม่เคยถือ BTC → resolveOwnedAsset คืน null → เข้าเส้นทาง "Asset ใหม่"
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue(HELD_SYMBOLS);

    const result = await validateBuy(
      USER_ID,
      { symbol: 'BTC', type: 'crypto', quantity: 1, pricePerUnit: 100, brokerId: BROKER_C },
      FREE
    );

    expect(result.newAsset).toBe(true);
    expect(result.brokerId).toBe(BROKER_C);
  });

  test('Premium ไม่ถูกจำกัด — ไม่ต้องยิง Query นับ Symbol เลย', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);

    await validateBuy(
      USER_ID,
      { symbol: 'SOL', type: 'crypto', quantity: 1, pricePerUnit: 100 },
      { plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' }
    );

    expect(assetRepository.findActiveSymbolsByUser).not.toHaveBeenCalled();
  });

  test('processBuyCommand ส่ง brokerId ต่อให้ assetRepository.create (RPC create_asset_locked)', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue(HELD_SYMBOLS);
    assetRepository.create.mockResolvedValue({ ...BTC_AT_A, id: 'asset-btc-c', brokerId: BROKER_C });

    await processBuyCommand(
      USER_ID,
      { symbol: 'BTC', type: 'crypto', quantity: 1, pricePerUnit: 100, brokerId: BROKER_C },
      FREE
    );

    // Argument ตัวที่ 8 ของ create(userId, portfolioId, symbol, name, type, fundInfo, assetLimit, brokerId)
    expect(assetRepository.create.mock.calls[0][7]).toBe(BROKER_C);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('brokerId ต้องรอดข้าม Preview → Confirm (บทเรียน POSTMORTEM_AMOUNT_CONSISTENCY)', () => {
  // validateBuy/validateSell ต้องคืน "โบรกของแถวที่ Resolve ได้จริง" ไม่ใช่ค่าดิบ
  // ที่ Caller ส่งมา — ไม่งั้น pendingTransaction จะเก็บ NULL ลง DB แล้วตอน Confirm
  // จะไปสร้างสินทรัพย์ "ไม่ระบุโบรก" ซ้ำขึ้นมาอีกแถว (ประวัติแตกคนละ asset_id)
  test('⚠️ validateBuy คืน brokerId ของแถวที่เจอ แม้ Caller ไม่ได้ส่ง brokerId มาเลย', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A]);

    const result = await validateBuy(USER_ID, {
      symbol: 'BTC',
      type: 'crypto',
      quantity: 1,
      pricePerUnit: 100,
    });

    expect(result.newAsset).toBe(false);
    expect(result.brokerId).toBe(BROKER_A);
  });

  test('validateSell คืน brokerId ของแถวที่ขายจริง', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 't1', type: 'buy', quantity: 5, pricePerUnit: 100, amountThb: 500, currency: 'THB' },
    ]);

    const result = await validateSell(USER_ID, {
      symbol: 'BTC',
      quantity: 1,
      pricePerUnit: 200,
      brokerId: BROKER_B,
    });

    expect(result.asset).toBe(BTC_AT_B);
    expect(result.brokerId).toBe(BROKER_B);
  });

  test('ขายโดยไม่ระบุโบรกขณะถือ 2 โบรก → AMBIGUOUS_ASSET_BROKER (ห้ามตัดยอดโบรกผิด)', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);

    await expect(
      validateSell(USER_ID, { symbol: 'BTC', quantity: 1, pricePerUnit: 200 })
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ASSET_BROKER' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Error ที่โยนออกมาไม่ใช่ TransactionServiceError — ชั้นบนต้องดักด้วย code ไม่ใช่ instanceof', () => {
    // เอกสารเชิงบังคับ: webhook/transactions.controller ดักด้วย err.code === '...'
    // ถ้าวันหนึ่งมีใครเปลี่ยนไปห่อเป็น TransactionServiceError ต้องมาแก้ทั้ง 2 ที่ด้วย
    expect(new assetResolution.AssetResolutionError('X', 'x')).not.toBeInstanceOf(
      TransactionServiceError
    );
  });
});
