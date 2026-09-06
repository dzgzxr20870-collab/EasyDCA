const portfolioService = require('../services/portfolio.service');
const profitService = require('../services/profit.service');
// Stage 5 (migration 046) — assertOwnedBrokerId: ด่านบังคับก่อนเอา brokerId จาก
// Query String ของผู้ใช้ไปใช้ (FK ตรวจแค่ว่ามีอยู่ ไม่ได้ตรวจว่าเป็นของใคร)
const brokerService = require('../services/broker.service');
// assertOwnedPortfolioId — ด่านบังคับก่อนเอา portfolioId จาก Query String ไปใช้
// (กฎยืนข้อ 4 · คู่แฝดของ assertOwnedBrokerId)
const portfoliosService = require('../services/portfolios.service');
const fxRateService = require('../services/fxRate.service');
const dashboardOverviewService = require('../services/dashboardOverview.service');
const transactionRepository = require('../repositories/transaction.repository');
const assetRepository = require('../repositories/asset.repository');
const userRepository = require('../repositories/user.repository');
const entitlementService = require('../services/entitlement.service');
const storageService = require('../services/storage.service');
const dcaStatsService = require('../services/dcaStats.service');
const dividendService = require('../services/dividend.service');

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Default เท่ากับที่ Requirement กำหนด (ต่างจาก historyService.getRecentHistory
// ที่ใช้ 5 สำหรับคำสั่ง LINE "ประวัติ" — Dashboard ต้องการเห็นได้มากกว่านั้น)
const DEFAULT_HISTORY_LIMIT = 50;

// จำนวนเดือนย้อนหลังของกราฟเงินลงทุนสะสม — เท่ากับ dashboardOverview.service
// (CHART_MONTHS ที่นั่น) โดยเจตนา ให้กราฟรายพอร์ตกับกราฟทั้งบัญชีมีหน้าต่างเวลา
// เท่ากันเป๊ะ (ไม่ Export ค่านั้นมาใช้ร่วมเพราะเป็นแค่ Magic Number ของ Query เดียว
// ไม่ใช่ Logic ที่ต้อง Reuse)
const PORTFOLIO_GROWTH_CHART_MONTHS = 12;

// type ที่นับเป็น "ปันผล" ทั้งคู่ (รับ + ยกเลิก) — ตรงกับ dividendSign() ที่ dividend
// .service ใช้ตัดสิน (buy/sell คืน 0 อยู่แล้วเลยกรองไม่กรองก็ได้ผลรวมเท่ากัน แต่กรอง
// ก่อนที่นี่ให้ "รายการล่าสุด"/"Breakdown ต่อ Symbol" ไม่ปนแถวซื้อ-ขายที่ไม่เกี่ยวเลย)
const DIVIDEND_TYPES = ['dividend', 'dividend_reversal'];

// จำนวนแถวของ "รายการปันผลล่าสุด" ในหน้าสรุป — Pattern เดียวกับ RECENT_LIMIT ของ
// dashboardOverview.service (การ์ด "รายการล่าสุด" ทั้งบัญชี) แค่เป็นค่าคงที่แยก
// เพราะเป็นคนละหน้าคนละบริบท
const DIVIDEND_RECENT_LIMIT = 10;

// Allowlist ตรงกับ CHECK constraint จริงของ transactions.type (migration 047) —
// ค่านอกเหนือจากนี้ถูก "เพิกเฉย" (ไม่กรอง ไม่ Error) ตาม Convention เดิมของไฟล์นี้
// (ดู limit ด้านล่าง — Query Param จัดหมวดเป็น "ตัวช่วยแสดงผล" ไม่ใช่ Input ที่ต้อง
// Validate เข้มแบบ Body เขียนข้อมูล ผิดรูปแค่ทำให้ผลลัพธ์ไม่กรอง ไม่ทำให้ระบบพัง)
const HISTORY_TYPES = ['buy', 'sell', 'dividend', 'dividend_reversal'];

// 'YYYY-MM-DD' เท่านั้น (ตรงกับ transactions.date เป็น DATE Column) — กันส่ง String
// แปลกๆ เข้า .gte()/.lte() ตรงๆ ซึ่งจะทำให้ Postgres Error "invalid input syntax for
// type date" หลุดขึ้นมาเป็น 500 ทั้งที่ควรแค่ไม่กรอง (ไม่ใช่ระบบพังจริง)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// GET /api/v1/dashboard/history?symbol=BTC&type=buy&dateFrom=2026-07-01&dateTo=
// 2026-07-31&limit=50&offset=0 — ดึงข้อมูลผ่าน transactionRepository
// .findFilteredByUser (Filter/Offset Pagination จริงที่ DB ดู Comment หัวฟังก์ชัน
// นั้น) คืน { transactions, total } — total เป็น Field ใหม่ (Additive ล้วน ไม่กระทบ
// Caller เดิมที่อ่านแค่ .transactions — Dashboard.jsx/DashboardHome.jsx เก่ายังใช้
// ?limit=1000 ไม่มี Filter อื่นได้เหมือนเดิมทุกประการ)
//
// ⚠️ ทุก Query Param เป็น "ตัวช่วยแสดงผล" ไม่ใช่ Input ที่ต้อง Validate เข้มแบบ Body
// เขียนข้อมูล — ค่าที่ผิดรูป/ไม่รู้จัก (type แปลกๆ, วันที่ไม่ใช่ YYYY-MM-DD) แค่ถูก
// "เพิกเฉย" (ไม่กรองมิตินั้น) เหมือน limit เดิม ไม่ใช่ 400 — Endpoint นี้เป็น GET
// อ่านอย่างเดียว กรองพลาดก็แค่เห็นแถวไม่ตรงที่คาด ไม่ใช่ข้อมูลเสียหาย
async function getHistory(req, res) {
  try {
    const q = req.query ?? {};

    const symbol = q.symbol ? String(q.symbol).trim().toUpperCase() : undefined;
    const type = HISTORY_TYPES.includes(q.type) ? q.type : undefined;
    const from = DATE_RE.test(q.dateFrom ?? '') ? q.dateFrom : undefined;
    const to = DATE_RE.test(q.dateTo ?? '') ? q.dateTo : undefined;

    const rawLimit = q.limit ? Number(q.limit) : DEFAULT_HISTORY_LIMIT;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_HISTORY_LIMIT;
    const rawOffset = q.offset ? Number(q.offset) : 0;
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const { transactions, total } = await transactionRepository.findFilteredByUser(req.user.id, {
      type,
      from,
      to,
      symbol,
      limit,
      offset,
    });

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

    return res.status(200).json({ transactions: withSlipFlag, total });
  } catch (err) {
    console.error(`[dashboard] getHistory failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/v1/dashboard/portfolio-growth?portfolioId=<uuid> — กราฟ "เงินลงทุน
// สะสม" รายเดือน ≤12 เดือน กรองเฉพาะธุรกรรมของพอร์ตเดียว (หน้ารายละเอียดพอร์ต
// /app/portfolio) — Reuse dcaStatsService.getMonthlyInvestedSeries ตัวเดียวกับ
// GET /dashboard/overview เป๊ะ (ห้ามคำนวณสูตรใหม่) แค่ป้อน Array ธุรกรรมที่กรอง
// ด้วยพอร์ตแทน Array ทั้งบัญชี
//
// ⚠️ portfolio_id ไม่ได้อยู่ในตาราง transactions (อยู่ที่ assets.portfolio_id
// ตาม migration 044/045) — จึงต้อง Resolve สินทรัพย์ของพอร์ตนี้ก่อน
// (assetRepository.findByPortfolio) แล้วค่อยดึงธุรกรรมของสินทรัพย์เหล่านั้น
// (transactionRepository.findAllByAssets) ไม่ใช่ .eq('portfolio_id', ...) ตรงๆ
// บน transactions เพราะ Column นั้นไม่มีอยู่จริง
//
// ⚠️ portfolioId บังคับต้องส่งมาเสมอ (endpoint นี้ไม่มีความหมายถ้าไม่กรองพอร์ต
// ต่างจาก getProfit ที่ optional ได้) และต้องผ่าน assertOwnedPortfolioId เพื่อกัน
// User ขอกราฟของพอร์ตคนอื่นด้วยการเดา UUID (Pattern เดียวกับ getProfit)
async function getPortfolioGrowth(req, res) {
  try {
    const rawPortfolio = req.query.portfolioId;
    if (!rawPortfolio) {
      return res.status(400).json({ error: 'VALIDATION_ERROR' });
    }

    const portfolioId = await portfoliosService.assertOwnedPortfolioId(req.user.id, rawPortfolio);

    const assets = await assetRepository.findByPortfolio(req.user.id, portfolioId);
    const assetIds = assets.map((asset) => asset.id);
    const transactions = await transactionRepository.findAllByAssets(assetIds, req.user.id);

    const monthlyInvested = dcaStatsService.getMonthlyInvestedSeries(
      transactions,
      PORTFOLIO_GROWTH_CHART_MONTHS
    );

    return res.status(200).json({ monthlyInvested });
  } catch (err) {
    if (err instanceof portfoliosService.PortfolioServiceError) {
      return res.status(err.code === 'PORTFOLIO_NOT_FOUND' ? 404 : 400).json({ error: err.code });
    }

    console.error(`[dashboard] getPortfolioGrowth failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/v1/dashboard/dividend-summary?portfolioId=<uuid> — สรุปเงินปันผลที่เคย
// ได้รับ (หน้า /app/portfolio ตอนเปิดพอร์ต + /app/dashboard ภาพรวมทั้งบัญชี)
//
// portfolioId **Optional** (ต่างจาก getPortfolioGrowth ที่บังคับ) — ไม่ส่ง =
// สรุปทั้งบัญชี (ตรวจสอบกับ findAllByUser ตรงๆ), ส่งมา = เฉพาะพอร์ตนั้น (Resolve
// สินทรัพย์ก่อนผ่าน findByPortfolio แล้วดึงธุรกรรมด้วย findAllByAssets — Pattern
// เดียวกับ getPortfolioGrowth เป๊ะ เพราะ portfolio_id อยู่ที่ assets ไม่ใช่
// transactions) ผ่าน assertOwnedPortfolioId กัน User เดา UUID พอร์ตคนอื่น
//
// ⚠️ Reuse dividendService.calculateTotalDividend() ตรงๆ ทุกจุด (Design Doc § 5.3
// ห้ามคำนวณสูตรใหม่) — สิ่งเดียวที่ทำเองคือ "กรองแถว" (ตาม type/currency/symbol)
// ก่อนป้อนเข้าฟังก์ชันเดิม ไม่ใช่เขียน Sum เอง
//
// ⚠️ แยกยอดตามสกุลเงินเสมอ (totalDividendByCurrency ไม่ใช่ยอดก้อนเดียว) —
// เหตุผลเดียวกับ dcaStatsService.getMonthlyInvestedSeries: amount_thb เก็บ "ยอด
// ในสกุลของแถวนั้นตามจริง" (migration 012) หุ้นสหรัฐจ่ายปันผลเป็น USD ได้จริง
// (ดู dividend.service.recordDividend — currency ตามสินทรัพย์) รวมข้าม THB/USD
// เป็นก้อนเดียวจะผิดแบบเงียบๆ เหมือนทุกจุดอื่นของระบบที่ห้ามไว้ (fxUnavailableForUsd
// /amountByCurrency ฯลฯ)
async function getDividendSummary(req, res) {
  try {
    const rawPortfolio = req.query.portfolioId;
    const portfolioId =
      rawPortfolio === undefined
        ? undefined
        : await portfoliosService.assertOwnedPortfolioId(req.user.id, rawPortfolio);

    let transactions;
    if (portfolioId !== undefined) {
      const assets = await assetRepository.findByPortfolio(req.user.id, portfolioId);
      const assetIds = assets.map((asset) => asset.id);
      transactions = await transactionRepository.findAllByAssets(assetIds, req.user.id);
    } else {
      transactions = await transactionRepository.findAllByUser(req.user.id);
    }

    const dividendTx = transactions.filter((tx) => DIVIDEND_TYPES.includes(tx.type));

    const totalDividendByCurrency = {
      THB: dividendService.calculateTotalDividend(
        dividendTx.filter((tx) => tx.currency !== 'USD')
      ),
      USD: dividendService.calculateTotalDividend(
        dividendTx.filter((tx) => tx.currency === 'USD')
      ),
    };

    // Breakdown ต่อ Symbol — Symbol เดียวกันมีสกุลเดียวเสมอ (ผูกกับ asset.currency)
    // จึงแนบ currency ต่อแถวได้โดยไม่ต้องแยก THB/USD ซ้ำในระดับนี้
    const bySymbolMap = new Map();
    for (const tx of dividendTx) {
      const key = tx.symbol ?? 'UNKNOWN';
      if (!bySymbolMap.has(key)) bySymbolMap.set(key, []);
      bySymbolMap.get(key).push(tx);
    }
    const bySymbol = Array.from(bySymbolMap.entries())
      .map(([symbol, txs]) => ({
        symbol,
        currency: txs.some((tx) => tx.currency === 'USD') ? 'USD' : 'THB',
        total: dividendService.calculateTotalDividend(txs),
      }))
      .sort((a, b) => b.total - a.total);

    // รายการล่าสุด — เรียง date DESC เอง เพราะ findAllByAssets (ต่างจาก
    // findAllByUser) ไม่ได้ .order() ที่ DB มาให้ (ดู Comment ของฟังก์ชันนั้น)
    const recent = dividendTx
      .slice()
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
      .slice(0, DIVIDEND_RECENT_LIMIT)
      .map((tx) => ({
        date: tx.date,
        symbol: tx.symbol,
        currency: tx.currency,
        amountThb: Number(tx.amountThb),
        type: tx.type,
      }));

    return res.status(200).json({ totalDividendByCurrency, bySymbol, recent });
  } catch (err) {
    if (err instanceof portfoliosService.PortfolioServiceError) {
      return res.status(err.code === 'PORTFOLIO_NOT_FOUND' ? 404 : 400).json({ error: err.code });
    }

    console.error(`[dashboard] getDividendSummary failed: ${err.message}`);
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
    // Stage 5 (migration 046) — ?brokerId=<uuid|none> เจาะจงว่าหมายถึงสินทรัพย์
    // แถวไหน เมื่อผู้ใช้ถือ Symbol เดียวกันหลายโบรก
    //   ไม่ส่งมาเลย = undefined → ถ้ากำกวมจะได้ 409 AMBIGUOUS_ASSET_BROKER กลับไป
    //                 พร้อม candidates ให้ Frontend เอาไปทำตัวเลือก
    //   'none'      = เจาะจงแถวที่ไม่ได้ผูกโบรก (null) — ไม่ใช่ "ยังไม่ได้ระบุ"
    //
    // ⚠️ ต้องผ่าน assertOwnedBrokerId เสมอ: brokerId มาจาก Query String ที่ผู้ใช้
    // กำหนดเองได้ 100% (Design Doc § 6.3)
    const rawBroker = req.query.brokerId;
    const brokerId =
      rawBroker === undefined
        ? undefined
        : await brokerService.assertOwnedBrokerId(req.user.id, rawBroker === 'none' ? null : rawBroker);

    // ⚠️⚠️ **ห้ามส่ง `null` แบบ Hardcode ตรงนี้** (Stage 8-fix รอบ 4 — 27 ส.ค. 2569)
    // เดิมบรรทัด portfolioId ส่ง `null` ซึ่งแปลว่า "เจาะจงว่าไม่มีพอร์ต" →
    // หลัง Backfill ของ 044 ไม่เหลือแถวแบบนั้นเลย → **404 ASSET_NOT_FOUND ทุกครั้ง**
    //
    // กติกาเดียวกับ brokerId ข้างบนเป๊ะ (ไม่ใช่ Pattern ใหม่):
    //   ไม่ส่งมาเลย = undefined → ไม่กรองพอร์ต · กำกวมเมื่อไหร่ได้ 409 พร้อม candidates
    //   'none'      = เจาะจงแถวที่ไม่ได้สังกัดพอร์ต (null) — โลกก่อน 044
    //   '<uuid>'    = เจาะจงพอร์ตนั้น
    //
    // ⚠️ ต้องผ่าน assertOwnedPortfolioId เสมอ: มาจาก Query String ที่ผู้ใช้กำหนดเอง
    // ได้ 100% (กฎยืนข้อ 4) — เหตุผลเดียวกับ brokerId
    const rawPortfolio = req.query.portfolioId;
    const portfolioId =
      rawPortfolio === undefined
        ? undefined
        : await portfoliosService.assertOwnedPortfolioId(
            req.user.id,
            rawPortfolio === 'none' ? null : rawPortfolio
          );

    const profit = await profitService.getAssetProfit(
      req.user.id,
      req.params.symbol.toUpperCase(),
      portfolioId,
      {},
      brokerId
    );
    return res.status(200).json(profit);
  } catch (err) {
    // กำกวม = "คำขอยังไม่ครบพอจะตอบได้" ไม่ใช่ "ไม่พบ" — ตอบ 409 พร้อม candidates
    // ให้ Frontend ถามผู้ใช้ต่อได้ทันทีโดยไม่ต้องยิง Query เพิ่ม
    // ⚠️ ต้องครอบ **ทั้งสองมิติ** — ถ้าครอบแค่ BROKER มิติพอร์ตจะหลุดไปเป็น
    // 500 INTERNAL_ERROR ทั้งที่เป็นคำขอที่ถูกต้องแค่ยังไม่ครบพอจะตอบได้
    if (err?.code === 'AMBIGUOUS_ASSET_BROKER' || err?.code === 'AMBIGUOUS_ASSET_PORTFOLIO') {
      return res
        .status(409)
        .json({ error: err.code, candidates: err.details?.candidates ?? [] });
    }
    if (err instanceof portfoliosService.PortfolioServiceError) {
      return res.status(err.code === 'PORTFOLIO_NOT_FOUND' ? 404 : 400).json({ error: err.code });
    }
    if (err instanceof brokerService.BrokerServiceError) {
      return res.status(err.code === 'BROKER_NOT_FOUND' ? 404 : 400).json({ error: err.code });
    }
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
      // Stage 9 — เพดานพอร์ต ณ ตอนนี้ (Free 1 / Premium 50)
      // ⚠️ ส่งมาจาก Backend เสมอ **ห้าม Frontend Hardcode ตัวเลขเอง** — Demo เดิม
      // (lib/demo/planEntitlements.js) Hardcode ไว้แล้วต้องมานั่ง grep เทียบกับ
      // entitlement.service ทุกครั้งที่แก้ ซึ่งเป็นวิธีที่ "สอนผิดจากระบบจริง" ได้ง่าย
      portfolioLimit: entitlementService.getActivePortfolioLimit(user),
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

module.exports = {
  getPortfolio,
  getHistory,
  getPortfolioGrowth,
  getDividendSummary,
  getProfit,
  getMe,
  getOverview,
  getTransactionSlip,
};
