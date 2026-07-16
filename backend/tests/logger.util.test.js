const logger = require('../src/utils/logger.util');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
  console.warn.mockRestore();
  console.error.mockRestore();
});

describe('logger.info', () => {
  test('ออก JSON บรรทัดเดียวผ่าน console.log พร้อม Field ครบ (timestamp, level, message, ...meta)', () => {
    logger.info('test message', { requestId: 'req-abc-123' });

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    const output = console.log.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('test message');
    expect(parsed.requestId).toBe('req-abc-123');
    // timestamp ต้องเป็น ISO String ที่ Parse เป็นวันที่ได้จริง
    expect(new Date(parsed.timestamp).toString()).not.toBe('Invalid Date');
  });

  test('รองรับ webhookEventId แทน/เพิ่มเติมจาก requestId (Correlation Key ของ Webhook)', () => {
    logger.info('processing image message', { webhookEventId: 'evt-123' });

    const parsed = JSON.parse(console.log.mock.calls[0][0]);
    expect(parsed.webhookEventId).toBe('evt-123');
  });

  test('ไม่ส่ง meta มาเลย → ยังคืน JSON ที่มี timestamp/level/message ครบ (ไม่ Crash)', () => {
    logger.info('no meta here');

    const parsed = JSON.parse(console.log.mock.calls[0][0]);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('no meta here');
  });

  test('meta ที่มี Key ชื่อชนกับ Field หลัก (เช่น message) ต้องไม่เบียด Field หลักที่ตั้งใจส่งมา', () => {
    logger.info('real message', { message: 'should not win', requestId: 'req-1' });

    const parsed = JSON.parse(console.log.mock.calls[0][0]);
    expect(parsed.message).toBe('real message');
    expect(parsed.requestId).toBe('req-1');
  });
});

describe('logger.warn', () => {
  test('ออกผ่าน console.warn (ไม่ใช่ console.log/console.error) พร้อม level: warn', () => {
    logger.warn('something looks off', { paymentId: 'pay-1' });

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    const parsed = JSON.parse(console.warn.mock.calls[0][0]);
    expect(parsed.level).toBe('warn');
    expect(parsed.paymentId).toBe('pay-1');
  });
});

describe('logger.error', () => {
  test('ออกผ่าน console.error พร้อม level: error', () => {
    logger.error('handleEvent failed', { webhookEventId: 'evt-9', code: 'INTERNAL_ERROR' });

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();

    const parsed = JSON.parse(console.error.mock.calls[0][0]);
    expect(parsed.level).toBe('error');
    expect(parsed.webhookEventId).toBe('evt-9');
    expect(parsed.code).toBe('INTERNAL_ERROR');
  });
});
