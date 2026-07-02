// Mock Supabase Client เป็น Query Builder แบบ Chainable — ทุก Method คืน query
// เดิม (Fluent) ยกเว้น limit ที่ Resolve เป็น { data, error } เหมือน PostgREST จริง
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const transactionRepository = require('../src/repositories/transaction.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findRecentByUser — Deterministic ordering', () => {
  test('เรียง date DESC แล้วตามด้วย created_at DESC (Secondary Key)', async () => {
    __query.limit.mockResolvedValue({ data: [], error: null });

    await transactionRepository.findRecentByUser('user-1', 5);

    // ต้องเรียกสองระดับ: date ก่อน แล้ว created_at (ทั้งคู่ DESC)
    expect(__query.order).toHaveBeenNthCalledWith(1, 'date', { ascending: false });
    expect(__query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false });
    expect(__query.order).toHaveBeenCalledTimes(2);
    expect(__query.limit).toHaveBeenCalledWith(5);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('transactions');
  });

  test('หลายรายการ date เท่ากัน → คืนตัวที่ created_at ใหม่สุดก่อน (บั๊กเดิมย้อนผิดตัว)', async () => {
    // จำลองผลที่ Supabase ควรคืนหลังแก้ query: วันเดียวกัน (2026-07-02) แต่
    // BTC 999 ถูก Insert หลัง PTT → created_at ใหม่กว่า จึงต้องมาเป็นแถวแรก
    __query.limit.mockResolvedValue({
      data: [
        {
          id: 'tx-btc',
          user_id: 'user-1',
          asset_id: 'asset-btc',
          type: 'buy',
          amount_thb: 999,
          price_per_unit: 2000000,
          quantity: 0.0004995,
          fee_thb: 0,
          date: '2026-07-02',
          note: null,
          source: 'line',
          created_at: '2026-07-02T10:05:00.000Z',
        },
        {
          id: 'tx-ptt',
          user_id: 'user-1',
          asset_id: 'asset-ptt',
          type: 'buy',
          amount_thb: 1700,
          price_per_unit: 34,
          quantity: 50,
          fee_thb: 0,
          date: '2026-07-02',
          note: null,
          source: 'line',
          created_at: '2026-07-02T09:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await transactionRepository.findRecentByUser('user-1', 1);

    // แถวแรก = รายการล่าสุดจริง (BTC 999) ไม่ใช่ PTT ที่เก่ากว่า
    expect(result[0].id).toBe('tx-btc');
    expect(result[0].amountThb).toBe(999);
  });

  test('โยน Error เมื่อ Query ล้มเหลว', async () => {
    __query.limit.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(transactionRepository.findRecentByUser('user-1', 5)).rejects.toThrow(
      /Failed to find recent transactions/
    );
  });
});
