jest.mock('../src/services/broker.service');

const brokerService = require('../src/services/broker.service');
const {
  listBrokers,
  createBroker,
  updateBroker,
  deleteBroker,
} = require('../src/controllers/brokers.controller');

// service เป็น Automock — class + ค่าคงที่หายไป ต้องประกาศเอง
// (Pattern เดียวกับ dcaPlans.controller.test.js)
class MockBrokerServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrokerServiceError';
    this.code = code;
    this.details = details;
  }
}
brokerService.BrokerServiceError = MockBrokerServiceError;
brokerService.BROKER_NAME_MAX_LENGTH = 60;

const USER_ID = 'user-uuid-1';
// ⚠️ ต้องเป็น UUID จริง: Controller Validate รูปแบบ id ก่อนเรียก Service — id ปลอม
// อย่าง 'broker-1' จะได้ 404 ตั้งแต่ด่านแรก ทำให้ Test ที่ตั้งใจครอบ Logic ชั้นหลัง
// "เขียวโดยไม่ได้ทดสอบอะไรเลย" (บทเรียนเดียวกับ dcaPlans.controller.test.js)
const BROKER_ID = '11111111-2222-4333-8444-555555555555';

function mockReq({ body = {}, params = {} } = {}) {
  return { user: { id: USER_ID }, body, params };
}
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const jsonOf = (res) => res.json.mock.calls[0][0];
const statusOf = (res) => res.status.mock.calls[0][0];

const SAMPLE = {
  id: BROKER_ID,
  userId: USER_ID,
  name: 'Bitkub',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/brokers', () => {
  test('200 พร้อมรายการโบรก', async () => {
    brokerService.listBrokers.mockResolvedValue([SAMPLE]);
    const res = mockRes();

    await listBrokers(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).brokers).toHaveLength(1);
    expect(jsonOf(res).brokers[0].name).toBe('Bitkub');
  });

  test('ไม่ส่ง userId กลับออกไปฝั่ง Client (ลดพื้นที่รั่วโดยไม่จำเป็น)', async () => {
    brokerService.listBrokers.mockResolvedValue([SAMPLE]);
    const res = mockRes();

    await listBrokers(mockReq(), res);

    expect(jsonOf(res).brokers[0]).not.toHaveProperty('userId');
    expect(JSON.stringify(jsonOf(res))).not.toContain(USER_ID);
  });

  test('userId ที่ส่งให้ Service มาจาก req.user เท่านั้น ไม่ใช่จาก Body', async () => {
    brokerService.listBrokers.mockResolvedValue([]);
    const res = mockRes();

    await listBrokers(mockReq({ body: { userId: 'user-of-someone-else' } }), res);

    expect(brokerService.listBrokers).toHaveBeenCalledWith(USER_ID);
  });

  test('Service พังโดยไม่คาดคิด → 500 INTERNAL_ERROR (ไม่ใช่ 200 ที่มีรายการว่าง)', async () => {
    // ถ้าตอบ 200 + [] ผู้ใช้จะเห็นว่า "ไม่มีโบรกเลย" ทั้งที่จริงมี — เป็น Silent
    // Default ที่ทำให้ผู้ใช้เข้าใจผิดว่าข้อมูลหาย
    brokerService.listBrokers.mockRejectedValue(new Error('boom'));
    const res = mockRes();

    await listBrokers(mockReq(), res);

    expect(statusOf(res)).toBe(500);
    expect(jsonOf(res).error).toBe('INTERNAL_ERROR');
  });
});

describe('POST /api/v1/brokers', () => {
  test('201 พร้อมโบรกที่สร้าง', async () => {
    brokerService.createBroker.mockResolvedValue(SAMPLE);
    const res = mockRes();

    await createBroker(mockReq({ body: { name: 'Bitkub' } }), res);

    expect(statusOf(res)).toBe(201);
    expect(jsonOf(res).broker.name).toBe('Bitkub');
    expect(brokerService.createBroker).toHaveBeenCalledWith(USER_ID, 'Bitkub');
  });

  test('VALIDATION_ERROR → 400 พร้อมข้อความไทยที่บอกเพดานความยาวจริง', async () => {
    brokerService.createBroker.mockRejectedValue(
      new MockBrokerServiceError('VALIDATION_ERROR', 'bad', { field: 'name' })
    );
    const res = mockRes();

    await createBroker(mockReq({ body: { name: '' } }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(jsonOf(res).message).toContain('60');
  });

  test('BROKER_NAME_EXISTS → 409 พร้อมบอกชื่อเดิมที่ชนกัน', async () => {
    brokerService.createBroker.mockRejectedValue(
      new MockBrokerServiceError('BROKER_NAME_EXISTS', 'dup', {
        existingName: 'Bitkub',
        existingId: BROKER_ID,
      })
    );
    const res = mockRes();

    await createBroker(mockReq({ body: { name: 'BITKUB' } }), res);

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).details.existingName).toBe('Bitkub');
  });

  test('body ที่ไม่มีเลย (undefined) ไม่ทำให้ Controller พัง', async () => {
    brokerService.createBroker.mockRejectedValue(
      new MockBrokerServiceError('VALIDATION_ERROR', 'bad', {})
    );
    const res = mockRes();

    await createBroker({ user: { id: USER_ID }, params: {} }, res);

    expect(statusOf(res)).toBe(400);
  });
});

describe('PATCH /api/v1/brokers/:id', () => {
  test('200 เมื่อเปลี่ยนชื่อสำเร็จ', async () => {
    brokerService.renameBroker.mockResolvedValue({ ...SAMPLE, name: 'Binance' });
    const res = mockRes();

    await updateBroker(mockReq({ params: { id: BROKER_ID }, body: { name: 'Binance' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).broker.name).toBe('Binance');
  });

  test('id ที่ไม่ใช่รูปแบบ UUID → 404 ทันที ไม่ยิง Service (กัน Postgres 22P02 → 500)', async () => {
    const res = mockRes();

    await updateBroker(mockReq({ params: { id: 'not-a-uuid' }, body: { name: 'X' } }), res);

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('BROKER_NOT_FOUND');
    expect(brokerService.renameBroker).not.toHaveBeenCalled();
  });

  test('BROKER_NOT_FOUND (ของผู้ใช้คนอื่น) → 404 ไม่ใช่ 403', async () => {
    // 403 เท่ากับบอกผู้โจมตีว่า "id นี้มีอยู่จริงแต่เป็นของคนอื่น" — ห้ามยืนยัน
    // การมีอยู่ของข้อมูลผู้ใช้รายอื่น (Design Doc § 6.3)
    brokerService.renameBroker.mockRejectedValue(
      new MockBrokerServiceError('BROKER_NOT_FOUND', 'not found', {})
    );
    const res = mockRes();

    await updateBroker(mockReq({ params: { id: BROKER_ID }, body: { name: 'X' } }), res);

    expect(statusOf(res)).toBe(404);
  });
});

describe('DELETE /api/v1/brokers/:id', () => {
  test('200 พร้อมข้อความยืนยันว่าสินทรัพย์ที่ผูกไว้ยังอยู่ครบ', async () => {
    brokerService.deleteBroker.mockResolvedValue({ id: BROKER_ID });
    const res = mockRes();

    await deleteBroker(mockReq({ params: { id: BROKER_ID } }), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).deleted.id).toBe(BROKER_ID);
    // "บอกผลลัพธ์ที่เกิดกับผู้ใช้ก่อน" — ผู้ใช้ต้องรู้ทันทีว่าไม่ได้ลบสินทรัพย์ทิ้ง
    expect(jsonOf(res).message).toContain('ยังอยู่ครบ');
  });

  test('id ที่ไม่ใช่ UUID → 404 ทันที ไม่ยิง Service', async () => {
    const res = mockRes();

    await deleteBroker(mockReq({ params: { id: '../../etc/passwd' } }), res);

    expect(statusOf(res)).toBe(404);
    expect(brokerService.deleteBroker).not.toHaveBeenCalled();
  });

  test('BROKER_NOT_FOUND → 404', async () => {
    brokerService.deleteBroker.mockRejectedValue(
      new MockBrokerServiceError('BROKER_NOT_FOUND', 'not found', {})
    );
    const res = mockRes();

    await deleteBroker(mockReq({ params: { id: BROKER_ID } }), res);

    expect(statusOf(res)).toBe(404);
  });
});
