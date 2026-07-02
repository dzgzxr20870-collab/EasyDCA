jest.mock('../src/repositories/reminderSetupSession.repository');
jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/dcaReminder.service');

const sessionRepository = require('../src/repositories/reminderSetupSession.repository');
const portfolioService = require('../src/services/portfolio.service');
const dcaReminderService = require('../src/services/dcaReminder.service');
const {
  STEPS,
  startFlow,
  handleSymbolSelected,
  handleFrequencySelected,
  handleDaySelected,
  handleAmountEntered,
  cancelFlow,
  getCurrentSession,
  purgeStaleSessions,
  ReminderSetupError,
} = require('../src/services/reminderSetupFlow.service');

const USER_ID = 'user-uuid-1';

// สร้าง Session record จำลอง (โครงเดียวกับ reminderSetupSession.repository.toSession)
function session(overrides = {}) {
  return {
    userId: USER_ID,
    step: STEPS.AWAITING_SYMBOL,
    symbol: null,
    frequency: null,
    dayOfWeek: null,
    dayOfMonth: null,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: findValidByUser คืน Session ตาม step ที่แต่ละ Test ตั้ง (override เอง)
  sessionRepository.upsert.mockImplementation(async (data) => session(data));
  sessionRepository.updateByUser.mockImplementation(async (userId, patch) => session(patch));
  sessionRepository.deleteByUser.mockResolvedValue(undefined);
});

describe('startFlow', () => {
  test('พอร์ตมีสินทรัพย์ → UPSERT Session step=AWAITING_SYMBOL + คืนรายการ Symbol', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      holdings: [{ symbol: 'BTC' }, { symbol: 'ETH' }],
      totalInvested: 5000,
    });

    const result = await startFlow(USER_ID);

    expect(sessionRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, step: STEPS.AWAITING_SYMBOL })
    );
    expect(result).toEqual({ symbols: ['BTC', 'ETH'] });
  });

  test('พอร์ตว่างเปล่า → PORTFOLIO_EMPTY_FOR_REMINDER (ไม่สร้าง Session)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({ isEmpty: true, holdings: [] });

    await expect(startFlow(USER_ID)).rejects.toMatchObject({ code: 'PORTFOLIO_EMPTY_FOR_REMINDER' });
    expect(sessionRepository.upsert).not.toHaveBeenCalled();
  });

  test('มี Session เก่าค้างอยู่ → เขียนทับได้เสมอ (UPSERT) ไม่ throw', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      holdings: [{ symbol: 'BTC' }],
    });

    await expect(startFlow(USER_ID)).resolves.toEqual({ symbols: ['BTC'] });
    expect(sessionRepository.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('handleSymbolSelected', () => {
  test('Session อยู่ AWAITING_SYMBOL → เก็บ symbol + ไป AWAITING_FREQUENCY', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(session({ step: STEPS.AWAITING_SYMBOL }));

    await handleSymbolSelected(USER_ID, 'BTC');

    expect(sessionRepository.updateByUser).toHaveBeenCalledWith(USER_ID, {
      symbol: 'BTC',
      step: STEPS.AWAITING_FREQUENCY,
    });
  });

  test('ไม่มี Session (หมดอายุ/ไม่เคยเริ่ม) → SETUP_SESSION_NOT_FOUND', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);

    await expect(handleSymbolSelected(USER_ID, 'BTC')).rejects.toMatchObject({
      code: 'SETUP_SESSION_NOT_FOUND',
    });
    expect(sessionRepository.updateByUser).not.toHaveBeenCalled();
  });

  test('Session อยู่คนละขั้น (กดปุ่มเก่า) → WRONG_STEP', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(session({ step: STEPS.AWAITING_AMOUNT }));

    await expect(handleSymbolSelected(USER_ID, 'BTC')).rejects.toMatchObject({ code: 'WRONG_STEP' });
    expect(sessionRepository.updateByUser).not.toHaveBeenCalled();
  });
});

describe('handleFrequencySelected', () => {
  test('AWAITING_FREQUENCY → เก็บ frequency + ไป AWAITING_DAY', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(
      session({ step: STEPS.AWAITING_FREQUENCY, symbol: 'BTC' })
    );

    await handleFrequencySelected(USER_ID, 'weekly');

    expect(sessionRepository.updateByUser).toHaveBeenCalledWith(USER_ID, {
      frequency: 'weekly',
      step: STEPS.AWAITING_DAY,
    });
  });

  test('frequency ไม่รู้จัก → WRONG_STEP (Guard เชิงป้องกัน)', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(session({ step: STEPS.AWAITING_FREQUENCY }));

    await expect(handleFrequencySelected(USER_ID, 'daily')).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
  });

  test('ผิดขั้น → WRONG_STEP', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(session({ step: STEPS.AWAITING_SYMBOL }));

    await expect(handleFrequencySelected(USER_ID, 'weekly')).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
  });
});

describe('handleDaySelected', () => {
  test('weekly → เก็บ day_of_week + ไป AWAITING_AMOUNT', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(
      session({ step: STEPS.AWAITING_DAY, symbol: 'BTC', frequency: 'weekly' })
    );

    await handleDaySelected(USER_ID, 1);

    expect(sessionRepository.updateByUser).toHaveBeenCalledWith(USER_ID, {
      day_of_week: 1,
      step: STEPS.AWAITING_AMOUNT,
    });
  });

  test('monthly → เก็บ day_of_month + ไป AWAITING_AMOUNT', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(
      session({ step: STEPS.AWAITING_DAY, symbol: 'AAPL', frequency: 'monthly' })
    );

    await handleDaySelected(USER_ID, 15);

    expect(sessionRepository.updateByUser).toHaveBeenCalledWith(USER_ID, {
      day_of_month: 15,
      step: STEPS.AWAITING_AMOUNT,
    });
  });

  test.each([-1, 7, 3.5, NaN])('weekly day นอกช่วง (%s) → INVALID_DAY, ไม่อัปเดต Session', async (d) => {
    sessionRepository.findValidByUser.mockResolvedValue(
      session({ step: STEPS.AWAITING_DAY, frequency: 'weekly' })
    );

    await expect(handleDaySelected(USER_ID, d)).rejects.toMatchObject({ code: 'INVALID_DAY' });
    expect(sessionRepository.updateByUser).not.toHaveBeenCalled();
  });

  test.each([0, 32, 45, 5.5])('monthly day นอกช่วง (%s) → INVALID_DAY (พิมพ์เองผิด)', async (d) => {
    sessionRepository.findValidByUser.mockResolvedValue(
      session({ step: STEPS.AWAITING_DAY, frequency: 'monthly' })
    );

    await expect(handleDaySelected(USER_ID, d)).rejects.toMatchObject({ code: 'INVALID_DAY' });
    expect(sessionRepository.updateByUser).not.toHaveBeenCalled();
  });

  test('ผิดขั้น → WRONG_STEP', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(session({ step: STEPS.AWAITING_FREQUENCY }));

    await expect(handleDaySelected(USER_ID, 1)).rejects.toMatchObject({ code: 'WRONG_STEP' });
  });
});

describe('handleAmountEntered', () => {
  test('จำนวนเงินถูกต้อง → เรียก createReminder ของเดิมด้วยข้อมูลสะสม แล้วลบ Session', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(
      session({
        step: STEPS.AWAITING_AMOUNT,
        symbol: 'BTC',
        frequency: 'weekly',
        dayOfWeek: 1,
        dayOfMonth: null,
      })
    );
    dcaReminderService.createReminder.mockResolvedValue({ id: 'rem-1', symbol: 'BTC' });

    const result = await handleAmountEntered(USER_ID, 1000);

    expect(dcaReminderService.createReminder).toHaveBeenCalledWith(USER_ID, {
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      dayOfMonth: null,
      amountThb: 1000,
    });
    // ลบ Session หลังสร้างสำเร็จ (จบ Flow)
    expect(sessionRepository.deleteByUser).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual({ id: 'rem-1', symbol: 'BTC' });
  });

  test.each([0, -50, NaN])(
    'จำนวนเงินไม่ถูกต้อง (%s) → INVALID_AMOUNT และ "ไม่ลบ Session" (ให้พิมพ์ใหม่ได้)',
    async (amount) => {
      sessionRepository.findValidByUser.mockResolvedValue(
        session({ step: STEPS.AWAITING_AMOUNT, symbol: 'BTC', frequency: 'weekly', dayOfWeek: 1 })
      );

      await expect(handleAmountEntered(USER_ID, amount)).rejects.toMatchObject({
        code: 'INVALID_AMOUNT',
      });
      expect(dcaReminderService.createReminder).not.toHaveBeenCalled();
      expect(sessionRepository.deleteByUser).not.toHaveBeenCalled();
    }
  );

  test('createReminder throw (ข้อมูลเพี้ยน) → Session ไม่ถูกลบ (ลองใหม่ได้)', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(
      session({ step: STEPS.AWAITING_AMOUNT, symbol: 'BTC', frequency: 'weekly', dayOfWeek: 1 })
    );
    dcaReminderService.createReminder.mockRejectedValue(new Error('boom'));

    await expect(handleAmountEntered(USER_ID, 1000)).rejects.toThrow('boom');
    expect(sessionRepository.deleteByUser).not.toHaveBeenCalled();
  });

  test('ไม่มี Session → SETUP_SESSION_NOT_FOUND', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);

    await expect(handleAmountEntered(USER_ID, 1000)).rejects.toMatchObject({
      code: 'SETUP_SESSION_NOT_FOUND',
    });
  });
});

describe('cancelFlow', () => {
  test('ลบ Session ทิ้ง', async () => {
    await cancelFlow(USER_ID);
    expect(sessionRepository.deleteByUser).toHaveBeenCalledWith(USER_ID);
  });
});

describe('getCurrentSession — TTL', () => {
  test('ส่ง cutoff (now - 5 นาที) ให้ repository เพื่อกรอง Session หมดอายุ', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);
    const before = Date.now() - 5 * 60 * 1000;

    await getCurrentSession(USER_ID);

    expect(sessionRepository.findValidByUser).toHaveBeenCalledTimes(1);
    const [userIdArg, cutoffArg] = sessionRepository.findValidByUser.mock.calls[0];
    expect(userIdArg).toBe(USER_ID);
    const cutoffMs = new Date(cutoffArg).getTime();
    // cutoff ควรอยู่ราวๆ now-5นาที (เผื่อ Tolerance 2 วินาที)
    expect(Math.abs(cutoffMs - before)).toBeLessThan(2000);
  });

  test('repository คืน null (หมดอายุ) → getCurrentSession คืน null', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);
    await expect(getCurrentSession(USER_ID)).resolves.toBeNull();
  });
});

describe('purgeStaleSessions', () => {
  test('ส่ง cutoff (now - retention) ให้ repository.purgeStaleBefore แล้วคืนจำนวน', async () => {
    sessionRepository.purgeStaleBefore.mockResolvedValue(4);

    const count = await purgeStaleSessions(60);

    expect(sessionRepository.purgeStaleBefore).toHaveBeenCalledTimes(1);
    expect(count).toBe(4);
  });
});

describe('ReminderSetupError', () => {
  test('Error ที่โยนเป็น instance ของ ReminderSetupError (มี code)', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);
    await expect(handleSymbolSelected(USER_ID, 'BTC')).rejects.toBeInstanceOf(ReminderSetupError);
  });
});
