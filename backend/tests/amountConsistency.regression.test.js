// ═══════════════════════════════════════════════════════════════════════
// Regression — "ยอดที่บันทึกลง Ledger ต้องเท่ากับยอดที่ผู้ใช้เห็นตอนกดยืนยัน"
// ═══════════════════════════════════════════════════════════════════════
// บั๊ค A (เคสจริงบน Production): ผู้ใช้พิมพ์ "ซื้อ BTC 100" ในไลน์
//   การ์ด Preview (ก่อนกดยืนยัน) : 100 บาท
//   การ์ดยืนยัน (หลังกดยืนยัน)   : 100.01 บาท   ← ยอดที่ลง Ledger จริง
//   จำนวนหน่วย 0.00003979 · ราคาต่อหน่วย 2,513,380 (ค่าจริงจาก Production)
//
// ต้นตอ: pendingTransaction.toCommitParams ส่งต่อแค่ quantity + pricePerUnit
// ไม่ส่ง amountThb ที่ Snapshot ไว้ → resolveQuantityAndPrice เข้า Branch แรกแล้ว
// "คำนวณยอดใหม่" (0.00003979 × 2,513,380 = 100.0073… → 100.01) เศษที่หายไปตอนปัด
// quantity เหลือ 8 ตำแหน่ง ถูกคูณกลับขึ้นมาเป็น 1 สตางค์
//
// เทสต์นี้เป็น Integration จริงของเส้นทาง Preview→Confirm — ใช้ transaction.service
// และ pendingTransaction.service ตัวจริงทั้งคู่ (Mock เฉพาะ Repository/Price Feed)
// ต่างจาก pendingTransaction.service.test.js ที่ Mock transaction.service ทั้งก้อน
// จึงมองไม่เห็นบั๊กที่เกิดจาก "รอยต่อ" ระหว่างสอง Service นี้เลย
// ═══════════════════════════════════════════════════════════════════════

jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/pendingTransaction.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const pendingRepository = require('../src/repositories/pendingTransaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');

const { createPending, confirmPending } = require('../src/services/pendingTransaction.service');
const { COMMANDS } = require('../src/services/commandParser.service');

const USER_ID = 'user-uuid-1';
const PENDING_ID = 'pending-uuid-1';
const BTC_ASSET = { id: 'asset-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto' };

// ราคาจริงจาก Production ตอนเกิดบั๊ค — ราคาต่อหน่วยสูงมากคือเงื่อนไขที่ทำให้เศษ
// จากการปัด quantity 8 ตำแหน่ง คูณกลับขึ้นมาเป็นสตางค์ได้
const BTC_PRICE = 2513380;

beforeEach(() => {
  jest.clearAllMocks();

  assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_ASSET]);
  assetRepository.create.mockResolvedValue(BTC_ASSET);
  transactionRepository.create.mockResolvedValue({ id: 'tx-uuid-1' });
  transactionRepository.findAllByAsset.mockResolvedValue([]);

  priceFeedService.getCurrentPrice.mockResolvedValue(null);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-22', stale: false });

  // Pending Repository จำลอง: create เก็บค่าที่ Insert ไว้แล้วคืนกลับตอน claim
  // (เหมือน DB จริงที่ Confirm อ่านแถวเดิมกลับมา) — จุดสำคัญของเทสต์ชุดนี้คือ
  // "ค่าที่ถูก Snapshot ตอน Preview" ต้องเดินทางถึงตอนบันทึกจริงครบถ้วน
  let stored = null;
  pendingRepository.create.mockImplementation(async (data) => {
    stored = { id: PENDING_ID, status: 'pending', ...data };
    return stored;
  });
  pendingRepository.claimForConfirm.mockImplementation(async () => stored);
  pendingRepository.attachTransaction.mockResolvedValue(undefined);
});

// ยอดที่ถูกเขียนลงตาราง transactions จริง (Source of Truth ของ Ledger)
function ledgerAmount() {
  expect(transactionRepository.create).toHaveBeenCalledTimes(1);
  return transactionRepository.create.mock.calls[0][0].amountThb;
}

describe('บั๊ค A — Preview→Confirm: ยอดที่บันทึกต้องเท่ากับยอดที่ผู้ใช้เห็น', () => {
  test('เส้นทาง 1 "จำนวนเงินอย่างเดียว" — ซื้อ BTC 100 ต้องบันทึก 100 ไม่ใช่ 100.01', async () => {
    priceFeedService.getCurrentPrice.mockResolvedValue(BTC_PRICE);

    const parsed = {
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', amountThb: 100, type: 'crypto' },
    };

    const preview = await createPending(USER_ID, parsed, { plan: 'premium' });

    // การ์ด Preview แสดงยอดนี้ให้ผู้ใช้เห็นก่อนกดยืนยัน
    expect(preview.amountThb).toBe(100);
    // quantity ถูกปัดเหลือ 8 ตำแหน่งตาม NUMERIC(20,8) — เศษที่หายไปคือต้นตอของบั๊ค
    expect(preview.quantity).toBe(0.00003979);
    // พิสูจน์ว่าเงื่อนไขของบั๊กมีอยู่จริง: คูณกลับแล้วได้ 100.01 ไม่ใช่ 100
    expect(Math.round(preview.quantity * BTC_PRICE * 100) / 100).toBe(100.01);

    await confirmPending(PENDING_ID, USER_ID);

    // ── หัวใจของบั๊ค A ──
    expect(ledgerAmount()).toBe(100);
  });

  test('เส้นทาง 2 "จำนวนหน่วย + ราคาที่ผู้ใช้พิมพ์เอง" — ยังคำนวณยอดจาก quantity × price เหมือนเดิม', async () => {
    const parsed = {
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', quantity: 0.001, pricePerUnit: 2500000, type: 'crypto' },
    };

    const preview = await createPending(USER_ID, parsed, { plan: 'premium' });
    expect(preview.amountThb).toBe(2500);

    await confirmPending(PENDING_ID, USER_ID);

    expect(ledgerAmount()).toBe(2500);
    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
  });

  test('เส้นทาง 3 "สลิป (จำนวนหน่วย + ราคาจากสลิป)" — ยอดที่ Preview กับที่บันทึกตรงกันเป๊ะ', async () => {
    // เส้นทางสลิปที่เพิ่งแก้ไปรอบก่อน: ส่ง quantity + pricePerUnit จากสลิปตรงๆ
    // (ค่าจริงจากสลิป ASTS) ห้ามให้ยอดเพี้ยนระหว่าง Preview→Confirm
    const parsed = {
      command: COMMANDS.BUY,
      params: {
        symbol: 'ASTS',
        quantity: 20.0104114,
        pricePerUnit: 74.84,
        type: 'stock_us',
        currency: 'USD',
        slipToken: 'a'.repeat(32),
        feeThb: 2.4,
      },
    };
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([{
      id: 'asset-asts',
      userId: USER_ID,
      symbol: 'ASTS',
      type: 'stock_us',
    }]);

    const preview = await createPending(USER_ID, parsed, { plan: 'premium' });
    await confirmPending(PENDING_ID, USER_ID);

    expect(ledgerAmount()).toBe(preview.amountThb);
    // ค่าธรรมเนียมและสกุลเงินต้องรอดข้ามมาเหมือนเดิม (ไม่ถดถอยจากงานรอบก่อน)
    expect(transactionRepository.create.mock.calls[0][0]).toMatchObject({
      currency: 'USD',
      feeThb: 2.4,
      quantity: 20.0104114,
      pricePerUnit: 74.84,
    });
  });

  test('เส้นทาง 3b "ยอดจากสลิปที่พิสูจน์แล้ว" — ยอดที่ตกลงไว้ชนะการคูณกลับ', async () => {
    // เคส EOSE จริง: สลิประบุมูลค่าหุ้น 106.44 แต่ quantity × price (ที่ปัดมาแสดง)
    // = 106.32 — เมื่อยอดถูก Snapshot ไว้ตอน Preview ต้องบันทึกยอดนั้น ไม่ใช่คูณใหม่
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([{
      id: 'asset-eose',
      userId: USER_ID,
      symbol: 'EOSE',
      type: 'stock_us',
    }]);

    const parsed = {
      command: COMMANDS.BUY,
      params: {
        symbol: 'EOSE',
        quantity: 25.0164512,
        pricePerUnit: 4.25,
        amountThb: 106.44,
        type: 'stock_us',
        currency: 'USD',
      },
    };

    const preview = await createPending(USER_ID, parsed, { plan: 'premium' });
    expect(preview.amountThb).toBe(106.44);

    await confirmPending(PENDING_ID, USER_ID);
    expect(ledgerAmount()).toBe(106.44);
  });

  test('เส้นทาง 4 "ขาย (ระบุจำนวนหน่วย + ราคา)" — ยอด Preview กับที่บันทึกตรงกัน', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 1, currency: 'THB' },
    ]);

    const parsed = {
      command: COMMANDS.SELL,
      params: { symbol: 'BTC', quantity: 0.5, pricePerUnit: 2513380 },
    };

    const preview = await createPending(USER_ID, parsed);
    await confirmPending(PENDING_ID, USER_ID);

    expect(ledgerAmount()).toBe(preview.amountThb);
    expect(ledgerAmount()).toBe(1256690);
  });

  test('เส้นทาง 4b "ขายทั้งหมด" — ยอด Preview กับที่บันทึกตรงกัน (ไม่คำนวณยอดใหม่ตอน Confirm)', async () => {
    // ยอดคงเหลือที่มีเศษ 8 ตำแหน่ง × ราคาสูง = เงื่อนไขเดียวกับบั๊ค A
    transactionRepository.findAllByAsset.mockResolvedValue([
      { type: 'buy', quantity: 0.00003979, currency: 'THB' },
    ]);
    priceFeedService.getCurrentPrice.mockResolvedValue(BTC_PRICE);

    const parsed = {
      command: COMMANDS.SELL,
      params: { symbol: 'BTC', sellAll: true },
    };

    const preview = await createPending(USER_ID, parsed);
    await confirmPending(PENDING_ID, USER_ID);

    expect(ledgerAmount()).toBe(preview.amountThb);
  });
});

describe('resolveAgreedAmount — Guard กันยอดที่เชื่อไม่ได้ลง Ledger', () => {
  const { validateBuy } = require('../src/services/transaction.service');

  test('ยอดที่ตกลงไว้ห่างจาก quantity × price เกิน 2% → ไม่เชื่อ กลับไปคำนวณเอง', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { amounts } = await validateBuy(USER_ID, {
      symbol: 'BTC',
      quantity: 0.001,
      pricePerUnit: 2500000,
      amountThb: 9999, // เพี้ยนคนละเรื่องกับ 0.001 × 2,500,000 = 2,500
      type: 'crypto',
    });

    expect(amounts.amountThb).toBe(2500);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agreed amount rejected'));
    warn.mockRestore();
  });

  test('ยอดที่ตกลงไว้อยู่ในระยะที่อธิบายได้ด้วยการปัดเศษ → ใช้ยอดนั้น', async () => {
    const { amounts } = await validateBuy(USER_ID, {
      symbol: 'BTC',
      quantity: 0.00003979,
      pricePerUnit: BTC_PRICE,
      amountThb: 100,
      type: 'crypto',
    });

    expect(amounts.amountThb).toBe(100);
  });
});
