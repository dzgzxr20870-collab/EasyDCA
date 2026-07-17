const portfolioService = require('./portfolio.service');
const portfolioSummaryService = require('./portfolioSummary.service');
const fxRateService = require('./fxRate.service');
const dcaStatsService = require('./dcaStats.service');
const transactionRepository = require('../repositories/transaction.repository');

// ═══════════════════════════════════════════════════════════════════════════
// dashboardOverview.service — ข้อมูลทั้งหน้า Dashboard ใหม่ในครั้งเดียว (S8 R1a)
// ═══════════════════════════════════════════════════════════════════════════
// ไฟล์นี้เป็น "ตัวประกอบร่าง" (Composition) ล้วนๆ — ไม่มีสูตรเงินใหม่แม้แต่สูตรเดียว:
//  - มูลค่าพอร์ต / กำไร-ขาดทุน (Unrealized) → portfolioSummary.buildSummaryForUser
//  - กำไรที่รับรู้แล้ว (Realized)            → portfolio.getPortfolioSummary (realizedPnL รายตัว)
//  - ราคาตลาดรายตัว + รู้ว่าตัวไหนไม่มีราคา  → portfolioSummary.priceHoldings
//  - จำนวนครั้ง/ยอดเงิน/Streak/กราฟรายเดือน  → dcaStats.service
// ทั้งหมด Reuse ของเดิมที่ LINE ("พอต"/Cron สรุปพอร์ต) ใช้อยู่ทุกประการ
//
// ── ทำไมรวมเป็น Endpoint เดียว ──────────────────────────────────────────────
// หน้า Dashboard ต้องใช้ข้อมูลทุกก้อนนี้พร้อมกันตอนโหลดครั้งแรก การแยกเป็นหลาย
// Endpoint จะทำให้ Frontend ยิงหลายรอบและ "ดึงราคาตลาดซ้ำหลายครั้งต่อการโหลด 1 หน้า"
// (priceHoldings ยิง Price Feed ต่อ Asset) — รวมที่เดียวจึงดึงราคาชุดเดียวใช้ได้ทั้งหน้า
// Endpoint เดิมทั้ง 4 ตัวของ dashboard.routes ยังอยู่ครบไม่ถูกแตะ (Additive)

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// รวมยอด "เทียบบาท" จากยอดแยกสกุล ด้วยเรตเดียว — Pattern เดียวกับที่
// dashboard.controller.getPortfolio และ portfolioSummary.service ใช้อยู่แล้ว
// (usdRate = null → คืนเฉพาะส่วน THB พร้อมให้ Caller ตั้ง Flag เตือน)
function toThbEquivalent(thb, usd, usdRate) {
  return usdRate !== null ? roundToTwo(thb + usd * usdRate) : roundToTwo(thb);
}

// ── Allocation ตามประเภทสินทรัพย์ ──────────────────────────────────────────
// มูลค่าปัจจุบัน group by type (crypto / stock_th / stock_us / gold_bar / ...)
//
// สินทรัพย์ที่ "ไม่มีราคาสด" (หุ้นไทย / NAV ดึงไม่ได้ / API ล่ม) → ตีมูลค่า "ที่ต้นทุน"
// (totalInvested ของตัวนั้น ซึ่งมาจาก Moving Average Cost Basis เดิม ไม่ได้คำนวณใหม่)
// พร้อมส่ง priceUnavailable: true รายตัวขึ้นไป เพื่อให้ Frontend ติดหมายเหตุได้ว่า
// ตัวเลขนี้คือต้นทุน ไม่ใช่มูลค่าตลาด
//
// ⚠️ ต่างจาก buildSummaryForUser โดยเจตนา: การ์ด "กำไร/ขาดทุน" ต้อง "ข้าม" ตัวที่ไม่มี
// ราคา (นับ excludedCount) เพราะเอามาคำนวณกำไรไม่ได้ — แต่ Donut สัดส่วนพอร์ตต้อง
// แสดงครบทุกตัว ไม่งั้นหุ้นไทยจะหายไปจากภาพรวมทั้งที่ผู้ใช้ถืออยู่จริง
// (ค่ากำไร/ขาดทุนในผลลัพธ์นี้ยังมาจาก buildSummaryForUser ตามเดิมทุกประการ —
// การตีมูลค่าที่ต้นทุนตรงนี้ใช้กับ Allocation เท่านั้น ไม่ไหลกลับไปปนกับสูตรกำไร)
function buildAllocation(priced, usdRate) {
  const byType = new Map();

  for (const { holding, currency, price, priceUnavailable } of priced) {
    // มีราคา → มูลค่าตลาด ; ไม่มีราคา → ตีที่ต้นทุน (ไม่เดาราคา)
    const valueNative = priceUnavailable ? holding.totalInvested : holding.heldQuantity * price;

    if (!byType.has(holding.type)) {
      byType.set(holding.type, { type: holding.type, valueByCurrency: { THB: 0, USD: 0 }, assets: [] });
    }
    const bucket = byType.get(holding.type);
    bucket.valueByCurrency[currency] += valueNative;
    bucket.assets.push({
      symbol: holding.symbol,
      name: holding.name,
      currency,
      units: holding.heldQuantity,
      value: roundToTwo(valueNative),
      // true = ตัวเลข value ด้านบนคือ "ต้นทุน" ไม่ใช่มูลค่าตลาด (ไม่มีราคาสด)
      priceUnavailable,
    });
  }

  const types = [...byType.values()].map((bucket) => ({
    type: bucket.type,
    valueByCurrency: {
      THB: roundToTwo(bucket.valueByCurrency.THB),
      USD: roundToTwo(bucket.valueByCurrency.USD),
    },
    // ยอดเทียบบาทสำหรับวาด Donut สัดส่วน (null-safe: ไม่มีเรต → นับเฉพาะส่วน THB
    // และ Consumer ต้องดู fxUnavailableForUsd ประกอบ)
    valueThbEquivalent: toThbEquivalent(
      bucket.valueByCurrency.THB,
      bucket.valueByCurrency.USD,
      usdRate
    ),
    assets: bucket.assets,
  }));

  // เรียงมาก→น้อยตามมูลค่าเทียบบาท ให้ Frontend วาด Donut/Legend ได้เลยไม่ต้องเรียงเอง
  types.sort((a, b) => b.valueThbEquivalent - a.valueThbEquivalent);

  return types;
}

// ── รายการล่าสุด N รายการ ──────────────────────────────────────────────────
// ใช้ transactions ที่ Sort มาจาก Repository แล้ว (date DESC, created_at DESC)
// แสดง "ทุกแถวตามจริง" รวมรายการที่เป็น Reversal ด้วย — ต่างจากสถิติ (count/Streak)
// ที่ตัดคู่ยกเลิกออก เพราะนี่คือ Ledger ที่ผู้ใช้ต้องเห็นความจริงว่าเกิดอะไรขึ้นบ้าง
function buildRecent(transactions, limit) {
  return transactions.slice(0, limit).map((tx) => ({
    id: tx.id,
    symbol: tx.symbol,
    side: tx.type,
    amountTotal: Number(tx.amountThb),
    currency: tx.currency,
    date: tx.date,
    createdAt: tx.createdAt,
    note: tx.note,
    source: tx.source,
  }));
}

const RECENT_LIMIT = 5;
const CHART_MONTHS = 12;

async function getOverview(userId) {
  // ดึงครั้งเดียวใช้ทุกสถิติ (เลี่ยงยิง DB ซ้ำต่อการ์ด) — findAllByUser Join symbol
  // มาให้แล้วและเรียง date DESC, created_at DESC
  const transactions = await transactionRepository.findAllByUser(userId);

  // มูลค่าพอร์ต + กำไร/ขาดทุน — Reuse ตรงๆ (null = พอร์ตว่าง)
  const summary = await portfolioSummaryService.buildSummaryForUser(userId, 'dashboard');
  const portfolio = await portfolioService.getPortfolioSummary(userId);

  // Realized P&L: portfolio.service คำนวณรายตัวไว้แล้ว (Moving Average) — รวมแยกสกุล
  // ตามสกุลของสินทรัพย์ ไม่บวกข้ามสกุล แล้วค่อยแปลงเทียบบาทด้วยเรตเดียวตอนท้าย
  const realizedByCurrency = { THB: 0, USD: 0 };
  for (const holding of portfolio.holdings) {
    const cur = holding.currency === 'USD' ? 'USD' : 'THB';
    realizedByCurrency[cur] += Number(holding.realizedPnL ?? 0);
  }

  const priced = await portfolioSummaryService.priceHoldings(portfolio.holdings);

  // เรตเดียวสำหรับทั้งหน้า — ดึงเมื่อ "มี USD จริง" เท่านั้น (พอร์ต THB ล้วนไม่ยิง FX)
  // ใช้ค่าจาก summary ถ้ามี (buildSummaryForUser ดึงไว้แล้ว) เพื่อไม่ยิง FX ซ้ำรอบสอง
  const hasUsd =
    portfolio.investedByCurrency.USD > 0 ||
    realizedByCurrency.USD !== 0 ||
    priced.some((p) => p.currency === 'USD');

  let fx = summary ? { rate: summary.fxRate, asOf: summary.fxAsOf, stale: summary.fxStale } : null;
  if (hasUsd && (!fx || fx.rate === null)) {
    fx = await fxRateService.getUsdThbRate();
  }
  const usdRate = fx ? fx.rate : null;

  return {
    // ── 1) มูลค่าพอร์ต + P&L (Reuse ทั้งหมด ไม่คำนวณใหม่) ────────────────────
    // summary = null เมื่อพอร์ตว่าง (ยังไม่มีสินทรัพย์ที่ถืออยู่)
    portfolio: summary
      ? {
          totalCurrentValue: summary.totalCurrentValue,
          unrealizedPnL: summary.totalProfitLoss,
          unrealizedPnLPercent: summary.totalProfitLossPercent,
          realizedPnLByCurrency: {
            THB: roundToTwo(realizedByCurrency.THB),
            USD: roundToTwo(realizedByCurrency.USD),
          },
          realizedPnLThbEquivalent: toThbEquivalent(
            realizedByCurrency.THB,
            realizedByCurrency.USD,
            usdRate
          ),
          // ต้นทุนของ "ที่ยังถืออยู่" แยกสกุล (คนละความหมายกับเงินลงทุนสะสมตลอดกาล
          // ด้านล่าง — ดูหมายเหตุใน dcaStats.getLifetimeSummary)
          investedByCurrency: portfolio.investedByCurrency,
          // จำนวนสินทรัพย์ที่ยังไม่มีราคาตลาด → การ์ด P&L ไม่ได้รวมตัวพวกนี้
          excludedCount: summary.excludedCount,
          isEmpty: false,
        }
      : { isEmpty: true },

    // ── 2) เงินลงทุนสะสมทั้งหมด + จำนวนครั้งที่บันทึกทั้งหมด ─────────────────
    lifetime: dcaStatsService.getLifetimeSummary(transactions),

    // ── 3) DCA เดือนนี้ (Asia/Bangkok) ──────────────────────────────────────
    thisMonth: dcaStatsService.getMonthSummary(transactions),

    // ── 4) Streak (เดือนติดต่อกันที่มีการซื้อ ≥1 รายการ) ─────────────────────
    streakMonths: dcaStatsService.getStreakMonths(transactions),

    // ── 5) Allocation ตามประเภทสินทรัพย์ ────────────────────────────────────
    allocation: buildAllocation(priced, usdRate),

    // ── 6) รายการล่าสุด 5 รายการ ────────────────────────────────────────────
    recent: buildRecent(transactions, RECENT_LIMIT),

    // ── 7) กราฟเงินลงทุนสะสมรายเดือน ย้อนหลัง ≤12 เดือน (แยกสกุล) ───────────
    monthlyInvested: dcaStatsService.getMonthlyInvestedSeries(transactions, CHART_MONTHS),

    // ── FX ที่ใช้แปลงทุกยอด USD ในหน้านี้ (Pattern เดียวกับ GET /dashboard/portfolio)
    fxRate: usdRate,
    fxAsOf: fx ? fx.asOf : null,
    fxStale: fx ? (fx.stale ?? false) : false,
    // true = มี USD ในพอร์ตแต่ดึงเรตไม่ได้ → Frontend ต้องเตือน ไม่โชว์ยอดรวมที่ผิด
    fxUnavailableForUsd: hasUsd && usdRate === null,
  };
}

module.exports = { getOverview };
