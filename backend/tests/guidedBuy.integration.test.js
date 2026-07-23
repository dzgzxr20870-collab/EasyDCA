// ═══════════════════════════════════════════════════════════════════════════
// Integration + Regression — Guided Buy Flow (S8 R2 รอบ 2)
// ═══════════════════════════════════════════════════════════════════════════
// Mock แค่ Boundary จริงเท่านั้น (DB Repository / Price Feed / LINE SDK) — Logic
// ทั้งเส้นเป็นของจริงหมด:
//   handleEvent(postback) → guidedBuyFlow จริง → routeCommand จริง
//   → pendingTransaction.service จริง → transaction.service จริง
//   → handleEvent(postback ยืนยัน) → confirmPending จริง → transactionRepository.create
//
// ⚠️ Regression หลักของงานเงินรอบนี้ (Definition of Done ชั้นที่ 3 — Pattern "เว็บ=LINE"
// เดิม): แถวที่ Guided Flow (กดปุ่ม) INSERT ต้อง "เท่ากับ" แถวที่ Expert Path (พิมพ์
// "ซื้อ BTC 1000") INSERT ทุก Field — พิสูจน์ว่าไม่มี Logic คำนวณเงินคู่ขนานเกิดขึ้น
// เทสต์นี้ Fail บนโค้ดเก่า (action=gbuy_* ยังไม่มี → ตก default → ไม่มี Transaction เลย)

jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/pendingTransaction.repository');
jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/lineWebhookEvent.repository');
// Session Repository ทั้ง 3 Flow = Boundary DB (Service Layer ของทั้ง 3 เป็นของจริง)
jest.mock('../src/repositories/guidedBuySession.repository');
jest.mock('../src/repositories/reminderSetupSession.repository');
jest.mock('../src/repositories/bulkImportSession.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');
jest.mock('../src/services/line.service');
jest.mock('../src/services/mutualFund.service');
// portfolio.service ใช้แค่ประกอบ "ปุ่ม Symbol จากพอร์ตผู้ใช้" ไม่อยู่บนเส้นทางคำนวณเงิน
// ที่รอบนี้ทดสอบ — Mock ไว้ให้ Deterministic
jest.mock('../src/services/portfolio.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const pendingRepository = require('../src/repositories/pendingTransaction.repository');
const userRepository = require('../src/repositories/user.repository');
const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');
const guidedBuySessionRepository = require('../src/repositories/guidedBuySession.repository');
const reminderSetupSessionRepository = require('../src/repositories/reminderSetupSession.repository');
const bulkImportSessionRepository = require('../src/repositories/bulkImportSession.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const lineService = require('../src/services/line.service');
const mutualFundService = require('../src/services/mutualFund.service');
const portfolioService = require('../src/services/portfolio.service');

const { handleEvent } = require('../src/controllers/webhook.controller');

const USER_ID = 'user-uuid-1';
const LINE_USER_ID = 'U-line-1';
const ASSET_ID = 'asset-uuid-1';
const BTC_PRICE = 2500000;

const USER = {
  id: USER_ID,
  lineUserId: LINE_USER_ID,
  plan: 'premium',
  planExpiresAt: '2099-01-01T00:00:00.000Z',
  pdpaConsentedAt: '2026-01-01T00:00:00.000Z',
};

let pendingStore;
// Fake ตาราง guided_buy_sessions ใน Memory — ให้ State ไหลข้าม Webhook Event ได้จริง
// (Guided Flow เป็น Multi-event: แต่ละปุ่มที่กดคือคนละ HTTP Request)
let guidedSession;

function setupPendingFake() {
  pendingStore = new Map();
  let seq = 0;

  pendingRepository.create.mockImplementation(async (data) => {
    const id = `pending-${(seq += 1)}`;
    const row = { ...data, id, status: 'pending' };
    pendingStore.set(id, row);
    return row;
  });
  pendingRepository.findById.mockImplementation(async (id) => pendingStore.get(id) ?? null);
  pendingRepository.claimForConfirm.mockImplementation(async (id) => {
    const row = pendingStore.get(id);
    if (!row || row.status !== 'pending') return null;
    row.status = 'confirmed';
    return row;
  });
  pendingRepository.attachTransaction.mockResolvedValue(true);
}

function setupGuidedSessionFake() {
  guidedSession = null;

  guidedBuySessionRepository.upsert.mockImplementation(async (data) => {
    guidedSession = { userId: data.userId, step: data.step, symbol: data.symbol ?? null };
    return guidedSession;
  });
  guidedBuySessionRepository.findValidByUser.mockImplementation(async () => guidedSession);
  guidedBuySessionRepository.updateByUser.mockImplementation(async (userId, patch) => {
    guidedSession = { ...guidedSession, ...patch };
    return guidedSession;
  });
  guidedBuySessionRepository.deleteByUser.mockImplementation(async () => {
    guidedSession = null;
  });
}

function textEvent(text) {
  return {
    type: 'message',
    replyToken: 'reply-token',
    source: { userId: LINE_USER_ID },
    message: { type: 'text', id: 'msg-1', text },
    webhookEventId: `evt-${Math.random()}`,
  };
}

function postbackEvent(data) {
  return {
    type: 'postback',
    replyToken: 'reply-token',
    source: { userId: LINE_USER_ID },
    postback: { data },
    webhookEventId: `evt-${Math.random()}`,
  };
}

function lastReply() {
  const call = lineService.replyMessage.mock.calls.at(-1);
  return call ? call[1] : null;
}

function lastReplyJson() {
  return JSON.stringify(lastReply());
}

function lastQuickReplyItems() {
  return lastReply()?.quickReply?.items ?? [];
}

// กดยืนยันการ์ด Preview ล่าสุด → บันทึก Transaction จริง
async function confirmLatestPending() {
  const [pendingId] = [...pendingStore.keys()].slice(-1);
  expect(pendingId).toBeDefined();
  await handleEvent(postbackEvent(`action=confirm&pendingId=${pendingId}`));
}

function insertedRow() {
  expect(transactionRepository.create).toHaveBeenCalledTimes(1);
  return transactionRepository.create.mock.calls[0][0];
}

function resetMoneyBoundary() {
  assetRepository.findByUserAndSymbol.mockResolvedValue({
    id: ASSET_ID,
    symbol: 'BTC',
    type: 'crypto',
  });
  assetRepository.countActiveByUser.mockResolvedValue(1);
  assetRepository.findByIds.mockResolvedValue([{ id: ASSET_ID, symbol: 'BTC' }]);
  transactionRepository.findAllByUser.mockResolvedValue([]);
  transactionRepository.findAllByAsset.mockResolvedValue([]);
  transactionRepository.findRecentByUser.mockResolvedValue([]);
  transactionRepository.create.mockImplementation(async (data) => ({
    ...data,
    id: 'txn-uuid-1',
    createdAt: '2026-07-23T10:00:00.000Z',
  }));
  priceFeedService.getCurrentPrice.mockResolvedValue(BTC_PRICE);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  setupPendingFake();
}

beforeEach(() => {
  jest.clearAllMocks();

  userRepository.findByLineUserId.mockResolvedValue(USER);
  lineWebhookEventRepository.claimEvent.mockResolvedValue(true);
  lineService.replyMessage.mockResolvedValue(undefined);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-23', stale: false });
  mutualFundService.resolveFundForBuy.mockResolvedValue({ status: 'not_found' });
  portfolioService.getPortfolioSummary.mockResolvedValue({
    isEmpty: false,
    holdings: [{ symbol: 'BTC' }, { symbol: 'PTT' }],
  });
  // ไม่มี Session ของ Flow อื่นค้าง (เทสต์ Collision จะ Override เอง)
  reminderSetupSessionRepository.findValidByUser.mockResolvedValue(null);
  reminderSetupSessionRepository.deleteByUser.mockResolvedValue(undefined);
  bulkImportSessionRepository.findValidByUser.mockResolvedValue(null);
  bulkImportSessionRepository.deleteByUser.mockResolvedValue(undefined);

  setupGuidedSessionFake();
  resetMoneyBoundary();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1) Regression หลัก — Guided (กดปุ่ม) ต้องได้แถวเท่ากับ Expert Path (พิมพ์) เป๊ะ
// ═══════════════════════════════════════════════════════════════════════════
describe('Regression: Guided Flow = Expert Path (แถวใน transactions ต้องเท่ากันทุก Field)', () => {
  async function runGuidedFlow() {
    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol&sym=BTC'));
    await handleEvent(postbackEvent('action=gbuy_amount&amt=1000'));
    await confirmLatestPending();
  }

  test('กดปุ่ม BTC → 1000 บาท → ยืนยัน = พิมพ์ "ซื้อ BTC 1000" → ยืนยัน ทุก Field', async () => {
    await runGuidedFlow();
    const guidedRow = insertedRow();

    jest.clearAllMocks();
    setupGuidedSessionFake();
    resetMoneyBoundary();

    await handleEvent(textEvent('ซื้อ BTC 1000'));
    await confirmLatestPending();
    const expertRow = insertedRow();

    // Field เงินทุกตัวต้องเท่ากันเป๊ะ — ถ้าต่างแม้แต่ตัวเดียวแปลว่ามี Logic คำนวณ
    // คู่ขนานเกิดขึ้นจริง (สิ่งที่กฎข้อ 1 ของงานนี้ห้ามเด็ดขาด)
    expect(guidedRow.quantity).toBe(expertRow.quantity);
    expect(guidedRow.pricePerUnit).toBe(expertRow.pricePerUnit);
    expect(guidedRow.amountThb).toBe(expertRow.amountThb);
    expect(guidedRow.currency).toBe(expertRow.currency);
    expect(guidedRow.type).toBe(expertRow.type);
    expect(guidedRow.assetId).toBe(expertRow.assetId);
    expect(guidedRow.userId).toBe(expertRow.userId);
    expect(guidedRow.date).toBe(expertRow.date);
    expect(guidedRow.feeThb).toBe(expertRow.feeThb);
    // ทั้งคู่มาทาง LINE เหมือนกัน — Guided ไม่ใช่ "ช่องทางใหม่"
    expect(guidedRow.source).toBe('line');
    expect(expertRow.source).toBe('line');
  });

  test('ตัวเลขที่บันทึกมาจากราคาตลาดจริง (1000 / 2,500,000) ไม่ใช่ค่าที่ Flow เดาเอง', async () => {
    await runGuidedFlow();

    const row = insertedRow();
    expect(row.pricePerUnit).toBe(BTC_PRICE);
    expect(row.amountThb).toBe(1000);
    expect(row.quantity).toBe(0.0004);
    expect(row.currency).toBe('THB');
  });

  test('พิมพ์เอง (Symbol + จำนวนเงิน) ได้ผลเท่ากับกดปุ่มทุกประการ', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol_manual'));
    await handleEvent(textEvent('btc')); // พิมพ์ตัวเล็ก — ต้อง Normalize เป็น BTC
    await handleEvent(postbackEvent('action=gbuy_amount_manual'));
    await handleEvent(textEvent('1,000')); // มี Comma — Reuse ตัวแปลงเดิมของ Controller
    await confirmLatestPending();

    const row = insertedRow();
    expect(row.amountThb).toBe(1000);
    expect(row.quantity).toBe(0.0004);
    expect(row.pricePerUnit).toBe(BTC_PRICE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) Flow / State Machine ระดับ Webhook
// ═══════════════════════════════════════════════════════════════════════════
describe('Guided Flow — ลำดับขั้นและการจบ Session', () => {
  test('buy_guide → ปุ่ม Symbol จากพอร์ตผู้ใช้ + "พิมพ์ชื่อเอง" (ไม่มีคำแนะนำให้ซื้อตัวไหน)', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));

    const items = JSON.stringify(lastQuickReplyItems());
    expect(items).toContain('action=gbuy_symbol&sym=BTC');
    expect(items).toContain('action=gbuy_symbol&sym=PTT');
    expect(items).toContain('action=gbuy_symbol_manual');
    // ห้ามมีถ้อยคำชักชวน/แนะนำซื้อขายรายตัวในทุกข้อความที่เพิ่มใหม่
    const text = lastReplyJson();
    expect(text).not.toMatch(/แนะนำ|น่าซื้อ|ควรซื้อ|น่าสนใจ/);
  });

  test('เลือก Symbol → ถามจำนวนเงินด้วย Chips 500/1000/3000/5000 + กำหนดเอง', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol&sym=BTC'));

    const items = JSON.stringify(lastQuickReplyItems());
    for (const amount of [500, 1000, 3000, 5000]) {
      expect(items).toContain(`action=gbuy_amount&amt=${amount}`);
    }
    expect(items).toContain('action=gbuy_amount_manual');
    expect(lastReplyJson()).toContain('BTC');
  });

  test('จบ Flow สำเร็จ (ได้การ์ด Preview) → Session ถูกลบ ไม่ค้างดักข้อความถัดไป', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol&sym=BTC'));
    await handleEvent(postbackEvent('action=gbuy_amount&amt=1000'));

    expect(guidedSession).toBeNull();
    expect(pendingStore.size).toBe(1);
  });

  test('routeCommand ล้มเหลว (เกินลิมิต Free) → Session "ยังค้าง" ให้ลองยอดใหม่ได้ทันที', async () => {
    userRepository.findByLineUserId.mockResolvedValue({ ...USER, plan: 'free', planExpiresAt: null });
    // Asset ใหม่ + ถือครบ 2 ตัวแล้ว → ASSET_LIMIT_REACHED จาก validateBuy จริง
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.countActiveByUser.mockResolvedValue(2);

    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol&sym=BTC'));
    await handleEvent(postbackEvent('action=gbuy_amount&amt=1000'));

    expect(transactionRepository.create).not.toHaveBeenCalled();
    expect(guidedSession).toMatchObject({ step: 'AWAITING_AMOUNT', symbol: 'BTC' });
  });

  test('Expert Path ชนะเสมอ: พิมพ์คำสั่งเต็มระหว่างมี Guided Session ค้าง → ไม่ถูกตีความเป็นจำนวนเงิน', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol&sym=BTC'));

    // อยู่ขั้น AWAITING_AMOUNT แล้วพิมพ์คำสั่ง "พอต" → ต้องได้สรุปพอร์ต ไม่ใช่ INVALID_AMOUNT
    await handleEvent(textEvent('พอต'));

    expect(portfolioService.getPortfolioSummary).toHaveBeenCalled();
    expect(lastReplyJson()).not.toContain('จำนวนเงินไม่ถูกต้อง');
    // Session ยังอยู่ (คำสั่งปกติไม่ auto-cancel Flow — Pattern เดิมของ Reminder Setup)
    expect(guidedSession).toMatchObject({ step: 'AWAITING_AMOUNT' });
  });

  test('พิมพ์จำนวนเงินผิด (ตัวหนังสือ) → INVALID_AMOUNT และ Session ยังอยู่ขั้นเดิม', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol&sym=BTC'));
    await handleEvent(postbackEvent('action=gbuy_amount_manual'));
    await handleEvent(textEvent('เท่าไหร่ดี'));

    expect(pendingStore.size).toBe(0);
    expect(lastReplyJson()).toContain('จำนวนเงินไม่ถูกต้อง');
    expect(guidedSession).toMatchObject({ step: 'AWAITING_AMOUNT' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) ปุ่มยกเลิก — ห้ามใช้ action ของ Flow อื่นซ้ำ (บทเรียน S8 R2 รอบ 1)
// ═══════════════════════════════════════════════════════════════════════════
describe('ปุ่มยกเลิกของ Guided Buy แยกจาก Flow ตั้งเตือนเด็ดขาด', () => {
  test('ทุกขั้นของ Flow ต้องแนบ cancel_guided_buy และห้ามมี cancel_reminder_setup หลุดมา', async () => {
    const steps = [
      'action=buy_guide',
      'action=gbuy_symbol&sym=BTC',
      'action=gbuy_amount_manual',
    ];

    for (const step of steps) {
      await handleEvent(postbackEvent(step));
      const items = JSON.stringify(lastQuickReplyItems());
      expect(items).toContain('action=cancel_guided_buy');
      expect(items).not.toContain('cancel_reminder_setup');
    }
  });

  test('กด cancel_guided_buy → ลบเฉพาะ Guided Session ไม่แตะ Session ตั้งเตือน/นำเข้าพอร์ต', async () => {
    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=cancel_guided_buy'));

    expect(guidedSession).toBeNull();
    expect(reminderSetupSessionRepository.deleteByUser).not.toHaveBeenCalled();
    expect(bulkImportSessionRepository.deleteByUser).not.toHaveBeenCalled();
    expect(lastReplyJson()).toContain('ยกเลิกการบันทึกแล้ว');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) Session ชนกันตอน "เริ่ม" Flow ใหม่
// ═══════════════════════════════════════════════════════════════════════════
describe('Session ชนกัน — ห้ามเขียนทับ Session ของ Flow อื่นเงียบๆ', () => {
  test('มี Session ตั้งเตือนค้าง + กด "บันทึก DCA" → แจ้งเตือน ไม่สร้าง Guided Session', async () => {
    reminderSetupSessionRepository.findValidByUser.mockResolvedValue({
      user_id: USER_ID,
      step: 'AWAITING_AMOUNT',
      symbol: 'BTC',
    });

    await handleEvent(postbackEvent('action=buy_guide'));

    expect(guidedSession).toBeNull();
    expect(guidedBuySessionRepository.upsert).not.toHaveBeenCalled();
    // Session เดิมต้องไม่ถูกแตะเลย
    expect(reminderSetupSessionRepository.deleteByUser).not.toHaveBeenCalled();
    expect(lastReplyJson()).toContain('ตั้งเตือน DCA');
    expect(JSON.stringify(lastQuickReplyItems())).toContain('action=gbuy_force_start');
  });

  test('ผู้ใช้กดยืนยันทิ้งของเดิม (gbuy_force_start) → ล้าง Session เดิมอย่างชัดแจ้งแล้วเริ่ม', async () => {
    reminderSetupSessionRepository.findValidByUser.mockResolvedValue({
      user_id: USER_ID,
      step: 'AWAITING_AMOUNT',
    });

    await handleEvent(postbackEvent('action=gbuy_force_start'));

    expect(reminderSetupSessionRepository.deleteByUser).toHaveBeenCalledWith(USER_ID);
    expect(bulkImportSessionRepository.deleteByUser).toHaveBeenCalledWith(USER_ID);
    expect(guidedSession).toMatchObject({ step: 'AWAITING_SYMBOL' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) PDPA Consent Gate — Guided Flow ต้องไม่ Bypass
// ═══════════════════════════════════════════════════════════════════════════
describe('PDPA Consent Gate', () => {
  test('ผู้ใช้ยังไม่ Consent กด "บันทึก DCA" → การ์ดขอความยินยอม ไม่สร้าง Session/Pending ใดๆ', async () => {
    userRepository.findByLineUserId.mockResolvedValue({ ...USER, pdpaConsentedAt: null });

    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_amount&amt=1000'));

    expect(guidedBuySessionRepository.upsert).not.toHaveBeenCalled();
    expect(pendingStore.size).toBe(0);
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6) Manual Quantity Fallback (Round 10-B) — Asset ที่ Registry ไม่รู้จัก
// ═══════════════════════════════════════════════════════════════════════════
describe('Manual Quantity Fallback — สินทรัพย์ที่ไม่มีราคาตลาดอัตโนมัติ', () => {
  test('EOSE (ไม่อยู่ใน Registry, ไม่มี Price Feed) → ชี้ทางกรอกจำนวนหุ้นเอง ไม่ตอบ Error ตัน', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.countActiveByUser.mockResolvedValue(0);
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    await handleEvent(postbackEvent('action=buy_guide'));
    await handleEvent(postbackEvent('action=gbuy_symbol&sym=EOSE'));
    await handleEvent(postbackEvent('action=gbuy_amount&amt=1000'));

    const reply = lastReplyJson();
    expect(reply).toContain('กรอกจำนวนหุ้นเอง');
    // Prefill ต้องเป็นรูปแบบที่ commandParser เดิม (AMOUNT_QTY_BUY) Parse ได้จริง
    expect(reply).toContain('ซื้อ EOSE <จำนวนหุ้น> หุ้น รวม 1000');
    expect(pendingStore.size).toBe(0);
    // ส่งไม้ต่อให้ Expert Path แล้ว → ไม่ปล่อย Session ค้างดักข้อความ Prefill
    expect(guidedSession).toBeNull();
  });

  test('ข้อความ Prefill ที่ผู้ใช้ Copy กลับมา → Expert Path เดิมบันทึกได้ตามปกติ', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.countActiveByUser.mockResolvedValue(0);
    // Asset ใหม่ถูกสร้างตอน Confirm (EOSE ยังไม่เคยถืออยู่)
    assetRepository.create.mockResolvedValue({ id: ASSET_ID, symbol: 'EOSE', type: 'stock_th' });
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    await handleEvent(textEvent('ซื้อ EOSE 50 หุ้น รวม 1000'));
    await confirmLatestPending();

    const row = insertedRow();
    expect(row.quantity).toBe(50);
    expect(row.amountThb).toBe(1000);
    expect(row.pricePerUnit).toBe(20);
  });
});
