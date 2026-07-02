const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const { calculateHeldQuantity } = require('./transaction.service');
const { calculateTotalInvested } = require('./portfolio.service');
const priceFeedService = require('./priceFeed.service');
const symbolRegistry = require('./symbolRegistry.service');

// แหล่งราคาจริงตาม Asset Type (Pattern เดียวกับที่ priceFeed.service.js ใช้
// จัดเส้นทาง Crypto → CoinGecko / หุ้นสหรัฐ → Twelve Data) — ใช้กำหนด
// priceSource ให้ตรงความจริง แทนการ Hardcode 'coingecko' ตายตัว
function resolvePriceSource(symbol) {
  const type = symbolRegistry.lookupType(symbol);
  if (type === 'stock_us') return 'twelvedata';
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

  const totalInvested = calculateTotalInvested(transactions);

  const currentPrice = await priceFeedService.getCurrentPrice(symbol);
  if (currentPrice === null) {
    // Symbol ไม่รองรับ Price Feed (เช่นหุ้น) หรือ CoinGecko ล้มเหลว/Timeout —
    // ใช้ Error Code เดิมที่มีอยู่แล้ว ไม่สร้างใหม่ซ้ำซ้อน
    throw new ProfitServiceError(
      'PRICE_FEED_NOT_IMPLEMENTED',
      `No live price feed available for ${symbol}`,
      { symbol }
    );
  }

  // totalInvested > 0 เสมอเมื่อ heldQuantity > 0 (ต้องมี buy มากกว่า sell) จึง
  // ไม่เกิดการหารด้วยศูนย์ใน averageCost/profitLossPercent ตาม Constraint เดิม
  const averageCost = roundToEight(totalInvested / heldQuantity);
  const currentValue = roundToTwo(heldQuantity * currentPrice);
  const profitLoss = roundToTwo(currentValue - totalInvested);
  const profitLossPercent = roundToTwo((profitLoss / totalInvested) * 100);

  return {
    symbol: asset.symbol,
    heldQuantity,
    averageCost,
    totalInvested,
    currentPrice,
    currentValue,
    profitLoss,
    profitLossPercent,
    // priceSource ตาม Asset Type จริง (coingecko/twelvedata) เพื่อให้ Flex Message
    // แสดงคำเตือนราคาอ้างอิงจากแหล่งที่ถูกต้อง (priceSourceNote)
    priceSource: resolvePriceSource(asset.symbol),
  };
}

module.exports = {
  ProfitServiceError,
  getAssetProfit,
};
