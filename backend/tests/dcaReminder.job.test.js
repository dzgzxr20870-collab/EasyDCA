jest.mock('../src/services/dcaReminder.service');
jest.mock('../src/services/line.service');
// Mock เฉพาะ todayInBangkok ให้ deterministic (ไม่ผูกกับวันจริงตอนรัน Test)
jest.mock('../src/services/transaction.service', () => ({
  todayInBangkok: jest.fn(() => '2026-07-06'),
}));

const reminderService = require('../src/services/dcaReminder.service');
const lineService = require('../src/services/line.service');
const { runReminderPush } = require('../src/jobs/dcaReminder.job');

const TODAY = '2026-07-06';

function reminder(overrides = {}) {
  return {
    id: 'rem-1',
    symbol: 'BTC',
    frequency: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: null,
    amountThb: 1000,
    lineUserId: 'U123',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  lineService.pushMessage.mockResolvedValue(undefined);
  reminderService.markNotified.mockResolvedValue(undefined);
});

afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('runReminderPush', () => {
  test('ไม่มี Reminder ครบกำหนด → ไม่ Push อะไรเลย', async () => {
    reminderService.findDueReminders.mockResolvedValue([]);

    await runReminderPush();

    expect(reminderService.findDueReminders).toHaveBeenCalledWith(TODAY);
    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(reminderService.markNotified).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 0/0'));
  });

  test('Push สำเร็จ → เรียก pushMessage แล้ว markNotified(id, today)', async () => {
    reminderService.findDueReminders.mockResolvedValue([reminder({ id: 'rem-1' })]);

    await runReminderPush();

    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    expect(lineService.pushMessage).toHaveBeenCalledWith('U123', expect.any(Object));
    // Push flex ต้องมีเนื้อหาของ Symbol
    expect(JSON.stringify(lineService.pushMessage.mock.calls[0][1])).toContain('BTC');
    // markNotified เฉพาะหลัง Push สำเร็จ
    expect(reminderService.markNotified).toHaveBeenCalledWith('rem-1', TODAY);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 1/1'));
  });

  test('Push ล้มเหลว 1 ตัว (User Block บอท) → ไม่ markNotified ตัวนั้น แต่ตัวอื่นยังถูก Push ต่อ', async () => {
    reminderService.findDueReminders.mockResolvedValue([
      reminder({ id: 'blocked', lineUserId: 'U-blocked' }),
      reminder({ id: 'ok', symbol: 'ETH', lineUserId: 'U-ok' }),
    ]);
    lineService.pushMessage.mockImplementation(async (to) => {
      if (to === 'U-blocked') throw new Error('403 blocked by user');
    });

    await runReminderPush();

    // ตัวที่ Push ล้มเหลวต้องไม่ถูก markNotified (จะได้ Retry รอบถัดไป)
    expect(reminderService.markNotified).not.toHaveBeenCalledWith('blocked', TODAY);
    // ตัวถัดไปยังถูกประมวลผลตามปกติ (Loop ไม่ล้มทั้งก้อน)
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(reminderService.markNotified).toHaveBeenCalledWith('ok', TODAY);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('blocked'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pushed 1/2'));
  });

  test('markNotified ล้มเหลวหลัง Push → catch ไว้ ไม่ล้ม Loop', async () => {
    reminderService.findDueReminders.mockResolvedValue([
      reminder({ id: 'a' }),
      reminder({ id: 'b', symbol: 'ETH' }),
    ]);
    reminderService.markNotified.mockImplementation(async (id) => {
      if (id === 'a') throw new Error('db write failed');
    });

    await runReminderPush();

    // ทั้งสองถูก Push, ตัว b ยัง mark สำเร็จ
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(reminderService.markNotified).toHaveBeenCalledWith('b', TODAY);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db write failed'));
  });

  test('Reminder ไม่มี lineUserId → ข้าม ไม่ Push ไม่ mark', async () => {
    reminderService.findDueReminders.mockResolvedValue([reminder({ id: 'no-user', lineUserId: null })]);

    await runReminderPush();

    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(reminderService.markNotified).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no lineUserId'));
  });

  test('findDueReminders ล้มเหลว (DB down) → catch ไว้ ไม่ throw, ไม่ Push', async () => {
    reminderService.findDueReminders.mockRejectedValue(new Error('db down'));

    await expect(runReminderPush()).resolves.toBeUndefined();

    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
