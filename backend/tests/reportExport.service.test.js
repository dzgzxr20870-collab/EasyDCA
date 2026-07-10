// reportExport.service — ทดสอบ Generation Logic + PDF/Excel Buffer จริง
// Mock เฉพาะ Data Source (portfolio/price/transaction/user) แต่ "ไม่ Mock" pdfkit/
// exceljs เพื่อยืนยันว่า Buffer ที่ Generate ออกมาถูกต้องจริง (อ่าน Excel กลับมาเช็ค Cell)
jest.mock('../src/services/portfolio.service');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/user.repository');

const ExcelJS = require('exceljs');
const portfolioService = require('../src/services/portfolio.service');
const priceFeedService = require('../src/services/priceFeed.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const userRepository = require('../src/repositories/user.repository');
const reportExport = require('../src/services/reportExport.service');

const USER_ID = 'user-1';
// เที่ยงวัน UTC → Bangkok = 10 ก.ค. 2026 (กันคลาดวันใกล้เที่ยงคืน)
const NOW = new Date('2026-07-10T06:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findById.mockResolvedValue({ id: USER_ID, displayName: 'สมชาย ลงทุน' });
});

// ── resolveRange ──────────────────────────────────────────────────────────
describe('resolveRange', () => {
  test('month → ต้นเดือนถึงสิ้นเดือนปัจจุบัน (Asia/Bangkok) + label ไทย/พ.ศ.', () => {
    const r = reportExport.resolveRange({ range: 'month' }, NOW);
    expect(r.from).toBe('2026-07-01');
    expect(r.to).toBe('2026-07-31');
    expect(r.label).toBe('เดือนกรกฎาคม 2569');
  });

  test('range ไม่ระบุ → Default = เดือนนี้', () => {
    const r = reportExport.resolveRange({}, NOW);
    expect(r.from).toBe('2026-07-01');
    expect(r.to).toBe('2026-07-31');
  });

  test('year → 1 ม.ค. ถึง 31 ธ.ค. ปีปัจจุบัน + label "ปี 2569"', () => {
    const r = reportExport.resolveRange({ range: 'year' }, NOW);
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-12-31');
    expect(r.label).toBe('ปี 2569');
  });

  test('custom → ใช้ from/to ที่ส่งมา + label ช่วงวันที่ไทย', () => {
    const r = reportExport.resolveRange({ range: 'custom', from: '2026-01-01', to: '2026-06-30' }, NOW);
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-06-30');
    expect(r.label).toBe('1 มกราคม 2569 - 30 มิถุนายน 2569');
  });

  test('custom from > to → โยน EXPORT_INVALID_RANGE', () => {
    expect(() =>
      reportExport.resolveRange({ range: 'custom', from: '2026-06-30', to: '2026-01-01' }, NOW)
    ).toThrow(expect.objectContaining({ code: 'EXPORT_INVALID_RANGE' }));
  });

  test('custom รูปแบบวันที่ผิด → โยน EXPORT_INVALID_RANGE', () => {
    expect(() =>
      reportExport.resolveRange({ range: 'custom', from: '01/01/2026', to: '2026-06-30' }, NOW)
    ).toThrow(expect.objectContaining({ code: 'EXPORT_INVALID_RANGE' }));
  });
});

// ── buildReportData ─────────────────────────────────────────────────────────
describe('buildReportData', () => {
  test('Asset มีราคา + Asset ไม่มีราคา → แถวครบทั้งคู่, excludedCount + totals ถูกต้อง', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      totalInvested: 31700,
      holdings: [
        { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', heldQuantity: 0.01, totalInvested: 30000, averageCost: 3000000 },
        { symbol: 'PTT', name: 'PTT', type: 'stock_th', heldQuantity: 50, totalInvested: 1700, averageCost: 34 },
      ],
    });
    priceFeedService.getCurrentPrice.mockImplementation(async (symbol) =>
      symbol === 'BTC' ? 4000000 : null
    );
    transactionRepository.findByUserAndDateRange.mockResolvedValue([]);

    const range = reportExport.resolveRange({ range: 'month' }, NOW);
    const data = await reportExport.buildReportData(USER_ID, range, NOW);

    expect(data.holdings).toHaveLength(2);
    const btc = data.holdings.find((h) => h.symbol === 'BTC');
    expect(btc.priceAvailable).toBe(true);
    expect(btc.currentValue).toBe(40000); // 0.01 * 4,000,000
    expect(btc.profitLoss).toBe(10000);

    const ptt = data.holdings.find((h) => h.symbol === 'PTT');
    expect(ptt.priceAvailable).toBe(false);
    expect(ptt.currentValue).toBeNull();

    expect(data.totals.totalInvested).toBe(31700); // ทั้งพอร์ต
    expect(data.totals.totalCurrentValue).toBe(40000); // เฉพาะ BTC
    expect(data.totals.totalProfitLoss).toBe(10000);
    expect(data.totals.excludedCount).toBe(1);
    expect(transactionRepository.findByUserAndDateRange).toHaveBeenCalledWith(
      USER_ID,
      '2026-07-01',
      '2026-07-31'
    );
  });

  test('กองทุน → ใช้ getMutualFundNav (ไม่ใช่ getCurrentPrice); NAV ดึงไม่ได้ → excluded (Fail Isolated)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({
      isEmpty: false,
      totalInvested: 2000,
      holdings: [
        { symbol: 'K-SELECT', name: 'K SELECT', type: 'fund', projId: 'M1', fundClassName: 'A', heldQuantity: 100, totalInvested: 1000, averageCost: 10 },
        { symbol: 'K-DOWN', name: 'K DOWN', type: 'fund', projId: 'M2', fundClassName: 'A', heldQuantity: 50, totalInvested: 1000, averageCost: 20 },
      ],
    });
    priceFeedService.getMutualFundNav.mockImplementation(async (projId) => {
      if (projId === 'M1') return { navDate: '2026-07-09', lastVal: 12.5 };
      throw Object.assign(new Error('down'), { code: 'MUTUAL_FUND_NAV_UNAVAILABLE' });
    });
    transactionRepository.findByUserAndDateRange.mockResolvedValue([]);

    const range = reportExport.resolveRange({ range: 'month' }, NOW);
    const data = await reportExport.buildReportData(USER_ID, range, NOW);

    expect(priceFeedService.getCurrentPrice).not.toHaveBeenCalled();
    expect(data.holdings.find((h) => h.symbol === 'K-SELECT').currentValue).toBe(1250);
    expect(data.holdings.find((h) => h.symbol === 'K-DOWN').priceAvailable).toBe(false);
    expect(data.totals.excludedCount).toBe(1);
  });

  test('พอร์ตว่าง + ไม่มีธุรกรรม → holdings/transactions ว่าง, totals เป็นศูนย์ (ไม่ Error)', async () => {
    portfolioService.getPortfolioSummary.mockResolvedValue({ isEmpty: true, totalInvested: 0, holdings: [] });
    transactionRepository.findByUserAndDateRange.mockResolvedValue([]);

    const range = reportExport.resolveRange({ range: 'month' }, NOW);
    const data = await reportExport.buildReportData(USER_ID, range, NOW);

    expect(data.holdings).toEqual([]);
    expect(data.transactions).toEqual([]);
    expect(data.totals.totalCurrentValue).toBe(0);
    expect(data.totals.excludedCount).toBe(0);
  });

  test('ไม่พบ User → โยน EXPORT_USER_NOT_FOUND', async () => {
    userRepository.findById.mockResolvedValue(null);
    const range = reportExport.resolveRange({ range: 'month' }, NOW);
    await expect(reportExport.buildReportData(USER_ID, range, NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'EXPORT_USER_NOT_FOUND' })
    );
  });
});

// Helper สร้าง reportData สำเร็จรูปสำหรับทดสอบ Builder โดยตรง
function sampleData(overrides = {}) {
  return {
    user: { displayName: 'สมชาย ลงทุน' },
    generatedAt: NOW,
    range: { from: '2026-07-01', to: '2026-07-31', label: 'เดือนกรกฎาคม 2569' },
    holdings: [
      { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', heldQuantity: 0.01, averageCost: 3000000, totalInvested: 30000, currentValue: 40000, profitLoss: 10000, profitLossPercent: 33.33, priceAvailable: true },
      { symbol: 'PTT', name: 'PTT', type: 'stock_th', heldQuantity: 50, averageCost: 34, totalInvested: 1700, currentValue: null, profitLoss: null, profitLossPercent: null, priceAvailable: false },
    ],
    totals: { totalInvested: 31700, totalCurrentValue: 40000, totalProfitLoss: 10000, totalProfitLossPercent: 33.33, excludedCount: 1 },
    transactions: [
      { id: 't1', date: '2026-07-05', symbol: 'BTC', type: 'buy', quantity: 0.005, pricePerUnit: 3000000, amountThb: 15000 },
    ],
    ...overrides,
  };
}

// ── buildPdfReport ─────────────────────────────────────────────────────────
describe('buildPdfReport', () => {
  test('คืน Buffer ที่ไม่ว่าง + Header %PDF ถูกต้อง', async () => {
    const buf = await reportExport.buildPdfReport(sampleData());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('Empty State (ไม่มี holdings/transactions) → ยัง Generate PDF สำเร็จ ไม่ Error', async () => {
    const buf = await reportExport.buildPdfReport(
      sampleData({
        holdings: [],
        transactions: [],
        totals: { totalInvested: 0, totalCurrentValue: 0, totalProfitLoss: 0, totalProfitLossPercent: null, excludedCount: 0 },
      })
    );
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });
});

// ── buildExcelReport (อ่าน Buffer กลับมาเช็ค Cell จริง) ─────────────────────
describe('buildExcelReport', () => {
  test('มี 2 Sheet ชื่อไทย + ข้อมูล Holdings/ธุรกรรม/สรุปรวมถูกต้อง', async () => {
    const buf = await reportExport.buildExcelReport(sampleData());
    expect(Buffer.isBuffer(buf)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    expect(wb.worksheets.map((w) => w.name)).toEqual(['สรุปพอร์ต', 'ประวัติธุรกรรม']);

    const s1 = wb.getWorksheet('สรุปพอร์ต');
    // หา Header Row (คอลัมน์แรก = "สินทรัพย์") แล้วเช็คแถวข้อมูลถัดไป
    let headerRow = null;
    s1.eachRow((row, n) => {
      if (row.getCell(1).value === 'สินทรัพย์') headerRow = n;
    });
    expect(headerRow).not.toBeNull();

    const btcRow = s1.getRow(headerRow + 1);
    expect(btcRow.getCell(1).value).toBe('BTC');
    expect(btcRow.getCell(3).value).toBe(0.01); // จำนวนที่ถือเป็นตัวเลขจริง (Filterable)
    expect(btcRow.getCell(6).value).toBe(40000); // มูลค่าปัจจุบัน

    // แถว PTT (ราคาไม่ได้) — มูลค่าปัจจุบันเป็นข้อความหมายเหตุ
    const pttRow = s1.getRow(headerRow + 2);
    expect(pttRow.getCell(1).value).toBe('PTT');
    expect(pttRow.getCell(6).value).toBe('ราคาไม่พร้อมใช้งาน');

    const s2 = wb.getWorksheet('ประวัติธุรกรรม');
    expect(s2.getRow(1).getCell(1).value).toBe('วันที่');
    expect(s2.getRow(2).getCell(2).value).toBe('BTC');
    expect(s2.getRow(2).getCell(3).value).toBe('ซื้อ');
    expect(s2.getRow(2).getCell(6).value).toBe(15000);
  });

  test('Empty State ธุรกรรม → Sheet 2 แสดง "ไม่มีรายการในช่วงเวลานี้"', async () => {
    const buf = await reportExport.buildExcelReport(sampleData({ transactions: [] }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const s2 = wb.getWorksheet('ประวัติธุรกรรม');
    expect(s2.getRow(2).getCell(1).value).toBe('ไม่มีรายการในช่วงเวลานี้');
  });
});

// ── generatePortfolioReport (End-to-end) ────────────────────────────────────
describe('generatePortfolioReport', () => {
  beforeEach(() => {
    portfolioService.getPortfolioSummary.mockResolvedValue({ isEmpty: true, totalInvested: 0, holdings: [] });
    transactionRepository.findByUserAndDateRange.mockResolvedValue([]);
  });

  test('format=pdf → { buffer(%PDF), filename .pdf, mimeType application/pdf }', async () => {
    const out = await reportExport.generatePortfolioReport(USER_ID, { format: 'pdf', range: { range: 'month' } }, NOW);
    expect(out.buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(out.filename).toBe('EasyDCA-Report-2026-07-01_2026-07-31.pdf');
    expect(out.mimeType).toBe('application/pdf');
  });

  test('format=excel → filename .xlsx + mimeType spreadsheet', async () => {
    const out = await reportExport.generatePortfolioReport(USER_ID, { format: 'excel', range: { range: 'month' } }, NOW);
    expect(out.filename).toBe('EasyDCA-Report-2026-07-01_2026-07-31.xlsx');
    expect(out.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  test('format ไม่ถูกต้อง → โยน EXPORT_INVALID_FORMAT', async () => {
    await expect(
      reportExport.generatePortfolioReport(USER_ID, { format: 'csv', range: { range: 'month' } }, NOW)
    ).rejects.toThrow(expect.objectContaining({ code: 'EXPORT_INVALID_FORMAT' }));
  });
});
