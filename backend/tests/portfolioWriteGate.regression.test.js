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
const dividendService = require('../src/services/dividend.service');
const undoTransactionService = require('../src/services/undoTransaction.service');
const portfoliosService = require('../src/services/portfolios.service');

// ═══════════════════════════════════════════════════════════════════════════
// Stage 8-fix — "อ่านได้ เขียนไม่ได้" ต้องบังคับได้จริงบนเส้นทางเขียน Ledger
// ═══════════════════════════════════════════════════════════════════════════
// รีวิวโค้ด 24 ส.ค. 2569 พบว่า assertCanWriteToPortfolio ถูกเรียกจาก assets.service
// (แก้ป้ายกำกับ) เท่านั้น — **ไม่เคยถูกเรียกจากเส้นทางบันทึกธุรกรรมเลยสักทาง**
// ทำให้มติ § 8.1(ก) บังคับได้แค่ส่วนที่สำคัญน้อยที่สุด
//
// ── มติ Founder เพิ่มเติม (24 ส.ค. 2569) — แยก "เขียน" เป็น 2 ชนิด ──────────
//   เพิ่มของใหม่ (ซื้อ · ปันผล · Bulk Import · ย้ายเข้า) → ❌ บล็อก
//   ลดของเดิม/แก้ให้ตรงความจริง (ขาย · Undo · ย้ายออก)  → ✅ อนุญาตเสมอ
// เหตุผล: ถ้าบล็อกการขายด้วย ผู้ใช้ที่ขายจริงไปแล้วจะบันทึกไม่ได้ → พอร์ตโชว์
// ตัวเลขผิดถาวร และ "ออกจากพอร์ตที่ถูกล็อกไม่ได้เลย" = เอาข้อมูลเป็นตัวประกัน
// การล็อกต้องหมายถึง "โตต่อไม่ได้" ไม่ใช่ "ออกไม่ได้"
//
// ⚠️ ใช้ของจริงทั้ง transaction.service + portfolios.service + entitlement
// (Mock เฉพาะ Repository) ตามบทเรียน POSTMORTEM_AMOUNT_CONSISTENCY — บั๊กชอบซ่อน
// อยู่ที่ "รอยต่อ" ระหว่าง Service ซึ่งเป็นจุดบอดของ Mock ทั้งคู่

const USER_ID = 'user-uuid-1';

const MAIN_PORTFOLIO = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  userId: USER_ID,
  name: 'พอร์ตหลัก',
  type: 'custom',
  isDefault: true,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};
// ⚠️ created_at "เก่ากว่า" พอร์ตหลักโดยเจตนา — เพื่อพิสูจน์ว่าการตัดสินยึด
// is_default ไม่ใช่ created_at เก่าสุด (มติ Founder 24 ส.ค. 2569)
const EXCESS_PORTFOLIO = {
  id: 'bbbbbbbb-2222-4222-8222-222222222222',
  userId: USER_ID,
  name: 'พอร์ตส่วนเกิน',
  type: 'crypto',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ALL_PORTFOLIOS = [EXCESS_PORTFOLIO, MAIN_PORTFOLIO];

const FREE_USER = { id: USER_ID, plan: 'free', planExpiresAt: null };
const PREMIUM_USER = {
  id: USER_ID,
  plan: 'premium',
  planExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
};
const EXPIRED_PREMIUM = {
  id: USER_ID,
  plan: 'premium',
  planExpiresAt: new Date(Date.now() - 864e5).toISOString(),
};

const ASSET_IN_EXCESS = {
  id: 'asset-in-excess',
  userId: USER_ID,
  symbol: 'BTC',
  type: 'crypto',
  brokerId: null,
  portfolioId: EXCESS_PORTFOLIO.id,
  sector: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  portfolioRepository.findAllByUser.mockResolvedValue(ALL_PORTFOLIOS);
  portfolioRepository.findDefaultByUser.mockResolvedValue(MAIN_PORTFOLIO);
  portfolioRepository.findByIdForUser.mockImplementation(async (id) =>
    ALL_PORTFOLIOS.find((p) => p.id === id) ?? null
  );
  assetRepository.findAllByUserAndSymbol.mockResolvedValue([ASSET_IN_EXCESS]);
  assetRepository.findActiveSymbolsByUser.mockResolvedValue(['BTC']);
  assetRepository.create.mockResolvedValue(ASSET_IN_EXCESS);
  transactionRepository.create.mockResolvedValue({ id: 'tx-1' });
  transactionRepository.findAllByAsset.mockResolvedValue([
    { id: 'tx-0', type: 'buy', quantity: 1, amountThb: 1000, pricePerUnit: 1000, date: '2026-01-05' },
  ]);
  priceFeedService.getCurrentPrice.mockResolvedValue(1000);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-24', stale: false });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ "เพิ่มของใหม่" เข้าพอร์ตส่วนเกิน ต้องถูกบล็อกทุกช่องทาง', () => {
  const buyParams = {
    symbol: 'BTC',
    quantity: 1,
    pricePerUnit: 1000,
    type: 'crypto',
    portfolioId: EXCESS_PORTFOLIO.id,
  };

  // เส้นทางเว็บและ LINE ใช้ validateBuy ตัวเดียวกันทั้งคู่ (web → processBuyCommand
  // → validateBuy · LINE → createPending → validateBuy · Bulk → validateBuy)
  // จึงพิสูจน์ที่จุดคอขวดเดียวได้ครบทุกช่องทาง
  test('⚠️ ซื้อเข้าพอร์ตส่วนเกิน (Premium หมดอายุ) → PORTFOLIO_READ_ONLY', async () => {
    await expect(
      transactionService.validateBuy(USER_ID, buyParams, EXPIRED_PREMIUM)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_READ_ONLY' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  test('⚠️ processBuyCommand (เส้นทางเว็บ) → บล็อกก่อนแตะ Ledger', async () => {
    await expect(
      transactionService.processBuyCommand(USER_ID, buyParams, EXPIRED_PREMIUM)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_READ_ONLY' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('⚠️ บันทึกปันผลเข้าพอร์ตส่วนเกิน → PORTFOLIO_READ_ONLY', async () => {
    assetRepository.findByIds.mockResolvedValue([ASSET_IN_EXCESS]);

    await expect(
      dividendService.recordDividend(
        USER_ID,
        { assetId: ASSET_IN_EXCESS.id, amountThb: 250, quantity: 1, date: '2026-02-01' },
        { userRecord: EXPIRED_PREMIUM }
      )
    ).rejects.toMatchObject({ code: 'PORTFOLIO_READ_ONLY' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('✅ "ลดของเดิม / แก้ให้ตรงความจริง" ต้องทำได้เสมอ (ห้ามขังผู้ใช้)', () => {
  // ⭐ ข้อนี้สำคัญที่สุดในมติใหม่ — ถ้าบล็อกการขาย ผู้ใช้ที่ขายหุ้นจริงไปแล้ว
  // จะบันทึกไม่ได้ → พอร์ตโชว์ว่ายังถืออยู่ตลอดไป = ตัวเลขกำไร/ขาดทุนผิดถาวร
  test('⭐ ขายสินทรัพย์ในพอร์ตส่วนเกิน (Premium หมดอายุ) → ต้องผ่าน', async () => {
    const result = await transactionService.validateSell(USER_ID, {
      symbol: 'BTC',
      quantity: 1,
      pricePerUnit: 1200,
      portfolioId: EXCESS_PORTFOLIO.id,
    });

    expect(result.asset.id).toBe(ASSET_IN_EXCESS.id);
  });

  test('⭐ processSellCommand ในพอร์ตส่วนเกิน → เขียน Ledger ได้จริง', async () => {
    await transactionService.processSellCommand(USER_ID, {
      symbol: 'BTC',
      quantity: 1,
      pricePerUnit: 1200,
      portfolioId: EXCESS_PORTFOLIO.id,
    });

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell' })
    );
  });

  test('⭐ Undo รายการล่าสุดที่อยู่ในพอร์ตส่วนเกิน → ต้องผ่าน', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([
      {
        id: 'tx-latest',
        assetId: ASSET_IN_EXCESS.id,
        type: 'buy',
        quantity: 1,
        amountThb: 1000,
        pricePerUnit: 1000,
        currency: 'THB',
        date: '2026-02-01',
        note: null,
      },
    ]);
    assetRepository.findByIds.mockResolvedValue([ASSET_IN_EXCESS]);

    await undoTransactionService.undoLastTransaction(USER_ID, { userRecord: EXPIRED_PREMIUM });

    // สร้างแถวหักล้างได้จริง (ไม่ถูกบล็อก)
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sell', note: expect.stringContaining('UNDO_OF:') })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('พอร์ตหลักตัดสินด้วย is_default ไม่ใช่ created_at เก่าสุด', () => {
  // ⚠️ EXCESS_PORTFOLIO มี created_at เก่ากว่า MAIN_PORTFOLIO โดยเจตนา
  // ถ้ายังยึด created_at เก่าสุด พอร์ตที่เขียนได้จะเป็นตัวที่ผิด
  test('⚠️ พอร์ตที่เขียนได้ = พอร์ต is_default แม้ created_at จะใหม่กว่า', async () => {
    const writable = await portfoliosService.listPortfolios(USER_ID, EXPIRED_PREMIUM);
    const byId = Object.fromEntries(writable.map((p) => [p.id, p.canWrite]));

    expect(byId[MAIN_PORTFOLIO.id]).toBe(true);
    expect(byId[EXCESS_PORTFOLIO.id]).toBe(false);
  });

  test('ซื้อเข้าพอร์ตหลักได้ปกติแม้ Premium หมดอายุ', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([
      { ...ASSET_IN_EXCESS, id: 'asset-main', portfolioId: MAIN_PORTFOLIO.id },
    ]);

    const result = await transactionService.validateBuy(
      USER_ID,
      { symbol: 'BTC', quantity: 1, pricePerUnit: 1000, type: 'crypto', portfolioId: MAIN_PORTFOLIO.id },
      EXPIRED_PREMIUM
    );

    expect(result.asset.id).toBe('asset-main');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ Free / Premium Active — พฤติกรรมต้องไม่เปลี่ยนแม้แต่นิดเดียว', () => {
  // ⚠️ ข้อนี้สำคัญที่สุดในทางปฏิบัติ — ผู้ใช้ Free คือคนส่วนใหญ่ของระบบวันนี้
  // ถ้าพลาดจะบล็อกคนที่ไม่ควรโดนบล็อกทั้งฐาน
  test('⭐ Free (พอร์ตเดียว) → ซื้อได้ปกติ ไม่มีอะไรถูกบล็อกเพิ่ม', async () => {
    portfolioRepository.findAllByUser.mockResolvedValue([MAIN_PORTFOLIO]);
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([
      { ...ASSET_IN_EXCESS, portfolioId: MAIN_PORTFOLIO.id },
    ]);

    const result = await transactionService.validateBuy(
      USER_ID,
      { symbol: 'BTC', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
      FREE_USER
    );

    expect(result.newAsset).toBe(false);
  });

  test('⭐ Free ที่ไม่ส่ง portfolioId มาเลย (เส้นทาง LINE ปกติ) → ต้องไม่พัง', async () => {
    portfolioRepository.findAllByUser.mockResolvedValue([MAIN_PORTFOLIO]);
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([
      { ...ASSET_IN_EXCESS, portfolioId: MAIN_PORTFOLIO.id },
    ]);

    await expect(
      transactionService.processBuyCommand(
        USER_ID,
        { symbol: 'BTC', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
        FREE_USER
      )
    ).resolves.toBeDefined();
  });

  test('Premium ที่ยัง Active → เขียนได้ทุกพอร์ต', async () => {
    const result = await transactionService.validateBuy(
      USER_ID,
      { symbol: 'BTC', quantity: 1, pricePerUnit: 1000, type: 'crypto', portfolioId: EXCESS_PORTFOLIO.id },
      PREMIUM_USER
    );

    expect(result.asset.id).toBe(ASSET_IN_EXCESS.id);
  });

  test('⭐ ต่ออายุแล้วกลับมาเขียนได้ทันที โดยไม่ต้องทำอะไรเพิ่ม', async () => {
    // ผู้ใช้คนเดิม พอร์ตชุดเดิม ต่างแค่ planExpiresAt → ต้องเขียนได้ทันที
    await expect(
      transactionService.validateBuy(
        USER_ID,
        { symbol: 'BTC', quantity: 1, pricePerUnit: 1000, type: 'crypto', portfolioId: EXCESS_PORTFOLIO.id },
        EXPIRED_PREMIUM
      )
    ).rejects.toMatchObject({ code: 'PORTFOLIO_READ_ONLY' });

    await expect(
      transactionService.validateBuy(
        USER_ID,
        { symbol: 'BTC', quantity: 1, pricePerUnit: 1000, type: 'crypto', portfolioId: EXCESS_PORTFOLIO.id },
        PREMIUM_USER
      )
    ).resolves.toBeDefined();
  });
});
