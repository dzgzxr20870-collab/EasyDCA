// transaction.repository.findByUserAndDateRange (Phase 3 Round 8)
// Mock Supabase เป็น Query Builder Chainable ที่ Thenable (await ทั้ง Chain ได้)
jest.mock('../src/config/supabase', () => {
  let result = { data: [], error: null };
  const query = {};
  ['select', 'eq', 'gte', 'lte', 'order'].forEach((m) => {
    query[m] = jest.fn(() => query);
  });
  // ทำให้ await query ทั้ง Chain resolve เป็นผลลัพธ์ที่ตั้งไว้ (เหมือน PostgREST thenable)
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

describe('findByUserAndDateRange', () => {
  test('กรอง user_id + date ในช่วง [from,to] (Inclusive) เรียงเก่า→ใหม่ + Join symbol', async () => {
    __setResult({
      data: [
        {
          id: 'tx-1',
          user_id: 'user-1',
          asset_id: 'a-btc',
          type: 'buy',
          amount_thb: 15000,
          price_per_unit: 3000000,
          quantity: 0.005,
          fee_thb: 0,
          date: '2026-07-05',
          note: null,
          source: 'line',
          created_at: '2026-07-05T09:00:00.000Z',
          assets: { symbol: 'BTC' },
        },
      ],
      error: null,
    });

    const result = await transactionRepository.findByUserAndDateRange('user-1', '2026-07-01', '2026-07-31');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('transactions');
    expect(__query.select).toHaveBeenCalledWith('*, assets(symbol)');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(__query.gte).toHaveBeenCalledWith('date', '2026-07-01');
    expect(__query.lte).toHaveBeenCalledWith('date', '2026-07-31');
    expect(__query.order).toHaveBeenNthCalledWith(1, 'date', { ascending: true });
    expect(__query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: true });

    // Map symbol จาก Join + camelCase fields
    expect(result[0].symbol).toBe('BTC');
    expect(result[0].amountThb).toBe(15000);
  });

  test('ไม่มีธุรกรรมในช่วง → คืน [] (ไม่ Error)', async () => {
    const result = await transactionRepository.findByUserAndDateRange('user-1', '2026-07-01', '2026-07-31');
    expect(result).toEqual([]);
  });

  test('Query ล้มเหลว → throw', async () => {
    __setResult({ data: null, error: { message: 'boom' } });
    await expect(
      transactionRepository.findByUserAndDateRange('user-1', '2026-07-01', '2026-07-31')
    ).rejects.toThrow(/Failed to find transactions in range/);
  });
});
