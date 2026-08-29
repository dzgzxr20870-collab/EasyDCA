jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const { createTransaction } = require('../src/controllers/transactions.controller');

// ═══════════════════════════════════════════════════════════════════════════
// ช่อง "บันทึกลงพอร์ต" บนฟอร์มเว็บ — POST /transactions รับ portfolioId
// ═══════════════════════════════════════════════════════════════════════════
// เคสจริง (Founder 29 ส.ค. 2569): สร้างพอร์ต "Dime" → เลือกเป็นปลายทาง → ซื้อ
// สินทรัพย์ใหม่ → รายการไปโผล่พอร์ตหลักแทน เพราะ **Controller ไม่เคยอ่าน
// body.portfolioId เลยสักครั้ง** (grep "portfolio" ทั้งไฟล์เจอแค่คอมเมนต์บรรทัดเดียว)
//
// ⚠️ Mock เฉพาะ Repository — ใช้ transaction.service / portfolios.service /
// entitlement.service ของจริงทั้งหมด ตามบทเรียน POSTMORTEM_AMOUNT_CONSISTENCY
// (บั๊กชอบซ่อนที่ "รอยต่อ" ระหว่าง Service ซึ่งเป็นจุดบอดของ Mock ทั้งคู่)

const USER_ID = 'user-uuid-1';
const PREMIUM = { id: USER_ID, plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' };
// Free → พอร์ตที่ไม่ใช่ Default จะถูกล็อก (getWritablePortfolioIds เพดาน 1)
const FREE = { id: USER_ID, plan: 'free', planExpiresAt: null };

const MAIN = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  userId: USER_ID,
  name: 'พอร์ตหลัก',
  type: 'custom',
  isDefault: true,
  createdAt: '2026-02-01T00:00:00.000Z',
};
const DIME = {
  id: 'bbbbbbbb-2222-4222-8222-222222222222',
  userId: USER_ID,
  name: 'Dime',
  type: 'custom',
  isDefault: false,
  createdAt: '2026-08-01T00:00:00.000Z',
};

function mockReq(body = {}, userRecord = PREMIUM) {
  return { user: { id: USER_ID }, userRecord, body };
}
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const statusOf = (res) => res.status.mock.calls[0][0];
const jsonOf = (res) => res.json.mock.calls[0][0];

// ซื้อ BTC ด้วยจำนวนหน่วย + ราคา (ไม่ต้องพึ่ง Price Feed)
const BUY = { symbol: 'BTC', quantity: 1, pricePerUnit: 1000 };

beforeEach(() => {
  jest.clearAllMocks();
  portfolioRepository.findAllByUser.mockResolvedValue([MAIN, DIME]);
  portfolioRepository.findDefaultByUser.mockResolvedValue(MAIN);
  portfolioRepository.findByIdForUser.mockImplementation(async (id) =>
    [MAIN, DIME].find((p) => p.id === id) ?? null
  );
  // ยังไม่เคยถือ BTC ที่ไหนเลย
  assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
  assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);
  assetRepository.create.mockImplementation(async (_u, portfolioId) => ({
    id: 'asset-new',
    userId: USER_ID,
    symbol: 'BTC',
    type: 'crypto',
    portfolioId,
    brokerId: null,
  }));
  transactionRepository.create.mockResolvedValue({ id: 'tx-1' });
  transactionRepository.findAllByAsset.mockResolvedValue([]);
  transactionRepository.findAllByUser.mockResolvedValue([]);
  priceFeedService.getCurrentPrice.mockResolvedValue(1000);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-29', stale: false });
});

describe('⭐ POST /transactions — portfolioId จากฟอร์มเว็บ', () => {
  // ⭐⭐ เคสที่ Founder เจอ — ก่อนแก้ Controller ทิ้ง portfolioId เงียบๆ
  // แล้วสินทรัพย์ใหม่ไปลงพอร์ตหลักเสมอ
  test('⭐ เลือกพอร์ต "Dime" + ซื้อสินทรัพย์ใหม่ → Asset ถูกสร้างในพอร์ตนั้น', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY, portfolioId: DIME.id }), res);

    expect(statusOf(res)).toBe(201);
    // ⚠️ Assert ที่ Argument ของ create ตรงๆ — ผลลัพธ์ "ดูถูก" ได้แม้บั๊กยังอยู่
    // Argument ที่ 2 ของ assetRepository.create คือพอร์ตที่แถวใหม่จะไปสังกัด
    expect(assetRepository.create.mock.calls[0][0]).toBe(USER_ID);
    expect(assetRepository.create.mock.calls[0][1]).toBe(DIME.id);
  });

  test('ไม่ส่ง portfolioId → ลงพอร์ตหลักเหมือนเดิมเป๊ะ (Backward Compat)', async () => {
    const res = mockRes();
    await createTransaction(mockReq(BUY), res);

    expect(statusOf(res)).toBe(201);
    expect(assetRepository.create.mock.calls[0][1]).toBe(MAIN.id);
  });

  // ── ด่านความเป็นเจ้าของ (เหตุผลเดียวกับ assertOwnedBrokerId) ──────────────
  test('⭐ portfolioId ของผู้ใช้คนอื่น → 404 PORTFOLIO_NOT_FOUND ไม่ใช่บันทึกสำเร็จ', async () => {
    portfolioRepository.findByIdForUser.mockResolvedValue(null); // ไม่ใช่ของ user นี้
    const res = mockRes();

    await createTransaction(
      mockReq({ ...BUY, portfolioId: 'cccccccc-3333-4333-8333-333333333333' }),
      res
    );

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('PORTFOLIO_NOT_FOUND');
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  test('portfolioId ผิดรูปแบบ (ไม่ใช่ UUID) → 400 VALIDATION_ERROR ไม่ยิง Query', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY, portfolioId: 'not-a-uuid' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).details).toMatchObject({ field: 'portfolioId' });
    expect(portfolioRepository.findByIdForUser).not.toHaveBeenCalled();
  });

  // ── 🔴 บั๊กที่เจอระหว่างทำงานนี้ (มีมาก่อนรอบนี้) ─────────────────────────
  // assertCanAddToPortfolio โยน PortfolioServiceError ซึ่ง catch ของ Controller
  // ไม่เคยดัก → ตกเป็น 500 INTERNAL_ERROR ทั้งที่ WEB_ERROR_MESSAGES/ERROR_STATUS
  // มีข้อความไทยและ Status 403 รออยู่แล้ว
  test('⭐ พอร์ตปลายทางถูกล็อก (Free) → 403 PORTFOLIO_READ_ONLY **ไม่ใช่ 500**', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY, portfolioId: DIME.id }, FREE), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('PORTFOLIO_READ_ONLY');
    // ข้อความต้องบอกทางออกที่ยังทำได้จริง ไม่ใช่ "เกิดข้อผิดพลาดภายในระบบ"
    expect(jsonOf(res).message).toContain('ต่ออายุ');
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ ถือ Symbol เดียวกันแยกหลายพอร์ต (มติ Founder 29 ส.ค. 2569)
  // ═══════════════════════════════════════════════════════════════════════
  describe('ASSET_EXISTS_IN_OTHER_PORTFOLIO — ต้องยืนยันก่อนแยกพอร์ต', () => {
    beforeEach(() => {
      // ถือ BTC อยู่ที่พอร์ตหลักแล้ว
      assetRepository.findAllByUserAndSymbol.mockResolvedValue([
        {
          id: 'asset-btc',
          userId: USER_ID,
          symbol: 'BTC',
          type: 'crypto',
          portfolioId: MAIN.id,
          brokerId: null,
        },
      ]);
      assetRepository.findActiveSymbolsByUser.mockResolvedValue(['BTC']);
    });

    test('⭐ เลือกพอร์ต Dime + ยังไม่ตอบ → 409 พร้อมบอกว่าของเดิมอยู่พอร์ตไหน', async () => {
      const res = mockRes();
      await createTransaction(mockReq({ ...BUY, portfolioId: DIME.id }), res);

      expect(statusOf(res)).toBe(409);
      expect(jsonOf(res).error).toBe('ASSET_EXISTS_IN_OTHER_PORTFOLIO');
      // UI ต้องประกอบประโยคถามผู้ใช้ได้จาก details นี้
      expect(jsonOf(res).details).toMatchObject({
        symbol: 'BTC',
        existingPortfolioId: MAIN.id,
        destinationPortfolioId: DIME.id,
      });
      // ⚠️ ห้ามเขียนอะไรลง Ledger ระหว่างรอคำตอบ
      expect(assetRepository.create).not.toHaveBeenCalled();
      expect(transactionRepository.create).not.toHaveBeenCalled();
    });

    test('⭐ ตอบ "แยกพอร์ต" (true) → สร้างแถวใหม่ใน Dime สำเร็จ', async () => {
      const res = mockRes();
      await createTransaction(
        mockReq({ ...BUY, portfolioId: DIME.id, confirmSeparatePortfolio: true }),
        res
      );

      expect(statusOf(res)).toBe(201);
      expect(assetRepository.create.mock.calls[0][1]).toBe(DIME.id);
    });

    test('⭐ ตอบ "รวมพอร์ตเดิม" (false) → รวมแถวเดิม ไม่สร้างใหม่ ไม่ถามซ้ำ', async () => {
      const res = mockRes();
      await createTransaction(
        mockReq({ ...BUY, portfolioId: DIME.id, confirmSeparatePortfolio: false }),
        res
      );

      expect(statusOf(res)).toBe(201);
      expect(assetRepository.create).not.toHaveBeenCalled();
    });

    // ⚠️ ค่าผิดชนิดต้องถูกเมินทิ้ง = "ยังไม่ตอบ" ไม่ใช่ตีความเป็น true เงียบๆ
    // (การแยกแถวกระทบต้นทุนเฉลี่ยที่ผู้ใช้จะเห็นต่อไป ต้องมาจากการกดยืนยันจริง)
    test('⚠️ confirmSeparatePortfolio เป็นสตริง "true" → ถือว่ายังไม่ตอบ (409)', async () => {
      const res = mockRes();
      await createTransaction(
        mockReq({ ...BUY, portfolioId: DIME.id, confirmSeparatePortfolio: 'true' }),
        res
      );

      expect(statusOf(res)).toBe(409);
      expect(assetRepository.create).not.toHaveBeenCalled();
    });

    // เส้นทาง LINE/Bulk ไม่ส่ง portfolioId มาเลย → ต้องไม่ถูกถามเด็ดขาด
    test('ไม่ส่ง portfolioId (เส้นทาง LINE/เดิม) → รวมตามปกติ ไม่ถาม', async () => {
      const res = mockRes();
      await createTransaction(mockReq(BUY), res);

      expect(statusOf(res)).toBe(201);
      expect(assetRepository.create).not.toHaveBeenCalled();
    });
  });

  // ขายไม่มีคอนเซ็ปต์ "เลือกพอร์ตปลายทาง" — ปลายทางถูกกำหนดโดยสินทรัพย์ที่ถืออยู่
  test('ขาย → portfolioId ที่หลุดมาใน Body ต้องถูกละเว้น ไม่กลายเป็นด่านใหม่', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([
      { id: 'asset-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto', portfolioId: MAIN.id, brokerId: null },
    ]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-0', type: 'buy', quantity: 2, amountThb: 2000, pricePerUnit: 1000, date: '2026-01-05' },
    ]);
    const res = mockRes();

    await createTransaction(
      mockReq({ symbol: 'BTC', side: 'sell', quantity: 1, pricePerUnit: 1200, portfolioId: DIME.id }, FREE),
      res
    );

    // Free + พอร์ต Dime ถูกล็อก แต่ "ขาย" ต้องทำได้เสมอ (มติ Founder 24 ส.ค. 2569)
    expect(statusOf(res)).toBe(201);
    expect(portfolioRepository.findByIdForUser).not.toHaveBeenCalled();
  });
});
