jest.mock('../src/services/dcaReminder.service');

const dcaReminderService = require('../src/services/dcaReminder.service');
const { createPlan, listPlans, updatePlan, deletePlan } = require('../src/controllers/dcaPlans.controller');

// service เป็น Automock — DcaReminderError class หายไป ต้องประกาศเอง (Pattern เดียวกับ
// dashboard.controller.test.js ที่ต้องประกาศ ProfitServiceError เอง)
class MockDcaReminderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DcaReminderError';
    this.code = code;
    this.details = details;
  }
}
dcaReminderService.DcaReminderError = MockDcaReminderError;
// helpers ที่ Controller Reuse (Automock คืน undefined — ต้องให้พฤติกรรมจริง)
dcaReminderService.isCurrencySupportedForSymbol.mockImplementation((symbol, currency) => {
  if (currency === 'THB') return true;
  if (currency !== 'USD') return false;
  return ['BTC', 'ETH', 'AAPL', 'NVDA'].includes(symbol); // crypto/stock_us จำลอง
});
dcaReminderService.frequencyValueError.mockImplementation((frequency, value) => {
  if (frequency !== 'weekly' && frequency !== 'monthly') return 'INVALID_FREQUENCY';
  if (!Number.isInteger(value)) return 'INVALID_FREQUENCY_VALUE';
  if (frequency === 'weekly' && (value < 0 || value > 6)) return 'INVALID_FREQUENCY_VALUE';
  if (frequency === 'monthly' && (value < 1 || value > 31)) return 'INVALID_FREQUENCY_VALUE';
  return null;
});

const USER_ID = 'user-uuid-1';

function mockReq({ body = {}, params = {} } = {}) {
  return { user: { id: USER_ID }, body, params };
}
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const jsonOf = (res) => res.json.mock.calls[0][0];
const statusOf = (res) => res.status.mock.calls[0][0];

const SAMPLE_PLAN = {
  id: 'plan-1', symbol: 'BTC', name: 'Bitcoin บิตคอยน์', amountTotal: 1000, currency: 'THB',
  frequency: 'weekly', dayOfWeek: 4, dayOfMonth: null, dayLabel: 'ทุกวันพฤหัสบดี', active: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  // helper mock ต้องตั้งใหม่หลัง clearAllMocks (clear ล้าง implementation ของ mockFn)
  dcaReminderService.isCurrencySupportedForSymbol.mockImplementation((symbol, currency) => {
    if (currency === 'THB') return true;
    if (currency !== 'USD') return false;
    return ['BTC', 'ETH', 'AAPL', 'NVDA'].includes(symbol);
  });
  dcaReminderService.frequencyValueError.mockImplementation((frequency, value) => {
    if (frequency !== 'weekly' && frequency !== 'monthly') return 'INVALID_FREQUENCY';
    if (!Number.isInteger(value)) return 'INVALID_FREQUENCY_VALUE';
    if (frequency === 'weekly' && (value < 0 || value > 6)) return 'INVALID_FREQUENCY_VALUE';
    if (frequency === 'monthly' && (value < 1 || value > 31)) return 'INVALID_FREQUENCY_VALUE';
    return null;
  });
});

describe('POST /dca-plans — createPlan', () => {
  test('สำเร็จ → 201 + plan', async () => {
    dcaReminderService.createPlan.mockResolvedValue(SAMPLE_PLAN);
    const res = mockRes();
    await createPlan(
      mockReq({ body: { symbol: 'btc', amountTotal: 1000, frequency: 'weekly', frequencyValue: 4 } }),
      res
    );
    expect(statusOf(res)).toBe(201);
    expect(jsonOf(res).plan).toEqual(SAMPLE_PLAN);
    // symbol normalize เป็นตัวใหญ่ก่อนส่ง service
    expect(dcaReminderService.createPlan).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ symbol: 'BTC', amountThb: 1000, currency: 'THB', frequency: 'weekly', dayOfWeek: 4, dayOfMonth: null })
    );
  });

  // DCA Planner Gate (Business Model Beta) — service โยน PLAN_LIMIT_REACHED เมื่อ Free
  // มีแผนครบโควตา → Controller ต้องตอบ 403 (ไม่ใช่ 400/500) + ข้อความชวนอัพเกรด
  test('service โยน PLAN_LIMIT_REACHED → 403 + ข้อความชวนอัพเกรด', async () => {
    dcaReminderService.createPlan.mockRejectedValue(
      new MockDcaReminderError('PLAN_LIMIT_REACHED', 'limit', { limit: 2, current: 2 })
    );
    const res = mockRes();
    await createPlan(
      mockReq({ body: { symbol: 'BTC', amountTotal: 1000, frequency: 'weekly', frequencyValue: 4 } }),
      res
    );
    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('PLAN_LIMIT_REACHED');
    expect(jsonOf(res).message).toMatch(/Premium/);
  });

  test('symbol นอก registry → 400 SYMBOL_NOT_SUPPORTED', async () => {
    const res = mockRes();
    await createPlan(mockReq({ body: { symbol: 'NOTREAL', amountTotal: 1000, frequency: 'weekly', frequencyValue: 4 } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('SYMBOL_NOT_SUPPORTED');
    expect(jsonOf(res).message).toMatch(/ยังไม่รองรับ/);
    expect(dcaReminderService.createPlan).not.toHaveBeenCalled();
  });

  test.each([
    ['amount 0', { symbol: 'BTC', amountTotal: 0, frequency: 'weekly', frequencyValue: 4 }],
    ['amount ติดลบ', { symbol: 'BTC', amountTotal: -5, frequency: 'weekly', frequencyValue: 4 }],
    ['amount ไม่ใช่เลข', { symbol: 'BTC', amountTotal: 'x', frequency: 'weekly', frequencyValue: 4 }],
  ])('%s → 400 VALIDATION_ERROR', async (_l, body) => {
    const res = mockRes();
    await createPlan(mockReq({ body }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(dcaReminderService.createPlan).not.toHaveBeenCalled();
  });

  test('frequency ผิด → 400 INVALID_FREQUENCY', async () => {
    const res = mockRes();
    await createPlan(mockReq({ body: { symbol: 'BTC', amountTotal: 1000, frequency: 'yearly', frequencyValue: 4 } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('INVALID_FREQUENCY');
  });

  test('weekly frequencyValue 7 → 400 INVALID_FREQUENCY_VALUE', async () => {
    const res = mockRes();
    await createPlan(mockReq({ body: { symbol: 'BTC', amountTotal: 1000, frequency: 'weekly', frequencyValue: 7 } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('INVALID_FREQUENCY_VALUE');
  });

  test('monthly frequencyValue 0 → 400 INVALID_FREQUENCY_VALUE', async () => {
    const res = mockRes();
    await createPlan(mockReq({ body: { symbol: 'BTC', amountTotal: 1000, frequency: 'monthly', frequencyValue: 0 } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('INVALID_FREQUENCY_VALUE');
  });

  test('USD บนหุ้นไทย → 400 CURRENCY_NOT_SUPPORTED_FOR_ASSET', async () => {
    const res = mockRes();
    await createPlan(mockReq({ body: { symbol: 'PTT', amountTotal: 1000, currency: 'USD', frequency: 'monthly', frequencyValue: 16 } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('CURRENCY_NOT_SUPPORTED_FOR_ASSET');
    expect(dcaReminderService.createPlan).not.toHaveBeenCalled();
  });

  test('currency ที่ไม่รู้จัก → 400 VALIDATION_ERROR', async () => {
    const res = mockRes();
    await createPlan(mockReq({ body: { symbol: 'BTC', amountTotal: 1000, currency: 'EUR', frequency: 'weekly', frequencyValue: 4 } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
  });
});

describe('GET /dca-plans — listPlans', () => {
  test('สำเร็จ → 200 + plans[]', async () => {
    dcaReminderService.listPlans.mockResolvedValue([SAMPLE_PLAN]);
    const res = mockRes();
    await listPlans(mockReq(), res);
    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).plans).toEqual([SAMPLE_PLAN]);
    expect(dcaReminderService.listPlans).toHaveBeenCalledWith(USER_ID);
  });
});

describe('PATCH /dca-plans/:id — updatePlan', () => {
  test('สำเร็จ → 200 + plan', async () => {
    dcaReminderService.updatePlan.mockResolvedValue({ ...SAMPLE_PLAN, amountTotal: 2000 });
    const res = mockRes();
    await updatePlan(mockReq({ params: { id: 'plan-1' }, body: { amountTotal: 2000 } }), res);
    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).plan.amountTotal).toBe(2000);
    expect(dcaReminderService.updatePlan).toHaveBeenCalledWith(USER_ID, 'plan-1', { amountThb: 2000 });
  });

  test('toggle active=false (pause)', async () => {
    dcaReminderService.updatePlan.mockResolvedValue({ ...SAMPLE_PLAN, active: false });
    const res = mockRes();
    await updatePlan(mockReq({ params: { id: 'plan-1' }, body: { active: false } }), res);
    expect(statusOf(res)).toBe(200);
    expect(dcaReminderService.updatePlan).toHaveBeenCalledWith(USER_ID, 'plan-1', { active: false });
  });

  test('body ว่าง (ไม่มี field แก้) → 400 VALIDATION_ERROR', async () => {
    const res = mockRes();
    await updatePlan(mockReq({ params: { id: 'plan-1' }, body: {} }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
    expect(dcaReminderService.updatePlan).not.toHaveBeenCalled();
  });

  test('active ไม่ใช่ boolean → 400 VALIDATION_ERROR', async () => {
    const res = mockRes();
    await updatePlan(mockReq({ params: { id: 'plan-1' }, body: { active: 'yes' } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('VALIDATION_ERROR');
  });

  test('service โยน PLAN_NOT_FOUND → 404', async () => {
    dcaReminderService.updatePlan.mockRejectedValue(new MockDcaReminderError('PLAN_NOT_FOUND', 'nope'));
    const res = mockRes();
    await updatePlan(mockReq({ params: { id: 'x' }, body: { amountTotal: 100 } }), res);
    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('PLAN_NOT_FOUND');
  });

  test('service โยน CURRENCY_NOT_SUPPORTED_FOR_ASSET → 400', async () => {
    dcaReminderService.updatePlan.mockRejectedValue(
      new MockDcaReminderError('CURRENCY_NOT_SUPPORTED_FOR_ASSET', 'no')
    );
    const res = mockRes();
    await updatePlan(mockReq({ params: { id: 'plan-1' }, body: { currency: 'USD' } }), res);
    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('CURRENCY_NOT_SUPPORTED_FOR_ASSET');
  });
});

describe('DELETE /dca-plans/:id — deletePlan', () => {
  test('สำเร็จ → 200 + deleted.id', async () => {
    dcaReminderService.deletePlanById.mockResolvedValue({ id: 'plan-1', deleted: 1 });
    const res = mockRes();
    await deletePlan(mockReq({ params: { id: 'plan-1' } }), res);
    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).deleted).toEqual({ id: 'plan-1' });
    expect(dcaReminderService.deletePlanById).toHaveBeenCalledWith(USER_ID, 'plan-1');
  });

  test('ไม่พบ → 404 PLAN_NOT_FOUND', async () => {
    dcaReminderService.deletePlanById.mockRejectedValue(new MockDcaReminderError('PLAN_NOT_FOUND', 'nope'));
    const res = mockRes();
    await deletePlan(mockReq({ params: { id: 'x' } }), res);
    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('PLAN_NOT_FOUND');
  });
});

describe('Error ที่ไม่คาดคิด → 500 (ไม่หลุด Error ดิบ)', () => {
  test('createPlan service throw generic → 500 INTERNAL_ERROR', async () => {
    dcaReminderService.createPlan.mockRejectedValue(new Error('boom: secret'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await createPlan(mockReq({ body: { symbol: 'BTC', amountTotal: 1000, frequency: 'weekly', frequencyValue: 4 } }), res);
    expect(statusOf(res)).toBe(500);
    expect(jsonOf(res).error).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(jsonOf(res))).not.toMatch(/secret/);
    console.error.mockRestore();
  });
});
