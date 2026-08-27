const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const priceFeedService = require('./priceFeed.service');
const fxRateService = require('./fxRate.service');
const symbolRegistry = require('./symbolRegistry.service');
const entitlement = require('./entitlement.service');
// Stage 6a — แหล่งตัดสิน "ความหมายของ transaction type" ที่เดียวของทั้งระบบ
// (แทน Pattern Binary `=== 'buy' ? ... : ...` ที่ตีความ type ใหม่เป็น sell เงียบๆ)
const { heldQuantitySign } = require('../utils/transactionType.util');
// Stage 5 (migration 046) — แหล่งตัดสิน "Symbol นี้หมายถึงสินทรัพย์แถวไหน" ที่เดียว
// ของทั้งระบบ (ตั้งแต่ถือ Symbol เดียวกันได้หลายโบรก Symbol เดียวอาจตรงหลายแถว)
const assetResolution = require('./assetResolution.service');
// Stage 8-fix — ด่าน "เพิ่มของใหม่เข้าพอร์ตนี้ได้ไหม" (มติ Founder 24 ส.ค. 2569)
// ⚠️ ต้องอยู่ใน validateBuy เท่านั้น ห้ามใส่ใน validateSell (ดูเหตุผลที่ validateBuy)
const portfoliosService = require('./portfolios.service');
// Resolve พอร์ต Default ตอนสร้างสินทรัพย์ใหม่ (Invariant migration 044/045:
// สินทรัพย์ทุกแถวต้องสังกัดพอร์ต) — ดู validateBuy
const portfolioRepository = require('../repositories/portfolio.repository');

// แหล่งราคาจริงตาม Asset Type (Pattern เดียวกับที่ priceFeed.service.js ใช้
// จัดเส้นทาง Crypto → CoinGecko / หุ้นสหรัฐ → Twelve Data) — priceFeedService
// รองรับทั้งสอง Type แล้ว จึงต้องระบุ priceSource ให้ตรงจริง ไม่ Hardcode
// 'coingecko' ตายตัว (เดิมมีมาก่อนที่จะรองรับหุ้นสหรัฐ)
function resolvePriceSource(symbol) {
  const type = symbolRegistry.lookupType(symbol);
  if (type === 'stock_us') return 'twelvedata';
  if (type === 'gold_bar' || type === 'gold_ornament') return 'thaigold';
  return 'coingecko';
}

// คืน goldType ('gold_bar'|'gold_ornament') ถ้า Symbol เป็นทอง มิฉะนั้น null
// (Phase 3 Round 7) — ใช้จัดเส้นทางไป Thai Gold Feed แยกจาก Crypto/หุ้น
function getGoldType(symbol) {
  const type = symbolRegistry.lookupType(symbol);
  return type === 'gold_bar' || type === 'gold_ornament' ? type : null;
}

// Enrich ราคาทอง (THB) ด้วยราคาอ้างอิง USD สำหรับแสดงใน Preview (Phase 3 Round 7)
// Reuse getUsdThbFxRate เดิม (ไม่เขียน FX ใหม่) — คืน null ถ้าดึงเรตไม่ได้ (ไม่ได้ตั้ง
// Key / Twelve Data ล่ม) เพื่อให้ Preview แสดง THB อย่างเดียวได้ ไม่ Block การซื้อ
// (USD เป็นแค่ข้อมูลอ้างอิงประกอบ ไม่ใช่ยอดที่บันทึกลง DB)
async function buildGoldUsdRef(pricePerUnitThb) {
  const rate = await priceFeedService.getUsdThbFxRate();
  if (rate === null) return null;
  return {
    usdThbRate: rate,
    pricePerUnitUsd: roundToTwo(pricePerUnitThb / rate),
  };
}

// Multi-Currency (Round 10): สำหรับธุรกรรมที่บันทึกเป็น USD ตามจริง — สร้างข้อมูล
// "ยอดเทียบเป็นบาท" ไว้ "แสดงผลเท่านั้น" (Preview/Confirm) ไม่ Persist ลง DB
// ใช้ fxRate.service (Frankfurter ฟรี ไม่ต้อง Key) — คืน null ถ้าดึงเรตไม่ได้เลย
// (การดึงเรตล้มเหลว "ไม่ Block" การบันทึก เพราะเก็บ USD ตามจริงอยู่แล้ว ต่างจาก
// พฤติกรรมเดิม Round 2 ที่แปลงเป็นบาทตอนบันทึกจึงต้องมีเรตเสมอ)
async function buildUsdFxDisplay(amountUsd, pricePerUnitUsd) {
  const fx = await fxRateService.getUsdThbRate();
  if (fx === null) return null;
  return {
    rate: fx.rate,
    asOf: fx.asOf,
    stale: fx.stale,
    amountThb: roundToTwo(amountUsd * fx.rate),
    pricePerUnitThb: roundToTwo(pricePerUnitUsd * fx.rate),
  };
}

// PRD.md — Free Plan บันทึกได้สูงสุด 2 สินทรัพย์ Active
// ค่ากลางอยู่ที่ entitlement.service (แหล่งตัดสินสิทธิ์เดียว) — คงชื่อ MAX_FREE_ASSETS
// ไว้ Re-export เพื่อ Backward Compat กับโค้ด/เทสต์ที่อ้างค่านี้อยู่แล้ว ไม่ Hardcode ซ้ำ
const MAX_FREE_ASSETS = entitlement.FREE_TIER_ASSET_LIMIT;

// Error ที่มี code ตาม API.md § 5 เพื่อให้ Layer ด้านบน (Webhook/Controller)
// Map เป็น Error Response มาตรฐานได้ ไม่ปล่อย Error ดิบหลุดถึง Client
class TransactionServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TransactionServiceError';
    this.code = code;
    this.details = details;
  }
}

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ปัดทศนิยม 8 ตำแหน่งสำหรับ quantity รองรับ Crypto (DATABASE.md
// quantity NUMERIC(20,8)) — เลี่ยง Floating Point Noise ตอนหาร
// (Pattern เดียวกับ portfolio.service.js roundToEight)
function roundToEight(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

// "จำนวนหน่วยจากยอดเงินรวม + ราคาต่อหน่วย" — กฎการปัดเศษเดียวของทั้งระบบ
// (Extract จาก Logic เดิมที่เขียน roundToEight(amount / price) ซ้ำอยู่ 4 จุดใน
// resolveQuantityAndPrice: USD/กองทุน/ทอง/Crypto — พฤติกรรมเท่าเดิมทุกประการ)
//
// Export ออกไปเพื่อให้ Web Controller (POST /api/v1/transactions) ที่ต้องแปลง
// "ยอดเงินรวม" ของฟอร์มเว็บเป็น "จำนวนหน่วย" ก่อนส่งเข้า Service ในรูปแบบเดิม
// (quantity + pricePerUnit) ใช้กฎการปัดเศษ "ตัวเดียวกัน" ได้ ไม่ Copy สูตรไปคิดเอง
function deriveQuantityFromAmount(amountTotal, pricePerUnit) {
  return roundToEight(Number(amountTotal) / Number(pricePerUnit));
}

// ── "ยอดที่ตกลงกันไว้แล้ว" ต้องชนะการคำนวณใหม่เสมอ (บั๊ค A) ──────────────────
//
// ⚠️ อ่านก่อนแก้: นี่คือการแก้บั๊กจริงบน Production — ผู้ใช้พิมพ์ "ซื้อ BTC 100"
// การ์ด Preview แสดง 100 บาท แต่รายการที่บันทึกจริงเป็น 100.01 บาท
//
// ต้นตอ: ตอน Preview ระบบหาร quantity = 100 / 2,513,380 แล้ว "ปัดเหลือ 8 ตำแหน่ง"
// (= 0.00003979) เศษที่ถูกปัดทิ้งไปนั้น เมื่อคูณราคากลับขึ้นมาตอน Confirm
// (0.00003979 × 2,513,380 = 100.0073…) จะโผล่กลับมาเป็น 0.01 บาท
// ยิ่งราคาต่อหน่วยสูง เศษที่คูณกลับยิ่งใหญ่ (ขอบเขต = 0.5e-8 × ราคาต่อหน่วย)
//
// หลักการ (มติ Founder): ยอดที่บันทึกลง Ledger ต้องเท่ากับยอดที่ผู้ใช้เห็นตอนกด
// ยืนยันเสมอ — ผู้ใช้ตกลงกับเลข 100 ระบบต้องบันทึก 100 ประเด็นไม่ใช่เงิน 1 สตางค์
// แต่คือ "แอปการเงินที่แสดงเลขหนึ่งแล้วบันทึกอีกเลขหนึ่งทำลายความเชื่อใจ"
//
// จึงต้องให้ยอดที่ Snapshot ไว้ตอน Preview (pending_transactions.amount_thb) รอด
// ข้ามมาถึงตอนบันทึกจริง แทนการคำนวณใหม่ — ดู pendingTransaction.toCommitParams
//
// ── ทำไมต้องมี Guard (ไม่เชื่อค่าที่ส่งมา 100%) ─────────────────────────────
// นี่คือเส้นทางเงินที่เขียน Immutable Ledger ถ้ายอมรับ amountThb ที่ส่งมาโดยไม่ตรวจ
// เลย ค่าที่เพี้ยน/ไม่เข้าคู่กับ quantity × pricePerUnit (เช่น Postback ที่ถูกแก้มา
// หรือ Snapshot ที่ไม่ตรงกับ quantity ที่ส่งมาคู่กัน) จะลง Ledger ได้ทันที
// จึงยอมรับเฉพาะยอดที่ "อยู่ในระยะที่อธิบายได้ด้วยการปัดเศษ" เท่านั้น มิฉะนั้น
// Fallback กลับไปคำนวณเองเหมือนเดิม (Fail-safe = พฤติกรรมเดิม ไม่ใช่ค่าที่เชื่อไม่ได้)
//
// 2% = ค่าเดียวกับ SANITY_RATIO ใน slipOcr.service ที่ตอบคำถามเดียวกันเป๊ะ
// ("ยอดนี้เข้าคู่กับ quantity × price ไหม") — กว้างพอรองรับทั้งเศษจากการปัด quantity
// 8 ตำแหน่ง และเศษจากราคาต่อหน่วยบนสลิปที่ถูกปัดมาแสดง (EOSE: ราคาจริง 4.2548
// แสดง 4.25 → ต่าง 0.11%) แต่แคบพอที่ยอดคนละตัวจะไม่รอด
const AGREED_AMOUNT_MAX_DRIFT_RATIO = 0.02;

function resolveAgreedAmount(agreedInput, computedAmount, context = {}) {
  if (!isPresent(agreedInput)) return computedAmount;

  const agreed = Number(agreedInput);
  if (!Number.isFinite(agreed) || agreed <= 0) return computedAmount;

  if (
    computedAmount > 0 &&
    Math.abs(agreed - computedAmount) / computedAmount > AGREED_AMOUNT_MAX_DRIFT_RATIO
  ) {
    // ห้ามเงียบ — บทเรียนบั๊ค A คือ "ยอดเพี้ยนโดยไม่มีร่องรอย" ใช้เวลาสืบนานมาก
    console.warn(
      `[transaction] agreed amount rejected (symbol=${context.symbol ?? 'unknown'}): ` +
        `agreed=${agreed} computed=${computedAmount} — drift exceeds ` +
        `${AGREED_AMOUNT_MAX_DRIFT_RATIO * 100}%; falling back to computed amount`
    );
    return computedAmount;
  }

  return roundToTwo(agreed);
}

// DATABASE.md § 7 — Field ประเภท DATE ควรอิงวันของผู้ใช้ (Asia/Bangkok)
// ไม่ใช่ UTC เพื่อไม่ให้ธุรกรรมที่บันทึกช่วงดึกตกไปเป็นวันก่อนหน้า
function todayInBangkok() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

// แปลง params จาก Command Parser ให้ได้ quantity + pricePerUnit + amountThb
// ที่พร้อมบันทึกลง transactions โดยไม่มี Side Effect ใดๆ (เรียกก่อนเขียน DB
// เสมอ เพื่อไม่ให้เกิด Asset/Transaction ค้างถ้าจำนวนคำนวณไม่ได้)
function isPresent(value) {
  return value !== undefined && value !== null;
}

// async เพราะกรณี amountThb ต้องเรียก Price Feed (I/O) มาหาร quantity —
// Caller ทุกจุด (validateBuy/validateSell) ต้อง await ผลลัพธ์
//
// side ('buy'|'sell') ใช้เฉพาะกรณีทองที่ให้จำนวนเงิน (Branch amountThb) เพราะทอง
// ราคาซื้อ (sell = ขายออก) ≠ ราคาขาย (buy = รับซื้อคืน) ต้องเลือก Field ให้ตรงฝั่ง —
// Crypto/หุ้นใช้ราคาตลาดค่าเดียวไม่แยกฝั่ง จึงไม่กระทบ (Default 'buy' เพื่อ Backward
// Compat กับ Caller เดิมที่ไม่ส่ง side มา)
async function resolveQuantityAndPrice(params, side = 'buy') {
  // Multi-Currency (Round 10): สกุลเงินของธุรกรรม — 'USD' เมื่อผู้ใช้ระบุ usd,
  // มิฉะนั้น Default 'THB' (พฤติกรรมเดิม 100%). เก็บ "ตามจริง" ไม่แปลงเป็นบาทตอนบันทึก
  const isUsd = params.currency === 'USD';

  if (isPresent(params.quantity) && isPresent(params.pricePerUnit)) {
    const quantity = Number(params.quantity);
    const pricePerUnitInput = Number(params.pricePerUnit);

    // ยอดที่ผู้ใช้ตกลงไว้แล้ว (Snapshot จาก Preview) ชนะการคำนวณใหม่เสมอ — ถ้าไม่มี
    // ส่งมา (เส้นทาง "พิมพ์จำนวนหน่วย + ราคาเอง" ซึ่งไม่เคยมียอดตกลงไว้ก่อน) ก็คำนวณ
    // จาก quantity × pricePerUnit เหมือนเดิมทุกประการ ดู resolveAgreedAmount
    const amountThb = resolveAgreedAmount(
      params.amountThb,
      roundToTwo(quantity * pricePerUnitInput),
      { symbol: params.symbol }
    );

    // ── ราคาต่อหน่วยเป็น USD (Round 10) — เก็บเป็น USD ตามจริง ไม่แปลงตอนบันทึก ──
    // amountThb/pricePerUnit ที่คืน = ค่าในหน่วย USD (ชื่อ Field คงเดิมเพื่อ Backward
    // Compat — ดู migration 012 Semantics) fx = ยอดเทียบบาทไว้ "แสดงผลเท่านั้น"
    // (null ได้ถ้าดึงเรตไม่ได้ — ไม่ Block การบันทึก)
    if (isUsd) {
      return {
        quantity,
        pricePerUnit: pricePerUnitInput,
        amountThb,
        currency: 'USD',
        priceSource: 'user',
        fx: await buildUsdFxDisplay(amountThb, pricePerUnitInput),
      };
    }

    // priceSource: 'user' — ราคาที่ User ระบุเองตรงๆ (ไม่ได้มาจาก Price Feed)
    // ใช้แยกแยะใน Preview/Confirm Message ว่าควรเตือนเรื่องราคาอ้างอิงไหม
    const resolved = {
      quantity,
      pricePerUnit: pricePerUnitInput,
      amountThb,
      priceSource: 'user',
    };

    // ทอง: ผู้ใช้พิมพ์ราคาต้นทุนเอง (THB) — Enrich ราคาอ้างอิง USD ให้ Preview แสดง
    // ทั้ง THB และ USD (Phase 3 Round 7) ไม่กระทบยอด THB ที่บันทึกจริง
    if (getGoldType(params.symbol)) {
      resolved.goldUsd = await buildGoldUsdRef(pricePerUnitInput);
    }

    return resolved;
  }

  // ── Manual Quantity Fallback (Round 10-B) — "จำนวนหน่วย + ยอดเงินรวม" (ไม่มีราคา) ──
  // ผู้ใช้ระบุจำนวนหน่วยเอง (เช่นสลิป Amount-only ของหุ้นที่ไม่มี Price Feed อย่าง EOSE)
  // → คำนวณราคาต่อหน่วย = ยอดรวม / จำนวน โดย "ไม่พึ่ง Symbol Registry/Price Feed เลย"
  // (Bypass ทั้ง SEC_NOT_CONFIGURED และ PRICE_FEED_NOT_IMPLEMENTED ในตัว) — ดักก่อน
  // Branch amountThb ด้านล่างที่ต้องมีราคาตลาดเสมอ priceSource='user' (ผู้ใช้ระบุเอง)
  if (isPresent(params.quantity) && !isPresent(params.pricePerUnit) && isPresent(params.amountThb)) {
    const quantity = Number(params.quantity);
    const amount = Number(params.amountThb);
    if (!(quantity > 0) || !(amount > 0)) {
      throw new TransactionServiceError(
        'VALIDATION_ERROR',
        'Manual quantity entry requires a positive quantity and amount',
        { quantity: params.quantity, amount: params.amountThb }
      );
    }
    const pricePerUnit = amount / quantity;

    if (isUsd) {
      return {
        quantity,
        pricePerUnit,
        amountThb: roundToTwo(amount),
        currency: 'USD',
        priceSource: 'user',
        fx: await buildUsdFxDisplay(roundToTwo(amount), pricePerUnit),
      };
    }

    const resolved = {
      quantity,
      pricePerUnit,
      amountThb: roundToTwo(amount),
      priceSource: 'user',
    };
    // ทอง: Enrich ราคาอ้างอิง USD ให้ Preview (เช่นเดียวกับ Branch quantity+price ด้านบน)
    if (getGoldType(params.symbol)) {
      resolved.goldUsd = await buildGoldUsdRef(pricePerUnit);
    }
    return resolved;
  }

  if (isPresent(params.amountThb)) {
    // ── จำนวนเงินรวมเป็น USD (Round 10) — หาร quantity จากราคา "USD" ตามจริง ──────
    // ต้องมี USD Price Feed (หุ้นสหรัฐ/Crypto) มิฉะนั้นโยน PRICE_FEED_NOT_IMPLEMENTED
    // (ไม่แปลงผ่าน THB เพราะบันทึกเป็น USD ตามจริง) — ดักก่อน Logic THB ทั้งหมดด้านล่าง
    if (isUsd) {
      const amountUsd = Number(params.amountThb);
      const priceUsd = await priceFeedService.getCurrentPriceUsd(params.symbol);
      if (priceUsd === null) {
        throw new TransactionServiceError(
          'PRICE_FEED_NOT_IMPLEMENTED',
          `Cannot derive USD quantity for ${params.symbol} without a USD price feed`,
          { symbol: params.symbol }
        );
      }
      const quantity = deriveQuantityFromAmount(amountUsd, priceUsd);
      return {
        quantity,
        pricePerUnit: priceUsd,
        amountThb: roundToTwo(amountUsd),
        currency: 'USD',
        priceSource: resolvePriceSource(params.symbol),
        fx: await buildUsdFxDisplay(roundToTwo(amountUsd), priceUsd),
      };
    }
    // ── กองทุนรวมไทย: ซื้อด้วยจำนวนเงิน (ไม่พิมพ์ราคา) → ใช้ NAV ล่าสุด (Round 7) ──
    // กองทุนมี NAV เดียว (last_val) ใช้ทั้งราคาต้นทุน Default และ Mark-to-market ต่าง
    // จากทอง (Buy/Sell แยก) — ต้องมี projId + fundClassName (Webhook เติมให้ก่อนแล้ว
    // ทั้งกรณี Asset ใหม่และ Asset เดิม) มิฉะนั้นถือว่าเป็น 'fund' แบบ Manual ไม่ดึง SEC
    if (params.type === 'fund' && params.projId && params.fundClassName) {
      let nav;
      try {
        nav = await priceFeedService.getMutualFundNav(params.projId, params.fundClassName);
      } catch (err) {
        // ไม่เดาราคา — แยก SEC ไม่ config ออกจาก NAV ดึงไม่ได้ เพื่อข้อความไทยที่ตรง
        const code = err.code === 'SEC_NOT_CONFIGURED' ? 'SEC_NOT_CONFIGURED' : 'MUTUAL_FUND_NAV_UNAVAILABLE';
        throw new TransactionServiceError(
          code,
          `Cannot derive fund quantity for ${params.symbol}: ${err.message}`,
          { symbol: params.symbol }
        );
      }

      const amountThb = Number(params.amountThb);
      const pricePerUnit = nav.lastVal;
      const quantity = deriveQuantityFromAmount(amountThb, pricePerUnit);
      return {
        quantity,
        pricePerUnit,
        amountThb: roundToTwo(amountThb),
        priceSource: 'secnav',
      };
    }

    // ── ทอง: ซื้อด้วยจำนวนเงิน (ไม่พิมพ์ราคาต้นทุน) — Phase 3 Round 7 ──────────
    // ใช้ราคา "ขายออก" (sell) เป็นต้นทุนต่อหน่วย (ราคาที่ลูกค้าจ่ายจริงตอนซื้อทองใหม่)
    // แล้วหาร quantity จากจำนวนเงิน — ต่างจาก Crypto/หุ้นที่ใช้ getCurrentPrice (ซึ่ง
    // สำหรับทองคืนราคา buy สำหรับตีมูลค่าพอร์ต ไม่ใช่ราคาต้นทุนตอนซื้อ) จึงต้องเรียก
    // getGoldPriceThb ตรงเพื่อเลือก Field sell โดยเฉพาะ ดักก่อนถึง getCurrentPrice
    const goldType = getGoldType(params.symbol);
    if (goldType) {
      let gold;
      try {
        gold = await priceFeedService.getGoldPriceThb(goldType);
      } catch (err) {
        // ดึงราคาทองไม่ได้ (API ล่ม/ราคาว่างก่อนตลาดเปิด) — ไม่เดาราคา
        throw new TransactionServiceError(
          'GOLD_PRICE_UNAVAILABLE',
          `Cannot derive gold quantity for ${params.symbol}: gold price feed unavailable`,
          { symbol: params.symbol }
        );
      }

      const amountThb = Number(params.amountThb);
      // ซื้อ = จ่ายราคา "ขายออก" (sell) ; ขาย = ได้ราคา "รับซื้อคืน" (buy)
      const pricePerUnit = side === 'sell' ? gold.buy : gold.sell;
      const quantity = deriveQuantityFromAmount(amountThb, pricePerUnit);
      return {
        quantity,
        pricePerUnit,
        amountThb: roundToTwo(amountThb),
        priceSource: 'thaigold',
        goldUsd: await buildGoldUsdRef(pricePerUnit),
      };
    }

    // มีแต่จำนวนเงิน (เช่น "ซื้อ BTC 1000") — ต้องใช้ราคาตลาดปัจจุบันมาหาร
    // เป็น quantity ลองดึงราคาจริงจาก Price Feed ก่อน (รองรับเฉพาะ Crypto ตอนนี้)
    const pricePerUnit = await priceFeedService.getCurrentPrice(params.symbol);

    // ได้ราคาจริง → คำนวณ quantity จากจำนวนเงิน ห้าม Mock ราคามั่วเด็ดขาด
    if (pricePerUnit !== null) {
      const amountThb = Number(params.amountThb);
      // ปัด quantity เป็น 8 ตำแหน่งตรงกับ Column Precision NUMERIC(20,8) เอง
      // ใน App Layer — ไม่ปล่อยให้ Database ปัดทิ้งเองแบบไม่มี Control ตอน INSERT
      const quantity = deriveQuantityFromAmount(amountThb, pricePerUnit);
      // priceSource ตาม Asset Type จริง (coingecko/twelvedata) — ราคามาจาก
      // Price Feed Service ไม่ใช่ที่ User ระบุเอง ใช้แจ้งเตือนผู้ใช้ใน
      // Preview/Confirm Message ว่าราคาอาจคลาดเคลื่อนจาก Exchange ที่ User
      // ใช้จริงเล็กน้อย
      return {
        quantity,
        pricePerUnit,
        amountThb: roundToTwo(amountThb),
        priceSource: resolvePriceSource(params.symbol),
      };
    }

    // ราคาหาไม่ได้จริง (Symbol ไม่รองรับ Price Feed เช่นหุ้น หรือ CoinGecko
    // ล้มเหลว/Timeout) → คง Behavior เดิม โยน PRICE_FEED_NOT_IMPLEMENTED
    throw new TransactionServiceError(
      'PRICE_FEED_NOT_IMPLEMENTED',
      'Cannot derive quantity from amountThb without a live price feed'
    );
  }

  throw new TransactionServiceError(
    'VALIDATION_ERROR',
    'params must include either (quantity + pricePerUnit) or amountThb',
    { received: Object.keys(params) }
  );
}

// ยอดคงเหลือ = Σ(buy quantity) - Σ(sell quantity) จากประวัติทั้งหมด
// (DATABASE.md § 12 — ไม่เก็บ Quantity สะสมเป็น Column แยก แต่คำนวณจาก
// transactions ทุกครั้งที่อ่าน เพื่อเลี่ยง Race Condition ตอนเขียน)
function calculateHeldQuantity(transactions) {
  // ปัดเศษเฉพาะค่าสุดท้ายก่อน return (ไม่ปัดระหว่าง reduce แต่ละ step)
  // เพื่อกัน Floating Point สะสมผิดพลาด เช่น 0.1 + 0.2 = 0.30000000000000004
  // ใช้ roundToEight ให้ตรงกับ Precision ของ quantity (DATABASE.md NUMERIC(20,8))
  // และ resolveQuantityAndPrice ที่ปัด quantity ด้วย roundToEight เสมอ — ห้ามใช้
  // roundToTwo เพราะจะปัด Crypto ยอดน้อย (เช่น BTC 0.00049068) เป็น 0 ทำให้ Asset
  // นั้นหายจากพอร์ต/คำนวณกำไรไม่ได้
  // Stage 6a — เดิมเขียนแบบ Binary `tx.type === 'buy' ? sum + qty : sum - qty`
  // ซึ่งแปลว่า "ทุก type ที่ไม่ใช่ buy = หักจำนวนออก" — ถ้า dividend เข้ามาได้
  // จำนวนที่ถือจะหายไปเท่ากับ quantity ของรายการปันผลทันทีโดยไม่มี Error ใดๆ
  // ตอนนี้ถามความหมายจาก transactionType.util ที่เดียว (default: throw)
  const held = transactions.reduce((sum, tx) => {
    const qty = Number(tx.quantity);
    const sign = heldQuantitySign(tx.type, 'transaction.calculateHeldQuantity');
    return sum + sign * qty;
  }, 0);

  return roundToEight(held);
}

// Multi-Currency (Round 10): สกุลเงินของสินทรัพย์ อนุมานจากประวัติธุรกรรม —
// ถ้ามีธุรกรรม USD อยู่ถือว่าเป็นสินทรัพย์สกุล USD (ปกติสินทรัพย์หนึ่งตัวใช้สกุลเดียว
// สม่ำเสมอ เช่นหุ้น Dime! = USD, หุ้นไทย = THB) ใช้ตอน "ขายทั้งหมด" เพื่อเลือกราคาตลาด
// ให้ตรงสกุล ไม่ปนข้ามสกุล — Default 'THB' (ไม่มีธุรกรรม/ไม่มี currency)
function deriveAssetCurrency(transactions) {
  return transactions.some((tx) => tx.currency === 'USD') ? 'USD' : 'THB';
}

// ตรวจว่าคำสั่ง BUY ทำได้ไหม + จำแนกว่าเป็น Asset เดิมหรือต้องสร้างใหม่
// โดย "ไม่เขียน DB ใดๆ" (No Side Effect) — ใช้ร่วมกันได้ทั้งตอน Commit จริง
// (processBuyCommand) และตอนสร้าง Preview รอ Confirm (pendingTransaction.service)
// เพื่อไม่ให้ Logic ตรวจสอบ (Freemium/type/แปลงจำนวน) ถูก Copy ซ้ำสองที่
// อาจ throw: PRICE_FEED_NOT_IMPLEMENTED / VALIDATION_ERROR / ASSET_LIMIT_REACHED
async function validateBuy(userId, params, options = {}) {
  // Default Fail-closed — ถ้า Caller ไม่ส่งมา: plan='free', planExpiresAt=null
  // (ปลอดภัยกว่าปล่อยผ่าน) entitlement จะถือว่า premium ที่หมดอายุ/ไม่มีวันหมดอายุ
  // = free โดยอัตโนมัติ
  const { plan = 'free', planExpiresAt = null } = options;
  // ⚠️ **ห้ามใส่ `?? null`** — ส่ง params.portfolioId ต่อ "ตามที่เป็น" เหมือน brokerId
  // undefined = "ไม่ระบุพอร์ต" (ค้นข้ามพอร์ต) · null = "เจาะจงว่าไม่มีพอร์ต"
  // การใส่ `?? null` คือต้นตอของบั๊กที่บล็อก migration 044 (หลัง Backfill ไม่เหลือ
  // แถวที่ portfolio_id IS NULL → ค้นไม่เจอ → สร้างแถวซ้ำ → ต้นทุนเฉลี่ยผิดเงียบๆ)
  const { portfolioId } = params;

  // แปลง/ตรวจจำนวนก่อน (อาจ throw PRICE_FEED/VALIDATION) — ยังไม่แตะ DB
  const amounts = await resolveQuantityAndPrice(params);

  // ⚠️ ส่ง params.brokerId ต่อ "ตามที่เป็น" ห้ามใส่ `?? null` — undefined
  // (ยังไม่ได้ถามผู้ใช้) กับ null (ผู้ใช้ตอบแล้วว่าไม่ระบุโบรก) เป็นคนละความหมาย
  // ทั้งคู่มีผลต่อการสร้างสินทรัพย์ซ้ำแถวใหม่ (ดูหัวไฟล์ assetResolution.service)
  const { asset: existingAsset } = await assetResolution.resolveOwnedAsset(userId, params.symbol, {
    portfolioId,
    brokerId: params.brokerId,
  });
  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ ด่าน "อ่านได้ เขียนไม่ได้" ของพอร์ตส่วนเกิน (Stage 8-fix)
  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️ **จุดนี้คือคอขวดร่วมของ "การซื้อ" ทุกช่องทาง** จึงวางด่านที่นี่ที่เดียว
  // แทนการแปะทีละ Controller (ไม่งั้นจะกลับมาเจอปัญหาเดิมคือ "แปะครบ 4 ที่
  // ลืมที่ 5" — ซึ่งเป็นสาเหตุที่ด่านนี้ตกหล่นมาตั้งแต่ Stage 8 รอบแรก):
  //   เว็บ        → transactions.controller → processBuyCommand → validateBuy
  //   LINE        → pendingTransaction.createPending → validateBuy
  //                 และตอนกดยืนยัน → confirmPending → processBuyCommand → validateBuy
  //   Bulk Import → bulkImport.service → validateBuy ต่อรายการ
  //                 และ confirmBatch → confirmPending → processBuyCommand → validateBuy
  //
  // ⚠️ ตรวจ "ปลายทางจริงของรายการนี้" ไม่ใช่ params.portfolioId ดิบ — เมื่อซื้อเพิ่ม
  // ใน Symbol ที่ถืออยู่แล้ว ปลายทางคือพอร์ตของสินทรัพย์แถวนั้น ซึ่งอาจต่างจากที่
  // Caller ส่งมา (เส้นทาง LINE ไม่เคยส่ง portfolioId มาเลย)
  //
  // ⚠️ ห้ามย้ายด่านนี้ไป validateSell เด็ดขาด — การขายคือ "ลดของเดิม/แก้ให้ตรง
  // ความจริง" ซึ่งต้องทำได้เสมอแม้พอร์ตถูกล็อก (มติ Founder 24 ส.ค. 2569)
  const targetPortfolioId = existingAsset ? existingAsset.portfolioId ?? null : portfolioId;
  await portfoliosService.assertCanAddToPortfolio(userId, targetPortfolioId, {
    plan,
    planExpiresAt,
  });

  if (existingAsset) {
    return {
      asset: existingAsset,
      assetType: existingAsset.type,
      newAsset: false,
      amounts,
      // ⚠️ คืน "โบรกที่ Resolve ได้จริง" ไม่ใช่ค่าที่ Caller ส่งมา — pendingTransaction
      // ต้องเก็บค่านี้ลง DB เพื่อให้ตอนกดยืนยันทีหลังกลับมาเจอสินทรัพย์แถวเดิมเป๊ะ
      // (ถ้าเก็บค่าที่ Caller ส่งมา ซึ่งเป็น undefined ตอนไม่กำกวม จะกลายเป็น NULL
      // ใน DB แล้วตอน Confirm จะไปสร้างสินทรัพย์แถวใหม่ "ไม่ระบุโบรก" ซ้ำขึ้นมา
      // = ประวัติแตกคนละ asset_id ซึ่งคือบั๊กที่ migration 014 เคยแก้)
      brokerId: existingAsset.brokerId ?? null,
    };
  }

  // Asset ใหม่ — เช็ค Freemium Limit เฉพาะตอนจะสร้าง Asset ใหม่ (SRS.md § 2.3 [2])
  // ตัดสินสิทธิ์ผ่าน entitlement (แหล่งตัดสินสิทธิ์เดียว) แทนการเทียบ plan ตรงๆ:
  // getActiveAssetLimit คืน null = ไม่จำกัด (Premium ที่ยัง Active) / เลข = เพดาน Free
  // พฤติกรรมเหมือนเดิมทุกอย่าง ต่างแค่ "premium ที่หมดอายุ = ถือเป็น free"
  //
  // ⚠️ Stage 5 (migration 046) — เพดาน Free นับ "จำนวน Symbol ที่ต่างกัน" ไม่ใช่
  // จำนวนแถว (มติ Founder 23 ส.ค. 2569: ถือ BTC ที่ 2 โบรก = 1 สินทรัพย์) และ
  // ต้อง "ข้ามการเทียบเพดานไปเลย" ถ้า Symbol นี้ถืออยู่แล้ว เพราะกรณีนั้นคือการ
  // เพิ่มโบรกที่ N ให้สินทรัพย์เดิม ซึ่งไม่ได้เพิ่มจำนวนสินทรัพย์เลยแม้แต่ตัวเดียว
  // — ผู้ใช้ Free ที่เต็มเพดาน 2 ตัวแล้วต้องยังเพิ่มโบรกให้ของเดิมได้เสมอ
  // (Logic เดียวกันถูกบังคับซ้ำใต้ Lock ที่ RPC create_asset_locked — migration 046)
  const assetLimit = entitlement.getActiveAssetLimit({ plan, planExpiresAt });
  if (assetLimit !== null) {
    const activeSymbols = await assetRepository.findActiveSymbolsByUser(userId);
    const isNewSymbol = !activeSymbols.includes(params.symbol);
    if (isNewSymbol && activeSymbols.length >= assetLimit) {
      throw new TransactionServiceError(
        'ASSET_LIMIT_REACHED',
        `Free plan is limited to ${assetLimit} active assets`,
        { limit: assetLimit, current: activeSymbols.length }
      );
    }
  }

  // การจำแนก type ของ Symbol ใหม่ (เช่น BTC=crypto, PTT=stock_th) ต้องมาจาก
  // Caller (Symbol Registry) — ไม่เดา type มั่ว
  if (!params.type) {
    throw new TransactionServiceError(
      'VALIDATION_ERROR',
      'Creating a new asset requires an asset type',
      { symbol: params.symbol }
    );
  }

  // assetLimit ติดไปกับผลลัพธ์ด้วย (ไม่ใช่แค่ใช้ตรวจแล้วทิ้ง) — processBuyCommand
  // ต้องใช้ค่าเดียวกันนี้ส่งต่อให้ assetRepository.create() (RPC create_asset_locked
  // — migration 035) เป็นด่านตัดสินจริงตอน Insert อีกชั้น ไม่คำนวณซ้ำสองที่
  // ── พอร์ตปลายทางของ "สินทรัพย์ใหม่" ────────────────────────────────────
  // ⚠️ Invariant ของ migration 044/045 บังคับว่า **สินทรัพย์ทุกแถวต้องสังกัดพอร์ต**
  // ถ้าปล่อยให้สร้างด้วย portfolio_id = NULL หลัง Backfill แล้ว migration 045 ที่ใช้
  // เป็น Health Check จะ RAISE EXCEPTION ทันที
  //
  // ผู้ใช้ไม่ระบุพอร์ต (เส้นทาง LINE ไม่มีคอนเซ็ปต์พอร์ตเลย) → ลงพอร์ต Default
  // ซึ่งเป็นพฤติกรรมที่ตรงกับก่อน 044 มากที่สุด (ตอนนั้นทุกอย่างอยู่กองเดียวกัน)
  //
  // ⚠️ **นี่ไม่ใช่ Silent Default ที่ขัดกฎยืนข้อ 11** เพราะกรณีกำกวมจริง (ถือ Symbol
  // นี้อยู่แล้วในพอร์ตอื่น) ถูก assetResolution โยน AMBIGUOUS_ASSET_PORTFOLIO ดักไป
  // ก่อนหน้านี้แล้ว — มาถึงตรงนี้ได้แปลว่า "ยังไม่เคยถือ Symbol นี้ที่ไหนเลย"
  // ซึ่งไม่มีอะไรให้กำกวม การเลือกพอร์ตหลักจึงเป็นการตัดสินที่มีคำตอบเดียว
  //
  // ก่อน 044: ผู้ใช้ยังไม่มีพอร์ตเลย → findDefaultByUser คืน null → ได้ null
  // เท่ากับพฤติกรรมเดิมทุกประการ (Backward Compatible)
  let resolvedPortfolioId = portfolioId;
  if (resolvedPortfolioId === undefined) {
    const defaultPortfolio = await portfolioRepository.findDefaultByUser(userId);
    resolvedPortfolioId = defaultPortfolio?.id ?? null;
  }

  return {
    asset: null,
    assetType: params.type,
    newAsset: true,
    amounts,
    assetLimit,
    // Asset ใหม่ยังไม่มีโบรกใน DB — ใช้ค่าที่ผู้ใช้เลือกมา (null = ไม่ระบุ)
    brokerId: params.brokerId ?? null,
    // พอร์ตปลายทางที่ Resolve แล้ว — processBuyCommand ต้องใช้ค่านี้ตอนสร้าง Asset
    // ไม่ใช่ params.portfolioId ดิบ (ซึ่งเป็น undefined ตอนไม่ระบุ)
    portfolioId: resolvedPortfolioId,
  };
}

async function processBuyCommand(userId, params, options = {}) {

  const {
    asset: existingAsset,
    assetType,
    newAsset,
    amounts,
    assetLimit,
    // ⚠️ ใช้พอร์ตที่ validateBuy Resolve แล้ว ไม่ใช่ params.portfolioId ดิบ —
    // ตอนไม่ระบุพอร์ต ค่าดิบเป็น undefined แต่สินทรัพย์ใหม่ต้องลงพอร์ต Default
    // (Invariant migration 044/045) ดู validateBuy
    portfolioId: resolvedPortfolioId,
  } = await validateBuy(
    userId,
    params,
    options
  );
  const { quantity, pricePerUnit, amountThb, priceSource } = amounts;
  const currency = amounts.currency ?? 'THB';

  let asset = existingAsset;
  if (newAsset) {
    try {
      asset = await assetRepository.create(
        userId,
        // ⚠️ พอร์ตที่ validateBuy Resolve แล้ว ไม่ใช่ค่าดิบ (undefined ตอนไม่ระบุ)
        resolvedPortfolioId,
        params.symbol,
        params.name ?? params.symbol,
        assetType,
        // กองทุนรวม (Round 7) — เก็บ Class ที่เลือกไว้ถาวรเพื่อ Mark-to-market ตรง Class
        // (สินทรัพย์อื่น projId/fundClassName = undefined → คอลัมน์เป็น null)
        { projId: params.projId, fundClassName: params.fundClassName },
        assetLimit,
        // Stage 5 — โบรกที่ผู้ใช้เลือก (null = ไม่ระบุ ซึ่งเป็นค่าของทุกแถวเดิม)
        // ต้องผ่าน brokerService.assertOwnedBrokerId() มาแล้วจากชั้น Controller
        params.brokerId ?? null
      );
    } catch (err) {
      // ── ด่านจริงของ "เกินเพดาน Free Plan" อยู่ที่ DB (migration 035) ───────────
      // Pre-check ใน validateBuy ด้านบนเป็นแค่ค่าที่ตอบผู้ใช้ได้เร็ว/สวยตอน Preview
      // แต่ไม่ Atomic — ถ้ามีคำสั่งซื้อ Symbol ใหม่ตัวอื่นแทรกเข้ามาระหว่างที่เราตรวจ
      // เสร็จแล้วยังไม่ทัน INSERT (Race) RPC จะเป็นคนปฏิเสธแทน ต้องแปลงกลับเป็น
      // TransactionServiceError ให้ "เหมือนกับที่ Pre-check throw ทุกประการ" — Caller
      // ทั้งเว็บ (instanceof) และ LINE (err.code) จึงไม่รู้เลยว่าถูกปฏิเสธจากด่านไหน
      if (err.code === 'ASSET_LIMIT_REACHED') {
        throw new TransactionServiceError(
          'ASSET_LIMIT_REACHED',
          `Free plan is limited to ${assetLimit} active assets`,
          // details ของ RPC เป็นยอดจริง ณ วินาทีที่ Lock — แม่นกว่าค่าที่ Pre-check
          // อ่านมาก่อนหน้า (ซึ่งล้าสมัยไปแล้วในเคส Race นี้พอดี)
          { limit: err.details?.limit ?? assetLimit, current: err.details?.current }
        );
      }
      // Symbol เดียวกันถูกสร้างไปแล้วพอดี (กดซ้ำ/สองแท็บ) — ไม่ใช่เกินเพดาน แต่เป็น
      // เงื่อนไขคนละแบบที่ผู้ใช้ควรรู้ว่า "รายการนี้อาจถูกบันทึกไปแล้ว" ให้ไปตรวจพอร์ต
      // แทนที่จะลองซื้อ Symbol เดิมซ้ำ (Code ใหม่ — เพิ่ง Map เป็นข้อความไทยรอบนี้)
      if (err.code === 'ASSET_ALREADY_EXISTS') {
        throw new TransactionServiceError(
          'ASSET_ALREADY_EXISTS',
          `Asset ${params.symbol} already exists for this user`,
          { symbol: params.symbol }
        );
      }
      throw err;
    }
  }

  const transaction = await transactionRepository.create({
    userId,
    assetId: asset.id,
    type: 'buy',
    amountThb,
    pricePerUnit,
    quantity,
    currency,
    feeThb: params.feeThb ?? null,
    date: params.date ?? todayInBangkok(),
    note: params.note ?? null,
    // ช่องทางที่บันทึก (DATABASE.md § transactions — CHECK IN ('line','web','slip_ai'))
    // Default 'line' เมื่อ Caller ไม่ส่งมา = ทุก Path เดิม (LINE/OCR/Bulk Import) ได้ค่า
    // เท่าเดิมทุกประการ — เว็บ (S8 R1a) ส่ง 'web' เข้ามาเพื่อแยกช่องทางใน Ledger
    source: params.source ?? 'line',
  });

  return {
    transactionId: transaction.id,
    symbol: params.symbol,
    quantity,
    pricePerUnit,
    amountThb,
    currency,
    newAssetCreated: newAsset,
    priceSource,
    // Field ดิบของรายการที่เพิ่งบันทึก — Web Controller ใช้ประกอบการ์ดตอบกลับ
    // โดยไม่ต้อง Query ซ้ำ (LINE Path เดิมไม่ได้อ่าน Field นี้ = ไม่กระทบ)
    date: transaction.date,
    note: transaction.note,
  };
}

// ตรวจว่าคำสั่ง SELL ทำได้ไหม (Asset มีจริง + ยอดคงเหลือพอ) โดย "ไม่เขียน DB"
// ใช้ร่วมกันทั้ง Commit จริงและ Preview เช่นเดียวกับ validateBuy
// อาจ throw: ASSET_NOT_FOUND / PRICE_FEED_NOT_IMPLEMENTED / INSUFFICIENT_QUANTITY
async function validateSell(userId, params) {
  // ⚠️ ห้ามใส่ `?? null` (ดูเหตุผลใน validateBuy) — ขายต้องหาสินทรัพย์เจอข้ามพอร์ต
  // ผู้ใช้ไม่ควรต้องรู้ว่าหุ้นอยู่พอร์ตไหนถึงจะขายได้
  const { portfolioId } = params;

  // ⚠️ ห้ามใส่ `?? null` ให้ params.brokerId (ดู validateBuy/assetResolution.service)
  // ขายผิดโบรก = ตัดยอดคงเหลือของโบรกที่ไม่ได้ขายจริง แล้วต้นทุนเฉลี่ยเพี้ยนทั้งคู่
  const { asset } = await assetResolution.resolveOwnedAsset(userId, params.symbol, {
    portfolioId,
    brokerId: params.brokerId,
  });
  if (!asset) {
    throw new TransactionServiceError('ASSET_NOT_FOUND', `Asset ${params.symbol} not found for this user`, {
      symbol: params.symbol,
    });
  }

  // ── "ขายทั้งหมด" (params.sellAll) ────────────────────────────────────────
  // เติมจำนวน = ยอดคงเหลือปัจจุบัน (Reuse calculateHeldQuantity — DATABASE.md § 12
  // ไม่มีคอลัมน์เก็บ heldQuantity จึงคำนวณจากประวัติเสมอ) และราคา = ราคาตลาด ณ ตอนนี้
  // (Reuse getCurrentPrice เดิมที่คำสั่งขายปกติใช้อยู่) แล้วเดินต่อผ่าน Flow Pending/
  // Confirm ปกติเหมือนคำสั่งขายทั่วไป (ราคาถูก Snapshot ไว้ตอน Preview — Confirm ใช้
  // ค่าที่ Snapshot ไม่ดึงราคาใหม่ ตาม Design pendingTransaction.service เดิม)
  if (params.sellAll) {
    const historyForAll = await transactionRepository.findAllByAsset(asset.id, userId);
    const heldForAll = calculateHeldQuantity(historyForAll);

    if (heldForAll <= 0) {
      // Asset มีอยู่จริงแต่ขายหมดแล้ว — แยก Error จาก ASSET_NOT_FOUND (ไม่เคยมี)
      throw new TransactionServiceError(
        'NOTHING_TO_SELL',
        `No remaining holding of ${params.symbol} to sell`,
        { symbol: params.symbol, held: heldForAll }
      );
    }

    // สกุลเงินตามสินทรัพย์ (ไม่ปนข้ามสกุล) — USD ใช้ราคาตลาด USD ตามจริง มิฉะนั้น THB
    const assetCurrency = deriveAssetCurrency(historyForAll);
    const marketPrice =
      assetCurrency === 'USD'
        ? await priceFeedService.getCurrentPriceUsd(params.symbol)
        : await priceFeedService.getCurrentPrice(params.symbol);
    if (marketPrice === null) {
      // ไม่มี Price Feed (หุ้นไทย) / API ล่มชั่วคราว — ไม่ Fallback ราคาเดา/0
      throw new TransactionServiceError(
        'MARKET_PRICE_UNAVAILABLE',
        `Cannot fetch current market price for ${params.symbol}`,
        { symbol: params.symbol }
      );
    }

    // ⚠️ ตัด amountThb ที่อาจติดมากับ params ทิ้งเสมอ — "ขายทั้งหมด" คำนวณ quantity
    // (ยอดคงเหลือ ณ ตอนนี้) และราคา (ราคาตลาด ณ ตอนนี้) ขึ้นมาใหม่ทั้งคู่ ยอดที่ตกลง
    // ไว้ก่อนหน้าจึงไม่ใช่ยอดของคู่นี้ ถ้าปล่อยให้ไหลเข้า resolveAgreedAmount จะได้ยอด
    // ที่ไม่ตรงกับ quantity × price ที่เพิ่งคำนวณ (ดู resolveAgreedAmount — บั๊ค A)
    const { amountThb: agreedAmountNotApplicable, ...paramsWithoutAgreedAmount } = params;
    void agreedAmountNotApplicable;

    const allAmounts = await resolveQuantityAndPrice(
      {
        ...paramsWithoutAgreedAmount,
        quantity: heldForAll,
        pricePerUnit: marketPrice,
        // ส่งต่อสกุลเงินของสินทรัพย์ให้ resolveQuantityAndPrice เก็บ USD ตามจริง
        ...(assetCurrency === 'USD' ? { currency: 'USD' } : {}),
      },
      'sell'
    );
    // ราคามาจาก Price Feed ไม่ใช่ที่ User พิมพ์เอง — ตั้ง priceSource ตาม Type จริง
    // (coingecko/twelvedata) เพื่อให้ Preview เตือนที่มาของราคา (priceSourceNote)
    allAmounts.priceSource = resolvePriceSource(params.symbol);

    return {
      asset,
      amounts: allAmounts,
      heldQuantity: heldForAll,
      brokerId: asset.brokerId ?? null,
    };
  }

  const amounts = await resolveQuantityAndPrice(params, 'sell');

  // ── Race Condition Warning (DATABASE.md § 12) ──────────────────────────
  // การขายต้องตรวจ "ขายเกินยอดคงเหลือ" ภายใน DB Transaction เดียวที่ Lock
  // แถว asset ด้วย SELECT ... FOR UPDATE ก่อนคำนวณ แล้วจึง INSERT
  // มิฉะนั้นสองคำสั่งขายพร้อมกันจะอ่านยอดคงเหลือชุดเดียวกัน (Stale Read)
  // แล้วผ่านการตรวจทั้งคู่ ทำให้ยอดติดลบได้
  //
  // TODO(phase1): Supabase JS Client (PostgREST) ไม่รองรับ Row-level Lock /
  // Multi-statement Transaction — ต้องย้าย Logic ข้อ [ตรวจยอด → INSERT] นี้
  // ไปเป็น Postgres RPC (SECURITY DEFINER function) ที่ทำ
  // BEGIN → SELECT FOR UPDATE → validate → INSERT → COMMIT ในตัวเดียว
  // ตาม DATABASE.md § 12
  //
  // ความเสี่ยงที่ยังเหลืออยู่ ณ ตอนนี้: การตรวจ INSUFFICIENT_QUANTITY ด้านล่าง
  // เป็นแบบ check-then-insert ที่ "ไม่ Atomic" — ยังมีช่องให้ขายเกินยอดได้จริง
  // หากมีสองคำสั่งขาย Asset เดียวกันเข้ามาพร้อมกัน ยังไม่ปลอดภัยเต็มที่
  // (การมี Preview/Confirm เพิ่มช่องเวลานี้ให้ยาวขึ้น — Confirm จึงเรียก
  // validateSell ซ้ำอีกครั้งเพื่อลดโอกาสขายเกินจากยอดที่เปลี่ยนไประหว่างรอ)
  const history = await transactionRepository.findAllByAsset(asset.id, userId);
  const heldQuantity = calculateHeldQuantity(history);

  if (amounts.quantity > heldQuantity) {
    throw new TransactionServiceError(
      'INSUFFICIENT_QUANTITY',
      'Cannot sell more than the currently held quantity',
      { requested: amounts.quantity, held: heldQuantity }
    );
  }

  return { asset, amounts, heldQuantity, brokerId: asset.brokerId ?? null };
}

async function processSellCommand(userId, params) {
  const { asset, amounts, heldQuantity } = await validateSell(userId, params);
  const { quantity, pricePerUnit, amountThb, priceSource } = amounts;
  const currency = amounts.currency ?? 'THB';

  let transaction;
  try {
    transaction = await transactionRepository.create({
      userId,
      assetId: asset.id,
      type: 'sell',
      amountThb,
      pricePerUnit,
      quantity,
      currency,
      feeThb: params.feeThb ?? null,
      date: params.date ?? todayInBangkok(),
      note: params.note ?? null,
      // Default 'line' = Path เดิมทั้งหมดได้ค่าเท่าเดิม (เหตุผลเดียวกับ processBuyCommand)
      source: params.source ?? 'line',
    });
  } catch (err) {
    // ── ด่านจริงของ "ขายเกินยอด" อยู่ที่ DB (migration 034) ────────────────────
    // validateSell ด้านบนเป็นแค่ Pre-check ที่ตอบผู้ใช้ได้เร็วและมีข้อความสวย แต่
    // ไม่ Atomic — ถ้ามีคำสั่งขายอื่นแทรกเข้ามาระหว่างที่เราตรวจเสร็จแล้วยังไม่ทัน
    // INSERT (Race) RPC จะเป็นคนปฏิเสธแทน ต้องแปลงกลับเป็น TransactionServiceError
    // ให้ "เหมือนกับที่ validateSell throw ทุกประการ" — Caller ทั้งเว็บ (instanceof)
    // และ LINE (err.code) จึงไม่รู้เลยว่าถูกปฏิเสธจากด่านไหน Contract ไม่เปลี่ยน
    if (err.code === 'INSUFFICIENT_QUANTITY') {
      throw new TransactionServiceError(
        'INSUFFICIENT_QUANTITY',
        'Cannot sell more than the currently held quantity',
        // details ของ RPC เป็นยอดจริง ณ วินาทีที่ Lock — แม่นกว่า heldQuantity ที่
        // Pre-check อ่านมาก่อนหน้า (ซึ่งเป็นค่าที่ล้าสมัยไปแล้วในเคส Race นี้พอดี)
        { requested: err.details?.requested ?? quantity, held: err.details?.held ?? heldQuantity }
      );
    }
    throw err;
  }

  return {
    transactionId: transaction.id,
    symbol: params.symbol,
    quantity,
    pricePerUnit,
    amountThb,
    currency,
    // ใช้ยอดหลังบันทึกที่ RPC คำนวณจากค่าที่ Lock ไว้จริง — Fallback เป็นวิธีเดิม
    // เผื่อ RPC ไม่ได้ส่ง heldAfter มา (Caller ที่ Mock Repository ในเทสต์เดิม)
    remainingQuantity: transaction.heldAfter ?? roundToEight(heldQuantity - quantity),
    priceSource,
    date: transaction.date,
    note: transaction.note,
  };
}

module.exports = {
  TransactionServiceError,
  MAX_FREE_ASSETS,
  calculateHeldQuantity,
  deriveQuantityFromAmount,
  todayInBangkok,
  validateBuy,
  validateSell,
  processBuyCommand,
  processSellCommand,
};
