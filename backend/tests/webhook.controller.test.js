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
jest.mock('../src/services/storage.service');
jest.mock('../src/services/payment.service');
jest.mock('../src/services/userErasure.service');
jest.mock('../src/services/entitlement.service');
jest.mock('../src/services/bulkImportSession.service');
jest.mock('../src/services/bulkImport.service');
jest.mock('../src/services/reportExport.service');
jest.mock('../src/services/slipOcr.service');
jest.mock('../src/services/mutualFund.service');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/lineWebhookEvent.repository');
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
const storageService = require('../src/services/storage.service');
const paymentService = require('../src/services/payment.service');
const userErasureService = require('../src/services/userErasure.service');
const bulkImportSession = require('../src/services/bulkImportSession.service');
const bulkImportService = require('../src/services/bulkImport.service');
const reportExportService = require('../src/services/reportExport.service');
const slipOcrService = require('../src/services/slipOcr.service');
const mutualFundService = require('../src/services/mutualFund.service');
const assetRepository = require('../src/repositories/asset.repository');
const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');
const entitlement = require('../src/services/entitlement.service');
const commandParser = require('../src/services/commandParser.service');
const { handleEvent } = require('../src/controllers/webhook.controller');

const { COMMANDS } = commandParser;
// PDPA Consent Gate (migration 017) — FREE_USER แทน "ผู้ใช้เดิมที่ Consent แล้ว"
// (ทั้งที่ถูก Backfill ตาม Grandfather Clause และที่กดยอมรับเอง) จึงไม่เจอ Gate เลย
// Test ของ Gate เองใช้ NOT_CONSENTED_USER ด้านล่างแทน
const FREE_USER = {
  id: 'user-1',
  lineUserId: 'U123',
  plan: 'free',
  pdpaConsentedAt: '2026-07-01T00:00:00.000Z',
};
// ผู้ใช้ใหม่ที่ยังไม่เคยกดยอมรับผ่านช่องทางไหนเลย (pdpa_consented_at IS NULL)
const NOT_CONSENTED_USER = { ...FREE_USER, pdpaConsentedAt: null };

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

// Event พร้อม webhookEventId (LINE แนบมากับทุก Event จริง) — ใช้ทดสอบ Dedup Guard
function textEventWithId(text, webhookEventId) {
  return { ...textEvent(text), webhookEventId };
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
  // Default: ไม่มี Bulk Import Session ค้าง — Test ของ Flow นำเข้าพอร์ตจะ Override เอง
  bulkImportSession.getCurrentSession.mockResolvedValue(null);
  // Default: ไม่ถือ Asset ใดอยู่ + ค้นกองทุนไม่พบ (Symbol ที่ไม่รู้จักถือเป็น unknown asset)
  // — Test ของ Flow กองทุนจะ Override เอง
  assetRepository.findByUserAndSymbol.mockResolvedValue(null);
  mutualFundService.resolveFundForBuy.mockResolvedValue({ status: 'not_found' });
  // Default: Claim สำเร็จเสมอ (Event ใหม่) — Test ของ Dedup จะ Override เอง
  // (ไม่กระทบ Test เดิมทั้งหมดที่ไม่ได้ใส่ webhookEventId มาด้วย เพราะ Guard เป็น
  // if (event.webhookEventId) — claimEvent จะไม่ถูกเรียกเลยถ้าไม่มี Field นี้)
  lineWebhookEventRepository.claimEvent.mockResolvedValue(true);
  // Default: buildQrImageUrl ย้ายมาอยู่ payment.service.js แล้ว (เดิมเป็นฟังก์ชัน Local
  // ในไฟล์นี้) — จำลองพฤติกรรมเดิมเป๊ะ (ประกอบจาก config.app.publicBaseUrl ด้านบน)
  // ให้ Test เดิมที่ Assert เต็ม URL ยังผ่านโดยไม่ต้อง Override ทีละ Test
  paymentService.buildQrImageUrl.mockImplementation(
    (paymentId) => `https://api.easydca.test/api/v1/payment/${paymentId}/qr.png`
  );
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

describe('handleEvent — Webhook Event Idempotency (migration 013)', () => {
  test('Event ซ้ำ (webhookEventId เดิม) → ไม่ประมวลผลซ้ำ ไม่ reply ครั้งที่สอง', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: true,
      holdings: [],
      totalInvested: 0,
    });

    const event = textEventWithId('พอต', 'evt-dup-1');

    // ครั้งแรก: Claim สำเร็จ (Event ใหม่) → ประมวลผลตามปกติ
    lineWebhookEventRepository.claimEvent.mockResolvedValueOnce(true);
    await handleEvent(event);

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledTimes(1);
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);

    // ครั้งที่สอง: LINE Retry ส่ง Event เดิม (webhookEventId เดิม) → Claim ไม่ได้
    // (มีอยู่แล้ว) → ต้องไม่ไปถึง Logic Routing เดิมอีก (parseCommand/getPortfolioSummary/
    // replyMessage ต้องยังค้างที่ 1 ครั้ง ไม่ใช่ 2)
    lineWebhookEventRepository.claimEvent.mockResolvedValueOnce(false);
    await handleEvent(event);

    expect(lineWebhookEventRepository.claimEvent).toHaveBeenCalledTimes(2);
    expect(lineWebhookEventRepository.claimEvent).toHaveBeenNthCalledWith(1, 'evt-dup-1');
    expect(lineWebhookEventRepository.claimEvent).toHaveBeenNthCalledWith(2, 'evt-dup-1');
    expect(commandParser.parseCommand).toHaveBeenCalledTimes(1);
    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledTimes(1);
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
  });

  test('ไม่มี webhookEventId (เช่น Event ทดสอบจากปุ่ม Verify) → ไม่เรียก claimEvent แต่ยังประมวลผลปกติ', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: true,
      holdings: [],
      totalInvested: 0,
    });

    await handleEvent(textEvent('พอต'));

    expect(lineWebhookEventRepository.claimEvent).not.toHaveBeenCalled();
    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledTimes(1);
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
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
    // การ์ด Admin ต้องมีรูป QR (Deterministic จาก paymentId) แนบมาด้วย (migration 016 —
    // Admin เทียบ QR + สลิปคู่กันได้โดยไม่ต้องให้ User ส่ง Screenshot กลับมาเอง)
    expect(adminMsg).toContain('https://api.easydca.test/api/v1/payment/pay-1/qr.png');
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

  // Lock-Until-Resolved (migration 016) — กด "แจ้งชำระแล้ว" ก่อนส่งรูปสลิปมาเลย
  test('notify_payment: ยังไม่มีสลิปแนบ → SLIP_NOT_ATTACHED แปลไทย, ไม่ Push Admin', async () => {
    const err = new Error('no slip attached yet');
    err.code = 'SLIP_NOT_ATTACHED';
    paymentService.notifyPaymentSubmitted.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=notify_payment&paymentId=pay-1'));

    const reply = lastReplyText();
    expect(reply).toContain('ส่งรูปสลิปโอนเงิน');
    expect(reply).not.toContain('SLIP_NOT_ATTACHED');
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });
});

// PDPA Express Opt-in Consent Gate (ฝั่ง LINE Chat) — คู่กับ requireConsent ฝั่ง Web
describe('handleEvent — PDPA Consent Gate (LINE Chat)', () => {
  // ── ผู้ใช้ที่ยังไม่เคย Consent → ถูก Gate ดักทุกคำสั่ง ──────────────────────
  test('User ใหม่ (pdpaConsentedAt = null) พิมพ์ "พอต" → เจอการ์ดขอความยินยอม ไม่ประมวลผลคำสั่ง', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });

    await handleEvent(textEvent('พอต'));

    const reply = lastReplyText();
    expect(reply).toContain('action=pdpa_accept');
    expect(reply).toContain('action=pdpa_decline');
    // คำสั่งจริงต้องไม่ถูกประมวลผลเลย (ไม่มีข้อมูลใดถูกอ่าน/บันทึก)
    expect(portfolioService.getPortfolioSummary).not.toHaveBeenCalled();
  });

  test('User ใหม่ พิมพ์คำสั่งซื้อ → ถูก Gate ดัก ไม่สร้าง Pending Transaction', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', amountThb: 1000 },
    });

    await handleEvent(textEvent('ซื้อ BTC 1000'));

    expect(lastReplyText()).toContain('action=pdpa_accept');
    expect(pendingService.createPending).not.toHaveBeenCalled();
  });

  test('User ใหม่ กด Postback อื่น (premium_menu) → ถูก Gate ดัก ไม่สร้างคำขอชำระเงิน', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);

    await handleEvent(postbackEvent('action=premium_menu'));

    expect(lastReplyText()).toContain('action=pdpa_accept');
    expect(paymentService.findPendingByUserId).not.toHaveBeenCalled();
    expect(paymentService.requestPayment).not.toHaveBeenCalled();
  });

  // Edge Case ที่ตัดสินใจ: Admin ก็เป็น User ในระบบ ต้อง Consent เหมือนกัน (สม่ำเสมอกับ
  // ฝั่ง Web ที่ admin.routes.js ก็ผ่าน requireConsent เช่นกัน) — ไม่ Deadlock เพราะ
  // ปุ่ม Consent Bypass ได้ และปุ่มอนุมัติเดิมในแชทกดซ้ำได้หลัง Consent
  test('Admin ที่ยังไม่ Consent กด approve_payment → ถูก Gate ดัก ไม่อนุมัติให้', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);

    await handleEvent(postbackEvent('action=approve_payment&paymentId=pay-1'));

    expect(lastReplyText()).toContain('action=pdpa_accept');
    expect(paymentService.approvePayment).not.toHaveBeenCalled();
  });

  test('User ใหม่ ส่งรูปสลิป → ถูก Gate ดัก ไม่ดึงรูป/ไม่อัปโหลด/ไม่เรียก OCR', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);

    await handleEvent({
      type: 'message',
      replyToken: 'reply-token-1',
      source: { userId: 'U123' },
      message: { type: 'image', id: 'img-gate-1' },
    });

    expect(lastReplyText()).toContain('action=pdpa_accept');
    expect(lineService.getMessageContent).not.toHaveBeenCalled();
    expect(storageService.uploadPaymentSlip).not.toHaveBeenCalled();
    expect(slipOcrService.extractSlip).not.toHaveBeenCalled();
    // ไม่แตะ Payment ที่อาจค้างอยู่เลย
    expect(paymentService.findPendingByUserId).not.toHaveBeenCalled();
  });

  // ── ผู้ใช้เดิมที่ Consent แล้ว (รวม Backfill) → ไม่เจอ Gate เลย ──────────────
  test('User เดิมที่ Consent แล้ว (Backfill) พิมพ์ "พอต" → ทำงานปกติ ไม่เจอ Gate', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [], totalInvested: 0 });

    await handleEvent(textEvent('พอต'));

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(FREE_USER.id);
    expect(lastReplyText()).not.toContain('action=pdpa_accept');
  });

  // ── ปุ่ม Consent เอง ต้อง Bypass Gate ได้เสมอ (กัน Deadlock) ────────────────
  test('pdpa_accept: User ที่ยังไม่ Consent กดยอมรับ → บันทึก Consent + ตอบยืนยัน (Bypass Gate ได้)', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);
    userRepository.setPdpaConsent.mockResolvedValue({
      ...NOT_CONSENTED_USER,
      pdpaConsentedAt: '2026-07-17T00:00:00.000Z',
    });

    await handleEvent(postbackEvent('action=pdpa_accept'));

    expect(userRepository.setPdpaConsent).toHaveBeenCalledWith(NOT_CONSENTED_USER.id);
    const reply = lastReplyText();
    expect(reply).toContain('ยอมรับเรียบร้อยแล้ว');
    // ไม่ตอบการ์ดขอ Consent ซ้ำ (ไม่ Deadlock)
    expect(reply).not.toContain('action=pdpa_accept');
  });

  test('pdpa_accept: User ที่ Consent ไปแล้วกดปุ่มเก่าซ้ำ → Idempotent (ไม่เขียน DB ซ้ำ) ยังตอบยืนยันปกติ', async () => {
    await handleEvent(postbackEvent('action=pdpa_accept'));

    expect(userRepository.setPdpaConsent).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('ยอมรับเรียบร้อยแล้ว');
  });

  test('pdpa_decline: กดไม่ยอมรับ → อธิบายว่าต้องยอมรับก่อน ไม่แตะ DB เลย', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);

    await handleEvent(postbackEvent('action=pdpa_decline'));

    expect(userRepository.setPdpaConsent).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('ต้องยอมรับนโยบายความเป็นส่วนตัวก่อน');
  });

  test('หลัง Consent แล้ว พิมพ์คำสั่งเดิมซ้ำ → ผ่าน Gate ใช้งานได้ทันทีในรอบถัดไป', async () => {
    // รอบที่ 1: ยังไม่ Consent → ถูก Gate ดัก
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    await handleEvent(textEvent('พอต'));
    expect(portfolioService.getPortfolioSummary).not.toHaveBeenCalled();

    // รอบที่ 2: Consent แล้ว (DB คืนค่าใหม่) → พิมพ์ซ้ำแล้วผ่าน
    userRepository.findByLineUserId.mockResolvedValue(FREE_USER);
    portfolioService.getPortfolioSummary.mockResolvedValue({ holdings: [], totalInvested: 0 });
    await handleEvent(textEvent('พอต'));

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(FREE_USER.id);
  });
});

// PDPA Self-Service Erasure — คำสั่ง "ลบข้อมูล" ใน LINE Chat (2-Step Confirm)
describe('handleEvent — ERASE_DATA_REQUEST (PDPA Self-Service Erasure)', () => {
  test('พิมพ์ "ลบข้อมูล" + ไม่มี Payment ค้าง → ข้อความยืนยันไม่มีคำเตือนพิเศษ', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.ERASE_DATA_REQUEST, params: {} });
    paymentService.findPendingByUserId.mockResolvedValue(null);

    await handleEvent(textEvent('ลบข้อมูล'));

    const reply = lastReplyText();
    expect(reply).toContain('action=confirm_erase_data');
    expect(reply).toContain('action=cancel_erase_data');
    expect(reply).not.toContain('คำขอชำระเงินที่ยังไม่ได้ตรวจสอบค้างอยู่');
    expect(userErasureService.eraseUserData).not.toHaveBeenCalled();
  });

  test('พิมพ์ "ลบข้อมูล" + มี Payment ค้าง (pending) → ข้อความยืนยันมีคำเตือนพิเศษ', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.ERASE_DATA_REQUEST, params: {} });
    paymentService.findPendingByUserId.mockResolvedValue({ id: 'pay-1', status: 'pending' });

    await handleEvent(textEvent('ลบข้อมูล'));

    const reply = lastReplyText();
    expect(reply).toContain('คำขอชำระเงินที่ยังไม่ได้ตรวจสอบค้างอยู่');
  });

  test('confirm_erase_data: ยืนยันจริง → เรียก eraseUserData แล้วตอบข้อความลบสำเร็จ', async () => {
    paymentService.findPendingByUserId.mockResolvedValue(null);
    userErasureService.eraseUserData.mockResolvedValue({ paymentCount: 0, deletedSlipCount: 0 });

    await handleEvent(postbackEvent('action=confirm_erase_data'));

    expect(userErasureService.eraseUserData).toHaveBeenCalledWith(FREE_USER.id, {
      hadPendingPayment: false,
    });
    const reply = lastReplyText();
    expect(reply).toContain('ลบข้อมูล');
  });

  test('confirm_erase_data: มี Payment ค้างตอนกดยืนยันจริง → hadPendingPayment: true ส่งเข้า Log', async () => {
    paymentService.findPendingByUserId.mockResolvedValue({ id: 'pay-1', status: 'pending' });
    userErasureService.eraseUserData.mockResolvedValue({ paymentCount: 1, deletedSlipCount: 1 });

    await handleEvent(postbackEvent('action=confirm_erase_data'));

    expect(userErasureService.eraseUserData).toHaveBeenCalledWith(FREE_USER.id, {
      hadPendingPayment: true,
    });
  });

  test('cancel_erase_data: ยกเลิก → ตอบข้อความยกเลิกปกติ ไม่เรียก eraseUserData เลย', async () => {
    await handleEvent(postbackEvent('action=cancel_erase_data'));

    expect(userErasureService.eraseUserData).not.toHaveBeenCalled();
    const reply = lastReplyText();
    expect(reply).toContain('ยกเลิก');
  });
});

describe('handleEvent — Dashboard Postback', () => {
  test('open_dashboard: ส่งลิงก์เปิด LIFF Dashboard (uri ประกอบจาก config.liff.id)', async () => {
    await handleEvent(postbackEvent('action=open_dashboard'));

    const reply = lastReplyText();
    expect(reply).toContain('https://liff.line.me/2010586158-DO9yzmaP');
  });
});

describe('handleEvent — Add Guide Postback (ปุ่ม "เพิ่มรายการ" ใน Rich Menu)', () => {
  // S8 R2 รอบ 1: add_guide เปลี่ยนจาก "การ์ดสอนพิมพ์คำสั่ง" → "Quick Reply Menu"
  // (ปลายทางเดียวกับข้อความที่ Parse ไม่ออก) — Intent เดิมของ Test นี้คือ "ปุ่มนี้ต้อง
  // ไม่ทำตัวเหมือน message('ซื้อ') เปล่าๆ ที่ตก UNKNOWN" ซึ่งยังคงถูกตรวจอยู่
  // ส่วนการ์ดสอนพิมพ์เดิมย้ายไปอยู่หลังปุ่ม buy_guide (มี Test แยกด้านล่างไฟล์)
  test('add_guide: reply ด้วย Quick Reply Menu (ไม่ใช่ message("ซื้อ") เปล่าๆ ที่ตก UNKNOWN)', async () => {
    await handleEvent(postbackEvent('action=add_guide'));

    expect(pendingService.createPending).not.toHaveBeenCalled();
    const call = lineService.replyMessage.mock.calls.at(-1);
    expect(call[1].quickReply.items).toHaveLength(4);
    expect(lastReplyText()).not.toContain('ไม่เข้าใจคำสั่งนี้');
  });
});

describe('handleEvent — Bulk Import (Phase 3 Round 6)', () => {
  test('"นำเข้าพอร์ต" → startSession แล้ว reply ด้วยคำแนะนำ Format + ตัวอย่าง', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.IMPORT_PORTFOLIO, params: {} });
    bulkImportSession.startSession.mockResolvedValue(undefined);

    await handleEvent(textEvent('นำเข้าพอร์ต'));

    expect(bulkImportSession.startSession).toHaveBeenCalledWith(FREE_USER.id);
    const reply = lastReplyText();
    expect(reply).toContain('BTC 0.5 ต้นทุน 1500000');
  });

  test('ข้อความที่ 2 (Batch) เมื่อมี Session ค้าง + Parse/Validate ผ่านหมด → reply ด้วย Preview พร้อมปุ่มยืนยัน/ยกเลิก', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    bulkImportSession.getCurrentSession.mockResolvedValue({ userId: FREE_USER.id });
    bulkImportService.previewBatch.mockResolvedValue({
      ok: true,
      batchId: 'batch-1',
      totalAmountThb: 750000,
      items: [
        { assetSymbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000, txnDate: '2026-07-10' },
      ],
    });
    bulkImportSession.clearSession.mockResolvedValue(undefined);

    await handleEvent(textEvent('BTC 0.5 ต้นทุน 1500000'));

    expect(bulkImportService.previewBatch).toHaveBeenCalledWith(
      FREE_USER.id,
      'BTC 0.5 ต้นทุน 1500000',
      { plan: 'free', planExpiresAt: undefined }
    );
    expect(bulkImportSession.clearSession).toHaveBeenCalledWith(FREE_USER.id);
    const reply = lastReplyText();
    expect(reply).toContain('action=confirm_bulk_import&batchId=batch-1');
    expect(reply).toContain('action=cancel_bulk_import&batchId=batch-1');
  });

  test('Batch มี Parse/Validate Error → reply แสดงบรรทัดที่ผิด, ไม่ล้าง Session (ส่งแก้ใหม่ได้โดยไม่ต้องพิมพ์คำสั่งซ้ำ)', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    bulkImportSession.getCurrentSession.mockResolvedValue({ userId: FREE_USER.id });
    bulkImportService.previewBatch.mockResolvedValue({
      ok: false,
      empty: false,
      errors: [{ line: 2, reason: 'รูปแบบไม่ถูกต้อง' }],
    });

    await handleEvent(textEvent('BTC 0.5 ต้นทุน 1500000\nผิดรูปแบบ'));

    expect(bulkImportSession.clearSession).not.toHaveBeenCalled();
    const reply = lastReplyText();
    expect(reply).toContain('บรรทัด 2');
    expect(reply).toContain('รูปแบบไม่ถูกต้อง');
  });

  test('Batch ว่างเปล่า → reply แจ้งไม่พบรายการ, ไม่ล้าง Session', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    bulkImportSession.getCurrentSession.mockResolvedValue({ userId: FREE_USER.id });
    bulkImportService.previewBatch.mockResolvedValue({ ok: false, empty: true, errors: [] });

    await handleEvent(textEvent('   '));

    expect(bulkImportSession.clearSession).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('ไม่พบรายการ');
  });

  test('ไม่มี Bulk Import Session ค้าง + ข้อความสุ่มหลายบรรทัด → ตกไป Unknown ตามปกติ ไม่แตะ bulkImportService', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    bulkImportSession.getCurrentSession.mockResolvedValue(null);

    await handleEvent(textEvent('สวัสดี\nวันนี้อากาศดี'));

    expect(bulkImportService.previewBatch).not.toHaveBeenCalled();
    // S8 R2 รอบ 1: ปลายทางของ "ไม่มี Session + Parse ไม่ออก" เปลี่ยนเป็น Quick Reply
    // Menu แล้ว — Intent เดิม (ต้องไม่แตะ bulkImportService) ยังตรวจอยู่บรรทัดบน
    expect(lastReplyText()).toContain('ไม่เข้าใจข้อความนี้');
  });

  test('Postback confirm_bulk_import → เรียก confirmBatch พร้อม options (plan/planExpiresAt) แล้ว reply สรุปผล Best-effort', async () => {
    bulkImportService.confirmBatch.mockResolvedValue({
      total: 2,
      succeeded: [{ symbol: 'BTC' }, { symbol: 'ETH' }],
      failed: [],
    });

    await handleEvent(postbackEvent('action=confirm_bulk_import&batchId=batch-1'));

    // Bug Fix: ต้อง Thread options เดียวกับ case 'confirm' เดี่ยว ไม่ใช่แค่ batchId
    // (ถ้าไม่ส่ง options ไป confirmBatch จะ Fallback plan='free' ที่ transaction.
    // service ทำให้ Premium โดนเช็ค Asset Limit ผิดเป็น Free)
    expect(bulkImportService.confirmBatch).toHaveBeenCalledWith('batch-1', {
      plan: 'free',
      planExpiresAt: undefined,
    });
    expect(lastReplyText()).toContain('2/2');
  });

  test('Postback confirm_bulk_import: User เป็น Premium → confirmBatch ได้รับ options plan="premium" + planExpiresAt จริง', async () => {
    userRepository.findByLineUserId.mockResolvedValue({
      ...FREE_USER,
      plan: 'premium',
      planExpiresAt: '2026-08-04T00:00:00.000Z',
    });
    bulkImportService.confirmBatch.mockResolvedValue({
      total: 3,
      succeeded: [{ symbol: 'BTC' }, { symbol: 'ETH' }, { symbol: 'MSFT' }],
      failed: [],
    });

    await handleEvent(postbackEvent('action=confirm_bulk_import&batchId=batch-premium'));

    expect(bulkImportService.confirmBatch).toHaveBeenCalledWith('batch-premium', {
      plan: 'premium',
      planExpiresAt: '2026-08-04T00:00:00.000Z',
    });
    expect(lastReplyText()).toContain('3/3');
  });

  test('Postback confirm_bulk_import บางรายการล้มเหลว → reply แจ้งสำเร็จบางส่วนพร้อมเหตุผล', async () => {
    bulkImportService.confirmBatch.mockResolvedValue({
      total: 2,
      succeeded: [{ symbol: 'BTC' }],
      failed: [{ symbol: 'ETH', code: 'INTERNAL_ERROR' }],
    });

    await handleEvent(postbackEvent('action=confirm_bulk_import&batchId=batch-1'));

    const reply = lastReplyText();
    expect(reply).toContain('1/2');
    expect(reply).toContain('ETH');
  });

  test('Postback confirm_bulk_import: Batch ไม่พบ (BATCH_NOT_FOUND) → แปลเป็นข้อความไทย', async () => {
    const err = new Error('not found');
    err.code = 'BATCH_NOT_FOUND';
    bulkImportService.confirmBatch.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=confirm_bulk_import&batchId=batch-x'));

    const reply = lastReplyText();
    expect(reply).toContain('ไม่พบรายการนำเข้าพอร์ตนี้');
    expect(reply).not.toContain('BATCH_NOT_FOUND');
  });

  test('Postback cancel_bulk_import → เรียก cancelBatch แล้ว reply ยืนยันยกเลิก ไม่บันทึกอะไร', async () => {
    bulkImportService.cancelBatch.mockResolvedValue({ total: 2, cancelled: 2, failed: [] });

    await handleEvent(postbackEvent('action=cancel_bulk_import&batchId=batch-1'));

    expect(bulkImportService.cancelBatch).toHaveBeenCalledWith('batch-1');
    expect(lastReplyText()).toContain('ยกเลิกรายการแล้ว');
  });
});

describe('handleEvent — UNKNOWN', () => {
  // S8 R2 รอบ 1: เปลี่ยนจากการ์ด "ไม่เข้าใจคำสั่งนี้" (ทางตัน ไม่มีปุ่ม) → Quick Reply
  // Menu ที่กดต่อได้ — Intent เดิม (ไม่สร้าง Pending + ตอบอะไรที่ช่วยผู้ใช้ต่อได้) คงเดิม
  // ตัวอย่างคำสั่งพิมพ์ตรงย้ายไปอยู่ในการ์ด "วิธีใช้งาน" (ปุ่ม help_guide) แทน
  test('คำสั่งไม่รู้จัก → replyMessage ด้วย Quick Reply Menu (ไม่สร้าง Pending)', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('อะไรสักอย่าง'));

    expect(pendingService.createPending).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('ไม่เข้าใจข้อความนี้');
    const call = lineService.replyMessage.mock.calls.at(-1);
    expect(call[1].quickReply.items).toHaveLength(4);
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

  // ── Round 3: แก้บั๊กชื่อ Fallback "LINE User" ค้างถาวร ───────────────────────
  test('User เดิมมีชื่อ "LINE User" (Fallback ค้าง) + Profile รอบนี้ได้ชื่อจริง → Sync ชื่อสำเร็จ', async () => {
    const staleUser = { id: 'user-1', lineUserId: 'U123', plan: 'free', displayName: 'LINE User', pictureUrl: null };
    userRepository.findByLineUserId.mockResolvedValue(staleUser);
    lineService.getProfile.mockResolvedValue({
      displayName: 'สมชาย ใจดี',
      pictureUrl: 'https://profile.line-scdn.net/abc123',
    });
    userRepository.updateDisplayName.mockResolvedValue({
      ...staleUser,
      displayName: 'สมชาย ใจดี',
      pictureUrl: 'https://profile.line-scdn.net/abc123',
    });
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(lineService.getProfile).toHaveBeenCalledWith('U123');
    expect(userRepository.updateDisplayName).toHaveBeenCalledWith(
      'user-1',
      'สมชาย ใจดี',
      'https://profile.line-scdn.net/abc123'
    );
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  test('User เดิมมีชื่อ "LINE User" + Profile รอบนี้ก็ดึงไม่ได้อีก (null) → ไม่ Error คืน existing เดิม', async () => {
    const staleUser = { id: 'user-1', lineUserId: 'U123', plan: 'free', displayName: 'LINE User', pictureUrl: null };
    userRepository.findByLineUserId.mockResolvedValue(staleUser);
    lineService.getProfile.mockResolvedValue(null);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(lineService.getProfile).toHaveBeenCalledWith('U123');
    expect(userRepository.updateDisplayName).not.toHaveBeenCalled();
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
  });

  test('User เดิมมีชื่อจริงอยู่แล้ว (ไม่ใช่ "LINE User") → ไม่ Sync ไม่เรียก getProfile', async () => {
    const namedUser = { id: 'user-1', lineUserId: 'U123', plan: 'free', displayName: 'สมชาย ใจดี', pictureUrl: null };
    userRepository.findByLineUserId.mockResolvedValue(namedUser);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดี'));

    expect(lineService.getProfile).not.toHaveBeenCalled();
    expect(userRepository.updateDisplayName).not.toHaveBeenCalled();
    expect(userRepository.create).not.toHaveBeenCalled();
  });
});

describe('handleEvent — Image (แนบสลิปตอนแจ้งชำระ)', () => {
  function imageEvent(messageId = 'img-1') {
    return {
      type: 'message',
      replyToken: 'reply-token-1',
      source: { userId: 'U123' },
      message: { type: 'image', id: messageId },
    };
  }

  test('มีคำขอ pending → คำนวณ slip_hash → เช็คไม่ซ้ำ → อัปโหลด → เซฟ URL+hash → reply ยืนยันได้รับสลิป', async () => {
    paymentService.findPendingByUserId.mockResolvedValue({ id: 'pay-1', status: 'pending' });
    lineService.getMessageContent.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/jpeg',
    });
    paymentService.hashSlipImage.mockReturnValueOnce('hash-abc');
    paymentService.assertSlipNotReused.mockResolvedValueOnce(undefined);
    storageService.uploadPaymentSlip.mockResolvedValue('https://cdn.test/payment-slips/pay-1-1.jpg');
    paymentService.attachSlipImage.mockResolvedValue({ id: 'pay-1' });

    await handleEvent(imageEvent('img-1'));

    expect(paymentService.findPendingByUserId).toHaveBeenCalledWith(FREE_USER.id);
    expect(lineService.getMessageContent).toHaveBeenCalledWith('img-1');
    // Payment Beta (migration 015) — Hash คำนวณก่อนตรวจซ้ำ ก่อนอัปโหลดเสมอ
    expect(paymentService.hashSlipImage).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(paymentService.assertSlipNotReused).toHaveBeenCalledWith('hash-abc');
    expect(storageService.uploadPaymentSlip).toHaveBeenCalledWith(
      'pay-1',
      Buffer.from([1, 2, 3]),
      'image/jpeg'
    );
    expect(paymentService.attachSlipImage).toHaveBeenCalledWith(
      'pay-1',
      'https://cdn.test/payment-slips/pay-1-1.jpg',
      'hash-abc'
    );
    expect(lastReplyText()).toContain('ได้รับ');
  });

  test('slip_hash ซ้ำกับคำขอที่อนุมัติแล้ว (SLIP_ALREADY_USED) → reply ข้อความแจ้งเตือน ไม่อัปโหลด ไม่เซฟ', async () => {
    paymentService.findPendingByUserId.mockResolvedValue({ id: 'pay-1', status: 'pending' });
    lineService.getMessageContent.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/jpeg',
    });
    paymentService.hashSlipImage.mockReturnValueOnce('hash-reused');
    // ใช้ mockRejectedValueOnce (ไม่ใช่ mockRejectedValue) — beforeEach ของไฟล์นี้ใช้แค่
    // jest.clearAllMocks() ซึ่งไม่ล้าง Implementation ที่ตั้งไว้ถาวร ถ้าใช้ mockRejectedValue
    // เฉยๆ จะรั่วไปกระทบ Test อื่นที่รันถัดจากนี้ในไฟล์เดียวกัน
    paymentService.assertSlipNotReused.mockRejectedValueOnce(
      Object.assign(new Error('reused'), { code: 'SLIP_ALREADY_USED' })
    );

    await handleEvent(imageEvent('img-1'));

    expect(storageService.uploadPaymentSlip).not.toHaveBeenCalled();
    expect(paymentService.attachSlipImage).not.toHaveBeenCalled();
    expect(lineService.replyMessage).toHaveBeenCalledTimes(1);
    expect(lastReplyText()).toContain('เคยถูกใช้');
  });

  // Round 9: ไม่มีคำขอ pending → ไม่ใช่ Payment Slip อีกต่อไป แต่เป็น Asset Slip (R9)
  test('ไม่มีคำขอ pending + ไม่ใช่ Premium → ตอบชวนอัพเกรด (ไม่ดึงรูป ไม่เรียก OCR)', async () => {
    paymentService.findPendingByUserId.mockResolvedValue(null);
    entitlement.isPremiumActive.mockReturnValue(false);

    await handleEvent(imageEvent());

    expect(lineService.getMessageContent).not.toHaveBeenCalled();
    expect(slipOcrService.extractSlip).not.toHaveBeenCalled();
    expect(storageService.uploadPaymentSlip).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('Premium');
  });

  test('ไม่มีคำขอ pending + Premium → OCR สำเร็จ → reply การ์ด Preview พร้อมปุ่มยืนยัน', async () => {
    paymentService.findPendingByUserId.mockResolvedValue(null);
    entitlement.isPremiumActive.mockReturnValue(true);
    lineService.getMessageContent.mockResolvedValue({
      buffer: Buffer.from([9]),
      contentType: 'image/jpeg',
    });
    slipOcrService.extractSlip.mockResolvedValue({
      symbol: 'BTC', side: 'buy', quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000,
      date: '05/07/2026', dateIso: '2026-07-05', confidence: 'high', remainingQuota: 49, quotaLimit: 50,
    });

    await handleEvent(imageEvent('img-x'));

    expect(slipOcrService.extractSlip).toHaveBeenCalledWith('user-1', Buffer.from([9]), 'image/jpeg');
    // ไม่ไปทาง Payment Slip เดิม
    expect(storageService.uploadPaymentSlip).not.toHaveBeenCalled();
    const reply = lastReplyText();
    expect(reply).toContain('BTC');
    expect(reply).toContain('action=ocr_confirm');
  });

  test('ไม่มีคำขอ pending + Premium + โควตาเต็ม → ตอบข้อความโควตา (ไม่ Crash)', async () => {
    paymentService.findPendingByUserId.mockResolvedValue(null);
    entitlement.isPremiumActive.mockReturnValue(true);
    lineService.getMessageContent.mockResolvedValue({ buffer: Buffer.from([9]), contentType: 'image/jpeg' });
    slipOcrService.extractSlip.mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'OCR_QUOTA_EXCEEDED' })
    );

    await expect(handleEvent(imageEvent())).resolves.toBeUndefined();
    expect(lastReplyText()).toContain('โควตา');
  });

  test('ไม่มีคำขอ pending + Premium + ดึงรูปไม่ได้ → ตอบ OCR_FAILED (ไม่ Crash, ไม่เรียก OCR)', async () => {
    paymentService.findPendingByUserId.mockResolvedValue(null);
    entitlement.isPremiumActive.mockReturnValue(true);
    lineService.getMessageContent.mockRejectedValue(new Error('LINE Content API failed: 404'));

    await expect(handleEvent(imageEvent())).resolves.toBeUndefined();
    expect(slipOcrService.extractSlip).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('อ่านสลิปไม่สำเร็จ');
  });

  test('LINE Content API ดึงไม่สำเร็จ → ไม่ Crash, ไม่ตอบ Error หาผู้ใช้, ไม่อัปโหลด', async () => {
    paymentService.findPendingByUserId.mockResolvedValue({ id: 'pay-1', status: 'pending' });
    lineService.getMessageContent.mockRejectedValue(new Error('LINE Content API failed: 404'));

    await expect(handleEvent(imageEvent())).resolves.toBeUndefined();

    expect(storageService.uploadPaymentSlip).not.toHaveBeenCalled();
    expect(paymentService.attachSlipImage).not.toHaveBeenCalled();
    expect(lineService.replyMessage).not.toHaveBeenCalled();
  });

  test('อัปโหลด Storage ล้มเหลว → ไม่ Crash Webhook, ไม่เซฟ URL, ไม่ตอบ Error หาผู้ใช้', async () => {
    paymentService.findPendingByUserId.mockResolvedValue({ id: 'pay-1', status: 'pending' });
    lineService.getMessageContent.mockResolvedValue({
      buffer: Buffer.from([1]),
      contentType: 'image/jpeg',
    });
    storageService.uploadPaymentSlip.mockRejectedValue(new Error('bucket not found'));

    await expect(handleEvent(imageEvent())).resolves.toBeUndefined();

    expect(paymentService.attachSlipImage).not.toHaveBeenCalled();
    expect(lineService.replyMessage).not.toHaveBeenCalled();
  });

  test('ส่งรูปซ้ำหลายรูปสำหรับ Payment เดียวกัน → ผูกทุกครั้ง (URL ล่าสุดชนะ)', async () => {
    paymentService.findPendingByUserId.mockResolvedValue({ id: 'pay-1', status: 'pending' });
    lineService.getMessageContent
      .mockResolvedValueOnce({ buffer: Buffer.from([1]), contentType: 'image/jpeg' })
      .mockResolvedValueOnce({ buffer: Buffer.from([2]), contentType: 'image/jpeg' });
    paymentService.hashSlipImage
      .mockReturnValueOnce('hash-1')
      .mockReturnValueOnce('hash-2');
    paymentService.assertSlipNotReused.mockResolvedValue(undefined);
    storageService.uploadPaymentSlip
      .mockResolvedValueOnce('https://cdn.test/slip-1.jpg')
      .mockResolvedValueOnce('https://cdn.test/slip-2.jpg');
    paymentService.attachSlipImage.mockResolvedValue({ id: 'pay-1' });

    await handleEvent(imageEvent('img-1'));
    await handleEvent(imageEvent('img-2'));

    expect(paymentService.attachSlipImage).toHaveBeenNthCalledWith(1, 'pay-1', 'https://cdn.test/slip-1.jpg', 'hash-1');
    expect(paymentService.attachSlipImage).toHaveBeenNthCalledWith(2, 'pay-1', 'https://cdn.test/slip-2.jpg', 'hash-2');
  });
});

describe('handleEvent — Non-text events', () => {
  test('Event ประเภท follow → ข้ามไป ไม่ประมวลผล', async () => {
    await handleEvent({ type: 'follow', replyToken: 'rt', source: { userId: 'U123' } });

    expect(userRepository.findByLineUserId).not.toHaveBeenCalled();
    expect(lineService.replyMessage).not.toHaveBeenCalled();
  });

  test('Event ประเภท sticker → ข้ามไป ไม่ประมวลผล (ไม่ใช่ text/postback/image)', async () => {
    await handleEvent({
      type: 'message',
      replyToken: 'rt',
      source: { userId: 'U123' },
      message: { type: 'sticker', id: 's-1' },
    });

    expect(userRepository.findByLineUserId).not.toHaveBeenCalled();
    expect(lineService.replyMessage).not.toHaveBeenCalled();
  });
});

describe('handleEvent — กองทุนรวมไทย (Round 7)', () => {
  test('(a) ซื้อกองทุน Class เดียว → ไม่ถาม, สร้าง Preview เลย (params เติม type/projId/class)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'SCBRM', amountThb: 5000 },
    });
    mutualFundService.resolveFundForBuy.mockResolvedValue({
      status: 'single',
      project: { projId: 'M0002', projAbbrName: 'SCBRM', projNameTh: 'ไทยพาณิชย์ RM' },
      fundClass: { projId: 'M0002', fundClassName: 'SCBRM' },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'pf-1', commandType: 'buy', assetSymbol: 'SCBRM', fundClassName: 'SCBRM',
      quantity: 500, pricePerUnit: 10, amountThb: 5000, priceSource: 'secnav',
    });

    await handleEvent(textEvent('ซื้อ SCBRM 5000'));

    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      expect.objectContaining({
        command: COMMANDS.BUY,
        params: expect.objectContaining({
          symbol: 'SCBRM', type: 'fund', projId: 'M0002', fundClassName: 'SCBRM',
        }),
      }),
      { plan: 'free' }
    );
    expect(lastReplyText()).toContain('SCBRM');
  });

  test('(b) ซื้อกองทุนหลาย Class → ตอบ Class Picker (ไม่สร้าง Pending) + มีปุ่ม "ไม่แน่ใจ"', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'K-SELECT', amountThb: 5000 },
    });
    mutualFundService.resolveFundForBuy.mockResolvedValue({
      status: 'multiple',
      project: {
        projId: 'M0001', projAbbrName: 'K-SELECT', projNameTh: 'เค ซีเล็คท์',
        classes: [
          { fundClassName: 'K-SELECT-A(A)', fundClassDetail: 'สะสมมูลค่า' },
          { fundClassName: 'K-SELECT-A(D)', fundClassDetail: 'จ่ายปันผล' },
        ],
      },
    });

    await handleEvent(textEvent('ซื้อ K-SELECT 5000'));

    expect(pendingService.createPending).not.toHaveBeenCalled();
    const reply = lastReplyText();
    expect(reply).toContain('action=fund_buy&projId=M0001');
    expect(reply).toContain('amt=5000');
    expect(reply).toContain('action=fund_buy_auto');
  });

  test('(c) Postback fund_buy_auto ("ไม่แน่ใจ") → Auto-select แล้วสร้าง Preview', async () => {
    mutualFundService.getProjectById.mockResolvedValue({
      projId: 'M0001', projAbbrName: 'K-SELECT', projNameTh: 'เค ซีเล็คท์',
      classes: [{ projId: 'M0001', fundClassName: 'K-SELECT-A(A)' }],
    });
    mutualFundService.autoSelectClass.mockReturnValue({ projId: 'M0001', fundClassName: 'K-SELECT-A(A)' });
    pendingService.createPending.mockResolvedValue({
      id: 'pf-2', commandType: 'buy', assetSymbol: 'K-SELECT', fundClassName: 'K-SELECT-A(A)',
      quantity: 400, pricePerUnit: 12.5, amountThb: 5000, priceSource: 'secnav',
    });

    await handleEvent(postbackEvent('action=fund_buy_auto&projId=M0001&amt=5000'));

    expect(mutualFundService.autoSelectClass).toHaveBeenCalled();
    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      expect.objectContaining({
        params: expect.objectContaining({ type: 'fund', projId: 'M0001', fundClassName: 'K-SELECT-A(A)', amountThb: 5000 }),
      }),
      { plan: 'free' }
    );
    expect(lastReplyText()).toContain('K-SELECT-A(A)');
  });

  test('Postback fund_buy (เลือก Class เจาะจง) → Re-derive จาก Master List แล้วสร้าง Preview', async () => {
    mutualFundService.getFundClass.mockResolvedValue({
      projId: 'M0001', fundClassName: 'K-SELECT-A(D)', projAbbrName: 'K-SELECT',
      projNameTh: 'เค ซีเล็คท์', fundClassDetail: 'จ่ายปันผล',
    });
    pendingService.createPending.mockResolvedValue({
      id: 'pf-3', commandType: 'buy', assetSymbol: 'K-SELECT', fundClassName: 'K-SELECT-A(D)',
      quantity: 100, pricePerUnit: 12.34, amountThb: 1234, priceSource: 'user',
    });

    await handleEvent(postbackEvent('action=fund_buy&projId=M0001&class=K-SELECT-A(D)&qty=100&price=12.34'));

    expect(mutualFundService.getFundClass).toHaveBeenCalledWith('M0001', 'K-SELECT-A(D)');
    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      expect.objectContaining({
        params: expect.objectContaining({
          type: 'fund', projId: 'M0001', fundClassName: 'K-SELECT-A(D)', quantity: 100, pricePerUnit: 12.34,
        }),
      }),
      { plan: 'free' }
    );
  });

  test('ซื้อกองทุนที่ถืออยู่แล้ว → Reuse Class เดิม ไม่ค้น Master List ซ้ำ', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'K-SELECT', amountThb: 2000 },
    });
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'a-fund', type: 'fund', symbol: 'K-SELECT', name: 'เค ซีเล็คท์',
      projId: 'M0001', fundClassName: 'K-SELECT-A(A)',
    });
    pendingService.createPending.mockResolvedValue({
      id: 'pf-4', commandType: 'buy', assetSymbol: 'K-SELECT', fundClassName: 'K-SELECT-A(A)',
      quantity: 160, pricePerUnit: 12.5, amountThb: 2000, priceSource: 'secnav',
    });

    await handleEvent(textEvent('ซื้อ K-SELECT 2000'));

    expect(mutualFundService.resolveFundForBuy).not.toHaveBeenCalled();
    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      expect.objectContaining({
        params: expect.objectContaining({ type: 'fund', projId: 'M0001', fundClassName: 'K-SELECT-A(A)' }),
      }),
      { plan: 'free' }
    );
  });

  test('(g) Symbol ไม่พบทั้งใน static + กองทุน → ตกเป็น unknown asset (VALIDATION_ERROR แปลไทย)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'NOTEXIST', quantity: 1, pricePerUnit: 10 },
    });
    mutualFundService.resolveFundForBuy.mockResolvedValue({ status: 'not_found' });
    const err = new Error('Creating a new asset requires an asset type');
    err.code = 'VALIDATION_ERROR';
    pendingService.createPending.mockRejectedValue(err);

    await handleEvent(textEvent('ซื้อ NOTEXIST 1 หุ้น ราคา 10'));

    expect(lastReplyText()).toContain('ไม่รู้จักสินทรัพย์นี้');
  });

  test('(f) SEC ล่ม/ไม่ config ตอนค้นกองทุน → Fail Isolated (ปล่อยผ่านเป็น unknown asset ไม่ Crash)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'K-SELECT', quantity: 1, pricePerUnit: 10 },
    });
    mutualFundService.resolveFundForBuy.mockRejectedValue(
      Object.assign(new Error('nc'), { code: 'SEC_NOT_CONFIGURED' })
    );
    const err = new Error('unknown');
    err.code = 'VALIDATION_ERROR';
    pendingService.createPending.mockRejectedValue(err);

    await handleEvent(textEvent('ซื้อ K-SELECT 1 หุ้น ราคา 10'));

    expect(lastReplyText()).toContain('ไม่รู้จักสินทรัพย์นี้');
  });

  test('Postback fund_buy: FUND_CLASS_NOT_FOUND → แปลเป็นข้อความไทย', async () => {
    const err = new Error('nf');
    err.code = 'FUND_CLASS_NOT_FOUND';
    mutualFundService.getFundClass.mockRejectedValue(err);

    await handleEvent(postbackEvent('action=fund_buy&projId=M0001&class=X&amt=1000'));

    const reply = lastReplyText();
    expect(reply).toContain('ไม่พบชนิดหน่วยลงทุน');
    expect(reply).not.toContain('FUND_CLASS_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Export รายงาน PDF/Excel (Phase 3 Round 8)
// ═══════════════════════════════════════════════════════════════════════
describe('handleEvent — Export รายงาน (Round 8) — คำสั่ง "ส่งออกรายงาน"', () => {
  test('ไม่ใช่ Premium → reply ฟีเจอร์ Premium (resolveRange ไม่ถูกเรียก — Gate ก่อนเสมอ)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.EXPORT_REPORT,
      params: { range: 'month' },
    });
    entitlement.isPremiumActive.mockReturnValue(false);

    await handleEvent(textEvent('ส่งออกรายงาน'));

    const reply = lastReplyText();
    expect(reply).toContain('Premium');
    // CTA อัพเกรด (Reuse ปุ่มแพ็กเกจเดิม)
    expect(reply).toContain('action=request_payment&period=monthly');
    expect(reportExportService.resolveRange).not.toHaveBeenCalled();
  });

  test('Premium + Parse ได้ (month) → resolveRange แล้ว reply Quick Reply PDF/Excel + Label', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.EXPORT_REPORT,
      params: { range: 'month' },
    });
    entitlement.isPremiumActive.mockReturnValue(true);
    reportExportService.resolveRange.mockReturnValue({
      from: '2026-07-01',
      to: '2026-07-31',
      label: 'เดือนกรกฎาคม 2569',
    });

    await handleEvent(textEvent('ส่งออกรายงาน'));

    expect(reportExportService.resolveRange).toHaveBeenCalledWith({ range: 'month' });
    const reply = lastReplyText();
    expect(reply).toContain('เดือนกรกฎาคม 2569');
    expect(reply).toContain('action=export_report&format=pdf&rt=month');
    expect(reply).toContain('action=export_report&format=excel&rt=month');
  });

  test('Parse ไม่ผ่าน (invalid) → reply วิธีใช้ทันที ไม่เช็ค Premium (isPremiumActive ไม่ถูกเรียก)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.EXPORT_REPORT,
      params: { invalid: true },
    });

    await handleEvent(textEvent('ส่งออกรายงาน อาทิตย์นี้'));

    const reply = lastReplyText();
    expect(reply).toContain('ส่งออกรายงาน');
    expect(reply).toContain('ปีนี้'); // ตัวอย่างใน Help message
    expect(entitlement.isPremiumActive).not.toHaveBeenCalled();
    expect(reportExportService.resolveRange).not.toHaveBeenCalled();
  });
});

describe('handleEvent — Export รายงาน (Round 8) — Postback เลือกรูปแบบไฟล์', () => {
  const BUFFER = Buffer.from('%PDF-fake-report');

  test('ไม่ใช่ Premium (เช็คซ้ำตอน Postback) → reply Premium, generatePortfolioReport ไม่ถูกเรียก', async () => {
    entitlement.isPremiumActive.mockReturnValue(false);

    await handleEvent(postbackEvent('action=export_report&format=pdf&rt=month'));

    expect(lastReplyText()).toContain('Premium');
    expect(reportExportService.generatePortfolioReport).not.toHaveBeenCalled();
    expect(storageService.uploadReport).not.toHaveBeenCalled();
  });

  test('Premium + rt=month → Generate → uploadReport ด้วย Buffer → การ์ดดาวน์โหลด (Argument Trace ครบ)', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    reportExportService.generatePortfolioReport.mockResolvedValue({
      buffer: BUFFER,
      filename: 'EasyDCA-Report-2026-07-01_2026-07-31.pdf',
      mimeType: 'application/pdf',
    });
    reportExportService.resolveRange.mockReturnValue({
      from: '2026-07-01',
      to: '2026-07-31',
      label: 'เดือนกรกฎาคม 2569',
    });
    storageService.uploadReport.mockResolvedValue({
      path: 'user-1-123.pdf',
      signedUrl: 'https://cdn.supabase.test/reports/user-1-123.pdf?token=abc',
      expiresInSeconds: 900,
    });

    await handleEvent(postbackEvent('action=export_report&format=pdf&rt=month'));

    // ส่ง range ถูกต้องเข้า Service
    expect(reportExportService.generatePortfolioReport).toHaveBeenCalledWith(FREE_USER.id, {
      format: 'pdf',
      range: { range: 'month' },
    });
    // uploadReport รับ Buffer ที่ generate คืนมา + format ตรง
    expect(storageService.uploadReport).toHaveBeenCalledWith(FREE_USER.id, BUFFER, 'pdf');

    const reply = lastReplyText();
    // signedUrl จาก uploadReport → ปุ่มดาวน์โหลด
    expect(reply).toContain('https://cdn.supabase.test/reports/user-1-123.pdf?token=abc');
    // expiresInSeconds 900 → expiresMinutes 15 (Cross-file Trace)
    expect(reply).toContain('15 นาที');
    // rangeLabel จาก resolveRange
    expect(reply).toContain('เดือนกรกฎาคม 2569');
  });

  test('rt=custom → ถอด from/to จาก Postback แล้วส่ง range custom เข้า Service', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    reportExportService.generatePortfolioReport.mockResolvedValue({
      buffer: BUFFER,
      filename: 'r.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    reportExportService.resolveRange.mockReturnValue({
      from: '2026-01-01',
      to: '2026-06-30',
      label: '1 มกราคม 2569 - 30 มิถุนายน 2569',
    });
    storageService.uploadReport.mockResolvedValue({
      path: 'user-1-9.xlsx',
      signedUrl: 'https://cdn/reports/user-1-9.xlsx?t=z',
      expiresInSeconds: 900,
    });

    await handleEvent(
      postbackEvent('action=export_report&format=excel&rt=custom&from=2026-01-01&to=2026-06-30')
    );

    expect(reportExportService.generatePortfolioReport).toHaveBeenCalledWith(FREE_USER.id, {
      format: 'excel',
      range: { range: 'custom', from: '2026-01-01', to: '2026-06-30' },
    });
  });

  test('generatePortfolioReport throw ReportServiceError → แปลไทยเฉพาะ, uploadReport ไม่ถูกเรียก', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    reportExportService.generatePortfolioReport.mockRejectedValue(
      Object.assign(new Error('bad range'), { code: 'EXPORT_INVALID_RANGE' })
    );

    await handleEvent(postbackEvent('action=export_report&format=pdf&rt=custom&from=x&to=y'));

    const reply = lastReplyText();
    expect(reply).toContain('ช่วงเวลาที่ระบุไม่ถูกต้อง');
    expect(reply).not.toContain('EXPORT_INVALID_RANGE');
    // Generate ล้มเหลว → ไม่พยายาม Upload ต่อ
    expect(storageService.uploadReport).not.toHaveBeenCalled();
  });

  test('uploadReport throw (ไม่มี code) → แปลงเป็น EXPORT_GENERATION_FAILED ("สร้างรายงานไม่สำเร็จ") ไม่ Crash', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    reportExportService.generatePortfolioReport.mockResolvedValue({
      buffer: BUFFER,
      filename: 'r.pdf',
      mimeType: 'application/pdf',
    });
    reportExportService.resolveRange.mockReturnValue({
      from: '2026-07-01',
      to: '2026-07-31',
      label: 'เดือนกรกฎาคม 2569',
    });
    // storageService.uploadReport throw Error ธรรมดา (ไม่มี .code) — เช่น Bucket ไม่มี
    storageService.uploadReport.mockRejectedValue(new Error('bucket not found'));

    await handleEvent(postbackEvent('action=export_report&format=pdf&rt=month'));

    const reply = lastReplyText();
    expect(reply).toContain('สร้างรายงานไม่สำเร็จ');
    expect(reply).not.toContain('bucket not found'); // ไม่หลุด Error ดิบ
    expect(reply).not.toContain('เกิดข้อผิดพลาดบางอย่าง'); // ไม่ตกเป็น INTERNAL_ERROR ทั่วไป
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AI Slip OCR (Phase 3 Round 9) — Postback ยืนยัน/แก้ไข จากการ์ดที่ AI อ่านสลิป
// ═══════════════════════════════════════════════════════════════════════
describe('handleEvent — AI Slip OCR Postback (Round 9)', () => {
  test('ocr_confirm (Premium) → Route เป็นคำสั่ง BUY → createPending (Validate เดิม) → Preview', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    pendingService.createPending.mockResolvedValue({
      id: 'p-ocr', commandType: 'buy', assetSymbol: 'BTC',
      quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000, priceSource: 'user',
    });

    await handleEvent(
      postbackEvent('action=ocr_confirm&sym=BTC&side=buy&qty=0.5&price=1500000&date=2026-07-05')
    );

    // Reuse createPending เดิม (type=crypto เติมจาก symbolRegistry จริง) + date ISO ผ่านตรง
    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      expect.objectContaining({
        command: COMMANDS.BUY,
        params: expect.objectContaining({
          symbol: 'BTC',
          quantity: 0.5,
          pricePerUnit: 1500000,
          date: '2026-07-05',
        }),
      }),
      { plan: 'free' }
    );
    expect(lastReplyText()).toContain('BTC');
  });

  test('ocr_confirm (มีแต่ยอดรวม amt) → Route BUY ด้วย amountThb', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    pendingService.createPending.mockResolvedValue({
      id: 'p-ocr2', commandType: 'buy', assetSymbol: 'BTC',
      quantity: 0.0005, pricePerUnit: 2000000, amountThb: 1000, priceSource: 'coingecko',
    });

    await handleEvent(postbackEvent('action=ocr_confirm&sym=BTC&side=buy&amt=1000'));

    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      expect.objectContaining({ params: expect.objectContaining({ symbol: 'BTC', amountThb: 1000 }) }),
      { plan: 'free' }
    );
  });

  test('ocr_confirm ไม่ใช่ Premium (Plan เปลี่ยนระหว่างกดปุ่ม) → Premium required, ไม่ createPending', async () => {
    entitlement.isPremiumActive.mockReturnValue(false);

    await handleEvent(postbackEvent('action=ocr_confirm&sym=BTC&side=buy&qty=0.5&price=1500000'));

    expect(pendingService.createPending).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('Premium');
  });

  test('ocr_edit → ตอบข้อความ Prefill คำสั่งซื้อให้ Copy แก้ (เข้า Parser เดิม)', async () => {
    await handleEvent(postbackEvent('action=ocr_edit&sym=BTC&side=buy&qty=0.5&price=1500000'));
    expect(lastReplyText()).toContain('ซื้อ BTC 0.5 หุ้น ราคา 1500000');
  });

  test('ocr_edit ค่าที่ AI อ่านไม่ได้ (ไม่มี qty/price) → ใส่ <จำนวน>/<ราคา> ให้กรอกแทน', async () => {
    await handleEvent(postbackEvent('action=ocr_edit&sym=BTC&side=buy'));
    const reply = lastReplyText();
    expect(reply).toContain('<จำนวน>');
    expect(reply).toContain('<ราคา>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Manual Quantity Fallback (Round 10-B) — สลิป Amount-only ของหุ้นที่ไม่มี Price Feed
// ═══════════════════════════════════════════════════════════════════════
describe('handleEvent — Manual Quantity Fallback (Round 10-B)', () => {
  test('(c) ocr_confirm Amount-only + ไม่ใช่ Crypto + Price Feed หาไม่ได้ → ชี้ทางกรอกจำนวนหุ้นเอง (ไม่ Error ทั่วไป)', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    // EOSE ไม่อยู่ใน Registry → createPending โยน PRICE_FEED_NOT_IMPLEMENTED
    pendingService.createPending.mockRejectedValue(
      Object.assign(new Error('no feed'), { code: 'PRICE_FEED_NOT_IMPLEMENTED' })
    );

    await handleEvent(postbackEvent('action=ocr_confirm&sym=EOSE&side=buy&amt=1000&cur=USD'));

    const reply = lastReplyText();
    expect(reply).toContain('กรอกจำนวนหุ้น');
    // Prefill รูปแบบ "จำนวน + ยอดรวม" ที่ผู้ใช้เติมแค่จำนวนหุ้น
    expect(reply).toContain('ซื้อ EOSE <จำนวนหุ้น> หุ้น รวม 1000 USD');
    // ไม่ใช่ข้อความ Error PRICE_FEED เดิมที่บอกให้พิมพ์คำสั่งใหม่ทั้งหมด
    expect(reply).not.toContain('เช่น "ซื้อ PTT 50 หุ้น ราคา 34"');
  });

  test('(b) ocr_confirm Amount-only + Crypto (BTC) + Price Feed สำเร็จ → ทำงานเหมือนเดิม (Preview) ไม่ชี้ทางกรอกเอง', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    pendingService.createPending.mockResolvedValue({
      id: 'p-btc', commandType: 'buy', assetSymbol: 'BTC',
      quantity: 0.0005, pricePerUnit: 2000000, amountThb: 1000, priceSource: 'coingecko',
    });

    await handleEvent(postbackEvent('action=ocr_confirm&sym=BTC&side=buy&amt=1000'));

    const reply = lastReplyText();
    expect(reply).not.toContain('กรอกจำนวนหุ้น');
    expect(reply).toContain('BTC');
  });

  test('Crypto Amount-only ที่ Price Feed ล่ม → คง Error เดิม (ไม่ Hijack เป็น Manual Quantity)', async () => {
    entitlement.isPremiumActive.mockReturnValue(true);
    pendingService.createPending.mockRejectedValue(
      Object.assign(new Error('no feed'), { code: 'PRICE_FEED_NOT_IMPLEMENTED' })
    );

    await handleEvent(postbackEvent('action=ocr_confirm&sym=BTC&side=buy&amt=1000'));

    // BTC = crypto → ไม่เปลี่ยนเป็นการ์ดกรอกจำนวนหุ้น (Error ทั่วไปตามเดิม)
    expect(lastReplyText()).not.toContain('กรอกจำนวนหุ้น');
  });

  test('ocr_edit Amount-only + ไม่ใช่ Crypto → Prefill "จำนวน + ยอดรวม" ให้เติมแค่จำนวนหุ้น', async () => {
    await handleEvent(postbackEvent('action=ocr_edit&sym=EOSE&side=buy&amt=1000&cur=USD'));
    const reply = lastReplyText();
    expect(reply).toContain('ซื้อ EOSE <จำนวนหุ้น> หุ้น รวม 1000 USD');
    expect(reply).toContain('ยอดรวม ÷ จำนวนหุ้น');
  });

  test('ocr_edit Amount-only + Crypto (BTC) → คง Prefill จำนวนเงินเดิม (มี Price Feed อยู่แล้ว)', async () => {
    await handleEvent(postbackEvent('action=ocr_edit&sym=BTC&side=buy&amt=1000'));
    const reply = lastReplyText();
    expect(reply).toContain('ซื้อ BTC 1000');
    expect(reply).not.toContain('รวม');
  });

  // ── Round 10-B.1: เดา type จากสกุลเงินเมื่อ Registry ไม่รู้จัก Symbol ─────────
  // ⚠️ ทั้ง 3 Test ด้านล่างใช้ "ZZZ" เป็น Symbol จำลองที่ "ไม่มีทางอยู่ใน symbolRegistry
  // จริง" โดยเจตนา (Pattern เดียวกับ priceFeed.service.test.js) — เดิมใช้ EOSE/OKLO
  // ซึ่งเป็นหุ้นจริง แล้วภายหลังถูกเพิ่มเข้า Registry (แก้ Bug ราคาไม่ขึ้นบน Dashboard)
  // ทำให้ Premise "Symbol ไม่รู้จัก" ของ Test พังไปด้วย ต้องเปลี่ยนมาใช้ Symbol ปลอมที่
  // ไม่ผูกกับหุ้นจริงตัวใดเลย กัน Regression ซ้ำถ้ามีใครเพิ่มหุ้นตัวใหม่เข้า Registry อีก
  test('(หลัก) Manual Quantity + Symbol ไม่รู้จัก + USD → createPending ได้รับ type:stock_us (ไม่ VALIDATION_ERROR)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ZZZ', quantity: 8, amountThb: 30.43, currency: 'USD' },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'p-zzz', commandType: 'buy', assetSymbol: 'ZZZ',
      quantity: 8, pricePerUnit: 3.80375, amountThb: 30.43, currency: 'USD', priceSource: 'user',
    });

    await handleEvent(textEvent('ซื้อ ZZZ 8 หุ้น รวม 30.43 USD'));

    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      {
        command: COMMANDS.BUY,
        params: { symbol: 'ZZZ', quantity: 8, amountThb: 30.43, currency: 'USD', type: 'stock_us' },
      },
      { plan: 'free' }
    );
    const reply = lastReplyText();
    expect(reply).not.toContain('ไม่รู้จักสินทรัพย์');
    expect(reply).toContain('ZZZ');
  });

  test('Manual Quantity + Symbol ไม่รู้จัก + THB (ไม่มี currency) → type:stock_th', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ZZZ', quantity: 5, amountThb: 250 },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'p-zzz', commandType: 'buy', assetSymbol: 'ZZZ',
      quantity: 5, pricePerUnit: 50, amountThb: 250, priceSource: 'user',
    });

    await handleEvent(textEvent('ซื้อ ZZZ 5 หุ้น รวม 250'));

    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      { command: COMMANDS.BUY, params: { symbol: 'ZZZ', quantity: 5, amountThb: 250, type: 'stock_th' } },
      { plan: 'free' }
    );
  });

  test('Regression: รูปแบบ "ราคา" (มี pricePerUnit) + Symbol ไม่รู้จัก → ไม่เดา type (คง Guard เดิม)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ZZZ', quantity: 8, pricePerUnit: 3.8, currency: 'USD' },
    });
    const err = new Error('Creating a new asset requires an asset type');
    err.code = 'VALIDATION_ERROR';
    pendingService.createPending.mockRejectedValue(err);

    await handleEvent(textEvent('ซื้อ ZZZ 8 หุ้น ราคา 3.8 usd'));

    // ไม่มี amountThb → ไม่เข้าเงื่อนไข Round 10-B.1 → ส่ง params เดิมโดยไม่มี type
    expect(pendingService.createPending).toHaveBeenCalledWith(
      FREE_USER.id,
      { command: COMMANDS.BUY, params: { symbol: 'ZZZ', quantity: 8, pricePerUnit: 3.8, currency: 'USD' } },
      { plan: 'free' }
    );
    expect(lastReplyText()).toContain('ไม่รู้จักสินทรัพย์');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S8 R2 รอบ 1 — Fallback Quick Reply Menu
// ═══════════════════════════════════════════════════════════════════════
// ครอบคลุม 4 การรับประกันของ DoD:
//   1. Fallback ทำงานเฉพาะตอน Parse ไม่ออก + ไม่มี Session ค้าง
//   2. Expert Path (คำสั่งพิมพ์ตรง) ไม่ถูกกระทบเลย
//   3. PDPA Gate ยังทำงาน "ก่อน" Fallback เสมอ
//   4. Session Flow เดิม (Reminder Setup / Bulk Import) ไม่ถูกแย่ง
describe('handleEvent — Fallback Quick Reply Menu (S8 R2 รอบ 1)', () => {
  // ดึง quickReply items ของข้อความล่าสุดออกมาตรวจโครงสร้างจริง (ไม่ใช่แค่ substring)
  function lastQuickReplyItems() {
    const call = lineService.replyMessage.mock.calls.at(-1);
    return call[1]?.quickReply?.items ?? [];
  }

  // ── 1. Fallback ทำงานเฉพาะกรณีที่ควร ──────────────────────────────────
  test('ข้อความมั่ว (Parse ไม่ออก) + ไม่มี Session ค้าง → Quick Reply Menu ครบ 4 ปุ่ม', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('สวัสดีครับ อยากลงทุน'));

    const items = lastQuickReplyItems();
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.action.label)).toEqual([
      '📈 บันทึก DCA',
      '💰 ดูพอร์ต',
      '🔔 ตั้งเตือน DCA',
      '❓ วิธีใช้งาน',
    ]);
    // ต้องไม่ใช่การ์ด "ไม่เข้าใจคำสั่ง" ทางตันเดิมอีกต่อไป
    expect(lastReplyText()).not.toContain('ไม่เข้าใจคำสั่งนี้');
  });

  test('ปุ่ม "ดูพอร์ต" ใช้ message("พอต") — Reuse Command Parser เดิม ไม่สร้าง Handler ใหม่', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('อะไรก็ไม่รู้'));

    const portfolioBtn = lastQuickReplyItems().find((i) => i.action.label === '💰 ดูพอร์ต');
    expect(portfolioBtn.action).toMatchObject({ type: 'message', text: 'พอต' });
  });

  test('ปุ่ม "ตั้งเตือน DCA" Reuse action เดิม (start_reminder_setup) ไม่ใช่ action ใหม่', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('xxxx'));

    const btn = lastQuickReplyItems().find((i) => i.action.label === '🔔 ตั้งเตือน DCA');
    expect(btn.action).toMatchObject({ type: 'postback', data: 'action=start_reminder_setup' });
  });

  test('ห้ามมีปุ่ม "ยกเลิก" ของ Flow ตั้งเตือน (cancel_reminder_setup) หลุดมาในเมนูทั่วไป', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('มั่วๆ'));

    expect(JSON.stringify(lastQuickReplyItems())).not.toContain('cancel_reminder_setup');
  });

  // ── 2. Expert Path ต้องไม่ถูกกระทบ ────────────────────────────────────
  test('Expert Path: พิมพ์ "พอต" (Parse ออก) → ทำงานปกติ ไม่ผ่าน Fallback เลย', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.PORTFOLIO, params: {} });
    portfolioService.getPortfolioSummary.mockResolvedValue({ isEmpty: true, holdings: [] });

    await handleEvent(textEvent('พอต'));

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith(FREE_USER.id);
    expect(lastQuickReplyItems()).toHaveLength(0); // ไม่ใช่ Fallback Menu
  });

  test('Expert Path: "ซื้อ BTC 1000" (Parse ออก) → เข้า createPending ตามปกติ ไม่โดน Fallback', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', amountThb: 1000 },
    });
    pendingService.createPending.mockResolvedValue({
      id: 'p-1', commandType: 'buy', assetSymbol: 'BTC',
      quantity: 0.0003, pricePerUnit: 3400000, amountThb: 1000, priceSource: 'coingecko',
    });

    await handleEvent(textEvent('ซื้อ BTC 1000'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastQuickReplyItems()).toHaveLength(0);
  });

  // ── 3. PDPA Gate ต้องมาก่อนเสมอ ───────────────────────────────────────
  test('ยังไม่ Consent + พิมพ์ข้อความมั่ว → เจอ PDPA Gate ก่อน ไม่เห็น Fallback Menu', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });

    await handleEvent(textEvent('มั่วๆ'));

    expect(lastQuickReplyItems()).toHaveLength(0);
    // ต้องไม่แตะ Session ใดๆ เลย (ไม่ประมวลผลคำสั่ง)
    expect(reminderSetupFlow.getCurrentSession).not.toHaveBeenCalled();
  });

  test('ยังไม่ Consent + กดปุ่ม add_guide → เจอ PDPA Gate ก่อน ไม่เห็น Fallback Menu', async () => {
    userRepository.findByLineUserId.mockResolvedValue(NOT_CONSENTED_USER);

    await handleEvent(postbackEvent('action=add_guide'));

    expect(lastQuickReplyItems()).toHaveLength(0);
  });

  // ── 4. Session Flow เดิมต้องไม่ถูกแย่ง ─────────────────────────────────
  test('ระหว่าง Session ตั้งเตือน (AWAITING_AMOUNT) พิมพ์ตัวเลข → เข้า Flow เดิม ไม่ใช่ Fallback', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    reminderSetupFlow.getCurrentSession.mockResolvedValue({
      step: reminderSetupFlow.STEPS.AWAITING_AMOUNT,
      symbol: 'BTC',
      frequency: 'monthly',
    });
    reminderSetupFlow.handleAmountEntered.mockResolvedValue({
      symbol: 'BTC', amountThb: 1000, frequency: 'monthly', dayOfMonth: 1,
    });

    await handleEvent(textEvent('1000'));

    expect(reminderSetupFlow.handleAmountEntered).toHaveBeenCalledWith(FREE_USER.id, 1000);
    // ไม่ใช่ Fallback Menu (Flow เดิมตอบเอง)
    expect(JSON.stringify(lastQuickReplyItems())).not.toContain('action=help_guide');
  });

  test('ระหว่าง Session ตั้งเตือน พิมพ์ข้อความมั่ว (ไม่ใช่ตัวเลข) → ยังอยู่ใน Flow เดิม ไม่โดน Fallback แย่ง', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    reminderSetupFlow.getCurrentSession.mockResolvedValue({
      step: reminderSetupFlow.STEPS.AWAITING_AMOUNT,
      symbol: 'BTC',
      frequency: 'monthly',
    });
    const err = new Error('invalid amount');
    err.code = 'INVALID_AMOUNT';
    reminderSetupFlow.handleAmountEntered.mockRejectedValue(err);

    await handleEvent(textEvent('ไม่รู้'));

    // ต้องถูกส่งเข้า Flow เดิม (ให้ Flow ตัดสิน INVALID_AMOUNT เอง) ไม่ใช่ Fallback
    expect(reminderSetupFlow.handleAmountEntered).toHaveBeenCalled();
    expect(JSON.stringify(lastQuickReplyItems())).not.toContain('action=buy_guide');
  });

  test('ระหว่าง Session Bulk Import พิมพ์ Batch → เข้า previewBatch เดิม ไม่โดน Fallback แย่ง', async () => {
    commandParser.parseCommand.mockReturnValue({ command: COMMANDS.UNKNOWN, params: {} });
    bulkImportSession.getCurrentSession.mockResolvedValue({ userId: FREE_USER.id });
    bulkImportService.previewBatch.mockResolvedValue({
      ok: true, batchId: 'b-1', rows: [], totalAmountThb: 0, count: 0,
    });

    await handleEvent(textEvent('BTC 0.01 30000 3000000'));

    expect(bulkImportService.previewBatch).toHaveBeenCalled();
    expect(JSON.stringify(lastQuickReplyItems())).not.toContain('action=help_guide');
  });

  // ── ปุ่ม Rich Menu "เพิ่มรายการ" (ข้อ B) + ปุ่มย่อยในเมนู ────────────────
  test('ปุ่ม Rich Menu add_guide → Quick Reply Menu (ไม่ใช่ UNKNOWN / ไม่ใช่การ์ดสอนพิมพ์เดิม)', async () => {
    await handleEvent(postbackEvent('action=add_guide'));

    expect(lastQuickReplyItems()).toHaveLength(4);
    expect(lastReplyText()).not.toContain('ไม่เข้าใจคำสั่งนี้');
  });

  test('ปุ่ม "📈 บันทึก DCA" (buy_guide) → การ์ดสอนพิมพ์คำสั่ง ไม่วนกลับมาเป็นเมนูตัวเอง', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));

    expect(lastReplyText()).toContain('วิธีเพิ่มรายการซื้อ/ขาย');
    // ต้องไม่ใช่เมนู (กัน Loop กดแล้ววนกลับที่เดิม)
    expect(lastQuickReplyItems()).toHaveLength(0);
  });

  test('ปุ่ม "❓ วิธีใช้งาน" (help_guide) → การ์ดรวมคำสั่งพิมพ์ตรง (Expert Path ยังหาเจอ)', async () => {
    await handleEvent(postbackEvent('action=help_guide'));

    const reply = lastReplyText();
    expect(reply).toContain('วิธีใช้งาน');
    expect(reply).toContain('พอต');
    expect(reply).toContain('กำไร BTC');
    expect(reply).toContain('นำเข้าพอร์ต');
  });
});
