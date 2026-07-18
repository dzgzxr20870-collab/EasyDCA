const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const { calculateHeldQuantity } = require('./transaction.service');
const { calculateTotalInvested } = require('./portfolio.service');
const priceFeedService = require('./priceFeed.service');
const fxRateService = require('./fxRate.service');
const symbolRegistry = require('./symbolRegistry.service');

// แหล่งราคาจริงตาม Asset Type (Pattern เดียวกับที่ priceFeed.service.js ใช้
// จัดเส้นทาง Crypto → CoinGecko / หุ้นสหรัฐ → Twelve Data) — ใช้กำหนด
// priceSource ให้ตรงความจริง แทนการ Hardcode 'coingecko' ตายตัว
//
// รับ asset.type (จาก DB) เป็นหลัก + symbol ไว้ Fallback ผ่าน Registry เมื่อ type
// ว่าง/ผิดรูป — เดิมรับแค่ symbol แล้ว Lookup Registry ใหม่ ทำให้ Asset ที่ Registry
// ไม่รู้จัก (เช่น EOSE ก่อนถูกเพิ่ม) ได้ priceSource='coingecko' ผิดความจริง ทั้งที่
// ราคาจริงมาจาก Twelve Data → Flex Message แสดงคำเตือนแหล่งราคาผิดแหล่ง
function resolvePriceSource(type, symbol) {
  const resolved = type ?? symbolRegistry.lookupType(symbol);
  if (resolved === 'stock_us') return 'twelvedata';
  if (resolved === 'gold_bar' || resolved === 'gold_ornament') return 'thaigold';
  return 'coingecko';
}

// Error ที่มี code (Pattern เดียวกับ TransactionServiceError — API.md § 5)
// เพื่อให้ Controller (Webhook) Map เป็นข้อความไทยได้ ไม่ปล่อย Error ดิบถึง Client
class ProfitServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProfitServiceError';
    this.code = code;
    this.details = details;
  }
}

// ปัดทศนิยม 2 ตำแหน่งสำหรับจำนวนเงินบาท (สอดคล้องกับ portfolio/transaction service)
function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ปัดทศนิยม 8 ตำแหน่งสำหรับราคาต่อหน่วย รองรับ Crypto (DATABASE.md
// price_per_unit NUMERIC(20,8)) — Pattern เดียวกับ portfolio.service.js
function roundToEight(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

// คำนวณกำไร/ขาดทุนของสินทรัพย์ 1 ตัวเทียบกับราคาตลาดปัจจุบัน (คำสั่ง "กำไร")
// รองรับเฉพาะสินทรัพย์ที่มี Price Feed (ตอนนี้คือ Crypto) — หุ้นไทย/สหรัฐ
// ที่ยังไม่มี Price Feed จะ throw PRICE_FEED_NOT_IMPLEMENTED
//
// อาจ throw: ASSET_NOT_FOUND / NO_HOLDING_TO_CALCULATE_PROFIT /
//            PRICE_FEED_NOT_IMPLEMENTED
async function getAssetProfit(userId, symbol, portfolioId = null) {
  const asset = await assetRepository.findByUserAndSymbol(userId, symbol, portfolioId);
  if (!asset) {
    throw new ProfitServiceError('ASSET_NOT_FOUND', `Asset ${symbol} not found for this user`, {
      symbol,
    });
  }

  // heldQuantity/totalInvested คำนวณจาก transactions ทุกครั้ง (DATABASE.md § 12)
  // Reuse Logic กลางแทน Copy — calculateHeldQuantity (transaction.service) และ
  // calculateTotalInvested (portfolio.service) ให้ผลตรงกับที่ portfolio ใช้อยู่แล้ว
  const transactions = await transactionRepository.findAllByAsset(asset.id);
  const heldQuantity = calculateHeldQuantity(transactions);

  // ขายหมดแล้ว/ไม่เคยถือ — Asset มีอยู่จริงในระบบแต่ไม่มี Holding ตอนนี้
  // (ความหมายต่างจาก ASSET_NOT_FOUND — จึงใช้ Error Code แยกเพื่อสื่อสารชัด)
  if (heldQuantity <= 0) {
    throw new ProfitServiceError(
      'NO_HOLDING_TO_CALCULATE_PROFIT',
      `No current holding for ${symbol} to calculate profit`,
      { symbol, heldQuantity }
    );
  }

  const { totalInvested, realizedPnL } = calculateTotalInvested(transactions);

  // ── ทอง (Phase 3 Round 7): Mark-to-market ใช้ราคา "รับซื้อคืน" (buy) ─────────
  // เรียก getGoldPriceThb ตรง (ไม่ผ่าน getCurrentPrice) เพื่อ (1) โยน Error เฉพาะ
  // GOLD_PRICE_UNAVAILABLE ให้ผู้ใช้เข้าใจว่าเป็นปัญหาราคาทอง ไม่ใช่ "ไม่รองรับ"
  // (getCurrentPrice จะกลืน Error เป็น null → PRICE_FEED_NOT_IMPLEMENTED ที่สื่อผิด)
  // และ (2) เก็บ updatedAt/ราคาไว้ Enrich USD ต่อ
  const isGold = asset.type === 'gold_bar' || asset.type === 'gold_ornament';
  // กองทุนรวม (Round 7) — ต้องมี proj_id + fund_class_name (เก็บไว้ตอนซื้อ) จึงดึง
  // NAV ตรง Class ได้ ('fund' แบบ Manual ที่ไม่มี projId → ถือว่าไม่รองรับ Price Feed)
  const isFund = asset.type === 'fund' && asset.projId && asset.fundClassName;

  // Multi-Currency (Round 10) — สกุลเงินของสินทรัพย์ (อนุมานจากประวัติธุรกรรม)
  // ต้นทุนเฉลี่ย/กำไรขาดทุนคำนวณ "ในสกุลเดียวกัน" ไม่ถัวข้ามสกุล (ทอง/กองทุน = THB เสมอ)
  const currency = !isGold && !isFund && transactions.some((tx) => tx.currency === 'USD')
    ? 'USD'
    : 'THB';
  const isUsd = currency === 'USD';

  let currentPrice;
  let fundNavDate = null;
  if (isGold) {
    let gold;
    try {
      gold = await priceFeedService.getGoldPriceThb(asset.type);
    } catch (err) {
      throw new ProfitServiceError(
        'GOLD_PRICE_UNAVAILABLE',
        `Gold price feed unavailable for ${symbol}`,
        { symbol }
      );
    }
    currentPrice = gold.buy;
  } else if (isFund) {
    // Mark-to-market กองทุน = NAV ล่าสุด (last_val) ตรง Class — เรียก getMutualFundNav
    // ตรง (ไม่ผ่าน getCurrentPrice เพราะ symbol อย่างเดียวไม่พอ ต้องใช้ proj_id+class)
    let nav;
    try {
      nav = await priceFeedService.getMutualFundNav(asset.projId, asset.fundClassName);
    } catch (err) {
      const code = err.code === 'SEC_NOT_CONFIGURED' ? 'SEC_NOT_CONFIGURED' : 'MUTUAL_FUND_NAV_UNAVAILABLE';
      throw new ProfitServiceError(code, `Fund NAV unavailable for ${symbol}`, { symbol });
    }
    currentPrice = nav.lastVal;
    fundNavDate = nav.navDate;
  } else if (isUsd) {
    // สินทรัพย์สกุล USD — ตีมูลค่าด้วยราคา "USD ตามจริง" (ไม่ผ่าน THB) เพื่อให้
    // ต้นทุน (USD) กับมูลค่าปัจจุบัน (USD) อยู่สกุลเดียวกัน คำนวณกำไรได้ถูกต้อง
    // ส่ง asset.type (จาก DB) เข้าไปด้วย — Asset ที่ Registry ยังไม่รู้จัก (สร้างผ่าน
    // Manual Quantity Fallback) จะยัง Route ไป Twelve Data ได้ถูกต้อง
    currentPrice = await priceFeedService.getCurrentPriceUsd(symbol, asset.type);
    if (currentPrice === null) {
      throw new ProfitServiceError(
        'PRICE_FEED_NOT_IMPLEMENTED',
        `No live USD price feed available for ${symbol}`,
        { symbol }
      );
    }
  } else {
    currentPrice = await priceFeedService.getCurrentPrice(symbol, asset.type);
    if (currentPrice === null) {
      // Symbol ไม่รองรับ Price Feed (เช่นหุ้น) หรือ CoinGecko ล้มเหลว/Timeout —
      // ใช้ Error Code เดิมที่มีอยู่แล้ว ไม่สร้างใหม่ซ้ำซ้อน
      throw new ProfitServiceError(
        'PRICE_FEED_NOT_IMPLEMENTED',
        `No live price feed available for ${symbol}`,
        { symbol }
      );
    }
  }

  // totalInvested > 0 เสมอเมื่อ heldQuantity > 0 (ต้องมี buy มากกว่า sell) จึง
  // ไม่เกิดการหารด้วยศูนย์ใน averageCost/profitLossPercent ตาม Constraint เดิม
  const averageCost = roundToEight(totalInvested / heldQuantity);
  const currentValue = roundToTwo(heldQuantity * currentPrice);
  const profitLoss = roundToTwo(currentValue - totalInvested);
  const profitLossPercent = roundToTwo((profitLoss / totalInvested) * 100);

  // USD Enrichment สำหรับทอง (Phase 3 Round 7) — Reuse getUsdThbFxRate เดิม
  // แสดงราคา/มูลค่าปัจจุบันเป็น USD คู่กับ THB บนหน้ากำไร คืน null ถ้าดึงเรตไม่ได้
  // (ไม่ Block การแสดงผล THB) — เฉพาะทองเท่านั้น (สินทรัพย์อื่นไม่แสดง USD ที่นี่)
  let usd = null;
  if (isGold) {
    const rate = await priceFeedService.getUsdThbFxRate();
    if (rate !== null) {
      usd = {
        usdThbRate: rate,
        currentPriceUsd: roundToTwo(currentPrice / rate),
        currentValueUsd: roundToTwo(currentValue / rate),
      };
    }
  }

  // Multi-Currency (Round 10) — สินทรัพย์สกุล USD: แนบ "ยอดเทียบเป็นบาท" ไว้แสดงผล
  // (ตัวเลขหลักยังเป็น USD ตามจริง) ผ่าน fxRate.service (Frankfurter) — null ถ้าดึงเรต
  // ไม่ได้ (ไม่ Block การแสดงผล USD) กำกับเรต/วันที่เพื่อความโปร่งใส
  let fxThb = null;
  if (isUsd) {
    const fx = await fxRateService.getUsdThbRate();
    if (fx !== null) {
      fxThb = {
        rate: fx.rate,
        asOf: fx.asOf,
        stale: fx.stale,
        totalInvestedThb: roundToTwo(totalInvested * fx.rate),
        currentValueThb: roundToTwo(currentValue * fx.rate),
        profitLossThb: roundToTwo(profitLoss * fx.rate),
      };
    }
  }

  return {
    symbol: asset.symbol,
    // Multi-Currency (Round 10) — สกุลของ averageCost/totalInvested/currentPrice/
    // currentValue/profitLoss (Default 'THB' — Path เดิมไม่กระทบ)
    currency,
    fxThb,
    heldQuantity,
    averageCost,
    totalInvested,
    // กำไร/ขาดทุนที่ "รับรู้แล้ว" จากการขายบางส่วน (Moving Average — portfolio.service)
    // แยกจาก profitLoss ด้านล่างที่เป็น Unrealized เทียบกับ Holding ที่เหลือ ณ ปัจจุบัน
    realizedPnL,
    currentPrice,
    currentValue,
    profitLoss,
    profitLossPercent,
    // priceSource ตาม Asset Type จริง (coingecko/twelvedata/thaigold/secnav) เพื่อให้
    // Flex Message แสดงคำเตือนราคาอ้างอิงจากแหล่งที่ถูกต้อง (priceSourceNote) —
    // funds ไม่มีใน symbolRegistry จึงกำหนด 'secnav' ตรงจาก isFund
    priceSource: isFund ? 'secnav' : resolvePriceSource(asset.type, asset.symbol),
    // usd = null สำหรับสินทรัพย์ที่ไม่ใช่ทอง หรือทองที่ดึงเรต FX ไม่ได้
    usd,
    // กองทุนรวม (Round 7) — ข้อมูลประกอบการแสดงผล (Class + วันที่ NAV) null ถ้าไม่ใช่กองทุน
    fundClassName: isFund ? asset.fundClassName : null,
    navDate: fundNavDate,
  };
}

module.exports = {
  ProfitServiceError,
  getAssetProfit,
};
