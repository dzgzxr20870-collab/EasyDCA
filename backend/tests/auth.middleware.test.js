// Mock authToken.service เพื่อคุมผล verifyUserToken โดยไม่ต้อง Sign JWT จริง
jest.mock('../src/services/authToken.service');

const authTokenService = require('../src/services/authToken.service');
const requireAuth = require('../src/middleware/auth.middleware');
const { requireAdmin } = require('../src/middleware/auth.middleware');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requireAuth — แนบ req.user (id, lineUserId, role) จาก JWT Payload', () => {
  test('Token ถูกต้อง → แนบ req.user รวม role แล้วเรียก next()', () => {
    authTokenService.verifyUserToken.mockReturnValue({
      sub: 'user-1',
      lineUserId: 'U123',
      role: 'admin',
    });

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(req.user).toEqual({ id: 'user-1', lineUserId: 'U123', role: 'admin' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('Token เก่าที่ไม่มี role → req.user.role เป็น undefined (ไม่ใช่ Admin, Fail Safe)', () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123' });

    const req = { headers: { authorization: 'Bearer old-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(req.user.role).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  test('ไม่มี Header Authorization เลย → 401 UNAUTHORIZED', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'UNAUTHORIZED' });
    expect(next).not.toHaveBeenCalled();
  });

  test('Token หมดอายุ/ปลอม (verify throw) → 401 INVALID_TOKEN', () => {
    authTokenService.verifyUserToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const req = { headers: { authorization: 'Bearer expired-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_TOKEN' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireAdmin — ตรวจ role หลัง requireAuth', () => {
  test('req.user.role === admin → เรียก next()', () => {
    const req = { user: { id: 'admin-1', lineUserId: 'Uadmin1', role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('User ปกติ (role === user) → 403 FORBIDDEN ไม่เรียก next()', () => {
    const req = { user: { id: 'user-1', lineUserId: 'U123', role: 'user' } };
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'FORBIDDEN' });
    expect(next).not.toHaveBeenCalled();
  });

  test('role เป็น undefined (Token เก่าไม่มี role) → 403 FORBIDDEN', () => {
    const req = { user: { id: 'user-1', lineUserId: 'U123' } };
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'FORBIDDEN' });
    expect(next).not.toHaveBeenCalled();
  });

  test('ไม่มี req.user เลย (ถูกเรียกโดยไม่ผ่าน requireAuth) → 403 FORBIDDEN ไม่ Crash', () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'FORBIDDEN' });
    expect(next).not.toHaveBeenCalled();
  });
});
