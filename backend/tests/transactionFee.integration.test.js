// ═══════════════════════════════════════════════════════════════════════
// INTEGRATION — ค่าธรรมเนียมไหลถึงชั้นบันทึกครบทั้ง 2 ช่องทาง (Migration 041)
// ═══════════════════════════════════════════════════════════════════════
// Fixture = สลิป Dime! จริงที่ Founder ทดสอบแล้ว (EOSE / ASTS)
//
// ⚠️ สิ่งที่ต้องพิสูจน์ให้ได้ 3 อย่าง:
//   1) ค่าธรรมเนียมจากสลิปถึง params ที่ส่งเข้า transaction.service จริง
//   2) "ไม่รู้" ต้องเป็น null ตลอดสาย ไม่ถูกบีบเป็น 0 ที่จุดไหนเลย
//   3) เส้นทางกรอกเอง/พิมพ์คำสั่ง ต้องไม่ถดถอย
jest.mock('../src/services/transaction.service');
jest.mock('../src/services/dcaStats.service');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/services/symbolRegistry.service');

const transactionService = require('../src/services/transaction.service');
const dcaStatsService = require('../src/services/dcaStats.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const symbolRegistry = require('../src/services/symbolRegistry.service');
const controller = require('../src/controllers/transactions.controller');

const ASTS = { quantity: 20.0104114, pricePerUnit: 74.84, gross: 1497.6, fee: 2.4, net: 1500.0 };
const EOSE = { quantity: 25.0106, pricePerUnit: 4.25, gross: 106.44, fee: 0.27, net: 106.72 };

function mockReqRes(body) {
  const req = {
    body,
    user: { id: 'user-1' },
    userRecord: { id: 'user-1', plan: 'free', planExpiresAt: null },
    get: () => 'application/json',
  };
  const res = {
    statusCode: null, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return { req, res };
}
const sentParams = () => transactionService.processBuyCommand.mock.calls[0]?.[1];

describe('เว็บ: ค่าธรรมเนียมถูกส่งเข้าชั้นบันทึก', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    symbolRegistry.lookupType.mockReturnValue('stock_us');
    transactionService.processBuyCommand.mockResolvedValue({
      transactionId: 'tx-1', symbol: 'ASTS', quantity: ASTS.quantity,
      pricePerUnit: ASTS.pricePerUnit, amountThb: ASTS.gross, currency: 'USD',
      date: '2026-08-12', note: null, priceSource: 'user', newAssetCreated: false,
    });
    transactionRepository.findAllByUser.mockResolvedValue([]);
    dcaStatsService.getMonthSummary.mockReturnValue({ count: 1 });
  });

  it('ASTS: ส่ง feeThb = 2.40 ตามสลิป', async () => {
    const { req, res } = mockReqRes({
      symbol: 'ASTS', quantity: ASTS.quantity, pricePerUnit: ASTS.pricePerUnit,
      currency: 'USD', date: '2026-08-12', feeThb: ASTS.fee,
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    expect(sentParams().feeThb).toBe(2.4);
    // ตัวเลขหลักต้องยังตรงสลิปเหมือนเดิม (ไม่ถดถอยจาก fix รอบก่อน)
    expect(sentParams().quantity).toBe(ASTS.quantity);
    expect(sentParams().pricePerUnit).toBe(ASTS.pricePerUnit);
  });

  it('EOSE: ส่ง feeThb = 0.27 ตามสลิป', async () => {
    const { req, res } = mockReqRes({
      symbol: 'EOSE', quantity: EOSE.quantity, pricePerUnit: EOSE.pricePerUnit,
      currency: 'USD', feeThb: EOSE.fee,
    });

    await controller.createTransaction(req, res);
    expect(sentParams().feeThb).toBe(0.27);
  });

  // ⚠️ หัวใจของ migration 041: "ไม่รู้" ≠ "ไม่มี"
  it('ไม่ส่ง feeThb → ไม่มี Key นี้ใน params เลย (Service จะตั้ง null ไม่ใช่ 0)', async () => {
    const { req, res } = mockReqRes({
      symbol: 'ASTS', quantity: ASTS.quantity, pricePerUnit: ASTS.pricePerUnit, currency: 'USD',
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    expect('feeThb' in sentParams()).toBe(false);
  });

  it('ส่ง feeThb = 0 → ยอมรับ (ผู้ใช้ยืนยันว่าไม่มีค่าธรรมเนียม ต่างจากไม่รู้)', async () => {
    const { req, res } = mockReqRes({
      symbol: 'ASTS', quantity: ASTS.quantity, pricePerUnit: ASTS.pricePerUnit,
      currency: 'USD', feeThb: 0,
    });

    await controller.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    expect(sentParams().feeThb).toBe(0);
  });

  it('feeThb ติดลบ/ไม่ใช่ตัวเลข → VALIDATION_ERROR ไม่หลุดลง Ledger', async () => {
    for (const bad of [-1, 'abc']) {
      jest.clearAllMocks();
      const { req, res } = mockReqRes({
        symbol: 'ASTS', quantity: ASTS.quantity, pricePerUnit: ASTS.pricePerUnit,
        currency: 'USD', feeThb: bad,
      });
      await controller.createTransaction(req, res);
      expect(res.statusCode).toBe(400);
      expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REGRESSION — "ไม่รู้" ต้องเป็น null ตลอดสาย (ไม่ถูกบีบเป็น 0)
// ═══════════════════════════════════════════════════════════════════════
describe('REGRESSION: ค่า Default ของ feeThb ต้องเป็น null ไม่ใช่ 0', () => {
  it('transaction.service ตั้ง null เมื่อไม่ได้รับ feeThb', () => {
    // อ่าน Source ตรงๆ — ถ้ามีใครแก้กลับเป็น ?? 0 Test นี้จะแดงทันที
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/transaction.service.js'), 'utf8'
    );
    expect(src).not.toContain('feeThb: params.feeThb ?? 0');
    expect(src).toContain('feeThb: params.feeThb ?? null');
  });

  it('repository ส่ง null เข้า RPC เมื่อไม่รู้ค่าธรรมเนียม', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/repositories/transaction.repository.js'), 'utf8'
    );
    expect(src).not.toContain('p_fee_thb: data.feeThb ?? 0');
    expect(src).toContain('p_fee_thb: data.feeThb ?? null');
  });

  it('pendingTransaction ไม่บีบ null → 0 ตอน Confirm (LINE Preview→Confirm)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/pendingTransaction.service.js'), 'utf8'
    );
    expect(src).toContain('Number(pending.feeThb) : null');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 🔴 REGRESSION — P&L ต้องไม่ขยับแม้แต่บาทเดียว
// ═══════════════════════════════════════════════════════════════════════
// รายการเก่าทั้งหมดมี fee_thb = 0 และรายการใหม่จะมี NULL/ตัวเลขจริง — ถ้าวันใด
// มีคนเอา fee ไปใส่ในสูตรต้นทุน/กำไร ตัวเลขของผู้ใช้ทุกคนจะขยับทันทีแบบเทียบกับ
// ของเดิมไม่ได้ Test นี้เฝ้าไว้ว่า "ยังไม่มีใครทำแบบนั้น"
describe('P&L: ไม่มี Service คำนวณเงินตัวไหนแตะ fee เลย', () => {
  const MONEY_SERVICES = [
    'portfolio.service.js',
    'profit.service.js',
    'dcaStats.service.js',
    'portfolioSummary.service.js',
    'dashboardOverview.service.js',
  ];

  it.each(MONEY_SERVICES)('%s ไม่อ่าน fee_thb/feeThb', (file) => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/', file), 'utf8'
    );
    expect(src).not.toContain('feeThb');
    expect(src).not.toContain('fee_thb');
  });
});
