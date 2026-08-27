const portfolioService = require('./portfolio.service');
const portfolioSummaryService = require('./portfolioSummary.service');
const fxRateService = require('./fxRate.service');
const brokerRepository = require('../repositories/broker.repository');

// ═══════════════════════════════════════════════════════════════════════════
// allocation.service — สัดส่วนพอร์ตตามมิติที่เลือก (Stage 8 · Design Doc § 4.3)
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/portfolio/allocation?groupBy=broker|sector|assetType&portfolioId=
//
// ⚠️⚠️ **กฎบังคับข้อเดียวที่สำคัญที่สุดของไฟล์นี้** (Design Doc § 4.3 + กฎยืนข้อ 1
// "Single Source of Truth ต่อ 1 สูตรเงิน"):
//
//     ห้ามเขียนสูตรรวมมูลค่าพอร์ตขึ้นมาใหม่ในไฟล์นี้เด็ดขาด
//
// ทุกตัวเลขต้องมาจากของเดิมที่ /portfolio/summary และหน้า Dashboard ใช้อยู่:
//   • holdings + ต้นทุน (Moving Average) → portfolio.service.getPortfolioSummary
//   • ราคาตลาดรายตัว + รู้ว่าตัวไหนไม่มีราคา → portfolioSummary.priceHoldings
//   • เรต USD→THB                          → fxRate.service
// ถ้าเขียนสูตรใหม่ วันหนึ่งเลขบนการ์ดสรุปกับเลขบนกราฟโดนัทจะไม่ตรงกัน แล้ว
// หาสาเหตุไม่เจอ (เพราะทั้งคู่ "ดูถูก" ทั้งคู่)
//
// ── กติกาการตีมูลค่าเมื่อไม่มีราคาสด (คัดลอกจาก dashboardOverview.buildAllocation) ──
// สินทรัพย์ที่ไม่มีราคาสด (หุ้นไทย / NAV ดึงไม่ได้ / API ล่ม) → **ตีมูลค่าที่ต้นทุน**
// ไม่ใช่ข้ามทิ้ง — ถ้าข้าม หุ้นไทยจะหายไปจากกราฟโดนัททั้งที่ผู้ใช้ถืออยู่จริง และ
// ผลรวมสัดส่วนจะไม่เท่ามูลค่าพอร์ตที่แสดงบนการ์ด
// (ต่างจากการ์ด "กำไร/ขาดทุน" ที่ต้อง "ข้าม" ตัวไม่มีราคาแล้วนับ excludedCount
// เพราะเอามาคำนวณกำไรไม่ได้จริงๆ — คนละเรื่องกับสัดส่วน)

class AllocationServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AllocationServiceError';
    this.code = code;
    this.details = details;
  }
}

const GROUP_BY_OPTIONS = Object.freeze(['broker', 'sector', 'assetType']);

// ป้ายของกลุ่มที่ไม่ได้ระบุค่ามิตินั้น — **ต้องแสดงเป็นกลุ่ม ไม่ใช่ซ่อนแถว**
// (ข้อมูลเดิม 100% มี broker_id/sector เป็น NULL ถ้าซ่อน ยอดรวมกราฟโดนัทจะไม่
// เท่ามูลค่าพอร์ตจริง — ระบุไว้ใน DATABASE.md ของทั้ง 2 คอลัมน์)
const UNSPECIFIED_LABEL = 'ไม่ระบุ';

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Pattern เดียวกับ dashboardOverview.toThbEquivalent เป๊ะ
function toThbEquivalent(thb, usd, usdRate) {
  return usdRate !== null ? roundToTwo(thb + usd * usdRate) : roundToTwo(thb);
}

// ── Normalize สำหรับ "จัดกลุ่ม" เท่านั้น ไม่ใช่สำหรับแสดงผล ──────────────────
// มติ Founder § 8.2: trim หัวท้าย + ยุบช่องว่างซ้ำ + เทียบแบบ case-insensitive
// เพื่อไม่ให้ `Tech` / `tech` / `Tech ` กลายเป็น 3 กลุ่มบนกราฟโดนัท
// **แต่ต้องเก็บรูปแบบที่ผู้ใช้พิมพ์ไว้แสดงผล** (ไม่บังคับเป็นตัวพิมพ์เล็กหมด)
// → ใช้ค่านี้เป็น "กุญแจ" ส่วน label ใช้ค่าดิบของแถวแรกที่เจอ
function groupingKey(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  return cleaned === '' ? null : cleaned.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// resolveDimension — ดึง "กุญแจ + ป้าย" ของ holding หนึ่งตามมิติที่เลือก
// ═══════════════════════════════════════════════════════════════════════════
// คืน { key, label } โดย key = null หมายถึงกลุ่ม "ไม่ระบุ"
//
// ⚠️ broker ไม่ต้อง Normalize ที่นี่ — ตาราง brokers มี UNIQUE แบบ
// case-insensitive อยู่แล้วตั้งแต่ migration 042 (uniq_brokers_user_name_ci)
// ดังนั้น "Bitkub" กับ "bitkub" เป็นแถวเดียวกันตั้งแต่ต้นทาง จัดกลุ่มด้วย
// broker_id ตรงๆ จึงถูกต้องอยู่แล้ว · ส่วน sector เป็น Free Text บน assets
// ไม่มี Constraint ใดบังคับ จึงต้อง Normalize ตอนจัดกลุ่มเอง
function resolveDimension(groupBy, holding, brokerNameById) {
  if (groupBy === 'broker') {
    const id = holding.brokerId ?? null;
    if (id === null) return { key: null, label: UNSPECIFIED_LABEL };
    return {
      key: id,
      // โบรกที่หาชื่อไม่เจอไม่ควรเกิด (FK ON DELETE SET NULL กันแถวค้างไว้แล้ว)
      // แต่ถ้าเกิด ต้องไม่แสดงเป็น "ไม่ระบุ" เพราะจะรวมยอดปนกับกลุ่มอื่นจนแยกไม่ออก
      label: brokerNameById.get(id) ?? `โบรก ${String(id).slice(0, 8)}`,
    };
  }

  if (groupBy === 'sector') {
    const key = groupingKey(holding.sector);
    if (key === null) return { key: null, label: UNSPECIFIED_LABEL };
    // label = ค่าดิบที่ผู้ใช้พิมพ์ (Normalize ช่องว่างแล้วแต่คงตัวพิมพ์เดิม)
    return { key, label: holding.sector.trim().replace(/\s+/g, ' ') };
  }

  // assetType — ค่ามาจาก CHECK ของ assets.type จึงสะอาดอยู่แล้ว ไม่ต้อง Normalize
  return { key: holding.type, label: holding.type };
}

// ═══════════════════════════════════════════════════════════════════════════
// getAllocation — สัดส่วนพอร์ตตามมิติที่เลือก
// ═══════════════════════════════════════════════════════════════════════════
// portfolioId (Optional) = กรองเฉพาะสินทรัพย์ในพอร์ตนั้น
//   ⚠️ Caller **ต้องยืนยันความเป็นเจ้าของพอร์ตมาก่อนแล้ว** (portfolios.service
//   .assertCanWriteToPortfolio หรือ getPortfolio) — ที่นี่กรองจาก holdings ที่
//   getPortfolioSummary คืนมาซึ่ง Scope ด้วย userId อยู่แล้ว จึงไม่มีทางเห็น
//   ของผู้ใช้คนอื่นแม้ส่ง portfolioId ของคนอื่นมา (จะได้ผลลัพธ์ว่างแทน)
async function getAllocation(userId, { groupBy = 'assetType', portfolioId = null } = {}) {
  if (!GROUP_BY_OPTIONS.includes(groupBy)) {
    throw new AllocationServiceError('VALIDATION_ERROR', `Invalid groupBy: ${groupBy}`, {
      field: 'groupBy',
      allowed: GROUP_BY_OPTIONS,
    });
  }

  // ⭐ Reuse ตรงๆ — สูตรต้นทุน/ยอดถือเดียวกับ /portfolio/summary ทุกประการ
  const portfolio = await portfolioService.getPortfolioSummary(userId);

  const holdings =
    portfolioId === null
      ? portfolio.holdings
      : portfolio.holdings.filter((h) => h.portfolioId === portfolioId);

  if (holdings.length === 0) {
    return {
      groupBy,
      portfolioId,
      totalValueThb: 0,
      groups: [],
      isEmpty: true,
      fxRate: null,
      fxAsOf: null,
      fxStale: false,
      fxUnavailableForUsd: false,
    };
  }

  // ⭐ Reuse ตรงๆ — ราคาตลาดชุดเดียวกับที่หน้า Dashboard ใช้
  const priced = await portfolioSummaryService.priceHoldings(holdings);

  // ดึงเรต "เมื่อมี USD จริง" เท่านั้น (พอร์ต THB ล้วนไม่ยิง FX เลย) —
  // Pattern เดียวกับ dashboardOverview.getOverview
  const hasUsd = priced.some((p) => p.currency === 'USD');
  const fx = hasUsd ? await fxRateService.getUsdThbRate() : null;
  const usdRate = fx ? fx.rate : null;

  // ชื่อโบรกดึงครั้งเดียว (ไม่ยิงต่อ holding) และเฉพาะตอนจัดกลุ่มตามโบรกเท่านั้น
  const brokerNameById = new Map();
  if (groupBy === 'broker') {
    const brokers = await brokerRepository.findAllByUser(userId);
    for (const b of brokers) brokerNameById.set(b.id, b.name);
  }

  const buckets = new Map();

  for (const { holding, currency, price, priceUnavailable } of priced) {
    // มีราคา → มูลค่าตลาด ; ไม่มีราคา → ตีที่ต้นทุน (ไม่เดาราคา)
    // — กติกาเดียวกับ dashboardOverview.buildAllocation เป๊ะ
    const valueNative = priceUnavailable ? holding.totalInvested : holding.heldQuantity * price;

    const { key, label } = resolveDimension(groupBy, holding, brokerNameById);
    // Map key ต้องเป็น String เสมอ (null ใช้ Sentinel ที่ชนกับ uuid/sector ไม่ได้)
    const mapKey = key === null ? ' unspecified' : String(key);

    if (!buckets.has(mapKey)) {
      buckets.set(mapKey, {
        key,
        label,
        valueByCurrency: { THB: 0, USD: 0 },
        assetCount: 0,
        priceUnavailableCount: 0,
      });
    }

    const bucket = buckets.get(mapKey);
    bucket.valueByCurrency[currency] += valueNative;
    bucket.assetCount += 1;
    if (priceUnavailable) bucket.priceUnavailableCount += 1;
  }

  const groups = [...buckets.values()].map((b) => ({
    key: b.key,
    label: b.label,
    valueThb: toThbEquivalent(b.valueByCurrency.THB, b.valueByCurrency.USD, usdRate),
    valueByCurrency: {
      THB: roundToTwo(b.valueByCurrency.THB),
      USD: roundToTwo(b.valueByCurrency.USD),
    },
    assetCount: b.assetCount,
    // จำนวนสินทรัพย์ในกลุ่มที่ตีมูลค่า "ที่ต้นทุน" เพราะไม่มีราคาสด — Frontend
    // ต้องติดหมายเหตุได้ว่าตัวเลขกลุ่มนี้ไม่ใช่มูลค่าตลาดทั้งหมด
    priceUnavailableCount: b.priceUnavailableCount,
  }));

  const totalValueThb = roundToTwo(groups.reduce((sum, g) => sum + g.valueThb, 0));

  // percent คำนวณหลังรู้ยอดรวม — หารด้วย 0 ไม่ได้ (พอร์ตที่มูลค่ารวมเป็น 0 จริงๆ
  // เกิดได้ถ้าทุกตัวราคา 0) จึงคืน 0 แทน NaN ที่จะทำให้กราฟพัง
  for (const g of groups) {
    g.percent = totalValueThb > 0 ? roundToTwo((g.valueThb / totalValueThb) * 100) : 0;
  }

  // เรียงมาก→น้อย ให้ Frontend วาด Donut/Legend ได้เลยไม่ต้องเรียงเอง
  // Tie-break ด้วย label เพื่อให้ลำดับคงที่ทุกครั้งเมื่อมูลค่าเท่ากันเป๊ะ
  groups.sort((a, b) => b.valueThb - a.valueThb || String(a.label).localeCompare(String(b.label)));

  return {
    groupBy,
    portfolioId,
    totalValueThb,
    groups,
    isEmpty: false,
    fxRate: usdRate,
    fxAsOf: fx ? fx.asOf : null,
    fxStale: fx ? (fx.stale ?? false) : false,
    // true = มี USD ในพอร์ตแต่ดึงเรตไม่ได้ → **ห้ามรวมยอดข้ามสกุล** Frontend ต้อง
    // เตือน ไม่ใช่แสดงยอดที่ขาดส่วน USD ไปเงียบๆ (API.md ระบุไว้ชัด)
    fxUnavailableForUsd: hasUsd && usdRate === null,
  };
}

module.exports = {
  AllocationServiceError,
  GROUP_BY_OPTIONS,
  UNSPECIFIED_LABEL,
  getAllocation,
};
