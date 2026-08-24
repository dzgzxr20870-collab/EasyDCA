// ═══════════════════════════════════════════════════════════════════════════
// Stage 6b (migration 047) — POST /api/v1/transactions/dividend (ชั้น HTTP)
// ═══════════════════════════════════════════════════════════════════════════
// เทสต์นี้เดินผ่าน Controller จริง → dividend.service จริง → Repository ที่ Mock
// (ไม่ Mock Service) เพื่อพิสูจน์ว่า "ทางเข้าจากเว็บ" ประกอบร่างครบจริง ไม่ใช่แค่
// Service ทำงานถูกแยกส่วน
//
// ── RED-GREEN (พิสูจน์แล้วว่าแดงจริงถ้าถอด Fix) ──────────────────────────────
//   • ถอดการตรวจ Prefix 'UNDO_OF:' ของ note ออกจาก createDividend
//     → describe 'note ที่สงวนไว้' แดง (= ช่องโหว่ปลอมรายการเป็น Reversal เปิดกลับมา)
//   • ถอดการตรวจ DATE_IN_FUTURE ออก → describe 'วันที่' แดง
//   • ถอด UUID_RE check ของ assetId ออก → เคส assetId ผิดรูปแดง (จะได้ 500 แทน 400)
//   • เปลี่ยน ERROR_STATUS.NOTHING_TO_RECEIVE_DIVIDEND จาก 403 เป็น 400 → แดง

jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const transactionService = require('../src/services/transaction.service');
const { createDividend } = require('../src/controllers/transactions.controller');

const USER_ID = 'user-uuid-1';
const USER_RECORD = { id: USER_ID, plan: 'free', planExpiresAt: null };
const ASSET_ID = '11111111-2222-4333-8444-555555555555';

const PTT = { id: ASSET_ID, userId: USER_ID, symbol: 'PTT', type: 'stock_th', brokerId: null };
const BUY_100 = {
  id: 'tx-1',
  type: 'buy',
  quantity: 100,
  amountThb: 3400,
  pricePerUnit: 34,
  date: '2026-01-01',
  currency: 'THB',
};

function mockReq(body = {}, userRecord = USER_RECORD) {
  return { user: { id: USER_ID }, userRecord, body };
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
  assetRepository.findByIds.mockResolvedValue([PTT]);
  transactionRepository.findAllByAsset.mockResolvedValue([BUY_100]);
  transactionRepository.create.mockImplementation(async (data) => ({
    id: 'tx-div-1',
    ...data,
    heldAfter: 100,
  }));
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /transactions/dividend — เส้นทางสำเร็จ', () => {
  test('บันทึกได้ → 201 พร้อมยอดถือที่ไม่เปลี่ยนแปลง', async () => {
    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 250, quantity: 100, date: '2026-02-01' }), res);

    expect(statusOf(res)).toBe(201);
    const body = jsonOf(res);
    expect(body.transaction).toMatchObject({
      type: 'dividend',
      symbol: 'PTT',
      amountTotal: 250,
      units: 100,
      dividendPerUnit: 2.5,
      date: '2026-02-01',
    });
    // ⭐ กฎข้อแรกของ Design Doc § 5.3 — ยอดถือไม่ขยับ
    expect(body.heldQuantity).toBe(100);
  });

  test('Free Plan บันทึกได้ ไม่มี Premium Gate (มติ Founder Q4.5)', async () => {
    const res = mockRes();
    await createDividend(
      mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100 }, { id: USER_ID, plan: 'free', planExpiresAt: null }),
      res
    );

    expect(statusOf(res)).toBe(201);
  });

  test('source ต้องเป็น "web" (มาจากฟอร์มเว็บ ไม่ใช่ LINE)', async () => {
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100 }), mockRes());

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'web', type: 'dividend' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /transactions/dividend — Validation ของ assetId/amountThb', () => {
  test.each([
    ['ไม่ส่งมาเลย', {}],
    ['ไม่ใช่ UUID', { assetId: 'not-a-uuid' }],
    ['เป็นตัวเลข', { assetId: 12345 }],
  ])('assetId %s → 400 VALIDATION_ERROR (ไม่ใช่ 500)', async (_label, patch) => {
    const res = mockRes();
    await createDividend(mockReq({ amountThb: 100, quantity: 100, ...patch }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test.each([
    ['ติดลบ', -50],
    ['ศูนย์', 0],
    ['ไม่ใช่ตัวเลข', 'abc'],
    ['ไม่ส่งมา', undefined],
  ])('amountThb %s → 400', async (_label, amountThb) => {
    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb, quantity: 100 }), res);

    expect(statusOf(res)).toBe(400);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  // ⭐ มติ Founder 24 ส.ค. 2569 — quantity เป็นค่าบังคับ (เดิม Optional แล้ว Service
  // เติมยอดถือ ณ วันนั้นให้เอง = Silent Default ซึ่งขัดกฎยืนข้อ 11)
  //
  // Red-Green: ถอด `if (quantity === null) return fail(...)` ที่ Controller ออก
  // (กลับไปเป็น hasQuantity ? ... : null) → เคสพวกนี้แดงทันที
  test.each([
    ['ไม่ส่งมาเลย', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
    ['ศูนย์', 0],
    ['ติดลบ', -10],
    ['ไม่ใช่ตัวเลข', 'abc'],
  ])('⚠️ quantity %s → 400 VALIDATION_ERROR { field: "quantity" } และไม่แตะ Ledger', async (_label, quantity) => {
    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(jsonOf(res).details).toMatchObject({ field: 'quantity' });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /transactions/dividend — วันที่', () => {
  test('วันอนาคต → 400 DATE_IN_FUTURE (ปันผลที่ยังไม่เกิดขึ้นห้ามเข้า Ledger)', async () => {
    const today = transactionService.todayInBangkok();
    const future = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;

    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100, date: future }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('DATE_IN_FUTURE');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('วันที่ไม่มีอยู่จริง (2026-02-31) → 400 VALIDATION_ERROR', async () => {
    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100, date: '2026-02-31' }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /transactions/dividend — note ที่สงวนไว้ (กันปลอมเป็น Reversal)', () => {
  // ช่องโหว่นี้ถูกปิดไว้แล้วที่ POST /transactions — ถ้าลืมปิดที่ Endpoint ใหม่
  // มันจะเปิดกลับมาทางนี้แทน (แถวปันผลที่ note ขึ้นต้น UNDO_OF: จะถูก isReversal()
  // นับเป็นรายการย้อน → ปุ่ม "ย้อนล่าสุด" ตอบ ALREADY_UNDONE ผิดๆ)
  test.each([
    ['ตัวพิมพ์ใหญ่', 'UNDO_OF:abc'],
    ['ตัวพิมพ์เล็ก', 'undo_of:abc'],
    ['มีช่องว่างนำหน้า', '  UNDO_OF:abc'],
  ])('note %s → 400 NOTE_RESERVED_PREFIX', async (_label, note) => {
    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100, note }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('NOTE_RESERVED_PREFIX');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('note ปกติ → บันทึกแบบ trim แล้ว', async () => {
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100, note: '  ปันผลงวด 2/2569  ' }), mockRes());

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'ปันผลงวด 2/2569' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /transactions/dividend — Error จาก Service ถูก Map เป็น Status ที่ถูก', () => {
  test('ไม่ถือสินทรัพย์ ณ วันนั้น → 403 NOTHING_TO_RECEIVE_DIVIDEND', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue([]);

    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100 }), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('NOTHING_TO_RECEIVE_DIVIDEND');
    // ข้อความต้องชี้ไปที่ "วันที่" ด้วย เพราะเป็นสาเหตุที่พบบ่อยที่สุด
    expect(jsonOf(res).message).toContain('วันที่');
  });

  test('assetId ของผู้ใช้คนอื่น → ASSET_NOT_FOUND (ไม่รั่วว่ามีอยู่จริงไหม)', async () => {
    assetRepository.findByIds.mockResolvedValue([]);

    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100 }), res);

    expect(jsonOf(res).error).toBe('ASSET_NOT_FOUND');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Error ที่ไม่รู้จักจาก Repository → 500 INTERNAL_ERROR (ไม่รั่ว Error ดิบ)', async () => {
    transactionRepository.create.mockRejectedValue(new Error('boom: connection reset'));

    const res = mockRes();
    await createDividend(mockReq({ assetId: ASSET_ID, amountThb: 100, quantity: 100 }), res);

    expect(statusOf(res)).toBe(500);
    expect(JSON.stringify(jsonOf(res))).not.toContain('connection reset');
  });
});
