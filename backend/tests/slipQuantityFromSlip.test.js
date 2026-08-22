// ═══════════════════════════════════════════════════════════════════════
// บันทึกด้วย "ตัวเลขจากสลิป" ไม่ใช่ราคาตลาด ณ ตอนกดบันทึก
// ═══════════════════════════════════════════════════════════════════════
// เคสจริงที่เป็นต้นเหตุ: สลิป Dime! ASTS ลงวันที่ 12 ส.ค. (20.0104114 หุ้น @ 74.84
// USD) ถูกบันทึกวันที่ 22 ส.ค. → ระบบทิ้งทั้งจำนวนหุ้นและราคาจากสลิป แล้วไปดึง
// "ราคาตลาดวันที่ 22" มาหารยอดเงินใหม่ → จำนวนหุ้นและต้นทุนไม่ตรงสลิปเลย
// ยิ่งสลิปเก่ายิ่งเพี้ยนมาก และเป็น Immutable Ledger ที่แก้ได้ด้วย Reversal เท่านั้น
//
// สลิปคือหลักฐานของสิ่งที่เกิดขึ้นจริง — ราคาตลาดเป็นแค่ตัวประมาณสำหรับกรณีที่ไม่มี
// ข้อมูลจริง (มติ Founder)
jest.mock('../src/services/transaction.service');
jest.mock('../src/services/dcaStats.service');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/symbolRegistry.service');

const transactionService = require('../src/services/transaction.service');
const dcaStatsService = require('../src/services/dcaStats.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const symbolRegistry = require('../src/services/symbolRegistry.service');
const controller = require('../src/controllers/transactions.controller');

// เคสจริงจากสลิปของ Founder
const SLIP = { symbol: 'ASTS', quantity: 20.0104114, pricePerUnit: 74.84, currency: 'USD' };

function mockReqRes(body) {
  const req = {
    body,
    user: { id: 'user-1' },
    userRecord: { id: 'user-1', plan: 'free', planExpiresAt: null },
    get: () => 'application/json',
  };
  const res = {
    statusCode: null,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return { req, res };
}

// จับ params ที่ถูกส่งเข้า transaction.service — นี่คือสิ่งที่ตัดสินว่าจะบันทึกอะไรลง Ledger
function paramsSentToService() {
  return transactionService.processBuyCommand.mock.calls[0]?.[1];
}

describe('ซื้อจากสลิป: ส่งจำนวนหน่วย + ราคาจริงเข้า Service (ไม่แตะ Price Feed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    symbolRegistry.lookupType.mockReturnValue('stock_us');
    transactionService.processBuyCommand.mockResolvedValue({
      transactionId: 'tx-1', symbol: 'ASTS', quantity: SLIP.quantity,
      pricePerUnit: SLIP.pricePerUnit, amountThb: 1497.58, currency: 'USD',
      date: '2026-08-12', note: null, priceSource: 'user', newAssetCreated: false,
    });
    transactionRepository.findAllByUser.mockResolvedValue([]);
    dcaStatsService.getMonthSummary.mockReturnValue({ count: 1 });
  });

  // ⚠️ Test หลักของ Fix นี้ — ถอด Fix ออก (ให้ตกไป deriveQuantityFromAmount)
  // แล้วต้องแดงทันที (พิสูจน์ Red-Green แล้ว ดูรายงาน)
  it('quantity + pricePerUnit ถูกส่งเข้า Service ตรงๆ ตามที่สลิประบุ', async () => {
    const { req, res } = mockReqRes({
      symbol: SLIP.symbol,
      quantity: SLIP.quantity,
      pricePerUnit: SLIP.pricePerUnit,
      currency: 'USD',
      date: '2026-08-12',
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    const params = paramsSentToService();
    // ตัวเลขต้องตรงสลิปเป๊ะ ไม่ถูกคำนวณใหม่
    expect(params.quantity).toBe(20.0104114);
    expect(params.pricePerUnit).toBe(74.84);
    // ต้องไม่ส่ง amountThb ไปด้วย — ถ้าส่ง Service จะเข้า Branch ที่ดึงราคาตลาด
    expect(params.amountThb).toBeUndefined();
  });

  it('ไม่เรียก deriveQuantityFromAmount เลย (ไม่คำนวณจำนวนหน่วยใหม่จากยอดเงิน)', async () => {
    const { req, res } = mockReqRes({
      symbol: SLIP.symbol,
      quantity: SLIP.quantity,
      pricePerUnit: SLIP.pricePerUnit,
      currency: 'USD',
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    expect(transactionService.deriveQuantityFromAmount).not.toHaveBeenCalled();
  });

  it('ไม่ต้องส่ง amountTotal มาก็บันทึกได้ (ยอดรวมคำนวณจาก จำนวน × ราคา)', async () => {
    const { req, res } = mockReqRes({
      symbol: SLIP.symbol,
      quantity: SLIP.quantity,
      pricePerUnit: SLIP.pricePerUnit,
      currency: 'USD',
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
  });

  it('หุ้นไทยจากสลิป (มี qty+price ครบ) ก็ใช้ตัวเลขจากสลิปเช่นกัน', async () => {
    symbolRegistry.lookupType.mockReturnValue('stock_th');
    const { req, res } = mockReqRes({
      symbol: 'PTT', quantity: 50, pricePerUnit: 34.25, date: '2026-08-01',
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    const params = paramsSentToService();
    expect(params.quantity).toBe(50);
    expect(params.pricePerUnit).toBe(34.25);
    expect(transactionService.deriveQuantityFromAmount).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REGRESSION — เส้นทางเดิมต้องไม่ถดถอย
// ═══════════════════════════════════════════════════════════════════════
describe('REGRESSION: เส้นทางกรอกเอง (ไม่ได้มาจากสลิป) ต้องเหมือนเดิมเป๊ะ', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    symbolRegistry.lookupType.mockReturnValue('stock_us');
    transactionService.processBuyCommand.mockResolvedValue({
      transactionId: 'tx-2', symbol: 'AAPL', quantity: 1, pricePerUnit: 1000,
      amountThb: 1000, currency: 'THB', date: '2026-08-22', note: null,
      priceSource: 'market', newAssetCreated: false,
    });
    transactionRepository.findAllByUser.mockResolvedValue([]);
    dcaStatsService.getMonthSummary.mockReturnValue({ count: 1 });
  });

  // นี่คือคุณค่าหลักที่ผู้ใช้ไม่ต้องกรอกราคาเอง — ห้ามพัง
  it('ส่งแค่ amountTotal → ยังใช้ราคาตลาดคำนวณให้เหมือนเดิม (amountThb ถูกส่งเข้า Service)', async () => {
    const { req, res } = mockReqRes({ symbol: 'AAPL', amountTotal: 1000 });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    const params = paramsSentToService();
    expect(params.amountThb).toBe(1000);
    expect(params.quantity).toBeUndefined();
    expect(params.pricePerUnit).toBeUndefined();
  });

  it('หุ้นไทยกรอกเอง (amountTotal + pricePerUnit ไม่มี quantity) → ยังหารเป็นจำนวนหน่วยเหมือนเดิม', async () => {
    symbolRegistry.lookupType.mockReturnValue('stock_th');
    transactionService.deriveQuantityFromAmount.mockReturnValue(50);

    const { req, res } = mockReqRes({ symbol: 'PTT', amountTotal: 1700, pricePerUnit: 34 });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    // เส้นทางเดิมต้องยังเรียก deriveQuantityFromAmount อยู่
    expect(transactionService.deriveQuantityFromAmount).toHaveBeenCalledWith(1700, 34);
    const params = paramsSentToService();
    expect(params.quantity).toBe(50);
    expect(params.pricePerUnit).toBe(34);
  });

  it('ไม่ส่งทั้ง amountTotal และ quantity → ยัง VALIDATION_ERROR เหมือนเดิม', async () => {
    const { req, res } = mockReqRes({ symbol: 'AAPL' });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe('VALIDATION_ERROR');
  });

  it('หุ้นไทยที่ไม่มีทั้งราคาและจำนวน → ยังตอบ PRICE_REQUIRED_FOR_ASSET เหมือนเดิม', async () => {
    symbolRegistry.lookupType.mockReturnValue('stock_th');
    const { req, res } = mockReqRes({ symbol: 'PTT', amountTotal: 1700 });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe('PRICE_REQUIRED_FOR_ASSET');
  });
});

describe('Validation ของ quantity ฝั่งซื้อ', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    symbolRegistry.lookupType.mockReturnValue('stock_us');
    transactionRepository.findAllByUser.mockResolvedValue([]);
    dcaStatsService.getMonthSummary.mockReturnValue({ count: 0 });
  });

  it('ส่ง quantity แต่ไม่ส่งราคา → VALIDATION_ERROR (ระบุครึ่งเดียวประกอบไม่ได้)', async () => {
    const { req, res } = mockReqRes({ symbol: 'ASTS', quantity: 20, amountTotal: 1497 });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe('VALIDATION_ERROR');
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 0],
    ['ติดลบ', -5],
    ['ไม่ใช่ตัวเลข', 'abc'],
  ])('quantity = %s → VALIDATION_ERROR ไม่หลุดลง Ledger', async (_label, quantity) => {
    const { req, res } = mockReqRes({
      symbol: 'ASTS', quantity, pricePerUnit: 74.84, amountTotal: 1497,
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(400);
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
  });
});
