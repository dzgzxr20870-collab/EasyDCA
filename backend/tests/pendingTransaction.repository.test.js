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

// findByBatchIdForUser chain: .select().eq('batch_id',..).eq('user_id',..)
// → eq ตัวแรกต้องคืน query ต่อ, ตัวที่สองเป็นตัวที่ await ผล
function mockBatchQueryResult(result) {
  __query.eq.mockReturnValueOnce(__query).mockResolvedValueOnce(result);
}

describe('findByBatchIdForUser', () => {
  test('คืนทุกแถวที่มี batch_id ตรงกัน (Map เป็น camelCase)', async () => {
    mockBatchQueryResult({
      data: [
        { id: 'p1', batch_id: 'batch-1', status: 'pending', asset_symbol: 'BTC' },
        { id: 'p2', batch_id: 'batch-1', status: 'pending', asset_symbol: 'ETH' },
      ],
      error: null,
    });

    const result = await pendingTransactionRepository.findByBatchIdForUser('batch-1', 'user-1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('pending_transactions');
    expect(__query.eq).toHaveBeenCalledWith('batch_id', 'batch-1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'p1', batchId: 'batch-1', assetSymbol: 'BTC' });
  });

  // ── Security Audit (Cross-User Isolation) ────────────────────────────────
  // batchId มาจาก LINE Postback (ค่าฝั่ง Client) — Query ต้องกรอง user_id
  // ไปพร้อมกันในคำสั่งเดียว ไม่ใช่ดึงมาแล้วค่อยเทียบเจ้าของทีหลัง
  test('กรอง user_id ไปพร้อมกับ batch_id เสมอ (กันดึง Batch ของคนอื่น)', async () => {
    mockBatchQueryResult({ data: [], error: null });

    await pendingTransactionRepository.findByBatchIdForUser('batch-1', 'user-1');

    expect(__query.eq).toHaveBeenCalledWith('batch_id', 'batch-1');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  test('ไม่มีแถวเลย → คืน []', async () => {
    mockBatchQueryResult({ data: [], error: null });
    expect(await pendingTransactionRepository.findByBatchIdForUser('batch-x', 'user-1')).toEqual([]);
  });

  test('DB error → throw', async () => {
    mockBatchQueryResult({ data: null, error: { message: 'boom' } });
    await expect(
      pendingTransactionRepository.findByBatchIdForUser('batch-1', 'user-1')
    ).rejects.toThrow('boom');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Unit — Ownership Guard: ลืมส่ง userId ต้อง "พัง" ไม่ใช่ Query ข้ามบัญชี
// ═════════════════════════════════════════════════════════════════════════
// ห้าม Silent Default เด็ดขาด — "ไม่มี userId = ดึงทั้งหมด" คือรูปแบบความผิดพลาด
// ที่อันตรายที่สุดของงานนี้ ทุกฟังก์ชันที่แตะแถวราย id ต้อง throw MISSING_USER_ID
// ทันที และต้อง "ไม่เคยยิง Query ออกไปเลย" (ยืนยันด้วย supabaseAdmin.from)
describe('Ownership Guard — userId เป็นพารามิเตอร์ที่ไม่ใส่ไม่ได้', () => {
  const CASES = [
    ['findByIdForUser', (uid) => pendingTransactionRepository.findByIdForUser('p1', uid)],
    [
      'findByBatchIdForUser',
      (uid) => pendingTransactionRepository.findByBatchIdForUser('batch-1', uid),
    ],
    ['claimForConfirm', (uid) => pendingTransactionRepository.claimForConfirm('p1', uid)],
    ['attachTransaction', (uid) => pendingTransactionRepository.attachTransaction('p1', 'tx-1', uid)],
    ['markCancelled', (uid) => pendingTransactionRepository.markCancelled('p1', uid)],
    ['markExpired', (uid) => pendingTransactionRepository.markExpired('p1', uid)],
  ];

  const BAD_USER_IDS = [
    ['undefined', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
    ['ช่องว่างล้วน', '   '],
  ];

  for (const [fnName, call] of CASES) {
    for (const [label, badUserId] of BAD_USER_IDS) {
      test(`${fnName} — userId = ${label} → throw MISSING_USER_ID และไม่ยิง Query`, async () => {
        await expect(call(badUserId)).rejects.toMatchObject({ code: 'MISSING_USER_ID' });
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
      });
    }
  }
});
