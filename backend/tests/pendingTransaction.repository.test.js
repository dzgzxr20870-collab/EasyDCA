// Mock Supabase Client เป็น Query Builder แบบ Chainable (Pattern เดียวกับ
// transaction.repository.test / payment.repository.test)
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.insert = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.single = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const pendingTransactionRepository = require('../src/repositories/pendingTransaction.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

// เฉพาะส่วนที่เพิ่มใน Phase 3 Round 6 (Bulk Import — batch_id) — ไม่ทดสอบซ้ำ
// CRUD เดิมของไฟล์นี้ (ยังไม่เคยมี Test แยกมาก่อน)
describe('create — batch_id (Phase 3 Round 6)', () => {
  test('ส่ง batchId มา → insert พร้อม batch_id ตรงตัว', async () => {
    __query.single.mockResolvedValue({
      data: { id: 'p1', batch_id: 'batch-1', status: 'pending' },
      error: null,
    });

    await pendingTransactionRepository.create({
      userId: 'user-1',
      commandType: 'buy',
      assetSymbol: 'BTC',
      quantity: 0.5,
      pricePerUnit: 1500000,
      amountThb: 750000,
      txnDate: '2026-07-10',
      batchId: 'batch-1',
    });

    expect(__query.insert).toHaveBeenCalledWith(
      expect.objectContaining({ batch_id: 'batch-1' })
    );
  });

  test('ไม่ส่ง batchId (Flow ซื้อ/ขายทีละรายการเดิม) → batch_id เป็น null', async () => {
    __query.single.mockResolvedValue({ data: { id: 'p1', batch_id: null }, error: null });

    await pendingTransactionRepository.create({
      userId: 'user-1',
      commandType: 'buy',
      assetSymbol: 'BTC',
      quantity: 0.5,
      pricePerUnit: 1500000,
      amountThb: 750000,
      txnDate: '2026-07-10',
    });

    expect(__query.insert).toHaveBeenCalledWith(expect.objectContaining({ batch_id: null }));
  });

  test('toPending map batch_id → batchId', async () => {
    __query.single.mockResolvedValue({
      data: { id: 'p1', batch_id: 'batch-1', status: 'pending' },
      error: null,
    });

    const result = await pendingTransactionRepository.create({
      userId: 'user-1',
      commandType: 'buy',
      assetSymbol: 'BTC',
      quantity: 0.5,
      pricePerUnit: 1500000,
      amountThb: 750000,
      txnDate: '2026-07-10',
      batchId: 'batch-1',
    });

    expect(result).toMatchObject({ id: 'p1', batchId: 'batch-1' });
  });
});

describe('findByBatchId', () => {
  test('คืนทุกแถวที่มี batch_id ตรงกัน (Map เป็น camelCase)', async () => {
    __query.eq.mockResolvedValueOnce({
      data: [
        { id: 'p1', batch_id: 'batch-1', status: 'pending', asset_symbol: 'BTC' },
        { id: 'p2', batch_id: 'batch-1', status: 'pending', asset_symbol: 'ETH' },
      ],
      error: null,
    });

    const result = await pendingTransactionRepository.findByBatchId('batch-1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('pending_transactions');
    expect(__query.eq).toHaveBeenCalledWith('batch_id', 'batch-1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'p1', batchId: 'batch-1', assetSymbol: 'BTC' });
  });

  test('ไม่มีแถวเลย → คืน []', async () => {
    __query.eq.mockResolvedValueOnce({ data: [], error: null });
    expect(await pendingTransactionRepository.findByBatchId('batch-x')).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.eq.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(pendingTransactionRepository.findByBatchId('batch-1')).rejects.toThrow('boom');
  });
});
