// Mock config/env เพื่อคุม jwtSecret / jwtExpiresIn แบบ Deterministic
jest.mock('../src/config/env', () => ({
  auth: {
    jwtSecret: 'test_secret_key_for_jwt',
    jwtExpiresIn: '7d',
  },
}));

const jwt = require('jsonwebtoken');
const { issueUserToken, verifyUserToken } = require('../src/services/authToken.service');

const JWT_SECRET = 'test_secret_key_for_jwt';

describe('issueUserToken', () => {
  test('ออก Token ที่มี sub = user.id และ lineUserId (จาก camelCase lineUserId)', () => {
    const token = issueUserToken({ id: 'user-1', lineUserId: 'U123' });

    const decoded = jwt.verify(token, JWT_SECRET);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.lineUserId).toBe('U123');
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  test('รองรับ Raw Row จาก DB (snake_case line_user_id) ด้วย', () => {
    const token = issueUserToken({ id: 'user-2', line_user_id: 'U456' });

    const decoded = jwt.verify(token, JWT_SECRET);
    expect(decoded.sub).toBe('user-2');
    expect(decoded.lineUserId).toBe('U456');
  });
});

describe('verifyUserToken', () => {
  test('Token ที่ถูกต้อง → คืน Payload', () => {
    const token = issueUserToken({ id: 'user-1', lineUserId: 'U123' });

    const payload = verifyUserToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.lineUserId).toBe('U123');
  });

  test('Token ปลอม (Sign ด้วย Secret อื่น) → throw', () => {
    const forged = jwt.sign({ sub: 'attacker' }, 'wrong_secret');

    expect(() => verifyUserToken(forged)).toThrow();
  });

  test('Token หมดอายุ → throw TokenExpiredError', () => {
    // Sign ด้วย Secret เดียวกันแต่ตั้งให้หมดอายุไปแล้ว
    const expired = jwt.sign({ sub: 'user-1' }, JWT_SECRET, { expiresIn: '-1s' });

    expect(() => verifyUserToken(expired)).toThrow(jwt.TokenExpiredError);
  });

  test('String ที่ไม่ใช่ JWT → throw', () => {
    expect(() => verifyUserToken('not-a-jwt')).toThrow();
  });
});
