jest.mock('../src/repositories/dcaReminder.repository');
jest.mock('../src/repositories/user.repository');

const reminderRepository = require('../src/repositories/dcaReminder.repository');
const userRepository = require('../src/repositories/user.repository');
const {
  createPlan,
  listPlans,
  updatePlan,
  deletePlanById,
  getTodayDuePlansForUser,
  isCurrencySupportedForSymbol,
  frequencyValueError,
  DcaReminderError,
} = require('../src/services/dcaReminder.service');

const USER_ID = 'user-uuid-1';

// reminder record จำลอง (โครงเดียวกับ dcaReminder.repository.toReminder + currency)
function reminder(overrides = {}) {
  return {
    id: 'plan-1',
    userId: USER_ID,
    symbol: 'BTC',
    frequency: 'weekly',
    dayOfWeek: 4,
    dayOfMonth: null,
    amountThb: 1000,
    currency: 'THB',
    active: true,
    lastNotifiedDate: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  reminderRepository.deactivateActive.mockResolvedValue(0);
  // Default: Premium Active → createPlan ไม่ติด DCA Planner Gate (พฤติกรรมเดิมทุกเทสต์)
  userRepository.findById.mockResolvedValue({ plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' });
  reminderRepository.findActiveByUser.mockResolvedValue([]);
});

describe('isCurrencySupportedForSymbol', () => {
  test('THB รองรับทุก symbol', () => {
    expect(isCurrencySupportedForSymbol('PTT', 'THB')).toBe(true); // stock_th
    expect(isCurrencySupportedForSymbol('GOLD', 'THB')).toBe(true); // gold_bar
  });
  test('USD เฉพาะ crypto/stock_us', () => {
    expect(isCurrencySupportedForSymbol('BTC', 'USD')).toBe(true); // crypto
    expect(isCurrencySupportedForSymbol('AAPL', 'USD')).toBe(true); // stock_us
    expect(isCurrencySupportedForSymbol('PTT', 'USD')).toBe(false); // stock_th
    expect(isCurrencySupportedForSymbol('GOLD', 'USD')).toBe(false); // gold_bar
  });
});

describe('frequencyValueError', () => {
  test('frequency ผิด → INVALID_FREQUENCY', () => {
    expect(frequencyValueError('yearly', 1)).toBe('INVALID_FREQUENCY');
  });
  test('weekly ต้อง 0-6', () => {
    expect(frequencyValueError('weekly', 0)).toBeNull();
    expect(frequencyValueError('weekly', 6)).toBeNull();
    expect(frequencyValueError('weekly', 7)).toBe('INVALID_FREQUENCY_VALUE');
    expect(frequencyValueError('weekly', -1)).toBe('INVALID_FREQUENCY_VALUE');
  });
  test('monthly ต้อง 1-31', () => {
    expect(frequencyValueError('monthly', 1)).toBeNull();
    expect(frequencyValueError('monthly', 31)).toBeNull();
    expect(frequencyValueError('monthly', 0)).toBe('INVALID_FREQUENCY_VALUE');
    expect(frequencyValueError('monthly', 32)).toBe('INVALID_FREQUENCY_VALUE');
  });
  test('ค่าไม่ใช่ integer → INVALID_FREQUENCY_VALUE', () => {
    expect(frequencyValueError('weekly', 1.5)).toBe('INVALID_FREQUENCY_VALUE');
    expect(frequencyValueError('monthly', NaN)).toBe('INVALID_FREQUENCY_VALUE');
  });
});

describe('createPlan', () => {
  test('คืน plan view พร้อม name/dayLabel + currency (Reuse createReminder)', async () => {
    reminderRepository.insert.mockImplementation(async (data) =>
      reminder({ ...data, id: 'plan-new', dayOfWeek: data.dayOfWeek, dayOfMonth: data.dayOfMonth })
    );

    const plan = await createPlan(USER_ID, {
      symbol: 'BTC',
      amountThb: 1000,
      currency: 'THB',
      frequency: 'weekly',
      dayOfWeek: 4,
      dayOfMonth: null,
    });

    // ปิดของเก่าก่อน insert (Reuse createReminder เดิม)
    expect(reminderRepository.deactivateActive).toHaveBeenCalledWith(USER_ID, 'BTC');
    expect(plan).toEqual(
      expect.objectContaining({
        id: 'plan-new',
        symbol: 'BTC',
        name: 'Bitcoin บิตคอยน์',
        amountTotal: 1000,
        currency: 'THB',
        frequency: 'weekly',
        dayOfWeek: 4,
        dayLabel: 'ทุกวันพฤหัสบดี',
        active: true,
      })
    );
  });

  test('currency USD ส่งต่อ repository.insert', async () => {
    reminderRepository.insert.mockImplementation(async (data) => reminder({ ...data, currency: 'USD' }));

    await createPlan(USER_ID, {
      symbol: 'AAPL',
      amountThb: 100,
      currency: 'USD',
      frequency: 'monthly',
      dayOfWeek: null,
      dayOfMonth: 15,
    });

    expect(reminderRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD', symbol: 'AAPL' })
    );
  });
});

describe('listPlans', () => {
  test('map แถวล่าสุดต่อ symbol → plan view (active + paused)', async () => {
    reminderRepository.findLatestPerSymbolByUser.mockResolvedValue([
      reminder({ id: 'p-btc', symbol: 'BTC', active: true }),
      reminder({ id: 'p-set', symbol: 'SET', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 16, active: false }),
    ]);

    const plans = await listPlans(USER_ID);

    expect(plans).toHaveLength(2);
    expect(plans[0]).toEqual(expect.objectContaining({ symbol: 'BTC', active: true, dayLabel: 'ทุกวันพฤหัสบดี' }));
    expect(plans[1]).toEqual(
      expect.objectContaining({ symbol: 'SET', active: false, dayLabel: 'ทุกวันที่ 16 ของเดือน' })
    );
  });
});

describe('getTodayDuePlansForUser', () => {
  test('weekly: due เมื่อ dayOfWeek ตรงกับวันนี้', async () => {
    reminderRepository.findActiveByUser.mockResolvedValue([reminder({ dayOfWeek: 4 })]);

    // 2026-07-16 = วันพฤหัส (dow=4) → due / 2026-07-17 = ศุกร์ (dow=5) → ไม่ due
    expect(await getTodayDuePlansForUser(USER_ID, '2026-07-16')).toHaveLength(1);
    expect(await getTodayDuePlansForUser(USER_ID, '2026-07-17')).toHaveLength(0);
  });

  test('monthly: due เมื่อ dayOfMonth ตรง', async () => {
    reminderRepository.findActiveByUser.mockResolvedValue([
      reminder({ symbol: 'SET', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 16 }),
    ]);
    expect(await getTodayDuePlansForUser(USER_ID, '2026-07-16')).toHaveLength(1);
    expect(await getTodayDuePlansForUser(USER_ID, '2026-07-17')).toHaveLength(0);
  });

  test('monthly clamp สิ้นเดือน: ตั้ง 31 → due วันสุดท้ายของเดือน ก.พ. (28)', async () => {
    reminderRepository.findActiveByUser.mockResolvedValue([
      reminder({ symbol: 'SET', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 31 }),
    ]);
    // 2026-02-28 เป็นวันสุดท้าย (lastDom=28) → min(31,28)=28=28 → due
    expect(await getTodayDuePlansForUser(USER_ID, '2026-02-28')).toHaveLength(1);
    // 2026-02-27 ยังไม่ใช่วันสุดท้าย → ไม่ due
    expect(await getTodayDuePlansForUser(USER_ID, '2026-02-27')).toHaveLength(0);
  });

  test('ใช้ findActiveByUser (แผน paused ไม่ติดเพราะ query กรอง active แล้ว)', async () => {
    reminderRepository.findActiveByUser.mockResolvedValue([]);
    await getTodayDuePlansForUser(USER_ID, '2026-07-16');
    expect(reminderRepository.findActiveByUser).toHaveBeenCalledWith(USER_ID);
    expect(reminderRepository.findLatestPerSymbolByUser).not.toHaveBeenCalled();
  });

  test('คืน plan view พร้อม name/amountTotal/dayLabel', async () => {
    reminderRepository.findActiveByUser.mockResolvedValue([
      reminder({ symbol: 'SET', frequency: 'monthly', dayOfWeek: null, dayOfMonth: 16, amountThb: 3000 }),
    ]);
    const [plan] = await getTodayDuePlansForUser(USER_ID, '2026-07-16');
    expect(plan).toEqual(
      expect.objectContaining({
        symbol: 'SET',
        name: 'ดัชนี SET50',
        amountTotal: 3000,
        dayLabel: 'ทุกวันที่ 16 ของเดือน',
      })
    );
  });
});

describe('updatePlan', () => {
  test('ไม่พบแผน (ไม่ใช่ของ user) → PLAN_NOT_FOUND', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(null);
    await expect(updatePlan(USER_ID, 'nope', { amountThb: 500 })).rejects.toMatchObject({
      code: 'PLAN_NOT_FOUND',
    });
    expect(reminderRepository.updateByIdForUser).not.toHaveBeenCalled();
  });

  test('แก้ amount → update amount_thb', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(reminder());
    reminderRepository.updateByIdForUser.mockImplementation(async (id, uid, patch) =>
      reminder({ ...patch, amountThb: patch.amount_thb ?? 1000 })
    );

    const plan = await updatePlan(USER_ID, 'plan-1', { amountThb: 2500 });

    expect(reminderRepository.updateByIdForUser).toHaveBeenCalledWith(
      'plan-1',
      USER_ID,
      expect.objectContaining({ amount_thb: 2500 })
    );
    expect(plan.amountTotal).toBe(2500);
  });

  test('amount ≤ 0 → VALIDATION_ERROR (ไม่ update)', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(reminder());
    await expect(updatePlan(USER_ID, 'plan-1', { amountThb: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(reminderRepository.updateByIdForUser).not.toHaveBeenCalled();
  });

  test('เปลี่ยน currency USD บนหุ้นไทย → CURRENCY_NOT_SUPPORTED_FOR_ASSET', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(reminder({ symbol: 'PTT' }));
    await expect(updatePlan(USER_ID, 'plan-1', { currency: 'USD' })).rejects.toMatchObject({
      code: 'CURRENCY_NOT_SUPPORTED_FOR_ASSET',
    });
  });

  test('เปลี่ยน frequency weekly→monthly ต้องเซ็ต day_of_month + null day_of_week', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(reminder({ frequency: 'weekly', dayOfWeek: 4 }));
    reminderRepository.updateByIdForUser.mockImplementation(async (id, uid, patch) => reminder(patch));

    await updatePlan(USER_ID, 'plan-1', { frequency: 'monthly', frequencyValue: 20 });

    expect(reminderRepository.updateByIdForUser).toHaveBeenCalledWith(
      'plan-1',
      USER_ID,
      expect.objectContaining({ frequency: 'monthly', day_of_month: 20, day_of_week: null })
    );
  });

  test('frequencyValue นอกช่วง → INVALID_FREQUENCY_VALUE', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(reminder({ frequency: 'monthly', dayOfWeek: null, dayOfMonth: 1 }));
    await expect(updatePlan(USER_ID, 'plan-1', { frequencyValue: 40 })).rejects.toMatchObject({
      code: 'INVALID_FREQUENCY_VALUE',
    });
  });

  // ── Regression: เปลี่ยน frequency โดยไม่ส่ง frequencyValue ต้อง Error (ไม่เดาจาก
  // Field เดิมที่เป็น null) — บั๊กเดิม: monthly→weekly กลายเป็นวันอาทิตย์เงียบๆ เพราะ
  // Number(existing.dayOfWeek=null)=0 บังเอิญผ่าน Range weekly (0=อาทิตย์) ────────
  test('เปลี่ยน monthly→weekly โดยไม่ส่ง frequencyValue → INVALID_FREQUENCY_VALUE (บั๊กเดิม)', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(
      reminder({ frequency: 'monthly', dayOfWeek: null, dayOfMonth: 16 })
    );

    await expect(updatePlan(USER_ID, 'plan-1', { frequency: 'weekly' })).rejects.toMatchObject({
      code: 'INVALID_FREQUENCY_VALUE',
    });
    // ต้องไม่บันทึกแผนวันอาทิตย์แบบเงียบๆ
    expect(reminderRepository.updateByIdForUser).not.toHaveBeenCalled();
  });

  test('เปลี่ยน weekly→monthly โดยไม่ส่ง frequencyValue → INVALID_FREQUENCY_VALUE (ทิศตรงข้าม)', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(
      reminder({ frequency: 'weekly', dayOfWeek: 4, dayOfMonth: null })
    );

    await expect(updatePlan(USER_ID, 'plan-1', { frequency: 'monthly' })).rejects.toMatchObject({
      code: 'INVALID_FREQUENCY_VALUE',
    });
    expect(reminderRepository.updateByIdForUser).not.toHaveBeenCalled();
  });

  test('เปลี่ยน frequencyValue อย่างเดียว (ไม่เปลี่ยน frequency) → ขยับวันเดิมได้ปกติ', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(
      reminder({ frequency: 'monthly', dayOfWeek: null, dayOfMonth: 16 })
    );
    reminderRepository.updateByIdForUser.mockImplementation(async (id, uid, patch) => reminder(patch));

    await updatePlan(USER_ID, 'plan-1', { frequencyValue: 25 });

    expect(reminderRepository.updateByIdForUser).toHaveBeenCalledWith(
      'plan-1',
      USER_ID,
      expect.objectContaining({ frequency: 'monthly', day_of_month: 25, day_of_week: null })
    );
  });

  test('ส่งทั้ง frequency + frequencyValue (monthly→weekly ครบคู่) → บันทึกถูกต้อง', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(
      reminder({ frequency: 'monthly', dayOfWeek: null, dayOfMonth: 16 })
    );
    reminderRepository.updateByIdForUser.mockImplementation(async (id, uid, patch) => reminder(patch));

    await updatePlan(USER_ID, 'plan-1', { frequency: 'weekly', frequencyValue: 4 });

    expect(reminderRepository.updateByIdForUser).toHaveBeenCalledWith(
      'plan-1',
      USER_ID,
      expect.objectContaining({ frequency: 'weekly', day_of_week: 4, day_of_month: null })
    );
  });

  test('reactivate (active=true) → deactivate active อื่นของ symbol ก่อน update', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(reminder({ active: false, symbol: 'BTC' }));
    reminderRepository.updateByIdForUser.mockImplementation(async (id, uid, patch) => reminder({ ...patch, active: true }));

    await updatePlan(USER_ID, 'plan-1', { active: true });

    expect(reminderRepository.deactivateActive).toHaveBeenCalledWith(USER_ID, 'BTC');
    // deactivate ต้องมาก่อน update (กันชน unique index)
    expect(reminderRepository.deactivateActive.mock.invocationCallOrder[0]).toBeLessThan(
      reminderRepository.updateByIdForUser.mock.invocationCallOrder[0]
    );
    expect(reminderRepository.updateByIdForUser).toHaveBeenCalledWith(
      'plan-1',
      USER_ID,
      expect.objectContaining({ active: true })
    );
  });

  test('pause (active=false) → ไม่เรียก deactivateActive (ไม่ต้องกันชน)', async () => {
    reminderRepository.findByIdForUser.mockResolvedValue(reminder({ active: true }));
    reminderRepository.updateByIdForUser.mockImplementation(async (id, uid, patch) => reminder({ ...patch, active: false }));

    await updatePlan(USER_ID, 'plan-1', { active: false });

    expect(reminderRepository.deactivateActive).not.toHaveBeenCalled();
    expect(reminderRepository.updateByIdForUser).toHaveBeenCalledWith(
      'plan-1',
      USER_ID,
      expect.objectContaining({ active: false })
    );
  });
});

describe('deletePlanById', () => {
  test('ลบสำเร็จ (1 แถว)', async () => {
    reminderRepository.deleteByIdForUser.mockResolvedValue(1);
    const result = await deletePlanById(USER_ID, 'plan-1');
    expect(result).toEqual({ id: 'plan-1', deleted: 1 });
    expect(reminderRepository.deleteByIdForUser).toHaveBeenCalledWith('plan-1', USER_ID);
  });

  test('ไม่พบ (0 แถว) → PLAN_NOT_FOUND', async () => {
    reminderRepository.deleteByIdForUser.mockResolvedValue(0);
    await expect(deletePlanById(USER_ID, 'nope')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
  });
});

// สำหรับความชัดเจน — DcaReminderError export ถูกต้อง
test('DcaReminderError เป็น Error class ที่มี code', () => {
  const e = new DcaReminderError('X', 'msg', { a: 1 });
  expect(e).toBeInstanceOf(Error);
  expect(e.code).toBe('X');
});
