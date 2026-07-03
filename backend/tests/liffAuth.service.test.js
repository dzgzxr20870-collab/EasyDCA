// Mock config/env เพื่อคุมค่า liff.channelId แบบ Deterministic (ไม่พึ่ง .env จริง
// ที่ยังไม่มี LIFF_CHANNEL_ID) — ต้อง Mock ก่อน require service
jest.mock('../src/config/env', () => ({
  liff: {
    id: '2010586158-DO9yzmaP',
    channelId: '2010586158',
  },
}));

const {
  LiffAuthError,
  verifyLiffAccessToken,
  fetchLiffProfile,
} = require('../src/services/liffAuth.service');

const CHANNEL_ID = '2010586158';

afterEach(() => {
  jest.restoreAllMocks();
});

// Helper: Mock fetch ให้ตอบ verify endpoint สำเร็จด้วย body ที่กำหนด
function mockFetchOnce({ status = 200, body = {} }) {
  jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    status,
    json: async () => body,
  });
}

describe('verifyLiffAccessToken', () => {
  test('client_id ตรง + expires_in > 0 → คืน response data', async () => {
    mockFetchOnce({ body: { client_id: CHANNEL_ID, expires_in: 2592000, scope: 'profile' } });

    const data = await verifyLiffAccessToken('valid-token');

    expect(data.client_id).toBe(CHANNEL_ID);
    expect(data.expires_in).toBe(2592000);
    // ต้องยิงไปที่ verify endpoint พร้อมแนบ access_token
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('https://api.line.me/oauth2/v2.1/verify');
    expect(calledUrl).toContain('access_token=valid-token');
  });

  test('HTTP status != 200 → throw LiffAuthError code=INVALID_TOKEN', async () => {
    mockFetchOnce({ status: 400, body: { error: 'invalid_request' } });

    await expect(verifyLiffAccessToken('bad-token')).rejects.toMatchObject({
      name: 'LiffAuthError',
      code: 'INVALID_TOKEN',
    });
  });

  test('client_id ไม่ตรง Channel → throw LiffAuthError code=CHANNEL_MISMATCH', async () => {
    mockFetchOnce({ body: { client_id: '9999999999', expires_in: 2592000 } });

    await expect(verifyLiffAccessToken('other-app-token')).rejects.toMatchObject({
      name: 'LiffAuthError',
      code: 'CHANNEL_MISMATCH',
    });
  });

  test('expires_in = 0 → throw LiffAuthError code=TOKEN_EXPIRED', async () => {
    mockFetchOnce({ body: { client_id: CHANNEL_ID, expires_in: 0 } });

    await expect(verifyLiffAccessToken('expired-token')).rejects.toMatchObject({
      name: 'LiffAuthError',
      code: 'TOKEN_EXPIRED',
    });
  });

  test('expires_in < 0 → throw LiffAuthError code=TOKEN_EXPIRED', async () => {
    mockFetchOnce({ body: { client_id: CHANNEL_ID, expires_in: -100 } });

    await expect(verifyLiffAccessToken('expired-token')).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });
});

describe('fetchLiffProfile', () => {
  test('status 200 → คืน { userId, displayName, pictureUrl }', async () => {
    mockFetchOnce({
      body: {
        userId: 'U1234567890',
        displayName: 'สมชาย',
        pictureUrl: 'https://example.com/pic.jpg',
        statusMessage: 'hello',
      },
    });

    const profile = await fetchLiffProfile('valid-token');

    expect(profile).toEqual({
      userId: 'U1234567890',
      displayName: 'สมชาย',
      pictureUrl: 'https://example.com/pic.jpg',
    });
    // ต้องแนบ Authorization: Bearer <token>
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/profile');
    expect(options.headers.Authorization).toBe('Bearer valid-token');
  });

  test('status != 200 → throw LiffAuthError code=PROFILE_FETCH_FAILED', async () => {
    mockFetchOnce({ status: 401, body: {} });

    await expect(fetchLiffProfile('bad-token')).rejects.toMatchObject({
      name: 'LiffAuthError',
      code: 'PROFILE_FETCH_FAILED',
    });
  });

  test('fetch reject (Network error) → throw LiffAuthError code=PROFILE_FETCH_FAILED', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));

    await expect(fetchLiffProfile('token')).rejects.toMatchObject({
      code: 'PROFILE_FETCH_FAILED',
    });
  });
});

describe('LiffAuthError', () => {
  test('เก็บ code, message, details ตาม Pattern เดียวกับ Error อื่นในโปรเจค', () => {
    const err = new LiffAuthError('SOME_CODE', 'some message', { foo: 'bar' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LiffAuthError');
    expect(err.code).toBe('SOME_CODE');
    expect(err.message).toBe('some message');
    expect(err.details).toEqual({ foo: 'bar' });
  });
});
