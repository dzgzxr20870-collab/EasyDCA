// Mock Supabase Client เป็น Query Builder แบบ Chainable — insert/select คืน query เดิม
// ส่วน single/maybeSingle เป็น Terminal ที่ Resolve เป็น { data, error } เหมือน
// PostgREST จริง (Pattern เดียวกับ broadcastLog.repository.test.js)
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.insert = jest.fn(() => query);
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.gte = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.single = jest.fn();
  query.maybeSingle = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const supportRequestRepository = require('../src/repositories/supportRequest.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('supportRequest.repository.create', () => {
  test('Insert แบบ snake_case แล้ว map กลับเป็น camelCase (toSupportRequest)', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'sr-1',
        user_id: 'user-1',
        message: 'จ่ายเงินแล้วไม่ได้ Premium',
        admin_count: 2,
        notified_count: 1,
        created_at: '2026-07-26T00:00:00.000Z',
      },
      error: null,
    });

    const result = await supportRequestRepository.create({
      userId: 'user-1',
      message: 'จ่ายเงินแล้วไม่ได้ Premium',
      adminCount: 2,
      notifiedCount: 1,
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith('support_requests');
    expect(__query.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      message: 'จ่ายเงินแล้วไม่ได้ Premium',
      admin_count: 2,
      notified_count: 1,
    });
    expect(result).toMatchObject({
      id: 'sr-1',
      userId: 'user-1',
      message: 'จ่ายเงินแล้วไม่ได้ Premium',
      adminCount: 2,
      notifiedCount: 1,
    });
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(
      supportRequestRepository.create({
        userId: 'user-1',
        message: 'x',
        adminCount: 0,
        notifiedCount: 0,
      })
    ).rejects.toThrow('db down');
  });
});

describe('supportRequest.repository.findRecentByUser', () => {
  test('มีแถวภายใน cutoff → คืน Object ที่ Map แล้ว', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'sr-1',
        user_id: 'user-1',
        message: 'x',
        admin_count: 1,
        notified_count: 1,
        created_at: '2026-07-26T00:00:00.000Z',
      },
      error: null,
    });

    const result = await supportRequestRepository.findRecentByUser('user-1', '2026-07-25T00:00:00.000Z');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('support_requests');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(__query.gte).toHaveBeenCalledWith('created_at', '2026-07-25T00:00:00.000Z');
    expect(result).toMatchObject({ id: 'sr-1', userId: 'user-1' });
  });

  test('ไม่มีแถวภายใน cutoff → คืน null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await supportRequestRepository.findRecentByUser('user-1', '2026-07-25T00:00:00.000Z');

    expect(result).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(
      supportRequestRepository.findRecentByUser('user-1', '2026-07-25T00:00:00.000Z')
    ).rejects.toThrow('db down');
  });
});
