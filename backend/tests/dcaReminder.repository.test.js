// Mock Supabase Client เป็น Query Builder แบบ Chainable (Pattern เดียวกับ
// transaction.repository.test.js) — ทุก Method คืน query เดิม ยกเว้น terminal ที่
// resolve เป็น { data, error }. ต่าง query ต่าง terminal จึงตั้ง resolve เฉพาะ test
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.insert = jest.fn(() => query);
  query.update = jest.fn(() => query);
  query.delete = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.maybeSingle = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const repo = require('../src/repositories/dcaReminder.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

function row(overrides = {}) {
  return {
    id: 'r1',
    user_id: 'u1',
    symbol: 'BTC',
    frequency: 'weekly',
    day_of_week: 4,
    day_of_month: null,
    amount_thb: 1000,
    currency: 'THB',
    active: true,
    last_notified_date: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findLatestPerSymbolByUser — dedupe latest per symbol', () => {
  test('เก็บแถวล่าสุดต่อ symbol (ซ่อน tombstone เก่า)', async () => {
    // Repository query order created_at DESC → mock คืนเรียงใหม่→เก่าอยู่แล้ว
    // BTC มี 2 แถว (ใหม่ active=false = paused ล่าสุด, เก่า active=true = tombstone)
    // SET มี 1 แถว
    __query.order.mockResolvedValue({
      data: [
        row({ id: 'btc-new', symbol: 'BTC', active: false, created_at: '2026-07-10T00:00:00.000Z' }),
        row({ id: 'btc-old', symbol: 'BTC', active: true, created_at: '2026-07-01T00:00:00.000Z' }),
        row({ id: 'set-1', symbol: 'SET', frequency: 'monthly', day_of_week: null, day_of_month: 16 }),
      ],
      error: null,
    });

    const result = await repo.findLatestPerSymbolByUser('u1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('dca_reminders');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(__query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    // BTC เหลือแถวล่าสุด (btc-new) เท่านั้น + SET
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(['btc-new', 'set-1']);
    const btc = result.find((r) => r.symbol === 'BTC');
    expect(btc.id).toBe('btc-new');
    expect(btc.active).toBe(false);
    // currency map ถูก (migration 020)
    expect(btc.currency).toBe('THB');
  });

  test('ไม่มีแถว → []', async () => {
    __query.order.mockResolvedValue({ data: [], error: null });
    expect(await repo.findLatestPerSymbolByUser('u1')).toEqual([]);
  });

  test('error → throw', async () => {
    __query.order.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(repo.findLatestPerSymbolByUser('u1')).rejects.toThrow(/boom/);
  });
});

describe('findByIdForUser — scope ด้วย user_id', () => {
  test('query ด้วย id + user_id แล้ว map', async () => {
    __query.maybeSingle.mockResolvedValue({ data: row({ id: 'r9', currency: 'USD' }), error: null });

    const result = await repo.findByIdForUser('r9', 'u1');

    expect(__query.eq).toHaveBeenCalledWith('id', 'r9');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(result.id).toBe('r9');
    expect(result.currency).toBe('USD');
  });

  test('ไม่พบ → null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await repo.findByIdForUser('x', 'u1')).toBeNull();
  });
});

describe('updateByIdForUser', () => {
  test('update WHERE id + user_id, คืนแถวใหม่', async () => {
    __query.maybeSingle.mockResolvedValue({ data: row({ amount_thb: 2000 }), error: null });

    const result = await repo.updateByIdForUser('r1', 'u1', { amount_thb: 2000 });

    expect(__query.update).toHaveBeenCalledWith({ amount_thb: 2000 });
    expect(__query.eq).toHaveBeenCalledWith('id', 'r1');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(result.amountThb).toBe(2000);
  });
});

describe('deleteByIdForUser — hard delete', () => {
  test('คืนจำนวนแถวที่ลบ (1)', async () => {
    // delete().eq().eq().select('id') → terminal คือ select
    __query.select.mockReturnValueOnce(Promise.resolve({ data: [{ id: 'r1' }], error: null }));
    const n = await repo.deleteByIdForUser('r1', 'u1');
    expect(__query.delete).toHaveBeenCalled();
    expect(n).toBe(1);
  });

  test('ไม่พบ → 0', async () => {
    __query.select.mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
    expect(await repo.deleteByIdForUser('x', 'u1')).toBe(0);
  });
});
