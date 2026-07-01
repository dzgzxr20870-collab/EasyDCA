const lineService = require('../src/services/line.service');

const USER_ID = 'U123';

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('lineService.getProfile — สำเร็จ', () => {
  test('LINE API ตอบ 200 → คืน { displayName, pictureUrl }', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        userId: USER_ID,
        displayName: 'สมชาย ใจดี',
        pictureUrl: 'https://profile.line-scdn.net/abc123',
      }),
    });

    const profile = await lineService.getProfile(USER_ID);

    expect(profile).toEqual({
      displayName: 'สมชาย ใจดี',
      pictureUrl: 'https://profile.line-scdn.net/abc123',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.line.me/v2/bot/profile/${USER_ID}`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer ') }),
      })
    );
  });

  test('LINE API ไม่คืน pictureUrl (User ไม่มีรูปโปรไฟล์) → pictureUrl เป็น null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ userId: USER_ID, displayName: 'ไม่มีรูป' }),
    });

    const profile = await lineService.getProfile(USER_ID);

    expect(profile).toEqual({ displayName: 'ไม่มีรูป', pictureUrl: null });
  });
});

describe('lineService.getProfile — ล้มเหลว (ต้องคืน null เสมอ ไม่ throw)', () => {
  test('LINE API ตอบ Error Status (เช่น 404 User ไม่ได้เพิ่มเพื่อน) → คืน null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const profile = await lineService.getProfile(USER_ID);

    expect(profile).toBeNull();
  });

  test('Network Error (fetch throw) → คืน null ไม่ throw ออกไป', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(lineService.getProfile(USER_ID)).resolves.toBeNull();
  });
});
