// Mock Supabase Client เป็น Query Builder แบบ Chainable — select คืน query เดิม
// (Fluent) ส่วน eq เป็น Terminal ของ findUserIdsWithActiveAssets จึง Resolve เป็น
// { data, error } เหมือน PostgREST จริง — rpc แยกเป็น jest.fn() ของตัวเอง เพราะ
// create() (migration 035) เรียกผ่าน .rpc('create_asset_locked', ...) ไม่ใช่
// .from('assets').insert() ตรงๆ อีกต่อไป (ดู tests/oversellRace.test.js ที่ใช้
// Pattern เดียวกันกับ transactionRepository.create)
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.eq = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query), rpc: jest.fn() };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const assetRepository = require('../src/repositories/asset.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

// migration 035 — create() เรียก RPC create_asset_locked ที่ Lock แถว users ก่อน
// นับ+Insert ในธุรกรรมเดียว (แก้ Free-tier Asset Limit Race) แทน .insert() ตรงๆ
// เดิม — ครอบทั้งกรณีสำเร็จ, เกินเพดาน (ASSET_LIMIT_REACHED), และ Symbol ซ้ำที่ชน
// UNIQUE NULLS NOT DISTINCT ของ migration 014 (ASSET_ALREADY_EXISTS — RPC แปลง
// 23505 ดิบให้เป็น Message อ่านง่ายแล้วตั้งแต่ชั้น DB)
describe('create — เรียกผ่าน RPC create_asset_locked (migration 035)', () => {
  test('สำเร็จตามปกติ → ส่ง Argument ครบ + คืน Asset ที่สร้างแล้ว', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: [
        {
          id: 'asset-1',
          user_id: 'user-1',
          portfolio_id: null,
          symbol: 'BTC',
          name: 'Bitcoin',
          type: 'crypto',
          proj_id: null,
          fund_class_name: null,
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await assetRepository.create('user-1', null, 'BTC', 'Bitcoin', 'crypto', {}, 2);

    expect(result.symbol).toBe('BTC');
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('create_asset_locked', {
      p_user_id: 'user-1',
      p_portfolio_id: null,
      p_symbol: 'BTC',
      p_name: 'Bitcoin',
      p_type: 'crypto',
      p_asset_limit: 2,
      p_proj_id: null,
      p_fund_class_name: null,
      // Stage 5 (migration 046) — โบรกที่ถือสินทรัพย์ก้อนนี้ (null = ไม่ระบุ
      // ซึ่งเป็นค่าของทุกแถวเดิมในระบบ) ต้องส่งเป็น null ไม่ใช่ undefined เสมอ
      // เพราะ PostgREST ตัด Key ที่เป็น undefined ทิ้ง แล้ว RPC จะรับ Argument
      // ไม่ครบชุดที่ Signature ประกาศไว้
      p_broker_id: null,
    });
  });

  test('ไม่ส่ง assetLimit (Premium ที่ยัง Active) → p_asset_limit เป็น null ไม่ใช่ undefined', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: [{ id: 'asset-1', symbol: 'BTC', is_active: true }],
      error: null,
    });

    await assetRepository.create('user-1', null, 'BTC', 'Bitcoin', 'crypto');

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_asset_locked',
      expect.objectContaining({ p_asset_limit: null })
    );
  });

  test('เกินเพดาน Free Plan → throw AssetWriteError(ASSET_LIMIT_REACHED) พร้อม details จาก DB', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: { message: 'ASSET_LIMIT_REACHED', details: 'limit=2;current=2' },
    });

    await expect(
      assetRepository.create('user-1', null, 'ETH', 'Ethereum', 'crypto', {}, 2)
    ).rejects.toMatchObject({
      name: 'AssetWriteError',
      code: 'ASSET_LIMIT_REACHED',
      details: { limit: 2, current: 2 },
    });
  });

  // migration 014 — assets UNIQUE (user_id, symbol, portfolio_id) เปลี่ยนเป็น
  // NULLS NOT DISTINCT แล้ว ยัง Reject Insert ซ้ำเหมือนเดิมทุกประการ ต่างแค่ตอนนี้
  // RPC จับ unique_violation แล้วแปลงเป็น Message 'ASSET_ALREADY_EXISTS' ให้แทนที่
  // จะโผล่เป็น 23505 ดิบ (Security Audit ตามมาจาก migration 034)
  test('Insert Symbol ซ้ำ (ชนกันพอดี) → throw AssetWriteError(ASSET_ALREADY_EXISTS) ไม่ใช่ Error ดิบ', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: { message: 'ASSET_ALREADY_EXISTS' },
    });

    await expect(
      assetRepository.create('user-1', null, 'BTC', 'Bitcoin', 'crypto')
    ).rejects.toMatchObject({ name: 'AssetWriteError', code: 'ASSET_ALREADY_EXISTS' });
  });

  test('Error อื่นของ DB (ไม่ใช่เงื่อนไขธุรกิจ) → โยนต่อเป็น Error ทั่วไปเหมือนเดิม', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: { message: 'connection terminated' },
    });

    await expect(
      assetRepository.create('user-1', null, 'BTC', 'Bitcoin', 'crypto')
    ).rejects.toThrow(/Failed to create asset/);
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

// ═══════════════════════════════════════════════════════════════════════════
// findByIds — Security Audit (Cross-User Isolation, รอบ 2): ย้ายผ่าน queryForUser
// ═══════════════════════════════════════════════════════════════════════════
// เดิมรับแค่ assetIds ปลอดภัยอยู่เพราะ Caller ส่ง assetId ที่มาจาก Transaction
// ของตัวเองมาแล้วเท่านั้น (วินัยของ Caller ไม่ใช่โครงสร้างบังคับ) — ไม่เคยมี Test
// ตรงจุดนี้มาก่อนเลย เพิ่มให้ครบทั้ง Happy Path + Ownership Guard
describe('findByIds — Ownership Guard + Query จริง', () => {
  test('assetIds ว่าง → คืน [] ทันที แต่ยังตรวจ userId ก่อนเสมอ (ไม่ใช่ Bypass Guard)', async () => {
    await expect(assetRepository.findByIds([], undefined)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  test('assetIds ว่าง + userId ถูกต้อง → คืน [] โดยไม่ยิง Query เลย (Early-return ปกติ)', async () => {
    const result = await assetRepository.findByIds([], 'user-1');
    expect(result).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
  ])('userId = %s (assetIds ไม่ว่าง) → throw MISSING_USER_ID ไม่ยิง Query', async (_label, bad) => {
    await expect(assetRepository.findByIds(['asset-1'], bad)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  test('Happy Path: .in() + .eq(user_id) ถูกเรียกทั้งคู่ แล้ว Map เป็น camelCase', async () => {
    __query.eq.mockResolvedValue({
      data: [
        { id: 'asset-1', user_id: 'user-1', symbol: 'BTC', name: 'Bitcoin', type: 'crypto', is_active: true },
      ],
      error: null,
    });

    const result = await assetRepository.findByIds(['asset-1'], 'user-1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('assets');
    expect(__query.in).toHaveBeenCalledWith('id', ['asset-1']);
    // Security Audit: queryForUser ต้องต่อ .eq('user_id', userId) ให้เสมอ
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result[0]).toMatchObject({ id: 'asset-1', symbol: 'BTC' });
  });

  test('Supabase error → throw ข้อความเดิม', async () => {
    __query.eq.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(assetRepository.findByIds(['asset-1'], 'user-1')).rejects.toThrow(
      /Failed to find assets by ids/
    );
  });
});
