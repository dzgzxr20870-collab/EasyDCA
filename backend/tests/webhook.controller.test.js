jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/transaction.service');
jest.mock('../src/services/line.service');

// Mock parseCommand แต่คง COMMANDS จริงไว้ให้ Controller ใช้เทียบ
jest.mock('../src/services/commandParser.service', () => {
  const actual = jest.requireActual('../src/services/commandParser.service');
  return { COMMANDS: actual.COMMANDS, parseCommand: jest.fn() };
});

const userRepository = require('../src/repositories/user.repository');
const transactionService = require('../src/services/transaction.service');
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

    // ส่ง plan ของ user เข้า service ด้วย
    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      FREE_USER.id,
      { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
      { plan: 'free' }
    );
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    const reply = lastReplyText();
    expect(reply).toContain('ยืนยันรายการซื้อ');
    expect(reply).toContain('PTT');
    expect(reply).toContain('1,700');
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
  test('User ใหม่ → เรียก userRepository.create ด้วย (lineUserId, null, null) ก่อนดำเนินการ', async () => {
    userRepository.findByLineUserId.mockResolvedValue(null);
    userRepository.create.mockResolvedValue(FREE_USER);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(userRepository.create).toHaveBeenCalledWith('U123', null, null);
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
