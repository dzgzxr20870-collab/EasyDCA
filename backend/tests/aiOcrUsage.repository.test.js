// aiOcrUsage.repository — Quota Usage รายเดือน (Round 9)
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query), rpc: jest.fn() };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const repo = require('../src/repositories/aiOcrUsage.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUsageCount', () => {
  test('มีแถว → คืน count จริง + Query ตาราง/คอลัมน์ถูกต้อง', async () => {
    __query.maybeSingle.mockResolvedValue({ data: { count: 7 }, error: null });

    const result = await repo.getUsageCount('user-1', '2026-07');

    expect(result).toBe(7);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('ai_ocr_usage');
    expect(__query.select).toHaveBeenCalledWith('count');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(__query.eq).toHaveBeenCalledWith('year_month', '2026-07');
  });

  test('ยังไม่มีแถวในเดือนนี้ (data null) → คืน 0', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await repo.getUsageCount('user-1', '2026-07')).toBe(0);
  });

  test('Query ล้มเหลว → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(repo.getUsageCount('user-1', '2026-07')).rejects.toThrow(/Failed to get AI OCR usage/);
  });
});

describe('incrementUsage', () => {
  test('เรียก RPC increment_ai_ocr_usage แบบ Atomic → คืน count ใหม่', async () => {
    supabaseAdmin.rpc.mockResolvedValue({ data: 8, error: null });

    const result = await repo.incrementUsage('user-1', '2026-07');

    expect(result).toBe(8);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('increment_ai_ocr_usage', {
      p_user_id: 'user-1',
      p_year_month: '2026-07',
    });
  });

  test('RPC ล้มเหลว → throw', async () => {
    supabaseAdmin.rpc.mockResolvedValue({ data: null, error: { message: 'rpc down' } });
    await expect(repo.incrementUsage('user-1', '2026-07')).rejects.toThrow(
      /Failed to increment AI OCR usage/
    );
  });
});
