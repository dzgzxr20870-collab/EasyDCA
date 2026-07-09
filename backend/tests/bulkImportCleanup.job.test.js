jest.mock('../src/services/bulkImportSession.service');

const bulkImportSession = require('../src/services/bulkImportSession.service');
const { runPurgeStaleBulkImportSessions } = require('../src/jobs/bulkImportCleanup.job');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runPurgeStaleBulkImportSessions', () => {
  test('เรียก purgeStaleSessions สำเร็จ → Log จำนวนที่ Purge', async () => {
    bulkImportSession.purgeStaleSessions.mockResolvedValue(2);

    await runPurgeStaleBulkImportSessions();

    expect(bulkImportSession.purgeStaleSessions).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('purged 2 stale bulk import session(s)')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('ไม่มี Session ค้าง (0) → ยัง Log ปกติ ไม่ Error', async () => {
    bulkImportSession.purgeStaleSessions.mockResolvedValue(0);

    await runPurgeStaleBulkImportSessions();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('purged 0 stale'));
  });

  test('purgeStaleSessions throw → catch ไว้ ไม่ throw ออก, Log Error', async () => {
    bulkImportSession.purgeStaleSessions.mockRejectedValue(new Error('db down'));

    await expect(runPurgeStaleBulkImportSessions()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(console.log).not.toHaveBeenCalled();
  });
});
