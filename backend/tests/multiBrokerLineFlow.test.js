// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 (migration 046) — LINE: "ซื้อ BTC 100" ขณะถือ BTC หลายโบรก
// ═══════════════════════════════════════════════════════════════════════════
// กฎยืนข้อ 11 "Silent Default เป็น Anti-pattern เสมอ" + มติ Founder (23 ส.ค. 2569):
// ยอมให้ผู้ใช้กดปุ่มเพิ่ม 1 ครั้ง ดีกว่าปล่อยให้ต้นทุนเฉลี่ยเพี้ยน
//
// แต่กฎยืนข้อ 10 ก็บอกว่า "ห้ามเพิ่ม Latency/ขั้นตอนบน Live Path โดยไม่จำเป็น"
// → **ถือโบรกเดียวต้องไม่ถูกถามเด็ดขาด** ซึ่งเป็นเคสของผู้ใช้แทบ 100% วันนี้
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • ถอด catch AMBIGUOUS_ASSET_BROKER ใน routeCommand ออก → เคส "ถาม 2 โบรก" แดง
//   • ถอด await brokerService.assertOwnedBrokerId ใน case 'pick_broker' ออก →
//     เคส "กดปุ่มที่พก brokerId ของผู้ใช้อื่น" แดง (createPending จะถูกเรียกจริง
//     พร้อม brokerId ของคนอื่น = เขียนสินทรัพย์ผูกโบรกข้ามบัญชี)
//   • เปลี่ยน `rawBroker === 'none' ? null : rawBroker` เป็นส่ง rawBroker ตรงๆ →
//     เคส "เลือกไม่ระบุโบรก" แดง

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
jest.mock('../src/repositories/portfolio.repository');
// ⚠️ Mock เฉพาะ "Repository" ของโบรก — คง broker.service ตัวจริงไว้เสมอ เพราะ
// assertOwnedBrokerId คือด่านกัน Cross-User ที่เทสต์ชุดนี้ต้องพิสูจน์ว่าทำงานจริง
// (ถ้า Mock Service ทั้งก้อน เทสต์จะพิสูจน์แค่ว่า "เราเรียกฟังก์ชันชื่อนี้" เท่านั้น)
jest.mock('../src/repositories/broker.repository');
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
const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');
const commandParser = require('../src/services/commandParser.service');
const { handleEvent } = require('../src/controllers/webhook.controller');

const { COMMANDS } = commandParser;

const USER = {
  id: 'user-1',
  lineUserId: 'U123',
  plan: 'free',
  pdpaConsentedAt: '2026-07-01T00:00:00.000Z',
};

const BROKER_A = { id: 'broker-aaaa-1111', userId: USER.id, name: 'Bitkub' };
const BROKER_B = { id: 'broker-bbbb-2222', userId: USER.id, name: 'Binance' };
// โบรกของผู้ใช้คนอื่น — มีอยู่จริงในระบบ แต่ findByIdForUser จะคืน null ให้ USER นี้
const BROKER_OF_OTHER_USER = 'broker-zzzz-9999';

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

// ข้อความที่ถูกส่งกลับไปจริง (Object ไม่ใช่ String — ต้องตรวจโครงสร้าง quickReply)
function lastReply() {
  return lineService.replyMessage.mock.calls.at(-1)[1];
}

function ambiguousError(candidates) {
  const err = new Error('ambiguous');
  err.code = 'AMBIGUOUS_ASSET_BROKER';
  err.details = { symbol: 'BTC', portfolioId: null, candidates };
  return err;
}

const TWO_CANDIDATES = [
  { assetId: 'asset-btc-a', brokerId: BROKER_A.id },
  { assetId: 'asset-btc-b', brokerId: BROKER_B.id },
];

// ⚠️ มติ Founder 27 ส.ค. 2569 — ฝั่ง "ซื้อ" ถามพอร์ตเมื่อผู้ใช้มี > 1 พอร์ต
// ไฟล์นี้จำลอง **ผู้ใช้พอร์ตเดียว** (สภาพของผู้ใช้ Free แทบทั้งหมดของระบบ) จึงต้อง
// ไม่มีการถามพอร์ตเกิดขึ้นเลย และพฤติกรรมทุกเคสในไฟล์นี้ต้องเหมือนเดิมทุกตัวอักษร
//
// ⚠️ ตั้งที่ Module Scope โดยเจตนา ไม่ใช่ใน beforeEach — `jest.clearAllMocks()`
// ล้างแค่ประวัติการเรียก (mockClear) ไม่ล้าง Implementation ค่านี้จึงอยู่ครบทุกเคส
// โดยไม่ต้องไปแทรกในทุก beforeEach ของไฟล์ (บางไฟล์มีหลายตัว)
require('../src/repositories/portfolio.repository').findAllByUser.mockResolvedValue([
  {
    id: 'pf-single-0000-4000-8000-000000000001',
    name: 'พอร์ตของฉัน',
    type: 'custom',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]);

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
  brokerRepository.findAllByUser.mockResolvedValue([BROKER_A, BROKER_B]);
  brokerRepository.findByIdForUser.mockImplementation(async (brokerId, userId) => {
    if (userId !== USER.id) return null;
    return [BROKER_A, BROKER_B].find((b) => b.id === brokerId) ?? null;
  });
  pendingService.createPending.mockResolvedValue({
    id: 'pending-1',
    commandType: 'buy',
    assetSymbol: 'BTC',
    quantity: 1,
    pricePerUnit: 100,
    amountThb: 100,
    txnDate: '2026-08-24',
  });
});

describe('คำสั่งกำกวม → ถามกลับด้วยปุ่มเลือกโบรก', () => {
  beforeEach(() => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', amountThb: 100 },
    });
  });

  test('⚠️ ถือ BTC 2 โบรก → ตอบ Quick Reply ให้เลือกโบรก (ไม่บันทึก ไม่เดา)', async () => {
    pendingService.createPending.mockRejectedValue(ambiguousError(TWO_CANDIDATES));

    await handleEvent(textEvent('ซื้อ BTC 100'));

    const reply = lastReply();
    expect(reply.type).toBe('text');
    expect(reply.quickReply.items).toHaveLength(2);
    expect(reply.quickReply.items.map((i) => i.action.label)).toEqual(['Bitkub', 'Binance']);
    expect(reply.text).toContain('BTC');
  });

  test('Postback ของปุ่มพกคำสั่งเดิม (cmd/sym/broker/amt) ไปครบ — ไม่ต้องมี Session ใหม่', async () => {
    pendingService.createPending.mockRejectedValue(ambiguousError(TWO_CANDIDATES));

    await handleEvent(textEvent('ซื้อ BTC 100'));

    const data = new URLSearchParams(lastReply().quickReply.items[1].action.data);
    expect(data.get('action')).toBe('pick_broker');
    expect(data.get('cmd')).toBe('buy');
    expect(data.get('sym')).toBe('BTC');
    expect(data.get('broker')).toBe(BROKER_B.id);
    expect(data.get('amt')).toBe('100');
  });

  // กฎยืนข้อ 5 — label ของ quickReply.items[].action ยาวได้ ≤ 20 Unicode Code Point
  test('⚠️ ชื่อโบรกยาวเกิน 20 Code Point → label ต้องถูกตัด (ไม่งั้น LINE ปฏิเสธทั้งข้อความ)', async () => {
    const longName = 'บริษัทหลักทรัพย์ อินโนเวสท์ เอกซ์ จำกัด (มหาชน)';
    brokerRepository.findAllByUser.mockResolvedValue([{ ...BROKER_A, name: longName }, BROKER_B]);
    pendingService.createPending.mockRejectedValue(ambiguousError(TWO_CANDIDATES));

    await handleEvent(textEvent('ซื้อ BTC 100'));

    const label = lastReply().quickReply.items[0].action.label;
    expect([...label]).toHaveLength(20);
    expect(longName.startsWith(label)).toBe(true);
  });

  test('แถวที่ไม่ได้ผูกโบรก → ปุ่ม "ไม่ระบุโบรก" + postback broker=none', async () => {
    pendingService.createPending.mockRejectedValue(
      ambiguousError([
        { assetId: 'asset-btc-a', brokerId: BROKER_A.id },
        { assetId: 'asset-btc-n', brokerId: null },
      ])
    );

    await handleEvent(textEvent('ซื้อ BTC 100'));

    const item = lastReply().quickReply.items[1];
    expect(item.action.label).toBe('ไม่ระบุโบรก');
    expect(new URLSearchParams(item.action.data).get('broker')).toBe('none');
  });

  // ⚠️ กฎยืนข้อ 10 — เคสของผู้ใช้แทบ 100% วันนี้ ห้ามมีขั้นตอนเพิ่มแม้แต่ขั้นเดียว
  test('⚠️ ถือโบรกเดียว → ห้ามถาม ต้องได้การ์ด Preview ตรงเหมือนเดิมทุกประการ', async () => {
    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(pendingService.createPending).toHaveBeenCalledTimes(1);
    expect(brokerRepository.findAllByUser).not.toHaveBeenCalled();
    expect(JSON.stringify(lastReply())).not.toContain('pick_broker');
  });

  test('Candidate เหลือน้อยกว่า 2 (ข้อมูลเพี้ยน) → ตอบข้อความ Error ไม่ใช่ปุ่มว่างๆ', async () => {
    pendingService.createPending.mockRejectedValue(ambiguousError([TWO_CANDIDATES[0]]));

    await handleEvent(textEvent('ซื้อ BTC 100'));

    expect(JSON.stringify(lastReply())).toContain('มากกว่า 1 ที่');
  });
});

describe('คำสั่ง "กำไร" ก็กำกวมได้เช่นกัน', () => {
  test('ถือ BTC 2 โบรก → ถามโบรกก่อน (ห้ามรวมต้นทุนข้ามโบรกให้เอง)', async () => {
    commandParser.parseCommand.mockReturnValue({
      command: COMMANDS.PROFIT,
      params: { symbol: 'BTC' },
    });
    profitService.getAssetProfit.mockRejectedValue(ambiguousError(TWO_CANDIDATES));

    await handleEvent(textEvent('กำไร BTC'));

    const data = new URLSearchParams(lastReply().quickReply.items[0].action.data);
    expect(data.get('cmd')).toBe('profit');
  });
});

describe('Postback pick_broker — เล่นคำสั่งเดิมซ้ำหลังผู้ใช้เลือกโบรก', () => {
  test('เลือกโบรกของตัวเอง → createPending ถูกเรียกพร้อม params.brokerId', async () => {
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=buy&sym=BTC&broker=${BROKER_B.id}&amt=100`)
    );

    expect(pendingService.createPending).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        command: COMMANDS.BUY,
        params: expect.objectContaining({ symbol: 'BTC', brokerId: BROKER_B.id, amountThb: 100 }),
      }),
      expect.anything()
    );
  });

  // ⚠️ เคส Cross-User หลักของ Flow ฝั่ง LINE
  test('⚠️ ปุ่มที่พก brokerId ของผู้ใช้อื่น → ต้องถูกปฏิเสธ ห้ามสร้าง Pending ใดๆ', async () => {
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=buy&sym=BTC&broker=${BROKER_OF_OTHER_USER}&amt=100`)
    );

    expect(pendingService.createPending).not.toHaveBeenCalled();
    expect(JSON.stringify(lastReply())).toContain('ไม่พบโบรก');
  });

  test('เลือก "ไม่ระบุโบรก" (broker=none) → brokerId เป็น null ไม่ใช่สตริง "none"', async () => {
    await handleEvent(postbackEvent('action=pick_broker&cmd=buy&sym=BTC&broker=none&amt=100'));

    expect(pendingService.createPending).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({ params: expect.objectContaining({ brokerId: null }) }),
      expect.anything()
    );
    // null = "ตอบแล้วว่าไม่มีโบรก" ต้องไม่ยิง Query หาโบรก
    expect(brokerRepository.findByIdForUser).not.toHaveBeenCalled();
  });

  test('คำสั่งขายทั้งหมด (all=1) → sellAll รอดข้าม Postback มาครบ', async () => {
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=sell&sym=BTC&broker=${BROKER_A.id}&all=1`)
    );

    expect(pendingService.createPending).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({
        command: COMMANDS.SELL,
        params: expect.objectContaining({ sellAll: true, brokerId: BROKER_A.id }),
      }),
      expect.anything()
    );
  });

  // ⚠️ NaN ที่หลุดเข้า resolveQuantityAndPrice จะกลายเป็นยอดเงิน NaN ลง Ledger ได้
  test('⚠️ ไม่มี price ใน Postback → ต้องไม่ใส่ pricePerUnit: NaN ลง params', async () => {
    await handleEvent(
      postbackEvent(`action=pick_broker&cmd=sell&sym=BTC&broker=${BROKER_A.id}&qty=0.5`)
    );

    const params = pendingService.createPending.mock.calls[0][1].params;
    expect(params.quantity).toBe(0.5);
    expect('pricePerUnit' in params).toBe(false);
  });

  test('cmd=profit → เรียก getAssetProfit พร้อม brokerId (ไม่ผ่าน Pending)', async () => {
    profitService.getAssetProfit.mockResolvedValue({
      symbol: 'BTC',
      quantity: 1,
      currentValue: 100,
      profitLoss: 0,
      profitLossPercent: 0,
    });

    await handleEvent(postbackEvent(`action=pick_broker&cmd=profit&sym=BTC&broker=${BROKER_A.id}`));

    // ⚠️ portfolioId ต้องเป็น **undefined** ไม่ใช่ null (Stage 8-fix รอบ 3) —
    // เดิม Handler ส่ง null แบบ Hardcode ซึ่งแปลว่า "เจาะจงว่าไม่มีพอร์ต" จึงค้นด้วย
    // portfolio_id IS NULL แล้วหลัง Apply 044 จะหาสินทรัพย์ไม่เจอเลยสักตัว
    // (ผู้ใช้ยังไม่ได้ตอบมิติพอร์ต = undefined = ไม่กรองมิตินั้น)
    expect(profitService.getAssetProfit).toHaveBeenCalledWith(
      USER.id,
      'BTC',
      undefined,
      {},
      BROKER_A.id
    );
    expect(pendingService.createPending).not.toHaveBeenCalled();
  });
});
