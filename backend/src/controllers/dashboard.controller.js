const portfolioService = require('../services/portfolio.service');
const profitService = require('../services/profit.service');
const transactionRepository = require('../repositories/transaction.repository');

// Default เท่ากับที่ Requirement กำหนด (ต่างจาก historyService.getRecentHistory
// ที่ใช้ 5 สำหรับคำสั่ง LINE "ประวัติ" — Dashboard ต้องการเห็นได้มากกว่านั้น)
const DEFAULT_HISTORY_LIMIT = 50;

// GET /api/v1/dashboard/portfolio — Reuse portfolioService.getPortfolioSummary
// ตรงๆ (ใช้ Logic เดียวกับคำสั่ง LINE "พอต" ทุกประการ ไม่คำนวณซ้ำ)
async function getPortfolio(req, res) {
  try {
    const summary = await portfolioService.getPortfolioSummary(req.user.id);
    return res.status(200).json(summary);
  } catch (err) {
    console.error(`[dashboard] getPortfolio failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/v1/dashboard/history?symbol=BTC&limit=50 — ดึงข้อมูลดิบผ่าน
// transactionRepository.findAllByUser แล้ว Filter/Limit ในชั้นนี้เท่านั้น
// (ไม่มี Logic คำนวณเงินใดๆ ในฟังก์ชันนี้)
async function getHistory(req, res) {
  try {
    let transactions = await transactionRepository.findAllByUser(req.user.id);

    if (req.query.symbol) {
      const normalized = String(req.query.symbol).trim().toUpperCase();
      transactions = transactions.filter((tx) => tx.symbol === normalized);
    }

    const limit = req.query.limit ? Number(req.query.limit) : DEFAULT_HISTORY_LIMIT;
    if (Number.isFinite(limit) && limit > 0) {
      transactions = transactions.slice(0, limit);
    }

    return res.status(200).json({ transactions });
  } catch (err) {
    console.error(`[dashboard] getHistory failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/v1/dashboard/profit/:symbol — Reuse profitService.getAssetProfit
// ตรงๆ (Logic เดียวกับคำสั่ง LINE "กำไร" ทุกประการ) — Error Code เดิมจาก
// ProfitServiceError (ASSET_NOT_FOUND / NO_HOLDING_TO_CALCULATE_PROFIT /
// PRICE_FEED_NOT_IMPLEMENTED) ทุกกรณีเป็น "ทรัพยากรที่ขอไม่พร้อมใช้งาน" จึงตอบ
// 404 พร้อม code เดิมให้ Client แยกแยะเอง (ไม่ Map เป็นข้อความไทยเหมือน LINE
// เพราะฝั่ง Web ยังไม่มี Requirement เรื่องข้อความ)
async function getProfit(req, res) {
  try {
    const profit = await profitService.getAssetProfit(req.user.id, req.params.symbol.toUpperCase());
    return res.status(200).json(profit);
  } catch (err) {
    if (err instanceof profitService.ProfitServiceError) {
      return res.status(404).json({ error: err.code });
    }

    console.error(`[dashboard] getProfit failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { getPortfolio, getHistory, getProfit };
