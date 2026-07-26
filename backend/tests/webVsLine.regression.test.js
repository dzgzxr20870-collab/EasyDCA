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
  pendingRepository.findById.mockImplementation(async (id) => pendingStore.get(id) ?? null);
  pendingRepository.claimForConfirm.mockImplementation(async (id) => {
    const row = pendingStore.get(id);
    if (!row || row.status !== 'pending') return null;
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
  assetRepository.findByUserAndSymbol.mockResolvedValue({
    id: ASSET_ID,
    symbol: 'AAPL',
    type: 'stock_us',
  });
  assetRepository.countActiveByUser.mockResolvedValue(1);
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
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: ASSET_ID,
      symbol: 'AAPL',
      type: 'stock_us',
    });
    assetRepository.countActiveByUser.mockResolvedValue(1);
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
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: ASSET_ID,
      symbol: 'PTT',
      type: 'stock_th',
    });
    assetRepository.findByIds.mockResolvedValue([{ id: ASSET_ID, symbol: 'PTT' }]);
  });

  test('LINE "50 หุ้น ราคา 34" = เว็บ "ยอดรวม 1700 ราคา 34" ทุก Field ที่ควรเท่า', async () => {
    await runLineFlow('ซื้อ PTT 50 หุ้น ราคา 34');
    const lineRow = insertedRow();

    jest.clearAllMocks();
    setupPendingFake();
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: ASSET_ID,
      symbol: 'PTT',
      type: 'stock_th',
    });
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
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: ASSET_ID,
      symbol: 'AAPL',
      type: 'stock_us',
    });
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
    assetRepository.findByUserAndSymbol.mockResolvedValue(null); // ยังไม่มี Asset
    assetRepository.create.mockResolvedValue({ id: ASSET_ID, symbol: 'AAPL', type: 'stock_us' });
  });

  test('assets.name ที่สร้างจากเว็บ = ที่สร้างจาก LINE (ไม่ใส่ชื่อสวยจาก Registry)', async () => {
    await runLineFlow('ซื้อ AAPL 1000');
    const lineArgs = assetRepository.create.mock.calls[0];

    jest.clearAllMocks();
    setupPendingFake();
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    assetRepository.create.mockResolvedValue({ id: ASSET_ID, symbol: 'AAPL', type: 'stock_us' });
    assetRepository.countActiveByUser.mockResolvedValue(1);
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
