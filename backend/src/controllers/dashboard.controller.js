const portfolioService = require('../services/portfolio.service');
const profitService = require('../services/profit.service');
const fxRateService = require('../services/fxRate.service');
const dashboardOverviewService = require('../services/dashboardOverview.service');
const transactionRepository = require('../repositories/transaction.repository');
const userRepository = require('../repositories/user.repository');
const entitlementService = require('../services/entitlement.service');
const storageService = require('../services/storage.service');

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

    // แนบรูปสลิป (S8) — คืนแค่ธง hasSlip ไม่ใช่ URL โดยเจตนา: Bucket เป็น Private
    // ต้องใช้ Signed URL ที่หมดอายุ ถ้าจะ Sign ทุกแถวตรงนี้จะกลายเป็นการยิง Storage
    // API 1000 ครั้งต่อการโหลดตารางหนึ่งครั้ง (limit=1000) ทั้งที่ผู้ใช้อาจไม่กดดูสัก
    // รูปเลย — Frontend จึงลิงก์ไป GET /dashboard/transactions/:id/slip แทน แล้วค่อย
    // Sign สดตอนกดจริง (ทีละรูป) | ไม่ส่ง slipImagePath ออกไปด้วยเพื่อไม่เปิดเผย
    // โครงสร้าง Storage ให้ Client โดยไม่จำเป็น
    const withSlipFlag = transactions.map(({ slipImagePath, ...tx }) => ({
      ...tx,
      hasSlip: Boolean(slipImagePath),
    }));

    return res.status(200).json({ transactions: withSlipFlag });
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

// GET /api/v1/dashboard/overview — ข้อมูลทั้งหน้า Dashboard ใหม่ในครั้งเดียว
// (S8 Round 1a) — Reuse ทุกสูตรเดิมผ่าน dashboardOverview.service ไม่คำนวณเงินที่นี่
// Endpoint เดิม 4 ตัวด้านบนยังอยู่ครบ ไม่ถูกแตะ (Additive — ของเดิมที่ Frontend
// ปัจจุบันใช้อยู่ยังทำงานเหมือนเดิมทุกประการ)
async function getOverview(req, res) {
  try {
    const overview = await dashboardOverviewService.getOverview(req.user.id);
    return res.status(200).json(overview);
  } catch (err) {
    console.error(`[dashboard] getOverview failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/v1/dashboard/transactions/:id/slip — เปิดรูปสลิปต้นฉบับของธุรกรรม (S8)
//
// Bucket transaction-slips เป็น Private (สลิปโบรกเกอร์มักโชว์เลขบัญชี/ยอดคงเหลือ)
// จึงไม่มี URL ถาวรให้ลิงก์ตรง — Endpoint นี้สร้าง Signed URL อายุ 5 นาทีสดๆ ตอน
// เจ้าของกดดู แล้วคืนเป็น JSON ให้ Frontend เอาไปแสดง
//
// ⚠️ คืน JSON ไม่ใช่ 302 Redirect โดยเจตนา: ทุก Route ที่นี่ต้องมี Header
// "Authorization: Bearer" ซึ่ง <a href> ธรรมดาแนบไม่ได้ — Frontend จึงต้องเรียกผ่าน
// apiGet (ที่แนบ Token ให้) แล้วรับ URL มาแสดงเอง ถ้าตอบเป็น 302 ตัว fetch จะวิ่งตาม
// Redirect ไปโหลดไฟล์รูปมาเป็น Response แทนที่จะได้ URL กลับมา ใช้งานไม่ได้
//
// ⚠️ ตรวจความเป็นเจ้าของที่ชั้น Query (findByIdForUser กรอง user_id ไปพร้อมกัน)
// ไม่ใช่ดึงมาแล้วค่อยเทียบ — กันเดา transaction id ของคนอื่นเพื่อขอ Signed URL
// ตอบ 404 เหมือนกันทั้งกรณี "ไม่มีจริง" และ "ไม่ใช่ของเรา" (ไม่บอกใบ้ว่า id มีอยู่)
async function getTransactionSlip(req, res) {
  try {
    const tx = await transactionRepository.findByIdForUser(req.params.id, req.user.id);
    if (!tx || !tx.slipImagePath) {
      return res.status(404).json({ error: 'SLIP_NOT_FOUND' });
    }

    const signedUrl = await storageService.createTransactionSlipSignedUrl(tx.slipImagePath);
    if (!signedUrl) {
      // Sign ไม่สำเร็จ (ไฟล์หายจาก Bucket/Storage ล่ม) — แยก Error จาก 404 เพื่อให้
      // แยกออกว่า "ไม่มีสลิป" กับ "มีสลิปแต่เปิดไม่ได้ตอนนี้" คนละเรื่องกัน
      return res.status(502).json({ error: 'SLIP_UNAVAILABLE' });
    }

    return res.status(200).json({
      signedUrl,
      expiresInSeconds: storageService.TRANSACTION_SLIP_SIGNED_URL_TTL_SECONDS,
    });
  } catch (err) {
    console.error(`[dashboard] getTransactionSlip failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { getPortfolio, getHistory, getProfit, getMe, getOverview, getTransactionSlip };
