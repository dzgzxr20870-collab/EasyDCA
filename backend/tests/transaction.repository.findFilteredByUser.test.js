// transaction.repository.findFilteredByUser (ตัวกรอง/Pagination ประวัติธุรกรรม
// /app/transactions) — Mock Supabase เป็น Query Builder Chainable ที่ Thenable
// (Pattern เดียวกับ transaction.repository.dateRange.test.js เป๊ะ)
jest.mock('../src/config/supabase', () => {
  let result = { data: [], error: null, count: 0 };
  const query = {};
  ['select', 'eq', 'gte', 'lte', 'order', 'range'].forEach((m) => {
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

const ROW = {
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
};

beforeEach(() => {
  jest.clearAllMocks();
  __setResult({ data: [], error: null, count: 0 });
});

describe('findFilteredByUser — ไม่มี Filter (Default limit=50/offset=0)', () => {
  test('เรียก user_id + order date/created_at DESC + range(0,49) + select แบบ Left Join เดิม (ไม่มี !inner)', async () => {
    __setResult({ data: [ROW], error: null, count: 1 });

    const result = await transactionRepository.findFilteredByUser('user-1', {});

    expect(supabaseAdmin.from).toHaveBeenCalledWith('transactions');
    expect(__query.select).toHaveBeenCalledWith('*, assets(symbol)', { count: 'exact' });
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(__query.order).toHaveBeenNthCalledWith(1, 'date', { ascending: false });
    expect(__query.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false });
    expect(__query.range).toHaveBeenCalledWith(0, 49);

    expect(result.transactions[0].symbol).toBe('BTC');
    expect(result.transactions[0].amountThb).toBe(15000);
    expect(result.total).toBe(1);
  });

  test('ไม่ส่ง limit/offset มาเลย (undefined) → Fallback limit=50/offset=0 เหมือนกัน', async () => {
    await transactionRepository.findFilteredByUser('user-1', {
      limit: undefined,
      offset: undefined,
    });
    expect(__query.range).toHaveBeenCalledWith(0, 49);
  });

  test('limit/offset ที่ไม่ใช่ตัวเลขบวก (0, -1, NaN) → Fallback ค่า Default เหมือนกัน', async () => {
    await transactionRepository.findFilteredByUser('user-1', { limit: 0, offset: -5 });
    expect(__query.range).toHaveBeenCalledWith(0, 49);
  });

  test('ไม่ระบุตัวกรองใดๆ → ไม่เรียก .eq("type", ...) / .gte / .lte เพิ่ม', async () => {
    await transactionRepository.findFilteredByUser('user-1', {});
    // eq ถูกเรียกครั้งเดียวสำหรับ user_id เท่านั้น (ไม่มี type/symbol)
    expect(__query.eq).toHaveBeenCalledTimes(1);
    expect(__query.gte).not.toHaveBeenCalled();
    expect(__query.lte).not.toHaveBeenCalled();
  });
});

describe('findFilteredByUser — type filter', () => {
  test('type=sell → .eq("type", "sell")', async () => {
    await transactionRepository.findFilteredByUser('user-1', { type: 'sell' });
    expect(__query.eq).toHaveBeenCalledWith('type', 'sell');
  });
});

describe('findFilteredByUser — date range filter (Pattern เดียวกับ findByUserAndDateRange)', () => {
  test('from/to → .gte("date", from) + .lte("date", to)', async () => {
    await transactionRepository.findFilteredByUser('user-1', {
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(__query.gte).toHaveBeenCalledWith('date', '2026-07-01');
    expect(__query.lte).toHaveBeenCalledWith('date', '2026-07-31');
  });

  test('ระบุแค่ from (ไม่มี to) → .gte เท่านั้น ไม่เรียก .lte', async () => {
    await transactionRepository.findFilteredByUser('user-1', { from: '2026-07-01' });
    expect(__query.gte).toHaveBeenCalledWith('date', '2026-07-01');
    expect(__query.lte).not.toHaveBeenCalled();
  });
});

describe('⭐ findFilteredByUser — symbol filter ต้อง Force Inner Join ถึงจะกรอง Embedded Resource ได้', () => {
  test('⭐ symbol=BTC → select ด้วย assets!inner(symbol) + .eq("assets.symbol", "BTC")', async () => {
    await transactionRepository.findFilteredByUser('user-1', { symbol: 'BTC' });

    expect(__query.select).toHaveBeenCalledWith('*, assets!inner(symbol)', { count: 'exact' });
    expect(__query.eq).toHaveBeenCalledWith('assets.symbol', 'BTC');
  });

  test('ไม่ส่ง symbol มา → select ยังเป็น Left Join เดิม (*, assets(symbol)) ไม่เปลี่ยนพฤติกรรมเดิม', async () => {
    await transactionRepository.findFilteredByUser('user-1', {});
    expect(__query.select).toHaveBeenCalledWith('*, assets(symbol)', { count: 'exact' });
  });
});

describe('findFilteredByUser — offset pagination จริง', () => {
  test('offset=50, limit=50 → .range(50, 99)', async () => {
    await transactionRepository.findFilteredByUser('user-1', { offset: 50, limit: 50 });
    expect(__query.range).toHaveBeenCalledWith(50, 99);
  });

  test('offset=0, limit=20 (หน้าแรกที่ Limit เล็กกว่า Default) → .range(0, 19)', async () => {
    await transactionRepository.findFilteredByUser('user-1', { offset: 0, limit: 20 });
    expect(__query.range).toHaveBeenCalledWith(0, 19);
  });
});

describe('findFilteredByUser — total (Exact Count จาก PostgREST)', () => {
  test('total มากกว่าจำนวนแถวที่คืนมา (ยังมีหน้าถัดไป) → คืน total ตามจริง ไม่ใช่ data.length', async () => {
    __setResult({ data: [ROW], error: null, count: 137 });
    const result = await transactionRepository.findFilteredByUser('user-1', { limit: 1 });
    expect(result.total).toBe(137);
    expect(result.transactions).toHaveLength(1);
  });

  test('count เป็น null (Query ไม่คืน Count มาด้วยเหตุผลใดก็ตาม) → Fallback เป็น data.length ไม่ throw', async () => {
    __setResult({ data: [ROW], error: null, count: null });
    const result = await transactionRepository.findFilteredByUser('user-1', {});
    expect(result.total).toBe(1);
  });
});

describe('findFilteredByUser — ไม่มีธุรกรรมตรงเงื่อนไข → คืน [] + total:0 (ไม่ Error)', () => {
  test('data ว่าง', async () => {
    const result = await transactionRepository.findFilteredByUser('user-1', { type: 'dividend' });
    expect(result).toEqual({ transactions: [], total: 0 });
  });
});

describe('findFilteredByUser — Query ล้มเหลว → throw', () => {
  test('Supabase คืน error → throw พร้อม userId ใน message', async () => {
    __setResult({ data: null, error: { message: 'boom' } });
    await expect(transactionRepository.findFilteredByUser('user-1', {})).rejects.toThrow(
      /Failed to find filtered transactions for user user-1/
    );
  });
});
