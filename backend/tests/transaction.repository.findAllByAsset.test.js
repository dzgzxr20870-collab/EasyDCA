// transaction.repository.findAllByAsset — ต้องเรียง date ASC, created_at ASC เพราะ
// Moving Average Cost Basis (portfolio.service.calculateTotalInvested) ต้อง Replay
// ธุรกรรมตามลำดับเวลาจริง ไม่พึ่ง Row Order ตามธรรมชาติของ Postgres ซึ่งไม่การันตี
// Mock Supabase เป็น Query Builder Chainable ที่ Thenable (Pattern เดียวกับ
// transaction.repository.dateRange.test.js)
jest.mock('../src/config/supabase', () => {
  let result = { data: [], error: null };
  const query = {};
  ['select', 'eq', 'order'].forEach((m) => {
    query[m] = jest.fn(() => query);
  });
  query.then = (resolve) => resolve(result);
  const supabaseAdmin = { from: jest.fn(() => query) };
  return {
    supabaseAdmin,
    __query: query,
    __setResult: (r) => {
      result = r;
    },
  };
});

const { supabaseAdmin, __query, __setResult } = require('../src/config/supabase');
const transactionRepository = require('../src/repositories/transaction.repository');

beforeEach(() => {
  jest.clearAllMocks();
  __setResult({ data: [], error: null });
});

describe('findAllByAsset — Deterministic ordering (Moving Average ต้องการลำดับเวลาจริง)', () => {
  test('เรียง date ASC แล้วตามด้วย created_at ASC (Secondary Key)', async () => {
    await transactionRepository.findAllByAsset('asset-1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('transactions');
    expect(__query.select).toHaveBeenCalledWith('*');
    expect(__query.eq).toHaveBeenCalledWith('asset_id', 'asset-1');
    expect(__query.order).toHaveBeenNthCalledWith(1, 'date', { ascending: true });
    expect(__query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: true });
    expect(__query.order).toHaveBeenCalledTimes(2);
  });

  test('คืนรายการที่ Map camelCase ถูกต้อง', async () => {
    __setResult({
      data: [
        {
          id: 'tx-1',
          user_id: 'user-1',
          asset_id: 'asset-1',
          type: 'buy',
          amount_thb: 1000,
          price_per_unit: 100,
          quantity: 10,
          fee_thb: 0,
          date: '2026-01-01',
          note: null,
          source: 'line',
          created_at: '2026-01-01T09:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await transactionRepository.findAllByAsset('asset-1');

    expect(result[0]).toMatchObject({
      id: 'tx-1',
      assetId: 'asset-1',
      type: 'buy',
      amountThb: 1000,
      quantity: 10,
    });
  });

  test('Query ล้มเหลว → throw', async () => {
    __setResult({ data: null, error: { message: 'boom' } });

    await expect(transactionRepository.findAllByAsset('asset-1')).rejects.toThrow(
      /Failed to find transactions for asset/
    );
  });
});
