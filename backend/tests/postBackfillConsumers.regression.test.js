// ═══════════════════════════════════════════════════════════════════════════
// ⭐ "โลกหลัง 044" — ผู้บริโภคข้อมูลที่ **ไม่ใช่** เส้นทาง Resolution
// ═══════════════════════════════════════════════════════════════════════════
// พบตอน Audit ก่อน Apply migration (27 ส.ค. 2569)
// Post-mortem: docs/POSTMORTEM_PORTFOLIO_RESOLUTION.md § 12
//
// ── ที่มา ─────────────────────────────────────────────────────────────────
// การแก้ 3 รอบก่อนหน้าครอบเฉพาะ **เส้นทาง Resolution** (ซื้อ/ขาย/กำไร/LINE)
// แต่ยังมีผู้บริโภคอื่นที่เรียก `profitService.getAssetProfit()` โดยส่ง
// `portfolioId = null` แบบ Hardcode ไว้ตั้งแต่ก่อนมีแนวคิด Multi-portfolio
//
// `null` แปลว่า **"เจาะจงว่าไม่มีพอร์ต"** → ค้นด้วย `.is('portfolio_id', null)`
// → หลัง Backfill ของ 044 ไม่เหลือแถวแบบนั้นอีกเลย → **คืน [] ทุกครั้ง**
//
// | จุด | อาการหลัง 044 | ความรุนแรง |
// |---|---|---|
// | `portfolioSnapshot.job` | ทุก Holding ถูก catch เป็น excludedCount → `totalCurrentValue = null` **ทุกคืน ทุกคน** | 🔴 เงียบสนิท (มี catch ครอบ ไม่มี Error ที่ไหนเลย) |
// | `dashboard.controller.getProfit` | `GET /dashboard/profit/:symbol` ตอบ 404 ทุกครั้ง | 🟠 พังดัง |
//
// ── ทำไมเทสต์เดิมจับไม่ได้ ────────────────────────────────────────────────
// `portfolioSnapshot.job.test.js` ใช้ `jest.mock('../src/services/profit.service')`
// แล้ว `getAssetProfit.mockResolvedValue(profit())` — **ไม่สนใจ Argument ที่ถูกส่ง
// เข้ามาเลย** จึงตอบค่าเดิมทุกครั้งไม่ว่าจะส่ง `null` หรืออะไรก็ตาม
// (AI_WORK_POLICY § 3.1 — "Mock ที่หลวมกว่าของจริง" เกิดซ้ำเป็นครั้งที่ 4)
//
// ⚠️ ไฟล์นี้จึงใช้ **ของจริงทั้ง profit.service + assetResolution + portfolio.service**
// Mock เฉพาะ Repository/Price Feed และจำลองการกรอง `portfolio_id` แบบ PostgREST เป๊ะ

jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/broker.repository');
jest.mock('../src/repositories/portfolioSnapshot.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const portfolioSnapshotRepository = require('../src/repositories/portfolioSnapshot.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');

const { runPortfolioSnapshot } = require('../src/jobs/portfolioSnapshot.job');
const portfolioService = require('../src/services/portfolio.service');
const { getProfit } = require('../src/controllers/dashboard.controller');

const USER_ID = 'user-uuid-1';
const P1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const DATE = '2026-08-27';

// ⭐ สินทรัพย์ "โลกหลัง 044" — สังกัดพอร์ตแล้วทุกแถว
const BTC_P1 = {
  id: 'asset-btc-p1',
  userId: USER_ID,
  symbol: 'BTC',
  name: 'BTC',
  type: 'crypto',
  brokerId: null,
  portfolioId: P1,
  sector: null,
  isActive: true,
};
const BTC_P2 = { ...BTC_P1, id: 'asset-btc-p2', portfolioId: P2 };

const HISTORY = [
  { id: 'tx-0', type: 'buy', quantity: 1, amountThb: 1000, pricePerUnit: 1000, date: '2026-01-05' },
];

// ⭐ จำลองการกรองแบบ PostgREST เป๊ะ — หัวใจของไฟล์นี้ (ห้ามใช้ mockResolvedValue)
function installAssets(rows) {
  assetRepository.findActiveByUser.mockResolvedValue(rows);
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
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  // ⚠️ ต้องจำลอง "เป็นเจ้าของจริงไหม" ตามของจริง — คืนเฉพาะพอร์ตของ USER_ID นี้
  // (ถ้า mockResolvedValue ค่าเดียวไปเลย เคส "พอร์ตของผู้ใช้คนอื่น" จะเขียวเพราะ
  // Mock ยอมทุกอย่าง ไม่ใช่เพราะด่านทำงาน — AI_WORK_POLICY § 3.1)
  portfolioRepository.findByIdForUser.mockImplementation(async (portfolioId, userId) => {
    if (userId !== USER_ID) return null;
    return [P1, P2].includes(portfolioId) ? { id: portfolioId, userId, name: 'พอร์ต' } : null;
  });

  transactionRepository.findAllUserIdsWithTransactions.mockResolvedValue([USER_ID]);
  transactionRepository.findAllByAsset.mockResolvedValue(HISTORY);
  portfolioSnapshotRepository.upsertSnapshot.mockResolvedValue(undefined);
  priceFeedService.getCurrentPrice.mockResolvedValue(2000);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: DATE, stale: false });
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🔴 portfolioSnapshot.job — มูลค่ารายคืนต้องไม่หายไปทั้งก้อนหลัง 044', () => {
  // ⭐⭐ เคสสำคัญที่สุดของไฟล์นี้ — บั๊กนี้ไม่มี Error ที่ไหนเลยเพราะมี catch ครอบ
  test('⭐ ถือ BTC ในพอร์ต P1 → Snapshot ต้องมีมูลค่า ไม่ใช่ null', async () => {
    installAssets([BTC_P1]);

    await runPortfolioSnapshot(DATE);

    const saved = portfolioSnapshotRepository.upsertSnapshot.mock.calls[0][0];
    // null = "ไม่มี Holding ไหนคำนวณมูลค่าได้เลย" ซึ่งคืออาการของบั๊กเป๊ะ
    expect(saved.totalCurrentValue).not.toBeNull();
    expect(saved.totalCurrentValue).toBeGreaterThan(0);
    expect(saved.excludedAssetCount ?? 0).toBe(0);
  });

  // ⚠️ เคสนี้คือเหตุผลที่ต้องส่ง holding.portfolioId ไม่ใช่ undefined —
  // ถ้าส่ง undefined จะได้ AMBIGUOUS_ASSET_PORTFOLIO ทั้งสองแถว แล้วถูก catch
  // นับเป็น excludedCount ทั้งคู่ = "ตกหล่นทั้งสองแถว" แบบเดียวกับที่เคยเจอกับ brokerId
  test('⭐ ถือ BTC ทั้ง P1 และ P2 → ต้องนับครบทั้งสองแถว ไม่ตกหล่นสักแถว', async () => {
    installAssets([BTC_P1, BTC_P2]);

    await runPortfolioSnapshot(DATE);

    const saved = portfolioSnapshotRepository.upsertSnapshot.mock.calls[0][0];

    expect(saved.excludedAssetCount ?? 0).toBe(0);
    expect(saved.totalCurrentValue).not.toBeNull();
  });

  // โลกก่อน 044 ต้องไม่เปลี่ยนพฤติกรรม (ลำดับ Deploy คือ Deploy โค้ดก่อน Apply)
  test('โลกก่อน 044 (portfolio_id เป็น NULL) → ยังทำงานเหมือนเดิม', async () => {
    installAssets([{ ...BTC_P1, portfolioId: null }]);

    await runPortfolioSnapshot(DATE);

    const saved = portfolioSnapshotRepository.upsertSnapshot.mock.calls[0][0];

    expect(saved.totalCurrentValue).not.toBeNull();
    expect(saved.excludedAssetCount ?? 0).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🟠 GET /dashboard/profit/:symbol — ต้องหาสินทรัพย์เจอหลัง 044', () => {
  function mockRes() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
  }

  const reqFor = (query = {}) => ({
    user: { id: USER_ID },
    params: { symbol: 'btc' },
    query,
  });

  test('⭐ ถือ BTC ในพอร์ต P1 → 200 ไม่ใช่ 404 ASSET_NOT_FOUND', async () => {
    installAssets([BTC_P1]);
    const res = mockRes();

    await getProfit(reqFor(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.symbol).toBe('BTC');
  });

  // กำกวมมิติพอร์ต → ต้องตอบ 409 พร้อม candidates ให้ Frontend ถามต่อ
  // **ไม่ใช่ 500** (Error ที่ไม่ถูก Map = หลุดไป INTERNAL_ERROR)
  test('⭐ ถือ BTC 2 พอร์ต ไม่ระบุพอร์ต → 409 พร้อม candidates (ไม่ใช่ 500/404)', async () => {
    installAssets([BTC_P1, BTC_P2]);
    const res = mockRes();

    await getProfit(reqFor(), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('AMBIGUOUS_ASSET_PORTFOLIO');
    expect(res.body.candidates).toHaveLength(2);
  });

  test('ระบุ ?portfolioId → เจาะจงแถวนั้นได้ ไม่ถามซ้ำ', async () => {
    installAssets([BTC_P1, BTC_P2]);
    const res = mockRes();

    await getProfit(reqFor({ portfolioId: P2 }), res);

    expect(res.statusCode).toBe(200);
  });

  // ⚠️ portfolioId มาจาก Query String ที่ผู้ใช้กำหนดเองได้ 100% (กฎยืนข้อ 4)
  test('⚠️ ?portfolioId ของผู้ใช้คนอื่น → ต้องไม่ตอบ 200', async () => {
    installAssets([BTC_P1]);
    const res = mockRes();

    await getProfit(reqFor({ portfolioId: 'cccccccc-9999-4999-8999-999999999999' }), res);

    expect(res.statusCode).not.toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('getPortfolioSummary — คอขวดร่วมของผู้บริโภคที่เหลือทั้งหมด', () => {
  // reportExport · dashboardOverview · portfolioSummary · allocation ·
  // reminderSetupFlow · guidedBuyFlow · webhook "พอต" — ทุกตัวอ่านผ่านฟังก์ชันนี้
  // ซึ่งใช้ findActiveByUser (กรองแค่ user_id + is_active) **ไม่กรอง portfolio_id เลย**
  // → migration 044 ไม่มีทางทำให้ตัวเลขหายไปได้
  test('⭐ หลัง 044 ยังคืน Holding ครบ และพา portfolioId ไปให้ Consumer ด้วย', async () => {
    installAssets([BTC_P1, BTC_P2]);

    const summary = await portfolioService.getPortfolioSummary(USER_ID);

    expect(summary.holdings).toHaveLength(2);
    expect(summary.holdings.map((h) => h.portfolioId).sort()).toEqual([P1, P2].sort());
  });

  test('โลกก่อน 044 → portfolioId เป็น null ตามจริง ไม่พังและไม่เดาค่า', async () => {
    installAssets([{ ...BTC_P1, portfolioId: null }]);

    const summary = await portfolioService.getPortfolioSummary(USER_ID);

    expect(summary.holdings).toHaveLength(1);
    expect(summary.holdings[0].portfolioId).toBeNull();
  });
});
