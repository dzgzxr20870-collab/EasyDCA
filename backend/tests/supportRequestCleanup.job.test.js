jest.mock('../src/services/supportRequestFlow.service');

const supportRequestFlow = require('../src/services/supportRequestFlow.service');
const { runPurgeStaleSupportRequestSessions } = require('../src/jobs/supportRequestCleanup.job');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runPurgeStaleSupportRequestSessions', () => {
  test('เรียก purgeStaleSessions สำเร็จ → Log จำนวนที่ Purge', async () => {
    supportRequestFlow.purgeStaleSessions.mockResolvedValue(3);

    await runPurgeStaleSupportRequestSessions();

    expect(supportRequestFlow.purgeStaleSessions).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('purged 3 stale support request session(s)')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('ไม่มี Session ค้าง (0) → ยัง Log ปกติ ไม่ Error', async () => {
    supportRequestFlow.purgeStaleSessions.mockResolvedValue(0);

    await runPurgeStaleSupportRequestSessions();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('purged 0 stale'));
  });

  test('purgeStaleSessions throw → catch ไว้ ไม่ throw ออก, Log Error', async () => {
    supportRequestFlow.purgeStaleSessions.mockRejectedValue(new Error('db down'));

    await expect(runPurgeStaleSupportRequestSessions()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(console.log).not.toHaveBeenCalled();
  });
});
