jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/portfolioSummary.service');
jest.mock('../src/services/fxRate.service');
jest.mock('../src/repositories/broker.repository');

const portfolioService = require('../src/services/portfolio.service');
const portfolioSummaryService = require('../src/services/portfolioSummary.service');
const fxRateService = require('../src/services/fxRate.service');
const brokerRepository = require('../src/repositories/broker.repository');
const allocationService = require('../src/services/allocation.service');
const portfoliosController = require('../src/controllers/portfolios.controller');

// ═══════════════════════════════════════════════════════════════════════════
// Stage 8 — GET /api/v1/portfolio/allocation (Design Doc § 4.3)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ กฎบังคับของ Endpoint นี้ (Design Doc § 4.3 + กฎยืนข้อ 1):
// totalValueThb **ต้องมาจาก portfolio.service ตัวเดิม** ที่ /portfolio/summary
// ใช้อยู่ ห้ามเขียนสูตรรวมมูลค่าใหม่ — เทสต์ชุดนี้จึง Mock ที่ระดับ Service เดิม
// แล้วยืนยันว่า allocation "เรียกใช้" ของเดิมจริง ไม่ได้คำนวณเอง
//
// Red-Green ที่เทสต์ชุดนี้ครอบ:
//   • ให้ allocation คำนวณมูลค่าเอง (ไม่เรียก priceHoldings) → 'Reuse' แดง
//   • ถอดการตีมูลค่าที่ต้นทุนเมื่อไม่มีราคา (ข้ามทิ้งแทน) → 'ไม่มีราคาสด' แดง
//   • ถอด Normalize ของ sector → 'จัดกลุ่ม sector' แดง
//   • ถอดกลุ่ม "ไม่ระบุ" (ซ่อนแถวที่ค่าเป็น null) → 'ไม่ระบุ' แดง

const USER_ID = 'user-uuid-1';

function holding(overrides = {}) {
  return {
    assetId: 'a1',
    symbol: 'BTC',
    name: 'Bitcoin',
    type: 'crypto',
    brokerId: null,
    sector: null,
    portfolioId: 'p1',
    currency: 'THB',
    heldQuantity: 1,
    totalInvested: 1000,
    averageCost: 1000,
    realizedPnL: 0,
    ...overrides,
  };
}

// ผลลัพธ์ของ portfolioSummary.priceHoldings (Shape จริงจากไฟล์นั้น)
function priced(h, price, priceUnavailable = false) {
  return {
    holding: h,
    currency: h.currency === 'USD' ? 'USD' : 'THB',
    price: priceUnavailable ? null : price,
    priceUnavailable,
  };
}

function mockReq(query = {}) {
  return { user: { id: USER_ID }, userRecord: { plan: 'free' }, query, params: {}, body: {} };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const jsonOf = (res) => res.json.mock.calls[0][0];
const statusOf = (res) => res.status.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-24', stale: false });
  brokerRepository.findAllByUser.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ Reuse สูตรเดิม — ห้ามคำนวณมูลค่าเองในไฟล์ allocation (กฎยืนข้อ 1)', () => {
  test('ต้องเรียก portfolio.getPortfolioSummary + portfolioSummary.priceHoldings ตัวเดิม', async () => {
    const h = holding();
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [h], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(h, 1500)]);

    await allocationService.getAllocation(USER_ID, { groupBy: 'assetType' });

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(USER_ID);
    expect(portfolioSummaryService.priceHoldings).toHaveBeenCalledWith([h]);
  });

  test('มูลค่า = heldQuantity × ราคาจาก priceHoldings (ไม่ใช่ totalInvested)', async () => {
    const h = holding({ heldQuantity: 2, totalInvested: 1000 });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [h], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(h, 1500)]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'assetType' });

    expect(result.totalValueThb).toBe(3000); // 2 × 1500 ไม่ใช่ 1000
  });

  // ⚠️ ต่างจากการ์ด "กำไร/ขาดทุน" โดยเจตนา: Donut ต้องแสดงครบทุกตัว ไม่งั้นหุ้นไทย
  // จะหายไปจากภาพรวมทั้งที่ผู้ใช้ถืออยู่จริง และผลรวมจะไม่เท่ามูลค่าพอร์ตบนการ์ด
  test('⚠️ ไม่มีราคาสด (หุ้นไทย/NAV ล่ม) → ตีมูลค่าที่ต้นทุน ไม่ใช่ข้ามทิ้ง', async () => {
    const btc = holding({ assetId: 'a1', symbol: 'BTC', type: 'crypto' });
    const ptt = holding({ assetId: 'a2', symbol: 'PTT', type: 'stock_th', totalInvested: 500 });
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [btc, ptt],
      isEmpty: false,
    });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      priced(btc, 1500),
      priced(ptt, null, true),
    ]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'assetType' });

    const byType = Object.fromEntries(result.groups.map((g) => [g.key, g]));
    expect(byType.stock_th.valueThb).toBe(500); // ตีที่ต้นทุน
    expect(byType.stock_th.priceUnavailableCount).toBe(1);
    expect(result.totalValueThb).toBe(2000); // 1500 + 500 — ไม่หายไปไหน
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('groupBy=broker', () => {
  test('จัดกลุ่มตาม broker_id + ใช้ชื่อโบรกจริงเป็น label', async () => {
    const a = holding({ assetId: 'a1', brokerId: 'bk-1' });
    const b = holding({ assetId: 'a2', symbol: 'ETH', brokerId: 'bk-2' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [a, b], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(a, 6000), priced(b, 4000)]);
    brokerRepository.findAllByUser.mockResolvedValue([
      { id: 'bk-1', name: 'Bitkub' },
      { id: 'bk-2', name: 'Binance' },
    ]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'broker' });

    expect(result.totalValueThb).toBe(10000);
    expect(result.groups).toEqual([
      expect.objectContaining({ key: 'bk-1', label: 'Bitkub', valueThb: 6000, percent: 60, assetCount: 1 }),
      expect.objectContaining({ key: 'bk-2', label: 'Binance', valueThb: 4000, percent: 40, assetCount: 1 }),
    ]);
  });

  // ⚠️ ข้อมูลเดิม 100% มี broker_id เป็น NULL — ถ้าซ่อนแถว ยอดรวมกราฟโดนัทจะไม่
  // เท่ามูลค่าพอร์ตจริง (ระบุไว้ใน DATABASE.md ของคอลัมน์นี้)
  test('⚠️ broker_id = NULL → ต้องเป็นกลุ่ม "ไม่ระบุ" ห้ามซ่อนแถว', async () => {
    const a = holding({ assetId: 'a1', brokerId: null });
    const b = holding({ assetId: 'a2', symbol: 'ETH', brokerId: 'bk-1' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [a, b], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(a, 4000), priced(b, 6000)]);
    brokerRepository.findAllByUser.mockResolvedValue([{ id: 'bk-1', name: 'Bitkub' }]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'broker' });

    const unspecified = result.groups.find((g) => g.key === null);
    expect(unspecified).toMatchObject({ label: 'ไม่ระบุ', valueThb: 4000, percent: 40 });
    // ผลรวมสัดส่วนต้องเป็น 100% เสมอ ไม่งั้นกราฟโดนัทจะมีรูโหว่
    expect(result.groups.reduce((s, g) => s + g.percent, 0)).toBe(100);
  });

  test('ถือ BTC 2 โบรก (migration 046) → แยกเป็น 2 กลุ่มถูกต้อง', async () => {
    const a = holding({ assetId: 'a1', symbol: 'BTC', brokerId: 'bk-1' });
    const b = holding({ assetId: 'a2', symbol: 'BTC', brokerId: 'bk-2' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [a, b], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(a, 3000), priced(b, 7000)]);
    brokerRepository.findAllByUser.mockResolvedValue([
      { id: 'bk-1', name: 'Bitkub' },
      { id: 'bk-2', name: 'Binance' },
    ]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'broker' });

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((g) => g.label)).toEqual(['Binance', 'Bitkub']);
  });

  test('ไม่จัดกลุ่มตามโบรก → ไม่ยิง Query หาชื่อโบรกเลย (ไม่เพิ่ม Latency ฟรีๆ)', async () => {
    const h = holding();
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [h], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(h, 1000)]);

    await allocationService.getAllocation(USER_ID, { groupBy: 'assetType' });

    expect(brokerRepository.findAllByUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('groupBy=sector — Normalize ตอนจัดกลุ่ม แต่คงตัวพิมพ์ตอนแสดงผล', () => {
  // มติ Founder § 8.2 — กัน "Tech"/"tech"/"Tech " กลายเป็น 3 กลุ่มบนกราฟโดนัท
  test('⚠️ "Tech" / "tech" / " Tech " → กลุ่มเดียวกัน (case-insensitive + trim)', async () => {
    const a = holding({ assetId: 'a1', sector: 'Tech' });
    const b = holding({ assetId: 'a2', symbol: 'ETH', sector: 'tech' });
    const c = holding({ assetId: 'a3', symbol: 'SOL', sector: '  Tech  ' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [a, b, c], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      priced(a, 1000),
      priced(b, 2000),
      priced(c, 3000),
    ]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'sector' });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ valueThb: 6000, assetCount: 3, percent: 100 });
    // ⭐ label ต้องเป็นรูปแบบที่ผู้ใช้พิมพ์ ไม่ใช่ตัวพิมพ์เล็กหมด
    expect(result.groups[0].label).toBe('Tech');
  });

  test('ยุบช่องว่างซ้ำกลางคำด้วย ("Real  Estate" = "Real Estate")', async () => {
    const a = holding({ assetId: 'a1', sector: 'Real  Estate' });
    const b = holding({ assetId: 'a2', symbol: 'ETH', sector: 'Real Estate' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [a, b], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(a, 1000), priced(b, 1000)]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'sector' });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].label).toBe('Real Estate');
  });

  test('⚠️ sector = NULL / สตริงว่าง → กลุ่ม "ไม่ระบุ" ห้ามซ่อนแถว', async () => {
    const a = holding({ assetId: 'a1', sector: null });
    const b = holding({ assetId: 'a2', symbol: 'ETH', sector: '   ' });
    const c = holding({ assetId: 'a3', symbol: 'PTT', sector: 'Energy' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [a, b, c], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([
      priced(a, 1000),
      priced(b, 1000),
      priced(c, 2000),
    ]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'sector' });

    const unspecified = result.groups.find((g) => g.key === null);
    expect(unspecified).toMatchObject({ label: 'ไม่ระบุ', valueThb: 2000, assetCount: 2 });
    expect(result.groups.reduce((s, g) => s + g.percent, 0)).toBe(100);
  });

  // ⚠️ SET50 / REIT ต้องไม่ถูกทำเป็น Set50 / Reit (บทเรียนจาก Stage 2 —
  // Title Case ถูกตัดออกโดยตั้งใจ ดู CHANGELOG Stage 2)
  test('⚠️ ตัวพิมพ์ใหญ่ทั้งคำ (SET50 / REIT) ต้องคงรูปเดิม ไม่ถูกทำเป็น Title Case', async () => {
    const a = holding({ assetId: 'a1', sector: 'SET50' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [a], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(a, 1000)]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'sector' });

    expect(result.groups[0].label).toBe('SET50');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Multi-Currency — ห้ามรวมยอดข้ามสกุลเมื่อดึงเรตไม่ได้', () => {
  test('มี USD + เรตปกติ → แปลงเทียบบาทด้วยเรตเดียว', async () => {
    const usd = holding({ assetId: 'a1', symbol: 'MSFT', type: 'stock_us', currency: 'USD' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [usd], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(usd, 100)]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'assetType' });

    expect(result.totalValueThb).toBe(3500); // 1 × 100 USD × 35
    expect(result.fxRate).toBe(35);
    expect(result.fxUnavailableForUsd).toBe(false);
  });

  test('⚠️ มี USD แต่ดึงเรตไม่ได้ → fxUnavailableForUsd = true (Frontend ต้องเตือน)', async () => {
    fxRateService.getUsdThbRate.mockResolvedValue(null);
    const usd = holding({ assetId: 'a1', symbol: 'MSFT', type: 'stock_us', currency: 'USD' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [usd], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(usd, 100)]);

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'assetType' });

    expect(result.fxUnavailableForUsd).toBe(true);
    expect(result.fxRate).toBeNull();
    // ยอด THB ยังคืนตามจริง (ส่วน USD ไม่ถูกนับ) — Frontend ต้องดูธงประกอบ
    expect(result.groups[0].valueByCurrency.USD).toBe(100);
  });

  test('พอร์ต THB ล้วน → ไม่ยิง FX เลย', async () => {
    const h = holding();
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [h], isEmpty: false });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(h, 1000)]);

    await allocationService.getAllocation(USER_ID, { groupBy: 'assetType' });

    expect(fxRateService.getUsdThbRate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('กรองตาม portfolioId + Cross-User', () => {
  test('?portfolioId= กรองเฉพาะสินทรัพย์ในพอร์ตนั้น', async () => {
    const inP1 = holding({ assetId: 'a1', portfolioId: 'p1' });
    const inP2 = holding({ assetId: 'a2', symbol: 'ETH', portfolioId: 'p2' });
    portfolioService.getPortfolioSummary.mockResolvedValue({
      holdings: [inP1, inP2],
      isEmpty: false,
    });
    portfolioSummaryService.priceHoldings.mockResolvedValue([priced(inP1, 1000)]);

    const result = await allocationService.getAllocation(USER_ID, {
      groupBy: 'assetType',
      portfolioId: 'p1',
    });

    // ส่งเฉพาะ holding ของ p1 เข้า priceHoldings (ไม่ดึงราคาของพอร์ตอื่นทิ้งเปล่า)
    expect(portfolioSummaryService.priceHoldings).toHaveBeenCalledWith([inP1]);
    expect(result.totalValueThb).toBe(1000);
  });

  // ⚠️ getPortfolioSummary Scope ด้วย userId อยู่แล้ว → portfolioId ของคนอื่นจะ
  // ไม่ match holding ใดเลย ได้ผลลัพธ์ว่าง ไม่ใช่ข้อมูลของเขา
  test('⚠️ portfolioId ของผู้ใช้คนอื่น → ผลลัพธ์ว่าง ไม่ใช่ข้อมูลของเขา', async () => {
    const mine = holding({ assetId: 'a1', portfolioId: 'p1' });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [mine], isEmpty: false });

    const result = await allocationService.getAllocation(USER_ID, {
      groupBy: 'assetType',
      portfolioId: 'portfolio-of-someone-else',
    });

    expect(result.isEmpty).toBe(true);
    expect(result.groups).toEqual([]);
    expect(result.totalValueThb).toBe(0);
    // ไม่ดึงราคาเลยเพราะไม่มี holding ให้ดึง
    expect(portfolioSummaryService.priceHoldings).not.toHaveBeenCalled();
  });

  test('พอร์ตว่าง → isEmpty: true + groups ว่าง (ไม่ throw ไม่ NaN)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [], isEmpty: true });

    const result = await allocationService.getAllocation(USER_ID, { groupBy: 'broker' });

    expect(result).toMatchObject({ isEmpty: true, totalValueThb: 0, groups: [] });
  });

  test('ส่ง userId จาก JWT เข้า Service เสมอ (ไม่เคยรับจาก Query)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [], isEmpty: true });

    await portfoliosController.getAllocation(
      { user: { id: 'user-real' }, query: { userId: 'user-fake' }, params: {}, body: {} },
      mockRes()
    );

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith('user-real');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Controller — HTTP layer', () => {
  beforeEach(() => {
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [], isEmpty: true });
  });

  test('ไม่ส่ง groupBy → Default = assetType (ไม่ใช่ Error)', async () => {
    const res = mockRes();
    await portfoliosController.getAllocation(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).groupBy).toBe('assetType');
  });

  test.each([['broker'], ['sector'], ['assetType']])('groupBy=%s → 200', async (groupBy) => {
    const res = mockRes();
    await portfoliosController.getAllocation(mockReq({ groupBy }), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).groupBy).toBe(groupBy);
  });

  test('⚠️ groupBy ที่ไม่รองรับ → 400 VALIDATION_ERROR (ไม่ใช่เงียบๆ ใช้ Default)', async () => {
    const res = mockRes();
    await portfoliosController.getAllocation(mockReq({ groupBy: 'currency' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(jsonOf(res).details.allowed).toEqual(['broker', 'sector', 'assetType']);
  });

  test('portfolioId ผิดรูป (ไม่ใช่ UUID) → 404 ไม่ใช่ 500 (กัน Postgres 22P02)', async () => {
    const res = mockRes();
    await portfoliosController.getAllocation(mockReq({ portfolioId: 'not-a-uuid' }), res);

    expect(statusOf(res)).toBe(404);
    expect(portfolioService.getPortfolioSummary).not.toHaveBeenCalled();
  });

  test('Error ไม่คาดคิด → 500 INTERNAL_ERROR ไม่หลุด Stack Trace', async () => {
    portfolioService.getPortfolioSummary.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = mockRes();
    await portfoliosController.getAllocation(mockReq(), res);

    expect(statusOf(res)).toBe(500);
    expect(JSON.stringify(jsonOf(res))).not.toContain('db down');
  });
});
