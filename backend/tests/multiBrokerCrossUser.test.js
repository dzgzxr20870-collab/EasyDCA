// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 (migration 046) — Cross-User Isolation ของ brokerId / portfolioId
// ═══════════════════════════════════════════════════════════════════════════
// EasyDCA ใช้ service_role key และไม่ได้เปิด RLS — Database ไม่ตรวจสิทธิ์ให้เลย
// (PROJECT_STATUS กฎยืนข้อ 3: Backend คือ Security Boundary เดียว)
//
// ⚠️ FK ระดับ DB ตรวจได้แค่ "brokers แถวนี้มีอยู่จริง" **ไม่ได้ตรวจว่าเป็นของใคร**
// ถ้า Controller เอา body.brokerId ไปใส่ assets.broker_id ตรงๆ ผู้ใช้ A จะผูก
// สินทรัพย์ตัวเองเข้ากับโบรกของผู้ใช้ B ได้ทันที (Design Doc § 6.3) — และเมื่อ B
// เปลี่ยนชื่อโบรก ชื่อบนหน้าพอร์ตของ A จะเปลี่ยนตาม = ข้อมูลรั่วข้ามบัญชีจริง
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
// ถอด `await brokerService.assertOwnedBrokerId(...)` ใน transactions.controller
// ออก (ส่ง body.brokerId ต่อตรงๆ) → เคส "brokerId ของผู้ใช้อื่น" แดงทันที

// Stage 8-fix (บั๊ก Asset Resolution) — validateBuy ต้อง Resolve พอร์ต Default
// ตอนสร้างสินทรัพย์ใหม่ (Invariant migration 044/045: สินทรัพย์ทุกแถวสังกัดพอร์ต)
// จึงต้อง Mock portfolio.repository ด้วย · Automock คืน undefined = "ยังไม่มีพอร์ต"
// ซึ่งตรงกับสภาพก่อน Apply 044 พอดี → พฤติกรรมของเทสต์เดิมไม่เปลี่ยน
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/broker.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');
jest.mock('../src/services/storage.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const brokerRepository = require('../src/repositories/broker.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const { createTransaction } = require('../src/controllers/transactions.controller');

const USER_A = 'user-aaaa-1111';
const BROKER_OF_A = 'broker-of-a-0001';
// โบรกที่ "มีอยู่จริงในระบบ" แต่เป็นของผู้ใช้ B — FK ผ่านฉลุย ด่านเดียวที่กันได้
// คือ assertOwnedBrokerId ในโค้ดเรา
const BROKER_OF_B = 'broker-of-b-0002';
// พอร์ตที่ "มีอยู่จริงในระบบ" แต่เป็นของผู้ใช้ B — ต้องเป็น UUID ที่ถูกรูปแบบ
// เพื่อให้ผ่านด่าน Validate รูปแบบไปชนด่าน **ความเป็นเจ้าของ** ซึ่งคือด่านที่
// เทสต์นี้ต้องการพิสูจน์จริงๆ (ถ้าใช้ค่ามั่วๆ จะถูกปัดตกที่ Regex ก่อน แล้ว
// ช่องโหว่ Cross-User จริงจะไม่เคยถูกทดสอบเลย)
const PORTFOLIO_OF_B = 'dddddddd-4444-4444-8444-444444444444';

const USER_RECORD = { id: USER_A, plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' };

function mockReq(body = {}) {
  return { user: { id: USER_A }, userRecord: USER_RECORD, body };
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
  jest.useFakeTimers({ now: new Date('2026-08-24T05:00:00Z'), doNotFake: ['performance'] });

  // findByIdForUser Scope ด้วย user_id เสมอ → โบรกของ B จึงคืน null ให้ A
  // (นี่คือพฤติกรรมจริงของ broker.repository — จำลองให้ตรง)
  brokerRepository.findByIdForUser.mockImplementation(async (brokerId, userId) =>
    brokerId === BROKER_OF_A && userId === USER_A
      ? { id: BROKER_OF_A, userId: USER_A, name: 'Bitkub' }
      : null
  );

  assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
  assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);
  assetRepository.create.mockResolvedValue({
    id: 'asset-new',
    userId: USER_A,
    symbol: 'AAPL',
    type: 'stock_us',
    brokerId: BROKER_OF_A,
  });
  transactionRepository.findAllByUser.mockResolvedValue([]);
  transactionRepository.findAllByAsset.mockResolvedValue([]);
  transactionRepository.create.mockImplementation(async (data) => ({ ...data, id: 'txn-1' }));
  priceFeedService.getCurrentPrice.mockResolvedValue(null);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-24', stale: false });
});

afterEach(() => {
  jest.useRealTimers();
});

const BUY_BODY = { side: 'buy', symbol: 'AAPL', amountTotal: 1000, pricePerUnit: 200 };

describe('POST /transactions — brokerId จาก Body ต้องยืนยันเจ้าของก่อนใช้เสมอ', () => {
  // ⚠️ เคสหลักของไฟล์นี้
  test('⚠️ ผู้ใช้ A ส่ง brokerId ของ B → ต้องถูกปฏิเสธ และห้ามเขียนอะไรลง DB เลย', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, brokerId: BROKER_OF_B }), res);

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('BROKER_NOT_FOUND');
    // ไม่ใช่แค่ "ตอบ Error" — ต้องไม่มีการสร้างสินทรัพย์/ธุรกรรมใดๆ เกิดขึ้นจริง
    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  // 404 ไม่ใช่ 403 โดยเจตนา — 403 เท่ากับยืนยันให้ผู้โจมตีรู้ว่า "id นี้มีอยู่จริง
  // แต่เป็นของคนอื่น" ซึ่งเป็นการรั่วข้อมูลการมีอยู่ของผู้ใช้รายอื่น (Design Doc § 6.3)
  test('brokerId ที่ไม่มีอยู่จริงเลย → ได้ 404 ชุดเดียวกับกรณี "เป็นของคนอื่น" (แยกไม่ออก)', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, brokerId: 'broker-ไม่มีจริง' }), res);

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('BROKER_NOT_FOUND');
  });

  test('brokerId ของตัวเอง → ผ่าน และถูกส่งต่อไปถึง assetRepository.create', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, brokerId: BROKER_OF_A }), res);

    expect(statusOf(res)).toBe(201);
    expect(assetRepository.create.mock.calls[0][7]).toBe(BROKER_OF_A);
  });

  test('brokerId = "none" → แปลเป็น null ("ไม่ระบุโบรก") ไม่ยิง Query หาโบรก', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, brokerId: 'none' }), res);

    expect(statusOf(res)).toBe(201);
    expect(brokerRepository.findByIdForUser).not.toHaveBeenCalled();
    expect(assetRepository.create.mock.calls[0][7]).toBeNull();
  });

  test('brokerId ชนิดผิด (ตัวเลข/object) → VALIDATION_ERROR ไม่ใช่ตีความเป็น null เงียบๆ', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, brokerId: 12345 }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
  });

  // ⚠️ ไม่ส่ง Key มาเลย ≠ ส่ง null — ต้องไม่ใส่ brokerId ลง params เลย เพื่อให้
  // assetResolution รู้ว่า "ยังไม่ได้ถาม" (ถ้ากำกวมจะได้ 409 ให้ไปถามผู้ใช้ก่อน)
  test('ไม่ส่ง brokerId มาเลย → ไม่ยิง Query หาโบรก และปล่อยให้ Service ตัดสินเอง', async () => {
    const res = mockRes();
    await createTransaction(mockReq(BUY_BODY), res);

    expect(statusOf(res)).toBe(201);
    expect(brokerRepository.findByIdForUser).not.toHaveBeenCalled();
  });
});

describe('POST /transactions — portfolioId จาก Body ต้องผ่านด่านเจ้าของก่อนเสมอ', () => {
  // ── ประวัติของ describe นี้ (อ่านก่อนแก้) ────────────────────────────────
  // Stage 5: เว็บยังไม่เปิด "เลือกพอร์ต" — สิ่งที่พิสูจน์ตอนนั้นคือ Controller
  // **ไม่รับ** portfolioId จาก Body เลย และเทสต์เดิมเขียนโน้ตไว้ว่า "เมื่อ Stage 8
  // เปิด POST /portfolios แล้ว ต้องกลับมาแก้เทสต์นี้เป็น assertOwnedPortfolioId
  // ปฏิเสธพอร์ตของคนอื่น — ห้ามลบเทสต์นี้ทิ้งเฉยๆ"
  //
  // ⭐ 29 ส.ค. 2569 = ตอนนั้น: ฟอร์มเว็บมีช่อง "บันทึกลงพอร์ต" แล้ว Controller จึง
  // **รับ** portfolioId แล้วจริงๆ · คุณสมบัติด้านความปลอดภัยไม่ได้อ่อนลง แต่
  // เปลี่ยนรูปจาก "เพิกเฉย" เป็น "ปฏิเสธเสียงดัง (404)" ซึ่งแข็งแรงกว่าเดิม
  // เพราะผู้ใช้ที่พิมพ์ id ผิดจะรู้ตัว แทนที่จะบันทึกสำเร็จเข้าพอร์ตที่ไม่ได้ตั้งใจ
  //
  // ── RED-GREEN ────────────────────────────────────────────────────────────
  // ถอด `await portfoliosService.assertOwnedPortfolioId(...)` ใน
  // transactions.controller ออก (ส่ง body.portfolioId ต่อตรงๆ) → เคสแรกแดงทันที
  //
  // ⚠️ portfolio.repository ถูก Automock ไว้ที่หัวไฟล์ → findByIdForUser คืน
  // undefined = "ไม่พบพอร์ตนี้ในบัญชีของ USER_A" ซึ่งตรงกับสถานการณ์ที่จำลอง
  // (พอร์ตของ B มีอยู่จริงในระบบ แต่ Query ที่ Scope ด้วย user_id ของ A หาไม่เจอ)
  test('⚠️ ผู้ใช้ A ส่ง portfolioId ของ B → 404 ปฏิเสธ ไม่ไหลลง Ledger เด็ดขาด', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, portfolioId: PORTFOLIO_OF_B }), res);

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('PORTFOLIO_NOT_FOUND');
    // ⭐ หัวใจเดิมของเทสต์นี้: ห้ามมีอะไรถูกเขียนลง Ledger ด้วยพอร์ตของคนอื่น
    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  // ปัดตกที่ Regex ก่อนยิง Query — ไม่ปล่อยค่าผิดรูปไปถึง Postgres (22P02 → 500)
  test('portfolioId ผิดรูปแบบ → 400 VALIDATION_ERROR ไม่ใช่ตีความเป็น null เงียบๆ', async () => {
    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, portfolioId: 'portfolio-of-b-0003' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  // ⚠️ ไม่ส่ง Key มาเลย = พฤติกรรมเดิมทุกประการ — ขอบเขตการค้นหาต้องยัง
  // undefined ("ไม่กรองพอร์ต") ไม่ใช่ null ("เจาะจงว่าไม่มีพอร์ต") ซึ่งหลัง
  // migration 044 จะหาอะไรไม่เจอเลย (ดู portfolioResolution.regression.test.js)
  test('ไม่ส่ง portfolioId มาเลย → ค้นข้ามพอร์ตของตัวเองตามเดิม (undefined)', async () => {
    const res = mockRes();
    await createTransaction(mockReq(BUY_BODY), res);

    expect(statusOf(res)).toBe(201);
    const [, , passedPortfolioId] = assetRepository.findAllByUserAndSymbol.mock.calls[0];
    expect(passedPortfolioId).toBeUndefined();
    expect(passedPortfolioId).not.toBe(PORTFOLIO_OF_B);
  });
});

describe('POST /transactions — คำขอกำกวมต้องตอบ 409 พร้อม candidates ไม่ใช่เดาให้', () => {
  test('⚠️ ถือ AAPL 2 โบรก + ไม่ระบุ brokerId → 409 AMBIGUOUS_ASSET_BROKER (ไม่บันทึกอะไรเลย)', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([
      { id: 'asset-a', userId: USER_A, symbol: 'AAPL', type: 'stock_us', brokerId: BROKER_OF_A },
      { id: 'asset-b', userId: USER_A, symbol: 'AAPL', type: 'stock_us', brokerId: null },
    ]);

    const res = mockRes();
    await createTransaction(mockReq(BUY_BODY), res);

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('AMBIGUOUS_ASSET_BROKER');
    // candidates ต้องพก assetId + brokerId ไปให้ Frontend สร้างตัวเลือกได้ทันที
    expect(jsonOf(res).details.candidates).toEqual([
      { assetId: 'asset-a', brokerId: BROKER_OF_A },
      { assetId: 'asset-b', brokerId: null },
    ]);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ถือ AAPL 2 โบรก + ระบุ brokerId ของตัวเอง → บันทึกเข้าแถวที่ถูกต้อง', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([
      { id: 'asset-a', userId: USER_A, symbol: 'AAPL', type: 'stock_us', brokerId: BROKER_OF_A },
      { id: 'asset-b', userId: USER_A, symbol: 'AAPL', type: 'stock_us', brokerId: null },
    ]);

    const res = mockRes();
    await createTransaction(mockReq({ ...BUY_BODY, brokerId: BROKER_OF_A }), res);

    expect(statusOf(res)).toBe(201);
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-a' })
    );
  });
});
