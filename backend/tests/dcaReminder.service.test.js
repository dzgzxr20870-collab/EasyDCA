jest.mock('../src/repositories/dcaReminder.repository');

const reminderRepository = require('../src/repositories/dcaReminder.repository');
const {
  createReminder,
  listReminders,
  deleteReminder,
  findDueReminders,
  isDueOn,
  markNotified,
  DcaReminderError,
} = require('../src/services/dcaReminder.service');

const USER_ID = 'user-uuid-1';

// สร้าง Reminder record จำลอง (โครงเดียวกับ dcaReminder.repository.toReminder)
function reminder(overrides = {}) {
  return {
    id: 'rem-1',
    userId: USER_ID,
    symbol: 'BTC',
    frequency: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: null,
    amountThb: 1000,
    active: true,
    lastNotifiedDate: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lineUserId: 'U123',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  reminderRepository.deactivateActive.mockResolvedValue(0);
  reminderRepository.insert.mockImplementation(async (data) => reminder(data));
});

describe('createReminder — weekly', () => {
  test('บันทึกสำเร็จ: ปิดของเก่าก่อนแล้ว insert (dayOfWeek set, dayOfMonth = null)', async () => {
    await createReminder(USER_ID, {
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      amountThb: 1000,
    });

    expect(reminderRepository.deactivateActive).toHaveBeenCalledWith(USER_ID, 'BTC');
    expect(reminderRepository.insert).toHaveBeenCalledWith({
      userId: USER_ID,
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      dayOfMonth: null,
      amountThb: 1000,
    });
    // ต้องปิดของเก่า "ก่อน" insert เสมอ (กันชน Unique Index one-active)
    expect(reminderRepository.deactivateActive.mock.invocationCallOrder[0]).toBeLessThan(
      reminderRepository.insert.mock.invocationCallOrder[0]
    );
  });

  test('มี Reminder เดิม Active อยู่ (deactivate คืน 1) → ยังสร้างใหม่ทับได้', async () => {
    reminderRepository.deactivateActive.mockResolvedValue(1);

    await createReminder(USER_ID, {
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 3,
      amountThb: 500,
    });

    expect(reminderRepository.insert).toHaveBeenCalledTimes(1);
  });

  test.each([-1, 7, 1.5, null, undefined])(
    'dayOfWeek ไม่ถูกต้อง (%s) → INVALID_REMINDER, ไม่แตะ DB',
    async (dayOfWeek) => {
      await expect(
        createReminder(USER_ID, { symbol: 'BTC', frequency: 'weekly', dayOfWeek, amountThb: 1000 })
      ).rejects.toMatchObject({ code: 'INVALID_REMINDER' });
      expect(reminderRepository.insert).not.toHaveBeenCalled();
      expect(reminderRepository.deactivateActive).not.toHaveBeenCalled();
    }
  );
});

describe('createReminder — monthly', () => {
  test('บันทึกสำเร็จ: dayOfMonth set, dayOfWeek = null', async () => {
    await createReminder(USER_ID, {
      symbol: 'AAPL',
      frequency: 'monthly',
      dayOfMonth: 5,
      amountThb: 3000,
    });

    expect(reminderRepository.insert).toHaveBeenCalledWith({
      userId: USER_ID,
      symbol: 'AAPL',
      frequency: 'monthly',
      dayOfWeek: null,
      dayOfMonth: 5,
      amountThb: 3000,
    });
  });

  test.each([0, 32, 5.5, null])(
    'dayOfMonth ไม่ถูกต้อง (%s) → INVALID_REMINDER',
    async (dayOfMonth) => {
      await expect(
        createReminder(USER_ID, {
          symbol: 'AAPL',
          frequency: 'monthly',
          dayOfMonth,
          amountThb: 3000,
        })
      ).rejects.toMatchObject({ code: 'INVALID_REMINDER' });
      expect(reminderRepository.insert).not.toHaveBeenCalled();
    }
  );
});

describe('createReminder — validation ทั่วไป', () => {
  test('frequency ไม่รู้จัก → INVALID_REMINDER', async () => {
    await expect(
      createReminder(USER_ID, { symbol: 'BTC', frequency: 'daily', dayOfWeek: 1, amountThb: 1000 })
    ).rejects.toMatchObject({ code: 'INVALID_REMINDER' });
  });

  test.each([0, -100, NaN])('amountThb ไม่ถูกต้อง (%s) → INVALID_REMINDER', async (amountThb) => {
    await expect(
      createReminder(USER_ID, { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 1, amountThb })
    ).rejects.toMatchObject({ code: 'INVALID_REMINDER' });
  });

  test('Error เป็น instance ของ DcaReminderError', async () => {
    await expect(
      createReminder(USER_ID, { symbol: 'BTC', frequency: 'bad', amountThb: 1000 })
    ).rejects.toBeInstanceOf(DcaReminderError);
  });
});

// Regression (S8 R3, migration 020) — currency ต้องไม่ทำให้ LINE Path เดิมเปลี่ยน
describe('createReminder — currency (migration 020) Backward Compat', () => {
  test('ไม่ส่ง currency (LINE Path เดิม) → insert payload ไม่มี key currency (repository Default THB เอง)', async () => {
    await createReminder(USER_ID, { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 1, amountThb: 1000 });

    const insertArg = reminderRepository.insert.mock.calls[0][0];
    expect(insertArg).not.toHaveProperty('currency'); // LINE ส่งเหมือนเดิมเป๊ะ
  });

  test('ส่ง currency=USD (เว็บ) → insert ได้ currency=USD', async () => {
    await createReminder(USER_ID, {
      symbol: 'AAPL',
      frequency: 'monthly',
      dayOfMonth: 15,
      amountThb: 100,
      currency: 'USD',
    });

    expect(reminderRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD' })
    );
  });

  test('currency ไม่ใช่ THB/USD → INVALID_REMINDER', async () => {
    await expect(
      createReminder(USER_ID, { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 1, amountThb: 1000, currency: 'EUR' })
    ).rejects.toMatchObject({ code: 'INVALID_REMINDER' });
  });
});

describe('listReminders', () => {
  test('คืนเฉพาะ Reminder ที่ active (ส่งต่อจาก repository)', async () => {
    const rows = [reminder({ id: 'a' }), reminder({ id: 'b', symbol: 'ETH' })];
    reminderRepository.findActiveByUser.mockResolvedValue(rows);

    const result = await listReminders(USER_ID);

    expect(reminderRepository.findActiveByUser).toHaveBeenCalledWith(USER_ID);
    expect(result).toBe(rows);
  });
});

describe('deleteReminder', () => {
  test('มี Active อยู่ (deactivate คืน 1) → คืนผลสำเร็จ', async () => {
    reminderRepository.deactivateActive.mockResolvedValue(1);

    const result = await deleteReminder(USER_ID, 'BTC');

    expect(reminderRepository.deactivateActive).toHaveBeenCalledWith(USER_ID, 'BTC');
    expect(result).toEqual({ symbol: 'BTC', deactivated: 1 });
  });

  test('ไม่มี Active (deactivate คืน 0) → REMINDER_NOT_FOUND', async () => {
    reminderRepository.deactivateActive.mockResolvedValue(0);

    await expect(deleteReminder(USER_ID, 'DOGE')).rejects.toMatchObject({
      code: 'REMINDER_NOT_FOUND',
    });
  });
});

describe('isDueOn — Logic ล้วน (ไม่แตะ DB)', () => {
  test('weekly: day_of_week ตรงกับวันนี้ → due', () => {
    expect(isDueOn(reminder({ frequency: 'weekly', dayOfWeek: 3 }), 3, 15, 31)).toBe(true);
  });

  test('weekly: day_of_week ไม่ตรง → ไม่ due', () => {
    expect(isDueOn(reminder({ frequency: 'weekly', dayOfWeek: 3 }), 4, 15, 31)).toBe(false);
  });

  test('monthly: day_of_month ตรงกับวันนี้ → due', () => {
    expect(
      isDueOn(reminder({ frequency: 'monthly', dayOfWeek: null, dayOfMonth: 5 }), 6, 5, 31)
    ).toBe(true);
  });

  test('Edge: ตั้งวันที่ 31 แต่เดือน ก.พ. มีถึง 28 → เลื่อนมาวันสุดท้าย (28) → due วันที่ 28', () => {
    const r = reminder({ frequency: 'monthly', dayOfWeek: null, dayOfMonth: 31 });
    // วันนี้ = 28, lastDom = 28 → effectiveDay = min(31,28)=28 = วันนี้ → due
    expect(isDueOn(r, 6, 28, 28)).toBe(true);
    // แต่ถ้าวันนี้เป็นวันที่ 27 (ไม่ใช่วันสุดท้าย) → ยังไม่ due
    expect(isDueOn(r, 5, 27, 28)).toBe(false);
  });

  test('monthly: ตั้งวันที่ 30 ในเดือน 31 วัน → due เฉพาะวันที่ 30 (ไม่เลื่อน)', () => {
    const r = reminder({ frequency: 'monthly', dayOfWeek: null, dayOfMonth: 30 });
    expect(isDueOn(r, 0, 30, 31)).toBe(true);
    expect(isDueOn(r, 0, 31, 31)).toBe(false);
  });
});

describe('findDueReminders — กรองตามวันจริง + Timezone-safe', () => {
  test('ส่ง today ให้ repository (เพื่อกรอง last_notified_date != today ที่ชั้น DB)', async () => {
    reminderRepository.findActiveDueCandidates.mockResolvedValue([]);

    await findDueReminders('2026-07-06');

    expect(reminderRepository.findActiveDueCandidates).toHaveBeenCalledWith('2026-07-06');
  });

  test('weekly: 2026-07-06 เป็นวันจันทร์ (dow=1) → คืนเฉพาะ Reminder จันทร์', async () => {
    reminderRepository.findActiveDueCandidates.mockResolvedValue([
      reminder({ id: 'mon', frequency: 'weekly', dayOfWeek: 1 }),
      reminder({ id: 'tue', frequency: 'weekly', dayOfWeek: 2 }),
    ]);

    const due = await findDueReminders('2026-07-06');

    expect(due.map((r) => r.id)).toEqual(['mon']);
  });

  test('Edge Timezone/วันหยุด: 2026-07-04 เป็นวันเสาร์ (ตลาดปิด) — reminder เสาร์ยัง Push (เพราะเป็นแค่การเตือน ไม่ได้ซื้อจริง)', async () => {
    reminderRepository.findActiveDueCandidates.mockResolvedValue([
      reminder({ id: 'sat', frequency: 'weekly', dayOfWeek: 6 }),
    ]);

    const due = await findDueReminders('2026-07-04');

    expect(due.map((r) => r.id)).toEqual(['sat']);
  });

  test('Edge สิ้นเดือน: 2026-02-28 (วันสุดท้าย ก.พ.) → reminder ที่ตั้งวันที่ 31 ถูกเลื่อนมา due วันนี้', async () => {
    reminderRepository.findActiveDueCandidates.mockResolvedValue([
      reminder({ id: 'd31', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 31 }),
      reminder({ id: 'd28', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 28 }),
      reminder({ id: 'd15', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 15 }),
    ]);

    const due = await findDueReminders('2026-02-28');

    // ทั้ง 31 (เลื่อนมา 28) และ 28 → due; 15 ไม่ due
    expect(due.map((r) => r.id).sort()).toEqual(['d28', 'd31']);
  });

  test('monthly ปกติ: 2026-07-15 → reminder วันที่ 15 due', async () => {
    reminderRepository.findActiveDueCandidates.mockResolvedValue([
      reminder({ id: 'd15', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 15 }),
      reminder({ id: 'd16', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 16 }),
    ]);

    const due = await findDueReminders('2026-07-15');

    expect(due.map((r) => r.id)).toEqual(['d15']);
  });
});

describe('markNotified', () => {
  test('ส่ง reminderId + date ต่อให้ repository', async () => {
    reminderRepository.markNotified.mockResolvedValue(reminder({ lastNotifiedDate: '2026-07-06' }));

    await markNotified('rem-1', '2026-07-06');

    expect(reminderRepository.markNotified).toHaveBeenCalledWith('rem-1', '2026-07-06');
  });
});
