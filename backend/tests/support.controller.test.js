// ═══════════════════════════════════════════════════════════════════════════
// Unit — support.controller (POST /api/v1/support/request)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ต้องพิสูจน์ให้ได้ว่า: (1) ตรวจ Category/ข้อความ/Rate Limit ก่อน Push เสมอ
// (ไม่ผ่านต้องไม่ Push) (2) ตอบ notified ตามผล Push จริง ห้ามโกหกว่าสำเร็จ (3) Log
// ล้มเหลวเป็น Best-effort ไม่ Block Response (Push ถึง Admin คือ Action หลักที่
// เกิดขึ้นจริงแล้ว)

jest.mock('../src/services/supportRequestFlow.service', () => {
  const actual = jest.requireActual('../src/services/supportRequestFlow.service');
  return {
    // คง SupportRequestError จริงไว้ให้ Controller ใช้ instanceof ตรวจ (automock ไม่คง class)
    SupportRequestError: actual.SupportRequestError,
    checkRateLimit: jest.fn(),
    validateMessage: jest.fn(),
    validateCategory: jest.fn(),
    pushSupportRequestToOaGroup: jest.fn(),
    recordRequest: jest.fn(),
  };
});
jest.mock('../src/repositories/user.repository');
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    support: { lineChannelAccessToken: 'support-oa-token', groupId: 'Cgroup1' },
  };
});

const supportRequestFlow = require('../src/services/supportRequestFlow.service');
const userRepository = require('../src/repositories/user.repository');
const supportController = require('../src/controllers/support.controller');
const { SupportRequestError } = supportRequestFlow;

function mockReq({ userId = 'user-1', lineUserId = 'U123', category = 'ocr', message = 'ข้อความทดสอบ' } = {}) {
  return {
    user: { id: userId, lineUserId, role: undefined },
    body: { category, message },
  };
}

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  supportRequestFlow.validateCategory.mockImplementation((c) => c);
  supportRequestFlow.validateMessage.mockImplementation((m) => m);
  supportRequestFlow.checkRateLimit.mockResolvedValue(undefined);
  supportRequestFlow.pushSupportRequestToOaGroup.mockResolvedValue(1);
  supportRequestFlow.recordRequest.mockResolvedValue({ id: 'sr-1' });
  userRepository.findById.mockResolvedValue({ id: 'user-1', displayName: 'สมชาย ใจดี' });
});

describe('submitRequest — Flow ปกติ', () => {
  test('Category+ข้อความถูกต้อง + Push สำเร็จ → 200 { notified: true }', async () => {
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(supportRequestFlow.validateCategory).toHaveBeenCalledWith('ocr');
    expect(supportRequestFlow.validateMessage).toHaveBeenCalledWith('ข้อความทดสอบ');
    expect(supportRequestFlow.checkRateLimit).toHaveBeenCalledWith('user-1');
    expect(supportRequestFlow.pushSupportRequestToOaGroup).toHaveBeenCalledWith(
      { id: 'user-1', lineUserId: 'U123', displayName: 'สมชาย ใจดี' },
      'ข้อความทดสอบ',
      'ocr'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ notified: true });
  });

  test('บันทึก Log ด้วย adminCount/notifiedCount จริง + category + source=web', async () => {
    supportRequestFlow.pushSupportRequestToOaGroup.mockResolvedValue(1);
    const req = mockReq({ category: 'payment_premium' });
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(supportRequestFlow.recordRequest).toHaveBeenCalledWith('user-1', 'ข้อความทดสอบ', {
      adminCount: 1,
      notifiedCount: 1,
      category: 'payment_premium',
      source: 'web',
    });
  });

  test('ยังไม่ได้ตั้งค่า SUPPORT_LINE_GROUP_ID → บันทึก adminCount: 0', async () => {
    const config = require('../src/config/env');
    const original = config.support;
    config.support = { lineChannelAccessToken: 'support-oa-token', groupId: null };

    try {
      supportRequestFlow.pushSupportRequestToOaGroup.mockResolvedValue(0);
      const req = mockReq();
      const res = mockRes();

      await supportController.submitRequest(req, res);

      expect(supportRequestFlow.recordRequest).toHaveBeenCalledWith('user-1', 'ข้อความทดสอบ', {
        adminCount: 0,
        notifiedCount: 0,
        category: 'ocr',
        source: 'web',
      });
    } finally {
      config.support = original;
    }
  });

  test('หา displayName ไม่ได้ (Error) → ยัง Push ต่อได้ด้วยชื่อ null (Non-fatal)', async () => {
    userRepository.findById.mockRejectedValue(new Error('db down'));
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(supportRequestFlow.pushSupportRequestToOaGroup).toHaveBeenCalledWith(
      { id: 'user-1', lineUserId: 'U123', displayName: null },
      'ข้อความทดสอบ',
      'ocr'
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('submitRequest — Validate ก่อนเสมอ (ไม่ผ่าน = ไม่ Push)', () => {
  test('Category ไม่ถูกต้อง → 400 SUPPORT_REQUEST_INVALID_CATEGORY ไม่ Push', async () => {
    supportRequestFlow.validateCategory.mockImplementation(() => {
      throw new SupportRequestError('SUPPORT_REQUEST_INVALID_CATEGORY', 'Invalid category');
    });
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'SUPPORT_REQUEST_INVALID_CATEGORY' });
    expect(supportRequestFlow.pushSupportRequestToOaGroup).not.toHaveBeenCalled();
  });

  test('ข้อความว่าง → 400 SUPPORT_REQUEST_EMPTY_MESSAGE ไม่ Push', async () => {
    supportRequestFlow.validateMessage.mockImplementation(() => {
      throw new SupportRequestError('SUPPORT_REQUEST_EMPTY_MESSAGE', 'Message cannot be empty');
    });
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'SUPPORT_REQUEST_EMPTY_MESSAGE' });
    expect(supportRequestFlow.pushSupportRequestToOaGroup).not.toHaveBeenCalled();
  });

  test('ข้อความยาวเกิน → 400 SUPPORT_REQUEST_MESSAGE_TOO_LONG ไม่ Push', async () => {
    supportRequestFlow.validateMessage.mockImplementation(() => {
      throw new SupportRequestError('SUPPORT_REQUEST_MESSAGE_TOO_LONG', 'Too long');
    });
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(supportRequestFlow.pushSupportRequestToOaGroup).not.toHaveBeenCalled();
  });

  test('Rate Limit → 429 SUPPORT_REQUEST_RATE_LIMITED ไม่ Push', async () => {
    supportRequestFlow.checkRateLimit.mockRejectedValue(
      new SupportRequestError('SUPPORT_REQUEST_RATE_LIMITED', 'rate limited')
    );
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'SUPPORT_REQUEST_RATE_LIMITED' });
    expect(supportRequestFlow.pushSupportRequestToOaGroup).not.toHaveBeenCalled();
    expect(supportRequestFlow.recordRequest).not.toHaveBeenCalled();
  });
});

describe('submitRequest — ตอบตามผล Push จริงเท่านั้น (ห้ามโกหก)', () => {
  test('Push ล้มเหลวทั้งหมด → 200 { notified: false } (ไม่ใช่ Error — คำขอถูกประมวลผลแล้ว)', async () => {
    supportRequestFlow.pushSupportRequestToOaGroup.mockResolvedValue(0);
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ notified: false });
  });

  test('บันทึก Log ล้มเหลว (DB ล่ม) → ยังตอบ 200 ตามผล Push จริง ไม่ Error (Best-effort)', async () => {
    supportRequestFlow.pushSupportRequestToOaGroup.mockResolvedValue(2);
    supportRequestFlow.recordRequest.mockRejectedValue(new Error('db down'));
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ notified: true });
  });
});

describe('submitRequest — Error ที่ไม่คาดคิด', () => {
  test('Error ที่ไม่ใช่ SupportRequestError → 500 INTERNAL_ERROR', async () => {
    supportRequestFlow.checkRateLimit.mockRejectedValue(new Error('unexpected'));
    const req = mockReq();
    const res = mockRes();

    await supportController.submitRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});
