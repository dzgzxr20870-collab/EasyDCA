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

  // Lock-Until-Resolved (migration 016) — P1 ถูก Cron ตีเป็น 'expired' ไปแล้วแต่ยัง
  // unresolved (amount_released_at IS NULL) repository (หลังแก้) จึงยังรายงานเลขสตางค์
  // ของ P1 ว่าถูกจองอยู่ (แม้ status จะไม่ใช่ 'pending' แล้วก็ตาม) — P2 ที่มาขอยอดฐาน
  // เดียวกันต้องได้เลขสตางค์อื่นเสมอ ไม่ชนกับของ P1 (ยืนยัน Root Cause ของบั๊กที่รายงานมา:
  // การจับคู่ยอดกำกวมระหว่างคำขอเก่าที่ยังไม่ Resolve กับคำขอใหม่)
  test('เลขสตางค์ที่ถูกจองโดยคำขอ unresolved (แม้ expired ไปแล้ว) ต้องไม่ถูกจัดสรรซ้ำให้คำขอใหม่', async () => {
    // จำลอง P1: expired แล้วแต่ amount_released_at ยัง NULL → repository (Scope ใหม่
    // ตาม amount_released_at) ยังคืนเลขสตางค์ 17 ว่า "ถูกจองอยู่"
    paymentRepository.findPendingSatangTagsByBaseAmount.mockResolvedValue([17]);

    const result = await paymentService.requestPayment(USER_ID, 'monthly');

    const allocatedSatang = Math.round((result.amountThb - 59) * 100);
    expect(allocatedSatang).not.toBe(17);
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

describe('findPendingByUserId', () => {
  test('มอบต่อ repository และคืนค่าที่ได้ (มีคำขอค้าง)', async () => {
    const pending = { id: 'pay-1', userId: USER_ID, status: 'pending' };
    paymentRepository.findPendingByUserId.mockResolvedValue(pending);

    const result = await paymentService.findPendingByUserId(USER_ID);

    expect(result).toBe(pending);
    expect(paymentRepository.findPendingByUserId).toHaveBeenCalledWith(USER_ID);
  });

  test('ไม่มีคำขอค้าง → null', async () => {
    paymentRepository.findPendingByUserId.mockResolvedValue(null);
    expect(await paymentService.findPendingByUserId(USER_ID)).toBeNull();
  });
});

describe('getPendingPaymentForQr', () => {
  test('พบและ pending → คืน payment', async () => {
    const payment = { id: 'pay-1', status: 'pending', amountThb: 59.17 };
    paymentRepository.findById.mockResolvedValue(payment);

    expect(await paymentService.getPendingPaymentForQr('pay-1')).toBe(payment);
  });

  test('ไม่พบ → PAYMENT_NOT_FOUND', async () => {
    paymentRepository.findById.mockResolvedValue(null);
    await expect(paymentService.getPendingPaymentForQr('x')).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  test('พบแต่ status ไม่ใช่ pending (confirmed) → PAYMENT_NOT_FOUND (Endpoint แปลงเป็น 404)', async () => {
    paymentRepository.findById.mockResolvedValue({
      id: 'pay-1',
      status: 'confirmed',
      amountThb: 59.17,
    });
    await expect(paymentService.getPendingPaymentForQr('pay-1')).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
  });
});

describe('notifyPaymentSubmitted', () => {
  test('คำขอมีจริง เป็นของ user เอง, pending และมีสลิปแนบแล้ว → คืน payment', async () => {
    const payment = {
      id: 'pay-1',
      userId: USER_ID,
      status: 'pending',
      slipImageUrl: 'https://cdn.test/slip.jpg',
    };
    paymentRepository.findById.mockResolvedValue(payment);

    const result = await paymentService.notifyPaymentSubmitted('pay-1', USER_ID);
    expect(result).toBe(payment);
  });

  // Lock-Until-Resolved (migration 016) — ปิดช่องที่ User กด "แจ้งชำระแล้ว" ได้โดยไม่
  // เคยส่งรูปสลิปมาเลย (เดิมเช็คแค่ status='pending' ทำให้ Admin ได้การ์ดที่ไม่มีสลิป)
  test('pending แต่ยังไม่มีสลิปแนบ (slipImageUrl ว่าง) → SLIP_NOT_ATTACHED', async () => {
    paymentRepository.findById.mockResolvedValue({
      id: 'pay-1',
      userId: USER_ID,
      status: 'pending',
      slipImageUrl: null,
    });

    await expect(paymentService.notifyPaymentSubmitted('pay-1', USER_ID)).rejects.toMatchObject({
      code: 'SLIP_NOT_ATTACHED',
    });
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

describe('autoReleaseStaleAmounts', () => {
  test('คำนวณ cutoff = now - 7 วัน แล้วส่งต่อให้ repository.releaseStaleAmounts', async () => {
    const now = new Date('2026-07-17T00:00:00.000Z');
    paymentRepository.releaseStaleAmounts.mockResolvedValue([
      { id: 'p1' },
      { id: 'p2' },
    ]);

    const count = await paymentService.autoReleaseStaleAmounts(now);

    expect(paymentRepository.releaseStaleAmounts).toHaveBeenCalledWith('2026-07-10T00:00:00.000Z');
    expect(count).toBe(2);
  });

  test('ไม่มีคำขอที่ต้องปล่อย (ยังไม่ครบ 7 วัน หรือ Resolve ไปแล้วหมด) → คืน 0 ไม่ error', async () => {
    paymentRepository.releaseStaleAmounts.mockResolvedValue([]);

    const count = await paymentService.autoReleaseStaleAmounts(new Date('2026-07-17T00:00:00.000Z'));

    expect(count).toBe(0);
  });
});

describe('buildQrImageUrl', () => {
  test('ประกอบ URL จาก PUBLIC_BASE_URL (config.app.publicBaseUrl) + paymentId', () => {
    const original = config.app.publicBaseUrl;
    config.app.publicBaseUrl = 'https://api.example.com';
    try {
      expect(paymentService.buildQrImageUrl('pay-1')).toBe(
        'https://api.example.com/api/v1/payment/pay-1/qr.png'
      );
    } finally {
      config.app.publicBaseUrl = original;
    }
  });

  test('ไม่ได้ตั้งค่า PUBLIC_BASE_URL → คืน Path สัมพัทธ์ (ไม่ Crash)', () => {
    const original = config.app.publicBaseUrl;
    config.app.publicBaseUrl = null;
    try {
      expect(paymentService.buildQrImageUrl('pay-1')).toBe('/api/v1/payment/pay-1/qr.png');
    } finally {
      config.app.publicBaseUrl = original;
    }
  });
});

describe('attachSlipImage', () => {
  test('Wrapper บาง ๆ → ส่งต่อ paymentId/url/slipHash ให้ repository.updateSlipImageUrl แล้วคืนผล', async () => {
    paymentRepository.updateSlipImageUrl.mockResolvedValue({
      id: 'pay-1',
      slipImageUrl: 'https://cdn.test/slip.jpg',
      slipHash: 'hash-abc',
    });

    const result = await paymentService.attachSlipImage(
      'pay-1',
      'https://cdn.test/slip.jpg',
      'hash-abc'
    );

    expect(paymentRepository.updateSlipImageUrl).toHaveBeenCalledWith(
      'pay-1',
      'https://cdn.test/slip.jpg',
      'hash-abc'
    );
    expect(result).toMatchObject({ id: 'pay-1', slipImageUrl: 'https://cdn.test/slip.jpg' });
  });
});

// Payment Beta — Duplicate Slip Detection (migration 015)
describe('hashSlipImage', () => {
  test('คำนวณ SHA-256 Hex ของ Buffer แบบ Deterministic (Input เดียวกัน → Hash เดียวกันเสมอ)', () => {
    const buffer = Buffer.from('slip-image-bytes');

    const hash1 = paymentService.hashSlipImage(buffer);
    const hash2 = paymentService.hashSlipImage(buffer);

    expect(hash1).toBe(hash2);
    // SHA-256 Hex ยาว 64 ตัวอักษรเสมอ
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  test('Buffer ต่างกัน → Hash ต่างกัน', () => {
    const hashA = paymentService.hashSlipImage(Buffer.from('slip-A'));
    const hashB = paymentService.hashSlipImage(Buffer.from('slip-B'));

    expect(hashA).not.toBe(hashB);
  });
});

describe('assertSlipNotReused', () => {
  test('slip_hash เคยถูกใช้กับคำขอที่ confirmed แล้ว → throw SLIP_ALREADY_USED', async () => {
    paymentRepository.findConfirmedBySlipHash.mockResolvedValue({
      id: 'pay-old',
      status: 'confirmed',
    });

    await expect(paymentService.assertSlipNotReused('hash-reused')).rejects.toMatchObject({
      code: 'SLIP_ALREADY_USED',
    });
    expect(paymentRepository.findConfirmedBySlipHash).toHaveBeenCalledWith('hash-reused');
  });

  test('slip_hash ไม่เคยมี Payment ที่ confirmed ตรงกันเลย → ผ่านปกติ (ไม่ throw)', async () => {
    paymentRepository.findConfirmedBySlipHash.mockResolvedValue(null);

    await expect(paymentService.assertSlipNotReused('hash-new')).resolves.toBeUndefined();
  });

  test('slip_hash ซ้ำแต่ Payment เดิมคือ rejected/expired (ไม่ใช่ confirmed) → ผ่านปกติ (Retry ได้)', async () => {
    // findConfirmedBySlipHash กรอง status='confirmed' ในชั้น Repository อยู่แล้ว —
    // ถ้าของเดิมเป็น rejected/expired จะไม่ถูกคืนมาจาก Repository เลย (null)
    // จำลอง Behavior นี้ตรงๆ เพื่อยืนยันว่า Service ไม่ Reject กรณีนี้
    paymentRepository.findConfirmedBySlipHash.mockResolvedValue(null);

    await expect(paymentService.assertSlipNotReused('hash-retried-after-reject')).resolves.toBeUndefined();
  });
});
