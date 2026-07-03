// Mock Supabase Client เป็น Query Builder แบบ Chainable (Pattern เดียวกับ
// transaction.repository.test) — ทุก Method คืน query เดิม ยกเว้น maybeSingle ที่
// Resolve เป็น { data, error } เหมือน PostgREST จริง
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.maybeSingle = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const paymentRepository = require('../src/repositories/payment.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findPendingByUserId', () => {
  test('มีคำขอ pending → คืน payment ล่าสุด (order created_at DESC, limit 1)', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'pay-1',
        user_id: 'user-1',
        billing_period: 'monthly',
        base_amount_thb: 59,
        satang_tag: 17,
        amount_thb: 59.17,
        status: 'pending',
        expires_at: '2026-07-05T00:00:00.000Z',
        created_at: '2026-07-04T00:00:00.000Z',
      },
      error: null,
    });

    const result = await paymentRepository.findPendingByUserId('user-1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('payments');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(__query.eq).toHaveBeenCalledWith('status', 'pending');
    expect(__query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(__query.limit).toHaveBeenCalledWith(1);
    // map เป็น camelCase ตาม toPayment
    expect(result).toMatchObject({ id: 'pay-1', userId: 'user-1', amountThb: 59.17, status: 'pending' });
  });

  test('ไม่มีคำขอ pending → null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await paymentRepository.findPendingByUserId('user-1')).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.findPendingByUserId('user-1')).rejects.toThrow('boom');
  });
});
