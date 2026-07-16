// Regression: JWT_EXPIRES_IN Default ต้องเป็น 24h (S6 Part A — ย่นจาก 7d เดิมก่อน
// Beta Launch) — แยกไฟล์ต่างหากจาก authToken.service.test.js เพราะไฟล์นั้น Mock
// config/env ทั้งไฟล์ (jest.mock Hoisted ทั้งไฟล์) ทำให้ทดสอบ Default จริงจาก env.js
// ไม่ได้ในไฟล์เดียวกัน
//
// Mock dotenv ให้เป็น No-op เพื่อไม่ให้ .env จริงของเครื่อง Dev (ที่อาจตั้ง
// JWT_EXPIRES_IN เอง) มาปนกับการทดสอบ Fallback Default ของโค้ดเอง — ต้องการทดสอบ
// เฉพาะ `process.env.JWT_EXPIRES_IN || '24h'` ใน env.js ตรงๆ
jest.mock('dotenv', () => ({ config: jest.fn() }));

const jwt = require('jsonwebtoken');

// 4 ตัวแปรที่ env.js บังคับต้องมี (REQUIRED_ENV_VARS) — ตั้งค่า Dummy ให้ validateEnv()
// ผ่านโดยไม่พึ่ง .env จริงของเครื่อง (dotenv ถูก Mock เป็น No-op ด้านบนแล้ว)
const REQUIRED_DUMMY_ENV = {
  LINE_CHANNEL_SECRET: 'test-line-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'test-line-token',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

describe('JWT_EXPIRES_IN default (config/env.js)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, ...REQUIRED_DUMMY_ENV };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('ไม่ตั้ง JWT_EXPIRES_IN → env.js ใช้ Default ใหม่ 24h (ไม่ใช่ 7d เดิม)', () => {
    delete process.env.JWT_EXPIRES_IN;

    const config = require('../src/config/env');

    expect(config.auth.jwtExpiresIn).toBe('24h');
  });

  test('Token ที่ Sign ด้วย Default นี้ → exp - iat = 86400 วินาที (24 ชม. ไม่ใช่ 604800 วินาที = 7 วัน)', () => {
    delete process.env.JWT_EXPIRES_IN;
    process.env.JWT_SECRET = 'test-secret-default-expiry';

    const { issueUserToken } = require('../src/services/authToken.service');
    const token = issueUserToken({ id: 'user-1', lineUserId: 'U123' });
    const decoded = jwt.verify(token, 'test-secret-default-expiry');

    expect(decoded.exp - decoded.iat).toBe(24 * 60 * 60);
    expect(decoded.exp - decoded.iat).not.toBe(7 * 24 * 60 * 60);
  });

  test('ยังตั้ง JWT_EXPIRES_IN Override เองได้ตามปกติ (ไม่ได้ถูก Hardcode ทับ)', () => {
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.JWT_SECRET = 'test-secret-override';

    const { issueUserToken } = require('../src/services/authToken.service');
    const token = issueUserToken({ id: 'user-1', lineUserId: 'U123' });
    const decoded = jwt.verify(token, 'test-secret-override');

    expect(decoded.exp - decoded.iat).toBe(60 * 60);
  });
});
