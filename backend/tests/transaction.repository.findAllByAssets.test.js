// transaction.repository.findAllByAssets — เหมือน findAllByAsset แต่รับหลาย
// asset_id พร้อมกัน (กราฟเงินลงทุนสะสมรายพอร์ต — พอร์ตหนึ่งมีหลายสินทรัพย์)
// Mock Supabase เป็น Query Builder Chainable ที่ Thenable (Pattern เดียวกับ
// transaction.repository.findAllByAsset.test.js)
jest.mock('../src/config/supabase', () => {
  let result = { data: [], error: null };
  const query = {};
  ['select', 'eq', 'in', 'order'].forEach((m) => {
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

describe('findAllByAssets', () => {
  test('ยิง Query ด้วย .in(asset_id, [...]) และกรอง user_id ผ่าน queryForUser', async () => {
    await transactionRepository.findAllByAssets(['asset-1', 'asset-2'], 'user-1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('transactions');
    expect(__query.select).toHaveBeenCalledWith('*');
    expect(__query.in).toHaveBeenCalledWith('asset_id', ['asset-1', 'asset-2']);
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  test('assetIds ว่าง → คืน [] ทันที ไม่ยิง Query', async () => {
    const result = await transactionRepository.findAllByAssets([], 'user-1');

    expect(result).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
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

    const result = await transactionRepository.findAllByAssets(['asset-1'], 'user-1');

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

    await expect(
      transactionRepository.findAllByAssets(['asset-1'], 'user-1')
    ).rejects.toThrow(/Failed to find transactions for assets/);
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
  ])('userId = %s → throw MISSING_USER_ID ไม่ยิง Query เลย', async (_label, bad) => {
    await expect(
      transactionRepository.findAllByAssets(['asset-1'], bad)
    ).rejects.toMatchObject({ code: 'MISSING_USER_ID' });
  });
});
