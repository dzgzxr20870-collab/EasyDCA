// ═══════════════════════════════════════════════════════════════════════════
// Stage 6b (migration 047) — dividend.service: บันทึกเงินปันผลรับ
// ═══════════════════════════════════════════════════════════════════════════
// ครอบกฎการคำนวณของ Design Doc § 5.3 ที่ "ผิดแล้วเงินเพี้ยนเงียบๆ":
//   heldQty ไม่เปลี่ยน · costBasis ไม่เปลี่ยน · realizedPnL ไม่รวม · totalDividend +amount
//
// และกับดักเฉพาะของ Stage 6b ที่ Design Doc เขียนไว้ไม่ครบ:
//   - CHECK ของ transactions บังคับ quantity > 0 และ price_per_unit > 0 อยู่แล้ว
//     จึงต้องเก็บค่าที่ "มีความหมายจริง" (จำนวนหน่วยที่ถือ ณ วันนั้น + DPS)
//     ไม่ใช่ผ่อน CHECK (เหตุผลเต็มอยู่หัวไฟล์ migration 047)
//   - ยอดถือต้องคิด ณ "วันที่ได้ปันผล" ไม่ใช่วันนี้ (บันทึกย้อนหลังคือ Use Case ปกติ)
//
// ── RED-GREEN (พิสูจน์แล้วว่าเทสต์ชุดนี้ "แดงจริง" ถ้าถอด Fix ออก) ──────────────
//   • เปลี่ยน heldQuantityAsOf ให้ไม่กรองวันที่ (ใช้ calculateHeldQuantity ทั้งชุด)
//     → describe 'ยอดถือคิด ณ วันที่ได้ปันผล' แดง
//   • ถอดเงื่อนไข `if (heldAtDate <= 0) throw NOTHING_TO_RECEIVE_DIVIDEND` ออก
//     → describe 'ไม่ถือสินทรัพย์ ณ วันนั้น' แดง
//   • เปลี่ยนการเช็คจาก heldAtDate เป็น quantity ที่ผู้ใช้กรอก
//     → เคส 'กรอก quantity เองก็ยังข้ามด่านไม่ได้' แดง
//   • Hardcode currency: 'THB' → เคส Multi-Currency แดง
//   • ถอด assetRepository.findByIds (ข้าม Ownership) → describe 'Cross-User' แดง

jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');

const {
  recordDividend,
  calculateTotalDividend,
  heldQuantityAsOf,
  DividendServiceError,
} = require('../src/services/dividend.service');

const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';
const ASSET_ID = '11111111-2222-4333-8444-555555555555';

const PTT = { id: ASSET_ID, userId: USER_ID, symbol: 'PTT', type: 'stock_th', brokerId: null };

// ประวัติ: ซื้อ 100 หุ้นวันที่ 1 ม.ค. · ขายหมดวันที่ 20 มี.ค.
const HISTORY_BOUGHT_THEN_SOLD = [
  { id: 'tx-1', type: 'buy', quantity: 100, amountThb: 3400, pricePerUnit: 34, date: '2026-01-01', currency: 'THB' },
  { id: 'tx-2', type: 'sell', quantity: 100, amountThb: 3600, pricePerUnit: 36, date: '2026-03-20', currency: 'THB' },
];

beforeEach(() => {
  jest.clearAllMocks();
  assetRepository.findByIds.mockResolvedValue([PTT]);
  transactionRepository.findAllByAsset.mockResolvedValue([HISTORY_BOUGHT_THEN_SOLD[0]]);
  // heldAfter มาจาก RPC จริง (migration 047) — จำลองว่า DB ตอบ "ยอดถือเท่าเดิม"
  transactionRepository.create.mockImplementation(async (data) => ({
    id: 'tx-div-1',
    ...data,
    heldAfter: 100,
  }));
});

// ═══════════════════════════════════════════════════════════════════════════
describe('heldQuantityAsOf — ยอดถือคิด ณ วันที่ได้ปันผล ไม่ใช่วันนี้', () => {
  // นี่คือเคสที่พังทันทีถ้าใช้ยอดถือ "วันนี้": ได้ปันผล 10 มี.ค. → ขายหมด 20 มี.ค.
  // → มาบันทึกย้อนหลัง 25 มี.ค. ซึ่งเป็นลำดับเหตุการณ์ปกติมากของผู้ใช้จริง
  test('ขายหมดไปแล้ว แต่ ณ วันที่ได้ปันผลยังถืออยู่ → ต้องได้ยอดถือของวันนั้น', () => {
    expect(heldQuantityAsOf(HISTORY_BOUGHT_THEN_SOLD, '2026-03-10')).toBe(100);
  });

  test('หลังวันที่ขายหมดแล้ว → 0', () => {
    expect(heldQuantityAsOf(HISTORY_BOUGHT_THEN_SOLD, '2026-03-25')).toBe(0);
  });

  test('ก่อนวันที่ซื้อครั้งแรก → 0', () => {
    expect(heldQuantityAsOf(HISTORY_BOUGHT_THEN_SOLD, '2025-12-31')).toBe(0);
  });

  test('วันเดียวกับที่ซื้อ ต้องนับรวมด้วย (ซื้อวัน XD ก็ได้ปันผลงวดนั้น)', () => {
    expect(heldQuantityAsOf(HISTORY_BOUGHT_THEN_SOLD, '2026-01-01')).toBe(100);
  });

  test('แถว dividend ในประวัติต้องไม่ทำให้ยอดถือขยับแม้แต่หน่วยเดียว', () => {
    const withDividend = [
      HISTORY_BOUGHT_THEN_SOLD[0],
      // quantity = 100 เท่าจำนวนที่ถือ — ถ้าโค้ดไหนเผลอตีความเป็น sell ยอดจะเหลือ 0
      { id: 'tx-d', type: 'dividend', quantity: 100, amountThb: 250, pricePerUnit: 2.5, date: '2026-02-01' },
    ];
    expect(heldQuantityAsOf(withDividend, '2026-02-28')).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('calculateTotalDividend — ยอดปันผลสะสม', () => {
  test('รวมเฉพาะ dividend และหัก dividend_reversal ออก (buy/sell ไม่นับ)', () => {
    const txs = [
      { type: 'buy', amountThb: 3400 },
      { type: 'sell', amountThb: 3600 },
      { type: 'dividend', amountThb: 250 },
      { type: 'dividend', amountThb: 150.5 },
      { type: 'dividend_reversal', amountThb: 150.5 },
    ];
    expect(calculateTotalDividend(txs)).toBe(250);
  });

  test('ไม่มีปันผลเลย → 0 (ไม่ใช่ NaN)', () => {
    expect(calculateTotalDividend([{ type: 'buy', amountThb: 100 }])).toBe(0);
  });

  test('type ที่ระบบไม่รู้จัก ต้อง throw ไม่ใช่นับเป็น 0 เงียบๆ', () => {
    expect(() => calculateTotalDividend([{ type: 'stock_dividend', amountThb: 100 }])).toThrow(
      /stock_dividend/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('recordDividend — บันทึกลง Ledger', () => {
  test('เขียนแถว type=dividend พร้อม quantity = ยอดถือ ณ วันนั้น และ DPS ที่คำนวณได้', async () => {
    const result = await recordDividend(USER_ID, {
      assetId: ASSET_ID,
      amountThb: 250,
      date: '2026-02-01',
    });

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        assetId: ASSET_ID,
        type: 'dividend',
        amountThb: 250,
        quantity: 100,
        pricePerUnit: 2.5, // 250 / 100 = ปันผลต่อหน่วย
        date: '2026-02-01',
        // migration 041: NULL = "ไม่รู้" ไม่ใช่ 0 (ปันผลรับไม่มีค่าธรรมเนียมฝั่งเรา)
        feeThb: null,
      })
    );
    expect(result.dividendPerUnit).toBe(2.5);
    // ⭐ หัวใจของ Stage 6b — ยอดถือต้องเท่าเดิมเป๊ะ
    expect(result.heldQuantity).toBe(100);
  });

  test('ผู้ใช้กรอก quantity เอง (ต่างจากที่ระบบรู้) → ใช้ค่าที่กรอก + DPS ตามนั้น', async () => {
    await recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 250, quantity: 50, date: '2026-02-01' });

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 50, pricePerUnit: 5 })
    );
  });

  test('ไม่ระบุวันที่ → ใช้วันนี้ตาม Asia/Bangkok (ไม่ใช่ undefined)', async () => {
    await recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 100 });

    const call = transactionRepository.create.mock.calls[0][0];
    expect(call.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('สินทรัพย์สกุล USD → แถวปันผลต้องเป็น USD ด้วย (ห้าม Hardcode THB)', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-1', type: 'buy', quantity: 10, amountThb: 1000, pricePerUnit: 100, date: '2026-01-01', currency: 'USD' },
    ]);

    await recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 5, date: '2026-02-01' });

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD' })
    );
  });

  test('ปันผลก้อนเล็กมาก / หน่วยเยอะมาก → DPS ต้องไม่ถูกปัดเป็น 0 (จะชน CHECK > 0)', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-1', type: 'buy', quantity: 1000000000, amountThb: 1000, pricePerUnit: 0.000001, date: '2026-01-01' },
    ]);

    await recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 0.01, date: '2026-02-01' });

    const call = transactionRepository.create.mock.calls[0][0];
    expect(call.pricePerUnit).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('recordDividend — ไม่ถือสินทรัพย์ ณ วันนั้น ต้องปฏิเสธ', () => {
  test('ขายหมดไปก่อนวันที่ระบุ → 403 NOTHING_TO_RECEIVE_DIVIDEND', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(HISTORY_BOUGHT_THEN_SOLD);

    await expect(
      recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 250, date: '2026-03-25' })
    ).rejects.toMatchObject({ code: 'NOTHING_TO_RECEIVE_DIVIDEND' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('กรอก quantity มาเอง ก็ยังข้ามด่านนี้ไม่ได้ (เช็คจากยอดถือจริงเสมอ)', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue(HISTORY_BOUGHT_THEN_SOLD);

    await expect(
      recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 250, quantity: 999, date: '2026-03-25' })
    ).rejects.toMatchObject({ code: 'NOTHING_TO_RECEIVE_DIVIDEND' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ยังไม่เคยมีธุรกรรมเลย → ปฏิเสธ ไม่ใช่บันทึกด้วย quantity = 0', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue([]);

    await expect(
      recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 250, date: '2026-02-01' })
    ).rejects.toMatchObject({ code: 'NOTHING_TO_RECEIVE_DIVIDEND' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('recordDividend — Cross-User Isolation (กฎเหล็กข้อ 3)', () => {
  test('assetId ของผู้ใช้คนอื่น → ASSET_NOT_FOUND และห้ามแตะ Ledger เลย', async () => {
    // queryForUser บังคับ .eq('user_id', userId) → asset ของคนอื่นคืน [] เสมอ
    assetRepository.findByIds.mockResolvedValue([]);

    await expect(
      recordDividend(OTHER_USER_ID, { assetId: ASSET_ID, amountThb: 250 })
    ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ต้องยืนยันเจ้าของผ่าน findByIds ที่ผูก userId เสมอ (ไม่ใช่ Query ดิบ)', async () => {
    await recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 100 });

    expect(assetRepository.findByIds).toHaveBeenCalledWith([ASSET_ID], USER_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('recordDividend — Validation', () => {
  test.each([
    ['ติดลบ', -100],
    ['ศูนย์', 0],
    ['ไม่ใช่ตัวเลข', 'abc'],
  ])('amountThb %s → VALIDATION_ERROR', async (_label, amountThb) => {
    await expect(recordDividend(USER_ID, { assetId: ASSET_ID, amountThb })).rejects.toBeInstanceOf(
      DividendServiceError
    );
  });

  test('quantity ที่ส่งมาเป็น 0 → VALIDATION_ERROR (ไม่ใช่เงียบๆ เติมยอดถือให้)', async () => {
    await expect(
      recordDividend(USER_ID, { assetId: ASSET_ID, amountThb: 100, quantity: 0 })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
