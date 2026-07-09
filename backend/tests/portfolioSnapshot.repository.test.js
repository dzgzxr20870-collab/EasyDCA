// Mock Supabase Client เป็น Query Builder แบบ Chainable (Pattern เดียวกับ
// payment.repository.test) — upsert/select คืน query เดิม ยกเว้น single ที่ Resolve
// เป็น { data, error } เหมือน PostgREST จริง
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.upsert = jest.fn(() => query);
  query.select = jest.fn(() => query);
  query.single = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const portfolioSnapshotRepository = require('../src/repositories/portfolioSnapshot.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('upsertSnapshot', () => {
  test('เขียน snake_case ถูกต้อง + onConflict user_id,snapshot_date แล้ว map เป็น camelCase', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'snap-1',
        user_id: 'user-1',
        snapshot_date: '2026-07-09',
        total_invested: 30000,
        total_current_value: 75000,
        total_profit_loss: 15000,
        excluded_asset_count: 1,
        created_at: '2026-07-09T00:00:00.000Z',
      },
      error: null,
    });

    const result = await portfolioSnapshotRepository.upsertSnapshot({
      userId: 'user-1',
      snapshotDate: '2026-07-09',
      totalInvested: 30000,
      totalCurrentValue: 75000,
      totalProfitLoss: 15000,
      excludedAssetCount: 1,
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith('portfolio_snapshots');
    expect(__query.upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        snapshot_date: '2026-07-09',
        total_invested: 30000,
        total_current_value: 75000,
        total_profit_loss: 15000,
        excluded_asset_count: 1,
      },
      { onConflict: 'user_id,snapshot_date' }
    );
    expect(result).toMatchObject({
      id: 'snap-1',
      userId: 'user-1',
      snapshotDate: '2026-07-09',
      totalInvested: 30000,
      totalCurrentValue: 75000,
      totalProfitLoss: 15000,
      excludedAssetCount: 1,
    });
  });

  test('total_current_value/total_profit_loss เป็น null → map ผ่านตรงๆ (ไม่แปลงเป็น 0)', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'snap-2',
        user_id: 'user-2',
        snapshot_date: '2026-07-09',
        total_invested: 20000,
        total_current_value: null,
        total_profit_loss: null,
        excluded_asset_count: 2,
        created_at: '2026-07-09T00:00:00.000Z',
      },
      error: null,
    });

    const result = await portfolioSnapshotRepository.upsertSnapshot({
      userId: 'user-2',
      snapshotDate: '2026-07-09',
      totalInvested: 20000,
      totalCurrentValue: null,
      totalProfitLoss: null,
      excludedAssetCount: 2,
    });

    expect(result.totalCurrentValue).toBeNull();
    expect(result.totalProfitLoss).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      portfolioSnapshotRepository.upsertSnapshot({
        userId: 'user-1',
        snapshotDate: '2026-07-09',
        totalInvested: 1,
        totalCurrentValue: 1,
        totalProfitLoss: 0,
        excludedAssetCount: 0,
      })
    ).rejects.toThrow('boom');
  });
});
