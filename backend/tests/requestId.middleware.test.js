jest.mock('../src/utils/logger.util');

const logger = require('../src/utils/logger.util');
const requestId = require('../src/middleware/requestId.middleware');

function mockReq(headers = {}) {
  return { headers, method: 'GET', path: '/api/v1/dashboard' };
}

function mockRes() {
  const res = {};
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requestId middleware', () => {
  test('ไม่มี X-Request-Id มาจาก Client → สร้าง UUID ใหม่ แนบ req.id + Echo กลับเป็น Response Header', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(typeof req.id).toBe('string');
    // UUID v4 Format (crypto.randomUUID())
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('มี X-Request-Id มาจาก Client อยู่แล้ว → ใช้ค่าเดิมต่อ ไม่สร้าง UUID ใหม่ทับ', () => {
    const req = mockReq({ 'x-request-id': 'trace-id-from-proxy-123' });
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.id).toBe('trace-id-from-proxy-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'trace-id-from-proxy-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('X-Request-Id เป็นค่าว่าง/เว้นวรรคล้วน → ถือว่าไม่มี สร้าง UUID ใหม่แทน', () => {
    const req = mockReq({ 'x-request-id': '   ' });
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.id.trim()).not.toBe('');
    expect(req.id).not.toBe('   ');
  });

  test('Log ระดับ info ด้วย Method + Path + requestId ก่อนเรียก next()', () => {
    const req = mockReq();
    req.method = 'POST';
    req.path = '/api/v1/webhook';
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(logger.info).toHaveBeenCalledWith('POST /api/v1/webhook', { requestId: req.id });
  });

  test('2 Request ติดกันไม่มี Header มา → ได้ req.id ไม่ซ้ำกัน', () => {
    const req1 = mockReq();
    const req2 = mockReq();
    requestId(req1, mockRes(), jest.fn());
    requestId(req2, mockRes(), jest.fn());

    expect(req1.id).not.toBe(req2.id);
  });
});
