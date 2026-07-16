// Cross-service consistency (แก้บัค P&L — DoD ข้อ 4): getPortfolioSummary,
// getAssetProfit, buildReportData ต้องรายงาน totalInvested/averageCost ตรงกันเสมอ
// สำหรับ Asset เดียวกัน เพราะทั้งสามเรียก calculateTotalInvested (portfolio.service)
// ตัวเดียวกัน ไม่มีใคร Copy สูตรคำนวณเอง — Test นี้เป็นเกราะกันไม่ให้ทั้งสามจุด
// เพี้ยนไม่ตรงกันอีกในอนาคต (เช่นถ้ามีคน Copy สูตรไปเขียนใหม่ในจุดใดจุดหนึ่ง)
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const userRepository = require('../src/repositories/user.repository');
const priceFeedService = require('../src/services/priceFeed.service');

const portfolioService = require('../src/services/portfolio.service');
const profitService = require('../src/services/profit.service');
const reportExportService = require('../src/services/reportExport.service');

const USER_ID = 'user-consistency-1';
const ASSET_BTC = { id: 'asset-btc-1', symbol: 'BTC', name: 'Bitcoin', type: 'crypto' };

// ซื้อ 0.02 @ ทุนรวม 60,000 แล้วขาย 0.01 ได้ 40,000 — เคสเดียวกับที่ยืนยันแล้วว่า
// Moving Average ให้ totalInvested คงเหลือ 30,000 (ไม่ใช่ 20,000 แบบ Net Cash Flow เดิม)
const TRANSACTIONS = [
  { type: 'buy', quantity: 0.02, amountThb: 60000, date: '2024-01-01', createdAt: '2024-01-01T09:00:00.000Z' },
  { type: 'sell', quantity: 0.01, amountThb: 40000, date: '2024-02-01', createdAt: '2024-02-01T09:00:00.000Z' },
];

beforeEach(() => {
  jest.clearAllMocks();

  assetRepository.findActiveByUser.mockResolvedValue([ASSET_BTC]);
  assetRepository.findByUserAndSymbol.mockResolvedValue(ASSET_BTC);
  transactionRepository.findAllByAsset.mockResolvedValue(TRANSACTIONS);
  transactionRepository.findByUserAndDateRange.mockResolvedValue([]);
  userRepository.findById.mockResolvedValue({ id: USER_ID, displayName: 'Test User' });
  // ราคาตลาดปัจจุบันเดียวกัน ใช้ทั้งใน getAssetProfit และ buildReportData
  // (fetchHoldingPrice) เพื่อให้เทียบ totalInvested/averageCost ตรงกันได้ตรงจุด
  priceFeedService.getCurrentPrice.mockResolvedValue(3000000);
});

describe('ความสอดคล้องข้าม Service — totalInvested/averageCost ต้องตรงกันเสมอ', () => {
  test('getPortfolioSummary, getAssetProfit, buildReportData รายงานค่าเดียวกันสำหรับ Asset เดียวกัน', async () => {
    const summary = await portfolioService.getPortfolioSummary(USER_ID);
    const profit = await profitService.getAssetProfit(USER_ID, 'BTC');
    const resolvedRange = reportExportService.resolveRange({ range: 'year' }, new Date('2024-12-31'));
    const reportData = await reportExportService.buildReportData(USER_ID, resolvedRange, new Date('2024-12-31'));

    const summaryBtc = summary.holdings.find((h) => h.symbol === 'BTC');
    const reportBtc = reportData.holdings.find((h) => h.symbol === 'BTC');

    // ทุกจุดต้องเห็นทุนคงเหลือ 30,000 (Moving Average) ตรงกันหมด ไม่ใช่ 20,000 (บัคเดิม)
    expect(summaryBtc.totalInvested).toBe(30000);
    expect(profit.totalInvested).toBe(30000);
    expect(reportBtc.totalInvested).toBe(30000);

    expect(summaryBtc.averageCost).toBe(3000000);
    expect(profit.averageCost).toBe(3000000);
    expect(reportBtc.averageCost).toBe(3000000);

    // Sanity — ทั้งสามค่าต้องเท่ากันเป๊ะ (ไม่ใช่แค่บังเอิญใกล้เคียง)
    expect(profit.totalInvested).toBe(summaryBtc.totalInvested);
    expect(reportBtc.totalInvested).toBe(summaryBtc.totalInvested);
    expect(profit.averageCost).toBe(summaryBtc.averageCost);
    expect(reportBtc.averageCost).toBe(summaryBtc.averageCost);
  });
});
