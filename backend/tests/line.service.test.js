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

describe('lineService.getMessageContent', () => {
  const MESSAGE_ID = 'msg-123';

  test('LINE Content API ตอบ 200 → คืน { buffer, contentType } (buffer เป็น Node Buffer)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
      arrayBuffer: async () => bytes.buffer,
    });

    const result = await lineService.getMessageContent(MESSAGE_ID);

    expect(result.contentType).toBe('image/jpeg');
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(Array.from(result.buffer)).toEqual([1, 2, 3, 4]);
    // เรียก Content API ที่ Host api-data พร้อม Authorization Bearer
    expect(global.fetch).toHaveBeenCalledWith(
      `https://api-data.line.me/v2/bot/message/${MESSAGE_ID}/content`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer ') }),
      })
    );
  });

  test('ไม่มี Content-Type Header → Fallback application/octet-stream', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    });

    const result = await lineService.getMessageContent(MESSAGE_ID);
    expect(result.contentType).toBe('application/octet-stream');
  });

  test('LINE Content API ตอบ Error Status → throw (ให้ Caller จัดการ Error เอง)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(lineService.getMessageContent(MESSAGE_ID)).rejects.toThrow('LINE Content API failed: 404');
  });

  test('Network Error (fetch throw) → โยนต่อ ไม่กลืน', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(lineService.getMessageContent(MESSAGE_ID)).rejects.toThrow('network down');
  });
});
