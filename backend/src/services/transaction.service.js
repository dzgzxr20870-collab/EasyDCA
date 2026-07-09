const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const priceFeedService = require('./priceFeed.service');
const symbolRegistry = require('./symbolRegistry.service');
const entitlement = require('./entitlement.service');

// แหล่งราคาจริงตาม Asset Type (Pattern เดียวกับที่ priceFeed.service.js ใช้
// จัดเส้นทาง Crypto → CoinGecko / หุ้นสหรัฐ → Twelve Data) — priceFeedService
// รองรับทั้งสอง Type แล้ว จึงต้องระบุ priceSource ให้ตรงจริง ไม่ Hardcode
// 'coingecko' ตายตัว (เดิมมีมาก่อนที่จะรองรับหุ้นสหรัฐ)
function resolvePriceSource(symbol) {
  const type = symbolRegistry.lookupType(symbol);
  if (type === 'stock_us') return 'twelvedata';
  return 'coingecko';
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
async function resolveQuantityAndPrice(params) {
  if (isPresent(params.quantity) && isPresent(params.pricePerUnit)) {
    const quantity = Number(params.quantity);
    const pricePerUnitInput = Number(params.pricePerUnit);

    // ผู้ใช้พิมพ์ราคาต่อหน่วยเป็น USD → แปลงเป็น THB ด้วย FX Rate เดิมจาก
    // priceFeed.service (Reuse getUsdThbFxRate — ไม่เขียน FX Conversion ใหม่)
    // amountThb ที่บันทึกลง DB เป็น THB เสมอ ไม่มีคอลัมน์เก็บ USD คู่ขนาน — เก็บ fx
    // ไว้ให้ Preview แสดงทั้งยอด USD ที่พิมพ์และยอด THB ที่แปลงแล้ว + เรตที่ใช้
    if (params.priceCurrency === 'USD') {
      const rate = await priceFeedService.getUsdThbFxRate();
      if (rate === null) {
        // ดึง FX ไม่ได้ (Key ไม่ได้ตั้ง / Twelve Data ล่ม) — ไม่ Fallback เรตเดา
        throw new TransactionServiceError(
          'FX_RATE_UNAVAILABLE',
          'Cannot convert USD price to THB: FX rate unavailable',
          { symbol: params.symbol }
        );
      }

      const pricePerUnit = roundToEight(pricePerUnitInput * rate);
      return {
        quantity,
        pricePerUnit,
        amountThb: roundToTwo(quantity * pricePerUnit),
        priceSource: 'user',
        // Enrich สำหรับ Preview เท่านั้น (ไม่ Persist ลง DB — ไม่มีคอลัมน์รองรับ)
        fx: {
          currency: 'USD',
          rate,
          pricePerUnitOriginal: pricePerUnitInput,
          amountOriginal: roundToTwo(quantity * pricePerUnitInput),
        },
      };
    }

    // priceSource: 'user' — ราคาที่ User ระบุเองตรงๆ (ไม่ได้มาจาก Price Feed)
    // ใช้แยกแยะใน Preview/Confirm Message ว่าควรเตือนเรื่องราคาอ้างอิงไหม
    return {
      quantity,
      pricePerUnit: pricePerUnitInput,
      amountThb: roundToTwo(quantity * pricePerUnitInput),
      priceSource: 'user',
    };
  }

  if (isPresent(params.amountThb)) {
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

  let asset = existingAsset;
  if (newAsset) {
    asset = await assetRepository.create(
      userId,
      portfolioId,
      params.symbol,
      params.name ?? params.symbol,
      assetType
    );
  }

  const transaction = await transactionRepository.create({
    userId,
    assetId: asset.id,
    type: 'buy',
    amountThb,
    pricePerUnit,
    quantity,
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

    const marketPrice = await priceFeedService.getCurrentPrice(params.symbol);
    if (marketPrice === null) {
      // ไม่มี Price Feed (หุ้นไทย) / API ล่มชั่วคราว — ไม่ Fallback ราคาเดา/0
      throw new TransactionServiceError(
        'MARKET_PRICE_UNAVAILABLE',
        `Cannot fetch current market price for ${params.symbol}`,
        { symbol: params.symbol }
      );
    }

    const allAmounts = await resolveQuantityAndPrice({
      ...params,
      quantity: heldForAll,
      pricePerUnit: marketPrice,
    });
    // ราคามาจาก Price Feed ไม่ใช่ที่ User พิมพ์เอง — ตั้ง priceSource ตาม Type จริง
    // (coingecko/twelvedata) เพื่อให้ Preview เตือนที่มาของราคา (priceSourceNote)
    allAmounts.priceSource = resolvePriceSource(params.symbol);

    return { asset, amounts: allAmounts, heldQuantity: heldForAll };
  }

  const amounts = await resolveQuantityAndPrice(params);

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

  const transaction = await transactionRepository.create({
    userId,
    assetId: asset.id,
    type: 'sell',
    amountThb,
    pricePerUnit,
    quantity,
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
