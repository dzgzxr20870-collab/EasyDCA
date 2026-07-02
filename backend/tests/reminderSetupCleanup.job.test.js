jest.mock('../src/services/reminderSetupFlow.service');

const reminderSetupFlow = require('../src/services/reminderSetupFlow.service');
const { runPurgeStaleSetupSessions } = require('../src/jobs/reminderSetupCleanup.job');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runPurgeStaleSetupSessions', () => {
  test('เรียก purgeStaleSessions สำเร็จ → Log จำนวนที่ Purge', async () => {
    reminderSetupFlow.purgeStaleSessions.mockResolvedValue(3);

    await runPurgeStaleSetupSessions();

    expect(reminderSetupFlow.purgeStaleSessions).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('purged 3 stale reminder setup session(s)')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('ไม่มี Session ค้าง (0) → ยัง Log ปกติ ไม่ Error', async () => {
    reminderSetupFlow.purgeStaleSessions.mockResolvedValue(0);

    await runPurgeStaleSetupSessions();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('purged 0 stale'));
  });

  test('purgeStaleSessions throw → catch ไว้ ไม่ throw ออก, Log Error', async () => {
    reminderSetupFlow.purgeStaleSessions.mockRejectedValue(new Error('db down'));

    await expect(runPurgeStaleSetupSessions()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(console.log).not.toHaveBeenCalled();
  });
});
