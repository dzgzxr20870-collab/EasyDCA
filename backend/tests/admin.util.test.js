// Mock config/env เพื่อคุมรายชื่อ Admin แบบ Deterministic (ไม่พึ่ง Environment จริง)
jest.mock('../src/config/env', () => ({
  payment: {
    adminLineUserIds: ['Uadmin1', 'Uadmin2'],
  },
}));

const { isAdminLineUserId } = require('../src/utils/admin.util');

describe('isAdminLineUserId', () => {
  test('LINE User ID ที่อยู่ในรายชื่อ Admin → true', () => {
    expect(isAdminLineUserId('Uadmin1')).toBe(true);
    expect(isAdminLineUserId('Uadmin2')).toBe(true);
  });

  test('LINE User ID ที่ไม่อยู่ในรายชื่อ → false', () => {
    expect(isAdminLineUserId('Urandom')).toBe(false);
  });

  test('ค่าว่าง/undefined/null → false (ไม่ Match รายชื่อ)', () => {
    expect(isAdminLineUserId('')).toBe(false);
    expect(isAdminLineUserId(undefined)).toBe(false);
    expect(isAdminLineUserId(null)).toBe(false);
  });

  test('เทียบแบบตรงตัว (Case-sensitive) ไม่ Match ถ้าตัวพิมพ์ต่าง', () => {
    expect(isAdminLineUserId('uadmin1')).toBe(false);
  });
});

// รายชื่อ Admin ว่างเปล่า (ยังไม่ได้ตั้ง ADMIN_LINE_USER_IDS) → ไม่มีใครเป็น Admin เลย
describe('isAdminLineUserId — เมื่อไม่มีการตั้งค่า Admin', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('adminLineUserIds เป็น Array ว่าง → ทุกคน false (Fail Safe)', () => {
    jest.doMock('../src/config/env', () => ({
      payment: { adminLineUserIds: [] },
    }));
    const { isAdminLineUserId: fn } = require('../src/utils/admin.util');
    expect(fn('Uadmin1')).toBe(false);
    expect(fn('anyone')).toBe(false);
  });
});
