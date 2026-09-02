jest.mock('../src/repositories/asset.repository');
jest.mock('../src/services/broker.service');
jest.mock('../src/services/portfolios.service');
// ⭐ excludeZeroHolding (E2E Chrome Test — บั๊กที่ 1 ตามจริง) — ต้องมีเพื่อให้
// assets.service.listAssets เรียก calculateHeldQuantity (transaction.service)
// ได้โดยไม่ยิง Supabase จริง — ไม่กระทบเทสต์อื่นในไฟล์นี้เพราะมีแค่ Describe
// Block เดียวด้านล่างที่ส่ง excludeZeroHolding: true
jest.mock('../src/repositories/transaction.repository');

const assetRepository = require('../src/repositories/asset.repository');
const brokerService = require('../src/services/broker.service');
const portfoliosService = require('../src/services/portfolios.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const assetsController = require('../src/controllers/assets.controller');

// ═══════════════════════════════════════════════════════════════════════════
// Stage 8 — GET /api/v1/assets + PATCH /api/v1/assets/{id} (Design Doc § 4.4)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ Endpoint นี้แก้ได้เฉพาะ "ป้ายกำกับ" (brokerId / sector / portfolioId) ซึ่ง
// ไม่เข้าสูตรคำนวณเงินใดๆ — เทสต์ชุดนี้จึงเน้น 3 เรื่องที่พลาดแล้วเจ็บจริง:
//   (1) Cross-User: brokerId/portfolioId จาก Body ต้องยืนยันเจ้าของก่อนใช้เสมอ
//   (2) Invariant migration 044/045: ห้ามย้ายสินทรัพย์ออกไปเป็น "ไม่มีพอร์ต"
//   (3) ห้ามเปิดให้แก้ symbol/type (จะทำต้นทุนเฉลี่ยผิดตัวแบบเงียบๆ)
//
// Red-Green ที่ครอบ:
//   • ถอด assertOwnedBrokerId → describe Cross-User แดง
//   • ยอมให้ portfolioId = null → 'ห้ามล้างพอร์ต' แดง
//   • ถอดการปฏิเสธ Field ที่ไม่รองรับ → 'symbol/type' แดง

const USER_ID = 'user-uuid-1';
const ASSET_ID = '11111111-2222-4333-8444-555555555555';
const BROKER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const BROKER_OF_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const PORTFOLIO_A = 'cccccccc-3333-4333-8333-333333333333';

const FREE_USER = { id: USER_ID, plan: 'free', planExpiresAt: null };

function asset(overrides = {}) {
  return {
    id: ASSET_ID,
    userId: USER_ID,
    symbol: 'BTC',
    name: 'Bitcoin',
    type: 'crypto',
    brokerId: null,
    sector: null,
    portfolioId: PORTFOLIO_A,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockReq({ body = {}, params = {}, query = {} } = {}) {
  return { user: { id: USER_ID }, userRecord: FREE_USER, body, params, query };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const jsonOf = (res) => res.json.mock.calls[0][0];
const statusOf = (res) => res.status.mock.calls[0][0];

class MockError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  assetRepository.AssetWriteError = MockError;
  brokerService.BrokerServiceError = MockError;
  portfoliosService.PortfolioServiceError = MockError;
  assetRepository.findByIdForUser.mockResolvedValue(asset());
  assetRepository.updateMetaByIdForUser.mockImplementation(async (_id, _uid, patch) =>
    asset(patch)
  );
  assetRepository.findActiveByUser.mockResolvedValue([asset()]);
  brokerService.assertOwnedBrokerId.mockImplementation(async (_uid, id) => id);
  portfoliosService.assertCanAddToPortfolio.mockResolvedValue({ id: PORTFOLIO_A });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ Cross-User Isolation (กฎเหล็กข้อ 3)', () => {
  test('⚠️ brokerId ของผู้ใช้คนอื่น → 404 และห้ามเขียนอะไรลง DB เลย', async () => {
    brokerService.assertOwnedBrokerId.mockRejectedValue(new MockError('BROKER_NOT_FOUND'));

    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { brokerId: BROKER_OF_B } }),
      res
    );

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('BROKER_NOT_FOUND');
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });

  test('⚠️ portfolioId ของผู้ใช้คนอื่น → 404 และห้ามเขียนอะไรลง DB เลย', async () => {
    portfoliosService.assertCanAddToPortfolio.mockRejectedValue(
      new MockError('PORTFOLIO_NOT_FOUND')
    );

    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { portfolioId: PORTFOLIO_A } }),
      res
    );

    expect(statusOf(res)).toBe(404);
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });

  test('⚠️ assetId ของผู้ใช้คนอื่น → 404 (findByIdForUser Scope ด้วย user_id)', async () => {
    assetRepository.findByIdForUser.mockResolvedValue(null);

    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { sector: 'Tech' } }),
      res
    );

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('ASSET_NOT_FOUND');
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });

  test('brokerId ของตัวเอง → ผ่าน assertOwnedBrokerId แล้วบันทึก', async () => {
    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { brokerId: BROKER_A } }),
      res
    );

    expect(brokerService.assertOwnedBrokerId).toHaveBeenCalledWith(USER_ID, BROKER_A);
    expect(assetRepository.updateMetaByIdForUser).toHaveBeenCalledWith(ASSET_ID, USER_ID, {
      brokerId: BROKER_A,
    });
    expect(statusOf(res)).toBe(200);
  });

  test('brokerId = "none" → ล้างโบรกเป็น null (ไม่ใช่สตริง "none")', async () => {
    brokerService.assertOwnedBrokerId.mockResolvedValue(null);

    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { brokerId: 'none' } }),
      mockRes()
    );

    expect(brokerService.assertOwnedBrokerId).toHaveBeenCalledWith(USER_ID, null);
    expect(assetRepository.updateMetaByIdForUser).toHaveBeenCalledWith(ASSET_ID, USER_ID, {
      brokerId: null,
    });
  });

  test('assetId ผิดรูป (ไม่ใช่ UUID) → 404 ไม่ใช่ 500 (กัน Postgres 22P02)', async () => {
    const res = mockRes();
    await assetsController.updateAsset(mockReq({ params: { id: 'not-a-uuid' } }), res);

    expect(statusOf(res)).toBe(404);
    expect(assetRepository.findByIdForUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ Invariant migration 044/045 — สินทรัพย์ทุกแถวต้องสังกัดพอร์ตเสมอ', () => {
  test.each([['null', null], ['"none"', 'none'], ['สตริงว่าง', '']])(
    '⚠️ portfolioId = %s → 400 VALIDATION_ERROR (ห้ามล้างพอร์ต)',
    async (_label, portfolioId) => {
      const res = mockRes();
      await assetsController.updateAsset(
        mockReq({ params: { id: ASSET_ID }, body: { portfolioId } }),
        res
      );

      expect(statusOf(res)).toBe(400);
      expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
      expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
    }
  );

  test('ย้ายเข้าพอร์ตของตัวเองที่เขียนได้ → ผ่าน', async () => {
    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { portfolioId: PORTFOLIO_A } }),
      res
    );

    expect(statusOf(res)).toBe(200);
    expect(assetRepository.updateMetaByIdForUser).toHaveBeenCalledWith(ASSET_ID, USER_ID, {
      portfolioId: PORTFOLIO_A,
    });
  });

  // ชน UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id)
  // ของ migration 046 — ห้ามรวมสองแถวให้อัตโนมัติ (กระทบต้นทุนเฉลี่ย = แตะเงินจริง)
  test('⚠️ ย้ายไปชนสินทรัพย์เดิม (symbol+broker+พอร์ต ซ้ำ) → 409 ASSET_ALREADY_EXISTS', async () => {
    assetRepository.updateMetaByIdForUser.mockRejectedValue(new MockError('ASSET_ALREADY_EXISTS'));

    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { portfolioId: PORTFOLIO_A } }),
      res
    );

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('ASSET_ALREADY_EXISTS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ Premium หมดอายุ — สินทรัพย์ในพอร์ตส่วนเกินแก้ไม่ได้', () => {
  test('⚠️ สินทรัพย์อยู่ในพอร์ตที่อ่านได้อย่างเดียว → 403 PORTFOLIO_READ_ONLY', async () => {
    portfoliosService.assertCanAddToPortfolio.mockRejectedValue(
      new MockError('PORTFOLIO_READ_ONLY')
    );

    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { sector: 'Tech' } }),
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('PORTFOLIO_READ_ONLY');
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });

  test('เช็คสิทธิ์เขียนของพอร์ตที่สินทรัพย์สังกัดอยู่ "ก่อน" แตะอะไรทั้งสิ้น', async () => {
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { sector: 'Tech' } }),
      mockRes()
    );

    expect(portfoliosService.assertCanAddToPortfolio).toHaveBeenCalledWith(
      USER_ID,
      PORTFOLIO_A,
      FREE_USER
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ ห้ามแก้ symbol / type / isActive ผ่าน Endpoint นี้', () => {
  // symbol/type = ตัวตนของสินทรัพย์ที่ธุรกรรมทั้งกองผูกอยู่ ถ้าเปลี่ยนได้
  // ต้นทุนเฉลี่ยและ P&L ที่คำนวณจากประวัติเดิมจะกลายเป็นของผิดตัวทันทีแบบเงียบๆ
  test.each([
    ['symbol', { symbol: 'ETH' }],
    ['type', { type: 'stock_th' }],
    ['isActive', { isActive: false }],
    ['userId', { userId: 'someone-else' }],
  ])('⚠️ ส่ง %s มา → 400 VALIDATION_ERROR (ไม่ใช่เพิกเฉยเงียบๆ)', async (_label, body) => {
    const res = mockRes();
    await assetsController.updateAsset(mockReq({ params: { id: ASSET_ID }, body }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(jsonOf(res).details.unsupportedFields).toEqual(Object.keys(body));
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });

  test('Body ว่าง (ไม่มีอะไรจะแก้) → 400 VALIDATION_ERROR', async () => {
    const res = mockRes();
    await assetsController.updateAsset(mockReq({ params: { id: ASSET_ID }, body: {} }), res);

    expect(statusOf(res)).toBe(400);
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sector — Normalize ตอนเขียน แต่คงตัวพิมพ์ตามที่ผู้ใช้พิมพ์', () => {
  test('trim หัวท้าย + ยุบช่องว่างซ้ำ', async () => {
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { sector: '  Real   Estate  ' } }),
      mockRes()
    );

    expect(assetRepository.updateMetaByIdForUser).toHaveBeenCalledWith(ASSET_ID, USER_ID, {
      sector: 'Real Estate',
    });
  });

  // ⚠️ บทเรียนตรงจาก Stage 2 ที่ตัด Title Case ของ Design Doc § 3.2 ออก
  test('⚠️ SET50 / REIT ต้องคงรูปเดิม ห้ามทำ Title Case', async () => {
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { sector: 'SET50' } }),
      mockRes()
    );

    expect(assetRepository.updateMetaByIdForUser).toHaveBeenCalledWith(ASSET_ID, USER_ID, {
      sector: 'SET50',
    });
  });

  test.each([['null', null], ['สตริงว่าง', ''], ['ช่องว่างล้วน', '   ']])(
    'sector = %s → ล้างค่าเป็น null (ตรงกับ NULL ของ DB)',
    async (_label, sector) => {
      await assetsController.updateAsset(
        mockReq({ params: { id: ASSET_ID }, body: { sector } }),
        mockRes()
      );

      expect(assetRepository.updateMetaByIdForUser).toHaveBeenCalledWith(ASSET_ID, USER_ID, {
        sector: null,
      });
    }
  );

  test('sector ยาวเกิน 60 ตัวอักษร (ชน CHECK ของ migration 043) → 400', async () => {
    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { sector: 'ก'.repeat(61) } }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });

  test('sector ชนิดผิด (ตัวเลข) → 400 ไม่ใช่แปลงเป็นสตริงเงียบๆ', async () => {
    const res = mockRes();
    await assetsController.updateAsset(
      mockReq({ params: { id: ASSET_ID }, body: { sector: 12345 } }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(assetRepository.updateMetaByIdForUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/assets — List + filter', () => {
  const BTC_BITKUB = asset({ id: 'a1', symbol: 'BTC', brokerId: BROKER_A, sector: 'Crypto' });
  const ETH_NONE = asset({ id: 'a2', symbol: 'ETH', brokerId: null, sector: null });
  const PTT_TECH = asset({ id: 'a3', symbol: 'PTT', brokerId: BROKER_A, sector: 'tech' });

  beforeEach(() => {
    assetRepository.findActiveByUser.mockResolvedValue([BTC_BITKUB, ETH_NONE, PTT_TECH]);
  });

  test('ไม่ส่ง filter → คืนทั้งหมด', async () => {
    const res = mockRes();
    await assetsController.listAssets(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).assets).toHaveLength(3);
    // ไม่ส่ง userId ออกไป
    expect(jsonOf(res).assets[0].userId).toBeUndefined();
  });

  test('?brokerId=<uuid> → เฉพาะของโบรกนั้น', async () => {
    const res = mockRes();
    await assetsController.listAssets(mockReq({ query: { brokerId: BROKER_A } }), res);

    expect(jsonOf(res).assets.map((a) => a.symbol)).toEqual(['BTC', 'PTT']);
  });

  test('?brokerId=none → เฉพาะแถวที่ไม่ผูกโบรก', async () => {
    const res = mockRes();
    await assetsController.listAssets(mockReq({ query: { brokerId: 'none' } }), res);

    expect(jsonOf(res).assets.map((a) => a.symbol)).toEqual(['ETH']);
  });

  // ต้องตรงกับวิธีจัดกลุ่มของ allocation.service เป๊ะ ไม่งั้นผู้ใช้กดกลุ่มบนกราฟ
  // โดนัทแล้วเห็นรายการไม่ครบ
  test('⚠️ ?sector=Tech → เทียบแบบไม่สนตัวพิมพ์ (ตรงกับที่กราฟโดนัทจัดกลุ่ม)', async () => {
    const res = mockRes();
    await assetsController.listAssets(mockReq({ query: { sector: 'Tech' } }), res);

    expect(jsonOf(res).assets.map((a) => a.symbol)).toEqual(['PTT']);
  });

  test('?sector=none → เฉพาะแถวที่ไม่ระบุ sector', async () => {
    const res = mockRes();
    await assetsController.listAssets(mockReq({ query: { sector: 'none' } }), res);

    expect(jsonOf(res).assets.map((a) => a.symbol)).toEqual(['ETH']);
  });

  test('brokerId ผิดรูป → 400 ไม่ใช่ 500', async () => {
    const res = mockRes();
    await assetsController.listAssets(mockReq({ query: { brokerId: 'not-a-uuid' } }), res);

    expect(statusOf(res)).toBe(400);
    expect(assetRepository.findActiveByUser).not.toHaveBeenCalled();
  });

  test('ส่ง userId จาก JWT เข้า Repository เสมอ (ไม่เคยรับจาก Query)', async () => {
    await assetsController.listAssets(
      { user: { id: 'user-real' }, query: { userId: 'user-fake' }, params: {}, body: {} },
      mockRes()
    );

    expect(assetRepository.findActiveByUser).toHaveBeenCalledWith('user-real');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ⭐⭐ ?excludeZeroHolding=true (E2E Chrome Test — บั๊กที่ 1 ตามจริง, มติ
  // Founder) — ดู assets.service.js สำหรับ Root Cause เต็ม
  // ═══════════════════════════════════════════════════════════════════════
  describe('?excludeZeroHolding=true', () => {
    beforeEach(() => {
      // BTC ถืออยู่จริง 1 หน่วย · ETH ขายหมดแล้ว (heldQuantity = 0 — เคสตรงตัว
      // ของบั๊กที่เจอจริง "EOSE — Weblue") · PTT ไม่เคยมีธุรกรรมเลย
      transactionRepository.findAllByAsset.mockImplementation(async (assetId) => {
        if (assetId === 'a1') return [{ type: 'buy', quantity: 1, amountThb: 100, date: '2026-08-01' }];
        if (assetId === 'a2') {
          return [
            { type: 'buy', quantity: 1, amountThb: 100, date: '2026-08-01' },
            { type: 'sell', quantity: 1, amountThb: 100, date: '2026-08-30' },
          ];
        }
        return [];
      });
    });

    test('⭐ ตัดสินทรัพย์ heldQuantity = 0 ออก (ETH ขายหมดแล้ว, PTT ไม่เคยซื้อ)', async () => {
      const res = mockRes();
      await assetsController.listAssets(mockReq({ query: { excludeZeroHolding: 'true' } }), res);

      expect(jsonOf(res).assets.map((a) => a.symbol)).toEqual(['BTC']);
    });

    // ⭐⭐ Regression กันหลุด Scope — ไม่ส่ง Query นี้มาเลย (ฝั่งซื้อ) ต้องเห็น
    // สินทรัพย์ 0 หน่วยได้ปกติเหมือนเดิมทุกประการ และห้ามยิง Transactions โดย
    // ไม่จำเป็น (ประหยัด Query เหมือนพฤติกรรมเดิมก่อนมีบั๊กนี้)
    test('⭐⭐ ไม่ส่ง excludeZeroHolding มาเลย → เห็นทุกสินทรัพย์ (ฝั่งซื้อต้องไม่ถูกกระทบ)', async () => {
      const res = mockRes();
      await assetsController.listAssets(mockReq({ query: {} }), res);

      expect(jsonOf(res).assets.map((a) => a.symbol)).toEqual(['BTC', 'ETH', 'PTT']);
      expect(transactionRepository.findAllByAsset).not.toHaveBeenCalled();
    });

    test('excludeZeroHolding ค่าอื่นที่ไม่ใช่ "true" ตรงตัว (เช่น "1"/"yes") → ไม่กรอง (Fail-closed)', async () => {
      const res = mockRes();
      await assetsController.listAssets(mockReq({ query: { excludeZeroHolding: '1' } }), res);

      expect(jsonOf(res).assets).toHaveLength(3);
    });
  });
});
