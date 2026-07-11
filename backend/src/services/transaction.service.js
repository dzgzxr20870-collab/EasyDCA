const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const priceFeedService = require('./priceFeed.service');
const fxRateService = require('./fxRate.service');
const symbolRegistry = require('./symbolRegistry.service');
const entitlement = require('./entitlement.service');

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

    // ── ราคาต่อหน่วยเป็น USD (Round 10) — เก็บเป็น USD ตามจริง ไม่แปลงตอนบันทึก ──
    // amountThb/pricePerUnit ที่คืน = ค่าในหน่วย USD (ชื่อ Field คงเดิมเพื่อ Backward
    // Compat — ดู migration 012 Semantics) fx = ยอดเทียบบาทไว้ "แสดงผลเท่านั้น"
    // (null ได้ถ้าดึงเรตไม่ได้ — ไม่ Block การบันทึก)
    if (isUsd) {
      return {
        quantity,
        pricePerUnit: pricePerUnitInput,
        amountThb: roundToTwo(quantity * pricePerUnitInput),
        currency: 'USD',
        priceSource: 'user',
        fx: await buildUsdFxDisplay(roundToTwo(quantity * pricePerUnitInput), pricePerUnitInput),
      };
    }

    // priceSource: 'user' — ราคาที่ User ระบุเองตรงๆ (ไม่ได้มาจาก Price Feed)
    // ใช้แยกแยะใน Preview/Confirm Message ว่าควรเตือนเรื่องราคาอ้างอิงไหม
    const resolved = {
      quantity,
      pricePerUnit: pricePerUnitInput,
      amountThb: roundToTwo(quantity * pricePerUnitInput),
      priceSource: 'user',
    };

    // ทอง: ผู้ใช้พิมพ์ราคาต้นทุนเอง (THB) — Enrich ราคาอ้างอิง USD ให้ Preview แสดง
    // ทั้ง THB และ USD (Phase 3 Round 7) ไม่กระทบยอด THB ที่บันทึกจริง
    if (getGoldType(params.symbol)) {
      resolved.goldUsd = await buildGoldUsdRef(pricePerUnitInput);
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
      const quantity = roundToEight(amountUsd / priceUsd);
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
      const quantity = roundToEight(amountThb / pricePerUnit);
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
      const quantity = roundToEight(amountThb / pricePerUnit);
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
      const quantity = roundToEight(amountThb / pricePerUnit);
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
  const held = transactions.reduce((sum, tx) => {
    const qty = Number(tx.quantity);
    return tx.type === 'buy' ? sum + qty : sum - qty;
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
  const portfolioId = params.portfolioId ?? null;

  // แปลง/ตรวจจำนวนก่อน (อาจ throw PRICE_FEED/VALIDATION) — ยังไม่แตะ DB
  const amounts = await resolveQuantityAndPrice(params);

  const existingAsset = await assetRepository.findByUserAndSymbol(
    userId,
    params.symbol,
    portfolioId
  );
  if (existingAsset) {
    return { asset: existingAsset, assetType: existingAsset.type, newAsset: false, amounts };
  }

  // Asset ใหม่ — เช็ค Freemium Limit เฉพาะตอนจะสร้าง Asset ใหม่ (SRS.md § 2.3 [2])
  // ตัดสินสิทธิ์ผ่าน entitlement (แหล่งตัดสินสิทธิ์เดียว) แทนการเทียบ plan ตรงๆ:
  // getActiveAssetLimit คืน null = ไม่จำกัด (Premium ที่ยัง Active) / เลข = เพดาน Free
  // พฤติกรรมเหมือนเดิมทุกอย่าง ต่างแค่ "premium ที่หมดอายุ = ถือเป็น free"
  const assetLimit = entitlement.getActiveAssetLimit({ plan, planExpiresAt });
  if (assetLimit !== null) {
    const activeCount = await assetRepository.countActiveByUser(userId);
    if (activeCount >= assetLimit) {
      throw new TransactionServiceError(
        'ASSET_LIMIT_REACHED',
        `Free plan is limited to ${assetLimit} active assets`,
        { limit: assetLimit, current: activeCount }
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

  return { asset: null, assetType: params.type, newAsset: true, amounts };
}

async function processBuyCommand(userId, params, options = {}) {
  const portfolioId = params.portfolioId ?? null;

  const { asset: existingAsset, assetType, newAsset, amounts } = await validateBuy(
    userId,
    params,
    options
  );
  const { quantity, pricePerUnit, amountThb, priceSource } = amounts;
  const currency = amounts.currency ?? 'THB';

  let asset = existingAsset;
  if (newAsset) {
    asset = await assetRepository.create(
      userId,
      portfolioId,
      params.symbol,
      params.name ?? params.symbol,
      assetType,
      // กองทุนรวม (Round 7) — เก็บ Class ที่เลือกไว้ถาวรเพื่อ Mark-to-market ตรง Class
      // (สินทรัพย์อื่น projId/fundClassName = undefined → คอลัมน์เป็น null)
      { projId: params.projId, fundClassName: params.fundClassName }
    );
  }

  const transaction = await transactionRepository.create({
    userId,
    assetId: asset.id,
    type: 'buy',
    amountThb,
    pricePerUnit,
    quantity,
    currency,
    feeThb: params.feeThb ?? 0,
    date: params.date ?? todayInBangkok(),
    note: params.note ?? null,
    source: 'line',
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
  };
}

// ตรวจว่าคำสั่ง SELL ทำได้ไหม (Asset มีจริง + ยอดคงเหลือพอ) โดย "ไม่เขียน DB"
// ใช้ร่วมกันทั้ง Commit จริงและ Preview เช่นเดียวกับ validateBuy
// อาจ throw: ASSET_NOT_FOUND / PRICE_FEED_NOT_IMPLEMENTED / INSUFFICIENT_QUANTITY
async function validateSell(userId, params) {
  const portfolioId = params.portfolioId ?? null;

  const asset = await assetRepository.findByUserAndSymbol(userId, params.symbol, portfolioId);
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
    const historyForAll = await transactionRepository.findAllByAsset(asset.id);
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

    const allAmounts = await resolveQuantityAndPrice(
      {
        ...params,
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

    return { asset, amounts: allAmounts, heldQuantity: heldForAll };
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
  const history = await transactionRepository.findAllByAsset(asset.id);
  const heldQuantity = calculateHeldQuantity(history);

  if (amounts.quantity > heldQuantity) {
    throw new TransactionServiceError(
      'INSUFFICIENT_QUANTITY',
      'Cannot sell more than the currently held quantity',
      { requested: amounts.quantity, held: heldQuantity }
    );
  }

  return { asset, amounts, heldQuantity };
}

async function processSellCommand(userId, params) {
  const { asset, amounts, heldQuantity } = await validateSell(userId, params);
  const { quantity, pricePerUnit, amountThb, priceSource } = amounts;
  const currency = amounts.currency ?? 'THB';

  const transaction = await transactionRepository.create({
    userId,
    assetId: asset.id,
    type: 'sell',
    amountThb,
    pricePerUnit,
    quantity,
    currency,
    feeThb: params.feeThb ?? 0,
    date: params.date ?? todayInBangkok(),
    note: params.note ?? null,
    source: 'line',
  });

  return {
    transactionId: transaction.id,
    symbol: params.symbol,
    quantity,
    pricePerUnit,
    amountThb,
    currency,
    remainingQuantity: roundToEight(heldQuantity - quantity),
    priceSource,
  };
}

module.exports = {
  TransactionServiceError,
  MAX_FREE_ASSETS,
  calculateHeldQuantity,
  todayInBangkok,
  validateBuy,
  validateSell,
  processBuyCommand,
  processSellCommand,
};
