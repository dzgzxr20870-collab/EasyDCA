jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/liffAuth.service');
jest.mock('../src/services/authToken.service');

const userRepository = require('../src/repositories/user.repository');
const liffAuthService = require('../src/services/liffAuth.service');
const authTokenService = require('../src/services/authToken.service');
const { liffVerify, pdpaConsent } = require('../src/controllers/auth.controller');

const LIFF_PROFILE = { userId: 'U123', displayName: 'สมชาย ใจดี', pictureUrl: 'https://profile.line-scdn.net/abc123' };

function req(accessToken = 'valid-token') {
  return { body: { accessToken } };
}

function res() {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  liffAuthService.verifyLiffAccessToken.mockResolvedValue({ client_id: 'channel-1', expires_in: 3600 });
  liffAuthService.fetchLiffProfile.mockResolvedValue(LIFF_PROFILE);
  authTokenService.issueUserToken.mockReturnValue('signed-jwt-token');
});

describe('liffVerify — User Auto-register / Fallback Name Sync', () => {
  test('User ใหม่ (ไม่เคยมีมาก่อน) → สร้างตามปกติด้วยชื่อ/รูปจริงจาก LIFF Profile', async () => {
    userRepository.findByLineUserId.mockResolvedValue(null);
    userRepository.create.mockResolvedValue({
      id: 'user-1',
      lineUserId: 'U123',
      displayName: 'สมชาย ใจดี',
      pictureUrl: 'https://profile.line-scdn.net/abc123',
    });

    const response = res();
    await liffVerify(req(), response);

    expect(userRepository.create).toHaveBeenCalledWith(
      'U123',
      'สมชาย ใจดี',
      'https://profile.line-scdn.net/abc123'
    );
    expect(userRepository.updateDisplayName).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
  });

  test('User เดิมมีชื่อ "LINE User" (Fallback ค้าง) + Profile รอบนี้ได้ชื่อจริง → Sync ชื่อสำเร็จ', async () => {
    const staleUser = { id: 'user-1', lineUserId: 'U123', displayName: 'LINE User', pictureUrl: null };
    userRepository.findByLineUserId.mockResolvedValue(staleUser);
    userRepository.updateDisplayName.mockResolvedValue({
      ...staleUser,
      displayName: 'สมชาย ใจดี',
      pictureUrl: 'https://profile.line-scdn.net/abc123',
    });

    const response = res();
    await liffVerify(req(), response);

    expect(userRepository.updateDisplayName).toHaveBeenCalledWith(
      'user-1',
      'สมชาย ใจดี',
      'https://profile.line-scdn.net/abc123'
    );
    expect(userRepository.create).not.toHaveBeenCalled();
    // Response ต้องสะท้อนชื่อที่ Sync แล้ว ไม่ใช่ "LINE User" เดิม
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ displayName: 'สมชาย ใจดี' }) })
    );
  });

  test('User เดิมมีชื่อ "LINE User" + Profile รอบนี้ไม่มี displayName จริง → ไม่ Error คืน existing เดิม', async () => {
    const staleUser = { id: 'user-1', lineUserId: 'U123', displayName: 'LINE User', pictureUrl: null };
    userRepository.findByLineUserId.mockResolvedValue(staleUser);
    // LIFF Profile คืนมาแต่ไม่มี displayName (undefined) — fetchLiffProfile เองไม่คืน
    // null ทั้งก้อน (ต่างจาก Webhook) แต่ Field อาจขาดได้
    liffAuthService.fetchLiffProfile.mockResolvedValue({ userId: 'U123', displayName: undefined, pictureUrl: null });

    const response = res();
    await liffVerify(req(), response);

    expect(userRepository.updateDisplayName).not.toHaveBeenCalled();
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ displayName: 'LINE User' }) })
    );
  });

  test('User เดิมมีชื่อจริงอยู่แล้ว (ไม่ใช่ "LINE User") → ไม่แตะ ไม่อัปเดต คืน existing เดิม', async () => {
    const namedUser = { id: 'user-1', lineUserId: 'U123', displayName: 'สมหญิง', pictureUrl: 'https://old.pic' };
    userRepository.findByLineUserId.mockResolvedValue(namedUser);

    const response = res();
    await liffVerify(req(), response);

    expect(userRepository.updateDisplayName).not.toHaveBeenCalled();
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ displayName: 'สมหญิง' }) })
    );
  });

  // PDPA Compliance (migration 017) — Login.jsx ใช้ Field นี้ตัดสินว่าต้องแสดงหน้า
  // Consent ก่อนเข้า Dashboard ไหม
  test('User ยังไม่เคย Consent (pdpaConsentedAt เป็น null) → Response สะท้อนค่า null', async () => {
    userRepository.findByLineUserId.mockResolvedValue({
      id: 'user-1',
      lineUserId: 'U123',
      displayName: 'สมชาย ใจดี',
      pictureUrl: null,
      pdpaConsentedAt: null,
    });

    const response = res();
    await liffVerify(req(), response);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ pdpaConsentedAt: null }) })
    );
  });

  test('User เคย Consent แล้ว → Response สะท้อนค่า Timestamp จริง', async () => {
    userRepository.findByLineUserId.mockResolvedValue({
      id: 'user-1',
      lineUserId: 'U123',
      displayName: 'สมชาย ใจดี',
      pictureUrl: null,
      pdpaConsentedAt: '2026-07-01T00:00:00.000Z',
    });

    const response = res();
    await liffVerify(req(), response);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ pdpaConsentedAt: '2026-07-01T00:00:00.000Z' }),
      })
    );
  });
});

describe('pdpaConsent — POST /api/v1/auth/pdpa-consent', () => {
  test('เรียก userRepository.setPdpaConsent ด้วย req.user.id แล้วคืน user ที่อัปเดตแล้ว', async () => {
    userRepository.setPdpaConsent.mockResolvedValue({
      id: 'user-1',
      displayName: 'สมชาย ใจดี',
      pictureUrl: null,
      pdpaConsentedAt: '2026-07-17T00:00:00.000Z',
    });

    const response = res();
    await pdpaConsent({ user: { id: 'user-1' } }, response);

    expect(userRepository.setPdpaConsent).toHaveBeenCalledWith('user-1');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ pdpaConsentedAt: '2026-07-17T00:00:00.000Z' }),
      })
    );
  });

  test('Repository throw → 500 INTERNAL_ERROR', async () => {
    userRepository.setPdpaConsent.mockRejectedValue(new Error('db blip'));

    const response = res();
    await pdpaConsent({ user: { id: 'user-1' } }, response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});
