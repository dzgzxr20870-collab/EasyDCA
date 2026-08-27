// ═══════════════════════════════════════════════════════════════════════════
// Stage 6b (migration 047) — ย้อนรายการปันผล ครบวง (Regression)
// ═══════════════════════════════════════════════════════════════════════════
// Stage 6a พิสูจน์ไปแล้วว่า "สูตรเงิน" รองรับ dividend ถูกต้อง (dividendLedger.
// regression.test.js) — ไฟล์นี้พิสูจน์ **เส้นทางจริงของการกดปุ่ม "ย้อนล่าสุด"**
// ตั้งแต่ undoTransaction.service ไปจนถึงการ์ดที่ผู้ใช้เห็นบน LINE
//
// ── บั๊กที่ไฟล์นี้เฝ้าอยู่ (ทั้งคู่ "ผิดแล้วผู้ใช้ไม่มีทางรู้ตัว") ─────────────────
//   [1] ย้อนปันผลแล้วได้แถว 'buy' — เพิ่มจำนวนที่ถือและต้นทุนจากอากาศ
//       (จุดที่ 7 ของ Design Doc § 2 · แก้ที่ undoTransaction.service:123 ใน Stage 6a)
//   [2] ⭐ การ์ด LINE เขียนว่า "ก่อนบันทึกรายการ**ขาย**นี้" ตอนย้อนปันผล
//       (จุดที่ 8 — จุดที่ทั้ง Design Doc และ Stage 6a มองข้าม เพิ่งแก้ใน Stage 6b
//        ที่ flexMessage.util.buildUndoMessage) และข้อความยังผิดข้อเท็จจริงซ้ำอีกชั้น
//        เพราะบอกว่า "ยอดในพอร์ตกลับไปเป็นเหมือนเดิม" ทั้งที่ยอดไม่เคยขยับเลย
//
// ── RED-GREEN (พิสูจน์แล้วว่าแดงจริงถ้าถอด Fix) ──────────────────────────────
//   • เปลี่ยน reversalTypeFor('dividend') กลับเป็น 'buy' (หรือใช้ ternary เดิม
//     `latest.type === 'buy' ? 'sell' : 'buy'`) → describe [1] แดง
//   • เปลี่ยน buildUndoMessage กลับเป็น `wasBuy ? 'ซื้อ' : 'ขาย'` → describe [2] แดง
//   • ถอด `isDividend` ที่ซ่อนบรรทัด "จำนวน:" ออก → เคส "ห้ามโชว์จำนวนที่ถูกย้อน" แดง

jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');

const {
  undoLastTransaction,
  buildReversalNote,
  isReversal,
} = require('../src/services/undoTransaction.service');
const { calculateHeldQuantity } = require('../src/services/transaction.service');
const { calculateTotalDividend } = require('../src/services/dividend.service');
const { calculateTotalInvested } = require('../src/services/portfolio.service');
const { buildUndoMessage } = require('../src/utils/flexMessage.util');

const USER_ID = 'user-uuid-1';
const ASSET = { id: 'asset-uuid-1', userId: USER_ID, symbol: 'PTT', type: 'stock_th' };

const BUY_100 = {
  id: 'tx-buy',
  userId: USER_ID,
  assetId: ASSET.id,
  type: 'buy',
  amountThb: 3400,
  pricePerUnit: 34,
  quantity: 100,
  currency: 'THB',
  date: '2026-01-01',
  note: null,
};

// ⚠️ quantity ของแถวปันผล = จำนวนหน่วยที่ได้ปันผลนี้ (บริบท) ตั้งไว้เท่ากับจำนวนที่
// ถืออยู่พอดี **โดยตั้งใจ** — ถ้าโค้ดจุดไหนเผลอตีความเป็น buy/sell ยอดถือจะกระโดด
// เป็น 200 หรือ 0 ทันที ซึ่งเห็นชัดกว่าใช้ตัวเลขสุ่ม
const DIVIDEND = {
  id: 'tx-div',
  userId: USER_ID,
  assetId: ASSET.id,
  type: 'dividend',
  amountThb: 250,
  pricePerUnit: 2.5,
  quantity: 100,
  currency: 'THB',
  date: '2026-02-01',
  note: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  assetRepository.findByIds.mockResolvedValue([ASSET]);
  transactionRepository.create.mockImplementation(async (data) => ({ id: 'tx-reversal', ...data }));
});

// ═══════════════════════════════════════════════════════════════════════════
describe('[1] ย้อนปันผล → ต้องได้ dividend_reversal ไม่ใช่ buy', () => {
  beforeEach(() => {
    transactionRepository.findRecentByUser.mockResolvedValue([DIVIDEND]);
    transactionRepository.findAllByAsset.mockResolvedValue([BUY_100, DIVIDEND]);
  });

  test('⭐ แถวหักล้างต้องเป็น dividend_reversal (buy = เพิ่มหุ้น+ต้นทุนจากอากาศ)', async () => {
    const result = await undoLastTransaction(USER_ID);

    expect(result.reversalType).toBe('dividend_reversal');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dividend_reversal',
        assetId: ASSET.id,
        amountThb: 250,
        quantity: 100,
        note: buildReversalNote(DIVIDEND.id),
      })
    );
  });

  test('Immutable Ledger — ห้ามลบ/แก้แถวเดิม สร้างแถวใหม่อย่างเดียว', async () => {
    await undoLastTransaction(USER_ID);

    expect(transactionRepository.delete).not.toBeDefined();
    expect(transactionRepository.create).toHaveBeenCalledTimes(1);
    expect(isReversal(transactionRepository.create.mock.calls[0][0])).toBe(true);
  });

  test('สกุลเงินของแถวหักล้างต้องตรงกับต้นฉบับ (ไม่ปล่อย Default THB)', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([{ ...DIVIDEND, currency: 'USD' }]);

    await undoLastTransaction(USER_ID);

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD' })
    );
  });

  test('ย้อนปันผลต้องไม่ถูก Guard "ยอดคงเหลือไม่พอ" บล็อก (ไม่ได้ลดยอดถืออยู่แล้ว)', async () => {
    // ยอดถือ 100 · quantity ของปันผลก็ 100 — ถ้า reversalType เพี้ยนเป็น 'sell'
    // Guard CANNOT_UNDO_QUANTITY_MISMATCH จะทำงานผิดจังหวะ เคสนี้ดักไว้
    await expect(undoLastTransaction(USER_ID)).resolves.toMatchObject({
      reversalType: 'dividend_reversal',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('[1ก] ตัวเลขหลังย้อน ต้องกลับไปเท่าก่อนบันทึกปันผลเป๊ะ', () => {
  const REVERSAL = {
    id: 'tx-rev',
    type: 'dividend_reversal',
    amountThb: 250,
    pricePerUnit: 2.5,
    quantity: 100,
    date: '2026-03-01',
    note: buildReversalNote(DIVIDEND.id),
  };

  test('ยอดถือ: 100 → 100 → 100 (ปันผลและการย้อนไม่เคยแตะเลย)', () => {
    expect(calculateHeldQuantity([BUY_100])).toBe(100);
    expect(calculateHeldQuantity([BUY_100, DIVIDEND])).toBe(100);
    expect(calculateHeldQuantity([BUY_100, DIVIDEND, REVERSAL])).toBe(100);
  });

  test('ต้นทุน/กำไรที่รับรู้: ไม่ขยับทั้งตอนรับปันผลและตอนย้อน', () => {
    const before = calculateTotalInvested([BUY_100]);
    const afterDividend = calculateTotalInvested([BUY_100, DIVIDEND]);
    const afterUndo = calculateTotalInvested([BUY_100, DIVIDEND, REVERSAL]);

    expect(afterDividend).toEqual(before);
    expect(afterUndo).toEqual(before);
    expect(before.totalInvested).toBe(3400);
    expect(before.realizedPnL).toBe(0);
  });

  test('⭐ ยอดปันผลสะสม: 0 → 250 → 0 (สิ่งเดียวที่ควรขยับ)', () => {
    expect(calculateTotalDividend([BUY_100])).toBe(0);
    expect(calculateTotalDividend([BUY_100, DIVIDEND])).toBe(250);
    expect(calculateTotalDividend([BUY_100, DIVIDEND, REVERSAL])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('[2] การ์ด LINE ตอนย้อนปันผล ต้องไม่โกหกผู้ใช้', () => {
  function textOf(message) {
    return JSON.stringify(message);
  }

  const DIVIDEND_RESULT = {
    originalType: 'dividend',
    reversalType: 'dividend_reversal',
    symbol: 'PTT',
    quantity: 100,
    pricePerUnit: 2.5,
    amountThb: 250,
  };

  test('⭐ ห้ามมีคำว่า "รายการขาย" บนการ์ดย้อนปันผล (บั๊กจุดที่ 8)', () => {
    const card = textOf(buildUndoMessage(DIVIDEND_RESULT));

    expect(card).not.toContain('รายการขาย');
    expect(card).toContain('ปันผล');
  });

  test('ต้องบอกว่าสิ่งที่กลับไปเป็นเหมือนเดิมคือ "เงินปันผลสะสม" ไม่ใช่ยอดในพอร์ต', () => {
    const card = textOf(buildUndoMessage(DIVIDEND_RESULT));

    expect(card).toContain('เงินปันผลสะสม');
    expect(card).toContain('ไม่เปลี่ยนแปลง');
  });

  test('ห้ามโชว์บรรทัด "จำนวน:" (อ่านเป็น "ถูกหักออกจากพอร์ตเท่านี้" ซึ่งไม่จริง)', () => {
    const card = textOf(buildUndoMessage(DIVIDEND_RESULT));

    expect(card).not.toContain('จำนวน:');
  });

  test('ยอดเงินต้องใช้คำว่า "เงินปันผลที่ย้อน" ไม่ใช่ "มูลค่ารวม"', () => {
    const card = textOf(buildUndoMessage(DIVIDEND_RESULT));

    expect(card).toContain('เงินปันผลที่ย้อน');
    expect(card).not.toContain('มูลค่ารวม');
  });

  // ── การ์ดของ buy/sell ต้องไม่เปลี่ยนแม้แต่ตัวอักษรเดียว ───────────────────
  test.each([
    ['buy', 'ซื้อ'],
    ['sell', 'ขาย'],
  ])('การ์ดของ %s ยังเหมือนเดิมทุกประการ', (originalType, label) => {
    const card = textOf(
      buildUndoMessage({ originalType, symbol: 'BTC', quantity: 0.5, amountThb: 1000 })
    );

    expect(card).toContain(`ก่อนบันทึกรายการ${label}นี้`);
    expect(card).toContain('จำนวน:');
    expect(card).toContain('มูลค่ารวม');
    expect(card).not.toContain('เงินปันผล');
  });

  test('type ที่ไม่รู้จักต้อง throw ไม่ใช่แสดงป้ายมั่ว', () => {
    expect(() => buildUndoMessage({ originalType: 'stock_dividend', symbol: 'PTT' })).toThrow(
      /stock_dividend/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('[3] Double-Undo guard ยังทำงานกับปันผล', () => {
  test('รายการล่าสุดเป็น dividend_reversal อยู่แล้ว → ALREADY_UNDONE (ห้ามย้อนของย้อน)', async () => {
    const reversal = {
      ...DIVIDEND,
      id: 'tx-rev',
      type: 'dividend_reversal',
      note: buildReversalNote(DIVIDEND.id),
    };
    transactionRepository.findRecentByUser.mockResolvedValue([reversal]);
    transactionRepository.findAllByAsset.mockResolvedValue([BUY_100, DIVIDEND, reversal]);

    await expect(undoLastTransaction(USER_ID)).rejects.toMatchObject({ code: 'ALREADY_UNDONE' });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('ปันผลที่ถูกย้อนไปแล้ว (Reversal ไม่ได้อยู่บนสุดเพราะ date เท่ากัน) → ALREADY_UNDONE', async () => {
    const reversal = {
      ...DIVIDEND,
      id: 'tx-rev',
      type: 'dividend_reversal',
      note: buildReversalNote(DIVIDEND.id),
    };
    transactionRepository.findRecentByUser.mockResolvedValue([DIVIDEND]);
    transactionRepository.findAllByAsset.mockResolvedValue([BUY_100, DIVIDEND, reversal]);

    await expect(undoLastTransaction(USER_ID)).rejects.toMatchObject({ code: 'ALREADY_UNDONE' });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});
