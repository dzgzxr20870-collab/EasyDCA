// Mock Supabase Client เป็น Query Builder แบบ Chainable (Pattern เดียวกับ
// transaction.repository.test) — ทุก Method คืน query เดิม ยกเว้น maybeSingle ที่
// Resolve เป็น { data, error } เหมือน PostgREST จริง
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.update = jest.fn(() => query);
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

describe('findAll', () => {
  test('ไม่ส่ง status → คืนทุกสถานะ (order created_at DESC) + Join displayName', async () => {
    __query.order.mockResolvedValueOnce({
      data: [
        {
          id: 'pay-2',
          user_id: 'user-2',
          billing_period: 'yearly',
          amount_thb: 590.42,
          status: 'confirmed',
          confirmed_at: '2026-07-03T00:00:00.000Z',
          created_at: '2026-07-02T00:00:00.000Z',
          users: { display_name: 'สมหญิง' },
        },
      ],
      error: null,
    });

    const result = await paymentRepository.findAll();

    expect(supabaseAdmin.from).toHaveBeenCalledWith('payments');
    expect(__query.select).toHaveBeenCalledWith('*, users(display_name)');
    // ไม่มี Filter status
    expect(__query.eq).not.toHaveBeenCalled();
    expect(__query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result[0]).toMatchObject({
      id: 'pay-2',
      userId: 'user-2',
      amountThb: 590.42,
      billingPeriod: 'yearly',
      status: 'confirmed',
      displayName: 'สมหญิง',
    });
  });

  test('ส่ง status → กรองด้วย .eq(status) ก่อน order', async () => {
    __query.order.mockResolvedValueOnce({ data: [], error: null });

    await paymentRepository.findAll({ status: 'confirmed' });

    expect(__query.eq).toHaveBeenCalledWith('status', 'confirmed');
    expect(__query.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  test('User ที่ Join ไม่เจอ (users = null) → displayName: null (ไม่ crash)', async () => {
    __query.order.mockResolvedValueOnce({
      data: [{ id: 'pay-3', user_id: 'user-3', amount_thb: 59, status: 'pending', users: null }],
      error: null,
    });

    const result = await paymentRepository.findAll();
    expect(result[0].displayName).toBeNull();
  });

  test('ไม่มี Payment เลย (data = []) → คืน []', async () => {
    __query.order.mockResolvedValueOnce({ data: [], error: null });
    expect(await paymentRepository.findAll()).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.order.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.findAll()).rejects.toThrow('boom');
  });
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

describe('updateSlipImageUrl', () => {
  test('อัปเดตเฉพาะ slip_image_url ตาม id (ไม่แตะ status) → คืน payment ที่อัปเดต', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'pay-1',
        user_id: 'user-1',
        amount_thb: 59.17,
        status: 'pending',
        slip_image_url: 'https://cdn.test/slip.jpg',
      },
      error: null,
    });

    const result = await paymentRepository.updateSlipImageUrl('pay-1', 'https://cdn.test/slip.jpg');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('payments');
    expect(__query.update).toHaveBeenCalledWith({ slip_image_url: 'https://cdn.test/slip.jpg' });
    expect(__query.eq).toHaveBeenCalledWith('id', 'pay-1');
    // ไม่มี Guard status='pending' (ต่างจาก claimForApproval) — .eq เรียกครั้งเดียว (id)
    expect(__query.eq).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'pay-1', slipImageUrl: 'https://cdn.test/slip.jpg' });
  });

  test('ไม่พบ id → คืน null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await paymentRepository.updateSlipImageUrl('nope', 'url')).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.updateSlipImageUrl('pay-1', 'url')).rejects.toThrow('boom');
  });
});
