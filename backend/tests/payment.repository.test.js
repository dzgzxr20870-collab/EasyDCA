// Mock Supabase Client เป็น Query Builder แบบ Chainable (Pattern เดียวกับ
// transaction.repository.test) — ทุก Method คืน query เดิม ยกเว้น maybeSingle ที่
// Resolve เป็น { data, error } เหมือน PostgREST จริง
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.update = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.lt = jest.fn(() => query);
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

// PDPA Self-Service Erasure (userErasure.service) — หา paymentId ทั้งหมดของ User
// (ทุกสถานะ) เพื่อรู้ว่าต้องลบสลิปไฟล์ไหนออกจาก Storage บ้าง
describe('findAllByUserId', () => {
  test('คืน Payment ทั้งหมดของ user (ทุกสถานะ ไม่ Filter)', async () => {
    __query.eq.mockResolvedValueOnce({
      data: [
        { id: 'pay-1', user_id: 'user-1', amount_thb: 59.17, status: 'confirmed' },
        { id: 'pay-2', user_id: 'user-1', amount_thb: 590.05, status: 'pending' },
      ],
      error: null,
    });

    const result = await paymentRepository.findAllByUserId('user-1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('payments');
    expect(__query.select).toHaveBeenCalledWith('*');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'pay-1', status: 'confirmed' });
  });

  test('ไม่มี Payment เลย → คืน []', async () => {
    __query.eq.mockResolvedValueOnce({ data: [], error: null });
    expect(await paymentRepository.findAllByUserId('user-1')).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.eq.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.findAllByUserId('user-1')).rejects.toThrow('boom');
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

  // Payment Beta (migration 015) — slipHash เป็น Parameter ที่ 3 (Optional)
  test('ส่ง slipHash มาด้วย → update พร้อม slip_hash', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'pay-1',
        user_id: 'user-1',
        amount_thb: 59.17,
        status: 'pending',
        slip_image_url: 'https://cdn.test/slip.jpg',
        slip_hash: 'hash-abc',
      },
      error: null,
    });

    const result = await paymentRepository.updateSlipImageUrl(
      'pay-1',
      'https://cdn.test/slip.jpg',
      'hash-abc'
    );

    expect(__query.update).toHaveBeenCalledWith({
      slip_image_url: 'https://cdn.test/slip.jpg',
      slip_hash: 'hash-abc',
    });
    expect(result).toMatchObject({ id: 'pay-1', slipHash: 'hash-abc' });
  });
});

describe('findPendingSatangTagsByBaseAmount', () => {
  // Regression test สำหรับบั๊กที่รายงานมา (PromptPay QR Reuse): โค้ดเดิม Query
  // ด้วย .eq('status', 'pending') ซึ่งจะ "ไม่เห็น" คำขอที่ Cron เพิ่งตีเป็น 'expired'
  // ไปแล้ว ทำให้เศษสตางค์ของคำขอนั้นถูกปล่อยคืนให้คำขอใหม่ใช้ซ้ำได้ทันที ทั้งที่ QR เดิม
  // (Static Tag 29 ไม่มี Expiry ระดับธนาคาร) ยังใช้โอนเงินได้จริง — Assert นี้ต้อง Fail
  // ถ้า Revert กลับไปใช้ .eq('status', 'pending') (จะไม่มีการเรียก .is เลย) และต้อง Pass
  // หลัง migration 016 เพราะ Scope เปลี่ยนไปตาม amount_released_at แทน (ครอบคลุมทั้ง
  // pending และ expired-แต่-ยังไม่ Resolve)
  test('คืนเลขสตางค์ของคำขอที่ยัง unresolved (amount_released_at IS NULL)', async () => {
    __query.is.mockResolvedValueOnce({
      data: [{ satang_tag: 17 }, { satang_tag: 42 }],
      error: null,
    });

    const result = await paymentRepository.findPendingSatangTagsByBaseAmount(59);

    expect(supabaseAdmin.from).toHaveBeenCalledWith('payments');
    expect(__query.select).toHaveBeenCalledWith('satang_tag');
    expect(__query.eq).toHaveBeenCalledWith('base_amount_thb', 59);
    // migration 016: Scope ตาม amount_released_at IS NULL แทน status='pending' เดิม
    expect(__query.is).toHaveBeenCalledWith('amount_released_at', null);
    expect(result).toEqual([17, 42]);
  });

  test('ไม่มีคำขอ unresolved เลย → []', async () => {
    __query.is.mockResolvedValueOnce({ data: [], error: null });
    expect(await paymentRepository.findPendingSatangTagsByBaseAmount(59)).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.is.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.findPendingSatangTagsByBaseAmount(59)).rejects.toThrow('boom');
  });
});

describe('claimForApproval', () => {
  test('Claim สำเร็จ → status=confirmed + amount_released_at ถูกตั้งค่า + guard status IN (pending, expired)', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'pay-1',
        user_id: 'user-1',
        amount_thb: 59.17,
        status: 'confirmed',
        confirmed_by: 'Uadmin1',
        confirmed_at: '2026-07-17T00:00:00.000Z',
        amount_released_at: '2026-07-17T00:00:00.000Z',
      },
      error: null,
    });

    const result = await paymentRepository.claimForApproval('pay-1', 'Uadmin1');

    expect(__query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        confirmed_by: 'Uadmin1',
        confirmed_at: expect.any(String),
        amount_released_at: expect.any(String),
      })
    );
    expect(__query.eq).toHaveBeenCalledWith('id', 'pay-1');
    // migration 016: Guard กว้างกว่าเดิม — รับทั้ง 'pending' และ 'expired' (Admin ยัง
    // Resolve คำขอที่ Cron หมดอายุไปแล้วได้ตามปกติ)
    expect(__query.in).toHaveBeenCalledWith('status', ['pending', 'expired']);
    expect(result).toMatchObject({ id: 'pay-1', status: 'confirmed', amountReleasedAt: '2026-07-17T00:00:00.000Z' });
  });

  test('Resolve ไปแล้ว (confirmed/rejected) → maybeSingle คืน null → claimForApproval คืน null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await paymentRepository.claimForApproval('pay-1', 'Uadmin1')).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.claimForApproval('pay-1', 'Uadmin1')).rejects.toThrow('boom');
  });
});

describe('claimForRejection', () => {
  test('Claim สำเร็จ → status=rejected + amount_released_at ถูกตั้งค่า + guard status IN (pending, expired)', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'pay-1',
        user_id: 'user-1',
        amount_thb: 59.17,
        status: 'rejected',
        confirmed_by: 'Uadmin1',
        confirmed_at: '2026-07-17T00:00:00.000Z',
        amount_released_at: '2026-07-17T00:00:00.000Z',
      },
      error: null,
    });

    const result = await paymentRepository.claimForRejection('pay-1', 'Uadmin1');

    expect(__query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        confirmed_by: 'Uadmin1',
        confirmed_at: expect.any(String),
        amount_released_at: expect.any(String),
      })
    );
    expect(__query.in).toHaveBeenCalledWith('status', ['pending', 'expired']);
    expect(result).toMatchObject({ id: 'pay-1', status: 'rejected' });
  });

  test('Resolve ไปแล้ว → คืน null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await paymentRepository.claimForRejection('pay-1', 'Uadmin1')).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.claimForRejection('pay-1', 'Uadmin1')).rejects.toThrow('boom');
  });
});

describe('releaseStaleAmounts', () => {
  test('ปล่อยยอดคืนของแถวที่ unresolved เกิน cutoff → คืน payment ที่อัปเดตแล้วทั้งหมด', async () => {
    __query.select.mockResolvedValueOnce({
      data: [
        { id: 'pay-1', user_id: 'user-1', amount_thb: 59.17, status: 'expired', amount_released_at: '2026-07-17T00:00:00.000Z' },
        { id: 'pay-2', user_id: 'user-2', amount_thb: 590.42, status: 'pending', amount_released_at: '2026-07-17T00:00:00.000Z' },
      ],
      error: null,
    });

    const result = await paymentRepository.releaseStaleAmounts('2026-07-10T00:00:00.000Z');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('payments');
    expect(__query.update).toHaveBeenCalledWith({ amount_released_at: expect.any(String) });
    expect(__query.is).toHaveBeenCalledWith('amount_released_at', null);
    expect(__query.lt).toHaveBeenCalledWith('created_at', '2026-07-10T00:00:00.000Z');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'pay-1' });
  });

  test('ไม่มีแถวที่ต้องปล่อย → คืน []', async () => {
    __query.select.mockResolvedValueOnce({ data: [], error: null });
    expect(await paymentRepository.releaseStaleAmounts('2026-07-10T00:00:00.000Z')).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.select.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.releaseStaleAmounts('2026-07-10T00:00:00.000Z')).rejects.toThrow('boom');
  });
});

describe('findConfirmedBySlipHash', () => {
  test('มี Payment ที่ status=confirmed ตรงกับ slip_hash → คืน Payment นั้น', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'pay-old',
        user_id: 'user-1',
        amount_thb: 59.17,
        status: 'confirmed',
        slip_hash: 'hash-reused',
      },
      error: null,
    });

    const result = await paymentRepository.findConfirmedBySlipHash('hash-reused');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('payments');
    expect(__query.eq).toHaveBeenCalledWith('slip_hash', 'hash-reused');
    expect(__query.eq).toHaveBeenCalledWith('status', 'confirmed');
    expect(__query.limit).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({ id: 'pay-old', status: 'confirmed', slipHash: 'hash-reused' });
  });

  test('ไม่มี Payment ที่ confirmed ตรงกับ slip_hash นี้ → null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await paymentRepository.findConfirmedBySlipHash('hash-new')).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(paymentRepository.findConfirmedBySlipHash('hash-x')).rejects.toThrow('boom');
  });
});
