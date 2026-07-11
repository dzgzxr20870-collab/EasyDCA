const portfolioService = require('../services/portfolio.service');
const profitService = require('../services/profit.service');
const fxRateService = require('../services/fxRate.service');
const transactionRepository = require('../repositories/transaction.repository');
const userRepository = require('../repositories/user.repository');
const entitlementService = require('../services/entitlement.service');

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Default เท่ากับที่ Requirement กำหนด (ต่างจาก historyService.getRecentHistory
// ที่ใช้ 5 สำหรับคำสั่ง LINE "ประวัติ" — Dashboard ต้องการเห็นได้มากกว่านั้น)
const DEFAULT_HISTORY_LIMIT = 50;

// GET /api/v1/dashboard/portfolio — Reuse portfolioService.getPortfolioSummary
// ตรงๆ (ใช้ Logic เดียวกับคำสั่ง LINE "พอต" ทุกประการ ไม่คำนวณซ้ำ)
async function getPortfolio(req, res) {
  try {
    const summary = await portfolioService.getPortfolioSummary(req.user.id);

    // Multi-Currency (Round 10) — แนบ "อัตราแลกเปลี่ยน USD→THB เดียว" ให้ Frontend
    // ใช้แปลงยอด USD เป็นบาทก่อน "รวมข้ามสกุล" (การ์ดมูลค่ารวม/Donut/กราฟเงินออม)
    // ดึงเรตเฉพาะเมื่อพอร์ตมี USD จริง (พอร์ต THB ล้วนไม่ยิง FX — คง Behavior เดิม)
    // ไม่แตะ portfolio.service (Reuse โดย LINE "พอต") — Enrich เฉพาะ Path Web ที่นี่
    const investedThb = summary.investedByCurrency?.THB ?? summary.totalInvested ?? 0;
    const investedUsd = summary.investedByCurrency?.USD ?? 0;

    let fx = null;
    if (investedUsd > 0) {
      fx = await fxRateService.getUsdThbRate(); // { rate, asOf, stale } | null
    }
    const usdRate = fx ? fx.rate : null;

    return res.status(200).json({
      ...summary,
      // เรตเดียวสำหรับแปลงทุกยอด USD ในหน้านี้ (null = ไม่มี USD หรือดึงเรตไม่ได้)
      fxRate: usdRate,
      fxAsOf: fx ? fx.asOf : null,
      fxStale: fx ? fx.stale : false,
      // true = มี USD แต่ดึงเรตไม่ได้ → Frontend ต้องเตือน ไม่แสดงยอดรวมที่ผิด
      fxUnavailableForUsd: investedUsd > 0 && usdRate === null,
      // เงินลงทุนรวม "เทียบบาท" (THB + USD×เรต) — พอร์ต THB ล้วน = ค่าเดิมทุกประการ
      investedThbEquivalent:
        usdRate !== null ? roundToTwo(investedThb + investedUsd * usdRate) : roundToTwo(investedThb),
    });
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

// GET /api/v1/dashboard/me — คืนสถานะ Plan ของ User ปัจจุบัน สำหรับ Frontend
// ใช้ตัดสินว่าจะโชว์ Free/Premium Banner แบบไหน (ไม่มี Logic คำนวณเงินใดๆ
// Reuse entitlement.service ที่เดียวกับทุกจุดของระบบ ไม่เทียบ plan==='premium' เอง)
async function getMe(req, res) {
  try {
    const user = await userRepository.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    return res.status(200).json({
      plan: user.plan,
      planExpiresAt: user.planExpiresAt ?? null,
      isPremiumActive: entitlementService.isPremiumActive(user),
      assetLimit: entitlementService.getActiveAssetLimit(user),
      // role มาจาก JWT (req.user.role) ที่ requireAuth แนบไว้ — Frontend ใช้ตัดสิน
      // ว่าจะเปิด Route /admin ให้ไหม (Source เดียวกับที่ requireAdmin ใช้ ไม่คำนวณซ้ำ)
      role: req.user.role,
    });
  } catch (err) {
    console.error(`[dashboard] getMe failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { getPortfolio, getHistory, getProfit, getMe };
