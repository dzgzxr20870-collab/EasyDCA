jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/transaction.service');
jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/history.service');
jest.mock('../src/services/line.service');

// Mock parseCommand แต่คง COMMANDS จริงไว้ให้ Controller ใช้เทียบ
jest.mock('../src/services/commandParser.service', () => {
  const actual = jest.requireActual('../src/services/commandParser.service');
  return { COMMANDS: actual.COMMANDS, parseCommand: jest.fn() };
});

const userRepository = require('../src/repositories/user.repository');
const transactionService = require('../src/services/transaction.service');
const portfolioService = require('../src/services/portfolio.service');
const historyService = require('../src/services/history.service');
const lineService = require('../src/services/line.service');
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

// ดึง payload ที่ถูกส่งเข้า replyMessage มาเป็น String เพื่อตรวจเนื้อหา
function lastReplyText() {
  const call = lineService.replyMessage.mock.calls.at(-1);
  return JSON.stringify(call[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findByLineUserId.mockResolvedValue(FREE_USER);
  lineService.replyMessage.mockResolvedValue(undefined);
});

describe('handleEvent — BUY', () => {
  test('ซื้อสำเร็จ → replyMessage ด้วย Confirm Message ที่ถูกต้อง', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
    });
    transactionService.processBuyCommand.mockResolvedValue({
      symbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
      amountThb: 1700,
      newAssetCreated: false,
    });

    await handleEvent(textEvent('ซื้อ PTT 50 หุ้น ราคา 34'));

    // ส่ง plan ของ user เข้า service ด้วย + เติม type จาก Symbol Registry (PTT = stock_th)
    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      FREE_USER.id,
      { symbol: 'PTT', quantity: 50, pricePerUnit: 34, type: 'stock_th' },
      { plan: 'free' }
    );
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('ยืนยันรายการซื้อ');
    expect(reply).toContain('PTT');
    expect(reply).toContain('1,700');
  });
});

describe('handleEvent — BUY เติม type จาก Symbol Registry', () => {
  test('ซื้อ Symbol ที่รู้จัก (ไม่มี type) → เติม type อัตโนมัติก่อนส่งเข้า service', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
    });
    transactionService.processBuyCommand.mockResolvedValue({
      symbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
      amountThb: 1700,
      newAssetCreated: true,
    });

    await handleEvent(textEvent('ซื้อ PTT 50 หุ้น ราคา 34'));

    // Controller ต้องเติม type: 'stock_th' ให้ PTT ก่อนส่งต่อ
    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      FREE_USER.id,
      { symbol: 'PTT', quantity: 50, pricePerUnit: 34, type: 'stock_th' },
      { plan: 'free' }
    );
    const reply = lastReplyText();
    expect(reply).toContain('ยืนยันรายการซื้อ');
  });

  test('ซื้อ Symbol ที่มี type มาแล้ว → ไม่เขียนทับ type เดิม', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'fund' },
    });
    transactionService.processBuyCommand.mockResolvedValue({
      symbol: 'BTC',
      quantity: 0.01,
      pricePerUnit: 3400000,
      amountThb: 34000,
      newAssetCreated: false,
    });

    await handleEvent(textEvent('ซื้อ BTC 0.01 หุ้น ราคา 3400000'));

    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      FREE_USER.id,
      { symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'fund' },
      { plan: 'free' }
    );
  });

  test('ซื้อ Symbol ที่ไม่รู้จัก → ส่งต่อโดยไม่มี type, service throw VALIDATION_ERROR, ได้ข้อความแนะนำที่ชัดเจน', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'UNKNOWNCOIN', quantity: 1, pricePerUnit: 10 },
    });
    const err = new Error('Creating a new asset requires an asset type');
    err.code = 'VALIDATION_ERROR';
    transactionService.processBuyCommand.mockRejectedValue(err);

    await handleEvent(textEvent('ซื้อ UNKNOWNCOIN 1 หุ้น ราคา 10'));

    // Controller ไม่เดา type — ส่งต่อ params เดิมโดยไม่มี type
    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      FREE_USER.id,
      { symbol: 'UNKNOWNCOIN', quantity: 1, pricePerUnit: 10 },
      { plan: 'free' }
    );
    const reply = lastReplyText();
    expect(reply).toContain('ไม่รู้จักสินทรัพย์นี้');
    expect(reply).toContain('ติดต่อทีมงาน');
    expect(reply).not.toContain('VALIDATION_ERROR');
    expect(reply).not.toContain('asset type');
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

describe('handleEvent — UNKNOWN', () => {
  test('คำสั่งไม่รู้จัก → replyMessage ด้วย Unknown Message พร้อมตัวอย่าง', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('อะไรสักอย่าง'));

    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
    const reply = lastReplyText();
    expect(reply).toContain('ไม่เข้าใจคำสั่ง');
    expect(reply).toContain('ซื้อ BTC 0.01 หุ้น ราคา 3400000');
  });
});

describe('handleEvent — Error Translation', () => {
  test('ASSET_LIMIT_REACHED → แปลเป็นข้อความไทย ไม่โชว์ Error Code ดิบ', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
    });
    const err = new Error('Free plan is limited to 2 active assets');
    err.code = 'ASSET_LIMIT_REACHED';
    transactionService.processBuyCommand.mockRejectedValue(err);

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
    transactionService.processSellCommand.mockRejectedValue(new Error('db exploded'));

    await handleEvent(textEvent('ขาย PTT 5 หุ้น ราคา 34'));

    const reply = lastReplyText();
    expect(reply).toContain('เกิดข้อผิดพลาด');
    expect(reply).not.toContain('db exploded');
  });
});

describe('handleEvent — User Auto-register', () => {
  test('User ใหม่ → เรียก userRepository.create ด้วยชื่อ Default (ไม่ใช่ null เพราะ display_name เป็น NOT NULL) ก่อนดำเนินการ', async () => {
    userRepository.findByLineUserId.mockResolvedValue(null);
    userRepository.create.mockResolvedValue(FREE_USER);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(userRepository.create).toHaveBeenCalledWith('U123', 'LINE User', null);
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
  });

  test('User เดิม → ไม่เรียก create ซ้ำ', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(userRepository.create).not.toHaveBeenCalled();
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
