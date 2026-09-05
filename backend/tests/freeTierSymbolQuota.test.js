// ═══════════════════════════════════════════════════════════════════════════
// Free-tier Symbol Quota — ปิดช่องโหว่ "ดาวน์เกรดแล้วซื้อเพิ่มได้ไม่จำกัดตลอดไป"
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 บั๊กที่ไฟล์นี้คุม (มติ Founder 5 ก.ย. 2569):
// `validateBuy` เดิม `return` ออกที่ Branch `if (existingAsset)` **ก่อน** จะถึงจุด
// เช็คเพดาน Free เสมอ → เพดานถูกบังคับใช้เฉพาะตอนสร้าง "Symbol ใหม่เอี่ยม" เท่านั้น
// ผู้ใช้ที่สมัคร Premium 1 เดือน ถือ 20-30 Symbol แล้วยกเลิกกลับเป็น Free จึง
// **ยังซื้อเพิ่มในทุก Symbol ที่เคยถือได้ไม่จำกัดตลอดไป** (กระทบรายได้จริง)
//
// กติกาใหม่: Free ซื้อเพิ่มได้เฉพาะ 2 Symbol ที่มีธุรกรรมซื้อครั้งแรกเร็วที่สุดใน
// ประวัติทั้งหมดของบัญชี — Symbol อื่นยังขาย/ดูประวัติ/ย้ายพอร์ตได้ปกติทุกตัว
//
// ── ⚠️ วินัย Mock ของไฟล์นี้ (AI_WORK_POLICY § 3.1) ─────────────────────────
// ใช้ **ของจริง 2 ชั้นเต็ม**: transaction.service (ตัวที่แก้) + entitlement.service
// (ตัวตัดสินสิทธิ์) + assetResolution.service — Mock เฉพาะ Repository ซึ่งเป็นขอบ
// นอกสุดเท่านั้น (§ 3.1 ข้อ 4-5: งานที่แตะ 2 Service ต่อกันบนเส้นทางเงินต้องมี
// เทสต์ที่ใช้ของจริงทั้งสองฝั่ง)
//
// ⚠️ `findBuyHistory` เป็น **Seam** (Service → Repository): ถ้า `userId` ตกหล่น
// ระบบจะไม่ Error แต่จะตัดสินโควตาของคนหนึ่งด้วยประวัติของอีกคน (Cross-User) —
// จึง Mock ด้วย `mockImplementation` ที่อ่าน Argument จริงและตอบตาม userId
// **และ** assert `toHaveBeenCalledWith` ควบคู่ ตาม § 3.1 ข้อ 1 (ทำทั้งคู่เพราะ
// ค่านี้แตะเงิน) ห้ามใช้ `mockResolvedValue` ที่ตอบเหมือนกันหมดทุก Argument

jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const entitlement = require('../src/services/entitlement.service');
const {
  validateBuy,
  processBuyCommand,
  processSellCommand,
} = require('../src/services/transaction.service');

const USER_ID = 'user-downgraded-1';
const OTHER_USER_ID = 'user-someone-else-2';
const PORTFOLIO_ID = 'pf-1';

// Premium ที่ยัง Active จริง (วันหมดอายุอยู่ในอนาคต) vs Free
const PREMIUM = { plan: 'premium', planExpiresAt: new Date(Date.now() + 86400e3).toISOString() };
const FREE = { plan: 'free', planExpiresAt: null };
// เคสหลักของงานนี้: เคยเป็น Premium แล้วหมดอายุ = ถือเป็น Free ตาม entitlement
const EXPIRED_PREMIUM = { plan: 'premium', planExpiresAt: '2026-01-01T00:00:00.000Z' };

// ── ประวัติซื้อจำลอง: 7 Symbol ที่ซื้อครั้งแรกไล่ตามเวลา (A เก่าสุด → G ใหม่สุด) ──
// (เคสจริงของ Founder: สมัคร Premium 1 เดือนแล้วกวาดซื้อหลายตัว ก่อนดาวน์เกรด)
const SEVEN_SYMBOLS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG'];
const BUY_HISTORY_7 = SEVEN_SYMBOLS.flatMap((symbol, i) => [
  { symbol, createdAt: `2026-0${i + 1}-01T00:00:00.000Z` },
  // ซื้อซ้ำตัวเดิมทีหลัง — ต้องไม่ทำให้ลำดับ/จำนวน Slot เปลี่ยน (Dedupe ตาม Symbol)
  { symbol, createdAt: `2026-0${i + 1}-15T00:00:00.000Z` },
]);

// asset row จำลองของ Symbol ที่ "ถืออยู่แล้ว" (Path ที่บั๊กเดิมหลุด)
function ownedAsset(symbol, overrides = {}) {
  return {
    id: `asset-${symbol}`,
    userId: USER_ID,
    symbol,
    type: 'crypto',
    portfolioId: PORTFOLIO_ID,
    brokerId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  transactionRepository.create.mockResolvedValue({ id: 'tx-1' });
  assetRepository.create.mockResolvedValue(ownedAsset('NEW'));
  priceFeedService.getCurrentPrice.mockResolvedValue(null);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-11', stale: false });
  // Default: ผู้ใช้รายอื่นไม่มีประวัติเลย — เคสที่ต้องการประวัติจะ Override เอง
  transactionRepository.findBuyHistory.mockImplementation(async () => []);
  // ── พอร์ตหลักที่ "เขียนได้" (assertCanAddToPortfolio ทำงานจริงก่อนถึงด่านของเรา) ──
  // ⚠️ ต้องเป็นพอร์ต Default เพื่อให้ผู้ใช้ Free/หมดอายุยังเขียนได้ตามมติ 24 ส.ค. 2569
  // — ไม่งั้นจะได้ PORTFOLIO_READ_ONLY มาก่อน แล้วเทสต์จะพิสูจน์ด่านโควตาไม่ได้เลย
  const defaultPortfolio = { id: PORTFOLIO_ID, name: 'พอร์ตหลัก', isDefault: true };
  portfolioRepository.findByIdForUser.mockResolvedValue(defaultPortfolio);
  portfolioRepository.findAllByUser.mockResolvedValue([defaultPortfolio]);
  portfolioRepository.findDefaultByUser.mockResolvedValue(defaultPortfolio);
});

// Mock แบบ "อ่าน Argument จริง" — ตอบประวัติของ userId ที่ถูกถามเท่านั้น
// (ถ้าโค้ดลืมส่ง userId หรือส่งผิดคน จะได้ [] แล้วเทสต์ที่คาดว่าถูกบล็อกจะแดงทันที)
function givenBuyHistory(byUser) {
  transactionRepository.findBuyHistory.mockImplementation(async (userId) => byUser[userId] ?? []);
}

function buyParams(symbol, extra = {}) {
  return { symbol, quantity: 1, pricePerUnit: 100, type: 'crypto', ...extra };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) Unit — ตรรกะตัดสินสิทธิ์ล้วน (entitlement.service ไม่แตะ DB เลย)
// ═══════════════════════════════════════════════════════════════════════════

describe('entitlement.getWritableSymbols — Pure Logic', () => {
  test('Premium ที่ยัง Active → null (ไม่จำกัด ไม่ถูกกติกานี้กระทบเลย)', () => {
    expect(entitlement.getWritableSymbols(PREMIUM, BUY_HISTORY_7)).toBeNull();
  });

  test('Free → ได้ 2 Symbol แรกตามเวลาซื้อครั้งแรก (ไม่ใช่ 2 ตัวล่าสุด)', () => {
    const writable = entitlement.getWritableSymbols(FREE, BUY_HISTORY_7);

    expect([...writable].sort()).toEqual(['AAA', 'BBB']);
    expect(writable.has('CCC')).toBe(false);
    expect(writable.has('GGG')).toBe(false);
  });

  test('Premium ที่หมดอายุแล้ว → ถือเป็น Free (นี่คือเคสของช่องโหว่)', () => {
    const writable = entitlement.getWritableSymbols(EXPIRED_PREMIUM, BUY_HISTORY_7);

    expect(writable).not.toBeNull();
    expect(writable.size).toBe(2);
  });

  // Stage 5 (migration 046) — ถือ Symbol เดียวกันหลายโบรก = 1 สินทรัพย์เสมอ
  test('⭐ Symbol เดียวกันคนละโบรก/พอร์ต → นับเป็น 1 Slot ไม่ใช่ 2', () => {
    const writable = entitlement.getWritableSymbols(FREE, [
      { symbol: 'BTC', createdAt: '2026-01-01T00:00:00.000Z' }, // โบรก A
      { symbol: 'BTC', createdAt: '2026-01-02T00:00:00.000Z' }, // โบรก B (แถวคนละ asset_id)
      { symbol: 'ETH', createdAt: '2026-01-03T00:00:00.000Z' },
      { symbol: 'XRP', createdAt: '2026-01-04T00:00:00.000Z' },
    ]);

    expect([...writable].sort()).toEqual(['BTC', 'ETH']);
  });

  // เรียงตามเวลา "ซื้อครั้งแรก" ของแต่ละ Symbol ไม่ใช่เวลาของแถวใดแถวหนึ่ง
  test('ซื้อซ้ำตัวเดิมทีหลัง ไม่ทำให้ Symbol นั้นหล่นไปท้ายคิว', () => {
    const writable = entitlement.getWritableSymbols(FREE, [
      { symbol: 'AAA', createdAt: '2026-01-01T00:00:00.000Z' },
      { symbol: 'ZZZ', createdAt: '2026-02-01T00:00:00.000Z' },
      { symbol: 'AAA', createdAt: '2026-12-31T00:00:00.000Z' }, // ซื้อเพิ่มล่าสุด
      { symbol: 'MMM', createdAt: '2026-03-01T00:00:00.000Z' },
    ]);

    expect([...writable].sort()).toEqual(['AAA', 'ZZZ']);
  });

  // เหตุผลเดียวกับ Tie-break ด้วย id ใน getWritablePortfolioIds — bulkImport อาจ
  // INSERT หลายแถวด้วย now() เดียวกัน ถ้าไม่ Tie-break ลำดับจะไม่ Deterministic
  test('⭐ created_at เท่ากันเป๊ะ → Tie-break ด้วยชื่อ Symbol (ผลลัพธ์ต้องนิ่งเสมอ)', () => {
    const sameTime = '2026-01-01T00:00:00.000Z';
    const rows = [
      { symbol: 'DDD', createdAt: sameTime },
      { symbol: 'AAA', createdAt: sameTime },
      { symbol: 'CCC', createdAt: sameTime },
    ];

    expect([...entitlement.getWritableSymbols(FREE, rows)]).toEqual(['AAA', 'CCC']);
    // ยิงซ้ำด้วยลำดับ Input ที่สลับ → ต้องได้ผลเดิมเป๊ะ (ไม่ขึ้นกับลำดับแถวจาก DB)
    expect([...entitlement.getWritableSymbols(FREE, [...rows].reverse())]).toEqual(['AAA', 'CCC']);
  });

  test('ไม่มีประวัติซื้อเลย (ผู้ใช้ใหม่) → Set ว่าง (ยังไม่ได้ใช้ Slot ไหนเลย)', () => {
    expect(entitlement.getWritableSymbols(FREE, []).size).toBe(0);
    expect(entitlement.getWritableSymbols(FREE, undefined).size).toBe(0);
  });
});

describe('entitlement.canBuySymbol — ตัวตัดสินจริง', () => {
  test('Premium Active → ซื้อ Symbol ไหนก็ได้ (ไม่จำกัด)', () => {
    expect(entitlement.canBuySymbol(PREMIUM, BUY_HISTORY_7, 'GGG')).toMatchObject({ allowed: true });
  });

  test('Free + Symbol อยู่ใน 2 ตัวแรก → อนุญาต', () => {
    expect(entitlement.canBuySymbol(FREE, BUY_HISTORY_7, 'AAA')).toMatchObject({ allowed: true });
    expect(entitlement.canBuySymbol(FREE, BUY_HISTORY_7, 'BBB')).toMatchObject({ allowed: true });
  });

  test('🔴 Free + Symbol ไม่อยู่ใน 2 ตัวแรก (แม้ถืออยู่จริง) → ปฏิเสธ', () => {
    for (const symbol of ['CCC', 'DDD', 'EEE', 'FFF', 'GGG']) {
      expect(entitlement.canBuySymbol(FREE, BUY_HISTORY_7, symbol)).toMatchObject({
        allowed: false,
        reason: 'symbol_not_writable',
        limit: 2,
      });
    }
  });

  // ⭐ กฎ "ยังมี Slot ว่าง" — สิ่งที่ทำให้ผู้ใช้ Free ปกติไม่ถูกกระทบเลย
  test('⭐ Free ที่ยังใช้ Slot ไม่ครบ → Symbol ใหม่จับจอง Slot ที่เหลือได้', () => {
    const oneSymbol = [{ symbol: 'AAA', createdAt: '2026-01-01T00:00:00.000Z' }];

    expect(entitlement.canBuySymbol(FREE, oneSymbol, 'AAA')).toMatchObject({ allowed: true });
    expect(entitlement.canBuySymbol(FREE, oneSymbol, 'ZZZ')).toMatchObject({ allowed: true });
    expect(entitlement.canBuySymbol(FREE, [], 'ANYTHING')).toMatchObject({ allowed: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) Integration — validateBuy ของจริง (Mock แค่ Repository)
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 validateBuy — ช่องโหว่หลัก: ดาวน์เกรดแล้วซื้อเพิ่มใน Symbol เดิม', () => {
  beforeEach(() => {
    givenBuyHistory({ [USER_ID]: BUY_HISTORY_7 });
  });

  test('🔴🔴 ซื้อเพิ่มใน Symbol ที่ถืออยู่แต่ไม่ติด 2 อันดับแรก → ASSET_LIMIT_REACHED', async () => {
    // Symbol นี้ "ถืออยู่จริง" — คือ Path ที่บั๊กเดิม return ออกไปก่อนถึงด่านเพดาน
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([ownedAsset('CCC')]);

    await expect(
      validateBuy(USER_ID, buyParams('CCC'), EXPIRED_PREMIUM)
    ).rejects.toMatchObject({
      code: 'ASSET_LIMIT_REACHED',
      details: { reason: 'symbol_not_writable', limit: 2, symbol: 'CCC' },
    });

    // ⭐ Seam: ต้องอ่านประวัติของ "ผู้ใช้คนที่กำลังซื้อ" เท่านั้น (กัน Cross-User)
    expect(transactionRepository.findBuyHistory).toHaveBeenCalledWith(USER_ID);
    // ห้ามเขียน Ledger แม้แต่แถวเดียวเมื่อถูกปฏิเสธ
    expect(transactionRepository.create).not.toHaveBeenCalled();
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  test('🔴 อีก 4 ตัวที่เหลือก็ต้องถูกปฏิเสธเหมือนกันทั้งหมด (ไม่ใช่แค่ตัวเดียว)', async () => {
    for (const symbol of ['DDD', 'EEE', 'FFF', 'GGG']) {
      assetRepository.findAllByUserAndSymbol.mockResolvedValue([ownedAsset(symbol)]);
      await expect(validateBuy(USER_ID, buyParams(symbol), EXPIRED_PREMIUM)).rejects.toMatchObject({
        code: 'ASSET_LIMIT_REACHED',
      });
    }
  });

  test('✅ 2 Symbol แรกยังซื้อเพิ่มได้ตามปกติ (ไม่ได้ล็อกทั้งบัญชี)', async () => {
    for (const symbol of ['AAA', 'BBB']) {
      assetRepository.findAllByUserAndSymbol.mockResolvedValue([ownedAsset(symbol)]);
      const result = await validateBuy(USER_ID, buyParams(symbol), EXPIRED_PREMIUM);
      expect(result).toMatchObject({ newAsset: false, asset: expect.objectContaining({ symbol }) });
    }
  });

  test('✅ Premium ที่ยัง Active ถือ 7 ตัวเท่ากัน → ซื้อเพิ่มได้ทุกตัว + ไม่ยิง Query ประวัติเลย', async () => {
    for (const symbol of SEVEN_SYMBOLS) {
      assetRepository.findAllByUserAndSymbol.mockResolvedValue([ownedAsset(symbol)]);
      await expect(validateBuy(USER_ID, buyParams(symbol), PREMIUM)).resolves.toMatchObject({
        newAsset: false,
      });
    }
    // Premium ไม่ควรเสีย Round-trip ไปอ่านประวัติทั้งกองโดยไม่จำเป็น (กฎยืนข้อ 10)
    expect(transactionRepository.findBuyHistory).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) Regression — ผู้ใช้ Free ปกติต้องไม่ถูกกระทบแม้แต่นิดเดียว
// ═══════════════════════════════════════════════════════════════════════════

describe('Regression — พฤติกรรมเดิมของผู้ใช้ Free ปกติ', () => {
  test('Free ที่มี Symbol เดียว → ซื้อเพิ่มตัวเดิมได้ตามเดิม', async () => {
    givenBuyHistory({ [USER_ID]: [{ symbol: 'BTC', createdAt: '2026-01-01T00:00:00.000Z' }] });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([ownedAsset('BTC')]);

    await expect(validateBuy(USER_ID, buyParams('BTC'), FREE)).resolves.toMatchObject({
      newAsset: false,
    });
  });

  test('Free ที่มี Symbol เดียว → ซื้อ Symbol ที่ 2 (ตัวใหม่) ได้ตามเดิม', async () => {
    givenBuyHistory({ [USER_ID]: [{ symbol: 'BTC', createdAt: '2026-01-01T00:00:00.000Z' }] });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]); // ยังไม่เคยถือ ETH
    assetRepository.findActiveSymbolsByUser.mockResolvedValue(['BTC']);

    await expect(validateBuy(USER_ID, buyParams('ETH'), FREE)).resolves.toMatchObject({
      newAsset: true,
      assetLimit: 2,
    });
  });

  test('ผู้ใช้ใหม่เอี่ยม (ไม่มีประวัติเลย) → ซื้อครั้งแรกได้ตามปกติ', async () => {
    givenBuyHistory({});
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);

    await expect(validateBuy(USER_ID, buyParams('BTC'), FREE)).resolves.toMatchObject({
      newAsset: true,
    });
  });

  // ⭐ Regression สำคัญที่สุดตาม Prompt: Path สร้าง Symbol ใหม่ต้องไม่ถูกแตะเลย
  test('⭐⭐ Symbol ใหม่ที่ไม่เคยถือ → ยังผ่าน Path create_asset_locked เดิมเป๊ะ (ส่ง assetLimit ครบ)', async () => {
    givenBuyHistory({ [USER_ID]: [{ symbol: 'BTC', createdAt: '2026-01-01T00:00:00.000Z' }] });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue(['BTC']);
    assetRepository.create.mockResolvedValue(ownedAsset('ETH'));

    await processBuyCommand(USER_ID, buyParams('ETH', { name: 'Ethereum' }), FREE);

    // Argument ตัวที่ 7 (index 6) คือ assetLimit ที่ RPC ใช้ตัดสินใต้ Lock —
    // ต้องยังถูกส่งเป็น 2 เหมือนเดิม ไม่ใช่ null/undefined (ไม่งั้นด่าน DB หลุด)
    expect(assetRepository.create).toHaveBeenCalledTimes(1);
    const createArgs = assetRepository.create.mock.calls[0];
    expect(createArgs[0]).toBe(USER_ID);
    expect(createArgs[1]).toBe(PORTFOLIO_ID); // พอร์ตปลายทางที่ Resolve แล้ว
    expect(createArgs[2]).toBe('ETH');
    expect(createArgs[6]).toBe(2); // ⭐ assetLimit ที่ส่งต่อให้ create_asset_locked
  });

  // Stage 5 (migration 046) — ถือ BTC 2 โบรก = 1 สินทรัพย์ ต้องเพิ่มโบรกที่ 2 ได้เสมอ
  test('⭐ Symbol เดียวกันคนละโบรก → นับ 1 Slot ซื้อเพิ่มที่โบรกที่ 2 ได้', async () => {
    givenBuyHistory({
      [USER_ID]: [
        { symbol: 'BTC', createdAt: '2026-01-01T00:00:00.000Z' },
        { symbol: 'BTC', createdAt: '2026-01-05T00:00:00.000Z' },
        { symbol: 'ETH', createdAt: '2026-02-01T00:00:00.000Z' },
      ],
    });
    // ระบุโบรกชัดเจน → assetResolution ไม่กำกวม (ดู AMBIGUOUS_ASSET_BROKER)
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([
      ownedAsset('BTC', { id: 'asset-BTC-a', brokerId: 'bk-1' }),
      ownedAsset('BTC', { id: 'asset-BTC-b', brokerId: 'bk-2' }),
    ]);

    await expect(
      validateBuy(USER_ID, buyParams('BTC', { brokerId: 'bk-2' }), FREE)
    ).resolves.toMatchObject({ newAsset: false, brokerId: 'bk-2' });
  });

  // การขายคือ "แก้ให้ตรงความจริง" ต้องทำได้เสมอ (มติ Founder 24 ส.ค. 2569)
  test('⭐⭐ Symbol ที่ซื้อเพิ่มไม่ได้แล้ว → ยัง "ขาย" ได้ตามปกติ (ไม่ใช่ Read-only ทั้งบัญชี)', async () => {
    givenBuyHistory({ [USER_ID]: BUY_HISTORY_7 });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([ownedAsset('GGG')]);
    transactionRepository.findAllByAsset.mockResolvedValue([{ type: 'buy', quantity: 10 }]);

    await expect(
      processSellCommand(USER_ID, { symbol: 'GGG', quantity: 4, pricePerUnit: 100 }, EXPIRED_PREMIUM)
    ).resolves.toMatchObject({ symbol: 'GGG', quantity: 4 });

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', quantity: 4 })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) กติกาที่ Founder ระบุชัด — Slot ไม่ถูกปลดคืนไม่ว่ากรณีใด
// ═══════════════════════════════════════════════════════════════════════════

describe('Slot ไม่ถูกปลดคืน (กันหมุนซื้อ-ขายสลับ Symbol ไม่จำกัด)', () => {
  test('⭐ ขาย Symbol ใน Slot จนเหลือ 0 หน่วย → Slot ยังถูกจับจองอยู่เหมือนเดิม', async () => {
    // ผู้ใช้ขาย AAA/BBB ออกหมดแล้ว (ไม่เหลือ Asset Active เลย) แต่ประวัติซื้อยังอยู่ครบ
    // — Ledger เป็น Immutable การขายไม่ลบแถวซื้อทิ้ง (DATABASE.md § 8)
    givenBuyHistory({
      [USER_ID]: [
        { symbol: 'AAA', createdAt: '2026-01-01T00:00:00.000Z' },
        { symbol: 'BBB', createdAt: '2026-02-01T00:00:00.000Z' },
      ],
    });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]); // ยังไม่เคยถือ ZZZ
    // ขายหมดแล้ว → ไม่เหลือ Symbol Active → ด่านเพดานเดิมจะ "ปล่อยผ่าน" (0 < 2)
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);

    // ⚠️ ถ้าไม่มีด่านใหม่ เคสนี้จะซื้อ ZZZ ได้ = หมุนซื้อ-ขายสลับ Symbol ได้ไม่จำกัด
    await expect(validateBuy(USER_ID, buyParams('ZZZ'), FREE)).rejects.toMatchObject({
      code: 'ASSET_LIMIT_REACHED',
      details: { reason: 'symbol_not_writable' },
    });
  });

  test('แต่ Symbol เดิมที่ขายหมดไปแล้ว ยังกลับมาซื้อใหม่ได้ (Slot เป็นของมันอยู่)', async () => {
    givenBuyHistory({
      [USER_ID]: [
        { symbol: 'AAA', createdAt: '2026-01-01T00:00:00.000Z' },
        { symbol: 'BBB', createdAt: '2026-02-01T00:00:00.000Z' },
      ],
    });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([ownedAsset('AAA')]);

    await expect(validateBuy(USER_ID, buyParams('AAA'), FREE)).resolves.toMatchObject({
      newAsset: false,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) Cross-User Isolation — โควตาของคนหนึ่งต้องไม่ถูกตัดสินด้วยประวัติของอีกคน
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-User — ประวัติของคนอื่นต้องไม่มีผลกับโควตาเรา', () => {
  test('⭐ ผู้ใช้ B (ใหม่เอี่ยม) ไม่ถูกบล็อกเพราะประวัติ 7 Symbol ของผู้ใช้ A', async () => {
    givenBuyHistory({ [USER_ID]: BUY_HISTORY_7, [OTHER_USER_ID]: [] });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);

    await expect(validateBuy(OTHER_USER_ID, buyParams('CCC'), FREE)).resolves.toMatchObject({
      newAsset: true,
    });
    expect(transactionRepository.findBuyHistory).toHaveBeenCalledWith(OTHER_USER_ID);
    expect(transactionRepository.findBuyHistory).not.toHaveBeenCalledWith(USER_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6) Concurrency — บันทึกพฤติกรรมจริงของด่านนี้ไว้ (ดูสรุปการประเมินในรายงาน)
// ═══════════════════════════════════════════════════════════════════════════
// ด่านนี้เป็น Check-then-Act ที่ไม่ Atomic (เหมือน Pre-check เดิมของเพดาน Free)
// **โดยตั้งใจ** — ด่านที่ Race ข้ามไม่ได้จริงยังเป็น RPC create_asset_locked
// (migration 035/046) ที่ Lock แถว users ก่อนนับ+INSERT ในธุรกรรมเดียว
//
// เทสต์นี้พิสูจน์ว่า "ยิงพร้อมกันตอน Slot ว่าง 2 ช่อง แล้วผ่านทั้งคู่" เป็นผลลัพธ์
// ที่ **ถูกต้องตามกติกา** ไม่ใช่ช่องโหว่ (2 Symbol = 2 Slot พอดี) ส่วนใบที่ 3 ต้อง
// ถูกปฏิเสธ ซึ่งเป็นหน้าที่ของด่าน DB เดิมที่ไม่ได้ถูกแตะเลยในงานนี้
describe('Concurrency — ด่านใหม่ไม่ได้แทนที่ด่าน Atomic ที่ DB', () => {
  test('ยิงซื้อ 2 Symbol ใหม่พร้อมกันตอน Slot ว่าง 2 ช่อง → ผ่านทั้งคู่ (ถูกต้องตามกติกา)', async () => {
    givenBuyHistory({ [USER_ID]: [] });
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);

    const results = await Promise.allSettled([
      validateBuy(USER_ID, buyParams('AAA'), FREE),
      validateBuy(USER_ID, buyParams('BBB'), FREE),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // ทั้งคู่ต้องพก assetLimit ไปให้ RPC เป็นด่านตัดสินจริงใต้ Lock เสมอ
    for (const r of results) expect(r.value).toMatchObject({ assetLimit: 2 });
  });
});
