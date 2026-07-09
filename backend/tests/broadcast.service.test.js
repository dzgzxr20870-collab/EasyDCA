jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/broadcastLog.repository');
jest.mock('../src/services/line.service');
// entitlement.service ไม่ Mock (Pure Logic) — ใช้ตัวจริงเพื่อยืนยันว่า filter ใช้
// isPremiumActive จริง (Pattern เดียวกับ Round 4b)

const userRepository = require('../src/repositories/user.repository');
const broadcastLogRepository = require('../src/repositories/broadcastLog.repository');
const lineService = require('../src/services/line.service');
const broadcastService = require('../src/services/broadcast.service');

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

// delayMs: 0 เสมอใน Test เพื่อไม่ให้ Test ช้า (ไม่กระทบ Logic ที่ทดสอบ)
const NO_DELAY = { delayMs: 0 };

const freeUser = (id) => ({ id, lineUserId: id.toUpperCase(), plan: 'free', planExpiresAt: null });

beforeEach(() => {
  jest.clearAllMocks();
  broadcastLogRepository.create.mockResolvedValue({});
  lineService.pushMessage.mockResolvedValue(undefined);
});

describe('sendBroadcast — Error Isolation (บังคับตามพรอมต์)', () => {
  test('User คนกลาง Push ล้มเหลว แต่คนอื่นยังส่งครบ + สรุปผลถูกต้อง', async () => {
    userRepository.findAll.mockResolvedValue([freeUser('u1'), freeUser('u2'), freeUser('u3')]);
    // U2 ล้มเหลว (เช่น Block บอท) — U1/U3 ต้องยังถูกส่ง
    lineService.pushMessage.mockImplementation((to) =>
      to === 'U2' ? Promise.reject(new Error('blocked')) : Promise.resolve()
    );

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'all', messageType: 'news', message: 'สวัสดี', sentBy: 'Uadmin1' },
      NO_DELAY
    );

    // พยายามส่งครบทั้ง 3 คน (ไม่หยุดกลางคันเพราะ U2 ล้ม)
    expect(lineService.pushMessage).toHaveBeenCalledTimes(3);
    expect(lineService.pushMessage).toHaveBeenCalledWith('U1', { type: 'text', text: 'สวัสดี' });
    expect(lineService.pushMessage).toHaveBeenCalledWith('U2', { type: 'text', text: 'สวัสดี' });
    expect(lineService.pushMessage).toHaveBeenCalledWith('U3', { type: 'text', text: 'สวัสดี' });

    expect(result).toEqual({ totalRecipients: 3, successCount: 2, failureCount: 1 });
    // Log บันทึกผลนับตามจริง
    expect(broadcastLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sentBy: 'Uadmin1',
        targetGroup: 'all',
        messageType: 'news',
        messageContent: 'สวัสดี',
        totalRecipients: 3,
        successCount: 2,
        failureCount: 1,
      })
    );
  });

  test('ทุกคน Push ล้มเหลว → success 0 / failure = ทั้งหมด (ยังวนครบ ไม่ throw)', async () => {
    userRepository.findAll.mockResolvedValue([freeUser('u1'), freeUser('u2')]);
    lineService.pushMessage.mockRejectedValue(new Error('LINE down'));

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'all', messageType: 'news', message: 'x', sentBy: 'Uadmin1' },
      NO_DELAY
    );

    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ totalRecipients: 2, successCount: 0, failureCount: 2 });
  });

  test('User ที่ไม่มี lineUserId → นับเป็นล้มเหลว ไม่เรียก pushMessage คนนั้น', async () => {
    userRepository.findAll.mockResolvedValue([
      freeUser('u1'),
      { id: 'u2', lineUserId: null, plan: 'free', planExpiresAt: null },
    ]);

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'all', messageType: 'other', message: 'x', sentBy: 'Uadmin1' },
      NO_DELAY
    );

    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    expect(lineService.pushMessage).toHaveBeenCalledWith('U1', expect.anything());
    expect(result).toEqual({ totalRecipients: 2, successCount: 1, failureCount: 1 });
  });
});

describe('sendBroadcast — filter ตาม targetGroup (ใช้ entitlement.isPremiumActive จริง)', () => {
  const users = [
    { id: 'p', lineUserId: 'PREMIUM', plan: 'premium', planExpiresAt: FUTURE }, // Active
    { id: 'e', lineUserId: 'EXPIRED', plan: 'premium', planExpiresAt: PAST }, // หมดอายุ → free
    { id: 'f', lineUserId: 'FREE', plan: 'free', planExpiresAt: null },
  ];

  test("targetGroup 'premium' → ส่งเฉพาะ Premium Active", async () => {
    userRepository.findAll.mockResolvedValue(users);

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'premium', messageType: 'news', message: 'x', sentBy: 'A' },
      NO_DELAY
    );

    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    expect(lineService.pushMessage).toHaveBeenCalledWith('PREMIUM', expect.anything());
    expect(result.totalRecipients).toBe(1);
  });

  test("targetGroup 'free' → ทุกคนที่ไม่ใช่ Premium Active (รวม Premium หมดอายุ)", async () => {
    userRepository.findAll.mockResolvedValue(users);

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'free', messageType: 'news', message: 'x', sentBy: 'A' },
      NO_DELAY
    );

    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(lineService.pushMessage).toHaveBeenCalledWith('EXPIRED', expect.anything());
    expect(lineService.pushMessage).toHaveBeenCalledWith('FREE', expect.anything());
    expect(result.totalRecipients).toBe(2);
  });

  test("targetGroup 'all' → ทุกคน", async () => {
    userRepository.findAll.mockResolvedValue(users);

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'all', messageType: 'news', message: 'x', sentBy: 'A' },
      NO_DELAY
    );

    expect(lineService.pushMessage).toHaveBeenCalledTimes(3);
    expect(result.totalRecipients).toBe(3);
  });

  test('กลุ่มเป้าหมายไม่มี User เลย → total/success/failure = 0, ไม่เรียก pushMessage, ยัง Log', async () => {
    // ไม่มี Premium Active เลย แต่เลือกส่ง premium
    userRepository.findAll.mockResolvedValue([freeUser('u1'), freeUser('u2')]);

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'premium', messageType: 'news', message: 'x', sentBy: 'A' },
      NO_DELAY
    );

    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ totalRecipients: 0, successCount: 0, failureCount: 0 });
    expect(broadcastLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ totalRecipients: 0, successCount: 0, failureCount: 0 })
    );
  });
});

describe('sendBroadcast — ความทนทานของการบันทึก Log', () => {
  test('เขียน broadcast_logs พลาดหลังส่งจริง → ไม่ throw ยังคืนผลนับตามจริง', async () => {
    userRepository.findAll.mockResolvedValue([freeUser('u1')]);
    broadcastLogRepository.create.mockRejectedValue(new Error('log db down'));

    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'all', messageType: 'news', message: 'x', sentBy: 'A' },
      NO_DELAY
    );

    // ผู้ใช้ได้รับข้อความไปแล้วจริง — ต้องไม่ทำให้ทั้งคำสั่งล้มเหลว
    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ totalRecipients: 1, successCount: 1, failureCount: 0 });
  });

  test('userRepository.findAll พัง (ก่อนส่ง) → throw ออกไปให้ Controller ตอบ 500', async () => {
    userRepository.findAll.mockRejectedValue(new Error('users db down'));

    await expect(
      broadcastService.sendBroadcast(
        { targetGroup: 'all', messageType: 'news', message: 'x', sentBy: 'A' },
        NO_DELAY
      )
    ).rejects.toThrow('users db down');
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });
});

describe('filterByTargetGroup (Unit ตรง)', () => {
  const users = [
    { id: 'p', plan: 'premium', planExpiresAt: FUTURE },
    { id: 'f', plan: 'free', planExpiresAt: null },
  ];

  test("'all' คืนทุกคน", () => {
    expect(broadcastService.filterByTargetGroup(users, 'all')).toHaveLength(2);
  });
  test("'premium' คืนเฉพาะ Active", () => {
    expect(broadcastService.filterByTargetGroup(users, 'premium').map((u) => u.id)).toEqual(['p']);
  });
  test("'free' คืนที่ไม่ใช่ Premium Active", () => {
    expect(broadcastService.filterByTargetGroup(users, 'free').map((u) => u.id)).toEqual(['f']);
  });
});
