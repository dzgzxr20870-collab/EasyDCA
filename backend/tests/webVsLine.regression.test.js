// ═══════════════════════════════════════════════════════════════════════════
// Regression: "เว็บ = LINE" (S8 Round 1a — Definition of Done ชั้นที่ 3)
// ═══════════════════════════════════════════════════════════════════════════
// พิสูจน์ว่า Input ชุดเดียวกันที่เข้ามาคนละช่องทาง (พิมพ์ใน LINE vs กรอกฟอร์มเว็บ)
// ได้ "แถวใน transactions เท่ากันทุก Field ที่ควรเท่า"
//
// วิธีทดสอบ: Mock แค่ Boundary จริงเท่านั้น (DB Repository / Price Feed / LINE SDK)
// ส่วน Logic ทั้งหมดที่อยู่ระหว่างนั้นเป็นของจริงทั้งเส้น —
//   LINE: handleEvent(ข้อความ) → commandParser จริง → routeCommand จริง
//         → pendingTransaction.service จริง → transaction.service จริง
//         → handleEvent(postback ยืนยัน) → confirmPending จริง → processBuyCommand จริง
//   เว็บ: transactions.controller.createTransaction จริง → transaction.service จริง
// แล้วเทียบ Argument ที่ไหลถึง transactionRepository.create (= สิ่งที่จะถูก INSERT จริง)
//
// Field ที่ "ตั้งใจให้ต่าง" มีแค่ source ('line' vs 'web') — ตรวจแยกไว้ชัดเจนด้านล่าง

// Stage 8-fix (บั๊ก Asset Resolution) — validateBuy ต้อง Resolve พอร์ต Default
// ตอนสร้างสินทรัพย์ใหม่ (Invariant migration 044/045: สินทรัพย์ทุกแถวสังกัดพอร์ต)
// จึงต้อง Mock portfolio.repository ด้วย · Automock คืน undefined = "ยังไม่มีพอร์ต"
// ซึ่งตรงกับสภาพก่อน Apply 044 พอดี → พฤติกรรมของเทสต์เดิมไม่เปลี่ยน
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/broker.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/pendingTransaction.repository');
jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/lineWebhookEvent.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');
jest.mock('../src/services/line.service');
// Flow แชทอื่นที่ handleEvent เช็คก่อนจะถึงคำสั่งซื้อ (ตั้งเตือน/นำเข้าพอร์ต) — Mock
// เป็น "ไม่มี Session ค้าง" เพื่อให้ข้อความไหลไป routeCommand ตามปกติ ไม่ใช่ Logic ที่
// รอบนี้ทดสอบ (และของจริงจะยิง DB จริง)
jest.mock('../src/services/reminderSetupFlow.service', () => {
  const actual = jest.requireActual('../src/services/reminderSetupFlow.service');
  return { STEPS: actual.STEPS, getCurrentSession: jest.fn() };
});
jest.mock('../src/services/bulkImportSession.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const pendingRepository = require('../src/repositories/pendingTransaction.repository');
const userRepository = require('../src/repositories/user.repository');
const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const lineService = require('../src/services/line.service');
const reminderSetupFlow = require('../src/services/reminderSetupFlow.service');
const bulkImportSession = require('../src/services/bulkImportSession.service');

const webhookController = require('../src/controllers/webhook.controller');
const transactionsController = require('../src/controllers/transactions.controller');

const USER_ID = 'user-uuid-1';
const LINE_USER_ID = 'U-line-1';
const ASSET_ID = 'asset-uuid-1';

const USER = {
  id: USER_ID,
  lineUserId: LINE_USER_ID,
  plan: 'premium',
  planExpiresAt: '2099-01-01T00:00:00.000Z',
  pdpaConsentedAt: '2026-01-01T00:00:00.000Z',
};

// เก็บ Pending ไว้ใน Memory ให้ Service จริงทำงานได้ครบวงจร Preview → Confirm
// (ไม่ Mock pendingTransaction.service เอง เพราะต้องการให้ Logic Snapshot ราคา/
// วันที่/สกุลเงินของมันถูกใช้จริงตามเส้นทาง LINE)
let pendingStore;

function setupPendingFake() {
  pendingStore = new Map();
  let seq = 0;

  pendingRepository.create.mockImplementation(async (data) => {
    const id = `pending-${(seq += 1)}`;
    const row = { ...data, id, status: 'pending' };
    pendingStore.set(id, row);
    return row;
  });
  // Fake บังคับ Ownership เหมือน `.eq('user_id', userId)` ของจริง (เหตุผลเดียวกับ
  // guidedBuy.integration.test.js — Fake ที่ปล่อยผ่านทำให้เทสต์เขียวหลอก)
  pendingRepository.findByIdForUser.mockImplementation(async (id, userId) => {
    const row = pendingStore.get(id);
    return row && row.userId === userId ? row : null;
  });
  pendingRepository.claimForConfirm.mockImplementation(async (id, userId) => {
    const row = pendingStore.get(id);
    if (!row || row.userId !== userId || row.status !== 'pending') return null;
    row.status = 'confirmed';
    return row;
  });
  pendingRepository.attachTransaction.mockResolvedValue(true);
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

function webReq(body) {
  return { user: { id: USER_ID }, userRecord: USER, body };
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

// รันเส้นทาง LINE เต็ม: พิมพ์คำสั่ง → ได้ Preview → กดยืนยัน → บันทึกจริง
async function runLineFlow(commandText) {
  await webhookController.handleEvent(textEvent(commandText));

  // Pending ล่าสุดที่ Preview สร้างไว้ = ตัวที่ผู้ใช้กดยืนยัน
  const [pendingId] = [...pendingStore.keys()].slice(-1);
  expect(pendingId).toBeDefined();

  await webhookController.handleEvent(postbackEvent(`action=confirm&pendingId=${pendingId}`));
}

// Argument ที่ไหลถึง transactionRepository.create = สิ่งที่จะ INSERT ลง DB จริง
function insertedRow() {
  expect(transactionRepository.create).toHaveBeenCalledTimes(1);
  return transactionRepository.create.mock.calls[0][0];
}

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

// ⚠️ ตัวถามเลือกโบรกเชิงรุก (Premium ที่มีโบรก >1) — ไฟล์นี้จำลอง **ผู้ใช้โบรก
// เดียว** ด้วยเหตุผลเดียวกับพอร์ตข้างบนเป๊ะ (ไฟล์นี้ไม่ได้ทดสอบฟีเจอร์นี้โดยตรง —
// ดู tests/brokerPickerLineFlow.test.js) Module Scope เหตุผลเดียวกัน
require('../src/repositories/broker.repository').findAllByUser.mockResolvedValue([
  {
    id: 'broker-single-0000-4000-8000-000000000001',
    name: 'โบรกของฉัน',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]);

beforeEach(() => {
  jest.clearAllMocks();

  userRepository.findById.mockResolvedValue(USER);
  userRepository.findByLineUserId.mockResolvedValue(USER);
  // claimEvent = true → Event ยังไม่เคยถูกประมวลผล (ไม่ใช่ Duplicate Retry ของ LINE)
  lineWebhookEventRepository.claimEvent.mockResolvedValue(true);
  lineService.replyMessage.mockResolvedValue(undefined);
  reminderSetupFlow.getCurrentSession.mockResolvedValue(null);
  bulkImportSession.getActiveSession?.mockResolvedValue?.(null);
  lineService.pushMessage.mockResolvedValue(undefined);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-17', stale: false });

  // Asset มีอยู่แล้ว → ทั้งสองช่องทางไม่ต้องสร้าง Asset ใหม่ (ตัดตัวแปร Freemium ออก
  // จากการเทียบ ให้โฟกัสที่ตัวเลขเงินล้วนๆ)
  assetRepository.findAllByUserAndSymbol.mockResolvedValue([{
    id: ASSET_ID,
    symbol: 'AAPL',
    type: 'stock_us',
  }]);
  assetRepository.findActiveSymbolsByUser.mockResolvedValue(Array.from({ length: 1 }, (_, i) => `__OTHER${i}`));
  assetRepository.findByIds.mockResolvedValue([{ id: ASSET_ID, symbol: 'AAPL' }]);

  transactionRepository.create.mockImplementation(async (data) => ({
    ...data,
    id: 'txn-uuid-1',
    createdAt: '2026-07-17T10:00:00.000Z',
  }));
  transactionRepository.findAllByUser.mockResolvedValue([]);
  transactionRepository.findAllByAsset.mockResolvedValue([]);
  transactionRepository.findRecentByUser.mockResolvedValue([]);

  setupPendingFake();
});

// ── เคส 1: "ซื้อ AAPL 1000" — จำนวนเงินรวม ระบบดึงราคาเอง ────────────────────
describe('ซื้อ AAPL 1000 (ระบบดึงราคาตลาดเอง)', () => {
  const PRICE = 190.5;

  beforeEach(() => {
    priceFeedService.getCurrentPrice.mockResolvedValue(PRICE);
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(PRICE);
  });

  test('LINE กับเว็บ INSERT แถวเดียวกันทุก Field ที่ควรเท่า (ต่างแค่ source)', async () => {
    await runLineFlow('ซื้อ AAPL 1000');
    const lineRow = insertedRow();

    jest.clearAllMocks();
    setupPendingFake();
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([{
      id: ASSET_ID,
      symbol: 'AAPL',
      type: 'stock_us',
    }]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue(Array.from({ length: 1 }, (_, i) => `__OTHER${i}`));
    transactionRepository.findAllByUser.mockResolvedValue([]);
    transactionRepository.create.mockImplementation(async (data) => ({
      ...data,
      id: 'txn-uuid-1',
      createdAt: '2026-07-17T10:00:00.000Z',
    }));
    priceFeedService.getCurrentPrice.mockResolvedValue(PRICE);
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(PRICE);

    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', amountTotal: 1000, currency: 'THB' }),
      mockRes()
    );
    const webRow = insertedRow();

    // Field เงินทุกตัวต้องเท่ากันเป๊ะ (quantity ที่หารจากราคาเดียวกัน + ยอด + สกุล)
    expect(webRow.quantity).toBe(lineRow.quantity);
    expect(webRow.pricePerUnit).toBe(lineRow.pricePerUnit);
    expect(webRow.amountThb).toBe(lineRow.amountThb);
    expect(webRow.currency).toBe(lineRow.currency);
    expect(webRow.type).toBe(lineRow.type);
    expect(webRow.assetId).toBe(lineRow.assetId);
    expect(webRow.userId).toBe(lineRow.userId);
    expect(webRow.date).toBe(lineRow.date);
    expect(webRow.feeThb).toBe(lineRow.feeThb);

    // Field เดียวที่ตั้งใจให้ต่าง = ช่องทางที่บันทึก
    expect(lineRow.source).toBe('line');
    expect(webRow.source).toBe('web');
  });

  test('quantity หารจากราคาตลาดจริง ไม่ใช่ค่าที่เดาเอง', async () => {
    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', amountTotal: 1000, currency: 'THB' }),
      mockRes()
    );

    const row = insertedRow();
    expect(row.pricePerUnit).toBe(PRICE);
    // roundToEight(1000 / 190.5) — กฎการปัดเศษเดียวกับ Service เดิม
    expect(row.quantity).toBe(5.24934383);
    expect(row.amountThb).toBe(1000);
  });
});

// ── เคส 2: "ซื้อ PTT 50 หุ้น ราคา 34" — ผู้ใช้ระบุราคาเอง (หุ้นไทยไม่มี Feed) ──
describe('ซื้อ PTT ราคาระบุเอง (หุ้นไทย)', () => {
  beforeEach(() => {
    // หุ้นไทยไม่มี Price Feed — ทั้งสองช่องทางต้องไม่พึ่งราคาตลาดเลย
    priceFeedService.getCurrentPrice.mockResolvedValue(null);
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([{
      id: ASSET_ID,
      symbol: 'PTT',
      type: 'stock_th',
    }]);
    assetRepository.findByIds.mockResolvedValue([{ id: ASSET_ID, symbol: 'PTT' }]);
  });

  test('LINE "50 หุ้น ราคา 34" = เว็บ "ยอดรวม 1700 ราคา 34" ทุก Field ที่ควรเท่า', async () => {
    await runLineFlow('ซื้อ PTT 50 หุ้น ราคา 34');
    const lineRow = insertedRow();

    jest.clearAllMocks();
    setupPendingFake();
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([{
      id: ASSET_ID,
      symbol: 'PTT',
      type: 'stock_th',
    }]);
    transactionRepository.findAllByUser.mockResolvedValue([]);
    transactionRepository.create.mockImplementation(async (data) => ({
      ...data,
      id: 'txn-uuid-2',
      createdAt: '2026-07-17T10:00:00.000Z',
    }));
    priceFeedService.getCurrentPrice.mockResolvedValue(null);

    // ฟอร์มเว็บส่ง "จำนวนเงินรวม" (1700 = 50 × 34) ไม่ใช่จำนวนหุ้น
    await transactionsController.createTransaction(
      webReq({ symbol: 'PTT', amountTotal: 1700, pricePerUnit: 34, currency: 'THB' }),
      mockRes()
    );
    const webRow = insertedRow();

    // เว็บต้องแปลงยอดรวมกลับเป็น 50 หุ้นได้เป๊ะ ไม่คลาดเคลื่อน
    expect(webRow.quantity).toBe(50);
    expect(webRow.quantity).toBe(lineRow.quantity);
    expect(webRow.pricePerUnit).toBe(lineRow.pricePerUnit);
    expect(webRow.amountThb).toBe(lineRow.amountThb);
    expect(webRow.currency).toBe(lineRow.currency);
    expect(webRow.date).toBe(lineRow.date);

    expect(lineRow.source).toBe('line');
    expect(webRow.source).toBe('web');
  });
});

// ── เคส 3: Multi-Currency USD (Round 10) — เก็บ USD ตามจริง ไม่แปลงเป็นบาท ────
describe('ซื้อ AAPL 100 usd (Multi-Currency)', () => {
  const PRICE_USD = 190.5;

  beforeEach(() => {
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(PRICE_USD);
    priceFeedService.getCurrentPrice.mockResolvedValue(PRICE_USD * 35);
  });

  test('LINE กับเว็บบันทึก USD เท่ากันทุก Field ที่ควรเท่า', async () => {
    await runLineFlow('ซื้อ AAPL 100 usd');
    const lineRow = insertedRow();

    jest.clearAllMocks();
    setupPendingFake();
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([{
      id: ASSET_ID,
      symbol: 'AAPL',
      type: 'stock_us',
    }]);
    transactionRepository.findAllByUser.mockResolvedValue([]);
    transactionRepository.create.mockImplementation(async (data) => ({
      ...data,
      id: 'txn-uuid-3',
      createdAt: '2026-07-17T10:00:00.000Z',
    }));
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(PRICE_USD);
    fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-17', stale: false });

    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', amountTotal: 100, currency: 'USD' }),
      mockRes()
    );
    const webRow = insertedRow();

    expect(webRow.currency).toBe('USD');
    expect(lineRow.currency).toBe('USD');
    // amountThb เก็บ "ยอดในสกุลของแถว" ตามจริง = 100 USD (ไม่ใช่ 3500 บาท)
    expect(webRow.amountThb).toBe(100);
    expect(webRow.amountThb).toBe(lineRow.amountThb);
    expect(webRow.pricePerUnit).toBe(lineRow.pricePerUnit);
    expect(webRow.quantity).toBe(lineRow.quantity);
  });
});

// ── เคส 4: สร้าง Asset ใหม่ — ต้องได้ assets row เหมือนกันทั้งสองช่องทาง ─────
describe('ซื้อสินทรัพย์ที่ยังไม่เคยมี (สร้าง Asset ใหม่)', () => {
  beforeEach(() => {
    priceFeedService.getCurrentPrice.mockResolvedValue(190.5);
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]); // ยังไม่มี Asset
    assetRepository.create.mockResolvedValue({ id: ASSET_ID, symbol: 'AAPL', type: 'stock_us' });
  });

  test('assets.name ที่สร้างจากเว็บ = ที่สร้างจาก LINE (ไม่ใส่ชื่อสวยจาก Registry)', async () => {
    await runLineFlow('ซื้อ AAPL 1000');
    const lineArgs = assetRepository.create.mock.calls[0];

    jest.clearAllMocks();
    setupPendingFake();
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
    assetRepository.create.mockResolvedValue({ id: ASSET_ID, symbol: 'AAPL', type: 'stock_us' });
    assetRepository.findActiveSymbolsByUser.mockResolvedValue(Array.from({ length: 1 }, (_, i) => `__OTHER${i}`));
    transactionRepository.findAllByUser.mockResolvedValue([]);
    transactionRepository.create.mockImplementation(async (data) => ({ ...data, id: 'txn-4' }));
    priceFeedService.getCurrentPrice.mockResolvedValue(190.5);

    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', amountTotal: 1000, currency: 'THB' }),
      mockRes()
    );
    const webArgs = assetRepository.create.mock.calls[0];

    // Signature: (userId, portfolioId, symbol, name, type, extras)
    expect(webArgs[2]).toBe(lineArgs[2]); // symbol
    expect(webArgs[3]).toBe(lineArgs[3]); // name — ต้องเท่ากัน ('AAPL' ทั้งคู่)
    expect(webArgs[4]).toBe(lineArgs[4]); // type
  });
});

// ── เคส 5: วันที่ย้อนหลัง — ต้องใช้เส้นทางเดียวกับ Bulk Import (params.date) ───
describe('วันที่ย้อนหลัง', () => {
  test('เว็บส่ง date ย้อนหลัง → INSERT ด้วยวันนั้นจริง (ไม่ใช่วันนี้)', async () => {
    priceFeedService.getCurrentPrice.mockResolvedValue(190.5);

    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', amountTotal: 1000, currency: 'THB', date: '2026-01-15' }),
      mockRes()
    );

    expect(insertedRow().date).toBe('2026-01-15');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ฝั่งขาย — "เว็บ = LINE" (ปุ่มขายบน Dashboard)
// ═══════════════════════════════════════════════════════════════════════════
// เหตุผลเดียวกับฝั่งซื้อด้านบน: การขายบนเว็บต้องไหลผ่าน transaction.service
// (validateSell → processSellCommand) ตัวเดียวกับคำสั่งพิมพ์ใน LINE เป๊ะ ไม่มีเส้นทาง
// คำนวณเงินคู่ขนานของเว็บ — พิสูจน์โดยเทียบแถวที่จะ INSERT จริงจากทั้งสองช่องทาง

// ยอดคงเหลือของ Asset ที่ validateSell จะคำนวณได้ (Σbuy − Σsell จากประวัติจริง)
function heldHistory(quantity, currency = 'THB') {
  return [{ id: 'txn-buy-old', assetId: ASSET_ID, type: 'buy', quantity, currency }];
}

// ตั้ง Mock ชุดเดิมใหม่หลัง clearAllMocks (เตรียมรันช่องทางที่สอง) — เลียนแบบ Pattern
// ที่เคสฝั่งซื้อด้านบนใช้อยู่แล้ว เพิ่มแค่ประวัติยอดคงเหลือที่การขายต้องใช้
function resetForSecondChannel({ symbol = 'AAPL', type = 'stock_us', history, price, priceUsd }) {
  setupPendingFake();
  assetRepository.findAllByUserAndSymbol.mockResolvedValue([{ id: ASSET_ID, symbol, type }]);
  assetRepository.findActiveSymbolsByUser.mockResolvedValue(Array.from({ length: 1 }, (_, i) => `__OTHER${i}`));
  transactionRepository.findAllByUser.mockResolvedValue([]);
  transactionRepository.findAllByAsset.mockResolvedValue(history);
  transactionRepository.create.mockImplementation(async (data) => ({
    ...data,
    id: 'txn-uuid-sell',
    createdAt: '2026-07-17T10:00:00.000Z',
  }));
  if (price !== undefined) priceFeedService.getCurrentPrice.mockResolvedValue(price);
  if (priceUsd !== undefined) priceFeedService.getCurrentPriceUsd.mockResolvedValue(priceUsd);
}

// ── เคส 6: ขายระบุจำนวนหน่วย + ราคา ─────────────────────────────────────────
describe('ขาย AAPL 4 หุ้น ราคา 250 (ระบุจำนวนหน่วย + ราคาที่ขายได้)', () => {
  const HISTORY = heldHistory(10);

  beforeEach(() => {
    transactionRepository.findAllByAsset.mockResolvedValue(HISTORY);
    priceFeedService.getCurrentPrice.mockResolvedValue(250);
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(250);
  });

  test('LINE กับเว็บ INSERT แถวขายเดียวกันทุก Field ที่ควรเท่า (ต่างแค่ source)', async () => {
    await runLineFlow('ขาย AAPL 4 หุ้น ราคา 250');
    const lineRow = insertedRow();

    jest.clearAllMocks();
    resetForSecondChannel({ history: HISTORY, price: 250, priceUsd: 250 });

    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', side: 'sell', quantity: 4, pricePerUnit: 250, currency: 'THB' }),
      mockRes()
    );
    const webRow = insertedRow();

    // ต้องเป็นรายการ "ขาย" ทั้งคู่ ไม่ใช่ซื้อ (ทิศทางผิด = พอร์ตเพี้ยนทั้งใบ)
    expect(lineRow.type).toBe('sell');
    expect(webRow.type).toBe('sell');

    expect(webRow.quantity).toBe(lineRow.quantity);
    expect(webRow.pricePerUnit).toBe(lineRow.pricePerUnit);
    expect(webRow.amountThb).toBe(lineRow.amountThb);
    expect(webRow.currency).toBe(lineRow.currency);
    expect(webRow.assetId).toBe(lineRow.assetId);
    expect(webRow.userId).toBe(lineRow.userId);
    expect(webRow.date).toBe(lineRow.date);
    expect(webRow.feeThb).toBe(lineRow.feeThb);

    // ตัวเลขจริงที่ลง Ledger (Before/After ตาม AI_WORK_POLICY § 4.1)
    expect(webRow.quantity).toBe(4);
    expect(webRow.amountThb).toBe(1000);

    expect(lineRow.source).toBe('line');
    expect(webRow.source).toBe('web');
  });
});

// ── เคส 7: "ขายทั้งหมด" — Service ดึงยอด + ราคาตลาดเอง ────────────────────────
describe('ขาย AAPL ทั้งหมด (sellAll)', () => {
  // ยอดที่มีเศษทศนิยมยาว: ถ้าฝั่งใดฝั่งหนึ่งคิดจำนวนเอง ตัวเลขจะไม่ตรงกันทันที
  const HISTORY = heldHistory(0.05231467);
  const PRICE = 2450000;

  beforeEach(() => {
    transactionRepository.findAllByAsset.mockResolvedValue(HISTORY);
    priceFeedService.getCurrentPrice.mockResolvedValue(PRICE);
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(PRICE);
  });

  test('LINE "ขาย AAPL ทั้งหมด" = เว็บ sellAll:true — ขายเกลี้ยงเท่ากัน ไม่เหลือเศษ', async () => {
    await runLineFlow('ขาย AAPL ทั้งหมด');
    const lineRow = insertedRow();

    jest.clearAllMocks();
    resetForSecondChannel({ history: HISTORY, price: PRICE, priceUsd: PRICE });

    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', side: 'sell', sellAll: true }),
      mockRes()
    );
    const webRow = insertedRow();

    expect(webRow.type).toBe('sell');
    expect(webRow.quantity).toBe(lineRow.quantity);
    expect(webRow.pricePerUnit).toBe(lineRow.pricePerUnit);
    expect(webRow.amountThb).toBe(lineRow.amountThb);
    expect(webRow.currency).toBe(lineRow.currency);

    // ขายออกทั้งยอดคงเหลือจริง (ไม่ใช่ค่าที่ Frontend ปัดเศษมาเอง)
    expect(webRow.quantity).toBe(0.05231467);

    expect(lineRow.source).toBe('line');
    expect(webRow.source).toBe('web');
  });
});

// ── เคส 8: ขายเกินยอด — ทั้งสองช่องทางต้องปฏิเสธเหมือนกัน ไม่มีทางลัดของเว็บ ───
describe('ขายเกินยอดคงเหลือ', () => {
  const HISTORY = heldHistory(2);

  beforeEach(() => {
    transactionRepository.findAllByAsset.mockResolvedValue(HISTORY);
    priceFeedService.getCurrentPrice.mockResolvedValue(250);
    priceFeedService.getCurrentPriceUsd.mockResolvedValue(250);
  });

  test('LINE ไม่สร้าง Pending / เว็บตอบ 400 — ไม่มีช่องทางไหน INSERT ลง Ledger ได้', async () => {
    await webhookController.handleEvent(textEvent('ขาย AAPL 5 หุ้น ราคา 250'));
    // validateSell ถูกเรียก "ก่อน" สร้าง Pending → ยอดไม่พอต้องไม่มี Pending ค้างเลย
    expect(pendingStore.size).toBe(0);
    expect(transactionRepository.create).not.toHaveBeenCalled();

    jest.clearAllMocks();
    resetForSecondChannel({ history: HISTORY, price: 250, priceUsd: 250 });

    const res = mockRes();
    await transactionsController.createTransaction(
      webReq({ symbol: 'AAPL', side: 'sell', quantity: 5, pricePerUnit: 250 }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toBe('INSUFFICIENT_QUANTITY');
    expect(transactionRepository.create).not.toHaveBeenCalled();
  });
});
