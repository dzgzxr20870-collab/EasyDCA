jest.mock('../src/repositories/lineWebhookEvent.repository');

const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');
const { runPurgeStaleWebhookEvents } = require('../src/jobs/webhookEventCleanup.job');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runPurgeStaleWebhookEvents', () => {
  test('เรียก purgeOlderThan สำเร็จ → Log จำนวนที่ Purge', async () => {
    lineWebhookEventRepository.purgeOlderThan.mockResolvedValue(3);

    await runPurgeStaleWebhookEvents();

    expect(lineWebhookEventRepository.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('purged 3 stale webhook event(s)')
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  test('ไม่มี Event ค้าง (0) → ยัง Log ปกติ ไม่ Error', async () => {
    lineWebhookEventRepository.purgeOlderThan.mockResolvedValue(0);

    await runPurgeStaleWebhookEvents();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('purged 0 stale'));
  });

  test('purgeOlderThan throw → catch ไว้ ไม่ throw ออก, Log Error', async () => {
    lineWebhookEventRepository.purgeOlderThan.mockRejectedValue(new Error('db down'));

    await expect(runPurgeStaleWebhookEvents()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(console.log).not.toHaveBeenCalled();
  });
});
