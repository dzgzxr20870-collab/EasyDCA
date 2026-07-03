jest.mock('../src/repositories/payment.repository');
jest.mock('../src/repositories/user.repository');
// คง config จริงไว้ (supabase ฯลฯ ให้ automock repository โหลดได้) Override เฉพาะ payment
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    payment: {
      promptpayId: '0812345678',
      adminLineUserIds: ['Uadmin1', 'Uadmin2'],
      premiumPriceMonthly: 59,
      premiumPriceYearly: 590,
    },
  };
});

const paymentRepository = require('../src/repositories/payment.repository');
const userRepository = require('../src/repositories/user.repository');
const config = require('../src/config/env');
const paymentService = require('../src/services/payment.service');

const USER_ID = 'user-uuid-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requestPayment', () => {
  beforeEach(() => {
    // Default: ไม่มีเลขสตางค์ถูกจอง + insert สำเร็จ
    paymentRepository.findPendingSatangTagsByBaseAmount.mockResolvedValue([]);
    paymentRepository.create.mockImplementation(async (data) => ({
      id: 'pay-1',
      ...data,
      status: 'pending',
    }));
  });

  test('สร้างสำเร็จ (monthly) → คืน paymentId/amountThb/qrPayload/expiresAt ครบ', async () => {
    const result = await paymentService.requestPayment(USER_ID, 'monthly');

    expect(result.paymentId).toBe('pay-1');
    // ยอด = 59 + satang/100 → 59.01–59.99
    expect(result.amountThb).toBeGreaterThanOrEqual(59.01);
    expect(result.amountThb).toBeLessThanOrEqual(59.99);
    expect(typeof result.qrPayload).toBe('string');
    expect(result.qrPayload.length).toBeGreaterThan(0);
    expect(result.expiresAt instanceof Date).toBe(true);

    // ยอดฐานที่ส่งเข้า create ต้องเป็น 59 (monthly)
    expect(paymentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, billingPeriod: 'monthly', baseAmountThb: 59 })
    );
  });

  test('yearly → ใช้ยอดฐาน 590', async () => {
    const result = await paymentService.requestPayment(USER_ID, 'yearly');
    expect(result.amountThb).toBeGreaterThanOrEqual(590.01);
    expect(result.amountThb).toBeLessThanOrEqual(590.99);
    expect(paymentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseAmountThb: 590 })
    );
  });

  test('billingPeriod ผิด → VALIDATION_ERROR (ไม่แตะ DB)', async () => {
    await expect(paymentService.requestPayment(USER_ID, 'weekly')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(paymentRepository.create).not.toHaveBeenCalled();
  });

  test('promptpayId ไม่ตั้งค่า → PAYMENT_NOT_CONFIGURED (ก่อนแตะ DB)', async () => {
    const original = config.payment.promptpayId;
    config.payment.promptpayId = null;
    try {
      await expect(paymentService.requestPayment(USER_ID, 'monthly')).rejects.toMatchObject({
        code: 'PAYMENT_NOT_CONFIGURED',
      });
      expect(paymentRepository.create).not.toHaveBeenCalled();
    } finally {
      config.payment.promptpayId = original;
    }
  });

  test('เลขสตางค์ชนกัน (insert throw 23505) → Retry แล้วสำเร็จ', async () => {
    const uniqueErr = new Error('duplicate key value violates unique constraint');
    uniqueErr.code = '23505';
    paymentRepository.create
      .mockRejectedValueOnce(uniqueErr)
      .mockResolvedValueOnce({ id: 'pay-2', status: 'pending' });

    const result = await paymentService.requestPayment(USER_ID, 'monthly');

    expect(result.paymentId).toBe('pay-2');
    expect(paymentRepository.create).toHaveBeenCalledTimes(2);
  });

  test('ชนกันซ้ำครบ 3 ครั้ง → ALLOCATION_CONFLICT', async () => {
    const uniqueErr = new Error('duplicate key');
    uniqueErr.code = '23505';
    paymentRepository.create.mockRejectedValue(uniqueErr);

    await expect(paymentService.requestPayment(USER_ID, 'monthly')).rejects.toMatchObject({
      code: 'ALLOCATION_CONFLICT',
    });
    expect(paymentRepository.create).toHaveBeenCalledTimes(3);
  });

  test('เลขสตางค์เต็มหมด 99 ตัว → SATANG_POOL_EXHAUSTED', async () => {
    paymentRepository.findPendingSatangTagsByBaseAmount.mockResolvedValue(
      Array.from({ length: 99 }, (_, i) => i + 1)
    );

    await expect(paymentService.requestPayment(USER_ID, 'monthly')).rejects.toMatchObject({
      code: 'SATANG_POOL_EXHAUSTED',
    });
    expect(paymentRepository.create).not.toHaveBeenCalled();
  });

  test('insert error อื่นที่ไม่ใช่ Unique Violation → โยนต่อ ไม่ Retry', async () => {
    paymentRepository.create.mockRejectedValue(new Error('connection reset'));

    await expect(paymentService.requestPayment(USER_ID, 'monthly')).rejects.toThrow(
      'connection reset'
    );
    expect(paymentRepository.create).toHaveBeenCalledTimes(1);
  });
});

describe('notifyPaymentSubmitted', () => {
  test('คำขอมีจริง เป็นของ user เอง และ pending → คืน payment', async () => {
    const payment = { id: 'pay-1', userId: USER_ID, status: 'pending' };
    paymentRepository.findById.mockResolvedValue(payment);

    const result = await paymentService.notifyPaymentSubmitted('pay-1', USER_ID);
    expect(result).toBe(payment);
  });

  test('ไม่พบคำขอ → PAYMENT_NOT_FOUND', async () => {
    paymentRepository.findById.mockResolvedValue(null);
    await expect(paymentService.notifyPaymentSubmitted('pay-x', USER_ID)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  test('คำขอเป็นของคนอื่น → PAYMENT_NOT_FOUND (กัน Enumerate)', async () => {
    paymentRepository.findById.mockResolvedValue({
      id: 'pay-1',
      userId: 'someone-else',
      status: 'pending',
    });
    await expect(paymentService.notifyPaymentSubmitted('pay-1', USER_ID)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  test('คำขอไม่ได้ pending แล้ว → PAYMENT_NOT_PENDING', async () => {
    paymentRepository.findById.mockResolvedValue({
      id: 'pay-1',
      userId: USER_ID,
      status: 'confirmed',
    });
    await expect(paymentService.notifyPaymentSubmitted('pay-1', USER_ID)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_PENDING',
    });
  });
});

describe('approvePayment', () => {
  test('Admin ไม่อยู่ใน list → NOT_AUTHORIZED (ไม่ Claim)', async () => {
    await expect(paymentService.approvePayment('pay-1', 'Uunknown')).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    });
    expect(paymentRepository.claimForApproval).not.toHaveBeenCalled();
  });

  test('Claim สำเร็จ → ต่ออายุแบบ Stacking จาก planExpiresAt เดิมของ user', async () => {
    const payment = { id: 'pay-1', userId: USER_ID, billingPeriod: 'monthly' };
    paymentRepository.claimForApproval.mockResolvedValue(payment);
    // user มีวันหมดอายุเดิมในอนาคต → ต้องบวกต่อจากวันนั้น (ไม่ใช่จาก now)
    userRepository.findById.mockResolvedValue({
      id: USER_ID,
      planExpiresAt: '2099-01-15T00:00:00.000Z',
    });
    userRepository.updatePlan.mockImplementation(async (id, plan, expiry) => ({
      id,
      plan,
      planExpiresAt: expiry,
    }));

    const result = await paymentService.approvePayment('pay-1', 'Uadmin1');

    // Stacking: 2099-01-15 + 1 เดือน = 2099-02-15 (พิสูจน์ว่าใช้ planExpiresAt เดิม)
    expect(result.newExpiry.toISOString()).toBe('2099-02-15T00:00:00.000Z');
    expect(userRepository.updatePlan).toHaveBeenCalledWith(
      USER_ID,
      'premium',
      expect.any(Date)
    );
    expect(userRepository.updatePlan.mock.calls[0][2].toISOString()).toBe(
      '2099-02-15T00:00:00.000Z'
    );
  });

  test('Claim คืน null (ถูกจัดการไปแล้ว) → ALREADY_RESOLVED (ไม่แตะ plan)', async () => {
    paymentRepository.claimForApproval.mockResolvedValue(null);

    await expect(paymentService.approvePayment('pay-1', 'Uadmin1')).rejects.toMatchObject({
      code: 'ALREADY_RESOLVED',
    });
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
  });
});

describe('rejectPayment', () => {
  test('Claim สำเร็จ → ไม่แตะ plan ผู้ใช้ คืน payment + user', async () => {
    const payment = { id: 'pay-1', userId: USER_ID, billingPeriod: 'monthly' };
    paymentRepository.claimForRejection.mockResolvedValue(payment);
    userRepository.findById.mockResolvedValue({ id: USER_ID, lineUserId: 'Uowner' });

    const result = await paymentService.rejectPayment('pay-1', 'Uadmin1');

    expect(result.payment).toBe(payment);
    expect(result.user.lineUserId).toBe('Uowner');
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
  });

  test('Admin ไม่อยู่ใน list → NOT_AUTHORIZED', async () => {
    await expect(paymentService.rejectPayment('pay-1', 'Uunknown')).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    });
    expect(paymentRepository.claimForRejection).not.toHaveBeenCalled();
  });

  test('Claim คืน null → ALREADY_RESOLVED', async () => {
    paymentRepository.claimForRejection.mockResolvedValue(null);
    await expect(paymentService.rejectPayment('pay-1', 'Uadmin1')).rejects.toMatchObject({
      code: 'ALREADY_RESOLVED',
    });
  });
});

describe('expireOverduePayments', () => {
  test('หลาย payment 1 ตัว markExpired Fail → ตัวอื่นยังทำต่อ (Error Isolation)', async () => {
    paymentRepository.findExpiredPending.mockResolvedValue([
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
    ]);
    paymentRepository.markExpired
      .mockResolvedValueOnce({ id: 'p1', status: 'expired' }) // สำเร็จ
      .mockRejectedValueOnce(new Error('db blip')) // p2 พัง
      .mockResolvedValueOnce({ id: 'p3', status: 'expired' }); // p3 ยังทำต่อ

    const count = await paymentService.expireOverduePayments();

    expect(count).toBe(2);
    expect(paymentRepository.markExpired).toHaveBeenCalledTimes(3);
  });

  test('markExpired คืน null (ถูก Admin จัดการก่อน) → ไม่นับ', async () => {
    paymentRepository.findExpiredPending.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    paymentRepository.markExpired
      .mockResolvedValueOnce(null) // p1 ถูกจัดการไปแล้ว
      .mockResolvedValueOnce({ id: 'p2', status: 'expired' });

    const count = await paymentService.expireOverduePayments();
    expect(count).toBe(1);
  });
});
