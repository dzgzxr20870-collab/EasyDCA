jest.mock('../src/services/payment.service', () => {
  const actual = jest.requireActual('../src/services/payment.service');
  return {
    // คง PaymentServiceError จริงไว้ให้ Controller ใช้ instanceof ตรวจ (automock ไม่คง class)
    PaymentServiceError: actual.PaymentServiceError,
    requestPayment: jest.fn(),
    notifyPaymentSubmitted: jest.fn(),
    getPendingPaymentForQr: jest.fn(),
    buildQrImageUrl: jest.fn(() => 'https://api.test/api/v1/payment/pay-1/qr.png'),
  };
});
// promptpayQr + qrImage ใช้ของจริง (Pure) — เพื่อทดสอบว่า Endpoint qr.png คืน PNG
// จริง และตรวจว่ายอดที่ใช้สร้าง Payload มาจาก DB ไม่ใช่ Query Param
jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/line.service');
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

const paymentService = require('../src/services/payment.service');
const promptpayQrService = require('../src/services/promptpayQr.service');
const userRepository = require('../src/repositories/user.repository');
const lineService = require('../src/services/line.service');
const paymentController = require('../src/controllers/payment.controller');
const { PaymentServiceError } = paymentService;

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /payment/request', () => {
  test('สำเร็จ → 200 พร้อมผลลัพธ์', async () => {
    const result = { paymentId: 'pay-1', amountThb: 59.17, qrPayload: '000201...', expiresAt: new Date() };
    paymentService.requestPayment.mockResolvedValue(result);

    const req = { user: { id: 'user-1' }, body: { billingPeriod: 'monthly' } };
    const res = mockRes();
    await paymentController.requestPayment(req, res);

    expect(paymentService.requestPayment).toHaveBeenCalledWith('user-1', 'monthly');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(result);
  });

  test('VALIDATION_ERROR → 400', async () => {
    paymentService.requestPayment.mockRejectedValue(
      new PaymentServiceError('VALIDATION_ERROR', 'bad period')
    );
    const res = mockRes();
    await paymentController.requestPayment({ user: { id: 'u' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'VALIDATION_ERROR' });
  });

  test('PAYMENT_NOT_CONFIGURED → 503', async () => {
    paymentService.requestPayment.mockRejectedValue(
      new PaymentServiceError('PAYMENT_NOT_CONFIGURED', 'no promptpay')
    );
    const res = mockRes();
    await paymentController.requestPayment({ user: { id: 'u' }, body: { billingPeriod: 'monthly' } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('SATANG_POOL_EXHAUSTED / ALLOCATION_CONFLICT → 409', async () => {
    paymentService.requestPayment.mockRejectedValue(
      new PaymentServiceError('ALLOCATION_CONFLICT', 'conflict')
    );
    const res = mockRes();
    await paymentController.requestPayment({ user: { id: 'u' }, body: { billingPeriod: 'monthly' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('Error ไม่คาดคิด (ไม่ใช่ PaymentServiceError) → 500 INTERNAL_ERROR', async () => {
    paymentService.requestPayment.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await paymentController.requestPayment({ user: { id: 'u' }, body: { billingPeriod: 'monthly' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});

describe('POST /payment/:id/notify', () => {
  test('สำเร็จ → Push หา Admin ทุกคน + 200 notified', async () => {
    const payment = { id: 'pay-1', userId: 'user-1', amountThb: 59.17, billingPeriod: 'monthly' };
    paymentService.notifyPaymentSubmitted.mockResolvedValue(payment);
    userRepository.findById.mockResolvedValue({ id: 'user-1', displayName: 'สมชาย' });
    lineService.pushMessage.mockResolvedValue(undefined);

    const req = { user: { id: 'user-1' }, params: { id: 'pay-1' } };
    const res = mockRes();
    await paymentController.notifyPayment(req, res);

    expect(paymentService.notifyPaymentSubmitted).toHaveBeenCalledWith('pay-1', 'user-1');
    // Push ครบ 2 Admin
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin1', expect.any(Object));
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin2', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'notified' });
  });

  test('Push หา Admin 1 คนล้มเหลว → ยังตอบ 200 (Best-effort)', async () => {
    paymentService.notifyPaymentSubmitted.mockResolvedValue({
      id: 'pay-1',
      userId: 'user-1',
      amountThb: 59.17,
      billingPeriod: 'monthly',
    });
    userRepository.findById.mockResolvedValue({ id: 'user-1', displayName: 'สมชาย' });
    lineService.pushMessage
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce(undefined);

    const res = mockRes();
    await paymentController.notifyPayment({ user: { id: 'user-1' }, params: { id: 'pay-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'notified' });
  });

  test('PAYMENT_NOT_FOUND → 404 (ไม่ Push)', async () => {
    paymentService.notifyPaymentSubmitted.mockRejectedValue(
      new PaymentServiceError('PAYMENT_NOT_FOUND', 'not found')
    );
    const res = mockRes();
    await paymentController.notifyPayment({ user: { id: 'user-1' }, params: { id: 'x' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });

  test('PAYMENT_NOT_PENDING → 409', async () => {
    paymentService.notifyPaymentSubmitted.mockRejectedValue(
      new PaymentServiceError('PAYMENT_NOT_PENDING', 'already confirmed')
    );
    const res = mockRes();
    await paymentController.notifyPayment({ user: { id: 'user-1' }, params: { id: 'pay-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  // Lock-Until-Resolved (migration 016) — ยังไม่มีสลิปแนบมาก่อนกด "แจ้งชำระแล้ว"
  test('SLIP_NOT_ATTACHED → 409 (ไม่ Push หา Admin)', async () => {
    paymentService.notifyPaymentSubmitted.mockRejectedValue(
      new PaymentServiceError('SLIP_NOT_ATTACHED', 'no slip attached yet')
    );
    const res = mockRes();
    await paymentController.notifyPayment({ user: { id: 'user-1' }, params: { id: 'pay-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'SLIP_NOT_ATTACHED' });
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });
});

describe('GET /payment/:id/qr.png (ไม่ต้อง Auth)', () => {
  test('ไม่พบ payment → 404 PAYMENT_NOT_FOUND (ไม่ Render รูป)', async () => {
    paymentService.getPendingPaymentForQr.mockRejectedValue(
      new PaymentServiceError('PAYMENT_NOT_FOUND', 'not found')
    );
    const res = mockRes();
    await paymentController.getPaymentQr({ params: { id: 'x' }, query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'PAYMENT_NOT_FOUND' });
    expect(res.send).not.toHaveBeenCalled();
  });

  test('payment status != pending → 404 (service โยน PAYMENT_NOT_FOUND เหมือนกัน)', async () => {
    paymentService.getPendingPaymentForQr.mockRejectedValue(
      new PaymentServiceError('PAYMENT_NOT_FOUND', 'not pending')
    );
    const res = mockRes();
    await paymentController.getPaymentQr({ params: { id: 'pay-1' }, query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  test('พบและ pending → คืน PNG จริง (Content-Type image/png + PNG signature ถูกต้อง)', async () => {
    paymentService.getPendingPaymentForQr.mockResolvedValue({
      id: 'pay-1',
      status: 'pending',
      amountThb: 59.17,
    });
    const res = mockRes();
    await paymentController.getPaymentQr({ params: { id: 'pay-1' }, query: {} }, res);

    expect(res.set).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(200);

    const sent = res.send.mock.calls[0][0];
    expect(Buffer.isBuffer(sent)).toBe(true);
    // PNG magic number (89 50 4E 47 0D 0A 1A 0A)
    expect(sent.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  test('ปฏิเสธ amount จาก query param เสมอ — ใช้ยอดจาก DB (payment.amountThb) เท่านั้น', async () => {
    paymentService.getPendingPaymentForQr.mockResolvedValue({
      id: 'pay-1',
      status: 'pending',
      amountThb: 59.17,
    });
    const spy = jest.spyOn(promptpayQrService, 'buildPromptPayPayload');

    const res = mockRes();
    // แนบ amount ปลอมใน query — ต้องถูกเพิกเฉย
    await paymentController.getPaymentQr(
      { params: { id: 'pay-1' }, query: { amount: '999999' } },
      res
    );

    // Payload ถูกสร้างจากยอดใน DB (59.17) ด้วย promptpayId จาก config (mock)
    expect(spy).toHaveBeenCalledWith('0812345678', 59.17);
    // ต้องไม่เคยถูกเรียกด้วยยอดจาก query (ทั้งแบบ string และ number)
    expect(spy).not.toHaveBeenCalledWith(expect.anything(), 999999);
    expect(spy).not.toHaveBeenCalledWith(expect.anything(), '999999');
    expect(res.status).toHaveBeenCalledWith(200);

    spy.mockRestore();
  });

  test('promptpayId ไม่ตั้งค่า → 503 PAYMENT_NOT_CONFIGURED', async () => {
    paymentService.getPendingPaymentForQr.mockResolvedValue({
      id: 'pay-1',
      status: 'pending',
      amountThb: 59.17,
    });
    const config = require('../src/config/env');
    const original = config.payment.promptpayId;
    config.payment.promptpayId = null;
    try {
      const res = mockRes();
      await paymentController.getPaymentQr({ params: { id: 'pay-1' }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ error: 'PAYMENT_NOT_CONFIGURED' });
    } finally {
      config.payment.promptpayId = original;
    }
  });
});
