// ═══════════════════════════════════════════════════════════════════════════
// ⭐ รอยต่อ Preview → Confirm ต้องพก **พอร์ต** ข้ามมาด้วย ไม่ใช่แค่โบรก
// ═══════════════════════════════════════════════════════════════════════════
// พบตอนรีวิว 27 ส.ค. 2569 — เป็นหางเส้นที่ 3 ของบั๊ก Asset Resolution เดียวกัน
// (Post-mortem: docs/POSTMORTEM_PORTFOLIO_RESOLUTION.md § 11)
//
// ── บั๊ก ──────────────────────────────────────────────────────────────────
// การแก้รอบที่ 1 (6cf6aa1) ลบ `?? null` ของ portfolioId ที่ transaction.service
// และ webhook.controller แต่ **ไม่ได้แตะ pendingTransaction.service เลย** ซึ่งยัง:
//   createPending  → pendingRepository.create({ portfolioId: params.portfolioId ?? null })
//   toCommitParams → { portfolioId: pending.portfolioId ?? null }
//
// เส้นทาง LINE ไม่เคยส่ง portfolioId มา (undefined) → เก็บ NULL ลง DB ตอน Preview
// → ตอนกดยืนยัน ส่ง portfolioId = null = "เจาะจงว่าไม่มีพอร์ต" ให้ resolveOwnedAsset
// → หลัง Apply 044 ไม่เหลือแถวที่ portfolio_id IS NULL อีกเลย → หาไม่เจอ →
// **สร้างสินทรัพย์ซ้ำแถวใหม่ที่ portfolio_id = NULL** ซึ่งนอกจากทำให้ต้นทุนเฉลี่ย
// เพี้ยนแล้ว ยังละเมิด Invariant ของ migration 045 (ทุกแถวต้องสังกัดพอร์ต) ด้วย
//
// ⚠️ นี่คือ **เส้นทางที่ผู้ใช้ใช้บ่อยที่สุดของทั้งผลิตภัณฑ์** (ซื้อผ่าน LINE)
//
// ── ทำไม multiBrokerPendingSeam.test.js จับไม่ได้ ──────────────────────────
// ไฟล์นั้นใช้ `findAllByUserAndSymbol.mockResolvedValue([...])` ซึ่ง **ไม่สนใจ
// Argument `portfolioId` เลย** — คืนแถวเดิมทุกครั้งไม่ว่าจะถูกค้นด้วยอะไร
// จึงเขียวสนิทตลอดเวลาที่บั๊กมีอยู่จริง (บทเรียนข้อ 3 ของ Post-mortem ซ้ำอีกรอบ:
// **Mock ที่หลวมกว่าของจริง = เทสต์ที่พิสูจน์อะไรไม่ได้**)
// ไฟล์นี้จึงจำลองการกรองแบบ PostgREST เป๊ะเป็นหัวใจ
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • เปลี่ยน createPending กลับเป็น `portfolioId: params.portfolioId ?? null` → แดง
//   • ถอด `portfolioId` ออกจากค่าที่ validateBuy/validateSell คืน → แดง
//   • แก้ Mock ให้ไม่สนใจ Argument portfolioId (แบบไฟล์เดิม) → เขียวทั้งที่บั๊กอยู่

jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/pendingTransaction.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const pendingRepository = require('../src/repositories/pendingTransaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');

const {
  createPending,
  confirmPending,
  createBatch,
} = require('../src/services/pendingTransaction.service');
const { COMMANDS } = require('../src/services/commandParser.service');

const USER_ID = 'user-uuid-1';
const PENDING_ID = 'pending-uuid-1';
const P1 = 'aaaaaaaa-1111-4111-8111-111111111111'; // พอร์ต Default หลัง Backfill
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222';

const DEFAULT_PORTFOLIO = { id: P1, userId: USER_ID, name: 'พอร์ตของฉัน', isDefault: true };

// โลกหลัง 044 — สินทรัพย์สังกัดพอร์ตแล้ว
const BTC_IN_P1 = {
  id: 'asset-btc-p1',
  userId: USER_ID,
  symbol: 'BTC',
  type: 'crypto',
  brokerId: null,
  portfolioId: P1,
};
// โลกก่อน 044 — portfolio_id เป็น NULL
const BTC_NO_PORTFOLIO = { ...BTC_IN_P1, id: 'asset-btc-null', portfolioId: null };

let stored = null;

// ⭐ จำลอง findAllByUserAndSymbol ให้กรองแบบ PostgREST เป๊ะ — นี่คือสิ่งที่ทำให้
// ไฟล์นี้จับบั๊กได้ ในขณะที่ไฟล์รอยต่อเดิมจับไม่ได้
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
  stored = null;

  portfolioRepository.findDefaultByUser.mockResolvedValue(DEFAULT_PORTFOLIO);
  portfolioRepository.findByIdForUser.mockResolvedValue(DEFAULT_PORTFOLIO);
  portfolioRepository.findAllByUser.mockResolvedValue([DEFAULT_PORTFOLIO]);
  assetRepository.findActiveSymbolsByUser.mockResolvedValue(['BTC']);
  assetRepository.create.mockResolvedValue({ ...BTC_IN_P1, id: 'asset-btc-new' });
  transactionRepository.create.mockResolvedValue({ id: 'tx-uuid-1' });
  transactionRepository.findAllByAsset.mockResolvedValue([
    { id: 'tx-0', type: 'buy', quantity: 10, amountThb: 1000, pricePerUnit: 100, date: '2026-01-05' },
  ]);
  priceFeedService.getCurrentPrice.mockResolvedValue(100);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-24', stale: false });

  pendingRepository.create.mockImplementation(async (data) => {
    stored = { id: PENDING_ID, status: 'pending', ...data };
    return stored;
  });
  pendingRepository.claimForConfirm.mockImplementation(async () => stored);
  pendingRepository.attachTransaction.mockResolvedValue(undefined);
});

const buyParsed = (params) => ({
  command: COMMANDS.BUY,
  params: { symbol: 'BTC', type: 'crypto', quantity: 1, pricePerUnit: 100, ...params },
});
const sellParsed = (params) => ({
  command: COMMANDS.SELL,
  params: { symbol: 'BTC', quantity: 1, pricePerUnit: 120, ...params },
});
const PREMIUM = { plan: 'premium', planExpiresAt: '2099-01-01' };

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ โลกหลัง 044 — พอร์ตที่ Resolve ได้ต้องรอดข้าม Preview → Confirm', () => {
  beforeEach(() => installRepo([BTC_IN_P1]));

  // ⭐⭐ เคสสำคัญที่สุดของไฟล์นี้ — เส้นทางที่ผู้ใช้ใช้บ่อยที่สุดของทั้งผลิตภัณฑ์
  test('⭐ ซื้อผ่าน LINE (ไม่ระบุพอร์ต) → pending ต้องเก็บพอร์ตของแถวจริง ไม่ใช่ NULL', async () => {
    await createPending(USER_ID, buyParsed(), PREMIUM);

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: P1 })
    );
  });

  test('⭐ กดยืนยัน → ต้องผูกกับสินทรัพย์แถวเดิม **ห้ามสร้างแถวซ้ำ**', async () => {
    await createPending(USER_ID, buyParsed(), PREMIUM);
    await confirmPending(PENDING_ID, USER_ID, PREMIUM);

    // นี่คือ Assertion ที่จับบั๊กได้จริง — บั๊กเดิมจะเรียก create เพราะค้นด้วย
    // portfolio_id IS NULL แล้วไม่เจอแถวที่สังกัด P1
    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: BTC_IN_P1.id, type: 'buy' })
    );
  });

  test('ขายผ่าน LINE → pending เก็บพอร์ตจริง และ Confirm ตัดยอดแถวเดิม', async () => {
    await createPending(USER_ID, sellParsed(), PREMIUM);

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: P1 })
    );

    await confirmPending(PENDING_ID, USER_ID, PREMIUM);

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: BTC_IN_P1.id, type: 'sell' })
    );
  });

  // ผู้ใช้ระบุพอร์ตมาเอง (เส้นทางเว็บ) → ต้องเคารพค่าที่ระบุ ไม่ใช่ทับด้วยพอร์ตของ
  // แถวที่เจอ — แต่กรณีนี้ Repository กรองด้วย P2 แล้วไม่เจอ จึงเป็นสินทรัพย์ใหม่
  test('ระบุพอร์ต P2 มาเอง → pending เก็บ P2 (ไม่ถูกทับด้วย P1)', async () => {
    assetRepository.create.mockResolvedValue({ ...BTC_IN_P1, id: 'asset-btc-p2', portfolioId: P2 });

    await createPending(USER_ID, buyParsed({ portfolioId: P2 }), PREMIUM);

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: P2 })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ สินทรัพย์ใหม่ — พอร์ต Default ต้องถูก Snapshot ตั้งแต่ Preview', () => {
  beforeEach(() => {
    installRepo([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);
  });

  // ถ้าไม่ Snapshot ไว้ ตอน Confirm จะไป findDefaultByUser ใหม่อีกรอบ — ซึ่งอาจ
  // ได้พอร์ตคนละตัวถ้าผู้ใช้เปลี่ยนพอร์ตหลักระหว่างรอกดยืนยัน (Snapshot ชนะเสมอ
  // ตาม Pattern เดียวกับ amountThb ใน POSTMORTEM_AMOUNT_CONSISTENCY)
  test('Symbol ใหม่ → pending เก็บพอร์ต Default ที่ Resolve แล้ว ไม่ใช่ NULL', async () => {
    await createPending(USER_ID, buyParsed({ symbol: 'ETH', type: 'crypto' }), PREMIUM);

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: P1 })
    );
  });

  test('Confirm → สร้างสินทรัพย์ใหม่ในพอร์ตที่ Snapshot ไว้ (Invariant 044/045)', async () => {
    await createPending(USER_ID, buyParsed({ symbol: 'ETH', type: 'crypto' }), PREMIUM);
    // ผู้ใช้ย้ายพอร์ตหลักไป P2 ระหว่างรอกดยืนยัน — Snapshot ต้องชนะ
    portfolioRepository.findDefaultByUser.mockResolvedValue({ ...DEFAULT_PORTFOLIO, id: P2 });

    await confirmPending(PENDING_ID, USER_ID, PREMIUM);

    // assetRepository.create(userId, portfolioId, symbol, ...) — Argument ที่ 2
    expect(assetRepository.create.mock.calls[0][1]).toBe(P1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('โลกก่อน 044 — พฤติกรรมต้องเหมือนเดิมเป๊ะ', () => {
  // ⚠️ ลำดับ Deploy คือ "Deploy โค้ดก่อน → ค่อย Apply 044" โค้ดจึงต้องถูกทั้งสองโลก
  beforeEach(() => {
    installRepo([BTC_NO_PORTFOLIO]);
    portfolioRepository.findDefaultByUser.mockResolvedValue(null);
  });

  test('ยังไม่มีพอร์ตเลย → pending เก็บ NULL ตามเดิม และ Confirm ไม่สร้างแถวซ้ำ', async () => {
    await createPending(USER_ID, buyParsed(), PREMIUM);

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: null })
    );

    await confirmPending(PENDING_ID, USER_ID, PREMIUM);

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: BTC_NO_PORTFOLIO.id })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Bulk Import Batch — รอยต่อเดียวกัน ต้องพกพอร์ตข้ามมาด้วย', () => {
  beforeEach(() => installRepo([BTC_IN_P1]));

  // createBatch รับ validatedItems ที่ผ่าน validateBuy มาแล้ว จึงต้องพก
  // "พอร์ตที่ Resolve ได้จริง" ต่อรายการมาด้วย ไม่ใช่ params.portfolioId ดิบ
  test('⭐ แต่ละแถวของ Batch ต้องเก็บพอร์ตที่ Resolve แล้ว ไม่ใช่ NULL', async () => {
    const validatedItems = [
      {
        params: { symbol: 'BTC', quantity: 1, pricePerUnit: 100 },
        amounts: { quantity: 1, pricePerUnit: 100, amountThb: 100, currency: 'THB' },
        assetType: null,
        portfolioId: P1,
        brokerId: null,
      },
    ];

    await createBatch(USER_ID, validatedItems);

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: P1 })
    );
  });
});
