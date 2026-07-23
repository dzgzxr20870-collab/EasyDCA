jest.mock('../src/services/guidedBuyFlow.service');

const guidedBuyFlow = require('../src/services/guidedBuyFlow.service');
const { runPurgeStaleGuidedBuySessions } = require('../src/jobs/guidedBuyCleanup.job');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runPurgeStaleGuidedBuySessions', () => {
  test('เรียก purgeStaleSessions สำเร็จ → Log จำนวนที่ Purge', async () => {
    guidedBuyFlow.purgeStaleSessions.mockResolvedValue(3);

    await runPurgeStaleGuidedBuySessions();

    expect(guidedBuyFlow.purgeStaleSessions).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('purged 3 stale guided buy session(s)')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('ไม่มี Session ค้าง (0) → ยัง Log ปกติ ไม่ Error', async () => {
    guidedBuyFlow.purgeStaleSessions.mockResolvedValue(0);

    await runPurgeStaleGuidedBuySessions();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('purged 0 stale'));
  });

  test('purgeStaleSessions throw → catch ไว้ ไม่ throw ออก, Log Error', async () => {
    guidedBuyFlow.purgeStaleSessions.mockRejectedValue(new Error('db down'));

    await expect(runPurgeStaleGuidedBuySessions()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(console.log).not.toHaveBeenCalled();
  });
});
