jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const {
  undoLastTransaction,
  buildReversalNote,
  UndoTransactionError,
} = require('../src/services/undoTransaction.service');

const USER_ID = 'user-uuid-1';
const ASSET = { id: 'asset-uuid-1', userId: USER_ID, symbol: 'BTC', type: 'crypto' };

// สร้าง Transaction record จำลอง (โครงเดียวกับ transaction.repository.toTransaction)
function tx(overrides = {}) {
  return {
    id: 'tx-original',
    userId: USER_ID,
    assetId: ASSET.id,
    type: 'buy',
    amountThb: 1000,
    pricePerUnit: 2000000,
    quantity: 0.0005,
    feeThb: 0,
    date: '2026-07-01',
    note: null,
    source: 'line',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  transactionRepository.create.mockResolvedValue({ id: 'tx-reversal' });
  assetRepository.findByIds.mockResolvedValue([ASSET]);
});

describe('undoLastTransaction', () => {
  test('Undo buy สำเร็จ → สร้าง sell ตรงข้าม (ไม่ลบ/แก้ของเดิม) พร้อม note Trace', async () => {
    const original = tx({ id: 'tx-buy', type: 'buy', quantity: 0.0005 });
    transactionRepository.findRecentByUser.mockResolvedValue([original]);
    // ยอดคงเหลือ = 0.0005 (มีแต่ buy ก้อนนี้) → ย้อนได้พอดี
    transactionRepository.findAllByAsset.mockResolvedValue([original]);

    const result = await undoLastTransaction(USER_ID);

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        assetId: ASSET.id,
        type: 'sell',
        amountThb: original.amountThb,
        pricePerUnit: original.pricePerUnit,
        quantity: original.quantity,
        feeThb: 0,
        note: buildReversalNote('tx-buy'),
        source: 'line',
      })
    );
    expect(result).toMatchObject({
      originalType: 'buy',
      reversalType: 'sell',
      symbol: 'BTC',
      quantity: 0.0005,
    });
  });

  test('Undo sell สำเร็จ → สร้าง buy ตรงข้าม (ไม่ต้องเช็คยอดคงเหลือ)', async () => {
    const original = tx({ id: 'tx-sell', type: 'sell', quantity: 0.0003 });
    transactionRepository.findRecentByUser.mockResolvedValue([original]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      tx({ id: 'tx-buy-old', type: 'buy', quantity: 0.001 }),
      original,
    ]);

    const result = await undoLastTransaction(USER_ID);

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'buy', note: buildReversalNote('tx-sell') })
    );
    expect(result).toMatchObject({ originalType: 'sell', reversalType: 'buy' });
  });

  test('Undo ซ้ำสองครั้งติด — รายการล่าสุดเป็น Reversal เอง → ALREADY_UNDONE (ไม่สร้างซ้ำ)', async () => {
    const reversal = tx({ id: 'tx-reversal', type: 'sell', note: buildReversalNote('tx-buy') });
    transactionRepository.findRecentByUser.mockResolvedValue([reversal]);

    await expect(undoLastTransaction(USER_ID)).rejects.toMatchObject({ code: 'ALREADY_UNDONE' });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Undo ซ้ำ — มี Reversal ของรายการล่าสุดอยู่แล้ว (date tie) → ALREADY_UNDONE', async () => {
    const original = tx({ id: 'tx-buy', type: 'buy', quantity: 0.0005 });
    // findRecentByUser คืนรายการเดิมก่อน (date เท่ากับ Reversal — Tie ordering)
    transactionRepository.findRecentByUser.mockResolvedValue([original]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      original,
      tx({ id: 'tx-reversal', type: 'sell', note: buildReversalNote('tx-buy') }),
    ]);

    await expect(undoLastTransaction(USER_ID)).rejects.toMatchObject({ code: 'ALREADY_UNDONE' });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Undo เมื่อไม่มี Transaction เลย → NO_TRANSACTION_TO_UNDO', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([]);

    await expect(undoLastTransaction(USER_ID)).rejects.toMatchObject({
      code: 'NO_TRANSACTION_TO_UNDO',
    });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Undo buy แต่ยอดคงเหลือน้อยกว่า (ขายไปแล้วบางส่วน) → CANNOT_UNDO_QUANTITY_MISMATCH', async () => {
    const original = tx({ id: 'tx-buy', type: 'buy', quantity: 0.001 });
    transactionRepository.findRecentByUser.mockResolvedValue([original]);
    // buy 0.001 + sell 0.001 วันเดียวกัน → ยอดคงเหลือ = 0 แต่จะย้อน buy 0.001
    transactionRepository.findAllByAsset.mockResolvedValue([
      original,
      tx({ id: 'tx-sell-after', type: 'sell', quantity: 0.001 }),
    ]);

    await expect(undoLastTransaction(USER_ID)).rejects.toMatchObject({
      code: 'CANNOT_UNDO_QUANTITY_MISMATCH',
    });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// note ของ Reversal รองรับ "เหตุผลต่อท้าย" — 'UNDO_OF:<id> (test data cleanup)'
//
// เดิม parsing เอาทุกอย่างหลัง 'UNDO_OF:' มาเป็น id ทั้งท่อน ทำให้ Reversal ที่มี
// ข้อความต่อท้าย (เช่น Reversal เพื่อล้าง Test Data ก่อนเปิด Beta) ได้ id ที่ไม่ตรงกับ
// transactions.id จริง → รายการต้นฉบับไม่ถูกกันออกจากสถิติ DCA (นับเกินจริง) และ
// Double-Undo guard ตรวจไม่เจอว่าย้อนไปแล้ว
describe('parseReversedId / note ที่มีเหตุผลต่อท้าย', () => {
  const {
    parseReversedId,
    excludeUndoneTransactions,
  } = require('../src/services/undoTransaction.service');

  test('note มาตรฐาน → คืน id ตรงๆ', () => {
    expect(parseReversedId('UNDO_OF:tx-buy')).toBe('tx-buy');
  });

  test('note มีเหตุผลต่อท้าย → คืนเฉพาะ id ไม่รวมข้อความ', () => {
    expect(parseReversedId('UNDO_OF:tx-buy (test data cleanup)')).toBe('tx-buy');
  });

  test('ไม่ใช่ Reversal → null', () => {
    expect(parseReversedId('ซื้อประจำเดือน')).toBeNull();
    expect(parseReversedId(null)).toBeNull();
  });

  test('excludeUndoneTransactions กันรายการต้นฉบับออกได้แม้ note มีเหตุผลต่อท้าย', () => {
    const original = tx({ id: 'tx-buy', type: 'buy' });
    const reversal = tx({
      id: 'tx-reversal',
      type: 'sell',
      note: 'UNDO_OF:tx-buy (test data cleanup)',
    });
    const unrelated = tx({ id: 'tx-other', type: 'buy' });

    const result = excludeUndoneTransactions([original, reversal, unrelated]);

    // ทั้งคู่ของการยกเลิกต้องหายไป เหลือแต่รายการที่ไม่เกี่ยวข้อง
    expect(result.map((t) => t.id)).toEqual(['tx-other']);
  });

  test('Double-Undo guard ตรวจเจอ Reversal ที่ note มีเหตุผลต่อท้าย', async () => {
    const original = tx({ id: 'tx-buy', type: 'buy' });
    transactionRepository.findRecentByUser.mockResolvedValue([original]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      original,
      tx({ id: 'tx-reversal', type: 'sell', note: 'UNDO_OF:tx-buy (test data cleanup)' }),
    ]);

    await expect(undoLastTransaction(USER_ID)).rejects.toMatchObject({ code: 'ALREADY_UNDONE' });
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });

  test('Error ที่โยนเป็น UndoTransactionError (มี code + details)', async () => {
    transactionRepository.findRecentByUser.mockResolvedValue([]);

    await expect(undoLastTransaction(USER_ID)).rejects.toBeInstanceOf(UndoTransactionError);
  });
});
