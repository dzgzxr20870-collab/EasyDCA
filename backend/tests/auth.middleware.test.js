// Mock authToken.service เพื่อคุมผล verifyUserToken โดยไม่ต้อง Sign JWT จริง
jest.mock('../src/services/authToken.service');
// PDPA Self-Service Erasure (migration 018) — requireAuth กลายเป็น async และ Query
// DB 1 ครั้งต่อ Request (เดิมเป็น Pure JWT Verify ไม่แตะ DB เลย) — ต้อง Mock
// userRepository.findById เพื่อคุมผลโดยไม่ต้องต่อ Supabase จริง
jest.mock('../src/repositories/user.repository');

const authTokenService = require('../src/services/authToken.service');
const userRepository = require('../src/repositories/user.repository');
const requireAuth = require('../src/middleware/auth.middleware');
const { requireAdmin, requireConsent } = require('../src/middleware/auth.middleware');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requireAuth — แนบ req.user (id, lineUserId, role) + req.userRecord จาก DB', () => {
  test('Token ถูกต้อง + User Active ปกติ → แนบ req.user/req.userRecord แล้วเรียก next()', async () => {
    authTokenService.verifyUserToken.mockReturnValue({
      sub: 'user-1',
      lineUserId: 'U123',
      role: 'admin',
    });
    const userRecord = { id: 'user-1', lineUserId: 'U123', anonymizedAt: null, pdpaConsentedAt: '2026-07-01T00:00:00.000Z' };
    userRepository.findById.mockResolvedValue(userRecord);

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(userRepository.findById).toHaveBeenCalledWith('user-1');
    expect(req.user).toEqual({ id: 'user-1', lineUserId: 'U123', role: 'admin' });
    expect(req.userRecord).toBe(userRecord);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('Token เก่าที่ไม่มี role → req.user.role เป็น undefined (ไม่ใช่ Admin, Fail Safe)', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123' });
    userRepository.findById.mockResolvedValue({ id: 'user-1', anonymizedAt: null });

    const req = { headers: { authorization: 'Bearer old-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(req.user.role).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  test('ไม่มี Header Authorization เลย → 401 UNAUTHORIZED (ไม่แตะ DB)', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'UNAUTHORIZED' });
    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('Token หมดอายุ/ปลอม (verify throw) → 401 INVALID_TOKEN (ไม่แตะ DB)', async () => {
    authTokenService.verifyUserToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const req = { headers: { authorization: 'Bearer expired-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_TOKEN' });
    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  // PDPA Self-Service Erasure (migration 018) — Force Logout ทันทีในคำขอถัดไป
  // ไม่ต้องรอ JWT หมดอายุตามธรรมชาติ
  test('User ถูก Anonymize แล้ว (anonymizedAt ไม่ใช่ null) → 401 ACCOUNT_ERASED', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123', role: 'user' });
    userRepository.findById.mockResolvedValue({
      id: 'user-1',
      anonymizedAt: '2026-07-17T00:00:00.000Z',
    });

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'ACCOUNT_ERASED' });
    expect(next).not.toHaveBeenCalled();
  });

  test('ไม่พบ User Row เลย (หายไปจริง) → 401 ACCOUNT_ERASED', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-x', lineUserId: 'U999', role: 'user' });
    userRepository.findById.mockResolvedValue(null);

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'ACCOUNT_ERASED' });
    expect(next).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F7 — บัญชีถูกล็อก (Offensive Review Round 2, migration 039)
  // ═══════════════════════════════════════════════════════════════════════
  // users.is_locked มีมาตั้งแต่ Schema แรกแต่ถูกเช็คแค่ 2 จุด (freeTrial.service /
  // facebookLikeGrant.service) แปลว่าบัญชีที่ถูกล็อกยังใช้งานทุกอย่างที่เหลือได้ปกติ
  // ตอนนี้บังคับที่ requireAuth = ครอบทุก Endpoint ที่ผ่าน Middleware นี้ในคราวเดียว
  test('User ถูกล็อก (isLocked=true) → 403 ACCOUNT_LOCKED ไม่ถึง Route Handler', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123', role: 'user' });
    userRepository.findById.mockResolvedValue({
      id: 'user-1',
      isLocked: true,
      lockReason: 'ยิง OCR รัวผิดปกติ',
      pdpaConsentedAt: '2026-07-01T00:00:00.000Z',
    });

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    // ⚠️ 403 ไม่ใช่ 401 โดยเจตนา — Frontend จัดการ 401 ด้วยการล้าง Token + เด้งไป
    // Login ซึ่งจะทำให้ผู้ใช้ที่ถูกล็อกวนเข้า Login ไม่รู้จบโดยไม่มีคำอธิบายอะไรเลย
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'ACCOUNT_LOCKED',
      reason: 'ยิง OCR รัวผิดปกติ',
    });
    // สำคัญที่สุด: ต้องไม่ถึง Business Logic เลย
    expect(next).not.toHaveBeenCalled();
  });

  test('ถูกล็อกแบบไม่มีเหตุผลบันทึกไว้ (แถวเก่า/ล็อกด้วยมือ) → ยัง 403 แต่ reason = null', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123', role: 'user' });
    userRepository.findById.mockResolvedValue({ id: 'user-1', isLocked: true });

    const res = mockRes();
    const next = jest.fn();
    await requireAuth({ headers: { authorization: 'Bearer valid-token' } }, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'ACCOUNT_LOCKED', reason: null });
    expect(next).not.toHaveBeenCalled();
  });

  test('ปลดล็อกแล้ว (isLocked=false) → ใช้งานได้ปกติ (Regression)', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123', role: 'user' });
    userRepository.findById.mockResolvedValue({
      id: 'user-1',
      isLocked: false,
      // เหตุผลเดิมยังค้างอยู่โดยตั้งใจ (ประวัติว่าเคยถูกล็อก) — ต้องไม่ทำให้ถูกบล็อกซ้ำ
      lockReason: 'ยิง OCR รัวผิดปกติ',
      lockedAt: '2026-08-01T00:00:00.000Z',
    });

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('ถูก Anonymize + ถูกล็อกพร้อมกัน → ตอบ ACCOUNT_ERASED ก่อน (ลำดับเดิมไม่เปลี่ยน)', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123', role: 'user' });
    userRepository.findById.mockResolvedValue({
      id: 'user-1',
      isLocked: true,
      anonymizedAt: '2026-07-17T00:00:00.000Z',
    });

    const res = mockRes();
    await requireAuth({ headers: { authorization: 'Bearer valid-token' } }, res, jest.fn());

    // บัญชีที่ถูกลบข้อมูลแล้วไม่ควรได้เห็นเหตุผลการล็อก (ไม่มีอะไรให้อธิบายอีกแล้ว)
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'ACCOUNT_ERASED' });
  });

  test('Query DB ล้มเหลว (Error อื่นที่ไม่คาดคิด) → 500 INTERNAL_ERROR', async () => {
    authTokenService.verifyUserToken.mockReturnValue({ sub: 'user-1', lineUserId: 'U123', role: 'user' });
    userRepository.findById.mockRejectedValue(new Error('connection reset'));

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
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

// PDPA Compliance (migration 017) — Express Opt-in Consent Gate
describe('requireConsent — ตรวจ pdpaConsentedAt หลัง requireAuth', () => {
  test('req.userRecord.pdpaConsentedAt มีค่า → เรียก next()', () => {
    const req = { userRecord: { id: 'user-1', pdpaConsentedAt: '2026-07-01T00:00:00.000Z' } };
    const res = mockRes();
    const next = jest.fn();

    requireConsent(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('req.userRecord.pdpaConsentedAt เป็น null (ยังไม่เคย Consent) → 403 CONSENT_REQUIRED', () => {
    const req = { userRecord: { id: 'user-1', pdpaConsentedAt: null } };
    const res = mockRes();
    const next = jest.fn();

    requireConsent(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CONSENT_REQUIRED' });
    expect(next).not.toHaveBeenCalled();
  });

  test('ไม่มี req.userRecord เลย (ถูกเรียกโดยไม่ผ่าน requireAuth) → 403 CONSENT_REQUIRED ไม่ Crash', () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    requireConsent(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CONSENT_REQUIRED' });
    expect(next).not.toHaveBeenCalled();
  });
});
