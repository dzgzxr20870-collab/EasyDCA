// ═══════════════════════════════════════════════════════════════════════════
// ตัวถาม "เลือกโบรก" เชิงรุกตอนซื้อผ่าน LINE (Premium เท่านั้น)
// ═══════════════════════════════════════════════════════════════════════════
// คู่แฝดของ portfolioPickerLineFlow.test.js (มติ Founder 27 ส.ค. 2569) เป๊ะ —
// ต่างกันมิติเดียว: **ต้องเช็คสิทธิ์ Premium เอง** เพราะโบรกไม่มีเพดาน Free
// (พอร์ตมีเพดาน Free อยู่แล้ว ตัวถามพอร์ตจึงไม่มีทางขึ้นกับ Free โดยธรรมชาติ)
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • ถอด `if (!entitlement.isPremiumActive(user)) return null;` ใน
//     buildBuyBrokerChoiceReply → เคส Free แดง (ถูกถามทั้งที่ไม่ควร)
//   • ถอด `const brokerChoice = await buildBuyBrokerChoiceReply(...)` ใน
//     routeCommand → เคส "ถามโบรกก่อน" แดงทั้งชุด
//   • สลับลำดับ Wire ให้ตัวถามพอร์ตมาก่อนตัวถามโบรก → เคส "โบรกก่อนพอร์ต" แดง

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
// ⚠️ Mock เฉพาะ "Repository" ของโบรก — คง broker.service ตัวจริงไว้เสมอ เพราะ
// assertOwnedBrokerId คือด่านกัน Cross-User ที่ต้องพิสูจน์ว่าทำงานจริง (บทเรียน
// ข้อ 3 ของ POSTMORTEM_PORTFOLIO_RESOLUTION — Mock Service ทั้งก้อนพิสูจน์ได้แค่
// ว่า "เราเรียกฟังก์ชันชื่อนี้" เท่านั้น)
jest.mock('../src/repositories/broker.repository');
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/lineWebhookEvent.repository');
jest.mock('../src/services/commandParser.service', () => {
  const actual = jest.requireActual('../src/services/commandParser.service');
  return { COMMANDS: actual.COMMANDS, normalizeText: actual.normalizeText, parseCommand: jest.fn() };
});

const userRepository = require('../src/repositories/user.repository');
const pendingService = require('../src/services/pendingTransaction.service');
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

const PREMIUM_USER = {
  id: 'user-1',
  lineUserId: 'U123',
  plan: 'premium',
  planExpiresAt: '2099-01-01T00:00:00.000Z',
  pdpaConsentedAt: '2026-07-01T00:00:00.000Z',
};

const FREE_USER = { ...PREMIUM_USER, plan: 'free', planExpiresAt: null };

const BROKER_A = { id: 'broker-aaaa-1111', userId: PREMIUM_USER.id, name: 'Bitkub' };
const BROKER_B = { id: 'broker-bbbb-2222', userId: PREMIUM_USER.id, name: 'Binance' };

// ⚠️ Default พอร์ตเดียวโดยเจตนา — ไฟล์นี้ทดสอบ "ตัวถามโบรก" เป็นหลัก ถ้า Default
// เป็น 2 พอร์ต ตัวถามพอร์ตเดิม (buildBuyPortfolioChoiceReply, Wire หลังตัวถามโบรก
// เสมอ) จะโผล่ต่อในเกือบทุกเทสต์จนกลบผลของตัวถามโบรกที่กำลังทดสอบ — เทสต์ที่ต้องการ
// พอร์ต >1 จริงๆ (ลำดับโบรก→พอร์ต) Override เป็นรายเทสต์เอง
const P_DEFAULT = { id: 'pf-aaaa-1111', userId: PREMIUM_USER.id, name: 'หลัก', isDefault: true, createdAt: '2026-01-01' };
const P_SECOND = { id: 'pf-bbbb-2222', userId: PREMIUM_USER.id, name: 'ระยะสั้น', isDefault: false, createdAt: '2026-02-01' };

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

function ambiguousBrokerError(candidates) {
  const err = new Error('ambiguous broker');
  err.code = 'AMBIGUOUS_ASSET_BROKER';
  err.details = { symbol: 'BTC', candidates };
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findByLineUserId.mockResolvedValue(PREMIUM_USER);
  lineService.replyMessage.mockResolvedValue(undefined);
  lineService.getProfile.mockResolvedValue(null);
  reminderSetupFlow.getCurrentSession.mockResolvedValue(null);
  bulkImportSession.getCurrentSession.mockResolvedValue(null);
  guidedBuyFlow.getCurrentSession.mockResolvedValue(null);
  assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
  lineWebhookEventRepository.claimEvent.mockResolvedValue(true);

  brokerRepository.findAllByUser.mockResolvedValue([BROKER_A, BROKER_B]);
  brokerRepository.findByIdForUser.mockImplementation(async (brokerId, userId) => {
    if (userId !== PREMIUM_USER.id) return null;
    return [BROKER_A, BROKER_B].find((b) => b.id === brokerId) ?? null;
  });

  portfolioRepository.findAllByUser.mockResolvedValue([P_DEFAULT]);
  portfolioRepository.findByIdForUser.mockImplementation(async (portfolioId, userId) => {
    if (userId !== PREMIUM_USER.id) return null;
    return [P_DEFAULT, P_SECOND].find((p) => p.id === portfolioId) ?? null;
  });

  pendingService.createPending.mockResolvedValue({
    id: 'pending-1',
    commandType: 'buy',
    assetSymbol: 'BTC',
    quantity: 1,
    pricePerUnit: 100,
    amountThb: 100,
    txnDate: '2026-08-30',
  });

  commandParser.parseCommand.mockReturnValue({
    command: COMMANDS.BUY,
    params: { symbol: 'BTC', amountThb: 100 },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐⭐ กฎยืนสำคัญที่สุดของไฟล์นี้ — Free ห้ามถูกถามเด็ดขาด', () => {
  // โบรกไม่มีเพดาน Free (สร้างผ่านเว็บได้กี่อันก็ได้) — ถ้าไม่เช็คสิทธิ์เอง ผู้ใช้
  // Free ที่มีโบรก >1 จะโดนถามฟีเจอร์ Premium ทั้งที่ไม่ได้จ่ายเงิน
  beforeEach(() => {
    userRepository.findByLineUserId.mockResolvedValue(FREE_USER);
  });

  test('⭐ Free มีโบรก 2 อัน → ซื้อผ่าน LINE → ไม่ถามโบรกเลย', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_broker');
  });

  test('Free มีโบรก 2 อัน + Symbol ที่ยังไม่เคยถือ → ก็ยังไม่ถาม', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'ETH', amountThb: 100 },
    });

    await handleEvent(textEvent('ซื้อ ETH 100'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_broker');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Premium แต่ไม่กำกวมมิติโบรก → ไม่ถาม ไม่มีอะไรเปลี่ยน', () => {
  test('Premium มีโบรกอันเดียว → ไม่ถาม บันทึกตรง', async () => {
    brokerRepository.findAllByUser.mockResolvedValue([BROKER_A]);

    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(pendingService.createPending).toHaveBeenCalled();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_broker');
  });

  test('Premium ไม่มีโบรกเลย → ไม่ถาม บันทึกด้วย brokerId ที่ไม่เคยถูกถามเหมือนเดิม', async () => {
    brokerRepository.findAllByUser.mockResolvedValue([]);

    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(pendingService.createPending).toHaveBeenCalled();
    // undefined = "ยังไม่เคยถูกถาม" — พฤติกรรม Silent brokerId: null เดิมที่ปลายทาง
    // ตัดสินต่อ ต้องไม่เปลี่ยนแม้แต่นิดเดียวจากฟีเจอร์นี้
    const params = pendingService.createPending.mock.calls[0][1].params;
    expect(params.brokerId).toBeUndefined();
    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_broker');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ Premium มีโบรก ≥ 2 อัน → ถามก่อนบันทึกเสมอ', () => {
  test('⭐ พิมพ์คำสั่งซื้อตรงๆ → เจอคำถามเลือกโบรกก่อน ไม่บันทึกทันที', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(pendingService.createPending).not.toHaveBeenCalled();
    const reply = lastReply();
    expect(reply.quickReply.items).toHaveLength(2);
    expect(reply.quickReply.items.map((i) => i.action.label)).toEqual(['Bitkub', 'Binance']);
    const data = new URLSearchParams(reply.quickReply.items[0].action.data);
    expect(data.get('action')).toBe('pick_broker');
    expect(data.get('cmd')).toBe('buy');
    expect(data.get('sym')).toBe('BTC');
    expect(data.get('amt')).toBe('100');
  });

  test('⭐ ตอบโบรกแล้ว (พอร์ตเดียว) → บันทึกตรงทันที ไม่ถามพอร์ตต่อ', async () => {
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=buy&sym=BTC&broker=${BROKER_A.id}&amt=100`)
    );

    expect(pendingService.createPending).toHaveBeenCalledWith(
      PREMIUM_USER.id,
      expect.objectContaining({
        params: expect.objectContaining({ symbol: 'BTC', brokerId: BROKER_A.id }),
      }),
      expect.anything()
    );
  });

  // ⭐⭐ ลำดับตาม Founder ระบุ: โบรก → พอร์ต → บันทึก
  test('⭐⭐ มีทั้งโบรก ≥2 และพอร์ต ≥2 → ถามโบรกก่อน ตอบแล้วค่อยถามพอร์ตต่อ ตอบแล้วค่อยบันทึก', async () => {
    portfolioRepository.findAllByUser.mockResolvedValue([P_DEFAULT, P_SECOND]);

    // รอบ 1: พิมพ์คำสั่งซื้อ → ต้องเจอคำถามโบรกก่อน (ไม่ใช่คำถามพอร์ต)
    await handleEvent(textEvent('ซื้อ BTC 100'));
    let reply = lastReply();
    let data = new URLSearchParams(reply.quickReply.items[0].action.data);
    expect(data.get('action')).toBe('pick_broker');
    expect(pendingService.createPending).not.toHaveBeenCalled();

    // รอบ 2: ตอบโบรกแล้ว → ต้องเจอคำถามพอร์ตต่อ (ยังไม่บันทึก) พร้อมพกคำตอบโบรกไปด้วย
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=buy&sym=BTC&broker=${BROKER_B.id}&amt=100`)
    );
    reply = lastReply();
    data = new URLSearchParams(reply.quickReply.items[0].action.data);
    expect(data.get('action')).toBe('pick_portfolio');
    expect(data.get('broker')).toBe(BROKER_B.id);
    expect(pendingService.createPending).not.toHaveBeenCalled();

    // รอบ 3: ตอบพอร์ตแล้ว → บันทึกจริง พร้อมทั้งสองมิติที่ตอบไปแล้ว
    await handleEvent(
      postbackEvent(
        `action=pick_portfolio&cmd=buy&sym=BTC&pf=${P_SECOND.id}&broker=${BROKER_B.id}&amt=100`
      )
    );
    expect(pendingService.createPending).toHaveBeenCalledWith(
      PREMIUM_USER.id,
      expect.objectContaining({
        params: expect.objectContaining({
          symbol: 'BTC',
          brokerId: BROKER_B.id,
          portfolioId: P_SECOND.id,
        }),
      }),
      expect.anything()
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ Path เดียวกันผ่านการยืนยันสลิป AI (ocr_confirm) — ต้องเหมือนเป๊ะ', () => {
  test('⭐ ยืนยันสลิปซื้อ + Premium มีโบรก ≥2 → เจอคำถามเลือกโบรกก่อนเหมือนคำสั่งพิมพ์ตรง', async () => {
    await handleEvent(
      postbackEvent('action=ocr_confirm&side=buy&sym=BTC&amt=100&date=2026-08-30')
    );

    expect(pendingService.createPending).not.toHaveBeenCalled();
    const reply = lastReply();
    const data = new URLSearchParams(reply.quickReply.items[0].action.data);
    expect(data.get('action')).toBe('pick_broker');
    expect(data.get('cmd')).toBe('buy');
    expect(data.get('sym')).toBe('BTC');
  });

  test('ยืนยันสลิปขาย + Premium มีโบรก ≥2 → ไม่ถาม (ฟีเจอร์นี้จำกัดเฉพาะฝั่งซื้อ)', async () => {
    await handleEvent(
      postbackEvent('action=ocr_confirm&side=sell&sym=BTC&qty=1&price=150&date=2026-08-30')
    );

    expect(lastReply().quickReply?.items?.[0]?.action?.data ?? '').not.toContain('pick_broker');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 Cross-check — Flow AMBIGUOUS_ASSET_BROKER เดิม (ตั้งรับ) ต้องยังทำงานถูกต้อง', () => {
  // Free ไม่ถูกเช็คด้วยตัวถามเชิงรุกใหม่เลย (คืน null ทันที) → เส้นทางเดิมที่โยน
  // AMBIGUOUS_ASSET_BROKER จาก createPending ต้องยังทำงานเหมือนก่อนมีฟีเจอร์นี้ทุกประการ
  test('Free ถือ BTC 2 โบรก (AMBIGUOUS_ASSET_BROKER) → ยังถามกลับด้วยปุ่มแบบเดิม', async () => {
    userRepository.findByLineUserId.mockResolvedValue(FREE_USER);
    pendingService.createPending.mockRejectedValue(
      ambiguousBrokerError([
        { assetId: 'a1', brokerId: BROKER_A.id },
        { assetId: 'a2', brokerId: BROKER_B.id },
      ])
    );

    await handleEvent(textEvent('ซื้อ BTC 100'));

    const reply = lastReply();
    expect(reply.quickReply.items).toHaveLength(2);
    expect(new URLSearchParams(reply.quickReply.items[0].action.data).get('action')).toBe(
      'pick_broker'
    );
  });

  // ⚠️ ตัวถามเชิงรุกนับ "โบรกที่มีอยู่ตอนนี้" เท่านั้น (brokerRepository.findAllByUser)
  // ส่วน Error กำกวมเดิมมาจาก "แถวสินทรัพย์ในอดีต" (assetResolution) ซึ่งอาจมี
  // brokerId เป็น null ปนอยู่ (โบรกถูกลบไปแล้ว, FK ON DELETE SET NULL) — เคสนี้
  // Premium เหลือโบรกจริงแค่อันเดียว (ตัวถามเชิงรุกจึงไม่ถาม, brokers.length <= 1)
  // แต่ยังมีแถวสินทรัพย์เก่าที่กำกวมมิติโบรกอยู่ → ต้องยังเจอปุ่มถามจาก Flow เดิม
  // (พิสูจน์ว่าสองจุดนี้ Complement กัน ไม่ใช่แย่งกันทำงานจนไม่มีใครถามเลย)
  test('Premium เหลือโบรกจริงอันเดียว แต่แถวสินทรัพย์เก่ากำกวม → Flow เดิมยังถามได้ปกติ', async () => {
    brokerRepository.findAllByUser.mockResolvedValue([BROKER_A]);
    pendingService.createPending.mockRejectedValue(
      ambiguousBrokerError([
        { assetId: 'a1', brokerId: null },
        { assetId: 'a2', brokerId: BROKER_A.id },
      ])
    );

    await handleEvent(textEvent('ซื้อ BTC 100'));

    const reply = lastReply();
    expect(reply.quickReply.items).toHaveLength(2);
    expect(new URLSearchParams(reply.quickReply.items[0].action.data).get('action')).toBe(
      'pick_broker'
    );
  });
});
