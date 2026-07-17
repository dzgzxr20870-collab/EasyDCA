// ═══════════════════════════════════════════════════════════════════════════
// Regression: ซื้อ USD → กดยกเลิก → พอร์ตต้องกลับไปเท่าก่อนซื้อทุกสกุล
// ═══════════════════════════════════════════════════════════════════════════
// Mock แค่ Boundary (DB Repository / Price Feed / FX) — Logic ทั้งเส้นเป็นของจริง:
//   transaction.service (processBuyCommand) → undoTransaction.service
//   → portfolio.service → portfolioSummary.service → dashboardOverview.service
//
// ใช้ Fake Store ใน Memory แทน DB จริง เพื่อให้ findAllByAsset/findRecentByUser
// คืนข้อมูลที่ "เรียงตามเวลาจริง" เหมือน Postgres (สำคัญมากต่อ Moving Average
// Cost Basis ที่ Replay ตามลำดับ date → created_at)

jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');

const transactionService = require('../src/services/transaction.service');
const undoTransactionService = require('../src/services/undoTransaction.service');
const dashboardOverview = require('../src/services/dashboardOverview.service');

const USER_ID = 'user-uuid-1';
const AAPL_ID = 'asset-aapl';
const PTT_ID = 'asset-ptt';

const AAPL = {
  id: AAPL_ID,
  userId: USER_ID,
  symbol: 'AAPL',
  name: 'AAPL',
  type: 'stock_us',
  projId: null,
  fundClassName: null,
  isActive: true,
};
const PTT = {
  id: PTT_ID,
  userId: USER_ID,
  symbol: 'PTT',
  name: 'PTT',
  type: 'stock_th',
  projId: null,
  fundClassName: null,
  isActive: true,
};

let store;
let clock;

// เรียงแบบเดียวกับ Postgres ORDER BY date, created_at
function byTimeAsc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

function setupFakeDb() {
  store = [];
  clock = 0;

  transactionRepository.create.mockImplementation(async (data) => {
    clock += 1;
    const row = {
      ...data,
      id: `txn-${clock}`,
      // Repository จริงคืน currency ?? 'THB' (migration 012 DEFAULT) — จำลองให้ตรง
      // เพื่อให้เห็นผลจริงของการ "ไม่ส่ง currency" เข้ามา
      currency: data.currency ?? 'THB',
      createdAt: `2026-07-17T10:00:${String(clock).padStart(2, '0')}.000Z`,
    };
    store.push(row);
    return row;
  });

  transactionRepository.findAllByAsset.mockImplementation(async (assetId) =>
    store.filter((tx) => tx.assetId === assetId).sort(byTimeAsc)
  );

  transactionRepository.findAllByUser.mockImplementation(async (userId) =>
    store
      .filter((tx) => tx.userId === userId)
      .map((tx) => ({ ...tx, symbol: tx.assetId === AAPL_ID ? 'AAPL' : 'PTT' }))
      .sort((a, b) => byTimeAsc(b, a))
  );

  transactionRepository.findRecentByUser.mockImplementation(async (userId, limit) =>
    store
      .filter((tx) => tx.userId === userId)
      .sort((a, b) => byTimeAsc(b, a))
      .slice(0, limit)
  );

  assetRepository.findActiveByUser.mockResolvedValue([AAPL, PTT]);
  assetRepository.findByUserAndSymbol.mockImplementation(async (userId, symbol) =>
    symbol === 'AAPL' ? AAPL : PTT
  );
  assetRepository.findByIds.mockImplementation(async (ids) =>
    [AAPL, PTT].filter((a) => ids.includes(a.id))
  );
  assetRepository.countActiveByUser.mockResolvedValue(2);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-07-17T05:00:00Z'), doNotFake: ['performance'] });
  setupFakeDb();

  // ราคาตลาดปัจจุบัน: AAPL = 100 USD (3500 THB) / PTT ไม่มี Price Feed (หุ้นไทย)
  priceFeedService.getCurrentPriceUsd.mockImplementation(async (symbol) =>
    symbol === 'AAPL' ? 100 : null
  );
  priceFeedService.getCurrentPrice.mockImplementation(async (symbol) =>
    symbol === 'AAPL' ? 3500 : null
  );
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-07-17', stale: false });
});

afterEach(() => {
  jest.useRealTimers();
});

// สถานะตั้งต้น: มี USD อยู่แล้ว 100 USD (AAPL) + THB อยู่แล้ว 1700 บาท (PTT)
// จงใจให้ AAPL มียอดคงค้างก่อนแล้ว เพื่อให้หลัง Undo สินทรัพย์ "ยังอยู่ในพอร์ต"
// (ถ้าเริ่มจากศูนย์แล้วซื้อ→ยกเลิก heldQuantity จะเป็น 0 แล้วถูกกรองออกจากพอร์ตทั้งตัว
// ทำให้ยอดกลับเป็น 0 เองโดยไม่ได้พิสูจน์อะไรเกี่ยวกับสกุลเงินของ Reversal เลย)
async function seedInitialHoldings() {
  await transactionService.processBuyCommand(USER_ID, {
    symbol: 'AAPL',
    type: 'stock_us',
    currency: 'USD',
    quantity: 1,
    pricePerUnit: 100,
    date: '2026-06-01',
  });
  await transactionService.processBuyCommand(USER_ID, {
    symbol: 'PTT',
    type: 'stock_th',
    quantity: 50,
    pricePerUnit: 34,
    date: '2026-06-02',
  });
}

describe('ซื้อสินทรัพย์ USD แล้วกดยกเลิก → พอร์ตกลับไปเท่าเดิมทุกสกุล', () => {
  test('investedByCurrency.USD และ .THB กลับมาเท่ากับค่าก่อนซื้อ', async () => {
    await seedInitialHoldings();

    const before = await dashboardOverview.getOverview(USER_ID);
    expect(before.portfolio.investedByCurrency).toEqual({ THB: 1700, USD: 100 });

    // ซื้อ AAPL เพิ่ม 50 USD (ระบบดึงราคา USD เอง → qty 0.5)
    const buy = await transactionService.processBuyCommand(USER_ID, {
      symbol: 'AAPL',
      type: 'stock_us',
      currency: 'USD',
      amountThb: 50, // = ยอดในสกุลของ currency (USD) ตาม Semantics เดิม
      date: '2026-07-17',
    });
    expect(buy.currency).toBe('USD');

    const afterBuy = await dashboardOverview.getOverview(USER_ID);
    expect(afterBuy.portfolio.investedByCurrency).toEqual({ THB: 1700, USD: 150 });

    // กดยกเลิกรายการล่าสุด
    const undone = await undoTransactionService.undoLastTransaction(USER_ID);
    expect(undone.originalTransactionId).toBe(buy.transactionId);

    const after = await dashboardOverview.getOverview(USER_ID);

    // ต้องกลับไปเท่ากับก่อนซื้อ "ทุกสกุล" ไม่มียอดตกค้าง/ไหลข้ามสกุล
    expect(after.portfolio.investedByCurrency).toEqual(before.portfolio.investedByCurrency);
    expect(after.portfolio.investedByCurrency.USD).toBe(100);
    expect(after.portfolio.investedByCurrency.THB).toBe(1700);
  });

  test('แถว Reversal ต้องเก็บสกุลเงินตรงกับรายการต้นฉบับ (USD ไม่ใช่ THB)', async () => {
    await seedInitialHoldings();

    const buy = await transactionService.processBuyCommand(USER_ID, {
      symbol: 'AAPL',
      type: 'stock_us',
      currency: 'USD',
      amountThb: 50,
      date: '2026-07-17',
    });

    await undoTransactionService.undoLastTransaction(USER_ID);

    const reversal = store.find((tx) => tx.note === `UNDO_OF:${buy.transactionId}`);
    expect(reversal).toBeDefined();
    // รายการต้นฉบับเป็น USD → รายการที่ย้อนกลับต้องเป็น USD ด้วย
    // (ถ้าเป็น 'THB' = Ledger มีแถวที่บอกสกุลผิดจากความจริง)
    expect(reversal.currency).toBe('USD');
  });

  // กันการ Fix สกุลเงินไปกระทบ Path เดิม (LINE/THB) ซึ่งเป็นเคสส่วนใหญ่ของระบบ
  test('ย้อนรายการ THB ยังได้ Reversal สกุล THB เท่าเดิม (ไม่กระทบ Path เดิม)', async () => {
    await seedInitialHoldings();

    const buy = await transactionService.processBuyCommand(USER_ID, {
      symbol: 'PTT',
      type: 'stock_th',
      quantity: 10,
      pricePerUnit: 34,
      date: '2026-07-17',
    });
    expect(buy.currency).toBe('THB');

    await undoTransactionService.undoLastTransaction(USER_ID);

    const reversal = store.find((tx) => tx.note === `UNDO_OF:${buy.transactionId}`);
    expect(reversal.currency).toBe('THB');

    // และยอด THB ต้องกลับไปเท่าก่อนซื้อเช่นกัน
    const after = await dashboardOverview.getOverview(USER_ID);
    expect(after.portfolio.investedByCurrency.THB).toBe(1700);
  });

  test('รายการล่าสุดบน Dashboard แสดงสกุลของ Reversal ตรงกับต้นฉบับ', async () => {
    await seedInitialHoldings();

    await transactionService.processBuyCommand(USER_ID, {
      symbol: 'AAPL',
      type: 'stock_us',
      currency: 'USD',
      amountThb: 50,
      date: '2026-07-17',
    });
    await undoTransactionService.undoLastTransaction(USER_ID);

    const overview = await dashboardOverview.getOverview(USER_ID);
    const latest = overview.recent[0];

    expect(latest.side).toBe('sell'); // แถว Reversal
    expect(latest.amountTotal).toBe(50);
    // ผู้ใช้ต้องเห็น "ขาย AAPL 50 USD" ไม่ใช่ "50 THB"
    expect(latest.currency).toBe('USD');
  });
});
