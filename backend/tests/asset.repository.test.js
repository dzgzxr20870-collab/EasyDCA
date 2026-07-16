// Mock Supabase Client เป็น Query Builder แบบ Chainable — select คืน query เดิม
// (Fluent) ส่วน eq เป็น Terminal ของ findUserIdsWithActiveAssets จึง Resolve เป็น
// { data, error } เหมือน PostgREST จริง
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn();
  query.insert = jest.fn(() => query);
  query.single = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const assetRepository = require('../src/repositories/asset.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

// migration 014 — assets UNIQUE (user_id, symbol, portfolio_id) เปลี่ยนเป็น
// NULLS NOT DISTINCT แล้ว: Insert Asset ซ้ำ (user_id+symbol เดิม, portfolio_id
// เป็น NULL ทั้งคู่) ต้องโดน Reject ด้วย Unique Violation จาก DB ตรงๆ (ก่อนแก้
// Migration นี้ Insert ซ้ำแบบนี้จะผ่านเงียบๆ เพราะ Postgres ถือ NULL <> NULL)
describe('create — Unique Violation (migration 014, portfolio_id = NULL)', () => {
  test('Insert user_id+symbol ซ้ำ (portfolio_id = NULL ทั้งคู่) → throw พร้อมข้อความ Unique Violation จาก DB', async () => {
    // จำลอง Error ที่ Supabase/Postgres คืนจริงเมื่อชน Unique Constraint (Pattern
    // เดียวกับ payment.service.test.js — code 23505 + ข้อความ duplicate key)
    __query.single.mockResolvedValue({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "assets_user_id_symbol_portfolio_id_key"',
        code: '23505',
      },
    });

    await expect(
      assetRepository.create('user-1', null, 'BTC', 'Bitcoin', 'crypto')
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  test('Insert Asset ใหม่ไม่ซ้ำ → สำเร็จตามปกติ (ไม่ Regression)', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'asset-1',
        user_id: 'user-1',
        portfolio_id: null,
        symbol: 'BTC',
        name: 'Bitcoin',
        type: 'crypto',
        is_active: true,
      },
      error: null,
    });

    const result = await assetRepository.create('user-1', null, 'BTC', 'Bitcoin', 'crypto');

    expect(result.symbol).toBe('BTC');
    expect(__query.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', portfolio_id: null, symbol: 'BTC' })
    );
  });
});

describe('findUserIdsWithActiveAssets', () => {
  test('Query assets ที่ is_active = true พร้อม Join users(line_user_id)', async () => {
    __query.eq.mockResolvedValue({ data: [], error: null });

    await assetRepository.findUserIdsWithActiveAssets();

    expect(supabaseAdmin.from).toHaveBeenCalledWith('assets');
    expect(__query.select).toHaveBeenCalledWith('user_id, users(line_user_id)');
    expect(__query.eq).toHaveBeenCalledWith('is_active', true);
  });

  test('Dedupe ราย user_id — User ที่มีหลาย Asset คืนครั้งเดียว + แนบ lineUserId', async () => {
    __query.eq.mockResolvedValue({
      data: [
        { user_id: 'u1', users: { line_user_id: 'U1' } },
        { user_id: 'u1', users: { line_user_id: 'U1' } }, // Asset ตัวที่ 2 ของ u1
        { user_id: 'u2', users: { line_user_id: 'U2' } },
      ],
      error: null,
    });

    const result = await assetRepository.findUserIdsWithActiveAssets();

    expect(result).toEqual([
      { userId: 'u1', lineUserId: 'U1' },
      { userId: 'u2', lineUserId: 'U2' },
    ]);
  });

  test('Join users ไม่ได้ค่า (users เป็น null) → lineUserId = null', async () => {
    __query.eq.mockResolvedValue({
      data: [{ user_id: 'u1', users: null }],
      error: null,
    });

    const result = await assetRepository.findUserIdsWithActiveAssets();

    expect(result).toEqual([{ userId: 'u1', lineUserId: null }]);
  });

  test('ไม่มี Asset Active เลย → คืน Array ว่าง', async () => {
    __query.eq.mockResolvedValue({ data: [], error: null });

    const result = await assetRepository.findUserIdsWithActiveAssets();

    expect(result).toEqual([]);
  });

  test('Supabase error → throw', async () => {
    __query.eq.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(assetRepository.findUserIdsWithActiveAssets()).rejects.toThrow('db down');
  });
});

describe('countActiveSymbolsGroupedByUser', () => {
  test('Query assets is_active=true แล้วนับ Distinct symbol แยกราย user', async () => {
    __query.eq.mockResolvedValue({
      data: [
        { user_id: 'u1', symbol: 'BTC' },
        { user_id: 'u1', symbol: 'ETH' },
        { user_id: 'u2', symbol: 'PTT' },
      ],
      error: null,
    });

    const result = await assetRepository.countActiveSymbolsGroupedByUser();

    expect(supabaseAdmin.from).toHaveBeenCalledWith('assets');
    expect(__query.select).toHaveBeenCalledWith('user_id, symbol');
    expect(__query.eq).toHaveBeenCalledWith('is_active', true);
    expect(result).toEqual({ u1: 2, u2: 1 });
  });

  test('symbol ซ้ำของ user เดียวกัน (ข้าม Portfolio) นับเป็น 1 (Distinct)', async () => {
    __query.eq.mockResolvedValue({
      data: [
        { user_id: 'u1', symbol: 'BTC' },
        { user_id: 'u1', symbol: 'BTC' },
      ],
      error: null,
    });

    const result = await assetRepository.countActiveSymbolsGroupedByUser();
    expect(result).toEqual({ u1: 1 });
  });

  test('ไม่มี Asset Active เลย → คืน {} (User ไม่มีสินทรัพย์ = ไม่มี key)', async () => {
    __query.eq.mockResolvedValue({ data: [], error: null });
    expect(await assetRepository.countActiveSymbolsGroupedByUser()).toEqual({});
  });

  test('Supabase error → throw', async () => {
    __query.eq.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(assetRepository.countActiveSymbolsGroupedByUser()).rejects.toThrow('db down');
  });
});
