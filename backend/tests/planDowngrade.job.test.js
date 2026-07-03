jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/line.service');

const userRepository = require('../src/repositories/user.repository');
const lineService = require('../src/services/line.service');
const { runPlanDowngrade } = require('../src/jobs/planDowngrade.job');

function user(overrides = {}) {
  return {
    id: 'user-1',
    lineUserId: 'U123',
    plan: 'premium',
    planExpiresAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  userRepository.updatePlan.mockResolvedValue(undefined);
  lineService.pushMessage.mockResolvedValue(undefined);
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runPlanDowngrade', () => {
  test('ไม่มี Premium หมดอายุ → ไม่ทำอะไร คืน 0', async () => {
    userRepository.findExpiredPremiumUsers.mockResolvedValue([]);

    const count = await runPlanDowngrade();

    expect(count).toBe(0);
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });

  test('มี 1 คน → updatePlan(free, null) แล้ว Push แจ้งผู้ใช้', async () => {
    userRepository.findExpiredPremiumUsers.mockResolvedValue([user({ id: 'u1', lineUserId: 'U1' })]);

    const count = await runPlanDowngrade();

    expect(count).toBe(1);
    expect(userRepository.updatePlan).toHaveBeenCalledWith('u1', 'free', null);
    expect(lineService.pushMessage).toHaveBeenCalledWith('U1', expect.any(Object));
    // ข้อความต้องสื่อว่า Premium หมดอายุกลับเป็น Free
    expect(JSON.stringify(lineService.pushMessage.mock.calls[0][1])).toContain('หมดอายุ');
  });

  test('Error Isolation: 1 คน updatePlan พัง → คนอื่นยังถูก Downgrade ต่อ', async () => {
    userRepository.findExpiredPremiumUsers.mockResolvedValue([
      user({ id: 'bad', lineUserId: 'U-bad' }),
      user({ id: 'ok', lineUserId: 'U-ok' }),
    ]);
    userRepository.updatePlan.mockImplementation(async (id) => {
      if (id === 'bad') throw new Error('db write failed');
    });

    const count = await runPlanDowngrade();

    // นับเฉพาะที่สำเร็จ (ok) — bad ไม่นับ แต่ไม่ล้มทั้ง Loop
    expect(count).toBe(1);
    expect(userRepository.updatePlan).toHaveBeenCalledTimes(2);
    // คนที่พังตอน updatePlan ต้องไม่ถูก Push (ยังไม่ได้ Downgrade จริง)
    expect(lineService.pushMessage).not.toHaveBeenCalledWith('U-bad', expect.anything());
    expect(lineService.pushMessage).toHaveBeenCalledWith('U-ok', expect.any(Object));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db write failed'));
  });

  test('Push ล้มเหลว → ไม่ Rollback การ Downgrade (ยังนับว่าสำเร็จ)', async () => {
    userRepository.findExpiredPremiumUsers.mockResolvedValue([user({ id: 'u1', lineUserId: 'U1' })]);
    lineService.pushMessage.mockRejectedValue(new Error('403 blocked'));

    const count = await runPlanDowngrade();

    // updatePlan สำเร็จแล้ว (Source of Truth = DB) → นับ 1 แม้ Push พัง
    expect(count).toBe(1);
    expect(userRepository.updatePlan).toHaveBeenCalledWith('u1', 'free', null);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('403 blocked'));
  });

  test('ผู้ใช้ไม่มี lineUserId → Downgrade ได้ แต่ไม่ Push', async () => {
    userRepository.findExpiredPremiumUsers.mockResolvedValue([user({ id: 'u1', lineUserId: null })]);

    const count = await runPlanDowngrade();

    expect(count).toBe(1);
    expect(userRepository.updatePlan).toHaveBeenCalledWith('u1', 'free', null);
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });

  test('ดึงรายชื่อล้มเหลว (DB down) → catch ไว้ ไม่ throw, คืน 0', async () => {
    userRepository.findExpiredPremiumUsers.mockRejectedValue(new Error('db down'));

    await expect(runPlanDowngrade()).resolves.toBe(0);

    expect(userRepository.updatePlan).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
