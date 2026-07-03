// Mock Supabase Client เป็น Query Builder แบบ Chainable — select/eq คืน query เดิม
// ส่วน lt เป็น Terminal ที่ Resolve เป็น { data, error } (findExpiredPremiumUsers
// จบ Chain ที่ .lt('plan_expires_at', now))
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.lt = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const userRepository = require('../src/repositories/user.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findExpiredPremiumUsers', () => {
  test('กรอง plan=premium AND plan_expires_at < now แล้ว map เป็น user objects', async () => {
    const now = new Date('2026-07-04T00:00:00.000Z');
    __query.lt.mockResolvedValue({
      data: [
        {
          id: 'u1',
          line_user_id: 'U1',
          display_name: 'A',
          plan: 'premium',
          plan_expires_at: '2026-07-01T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await userRepository.findExpiredPremiumUsers(now);

    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(__query.eq).toHaveBeenCalledWith('plan', 'premium');
    expect(__query.lt).toHaveBeenCalledWith('plan_expires_at', now.toISOString());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'u1', lineUserId: 'U1', plan: 'premium' });
  });

  test('ไม่มีใครหมดอายุ → คืน []', async () => {
    __query.lt.mockResolvedValue({ data: [], error: null });
    expect(await userRepository.findExpiredPremiumUsers(new Date())).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.lt.mockResolvedValue({ data: null, error: { message: 'db blip' } });
    await expect(userRepository.findExpiredPremiumUsers(new Date())).rejects.toThrow('db blip');
  });
});
