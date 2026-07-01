jest.mock('../src/services/pendingTransaction.service');

const pendingService = require('../src/services/pendingTransaction.service');
const { runExpirePending, runPurgeOldPending } = require('../src/jobs/pendingCleanup.job');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runExpirePending', () => {
  test('เรียก expireOverduePending สำเร็จ → Log จำนวนที่ Expire', async () => {
    pendingService.expireOverduePending.mockResolvedValue(3);

    await runExpirePending();

    expect(pendingService.expireOverduePending).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('expired 3 overdue pending transaction(s)')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('ไม่มีรายการหมดอายุ (0) → ยัง Log ปกติ ไม่ Error', async () => {
    pendingService.expireOverduePending.mockResolvedValue(0);

    await runExpirePending();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('expired 0 overdue'));
  });

  test('expireOverduePending throw → catch ไว้ ไม่ throw ออก, Log Error', async () => {
    pendingService.expireOverduePending.mockRejectedValue(new Error('db down'));

    await expect(runExpirePending()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('runPurgeOldPending', () => {
  test('เรียก purgeOldPending สำเร็จ → Log จำนวนที่ Purge', async () => {
    pendingService.purgeOldPending.mockResolvedValue(5);

    await runPurgeOldPending();

    expect(pendingService.purgeOldPending).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('purged 5 resolved pending transaction(s)')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('purgeOldPending throw → catch ไว้ ไม่ throw ออก, Log Error', async () => {
    pendingService.purgeOldPending.mockRejectedValue(new Error('network timeout'));

    await expect(runPurgeOldPending()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network timeout'));
    expect(console.log).not.toHaveBeenCalled();
  });
});
