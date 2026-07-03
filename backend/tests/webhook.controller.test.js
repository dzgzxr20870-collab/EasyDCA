jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/pendingTransaction.service');
jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/profit.service');
jest.mock('../src/services/history.service');
jest.mock('../src/services/dcaReminder.service');
// Mock ฟังก์ชันของ Flow แต่คง STEPS จริงไว้ให้ Controller ใช้เทียบ Step
// (Pattern เดียวกับ commandParser ด้านล่าง — automock ไม่คงค่า Constant object)
jest.mock('../src/services/reminderSetupFlow.service', () => {
  const actual = jest.requireActual('../src/services/reminderSetupFlow.service');
  return {
    STEPS: actual.STEPS,
    getCurrentSession: jest.fn(),
    startFlow: jest.fn(),
    handleSymbolSelected: jest.fn(),
    handleFrequencySelected: jest.fn(),
    handleDaySelected: jest.fn(),
    handleAmountEntered: jest.fn(),
    cancelFlow: jest.fn(),
  };
});
jest.mock('../src/services/line.service');
jest.mock('../src/services/payment.service');
jest.mock('../src/services/entitlement.service');
// Override เฉพาะค่าที่ Postback Premium/Dashboard ใช้ (adminIds/liff.id/publicBaseUrl)
// ให้ Deterministic — คงค่าอื่นจาก config จริง (.env) ไว้
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    payment: { ...actual.payment, adminLineUserIds: ['Uadmin1', 'Uadmin2'] },
    liff: { ...actual.liff, id: '2010586158-DO9yzmaP' },
    app: {
      ...actual.app,
      publicBaseUrl: 'https://api.easydca.test',
      frontendUrl: 'https://app.easydca.test',
    },
  };
});

// Mock parseCommand แต่คง COMMANDS จริงไว้ให้ Controller ใช้เทียบ
jest.mock('../src/services/commandParser.service', () => {
  const actual = jest.requireActual('../src/services/commandParser.service');
  // คง COMMANDS + normalizeText จริงไว้ (Controller ใช้ normalizeText แปลงเลขไทย
  // ในการ Parse จำนวนเงิน/วันที่) Mock เฉพาะ parseCommand
  return { COMMANDS: actual.COMMANDS, normalizeText: actual.normalizeText, parseCommand: jest.fn() };
});

const userRepository = require('../src/repositories/user.repository');
const pendingService = require('../src/services/pendingTransaction.service');
const portfolioService = require('../src/services/portfolio.service');
const profitService = require('../src/services/profit.service');
const historyService = require('../src/services/history.service');
const reminderService = require('../src/services/dcaReminder.service');
const reminderSetupFlow = require('../src/services/reminderSetupFlow.service');
const lineService = require('../src/services/line.service');
const paymentService = require('../src/services/payment.service');
const entitlement = require('../src/services/entitlement.service');
const commandParser = require('../src/services/commandParser.service');
const { handleEvent } = require('../src/controllers/webhook.controller');

const { COMMANDS } = commandParser;
const FREE_USER = { id: 'user-1', lineUserId: 'U123', plan: 'free' };

function textEvent(text) {
  return {
    type: 'message',
    replyToken: 'reply-token-1',
    source: { userId: 'U123' },
    message: { type: 'text', text },
  };
}

function postbackEvent(data) {
  return {
    type: 'postback',
    replyToken: 'reply-token-1',
    source: { userId: 'U123' },
    postback: { data },
  };
}

// ดึง payload ที่ถูกส่งเข้า replyMessage มาเป็น String เพื่อตรวจเนื้อหา
function lastReplyText() {
  const call = lineService.replyMessage.mock.calls.at(-1);
  return JSON.stringify(call[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findByLineUserId.mockResolvedValue(FREE_USER);
  lineService.replyMessage.mockResolvedValue(undefined);
  // Default: จำลอง LINE Profile API ล้มเหลว — Test ที่ต้องการ Profile จริง
  // จะ Override ค่านี้เอง
  lineService.getProfile.mockResolvedValue(null);
  // Default: ไม่มี Setup Session ค้าง — Test ของ Flow ตั้งเตือนจะ Override เอง
  reminderSetupFlow.getCurrentSession.mockResolvedValue(null);
});

describe('handleEvent — BUY/SELL สร้าง Preview รอ Confirm', () => {
  test('ซื้อ → สร้าง Pending แล้ว reply ด้วย Preview พร้อมปุ่ม Postback (ยังไม่บันทึกจริง)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'pending-1',
      commandType: 'buy',
      assetSymbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
      amountThb: 1700,
    });

    await handleEvent(textEvent('ซื้อ PTT 50 หุ้น ราคา 34'));

    // ส่ง plan + parsed (ที่เติม type จาก Symbol Registry: PTT = stock_th) เข้า service
    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      { command: COMMANDS.BUY, params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34, type: 'stock_th' } },
      { plan: 'free' }
    );
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('ยืนยันการซื้อ'); // หัวข้อ Preview (ไม่ใช่ "บันทึกแล้ว")
    expect(reply).toContain('PTT');
    expect(reply).toContain('1,700');
    // ปุ่ม Postback พก pendingId เฉพาะเจาะจง
    expect(reply).toContain('action=confirm&pendingId=pending-1');
    expect(reply).toContain('action=cancel&pendingId=pending-1');
    // priceSource ไม่ได้ส่งมา (ราคาที่ User ระบุเอง) → ไม่มีข้อความเตือนเรื่อง CoinGecko
    expect(reply).not.toContain('CoinGecko');
  });

  test('ซื้อด้วยจำนวนเงิน (priceSource=coingecko) → Preview แจ้งที่มาของราคาจาก CoinGecko', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', amountThb: 1000 },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'pending-4',
      commandType: 'buy',
      assetSymbol: 'BTC',
      quantity: 0.0005,
      pricePerUnit: 2000000,
      amountThb: 1000,
      priceSource: 'coingecko',
    });

    await handleEvent(textEvent('ซื้อ BTC 1000 บาท'));

    const reply = lastReplyText();
    expect(reply).toContain('CoinGecko');
  });

  test('ขาย → สร้าง Pending แล้ว reply ด้วย Preview (SELL ไม่เติม type)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SELL,
      params: { symbol: 'PTT', quantity: 10, pricePerUnit: 40 },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'pending-2',
      commandType: 'sell',
      assetSymbol: 'PTT',
      quantity: 10,
      pricePerUnit: 40,
      amountThb: 400,
    });

    await handleEvent(textEvent('ขาย PTT 10 หุ้น ราคา 40'));

    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      { command: COMMANDS.SELL, params: { symbol: 'PTT', quantity: 10, pricePerUnit: 40 } },
      { plan: 'free' }
    );
    const reply = lastReplyText();
    expect(reply).toContain('ยืนยันการขาย');
    expect(reply).toContain('action=confirm&pendingId=pending-2');
  });

  test('ซื้อ Symbol ที่มี type มาแล้ว → ไม่เขียนทับ type เดิม', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'fund' },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'pending-3',
      commandType: 'buy',
      assetSymbol: 'BTC',
      quantity: 0.01,
      pricePerUnit: 3400000,
      amountThb: 34000,
    });

    await handleEvent(textEvent('ซื้อ BTC 0.01 หุ้น ราคา 3400000'));

    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      { command: COMMANDS.BUY, params: { symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'fund' } },
      { plan: 'free' }
    );
  });

  test('ซื้อ Symbol ที่ไม่รู้จัก → createPending throw VALIDATION_ERROR, ได้ข้อความแนะนำที่ชัดเจน (ไม่มี Pending ค้าง)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'UNKNOWNCOIN', quantity: 1, pricePerUnit: 10 },
    });
    const err = new Error('Creating a new asset requires an asset type');
    err.code = 'VALIDATION_ERROR';
    pendingService.createPending.mockRejectedValue(err);

    await handleEvent(textEvent('ซื้อ UNKNOWNCOIN 1 หุ้น ราคา 10'));

    // Controller ไม่เดา type — ส่งต่อ params เดิมโดยไม่มี type
    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      { command: COMMANDS.BUY, params: { symbol: 'UNKNOWNCOIN', quantity: 1, pricePerUnit: 10 } },
      { plan: 'free' }
    );
    const reply = lastReplyText();
    expect(reply).toContain('ไม่รู้จักสินทรัพย์นี้');
    expect(reply).toContain('ติดต่อทีมงาน');
    expect(reply).not.toContain('VALIDATION_ERROR');
  });
});

describe('handleEvent — Postback (Confirm/Cancel/Edit)', () => {
  test('กดยืนยัน BUY → confirmPending แล้ว reply ด้วย Confirm Message สำเร็จ', async () => {
    pendingService.confirmPending.mockResolvedValue({
      commandType: 'buy',
      result: { symbol: 'PTT', quantity: 50, pricePerUnit: 34, amountThb: 1700, newAssetCreated: false },
    });

    await handleEvent(postbackEvent('action=confirm&pendingId=pending-1'));

    expect(pendingService.confirmPending).toHaveBeenCalledWith('pending-1', { plan: 'free' });
    const reply = lastReplyText();
    expect(reply).toContain('ยืนยันรายการซื้อ'); // Success Message
    expect(reply).toContain('1,700');
    // ไม่มี priceSource ใน result (Backward Compatible กับ Caller เดิม) → ไม่แสดงคำเตือน
    expect(reply).not.toContain('CoinGecko');
  });

  test('กดยืนยัน BUY ด้วยราคาจาก Price Feed (priceSource=coingecko) → Confirm Message แจ้งที่มาของราคา', async () => {
    pendingService.confirmPending.mockResolvedValue({
      commandType: 'buy',
      result: {
        symbol: 'BTC',
        quantity: 0.0005,
        pricePerUnit: 2000000,
        amountThb: 1000,
        newAssetCreated: false,
        priceSource: 'coingecko',
      },
    });

    await handleEvent(postbackEvent('action=confirm&pendingId=pending-4'));

    const reply = lastReplyText();
    expect(reply).toContain('CoinGecko');
  });

  test('กดยืนยัน SELL → reply ด้วย Sell Confirm Message', async () => {
    pendingService.confirmPending.mockResolvedValue({
      commandType: 'sell',
      result: { symbol: 'PTT', quantity: 10, pricePerUnit: 40, amountThb: 400, remainingQuantity: 30 },
    });

    await handleEvent(postbackEvent('action=confirm&pendingId=pending-2'));

    const reply = lastReplyText();
    expect(reply).toContain('ยืนยันรายการขาย');
    expect(reply).toContain('คงเหลือ');
  });

  test('กดยกเลิก → cancelPending แล้ว reply ว่ายกเลิกแล้ว', async () => {
    pendingService.cancelPending.mockResolvedValue({ id: 'pending-1', status: 'cancelled' });

    await handleEvent(postbackEvent('action=cancel&pendingId=pending-1'));

    expect(pendingService.cancelPending).toHaveBeenCalledWith('pending-1');
    const reply = lastReplyText();
    expect(reply).toContain('ยกเลิกรายการแล้ว');
  });

  test('กดแก้ไข → ยกเลิกแบบ Best-effort แล้วแนะนำให้พิมพ์ใหม่', async () => {
    pendingService.cancelPending.mockResolvedValue({ id: 'pending-1', status: 'cancelled' });

    await handleEvent(postbackEvent('action=edit&pendingId=pending-1'));

    expect(pendingService.cancelPending).toHaveBeenCalledWith('pending-1');
    const reply = lastReplyText();
    expect(reply).toContain('แก้ไขรายการ');
  });

  test('กดแก้ไขแต่ยกเลิกไม่ได้ (resolve ไปแล้ว) → ยังตอบ Edit Hint ได้ ไม่ Error', async () => {
    const err = new Error('already');
    err.code = 'PENDING_ALREADY_RESOLVED';
    pendingService.cancelPending.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=edit&pendingId=pending-1'));

    const reply = lastReplyText();
    expect(reply).toContain('แก้ไขรายการ');
    expect(reply).not.toContain('ดำเนินการไปแล้ว'); // ไม่หลุด Error ของ cancel
  });

  test('ยืนยันรายการที่หมดอายุ → PENDING_EXPIRED แปลเป็นข้อความไทย', async () => {
    const err = new Error('expired');
    err.code = 'PENDING_EXPIRED';
    pendingService.confirmPending.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=confirm&pendingId=pending-old'));

    const reply = lastReplyText();
    expect(reply).toContain('หมดเวลายืนยัน');
    expect(reply).not.toContain('PENDING_EXPIRED');
  });

  test('กดยืนยันซ้ำ (resolve แล้ว) → PENDING_ALREADY_RESOLVED แปลเป็นข้อความไทย', async () => {
    const err = new Error('already');
    err.code = 'PENDING_ALREADY_RESOLVED';
    pendingService.confirmPending.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=confirm&pendingId=pending-1'));

    const reply = lastReplyText();
    expect(reply).toContain('ดำเนินการไปแล้ว');
  });
});

describe('handleEvent — PORTFOLIO', () => {
  test('พอต → เรียก portfolioService จริงและ reply ด้วยสรุปพอร์ต (ไม่ใช่ "กำลังพัฒนา")', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      holdings: [
        { symbol: 'PTT', name: 'PTT', type: 'stock_th', heldQuantity: 40, totalInvested: 1300, averageCost: 32.5 },
      ],
      totalInvested: 1300,
    });

    await handleEvent(textEvent('พอต'));

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(FREE_USER.id);
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('พอร์ตของคุณ');
    expect(reply).toContain('PTT');
    expect(reply).toContain('1,300');
    expect(reply).not.toContain('กำลังพัฒนา');
  });

  test('พอตว่างเปล่า → reply ด้วยข้อความแนะนำให้เริ่มบันทึกรายการแรก', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: true,
      holdings: [],
      totalInvested: 0,
    });

    await handleEvent(textEvent('พอต'));

    const reply = lastReplyText();
    expect(reply).toContain('ยังว่างอยู่');
    expect(reply).not.toContain('กำลังพัฒนา');
  });
});

describe('handleEvent — HISTORY', () => {
  test('ประวัติ → เรียก historyService จริงและ reply ด้วยรายการล่าสุด (ไม่ใช่ "กำลังพัฒนา")', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.HISTORY, params: {} });
    historyService.getRecentHistory.mockResolvedValue([
      { symbol: 'PTT', type: 'sell', quantity: 10, pricePerUnit: 40, amountThb: 400, date: '2026-07-03' },
      { symbol: 'PTT', type: 'buy', quantity: 50, pricePerUnit: 34, amountThb: 1700, date: '2026-07-01' },
    ]);

    await handleEvent(textEvent('ประวัติ'));

    expect(historyService.getRecentHistory).toHaveBeenCalledWith(FREE_USER.id);
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('ประวัติล่าสุด');
    expect(reply).toContain('PTT');
    expect(reply).toContain('400');
    expect(reply).toContain('1,700');
    expect(reply).not.toContain('กำลังพัฒนา');
  });

  test('ไม่มีประวัติเลย → reply ด้วยข้อความแนะนำให้เริ่มบันทึกรายการแรก', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.HISTORY, params: {} });
    historyService.getRecentHistory.mockResolvedValue([]);

    await handleEvent(textEvent('ประวัติ'));

    const reply = lastReplyText();
    expect(reply).toContain('ยังไม่มีประวัติ');
    expect(reply).not.toContain('กำลังพัฒนา');
  });
});

describe('handleEvent — PROFIT', () => {
  test('กำไร BTC → เรียก profitService จริงและ reply ด้วยผลกำไร (ไม่ใช่ "กำลังพัฒนา")', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.PROFIT,
      params: { symbol: 'BTC' },
    });
    profitService.getAssetProfit.mockResolvedValue({
      symbol: 'BTC',
      heldQuantity: 0.01,
      averageCost: 3000000,
      totalInvested: 30000,
      currentPrice: 4000000,
      currentValue: 40000,
      profitLoss: 10000,
      profitLossPercent: 33.33,
      priceSource: 'coingecko',
    });

    await handleEvent(textEvent('กำไร BTC'));

    expect(profitService.getAssetProfit).toHaveBeenCalledWith(FREE_USER.id, 'BTC');
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('BTC');
    expect(reply).toContain('กำไร');
    expect(reply).toContain('40,000'); // มูลค่าปัจจุบัน
    // priceSource=coingecko → แสดงคำเตือนราคาอ้างอิง
    expect(reply).toContain('CoinGecko');
    expect(reply).not.toContain('กำลังพัฒนา');
  });

  test('ขาดทุน → reply ด้วยสีขาดทุน (หัวข้อ 📉 ขาดทุน)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.PROFIT,
      params: { symbol: 'BTC' },
    });
    profitService.getAssetProfit.mockResolvedValue({
      symbol: 'BTC',
      heldQuantity: 0.01,
      averageCost: 3000000,
      totalInvested: 30000,
      currentPrice: 2000000,
      currentValue: 20000,
      profitLoss: -10000,
      profitLossPercent: -33.33,
      priceSource: 'coingecko',
    });

    await handleEvent(textEvent('กำไร BTC'));

    const reply = lastReplyText();
    expect(reply).toContain('ขาดทุน');
  });

  test('ไม่มี Holding → NO_HOLDING_TO_CALCULATE_PROFIT แปลเป็นข้อความไทย (ไม่โชว์ Code ดิบ)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.PROFIT,
      params: { symbol: 'BTC' },
    });
    const err = new Error('No current holding for BTC to calculate profit');
    err.code = 'NO_HOLDING_TO_CALCULATE_PROFIT';
    profitService.getAssetProfit.mockRejectedValue(err);

    await handleEvent(textEvent('กำไร BTC'));

    const reply = lastReplyText();
    expect(reply).toContain('ไม่มีการถือครองสินทรัพย์นี้');
    expect(reply).toContain('พอต');
    expect(reply).not.toContain('NO_HOLDING_TO_CALCULATE_PROFIT');
  });

  test('หุ้นไทยที่ยังไม่มี Price Feed → PRICE_FEED_NOT_IMPLEMENTED แปลเป็นข้อความไทย', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.PROFIT,
      params: { symbol: 'PTT' },
    });
    const err = new Error('No live price feed available for PTT');
    err.code = 'PRICE_FEED_NOT_IMPLEMENTED';
    profitService.getAssetProfit.mockRejectedValue(err);

    await handleEvent(textEvent('กำไร PTT'));

    const reply = lastReplyText();
    expect(reply).toContain('เฉพาะบางสินทรัพย์');
    expect(reply).not.toContain('PRICE_FEED_NOT_IMPLEMENTED');
  });
});

describe('handleEvent — DCA Reminder', () => {
  test('ตั้งเตือน weekly → เรียก createReminder แล้ว reply ยืนยันตั้งเตือน', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SET_REMINDER,
      params: { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 1, amountThb: 1000 },
    });
    reminderService.createReminder.mockResolvedValue({
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      amountThb: 1000,
    });

    await handleEvent(textEvent('ตั้งเตือน BTC ทุกวันจันทร์ 1000'));

    expect(reminderService.createReminder).toHaveBeenCalledWith(FREE_USER.id, {
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      amountThb: 1000,
    });
    const reply = lastReplyText();
    expect(reply).toContain('ตั้งเตือน DCA แล้ว');
    expect(reply).toContain('ทุกวันจันทร์');
    expect(reply).toContain('1,000');
  });

  test('ดูเตือน → เรียก listReminders แล้ว reply ด้วยรายการ', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.LIST_REMINDERS, params: {} });
    reminderService.listReminders.mockResolvedValue([
      { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 3, amountThb: 1000 },
    ]);

    await handleEvent(textEvent('ดูเตือน'));

    expect(reminderService.listReminders).toHaveBeenCalledWith(FREE_USER.id);
    const reply = lastReplyText();
    expect(reply).toContain('BTC');
    expect(reply).toContain('ทุกวันพุธ');
  });

  test('ดูเตือน แต่ยังไม่มี → reply แนะนำให้เริ่มตั้ง', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.LIST_REMINDERS, params: {} });
    reminderService.listReminders.mockResolvedValue([]);

    await handleEvent(textEvent('ดูเตือน'));

    expect(lastReplyText()).toContain('ยังไม่มีการตั้งเตือน');
  });

  test('ลบเตือน BTC → เรียก deleteReminder แล้ว reply ยืนยันปิด', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.DELETE_REMINDER,
      params: { symbol: 'BTC' },
    });
    reminderService.deleteReminder.mockResolvedValue({ symbol: 'BTC', deactivated: 1 });

    await handleEvent(textEvent('ลบเตือน BTC'));

    expect(reminderService.deleteReminder).toHaveBeenCalledWith(FREE_USER.id, 'BTC');
    expect(lastReplyText()).toContain('ปิดการเตือน');
  });

  test('ลบเตือนที่ไม่มีอยู่ → REMINDER_NOT_FOUND แปลเป็นข้อความไทย (ไม่โชว์ Code ดิบ)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.DELETE_REMINDER,
      params: { symbol: 'DOGE' },
    });
    const err = new Error('No active reminder found for DOGE');
    err.code = 'REMINDER_NOT_FOUND';
    reminderService.deleteReminder.mockRejectedValue(err);

    await handleEvent(textEvent('ลบเตือน DOGE'));

    const reply = lastReplyText();
    expect(reply).toContain('ไม่พบการตั้งเตือน');
    expect(reply).not.toContain('REMINDER_NOT_FOUND');
  });

  test('ตั้งเตือนรูปแบบผิด (service throw INVALID_REMINDER) → แปลเป็นข้อความไทยแนะนำรูปแบบ', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SET_REMINDER,
      params: { symbol: 'BTC', frequency: 'monthly', dayOfMonth: 45, amountThb: 1000 },
    });
    const err = new Error('dayOfMonth must be an integer 1-31 for monthly');
    err.code = 'INVALID_REMINDER';
    reminderService.createReminder.mockRejectedValue(err);

    await handleEvent(textEvent('ตั้งเตือน BTC ทุกวันที่ 45 1000'));

    const reply = lastReplyText();
    expect(reply).toContain('ตรวจสอบรูปแบบ');
    expect(reply).not.toContain('INVALID_REMINDER');
  });
});

describe('handleEvent — DCA Reminder Setup Flow (Quick Reply)', () => {
  test('Postback start_reminder_setup → startFlow แล้วส่ง Quick Reply เลือก Symbol', async () => {
    reminderSetupFlow.startFlow.mockResolvedValue({ symbols: ['BTC', 'ETH'] });

    await handleEvent(postbackEvent('action=start_reminder_setup'));

    expect(reminderSetupFlow.startFlow).toHaveBeenCalledWith(FREE_USER.id);
    const reply = lastReplyText();
    expect(reply).toContain('action=reminder_symbol&symbol=BTC');
    expect(reply).toContain('action=reminder_symbol&symbol=ETH');
    // ทุกข้อความแนบปุ่มยกเลิก
    expect(reply).toContain('action=cancel_reminder_setup');
  });

  test('พอร์ตว่าง → PORTFOLIO_EMPTY_FOR_REMINDER แปลเป็นข้อความไทย (ไม่โชว์ Code)', async () => {
    const err = new Error('empty portfolio');
    err.code = 'PORTFOLIO_EMPTY_FOR_REMINDER';
    reminderSetupFlow.startFlow.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=start_reminder_setup'));

    const reply = lastReplyText();
    expect(reply).toContain('ยังไม่มีสินทรัพย์ในพอร์ต');
    expect(reply).not.toContain('PORTFOLIO_EMPTY_FOR_REMINDER');
  });

  test('Postback เลือก Symbol → handleSymbolSelected แล้วถามความถี่', async () => {
    reminderSetupFlow.handleSymbolSelected.mockResolvedValue({ symbol: 'BTC' });

    await handleEvent(postbackEvent('action=reminder_symbol&symbol=BTC'));

    expect(reminderSetupFlow.handleSymbolSelected).toHaveBeenCalledWith(FREE_USER.id, 'BTC');
    const reply = lastReplyText();
    expect(reply).toContain('action=reminder_freq&frequency=weekly');
    expect(reply).toContain('action=reminder_freq&frequency=monthly');
  });

  test('Postback เลือกความถี่ weekly → ถามวันในสัปดาห์ (7 วัน)', async () => {
    reminderSetupFlow.handleFrequencySelected.mockResolvedValue({ frequency: 'weekly' });

    await handleEvent(postbackEvent('action=reminder_freq&frequency=weekly'));

    expect(reminderSetupFlow.handleFrequencySelected).toHaveBeenCalledWith(FREE_USER.id, 'weekly');
    const reply = lastReplyText();
    expect(reply).toContain('action=reminder_day&dayOfWeek=0');
    expect(reply).toContain('action=reminder_day&dayOfWeek=6');
  });

  test('Postback เลือกความถี่ monthly → ถามวันของเดือน', async () => {
    reminderSetupFlow.handleFrequencySelected.mockResolvedValue({ frequency: 'monthly' });

    await handleEvent(postbackEvent('action=reminder_freq&frequency=monthly'));

    const reply = lastReplyText();
    expect(reply).toContain('action=reminder_day&dayOfMonth=1');
    expect(reply).toContain('พิมพ์ตัวเลข');
  });

  test('Postback เลือกวัน → handleDaySelected แล้วขอจำนวนเงิน', async () => {
    reminderSetupFlow.handleDaySelected.mockResolvedValue({ symbol: 'BTC' });

    await handleEvent(postbackEvent('action=reminder_day&dayOfWeek=1'));

    expect(reminderSetupFlow.handleDaySelected).toHaveBeenCalledWith(FREE_USER.id, 1);
    const reply = lastReplyText();
    expect(reply).toContain('BTC');
    expect(reply).toContain('กี่บาท');
  });

  test('Postback ยกเลิก → cancelFlow แล้ว reply ยืนยันยกเลิก', async () => {
    reminderSetupFlow.cancelFlow.mockResolvedValue(undefined);

    await handleEvent(postbackEvent('action=cancel_reminder_setup'));

    expect(reminderSetupFlow.cancelFlow).toHaveBeenCalledWith(FREE_USER.id);
    expect(lastReplyText()).toContain('ยกเลิกการตั้งเตือนแล้ว');
  });

  test('Text จำนวนเงินตอน AWAITING_AMOUNT → handleAmountEntered แล้วยืนยันตั้งเตือนสำเร็จ', async () => {
    reminderSetupFlow.getCurrentSession.mockResolvedValue({
      step: 'AWAITING_AMOUNT',
      symbol: 'BTC',
      frequency: 'weekly',
    });
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    reminderSetupFlow.handleAmountEntered.mockResolvedValue({
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      amountThb: 1000,
    });

    await handleEvent(textEvent('1000'));

    expect(reminderSetupFlow.handleAmountEntered).toHaveBeenCalledWith(FREE_USER.id, 1000);
    expect(lastReplyText()).toContain('ตั้งเตือน DCA แล้ว');
  });

  test('พิมพ์ "พอต" แทรกกลาง Flow (AWAITING_AMOUNT) → คำสั่งปกติทำงาน ไม่ถูก Flow ดักจับ', async () => {
    reminderSetupFlow.getCurrentSession.mockResolvedValue({
      step: 'AWAITING_AMOUNT',
      symbol: 'BTC',
      frequency: 'weekly',
    });
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      holdings: [{ symbol: 'BTC', name: 'BTC', type: 'crypto', heldQuantity: 0.01, totalInvested: 1000, averageCost: 100000 }],
      totalInvested: 1000,
    });

    await handleEvent(textEvent('พอต'));

    // คำสั่ง PORTFOLIO ทำงานปกติ, ไม่เรียก handleAmountEntered (ไม่ auto-cancel Session)
    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(FREE_USER.id);
    expect(reminderSetupFlow.handleAmountEntered).not.toHaveBeenCalled();
    expect(reminderSetupFlow.cancelFlow).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('พอร์ตของคุณ');
  });

  test('จำนวนเงินไม่ถูกต้อง (พิมพ์ตัวอักษร) → INVALID_AMOUNT, Session คงอยู่ (service จัดการ)', async () => {
    reminderSetupFlow.getCurrentSession.mockResolvedValue({
      step: 'AWAITING_AMOUNT',
      symbol: 'BTC',
      frequency: 'weekly',
    });
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    const err = new Error('invalid');
    err.code = 'INVALID_AMOUNT';
    reminderSetupFlow.handleAmountEntered.mockRejectedValue(err);

    await handleEvent(textEvent('ห้าร้อย'));

    // ไม่มีตัวเลข → NaN ส่งเข้า service ซึ่งโยน INVALID_AMOUNT
    expect(reminderSetupFlow.handleAmountEntered).toHaveBeenCalledWith(FREE_USER.id, NaN);
    const reply = lastReplyText();
    expect(reply).toContain('จำนวนเงินไม่ถูกต้อง');
    expect(reply).not.toContain('INVALID_AMOUNT');
  });

  test('Text ตัวเลขตอน AWAITING_DAY (monthly) → พิมพ์วันที่เอง → handleDaySelected', async () => {
    reminderSetupFlow.getCurrentSession.mockResolvedValue({
      step: 'AWAITING_DAY',
      symbol: 'AAPL',
      frequency: 'monthly',
    });
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    reminderSetupFlow.handleDaySelected.mockResolvedValue({ symbol: 'AAPL' });

    await handleEvent(textEvent('15'));

    expect(reminderSetupFlow.handleDaySelected).toHaveBeenCalledWith(FREE_USER.id, 15);
    expect(lastReplyText()).toContain('AAPL');
  });

  test('กดปุ่มหลัง Session หมดอายุ → SETUP_SESSION_NOT_FOUND แปลเป็นข้อความไทย', async () => {
    const err = new Error('expired');
    err.code = 'SETUP_SESSION_NOT_FOUND';
    reminderSetupFlow.handleSymbolSelected.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=reminder_symbol&symbol=BTC'));

    const reply = lastReplyText();
    expect(reply).toContain('ไม่พบขั้นตอนการตั้งเตือน');
    expect(reply).not.toContain('SETUP_SESSION_NOT_FOUND');
  });
});

describe('handleEvent — Premium Menu (Postback 3 เคส)', () => {
  test('เคส 1: ยังไม่ Premium + ไม่มีคำขอค้าง → เสนอแพ็กเกจรายเดือน/รายปี', async () => {
    paymentService.findPendingByUserId.mockResolvedValue(null);
    entitlement.isPremiumActive.mockReturnValue(false);

    await handleEvent(postbackEvent('action=premium_menu'));

    const reply = lastReplyText();
    expect(reply).toContain('action=request_payment&period=monthly');
    expect(reply).toContain('action=request_payment&period=yearly');
    expect(paymentService.requestPayment).not.toHaveBeenCalled();
  });

  test('เคส 2: Premium Active → แสดงสถานะ + วันหมดอายุ (ไทย/พ.ศ.) + ปุ่มต่ออายุ', async () => {
    userRepository.findByLineUserId.mockResolvedValue({
      ...FREE_USER,
      plan: 'premium',
      planExpiresAt: '2027-01-15T00:00:00.000Z',
    });
    paymentService.findPendingByUserId.mockResolvedValue(null);
    entitlement.isPremiumActive.mockReturnValue(true);

    await handleEvent(postbackEvent('action=premium_menu'));

    const reply = lastReplyText();
    expect(reply).toContain('Premium อยู่แล้ว');
    expect(reply).toContain('15 มกราคม 2570'); // แปลงเป็น พ.ศ. ผ่าน thaiDate.util
    // ต่ออายุใช้ Postback เดียวกับเคส 1
    expect(reply).toContain('action=request_payment&period=monthly');
  });

  test('เคส 3: มีคำขอ pending ค้าง → ส่ง QR เดิมซ้ำ (ไม่สร้างใหม่ซ้อน)', async () => {
    paymentService.findPendingByUserId.mockResolvedValue({
      id: 'pay-9',
      amountThb: 59.17,
      billingPeriod: 'monthly',
      expiresAt: '2026-07-05T00:00:00.000Z',
      status: 'pending',
    });

    await handleEvent(postbackEvent('action=premium_menu'));

    const reply = lastReplyText();
    // Image ชี้ไป Endpoint qr.png ของคำขอเดิม + ปุ่มแจ้งชำระของ paymentId เดิม
    expect(reply).toContain('/api/v1/payment/pay-9/qr.png');
    expect(reply).toContain('action=notify_payment&paymentId=pay-9');
    expect(paymentService.requestPayment).not.toHaveBeenCalled();
  });
});

describe('handleEvent — Payment Postback (request/notify)', () => {
  test('request_payment: สร้างคำขอ + ส่ง QR (Image URL เต็ม, ยอด 2 ตำแหน่ง, ปุ่มแจ้งชำระ)', async () => {
    paymentService.requestPayment.mockResolvedValue({
      paymentId: 'pay-5',
      amountThb: 590.05,
      qrPayload: '000201...',
      expiresAt: new Date('2026-07-05T00:00:00.000Z'),
    });

    await handleEvent(postbackEvent('action=request_payment&period=yearly'));

    expect(paymentService.requestPayment).toHaveBeenCalledWith(FREE_USER.id, 'yearly');
    const reply = lastReplyText();
    expect(reply).toContain('https://api.easydca.test/api/v1/payment/pay-5/qr.png');
    expect(reply).toContain('590.05');
    expect(reply).toContain('action=notify_payment&paymentId=pay-5');
  });

  test('notify_payment: แจ้งชำระ → Push แจ้ง Admin ทุกคน + reply ยืนยันรอตรวจสอบ', async () => {
    paymentService.notifyPaymentSubmitted.mockResolvedValue({
      id: 'pay-1',
      userId: FREE_USER.id,
      amountThb: 59.17,
      billingPeriod: 'monthly',
    });
    lineService.pushMessage.mockResolvedValue(undefined);

    await handleEvent(postbackEvent('action=notify_payment&paymentId=pay-1'));

    expect(paymentService.notifyPaymentSubmitted).toHaveBeenCalledWith('pay-1', FREE_USER.id);
    // Push แจ้ง Admin ครบ 2 คน (จาก config mock) พร้อมปุ่มอนุมัติ/ปฏิเสธ
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin1', expect.any(Object));
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin2', expect.any(Object));
    const adminMsg = JSON.stringify(lineService.pushMessage.mock.calls[0][1]);
    expect(adminMsg).toContain('action=approve_payment&paymentId=pay-1');
    expect(adminMsg).toContain('action=reject_payment&paymentId=pay-1');
    // ผู้ใช้ได้รับข้อความยืนยันรอตรวจสอบ
    expect(lastReplyText()).toContain('รอ Admin ตรวจสอบ');
  });

  test('notify_payment: Push Admin 1 คนล้มเหลว → ยังตอบผู้ใช้สำเร็จ (Best-effort)', async () => {
    paymentService.notifyPaymentSubmitted.mockResolvedValue({
      id: 'pay-1',
      userId: FREE_USER.id,
      amountThb: 59.17,
      billingPeriod: 'monthly',
    });
    lineService.pushMessage
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce(undefined);

    await handleEvent(postbackEvent('action=notify_payment&paymentId=pay-1'));

    expect(lastReplyText()).toContain('รอ Admin ตรวจสอบ');
  });

  test('notify_payment: คำขอถูกดำเนินการไปแล้ว → PAYMENT_NOT_PENDING แปลไทย, ไม่ Push Admin', async () => {
    const err = new Error('not pending');
    err.code = 'PAYMENT_NOT_PENDING';
    paymentService.notifyPaymentSubmitted.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=notify_payment&paymentId=pay-1'));

    const reply = lastReplyText();
    expect(reply).toContain('ถูกดำเนินการไปแล้ว');
    expect(reply).not.toContain('PAYMENT_NOT_PENDING');
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });
});

describe('handleEvent — Dashboard Postback', () => {
  test('open_dashboard: ส่งลิงก์เปิด LIFF Dashboard (uri ประกอบจาก config.liff.id)', async () => {
    await handleEvent(postbackEvent('action=open_dashboard'));

    const reply = lastReplyText();
    expect(reply).toContain('https://liff.line.me/2010586158-DO9yzmaP');
  });
});

describe('handleEvent — UNKNOWN', () => {
  test('คำสั่งไม่รู้จัก → replyMessage ด้วย Unknown Message พร้อมตัวอย่าง', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('อะไรสักอย่าง'));

    expect(pendingService.createPending).not.toHaveBeenCalled();
    const reply = lastReplyText();
    expect(reply).toContain('ไม่เข้าใจคำสั่ง');
    expect(reply).toContain('ซื้อ BTC 0.01 หุ้น ราคา 3400000');
  });
});

describe('handleEvent — Error Translation', () => {
  test('ASSET_LIMIT_REACHED (จาก createPending) → แปลเป็นข้อความไทย ไม่โชว์ Error Code ดิบ', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
    });
    const err = new Error('Free plan is limited to 2 active assets');
    err.code = 'ASSET_LIMIT_REACHED';
    pendingService.createPending.mockRejectedValue(err);

    await handleEvent(textEvent('ซื้อ ETH 1 หุ้น ราคา 1000'));

    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('แพ็กเกจ Free');
    expect(reply).toContain('Premium');
    // ต้องไม่มี Error Code ดิบ หรือข้อความ English จาก Error หลุดไปถึงผู้ใช้
    expect(reply).not.toContain('ASSET_LIMIT_REACHED');
    expect(reply).not.toContain('Free plan is limited');
  });

  test('Error ที่ไม่มี code → INTERNAL_ERROR ข้อความไทยทั่วไป', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SELL,
      params: { symbol: 'PTT', quantity: 5, pricePerUnit: 34 },
    });
    pendingService.createPending.mockRejectedValue(new Error('db exploded'));

    await handleEvent(textEvent('ขาย PTT 5 หุ้น ราคา 34'));

    const reply = lastReplyText();
    expect(reply).toContain('เกิดข้อผิดพลาด');
    expect(reply).not.toContain('db exploded');
  });
});

describe('handleEvent — User Auto-register', () => {
  test('User ใหม่ + LINE Profile API ล้มเหลว (getProfile คืน null) → Fallback เป็นชื่อ Default (ไม่ใช่ null เพราะ display_name เป็น NOT NULL)', async () => {
    userRepository.findByLineUserId.mockResolvedValue(null);
    userRepository.create.mockResolvedValue(FREE_USER);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    // beforeEach ตั้ง getProfile ให้คืน null (จำลอง API ล้มเหลว) อยู่แล้ว

    await handleEvent(textEvent('สวัสดี'));

    expect(lineService.getProfile).toHaveBeenCalledWith('U123');
    expect(userRepository.create).toHaveBeenCalledWith('U123', 'LINE User', null);
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
  });

  test('User ใหม่ + LINE Profile API สำเร็จ → ใช้ displayName/pictureUrl จริงจาก LINE Profile', async () => {
    userRepository.findByLineUserId.mockResolvedValue(null);
    userRepository.create.mockResolvedValue(FREE_USER);
    lineService.getProfile.mockResolvedValue({
      displayName: 'สมชาย ใจดี',
      pictureUrl: 'https://profile.line-scdn.net/abc123',
    });
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(userRepository.create).toHaveBeenCalledWith(
      'U123',
      'สมชาย ใจดี',
      'https://profile.line-scdn.net/abc123'
    );
  });

  test('User เดิม → ไม่เรียก create ซ้ำ และไม่ต้องเรียก getProfile', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(userRepository.create).not.toHaveBeenCalled();
    expect(lineService.getProfile).not.toHaveBeenCalled();
  });
});

describe('handleEvent — Non-text events', () => {
  test('Event ประเภท image → ข้ามไป ไม่ประมวลผล ไม่ Error', async () => {
    const event = {
      type: 'message',
      replyToken: 'rt',
      source: { userId: 'U123' },
      message: { type: 'image', id: 'img-1' },
    };

    await handleEvent(event);

    expect(userRepository.findByLineUserId).not.toHaveBeenCalled();
    expect(lineService.replyMessage).not.toHaveBeenCalled();
  });

  test('Event ประเภท follow → ข้ามไป ไม่ประมวลผล', async () => {
    await handleEvent({ type: 'follow', replyToken: 'rt', source: { userId: 'U123' } });

    expect(userRepository.findByLineUserId).not.toHaveBeenCalled();
    expect(lineService.replyMessage).not.toHaveBeenCalled();
  });
});
