// ═══════════════════════════════════════════════════════════════════════════
// Unit — guidedBuyFlow.service (Guided Buy Flow, S8 R2 รอบ 2)
// ═══════════════════════════════════════════════════════════════════════════
// State Machine ล้วนๆ: AWAITING_SYMBOL → AWAITING_AMOUNT → คืนพารามิเตอร์ให้
// Controller Route ต่อ — Mock Repository + Flow เพื่อนบ้าน (ตั้งเตือน/นำเข้าพอร์ต)
//
// ⚠️ สิ่งที่ Test ชุดนี้ "ต้องพิสูจน์ให้ได้" คือ Service นี้ไม่แตะเงินเลย: ไม่มีการ
// เรียก createPending/transaction ใดๆ — หน้าที่มันคือเก็บ State แล้วคืนค่าเท่านั้น

jest.mock('../src/repositories/guidedBuySession.repository');
jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/reminderSetupFlow.service');
jest.mock('../src/services/bulkImportSession.service');

const sessionRepository = require('../src/repositories/guidedBuySession.repository');
const portfolioService = require('../src/services/portfolio.service');
const reminderSetupFlow = require('../src/services/reminderSetupFlow.service');
const bulkImportSession = require('../src/services/bulkImportSession.service');

const guidedBuyFlow = require('../src/services/guidedBuyFlow.service');

const { STEPS } = guidedBuyFlow;
const USER_ID = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
  reminderSetupFlow.getCurrentSession.mockResolvedValue(null);
  reminderSetupFlow.cancelFlow.mockResolvedValue(undefined);
  bulkImportSession.getCurrentSession.mockResolvedValue(null);
  bulkImportSession.clearSession.mockResolvedValue(undefined);
  portfolioService.getPortfolioSummary.mockResolvedValue({ isEmpty: false, holdings: [] });
  sessionRepository.upsert.mockResolvedValue(null);
  sessionRepository.updateByUser.mockImplementation(async (userId, patch) => ({
    userId,
    ...patch,
  }));
  sessionRepository.deleteByUser.mockResolvedValue(undefined);
});

describe('TTL — ต้องเท่ากับ Flow Session อื่นในระบบ (5 นาที)', () => {
  test('GUIDED_BUY_SESSION_TTL_MINUTES = 5 และ cutoff ที่ส่งเข้า Repository อยู่ในอดีต 5 นาที', async () => {
    expect(guidedBuyFlow.GUIDED_BUY_SESSION_TTL_MINUTES).toBe(5);

    sessionRepository.findValidByUser.mockResolvedValue(null);
    const before = Date.now();
    await guidedBuyFlow.getCurrentSession(USER_ID);

    const [, cutoffIso] = sessionRepository.findValidByUser.mock.calls[0];
    const cutoffMs = new Date(cutoffIso).getTime();
    // cutoff = now - 5 นาที (เผื่อ Jitter การรันเทสต์ ±2 วินาที)
    expect(before - cutoffMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
    expect(before - cutoffMs).toBeLessThanOrEqual(5 * 60 * 1000 + 2000);
  });
});

describe('startFlow — เริ่ม Flow', () => {
  test('พอร์ตมีสินทรัพย์ → คืน Symbol ของผู้ใช้เอง + สร้าง Session ที่ขั้น AWAITING_SYMBOL', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      holdings: [{ symbol: 'BTC' }, { symbol: 'PTT' }],
    });

    const result = await guidedBuyFlow.startFlow(USER_ID);

    expect(result.symbols).toEqual(['BTC', 'PTT']);
    expect(sessionRepository.upsert).toHaveBeenCalledWith({
      userId: USER_ID,
      step: STEPS.AWAITING_SYMBOL,
      symbol: null,
    });
  });

  test('พอร์ตว่าง (ซื้อครั้งแรก) → เริ่มได้ตามปกติ ไม่ throw (ต่างจาก Flow ตั้งเตือน)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({ isEmpty: true, holdings: [] });

    const result = await guidedBuyFlow.startFlow(USER_ID);

    expect(result.symbols).toEqual([]);
    expect(sessionRepository.upsert).toHaveBeenCalled();
  });

  test('จำกัดปุ่ม Symbol ไม่เกิน 11 ตัว (เว้นที่ให้ "พิมพ์ชื่อเอง" + "ยกเลิก" ตามลิมิต 13 ของ LINE)', async () => {
    const holdings = Array.from({ length: 20 }, (_, i) => ({ symbol: `SYM${i}` }));
    portfolioService.getPortfolioSummary.mockResolvedValue({ isEmpty: false, holdings });

    const result = await guidedBuyFlow.startFlow(USER_ID);

    expect(result.symbols).toHaveLength(11);
  });
});

// ── Session Collision Guard (ข้อกำหนดหลักของรอบนี้) ──────────────────────────
describe('startFlow — Session ชนกันตอนเริ่ม (ห้ามเขียนทับเงียบๆ)', () => {
  test('มี Session ตั้งเตือนค้าง → throw GUIDED_BUY_SESSION_BUSY และ "ไม่แตะ" Session ใดเลย', async () => {
    reminderSetupFlow.getCurrentSession.mockResolvedValue({ userId: USER_ID, step: 'AWAITING_DAY' });

    await expect(guidedBuyFlow.startFlow(USER_ID)).rejects.toMatchObject({
      code: 'GUIDED_BUY_SESSION_BUSY',
      details: { kind: 'reminder_setup' },
    });

    expect(sessionRepository.upsert).not.toHaveBeenCalled();
    expect(reminderSetupFlow.cancelFlow).not.toHaveBeenCalled();
    expect(bulkImportSession.clearSession).not.toHaveBeenCalled();
  });

  test('มี Session นำเข้าพอร์ตค้าง → throw GUIDED_BUY_SESSION_BUSY (kind = bulk_import)', async () => {
    bulkImportSession.getCurrentSession.mockResolvedValue({ userId: USER_ID });

    await expect(guidedBuyFlow.startFlow(USER_ID)).rejects.toMatchObject({
      code: 'GUIDED_BUY_SESSION_BUSY',
      details: { kind: 'bulk_import' },
    });
    expect(sessionRepository.upsert).not.toHaveBeenCalled();
  });

  test('force: true (ผู้ใช้กดปุ่มยืนยันทิ้งของเดิม) → ล้าง Session อื่นทั้ง 2 ชนิดแล้วเริ่มได้', async () => {
    reminderSetupFlow.getCurrentSession.mockResolvedValue({ userId: USER_ID });
    bulkImportSession.getCurrentSession.mockResolvedValue({ userId: USER_ID });

    await guidedBuyFlow.startFlow(USER_ID, { force: true });

    expect(reminderSetupFlow.cancelFlow).toHaveBeenCalledWith(USER_ID);
    expect(bulkImportSession.clearSession).toHaveBeenCalledWith(USER_ID);
    expect(sessionRepository.upsert).toHaveBeenCalled();
  });
});

describe('handleSymbolSelected — ขั้น 1', () => {
  test('Session อยู่ขั้น AWAITING_SYMBOL → เก็บ Symbol (ตัวพิมพ์ใหญ่) แล้วเดินไป AWAITING_AMOUNT', async () => {
    sessionRepository.findValidByUser.mockResolvedValue({
      userId: USER_ID,
      step: STEPS.AWAITING_SYMBOL,
    });

    await guidedBuyFlow.handleSymbolSelected(USER_ID, 'btc');

    expect(sessionRepository.updateByUser).toHaveBeenCalledWith(USER_ID, {
      symbol: 'BTC',
      step: STEPS.AWAITING_AMOUNT,
    });
  });

  test('รองรับเลขไทย/ช่องว่างรอบข้างผ่าน normalizeText ตัวเดียวกับ Expert Path', async () => {
    sessionRepository.findValidByUser.mockResolvedValue({
      userId: USER_ID,
      step: STEPS.AWAITING_SYMBOL,
    });

    await guidedBuyFlow.handleSymbolSelected(USER_ID, '  k-select  ');

    expect(sessionRepository.updateByUser).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ symbol: 'K-SELECT' })
    );
  });

  test.each([
    ['ว่างเปล่า', '   '],
    ['ตัวเลขล้วน (ไม่ใช่ชื่อสินทรัพย์)', '1000'],
    ['หลายคำ (พิมพ์ทั้งประโยค)', 'ซื้อ บิตคอยน์ หน่อย'],
    ['ยาวเกินชื่อย่อจริง', 'A'.repeat(21)],
  ])('Symbol ไม่ถูกต้อง (%s) → GUIDED_BUY_INVALID_SYMBOL และ "ไม่เดินขั้น"', async (_label, input) => {
    sessionRepository.findValidByUser.mockResolvedValue({
      userId: USER_ID,
      step: STEPS.AWAITING_SYMBOL,
    });

    await expect(guidedBuyFlow.handleSymbolSelected(USER_ID, input)).rejects.toMatchObject({
      code: 'GUIDED_BUY_INVALID_SYMBOL',
    });
    // ยังอยู่ขั้นเดิม → ผู้ใช้พิมพ์ใหม่ได้ทันทีโดยไม่ต้องเริ่ม Flow ใหม่
    expect(sessionRepository.updateByUser).not.toHaveBeenCalled();
  });

  test('ไม่มี Session/หมดอายุ → GUIDED_BUY_SESSION_NOT_FOUND (คนละ Code กับ Flow ตั้งเตือน)', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);

    await expect(guidedBuyFlow.handleSymbolSelected(USER_ID, 'BTC')).rejects.toMatchObject({
      code: 'GUIDED_BUY_SESSION_NOT_FOUND',
    });
  });

  test('กดปุ่มเก่าซ้ำ (Session อยู่ขั้นจำนวนเงินแล้ว) → WRONG_STEP', async () => {
    sessionRepository.findValidByUser.mockResolvedValue({
      userId: USER_ID,
      step: STEPS.AWAITING_AMOUNT,
      symbol: 'BTC',
    });

    await expect(guidedBuyFlow.handleSymbolSelected(USER_ID, 'ETH')).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
  });
});

describe('handleAmountEntered — ขั้น 2 (ขั้นสุดท้าย)', () => {
  beforeEach(() => {
    sessionRepository.findValidByUser.mockResolvedValue({
      userId: USER_ID,
      step: STEPS.AWAITING_AMOUNT,
      symbol: 'BTC',
    });
  });

  test('จำนวนเงินถูกต้อง → คืน { symbol, amountThb } ให้ Controller Route ต่อ', async () => {
    const result = await guidedBuyFlow.handleAmountEntered(USER_ID, 1000);

    expect(result).toEqual({ symbol: 'BTC', amountThb: 1000 });
  });

  test('ไม่ใส่ Key currency เลย (รอบนี้ THB เท่านั้น — Shape ต้องตรงกับ Expert Path Path THB)', async () => {
    const result = await guidedBuyFlow.handleAmountEntered(USER_ID, 1000);

    expect(result).not.toHaveProperty('currency');
  });

  test('"ไม่ลบ Session" ที่ Service — Controller เป็นผู้ลบหลัง routeCommand สำเร็จ', async () => {
    await guidedBuyFlow.handleAmountEntered(USER_ID, 1000);

    expect(sessionRepository.deleteByUser).not.toHaveBeenCalled();
  });

  test.each([
    ['0', 0],
    ['ติดลบ', -500],
    ['NaN (พิมพ์ตัวหนังสือ)', NaN],
    ['Infinity', Infinity],
  ])('จำนวนเงินไม่ถูกต้อง (%s) → INVALID_AMOUNT และไม่ลบ Session', async (_label, amount) => {
    await expect(guidedBuyFlow.handleAmountEntered(USER_ID, amount)).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
    expect(sessionRepository.deleteByUser).not.toHaveBeenCalled();
  });
});

describe('cancelFlow / purgeStaleSessions', () => {
  test('cancelFlow → ลบ Session ของ User นั้น (Idempotent)', async () => {
    await guidedBuyFlow.cancelFlow(USER_ID);
    await guidedBuyFlow.cancelFlow(USER_ID);

    expect(sessionRepository.deleteByUser).toHaveBeenCalledTimes(2);
    expect(sessionRepository.deleteByUser).toHaveBeenCalledWith(USER_ID);
  });

  test('purgeStaleSessions → ส่ง cutoff = now - Retention (60 นาที) ให้ Repository', async () => {
    sessionRepository.purgeStaleBefore.mockResolvedValue(3);

    const before = Date.now();
    const count = await guidedBuyFlow.purgeStaleSessions();

    expect(count).toBe(3);
    const cutoffMs = new Date(sessionRepository.purgeStaleBefore.mock.calls[0][0]).getTime();
    expect(before - cutoffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 2000);
  });
});
