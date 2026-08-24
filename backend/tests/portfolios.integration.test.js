jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/asset.repository');

const portfolioRepository = require('../src/repositories/portfolio.repository');
const assetRepository = require('../src/repositories/asset.repository');
const portfoliosController = require('../src/controllers/portfolios.controller');
const portfoliosService = require('../src/services/portfolios.service');

// ═══════════════════════════════════════════════════════════════════════════
// Stage 8 — /api/v1/portfolios (Design Doc § 4.1 · API.md § 14.2)
// ═══════════════════════════════════════════════════════════════════════════
// ใช้ของจริงทั้ง Controller + Service + entitlement (Mock เฉพาะ Repository) ตาม
// บทเรียนจาก POSTMORTEM_AMOUNT_CONSISTENCY: บั๊กชอบซ่อนอยู่ที่ "รอยต่อ" ระหว่าง
// สอง Service ซึ่งเป็นจุดบอดของ Mock ทั้งคู่ — ที่นี่รอยต่อสำคัญคือ
// portfolios.service ↔ entitlement.service (กติกา "อ่านได้ เขียนไม่ได้")
//
// Red-Green ที่เทสต์ชุดนี้ครอบ (ถอด Fix ออกแล้วต้องเห็นแดง):
//   • เปลี่ยน GET ให้ Gate ด้วย Premium → describe 'GET เป็น Free' แดง
//   • ถอด Tie-break ด้วย id ใน getWritablePortfolioIds → describe 'Deterministic' แดง
//   • ให้ deletePortfolio พึ่ง ON DELETE SET NULL (ไม่ย้ายสินทรัพย์) → 'ลบพอร์ต' แดง
//   • ถอดการตรวจ UNIQUE ก่อนย้าย → 'สินทรัพย์ชนกัน' แดง

const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';

const FREE_USER = { id: USER_ID, plan: 'free', planExpiresAt: null };
const PREMIUM_USER = {
  id: USER_ID,
  plan: 'premium',
  planExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
};
const EXPIRED_PREMIUM_USER = {
  id: USER_ID,
  plan: 'premium',
  planExpiresAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
};

const P_DEFAULT = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  userId: USER_ID,
  name: 'พอร์ตของฉัน',
  type: 'custom',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const P_SECOND = {
  id: 'bbbbbbbb-2222-4222-8222-222222222222',
  userId: USER_ID,
  name: 'พอร์ตคริปโต',
  type: 'crypto',
  isDefault: false,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};
const P_THIRD = {
  id: 'cccccccc-3333-4333-8333-333333333333',
  userId: USER_ID,
  name: 'พอร์ตหุ้นไทย',
  type: 'stock_th',
  isDefault: false,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

function mockReq({ body = {}, params = {}, userRecord = FREE_USER } = {}) {
  return { user: { id: USER_ID }, userRecord, body, params };
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
  portfolioRepository.PortfolioWriteError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.code = code;
      this.details = details;
    }
  };
  portfolioRepository.findAllByUser.mockResolvedValue([P_DEFAULT]);
  portfolioRepository.findByIdForUser.mockResolvedValue(P_DEFAULT);
  portfolioRepository.findDefaultByUser.mockResolvedValue(P_DEFAULT);
  portfolioRepository.countByUser.mockResolvedValue(1);
  portfolioRepository.deleteByIdForUser.mockResolvedValue(1);
  assetRepository.findByPortfolio.mockResolvedValue([]);
  assetRepository.reassignPortfolio.mockResolvedValue(0);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /portfolios เป็น Free — ไม่ใช่ Premium (แก้ Spec API.md § 14.2)', () => {
  // ⚠️ ถ้าคืน 403 ให้ Free หน้า Dashboard จะพังตั้งแต่โหลดหน้าแรก เพราะหลัง
  // migration 044 ทุกคนมีพอร์ต Default ที่ UI ต้องใช้ render
  test('⚠️ ผู้ใช้ Free เรียก GET /portfolios → 200 พร้อมพอร์ต Default (ห้าม 403)', async () => {
    const res = mockRes();
    await portfoliosController.listPortfolios(mockReq({ userRecord: FREE_USER }), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).portfolios).toHaveLength(1);
    expect(jsonOf(res).portfolios[0]).toMatchObject({ isDefault: true, canWrite: true });
  });

  test('ผู้ใช้ Free เรียก GET /portfolios/:id → 200 (ห้าม 403)', async () => {
    const res = mockRes();
    await portfoliosController.getPortfolio(
      mockReq({ params: { id: P_DEFAULT.id }, userRecord: FREE_USER }),
      res
    );

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).portfolio.id).toBe(P_DEFAULT.id);
  });

  test('ไม่ส่ง userId ออกไปกับ Response (ลดพื้นที่รั่ว)', async () => {
    const res = mockRes();
    await portfoliosController.listPortfolios(mockReq(), res);

    expect(jsonOf(res).portfolios[0].userId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /portfolios — ตัวคุมสิทธิ์จริงของ Multi-portfolio', () => {
  test('⚠️ Free มีพอร์ต Default อยู่แล้ว 1 อัน → สร้างเพิ่มไม่ได้ 403 PORTFOLIO_LIMIT_REACHED', async () => {
    portfolioRepository.countByUser.mockResolvedValue(1);

    const res = mockRes();
    await portfoliosController.createPortfolio(
      mockReq({ body: { name: 'พอร์ตใหม่', type: 'crypto' }, userRecord: FREE_USER }),
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('PORTFOLIO_LIMIT_REACHED');
    expect(portfolioRepository.create).not.toHaveBeenCalled();
  });

  test('Premium Active สร้างพอร์ตที่ 2 ได้ → 201', async () => {
    portfolioRepository.countByUser.mockResolvedValue(1);
    portfolioRepository.create.mockResolvedValue(P_SECOND);

    const res = mockRes();
    await portfoliosController.createPortfolio(
      mockReq({ body: { name: 'พอร์ตคริปโต', type: 'crypto' }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(201);
    expect(portfolioRepository.create).toHaveBeenCalledWith(USER_ID, {
      name: 'พอร์ตคริปโต',
      type: 'crypto',
    });
  });

  test('⚠️ Premium ชน Sanity Cap 50 → 409 PORTFOLIO_CAP_REACHED (คนละ Code กับ Free)', async () => {
    portfolioRepository.countByUser.mockResolvedValue(50);

    const res = mockRes();
    await portfoliosController.createPortfolio(
      mockReq({ body: { name: 'พอร์ตที่ 51', type: 'custom' }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(409);
    // ⭐ ห้ามใช้ Code เดียวกับ Free — ไม่งั้น Premium ที่จ่ายเงินอยู่แล้วจะโดนชวนอัปเกรด
    expect(jsonOf(res).error).toBe('PORTFOLIO_CAP_REACHED');
    expect(portfolioRepository.create).not.toHaveBeenCalled();
  });

  test('Normalize ชื่อ: trim หัวท้าย + ยุบช่องว่างซ้ำ แต่คงตัวพิมพ์ตามที่ผู้ใช้พิมพ์', async () => {
    portfolioRepository.create.mockResolvedValue(P_SECOND);

    await portfoliosController.createPortfolio(
      mockReq({ body: { name: '  My   Crypto  Port ', type: 'crypto' }, userRecord: PREMIUM_USER }),
      mockRes()
    );

    expect(portfolioRepository.create).toHaveBeenCalledWith(USER_ID, {
      name: 'My Crypto Port',
      type: 'crypto',
    });
  });

  test.each([
    ['ชื่อว่าง', { name: '   ', type: 'crypto' }],
    ['ชื่อยาวเกิน 60', { name: 'ก'.repeat(61), type: 'crypto' }],
    ['ไม่ส่งชื่อ', { type: 'crypto' }],
    ['type ไม่รองรับ', { name: 'ok', type: 'stonks' }],
    // ⚠️ 'mixed' ไม่มีจริงใน CHECK ของ portfolios.type — Design Doc เคยเขียนผิดไว้
    ['type = mixed (Design Doc เขียนผิด)', { name: 'ok', type: 'mixed' }],
  ])('%s → 400 VALIDATION_ERROR', async (_label, body) => {
    const res = mockRes();
    await portfoliosController.createPortfolio(mockReq({ body, userRecord: PREMIUM_USER }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(portfolioRepository.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Premium หมดอายุ = "อ่านได้ เขียนไม่ได้" (มติ Founder § 8.1 ก)', () => {
  const THREE = [P_DEFAULT, P_SECOND, P_THIRD];

  beforeEach(() => {
    portfolioRepository.findAllByUser.mockResolvedValue(THREE);
  });

  test('⚠️ อ่านได้ครบทุกพอร์ต — ห้ามซ่อน ห้ามลบ (กฎเหล็กข้อ 2)', async () => {
    const res = mockRes();
    await portfoliosController.listPortfolios(mockReq({ userRecord: EXPIRED_PREMIUM_USER }), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).portfolios).toHaveLength(3);
  });

  test('⚠️ เขียนได้เฉพาะพอร์ตแรกสุดตาม created_at — อีก 2 อันเป็น canWrite: false', async () => {
    const res = mockRes();
    await portfoliosController.listPortfolios(mockReq({ userRecord: EXPIRED_PREMIUM_USER }), res);

    const byId = Object.fromEntries(jsonOf(res).portfolios.map((p) => [p.id, p.canWrite]));
    expect(byId[P_DEFAULT.id]).toBe(true); // created_at เก่าที่สุด
    expect(byId[P_SECOND.id]).toBe(false);
    expect(byId[P_THIRD.id]).toBe(false);
  });

  test('⚠️ เขียนลงพอร์ตส่วนเกิน → 403 PORTFOLIO_READ_ONLY (ข้อมูลเดิมยังอยู่ครบ)', async () => {
    portfolioRepository.findByIdForUser.mockResolvedValue(P_THIRD);

    const res = mockRes();
    await portfoliosController.updatePortfolio(
      mockReq({
        params: { id: P_THIRD.id },
        body: { name: 'ชื่อใหม่' },
        userRecord: EXPIRED_PREMIUM_USER,
      }),
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('PORTFOLIO_READ_ONLY');
    expect(portfolioRepository.updateByIdForUser).not.toHaveBeenCalled();
  });

  test('ต่ออายุแล้วกลับมาเขียนได้ทันที ไม่ต้องมี Job ไปไล่อัปเดตแถว', async () => {
    portfolioRepository.findByIdForUser.mockResolvedValue(P_THIRD);
    portfolioRepository.updateByIdForUser.mockResolvedValue({ ...P_THIRD, name: 'ชื่อใหม่' });

    const res = mockRes();
    await portfoliosController.updatePortfolio(
      mockReq({
        params: { id: P_THIRD.id },
        body: { name: 'ชื่อใหม่' },
        userRecord: PREMIUM_USER,
      }),
      res
    );

    expect(statusOf(res)).toBe(200);
  });

  // ⚠️ Deterministic — migration 044 Backfill สร้างพอร์ตใน Transaction เดียว
  // now() คงที่ทั้ง Transaction → created_at เท่ากันเป๊ะเกิดขึ้นได้จริง
  // ถ้าไม่ Tie-break ด้วย id ลำดับจะขึ้นกับ Physical Row Order ของ Postgres
  // ซึ่งเปลี่ยนได้ทุกเมื่อ = ผู้ใช้เจอ "บางครั้งบันทึกได้ บางครั้งไม่ได้"
  test('⚠️ created_at เท่ากันเป๊ะ → Tie-break ด้วย id ต้องได้ผลเดิมทุกครั้ง', async () => {
    const SAME = '2026-01-01T00:00:00.000Z';
    const a = { ...P_DEFAULT, id: 'aaaa1111-1111-4111-8111-111111111111', createdAt: SAME };
    const b = { ...P_SECOND, id: 'bbbb2222-2222-4222-8222-222222222222', createdAt: SAME };

    // สลับลำดับที่ Repository คืนมา — ผลลัพธ์ต้องเหมือนเดิมทั้งสองรอบ
    for (const order of [[a, b], [b, a]]) {
      portfolioRepository.findAllByUser.mockResolvedValue(order);
      const res = mockRes();
      await portfoliosController.listPortfolios(mockReq({ userRecord: EXPIRED_PREMIUM_USER }), res);

      const byId = Object.fromEntries(jsonOf(res).portfolios.map((p) => [p.id, p.canWrite]));
      expect(byId[a.id]).toBe(true); // id เรียงก่อน → เขียนได้เสมอ
      expect(byId[b.id]).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Cross-User Isolation (กฎเหล็กข้อ 3)', () => {
  test('⚠️ portfolioId ของผู้ใช้คนอื่น → 404 (ไม่ใช่ 403 ห้ามยืนยันว่ามีอยู่จริง)', async () => {
    // queryForUser บังคับ .eq('user_id', userId) → พอร์ตของคนอื่นคืน null เสมอ
    portfolioRepository.findByIdForUser.mockResolvedValue(null);

    const res = mockRes();
    await portfoliosController.getPortfolio(
      mockReq({ params: { id: 'dddddddd-4444-4444-8444-444444444444' } }),
      res
    );

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('PORTFOLIO_NOT_FOUND');
  });

  test('⚠️ แก้พอร์ตของผู้ใช้คนอื่น → 404 และห้ามเขียนอะไรลง DB เลย', async () => {
    portfolioRepository.findByIdForUser.mockResolvedValue(null);

    const res = mockRes();
    await portfoliosController.updatePortfolio(
      mockReq({
        params: { id: 'dddddddd-4444-4444-8444-444444444444' },
        body: { name: 'ยึดพอร์ต' },
        userRecord: PREMIUM_USER,
      }),
      res
    );

    expect(statusOf(res)).toBe(404);
    expect(portfolioRepository.updateByIdForUser).not.toHaveBeenCalled();
  });

  test('⚠️ ลบพอร์ตของผู้ใช้คนอื่น → 404 และห้ามแตะสินทรัพย์ใดๆ', async () => {
    portfolioRepository.findByIdForUser.mockResolvedValue(null);

    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({
        params: { id: 'dddddddd-4444-4444-8444-444444444444' },
        userRecord: PREMIUM_USER,
      }),
      res
    );

    expect(statusOf(res)).toBe(404);
    expect(assetRepository.reassignPortfolio).not.toHaveBeenCalled();
    expect(portfolioRepository.deleteByIdForUser).not.toHaveBeenCalled();
  });

  test('id ผิดรูป (ไม่ใช่ UUID) → 404 ไม่ใช่ 500 (กัน Postgres 22P02)', async () => {
    const res = mockRes();
    await portfoliosController.getPortfolio(mockReq({ params: { id: 'not-a-uuid' } }), res);

    expect(statusOf(res)).toBe(404);
    expect(portfolioRepository.findByIdForUser).not.toHaveBeenCalled();
  });

  test('Service ส่ง userId จาก JWT เข้า Repository เสมอ (ไม่เคยรับจาก Body)', async () => {
    await portfoliosController.listPortfolios(
      { user: { id: OTHER_USER_ID }, userRecord: FREE_USER, body: { userId: USER_ID }, params: {} },
      mockRes()
    );

    expect(portfolioRepository.findAllByUser).toHaveBeenCalledWith(OTHER_USER_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('DELETE /portfolios/:id — ลบ "กล่อง" ไม่ใช่ลบสินทรัพย์', () => {
  beforeEach(() => {
    portfolioRepository.findAllByUser.mockResolvedValue([P_DEFAULT, P_SECOND]);
    portfolioRepository.findByIdForUser.mockResolvedValue(P_SECOND);
  });

  test('⚠️ ลบพอร์ต Default ไม่ได้ → 409 CANNOT_DELETE_DEFAULT_PORTFOLIO', async () => {
    portfolioRepository.findByIdForUser.mockResolvedValue(P_DEFAULT);

    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_DEFAULT.id }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('CANNOT_DELETE_DEFAULT_PORTFOLIO');
    expect(portfolioRepository.deleteByIdForUser).not.toHaveBeenCalled();
  });

  // ⭐ หัวใจ: ห้ามพึ่ง ON DELETE SET NULL ของ FK — จะทำ Invariant ของ
  // migration 044/045 พัง ("สินทรัพย์ทุกแถวสังกัดพอร์ตเสมอ")
  test('⚠️ ต้องย้ายสินทรัพย์เข้าพอร์ต Default "ก่อน" ลบ ไม่ปล่อยเป็น portfolio_id = NULL', async () => {
    assetRepository.findByPortfolio.mockImplementation(async (_uid, pid) =>
      pid === P_SECOND.id
        ? [{ id: 'asset-1', symbol: 'BTC', brokerId: null }, { id: 'asset-2', symbol: 'ETH', brokerId: 'b1' }]
        : []
    );
    assetRepository.reassignPortfolio.mockResolvedValue(2);

    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_SECOND.id }, userRecord: PREMIUM_USER }),
      res
    );

    expect(assetRepository.reassignPortfolio).toHaveBeenCalledWith(
      USER_ID,
      P_SECOND.id,
      P_DEFAULT.id
    );
    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res)).toMatchObject({
      deleted: true,
      movedAssetCount: 2,
      movedToPortfolioId: P_DEFAULT.id,
    });
  });

  test('ลำดับบังคับ: ย้ายสินทรัพย์เสร็จก่อน แล้วค่อยลบแถวพอร์ต', async () => {
    const order = [];
    assetRepository.findByPortfolio.mockImplementation(async (_uid, pid) =>
      pid === P_SECOND.id ? [{ id: 'asset-1', symbol: 'BTC', brokerId: null }] : []
    );
    assetRepository.reassignPortfolio.mockImplementation(async () => {
      order.push('reassign');
      return 1;
    });
    portfolioRepository.deleteByIdForUser.mockImplementation(async () => {
      order.push('delete');
      return 1;
    });

    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_SECOND.id }, userRecord: PREMIUM_USER }),
      mockRes()
    );

    expect(order).toEqual(['reassign', 'delete']);
  });

  // ⚠️ เคสเดียวกับที่ migration 044 STEP 6 ดักไว้เป๊ะ — การรวมสองแถวเข้าด้วยกัน
  // กระทบต้นทุนเฉลี่ย = แตะเงินจริง ห้ามทำอัตโนมัติ
  test('⚠️ สินทรัพย์ชนกับพอร์ต Default (symbol+broker เดียวกัน) → 409 และห้ามลบ/ห้ามย้าย', async () => {
    assetRepository.findByPortfolio.mockImplementation(async (_uid, pid) =>
      pid === P_SECOND.id
        ? [{ id: 'asset-a', symbol: 'BTC', brokerId: 'bitkub' }]
        : [{ id: 'asset-b', symbol: 'BTC', brokerId: 'bitkub' }]
    );

    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_SECOND.id }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('PORTFOLIO_HAS_CONFLICTING_ASSETS');
    expect(jsonOf(res).details.conflicts).toEqual([
      { assetId: 'asset-a', symbol: 'BTC', brokerId: 'bitkub' },
    ]);
    expect(assetRepository.reassignPortfolio).not.toHaveBeenCalled();
    expect(portfolioRepository.deleteByIdForUser).not.toHaveBeenCalled();
  });

  // broker_id ที่เป็น NULL ต้องถือว่า "เท่ากัน" แบบเดียวกับ NULLS NOT DISTINCT
  test('⚠️ ชนกันทั้งคู่ที่ broker = NULL ("ไม่ระบุโบรก") ก็ต้องนับว่าชน', async () => {
    assetRepository.findByPortfolio.mockImplementation(async (_uid, pid) =>
      pid === P_SECOND.id
        ? [{ id: 'asset-a', symbol: 'BTC', brokerId: null }]
        : [{ id: 'asset-b', symbol: 'BTC', brokerId: null }]
    );

    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_SECOND.id }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(409);
    expect(portfolioRepository.deleteByIdForUser).not.toHaveBeenCalled();
  });

  test('BTC คนละโบรก → ไม่ชน ย้ายได้ปกติ (migration 046 เปิดให้อยู่ร่วมกันได้)', async () => {
    assetRepository.findByPortfolio.mockImplementation(async (_uid, pid) =>
      pid === P_SECOND.id
        ? [{ id: 'asset-a', symbol: 'BTC', brokerId: 'binance' }]
        : [{ id: 'asset-b', symbol: 'BTC', brokerId: 'bitkub' }]
    );
    assetRepository.reassignPortfolio.mockResolvedValue(1);

    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_SECOND.id }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(200);
    expect(assetRepository.reassignPortfolio).toHaveBeenCalled();
  });

  test('พอร์ตว่าง (ไม่มีสินทรัพย์) → ลบได้เลย ไม่ต้องย้ายอะไร', async () => {
    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_SECOND.id }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(200);
    expect(assetRepository.reassignPortfolio).not.toHaveBeenCalled();
    expect(portfolioRepository.deleteByIdForUser).toHaveBeenCalledWith(P_SECOND.id, USER_ID);
  });

  test('Invariant พัง (ไม่มีพอร์ต Default) → 500 ไม่ใช่ลบทิ้งแล้วปล่อยสินทรัพย์เป็น NULL', async () => {
    portfolioRepository.findDefaultByUser.mockResolvedValue(null);

    const res = mockRes();
    await portfoliosController.deletePortfolio(
      mockReq({ params: { id: P_SECOND.id }, userRecord: PREMIUM_USER }),
      res
    );

    expect(statusOf(res)).toBe(500);
    expect(portfolioRepository.deleteByIdForUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('assertCanWriteToPortfolio — ด่านกลางของทุกจุดที่เขียนลงพอร์ต', () => {
  test('portfolioId = null (ไม่ระบุพอร์ต) → ผ่าน ไม่ยิง Query เลย', async () => {
    const result = await portfoliosService.assertCanWriteToPortfolio(USER_ID, null, FREE_USER);

    expect(result).toBeNull();
    expect(portfolioRepository.findByIdForUser).not.toHaveBeenCalled();
  });

  test('พอร์ตของตัวเองที่เขียนได้ → คืนพอร์ตนั้น', async () => {
    const result = await portfoliosService.assertCanWriteToPortfolio(
      USER_ID,
      P_DEFAULT.id,
      FREE_USER
    );

    expect(result.id).toBe(P_DEFAULT.id);
  });

  test('⚠️ พอร์ตของคนอื่น → PORTFOLIO_NOT_FOUND (ไม่ใช่ READ_ONLY ที่บอกใบ้ว่ามีจริง)', async () => {
    portfolioRepository.findByIdForUser.mockResolvedValue(null);

    await expect(
      portfoliosService.assertCanWriteToPortfolio(USER_ID, P_SECOND.id, PREMIUM_USER)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_NOT_FOUND' });
  });
});
