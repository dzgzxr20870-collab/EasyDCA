jest.mock('../src/repositories/asset.repository');
jest.mock('../src/services/portfolioSummary.service');
jest.mock('../src/services/line.service');

const assetRepository = require('../src/repositories/asset.repository');
const portfolioSummaryService = require('../src/services/portfolioSummary.service');
const lineService = require('../src/services/line.service');
const {
  runWeeklySummaryPush,
  runMonthlySummaryPush,
} = require('../src/jobs/portfolioSummary.job');

function user(overrides = {}) {
  return { userId: 'user-1', lineUserId: 'U123', ...overrides };
}

function summary(overrides = {}) {
  return {
    totalInvestedAllAssets: 30000,
    totalCurrentValue: 40000,
    totalProfitLoss: 10000,
    totalProfitLossPercent: 33.33,
    excludedCount: 0,
    periodLabel: 'weekly',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  lineService.pushMessage.mockResolvedValue(undefined);
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runWeeklySummaryPush', () => {
  test('ไม่มี User ไหนมี Active Asset เลย → Loop ว่าง ไม่ Error ไม่ Push', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockResolvedValue([]);

    await expect(runWeeklySummaryPush()).resolves.toBeUndefined();

    expect(portfolioSummaryService.buildSummaryForUser).not.toHaveBeenCalled();
    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 0/0'));
  });

  test('มี Summary จริง → Push พร้อมส่ง periodLabel "weekly" เข้า Service', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockResolvedValue([user()]);
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue(summary());

    await runWeeklySummaryPush();

    expect(portfolioSummaryService.buildSummaryForUser).toHaveBeenCalledWith('user-1', 'weekly');
    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    expect(lineService.pushMessage).toHaveBeenCalledWith('U123', expect.any(Object));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 1/1'));
  });

  test('พอร์ตว่าง (Service คืน null) → Skip ไม่ Push', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockResolvedValue([user()]);
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue(null);

    await runWeeklySummaryPush();

    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 0/1'));
  });

  test('User ไม่มี lineUserId → ข้าม ไม่คำนวณ ไม่ Push', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockResolvedValue([
      user({ userId: 'no-line', lineUserId: null }),
    ]);

    await runWeeklySummaryPush();

    expect(portfolioSummaryService.buildSummaryForUser).not.toHaveBeenCalled();
    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no lineUserId'));
  });

  test('Push ล้มเหลว 1 User (Block บอท) → ไม่กระทบ User อื่น', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockResolvedValue([
      user({ userId: 'blocked', lineUserId: 'U-blocked' }),
      user({ userId: 'ok', lineUserId: 'U-ok' }),
    ]);
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue(summary());
    lineService.pushMessage.mockImplementation(async (to) => {
      if (to === 'U-blocked') throw new Error('403 blocked by user');
    });

    await runWeeklySummaryPush();

    // ทั้งสองถูกพยายาม Push, User ok ยังสำเร็จ (Loop ไม่ล้มทั้งก้อน)
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('blocked'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 1/2'));
  });

  test('buildSummaryForUser ล้มเหลว 1 User → catch ไว้ ไป User ถัดไป', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockResolvedValue([
      user({ userId: 'boom', lineUserId: 'U-boom' }),
      user({ userId: 'ok', lineUserId: 'U-ok' }),
    ]);
    portfolioSummaryService.buildSummaryForUser.mockImplementation(async (userId) => {
      if (userId === 'boom') throw new Error('calc failed');
      return summary();
    });

    await runWeeklySummaryPush();

    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    expect(lineService.pushMessage).toHaveBeenCalledWith('U-ok', expect.any(Object));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('calc failed'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 1/2'));
  });

  test('findUserIdsWithActiveAssets ล้มเหลว (DB down) → catch ไว้ ไม่ throw ไม่ Push', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockRejectedValue(new Error('db down'));

    await expect(runWeeklySummaryPush()).resolves.toBeUndefined();

    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});

describe('runMonthlySummaryPush', () => {
  test('ส่ง periodLabel "monthly" เข้า Service (Logic เหมือน weekly ต่างแค่ Label)', async () => {
    assetRepository.findUserIdsWithActiveAssets.mockResolvedValue([user()]);
    portfolioSummaryService.buildSummaryForUser.mockResolvedValue(summary({ periodLabel: 'monthly' }));

    await runMonthlySummaryPush();

    expect(portfolioSummaryService.buildSummaryForUser).toHaveBeenCalledWith('user-1', 'monthly');
    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 1/1'));
  });
});
