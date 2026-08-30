// ═══════════════════════════════════════════════════════════════════════════
// Stage 8-fix (migration 044) — LINE: "ซื้อ BTC 100" ขณะถือ BTC หลายพอร์ต
// ═══════════════════════════════════════════════════════════════════════════
// คู่แฝดของ multiBrokerLineFlow.test.js เป๊ะ ต่างกันแค่มิติที่ถาม
//
// ── ทำไมต้องมีปุ่มนี้ ──────────────────────────────────────────────────────
// ก่อนหน้านี้เส้นทาง LINE ตอบแค่ข้อความ "กรุณาใช้เว็บ" เมื่อกำกวมมิติพอร์ต ซึ่งแปลว่า
// **ผู้ใช้ Premium ที่แยกพอร์ต "ระยะสั้น/ระยะยาว" แล้วถือหุ้นตัวเดียวกันข้ามพอร์ต
// จะบันทึกหุ้นตัวนั้นผ่าน LINE ไม่ได้เลย** — ขัดกับจุดขายหลักของผลิตภัณฑ์ และ
// เป็นการลงโทษคนที่จ่ายเงินด้วยฟีเจอร์ที่เพิ่งซื้อ
//
// ── กฎ 2 ข้อที่ตีกันและต้องเป็นจริงพร้อมกัน ────────────────────────────────
//   กฎยืนข้อ 11 — กำกวมแล้วห้ามเดา (ต้องถาม)
//   กฎยืนข้อ 10 — ไม่กำกวมแล้วห้ามถาม (ห้ามเพิ่ม Latency บน Live Path)
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • ถอด branch AMBIGUOUS_ASSET_PORTFOLIO ใน buildAmbiguityPickerReply ออก
//     → เคส "ถาม 2 พอร์ต" แดง
//   • ถอด await portfoliosService.assertOwnedPortfolioId ใน decodePickedPortfolioId
//     → เคส Cross-User แดง (createPending ถูกเรียกจริงพร้อมพอร์ตของคนอื่น)
//   • ถอด `if (buy.brokerId !== undefined) p.set('broker', ...)` ใน basePickPostback
//     → เคส "ตอบพอร์ตแล้วถามโบรกต่อ" แดง (คำตอบรอบแรกหาย = วนถามไม่รู้จบ)
//   • เปลี่ยน truncateCodePoints เป็น slice() → เคสชื่อพอร์ตยาวที่มีอิโมจิแดง

jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/pendingTransaction.service');
jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/profit.service');
jest.mock('../src/services/history.service');
jest.mock('../src/services/dcaReminder.service');
jest.mock('../src/services/reminderSetupFlow.service', () => {
  const actual = jest.requireActual('../src/services/reminderSetupFlow.service');
  return { STEPS: actual.STEPS, getCurrentSession: jest.fn(), cancelFlow: jest.fn() };
});
jest.mock('../src/services/guidedBuyFlow.service', () => {
  const actual = jest.requireActual('../src/services/guidedBuyFlow.service');
  return {
    STEPS: actual.STEPS,
    GuidedBuyError: actual.GuidedBuyError,
    getCurrentSession: jest.fn(),
    cancelFlow: jest.fn(),
  };
});
jest.mock('../src/services/line.service');
jest.mock('../src/services/storage.service');
jest.mock('../src/services/payment.service');
jest.mock('../src/services/userErasure.service');
jest.mock('../src/services/bulkImportSession.service');
jest.mock('../src/services/bulkImport.service');
jest.mock('../src/services/reportExport.service');
jest.mock('../src/services/slipOcr.service');
jest.mock('../src/services/mutualFund.service');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/broker.repository');
// ⚠️ Mock เฉพาะ "Repository" ของพอร์ต — คง portfolios.service ตัวจริงไว้เสมอ เพราะ
// assertOwnedPortfolioId คือด่านกัน Cross-User ที่ไฟล์นี้ต้องพิสูจน์ว่าทำงานจริง
// (ถ้า Mock Service ทั้งก้อน เทสต์จะพิสูจน์แค่ว่า "เราเรียกฟังก์ชันชื่อนี้" เท่านั้น
// — บทเรียนข้อ 3 ของ POSTMORTEM_PORTFOLIO_RESOLUTION)
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/lineWebhookEvent.repository');
jest.mock('../src/services/commandParser.service', () => {
  const actual = jest.requireActual('../src/services/commandParser.service');
  return { COMMANDS: actual.COMMANDS, normalizeText: actual.normalizeText, parseCommand: jest.fn() };
});

const userRepository = require('../src/repositories/user.repository');
const pendingService = require('../src/services/pendingTransaction.service');
const profitService = require('../src/services/profit.service');
const reminderSetupFlow = require('../src/services/reminderSetupFlow.service');
const guidedBuyFlow = require('../src/services/guidedBuyFlow.service');
const lineService = require('../src/services/line.service');
const bulkImportSession = require('../src/services/bulkImportSession.service');
const assetRepository = require('../src/repositories/asset.repository');
const brokerRepository = require('../src/repositories/broker.repository');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');
const commandParser = require('../src/services/commandParser.service');
const { handleEvent } = require('../src/controllers/webhook.controller');

const { COMMANDS } = commandParser;

const USER = {
  id: 'user-1',
  lineUserId: 'U123',
  plan: 'premium',
  planExpiresAt: '2099-01-01T00:00:00.000Z',
  pdpaConsentedAt: '2026-07-01T00:00:00.000Z',
};

const P_LONG = { id: 'pf-aaaa-1111', userId: USER.id, name: 'ระยะยาว', isDefault: true, createdAt: '2026-01-01' };
const P_SHORT = { id: 'pf-bbbb-2222', userId: USER.id, name: 'ระยะสั้น', isDefault: false, createdAt: '2026-02-01' };
// พอร์ตของผู้ใช้คนอื่น — มีอยู่จริงในระบบ แต่ findByIdForUser จะคืน null ให้ USER นี้
const P_OF_OTHER_USER = 'pf-zzzz-9999';

const BROKER_A = { id: 'broker-aaaa-1111', userId: USER.id, name: 'Bitkub' };
const BROKER_B = { id: 'broker-bbbb-2222', userId: USER.id, name: 'Binance' };

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

function lastReply() {
  return lineService.replyMessage.mock.calls.at(-1)[1];
}

function ambiguousPortfolioError(candidates) {
  const err = new Error('ambiguous portfolio');
  err.code = 'AMBIGUOUS_ASSET_PORTFOLIO';
  err.details = { symbol: 'BTC', candidates };
  return err;
}

function ambiguousBrokerError(candidates) {
  const err = new Error('ambiguous broker');
  err.code = 'AMBIGUOUS_ASSET_BROKER';
  err.details = { symbol: 'BTC', candidates };
  return err;
}

const TWO_PORTFOLIOS = [
  { assetId: 'asset-btc-long', portfolioId: P_LONG.id, brokerId: null },
  { assetId: 'asset-btc-short', portfolioId: P_SHORT.id, brokerId: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findByLineUserId.mockResolvedValue(USER);
  lineService.replyMessage.mockResolvedValue(undefined);
  lineService.getProfile.mockResolvedValue(null);
  reminderSetupFlow.getCurrentSession.mockResolvedValue(null);
  bulkImportSession.getCurrentSession.mockResolvedValue(null);
  guidedBuyFlow.getCurrentSession.mockResolvedValue(null);
  assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
  lineWebhookEventRepository.claimEvent.mockResolvedValue(true);

  // ⚠️ Default โบรกเดียวโดยเจตนา — ไฟล์นี้ทดสอบ "ตัวถามพอร์ต" เป็นหลัก ถ้า Default
  // เป็น 2 โบรก ตัวถามโบรกเชิงรุก (buildBuyBrokerChoiceReply, Wire ก่อนตัวถามพอร์ต
  // เสมอ) จะดักคำสั่งซื้อ Premium ก่อนถึงตัวถามพอร์ตในแทบทุกเทสต์ของไฟล์นี้ — เทสต์
  // ที่ต้องการ 2 โบรกจริงๆ (กำกวมทั้งสองมิติ) Override เป็นรายเทสต์เองแล้ว
  brokerRepository.findAllByUser.mockResolvedValue([BROKER_A]);
  brokerRepository.findByIdForUser.mockImplementation(async (brokerId, userId) => {
    if (userId !== USER.id) return null;
    return [BROKER_A, BROKER_B].find((b) => b.id === brokerId) ?? null;
  });

  portfolioRepository.findAllByUser.mockResolvedValue([P_LONG, P_SHORT]);
  portfolioRepository.findByIdForUser.mockImplementation(async (portfolioId, userId) => {
    if (userId !== USER.id) return null;
    return [P_LONG, P_SHORT].find((p) => p.id === portfolioId) ?? null;
  });

  pendingService.createPending.mockResolvedValue({
    id: 'pending-1',
    commandType: 'buy',
    assetSymbol: 'BTC',
    quantity: 1,
    pricePerUnit: 100,
    amountThb: 100,
    txnDate: '2026-08-27',
  });

  commandParser.parseCommand.mockReturnValue({
    command: COMMANDS.BUY,
    params: { symbol: 'BTC', amountThb: 100 },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ คำสั่งกำกวมมิติพอร์ต → ถามกลับด้วยปุ่ม (ไม่ใช่บอกให้ไปใช้เว็บ)', () => {
  beforeEach(() => {
    pendingService.createPending.mockRejectedValue(ambiguousPortfolioError(TWO_PORTFOLIOS));
  });

  test('⭐ ถือ BTC 2 พอร์ต → ตอบ Quick Reply ให้เลือกพอร์ต (ไม่บันทึก ไม่เดา)', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    const reply = lastReply();
    expect(reply.type).toBe('text');
    expect(reply.quickReply.items).toHaveLength(2);
    expect(reply.quickReply.items.map((i) => i.action.label)).toEqual(['ระยะยาว', 'ระยะสั้น']);
    expect(reply.text).toContain('BTC');
  });

  test('Postback พกคำสั่งเดิม (action/cmd/sym/pf/amt) ไปครบ — ไม่ต้องมี Session ใหม่', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    const data = new URLSearchParams(lastReply().quickReply.items[1].action.data);
    expect(data.get('action')).toBe('pick_portfolio');
    expect(data.get('cmd')).toBe('buy');
    expect(data.get('sym')).toBe('BTC');
    expect(data.get('pf')).toBe(P_SHORT.id);
    expect(data.get('amt')).toBe('100');
  });

  // ⚠️ candidates เป็นรายการ "แถวสินทรัพย์" ไม่ใช่รายการพอร์ต — ถือ BTC ที่ 2 โบรก
  // ในพอร์ตเดียวกันจะได้ 2 แถวที่ portfolioId เท่ากัน ถ้าไม่ยุบจะเห็นปุ่มชื่อซ้ำกัน
  test('ยุบพอร์ตซ้ำก่อนสร้างปุ่ม — 3 แถวใน 2 พอร์ต ต้องได้ 2 ปุ่ม', async () => {
    pendingService.createPending.mockRejectedValue(
      ambiguousPortfolioError([
        { assetId: 'a1', portfolioId: P_LONG.id, brokerId: BROKER_A.id },
        { assetId: 'a2', portfolioId: P_LONG.id, brokerId: BROKER_B.id },
        { assetId: 'a3', portfolioId: P_SHORT.id, brokerId: BROKER_A.id },
      ])
    );

    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(lastReply().quickReply.items).toHaveLength(2);
  });

  // ประกอบปุ่มไม่ได้ → ห้ามตอบปุ่มว่างที่กดแล้ววนที่เดิม ต้อง Re-throw เป็นข้อความไทย
  //
  // ⚠️ ใช้คำสั่ง **ขาย** โดยเจตนา — ตั้งแต่มติ 27 ส.ค. 2569 ฝั่ง "ซื้อ" ถูกถามพอร์ต
  // ตั้งแต่ก่อน createPending จึงไม่มีวันเดินมาถึงเส้นทาง AMBIGUOUS_ASSET_PORTFOLIO
  // อีกแล้ว · เส้นทางนั้นเหลือไว้ให้ ขาย/ดูกำไร ซึ่งยังใช้เกณฑ์ "Symbol กำกวม" เดิม
  test('เหลือพอร์ตเดียวหลังยุบซ้ำ (คำสั่งขาย) → ตอบเป็นข้อความ ไม่ใช่ปุ่มที่กดไม่ได้', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SELL,
      params: { symbol: 'BTC', quantity: 1, pricePerUnit: 150 },
    });
    pendingService.createPending.mockRejectedValue(
      ambiguousPortfolioError([
        { assetId: 'a1', portfolioId: P_LONG.id, brokerId: BROKER_A.id },
        { assetId: 'a2', portfolioId: P_LONG.id, brokerId: BROKER_B.id },
      ])
    );

    await handleEvent(textEvent('ขาย BTC 1 ที่ 150'));

    expect(lastReply().quickReply).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ ผู้ใช้กดปุ่มเลือกพอร์ต → เล่นคำสั่งเดิมซ้ำ', () => {
  test('⭐ กดปุ่ม → createPending ถูกเรียกพร้อม portfolioId ที่เลือก', async () => {
    await handleEvent(
      postbackEvent(`action=pick_portfolio&cmd=buy&sym=BTC&pf=${P_SHORT.id}&amt=100`)
    );

    expect(pendingService.createPending).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        params: expect.objectContaining({ symbol: 'BTC', portfolioId: P_SHORT.id }),
      }),
      expect.anything()
    );
  });

  // ⚠️ 'none' = "ตอบแล้วว่าไม่มีพอร์ต" (null) ไม่ใช่ "ยังไม่ได้ถาม" (undefined)
  // ถ้าแปลงผิดจะวนถามซ้ำไม่รู้จบ — เคสของแถวที่ portfolio_id IS NULL (โลกก่อน 044)
  test("pf=none → portfolioId เป็น null ไม่ใช่ undefined", async () => {
    await handleEvent(postbackEvent('action=pick_portfolio&cmd=buy&sym=BTC&pf=none&amt=100'));

    const params = pendingService.createPending.mock.calls[0][1].params;
    expect(params.portfolioId).toBeNull();
  });

  // ⚠️ ไม่มี Key 'pf' เลย = ยังไม่เคยถูกถาม → ต้องเป็น undefined เพื่อให้
  // resolveOwnedAsset "ไม่กรองมิติพอร์ต" (ถ้าเป็น null จะหาสินทรัพย์ไม่เจอหลัง 044)
  //
  // ⚠️ ใช้คำสั่ง **ขาย** โดยเจตนา — ฝั่งซื้อจะถูกถามพอร์ตก่อนเสมอเมื่อมี > 1 พอร์ต
  // (ดูเคสถัดไป) จึงไม่มีทางส่ง portfolioId = undefined เข้า createPending ได้อีก
  test('ไม่มี Key pf (มาจากปุ่มเลือกโบรกล้วน, คำสั่งขาย) → portfolioId เป็น undefined', async () => {
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=sell&sym=BTC&broker=${BROKER_A.id}&qty=1&price=150`)
    );

    const params = pendingService.createPending.mock.calls[0][1].params;
    expect(params.portfolioId).toBeUndefined();
  });

  // ⭐ ตอบโบรกแล้วแต่ยังไม่ได้ตอบพอร์ต + เป็นคำสั่ง "ซื้อ" → ต้องถามพอร์ตต่อ
  // และคำตอบเรื่องโบรกของรอบก่อนต้องไม่หาย (ไม่งั้นวนถามโบรกซ้ำไม่รู้จบ)
  test('⭐ ปุ่มโบรกล้วน + คำสั่งซื้อ → ถามพอร์ตต่อ พร้อมพก broker ของรอบก่อนไปด้วย', async () => {
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=buy&sym=BTC&broker=${BROKER_A.id}&amt=100`)
    );

    expect(pendingService.createPending).not.toHaveBeenCalled();
    const data = new URLSearchParams(lastReply().quickReply.items[0].action.data);
    expect(data.get('action')).toBe('pick_portfolio');
    expect(data.get('broker')).toBe(BROKER_A.id);
  });

  test('cmd=sell → เล่นคำสั่งขายซ้ำพร้อมพอร์ตที่เลือก', async () => {
    await handleEvent(
      postbackEvent(`action=pick_portfolio&cmd=sell&sym=BTC&pf=${P_LONG.id}&qty=2&price=150`)
    );

    expect(pendingService.createPending).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        command: COMMANDS.SELL,
        params: expect.objectContaining({ portfolioId: P_LONG.id, quantity: 2, pricePerUnit: 150 }),
      }),
      expect.anything()
    );
  });

  test('cmd=profit → เรียก getAssetProfit พร้อม portfolioId (ไม่ผ่าน Pending)', async () => {
    profitService.getAssetProfit.mockResolvedValue({
      symbol: 'BTC',
      quantity: 1,
      currentValue: 100,
      profitLoss: 0,
      profitLossPercent: 0,
    });

    await handleEvent(postbackEvent(`action=pick_portfolio&cmd=profit&sym=BTC&pf=${P_LONG.id}`));

    // brokerId ยังไม่ถูกถาม → undefined (ไม่กรองมิติโบรก) ไม่ใช่ null
    expect(profitService.getAssetProfit).toHaveBeenCalledWith(
      USER.id,
      'BTC',
      P_LONG.id,
      {},
      undefined
    );
    expect(pendingService.createPending).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 Cross-User — portfolioId จาก Postback ต้องยืนยันเจ้าของก่อนใช้เสมอ', () => {
  // กฎยืนข้อ 4: id ทุกตัวจาก Request ต้องยืนยันเจ้าของก่อนใช้ แม้จะมาจากปุ่มที่
  // ระบบสร้างเอง — Postback แก้ได้ 100% จากฝั่ง Client
  test('⚠️ กดปุ่มที่พกพอร์ตของผู้ใช้คนอื่น → ต้องไม่บันทึกอะไรเลย', async () => {
    await handleEvent(
      postbackEvent(`action=pick_portfolio&cmd=buy&sym=BTC&pf=${P_OF_OTHER_USER}&amt=100`)
    );

    expect(pendingService.createPending).not.toHaveBeenCalled();
  });

  test('⚠️ พอร์ตของคนอื่นที่พกมาในปุ่มเลือกโบรก ก็ต้องถูกดักเหมือนกัน', async () => {
    await handleEvent(
      postbackEvent(
        `action=pick_broker&cmd=buy&sym=BTC&broker=${BROKER_A.id}&pf=${P_OF_OTHER_USER}&amt=100`
      )
    );

    expect(pendingService.createPending).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ กำกวมทั้งสองมิติ — คำตอบรอบแรกต้องไม่หายระหว่างทาง', () => {
  // 2 พอร์ต × 2 โบรก: ถามพอร์ตก่อน (มิติหยาบกว่า) แล้วค่อยถามโบรก
  // ถ้าปุ่มรอบที่ 2 ไม่พก pf ไปด้วย ระบบจะลืมว่าผู้ใช้ตอบพอร์ตไปแล้ว → วนถามซ้ำ
  test('⭐ ตอบพอร์ตแล้วยังกำกวมโบรก → ปุ่มโบรกต้องพก pf ของรอบแรกไปด้วย', async () => {
    pendingService.createPending.mockRejectedValue(
      ambiguousBrokerError([
        { assetId: 'a1', brokerId: BROKER_A.id },
        { assetId: 'a2', brokerId: BROKER_B.id },
      ])
    );

    await handleEvent(
      postbackEvent(`action=pick_portfolio&cmd=buy&sym=BTC&pf=${P_SHORT.id}&amt=100`)
    );

    const reply = lastReply();
    expect(reply.quickReply.items).toHaveLength(2);
    const data = new URLSearchParams(reply.quickReply.items[0].action.data);
    expect(data.get('action')).toBe('pick_broker');
    expect(data.get('broker')).toBe(BROKER_A.id);
    // ⭐ คำตอบของรอบแรกต้องยังอยู่
    expect(data.get('pf')).toBe(P_SHORT.id);
  });

  test('ตอบโบรกแล้วยังกำกวมพอร์ต → ปุ่มพอร์ตต้องพก broker ของรอบแรกไปด้วย', async () => {
    pendingService.createPending.mockRejectedValue(ambiguousPortfolioError(TWO_PORTFOLIOS));

    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=buy&sym=BTC&broker=${BROKER_B.id}&amt=100`)
    );

    const data = new URLSearchParams(lastReply().quickReply.items[0].action.data);
    expect(data.get('action')).toBe('pick_portfolio');
    expect(data.get('pf')).toBe(P_LONG.id);
    expect(data.get('broker')).toBe(BROKER_B.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ มติ Founder 27 ส.ค. 2569 — เกณฑ์การถามพอร์ตของฝั่ง "ซื้อ"
// ═══════════════════════════════════════════════════════════════════════════
// เกณฑ์เปลี่ยนจาก "Symbol กำกวม" เป็น **"ผู้ใช้มีกี่พอร์ต"** เฉพาะฝั่งซื้อ
//   ซื้อ → ถามเมื่อผู้ใช้มี > 1 พอร์ต (ปลายทางเป็น "ทางเลือก" ของผู้ใช้เสมอ)
//   ขาย → ถามเมื่อ Symbol อยู่หลายพอร์ต (ปลายทางถูกกำหนดโดย "ข้อเท็จจริง")
//
// ⚠️ ความไม่สมมาตรนี้ **ตั้งใจ** — ห้าม "แก้ให้เหมือนกัน"
describe('⭐ กฎยืนข้อ 10 — ผู้ใช้พอร์ตเดียว (Free แทบทั้งหมด) ต้องไม่ถูกถามอะไรเลย', () => {
  // ⭐⭐ เคสสำคัญที่สุดของไฟล์นี้ในเชิงผลกระทบ — Free คือผู้ใช้ส่วนใหญ่ของระบบวันนี้
  // พลาดข้อนี้ = เพิ่มขั้นตอนให้คนทั้งฐานโดยไม่มีใครได้ประโยชน์
  beforeEach(() => {
    portfolioRepository.findAllByUser.mockResolvedValue([P_LONG]);
    userRepository.findByLineUserId.mockResolvedValue({
      ...USER,
      plan: 'free',
      planExpiresAt: null,
    });
  });

  test('⭐ Free (พอร์ตเดียว) ซื้อผ่าน LINE → บันทึกตรง ไม่มีปุ่มเลือกพอร์ตเลย', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_portfolio');
  });

  test('⭐ Free (พอร์ตเดียว) ซื้อ Symbol ที่ยังไม่เคยถือ → ก็ยังไม่ถาม', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ETH', amountThb: 100 },
    });

    await handleEvent(textEvent('ซื้อ ETH 100'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_portfolio');
  });

  test('⭐ Free (พอร์ตเดียว) ขาย → ไม่ถามเช่นกัน', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SELL,
      params: { symbol: 'BTC', quantity: 1, pricePerUnit: 150 },
    });

    await handleEvent(textEvent('ขาย BTC 1 ที่ 150'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_portfolio');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ ฝั่งซื้อ: มีหลายพอร์ต → ถามเสมอ แม้ Symbol จะไม่กำกวมเลย', () => {
  const P_RETIRE = {
    id: 'pf-cccc-3333',
    userId: USER.id,
    name: 'เกษียณ',
    isDefault: false,
    createdAt: '2026-03-01',
  };

  beforeEach(() => {
    portfolioRepository.findAllByUser.mockResolvedValue([P_LONG, P_SHORT, P_RETIRE]);
    // ⚠️ ต้องอัปเดตด่านยืนยันเจ้าของให้รู้จักพอร์ตที่ 3 ด้วย ไม่งั้นเคส "ตอบพอร์ตแล้ว"
    // จะเขียวเพราะโดน PORTFOLIO_NOT_FOUND ปัดตก ไม่ใช่เพราะ Flow ทำงานถูก
    portfolioRepository.findByIdForUser.mockImplementation(async (portfolioId, userId) => {
      if (userId !== USER.id) return null;
      return [P_LONG, P_SHORT, P_RETIRE].find((p) => p.id === portfolioId) ?? null;
    });
  });

  // ⭐⭐ เคสนี้คือ Silent Default ตัวสุดท้ายที่เหลืออยู่ก่อนมติข้อนี้ —
  // เดิมโค้ดลง "พอร์ต Default" ให้เงียบๆ ทั้งที่ผู้ใช้มีสิทธิ์เลือก (กฎยืนข้อ 11)
  test('⭐ ซื้อ Symbol ที่ "ยังไม่เคยถือเลย" → ต้องถาม ห้ามลงพอร์ต Default เงียบๆ', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ETH', amountThb: 100 },
    });

    await handleEvent(textEvent('ซื้อ ETH 100'));

    const reply = lastReply();
    expect(reply.quickReply.items).toHaveLength(3);
    expect(new URLSearchParams(reply.quickReply.items[0].action.data).get('action')).toBe(
      'pick_portfolio'
    );
    // ⭐ ยังไม่มีอะไรถูกเขียนลง DB เลยจนกว่าผู้ใช้จะตอบ
    expect(pendingService.createPending).not.toHaveBeenCalled();
    expect(assetRepository.create).not.toHaveBeenCalled();
  });

  // ข้อความต้องไม่โกหก — Symbol ใหม่เอี่ยม ห้ามเขียนว่า "คุณถืออยู่มากกว่า 1 พอร์ต"
  test('ข้อความของเคส "ทางเลือก" ต้องไม่อ้างว่าผู้ใช้ถือ Symbol นั้นอยู่หลายพอร์ต', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ETH', amountThb: 100 },
    });

    await handleEvent(textEvent('ซื้อ ETH 100'));

    expect(lastReply().text).not.toContain('คุณถือ ETH อยู่มากกว่า 1 พอร์ต');
    expect(lastReply().text).toContain('เลือกพอร์ต');
  });

  test('ซื้อ Symbol ที่ถืออยู่ในพอร์ตเดียว → ก็ยังต้องถาม (เป็นทางเลือก ไม่ใช่ความกำกวม)', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(pendingService.createPending).not.toHaveBeenCalled();
    expect(lastReply().quickReply.items).toHaveLength(3);
  });

  // ⚠️ ห้ามมีปุ่ม "สร้างพอร์ตใหม่" — สร้างพอร์ตทำได้บน Dashboard เท่านั้น
  test('⚠️ ห้ามมีปุ่มสร้างพอร์ตใหม่ใน Quick Reply + ต้องชี้ทางไปหน้าเว็บ', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    const reply = lastReply();
    const actions = reply.quickReply.items.map((i) => i.action.data ?? '');
    expect(actions.every((d) => d.includes('action=pick_portfolio'))).toBe(true);
    expect(actions.some((d) => d.includes('create_portfolio'))).toBe(false);
    expect(reply.text).toContain('หน้าเว็บ');
  });

  // ── ฝั่งขายต้องไม่เปลี่ยนพฤติกรรม (ความไม่สมมาตรที่ตั้งใจ) ────────────────
  test('⭐ ขาย Symbol ที่ถืออยู่พอร์ตเดียว → ไม่ถาม บันทึกตรง', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SELL,
      params: { symbol: 'BTC', quantity: 1, pricePerUnit: 150 },
    });

    await handleEvent(textEvent('ขาย BTC 1 ที่ 150'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_portfolio');
  });

  test('⭐ ขาย Symbol ที่ถืออยู่ 2 พอร์ต → ถาม (ข้อเท็จจริงบังคับ)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SELL,
      params: { symbol: 'BTC', quantity: 1, pricePerUnit: 150 },
    });
    pendingService.createPending.mockRejectedValue(ambiguousPortfolioError(TWO_PORTFOLIOS));

    await handleEvent(textEvent('ขาย BTC 1 ที่ 150'));

    expect(lastReply().quickReply.items).toHaveLength(2);
  });

  // ตอบพอร์ตแล้วห้ามถามซ้ำ (กฎยืนข้อ 10) — และห้ามยิง Query นับพอร์ตซ้ำด้วย
  test('ตอบพอร์ตแล้ว → ไม่ถามซ้ำ และเดินต่อเข้า createPending ทันที', async () => {
    await handleEvent(
      postbackEvent(`action=pick_portfolio&cmd=buy&sym=BTC&pf=${P_RETIRE.id}&amt=100`)
    );

    expect(pendingService.createPending).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        params: expect.objectContaining({ portfolioId: P_RETIRE.id }),
      }),
      expect.anything()
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('กฎยืนข้อ 5 — label ของ Quick Reply ยาวได้ ≤ 20 Unicode Code Point', () => {
  test('⚠️ ชื่อพอร์ตยาวที่มีอิโมจิ → ตัดที่ 20 จุด และห้ามได้อักขระพัง', async () => {
    const longName = `พอร์ต${'🚀'.repeat(25)}`;
    portfolioRepository.findAllByUser.mockResolvedValue([
      { ...P_LONG, name: longName },
      P_SHORT,
    ]);
    pendingService.createPending.mockRejectedValue(ambiguousPortfolioError(TWO_PORTFOLIOS));

    await handleEvent(textEvent('ซื้อ BTC 100'));

    const label = lastReply().quickReply.items[0].action.label;
    expect([...label]).toHaveLength(20);
    // slice() จะตัด Surrogate Pair ขาดกลางตัว เหลือ High Surrogate ลอยอยู่ท้ายสตริง
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // displayText ยังใช้ชื่อเต็มเสมอ (ไม่มีข้อจำกัด 20 ตัว)
    expect(lastReply().quickReply.items[0].action.displayText).toContain(longName);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 พอร์ตที่เพิ่มรายการใหม่ไม่ได้ — ต้องเห็น ไม่ใช่ถูกซ่อน', () => {
  // Free ที่เคยเป็น Premium มาก่อนจะมีพอร์ตส่วนเกินซึ่ง "อ่านได้ ขายได้ เพิ่มไม่ได้"
  // ⚠️ ซ่อนปุ่มทิ้ง = ผู้ใช้คิดว่าของหายไปจากระบบ · ติด 🔒 ให้เห็นก่อนกดแทน
  // (นี่คือ UX เท่านั้น — Gate จริงอยู่ที่ validateBuy → assertCanAddToPortfolio)
  beforeEach(() => {
    userRepository.findByLineUserId.mockResolvedValue({
      ...USER,
      plan: 'free',
      planExpiresAt: null,
    });
    pendingService.createPending.mockRejectedValue(ambiguousPortfolioError(TWO_PORTFOLIOS));
  });

  test('ซื้อ → พอร์ตส่วนเกินยังเป็นตัวเลือก แต่ติด 🔒 และมีคำอธิบาย', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    const reply = lastReply();
    const labels = reply.quickReply.items.map((i) => i.action.label);
    // P_LONG เป็น is_default → เขียนได้ · P_SHORT เป็นส่วนเกิน → ล็อก
    expect(labels[0]).toBe('ระยะยาว');
    expect(labels[1]).toBe('🔒ระยะสั้น');
    expect(reply.text).toContain('ยังขายออกได้ตามปกติ');
  });

  test('ขาย → ห้ามติด 🔒 เลย (ขายออกจากพอร์ตที่ล็อกต้องทำได้เสมอ)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.SELL,
      params: { symbol: 'BTC', quantity: 1, pricePerUnit: 150 },
    });

    await handleEvent(textEvent('ขาย BTC 1 ที่ 150'));

    const reply = lastReply();
    expect(reply.quickReply.items.map((i) => i.action.label)).toEqual(['ระยะยาว', 'ระยะสั้น']);
    expect(reply.text).not.toContain('🔒');
  });
});
