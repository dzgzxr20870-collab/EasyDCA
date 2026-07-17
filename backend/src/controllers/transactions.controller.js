const transactionService = require('../services/transaction.service');
const undoTransactionService = require('../services/undoTransaction.service');
const symbolRegistry = require('../services/symbolRegistry.service');
const dcaStatsService = require('../services/dcaStats.service');
const transactionRepository = require('../repositories/transaction.repository');

// ═══════════════════════════════════════════════════════════════════════════
// transactions.controller — บันทึก DCA จากเว็บ (S8 Round 1a)
// ═══════════════════════════════════════════════════════════════════════════
// หลักการเดียวของไฟล์นี้: "ไม่มีตรรกะสร้างธุรกรรมที่นี่เลย" — หน้าที่ทั้งหมดคือ
// แปลง (Map) ฟอร์มเว็บ → params รูปแบบเดิมของ transaction.service ตัวเดียวกับที่
// webhook.controller (LINE) ใช้ แล้วเรียก processBuyCommand ตรงๆ
//
// ทุกอย่างที่เป็น "เงิน" (ดึงราคาตลาด / คำนวณจำนวนหน่วย / Multi-Currency / FX /
// Freemium Asset Limit) เกิดขึ้นใน transaction.service ที่เดียวเหมือนเดิมทุกประการ
// ไฟล์นี้ทำแค่ Validate Input + Map + แปลง Error เป็นข้อความไทย
//
// ⚠️ ข้อแตกต่างเดียวที่ตั้งใจให้ต่างจาก LINE: เว็บบันทึก "ทันที" (ไม่มี Preview →
// Confirm 2 ขั้นแบบ LINE) เพราะฟอร์มบนเว็บเห็นข้อมูลครบก่อนกดปุ่มอยู่แล้ว จึงเรียก
// processBuyCommand ตรง (เส้นทางเดียวกับที่ pendingTransaction.confirmPending เรียก
// ตอนผู้ใช้กดยืนยันใน LINE) — ไม่ใช่การ Skip Validation ใดๆ เพราะ processBuyCommand
// เรียก validateBuy เต็มรูปแบบภายในตัวเองอยู่แล้ว

// สินทรัพย์ที่ระบบดึง "ราคาสด" ให้ได้ → ฟอร์มเว็บไม่ต้องส่ง pricePerUnit มา
// (เส้นทาง LINE #1: "ซื้อ AAPL 1000" — service ดึงราคาเองแล้วหารจำนวนหน่วย)
// stock_th ไม่อยู่ในนี้: หุ้นไทยยังไม่มี Price Feed ในระบบ (ดู priceFeed.service)
const LIVE_PRICE_TYPES = ['crypto', 'stock_us', 'gold_bar', 'gold_ornament'];

// สกุล USD ใช้ได้เฉพาะประเภทที่ "มีราคา USD จริง" ตามที่ priceFeed.getCurrentPriceUsd
// รองรับอยู่เดิม (Crypto ผ่าน CoinGecko + หุ้นสหรัฐผ่าน Twelve Data) — ทองคำเป็นราคา
// "บาททองคำ" จากสมาคมค้าทองคำฯ (THB) และหุ้นไทยเป็น THB จึงบันทึกเป็น USD ไม่ได้
const USD_SUPPORTED_TYPES = ['crypto', 'stock_us'];

// ความยาว note สูงสุด — transactions.note เป็น TEXT (ไม่จำกัดใน DB) แต่จำกัดที่ชั้นนี้
// กัน Payload ใหญ่ผิดปกติ (ไม่ใช่ข้อจำกัดทางธุรกิจ)
const MAX_NOTE_LENGTH = 500;

// ข้อความไทยสำหรับเว็บโดยเฉพาะ — จงใจ "ไม่" Reuse flexMessage.util.ERROR_MESSAGES
// ของ LINE เพราะข้อความชุดนั้นสั่งให้ผู้ใช้ "พิมพ์คำสั่ง" (เช่น 'กรุณาระบุจำนวนหน่วย
// และราคา เช่น "ซื้อ PTT 50 หุ้น ราคา 34"' / 'ลองพิมพ์ "พอต"') ซึ่งเป็นวิธีใช้งานของ
// แชท ไม่ใช่ของฟอร์มเว็บ — ถ้า Reuse ตรงๆ ผู้ใช้เว็บจะได้คำแนะนำที่ทำตามไม่ได้
// (อีกทั้ง flexMessage.util คือ View Layer ของ LINE — Controller เว็บไม่ควร Import)
const WEB_ERROR_MESSAGES = {
  VALIDATION_ERROR: 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  SYMBOL_NOT_SUPPORTED:
    'ระบบยังไม่รองรับสินทรัพย์นี้ กรุณาเลือกจากรายการสินทรัพย์ที่มีให้',
  PRICE_REQUIRED_FOR_ASSET:
    'สินทรัพย์นี้ยังไม่มีราคาตลาดอัตโนมัติ (เช่น หุ้นไทย) กรุณากรอก "ราคาต่อหน่วย" ที่ซื้อด้วย',
  CURRENCY_NOT_SUPPORTED_FOR_ASSET:
    'สินทรัพย์นี้บันทึกเป็นสกุล USD ไม่ได้ รองรับเฉพาะคริปโตและหุ้นสหรัฐ',
  DATE_IN_FUTURE: 'บันทึกรายการล่วงหน้าไม่ได้ กรุณาเลือกวันที่ไม่เกินวันนี้',
  AMOUNT_TOO_SMALL_FOR_PRICE:
    'จำนวนเงินน้อยเกินไปเมื่อเทียบกับราคาต่อหน่วย จนคำนวณจำนวนหน่วยไม่ได้ กรุณาเพิ่มจำนวนเงินหรือตรวจสอบราคา',
  NOTE_RESERVED_PREFIX: 'หมายเหตุนี้ใช้ไม่ได้ (ขึ้นต้นด้วยคำที่ระบบสงวนไว้) กรุณาแก้ไขข้อความ',
  ASSET_LIMIT_REACHED:
    'คุณใช้ครบ 2 สินทรัพย์ตามแพ็กเกจ Free แล้ว หากต้องการเพิ่มสินทรัพย์ใหม่ กรุณาอัพเกรดเป็น Premium',
  PRICE_FEED_NOT_IMPLEMENTED:
    'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หรือกรอกราคาต่อหน่วยเอง',
  MARKET_PRICE_UNAVAILABLE:
    'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หรือกรอกราคาต่อหน่วยเอง',
  GOLD_PRICE_UNAVAILABLE:
    'ดึงราคาทองคำปัจจุบันไม่ได้ในขณะนี้ (ราคายังไม่อัพเดตหรือระบบราคาขัดข้องชั่วคราว) กรุณาลองใหม่ภายหลัง หรือกรอกราคาต่อหน่วยเอง',
  NO_TRANSACTION_TO_UNDO: 'ไม่มีรายการให้ยกเลิก',
  ALREADY_UNDONE: 'รายการล่าสุดถูกยกเลิกไปแล้ว',
  CANNOT_UNDO_QUANTITY_MISMATCH:
    'ยกเลิกรายการนี้ไม่ได้ เพราะยอดคงเหลือปัจจุบันน้อยกว่าจำนวนที่ซื้อไว้ (มีการขายเกิดขึ้นหลังจากนั้น)',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

// HTTP Status ต่อ Error Code — ตาม API.md § 5/§ 6 (Business Rule ที่ผู้ใช้แก้เองได้
// = 400, สิทธิ์ไม่พอ = 403, ราคา/บริการภายนอกไม่พร้อม = 503)
const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  SYMBOL_NOT_SUPPORTED: 400,
  PRICE_REQUIRED_FOR_ASSET: 400,
  CURRENCY_NOT_SUPPORTED_FOR_ASSET: 400,
  DATE_IN_FUTURE: 400,
  AMOUNT_TOO_SMALL_FOR_PRICE: 400,
  NOTE_RESERVED_PREFIX: 400,
  NO_TRANSACTION_TO_UNDO: 400,
  ALREADY_UNDONE: 400,
  CANNOT_UNDO_QUANTITY_MISMATCH: 400,
  ASSET_LIMIT_REACHED: 403,
  PRICE_FEED_NOT_IMPLEMENTED: 503,
  MARKET_PRICE_UNAVAILABLE: 503,
  GOLD_PRICE_UNAVAILABLE: 503,
  SEC_NOT_CONFIGURED: 503,
  MUTUAL_FUND_NAV_UNAVAILABLE: 503,
};

// Error Response ของเว็บ: คง Field `error` = Error Code แบบ Flat ให้ตรงกับทุก
// Endpoint เดิมของฝั่งเว็บ (dashboard/payment/auth) ที่ Frontend อ่าน `body.error`
// เป็น Code อยู่แล้ว (frontend/src/lib/api.js) — เพิ่ม `message` ภาษาไทยไว้ให้
// Frontend แสดงตรงๆ ได้ตามที่ Requirement รอบนี้ต้องการ
// ⚠️ Shape นี้ต่างจาก API.md § 4 ที่เขียนไว้ ({success,error:{code,message}}) ซึ่ง
// "ไม่ตรงกับโค้ดจริงทั้งระบบมาตั้งแต่ต้น" — ยึดตามโค้ดจริงเพื่อไม่ให้ Frontend เดิมพัง
// (ดู Flag ในรายงานรอบนี้)
function fail(res, code, details = {}) {
  const status = ERROR_STATUS[code] ?? 500;
  return res.status(status).json({
    error: code,
    message: WEB_ERROR_MESSAGES[code] ?? WEB_ERROR_MESSAGES.INTERNAL_ERROR,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  });
}

// ตัวเลขที่ "เป็นตัวเลขจริงและมากกว่า 0" — กัน NaN/Infinity/'abc'/true/null/[]
// (Number('') = 0 และ Number([]) = 0 จึงต้องกัน String ว่าง/Array ก่อนแปลง)
function toPositiveNumber(value) {
  if (typeof value === 'boolean' || value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value) || typeof value === 'object') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

// ตรวจรูปแบบวันที่ 'YYYY-MM-DD' + เป็นวันที่มีอยู่จริง (กัน 2026-02-31 ที่ Regex ผ่าน
// แต่ไม่มีจริง) — เทียบแบบ String ได้เพราะ transactions.date เป็น DATE (ไม่มีเวลา)
// และเป็น "วันตามปฏิทินไทย" อยู่แล้ว (todayInBangkok ผลิตค่ารูปแบบเดียวกัน)
function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Round-trip เช็ค: Date ปัดวันเกินให้เอง (2026-02-31 → 2026-03-03) ถ้าแปลงกลับแล้ว
  // ไม่ตรงกับที่ส่งมา แปลว่าวันนั้นไม่มีอยู่จริง
  return parsed.toISOString().slice(0, 10) === value;
}

// POST /api/v1/transactions — บันทึกรายการซื้อ (DCA) จากฟอร์มเว็บ
async function createTransaction(req, res) {
  const body = req.body ?? {};

  // ── 1) Symbol ต้องอยู่ใน Registry (แหล่งตัดสินเดียวกับ LINE) ────────────────
  const rawSymbol = body.symbol;
  if (typeof rawSymbol !== 'string' || rawSymbol.trim() === '') {
    return fail(res, 'VALIDATION_ERROR', { field: 'symbol' });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  const type = symbolRegistry.lookupType(symbol);
  if (!type) {
    return fail(res, 'SYMBOL_NOT_SUPPORTED', { symbol });
  }

  // ── 2) จำนวนเงินรวม > 0 และเป็นตัวเลขจริง ──────────────────────────────────
  const amountTotal = toPositiveNumber(body.amountTotal);
  if (amountTotal === null) {
    return fail(res, 'VALIDATION_ERROR', { field: 'amountTotal' });
  }

  // ── 3) สกุลเงิน ────────────────────────────────────────────────────────────
  const currency = body.currency ?? 'THB';
  if (currency !== 'THB' && currency !== 'USD') {
    return fail(res, 'VALIDATION_ERROR', { field: 'currency' });
  }
  if (currency === 'USD' && !USD_SUPPORTED_TYPES.includes(type)) {
    return fail(res, 'CURRENCY_NOT_SUPPORTED_FOR_ASSET', { symbol, type });
  }

  // ── 4) วันที่ (ไม่ส่งมา = วันนี้ตาม Asia/Bangkok ผ่าน Default ของ Service) ──
  // เทียบ "วันอนาคต" กับวันนี้ของไทย ไม่ใช่ UTC — Reuse todayInBangkok ของ
  // transaction.service (ค่าเดียวกับที่ Service ใช้เป็น Default วันที่)
  let date;
  if (body.date !== undefined && body.date !== null && body.date !== '') {
    if (!isValidIsoDate(body.date)) {
      return fail(res, 'VALIDATION_ERROR', { field: 'date' });
    }
    if (body.date > transactionService.todayInBangkok()) {
      return fail(res, 'DATE_IN_FUTURE', { date: body.date, today: transactionService.todayInBangkok() });
    }
    date = body.date;
  }

  // ── 5) หมายเหตุ ────────────────────────────────────────────────────────────
  let note;
  if (body.note !== undefined && body.note !== null && body.note !== '') {
    if (typeof body.note !== 'string') {
      return fail(res, 'VALIDATION_ERROR', { field: 'note' });
    }
    if (body.note.length > MAX_NOTE_LENGTH) {
      return fail(res, 'VALIDATION_ERROR', { field: 'note', maxLength: MAX_NOTE_LENGTH });
    }
    // ⚠️ สำคัญ: undoTransaction.service ใช้ "note ที่ขึ้นต้นด้วย UNDO_OF:" เป็น
    // Marker ตัดสินว่าแถวนั้นเป็นรายการย้อน (Reversal) — ถ้าปล่อยให้ผู้ใช้เว็บพิมพ์
    // note แบบนั้นเองได้ จะปลอมเป็น Reversal ได้ (ทำให้ปุ่มยกเลิกล่าสุดตอบ
    // ALREADY_UNDONE ผิดๆ และรายการหายจากสถิติ DCA/Streak ที่กรอง Reversal ออก)
    // LINE ไม่มีช่องโหว่นี้เพราะ Command Parser ไม่รับ note จากผู้ใช้เลย
    if (body.note.trim().toUpperCase().startsWith(`${undoTransactionService.UNDO_MARKER}:`)) {
      return fail(res, 'NOTE_RESERVED_PREFIX', { field: 'note' });
    }
    // เก็บแบบ trim แล้ว — note ที่มีแต่ช่องว่างถือว่า "ไม่มีหมายเหตุ" (เป็น null ใน DB
    // เหมือน Path LINE) ไม่เก็บสตริงช่องว่างลง Ledger
    note = body.note.trim() === '' ? undefined : body.note.trim();
  }

  // ── 6) ราคาต่อหน่วย + Map เข้า 2 เส้นทางเดิมของ transaction.service ────────
  const hasPrice = body.pricePerUnit !== undefined && body.pricePerUnit !== null && body.pricePerUnit !== '';
  const pricePerUnit = hasPrice ? toPositiveNumber(body.pricePerUnit) : null;
  if (hasPrice && pricePerUnit === null) {
    return fail(res, 'VALIDATION_ERROR', { field: 'pricePerUnit' });
  }
  // หุ้นไทย (และสินทรัพย์อื่นที่ไม่มีราคาสด) — บังคับกรอกราคาเอง ไม่งั้นเส้นทาง
  // "จำนวนเงินอย่างเดียว" จะไปจบที่ PRICE_FEED_NOT_IMPLEMENTED ของ Service อยู่ดี
  // (ตอบ 400 ที่นี่ก่อน เพื่อให้ผู้ใช้เว็บรู้ว่า "ต้องกรอกราคา" ตรงๆ ไม่ใช่ 503)
  if (!hasPrice && !LIVE_PRICE_TYPES.includes(type)) {
    return fail(res, 'PRICE_REQUIRED_FOR_ASSET', { symbol, type });
  }

  const params = {
    symbol,
    type,
    // ⚠️ จงใจ "ไม่" ส่ง name แม้จะมีชื่อสวยๆ ใน Registry (lookupName) — เส้นทาง LINE
    // ไม่ส่ง name เช่นกัน ทำให้ processBuyCommand ตั้ง assets.name = symbol เสมอ
    // ถ้าเว็บส่งชื่อเข้าไป สินทรัพย์ตัวเดียวกันจะมีชื่อไม่เหมือนกันขึ้นกับว่าถูกสร้าง
    // ครั้งแรกผ่านช่องทางไหน (เว็บ = "Apple แอปเปิล" / LINE = "AAPL") ซึ่งขัดหลัก
    // "เว็บ = LINE" ของรอบนี้ — ชื่อแสดงผลให้ Frontend Map เอาเองจาก
    // GET /api/v1/assets/symbols (เหตุผลที่มี Endpoint นั้น)
    ...(currency === 'USD' ? { currency: 'USD' } : {}),
    ...(date ? { date } : {}),
    ...(note ? { note } : {}),
    // ช่องทาง 'web' — Field เดียวที่ตั้งใจให้ต่างจากรายการที่บันทึกผ่าน LINE
    source: 'web',
  };

  if (hasPrice) {
    // ── เส้นทาง LINE #2: "ผู้ใช้ระบุราคาเอง" (quantity + pricePerUnit) ───────
    // ฟอร์มเว็บส่ง "จำนวนเงินรวม" มาเสมอ (ไม่ใช่จำนวนหน่วย) จึงต้องแปลงเป็นจำนวน
    // หน่วยก่อนส่งเข้า Service ในรูปแบบเดิมของมัน — ใช้ deriveQuantityFromAmount
    // ของ transaction.service (กฎการปัดเศษตัวเดียวกับที่ Service ใช้ทุกจุด
    // = roundToEight(amount / price)) ไม่คิดสูตรปัดเศษใหม่เอง
    //
    // หมายเหตุ: Service จะคำนวณ amountThb กลับเป็น roundToTwo(quantity × price)
    // ซึ่งอาจต่างจาก amountTotal ที่กรอกมาได้ในระดับเศษสตางค์ ถ้าราคาต่อหน่วยสูงมาก
    // (ความคลาดเคลื่อนของ quantity ≤ 0.5e-8 × ราคา) — สำหรับหุ้นไทย/สินทรัพย์ที่ต้อง
    // กรอกราคาเอง ราคาต่อหน่วยอยู่ระดับหลักพันบาท ผลคูณจึงต่ำกว่า 0.005 เสมอ
    // (ปัดกลับได้ยอดเดิมเป๊ะ) — Response คืน amountTotal ที่ "บันทึกจริง" กลับไปให้
    // Frontend แสดง เพื่อไม่ต้องเดาเองว่าตรงกับที่กรอกไหม
    const quantity = transactionService.deriveQuantityFromAmount(amountTotal, pricePerUnit);
    if (!(quantity > 0)) {
      return fail(res, 'AMOUNT_TOO_SMALL_FOR_PRICE', { amountTotal, pricePerUnit });
    }
    params.quantity = quantity;
    params.pricePerUnit = pricePerUnit;
  } else {
    // ── เส้นทาง LINE #1: "จำนวนเงินรวม" — Service ดึงราคาตลาดเองแล้วหารจำนวนหน่วย
    // (amountThb = ยอดเงินในสกุลของ currency ตาม Semantics เดิมของ Service/DB
    // — USD เก็บเป็น USD ตามจริง ไม่แปลงเป็นบาทตอนบันทึก ตาม Round 10)
    params.amountThb = amountTotal;
  }

  // ── 7) เรียก Service เดิมตัวเดียวกับ LINE ──────────────────────────────────
  try {
    // plan/planExpiresAt จาก req.userRecord (requireAuth Query มาให้แล้ว) — Path
    // เดียวกับที่ webhook.controller ส่งให้ createPending (Freemium Asset Limit
    // ตัดสินใน validateBuy ที่เดียว) ถ้าไม่ส่ง Service จะ Fail-closed เป็น free
    const result = await transactionService.processBuyCommand(req.user.id, params, {
      plan: req.userRecord?.plan,
      planExpiresAt: req.userRecord?.planExpiresAt,
    });

    // สรุป "เดือนนี้" สำหรับการ์ดตอบกลับ — Reuse dcaStats.service ตัวเดียวกับที่
    // Dashboard ใช้ (นิยาม "เดือนนี้/นับยังไง" มีที่เดียว ตัวเลขบนการ์ดหลังบันทึกกับ
    // บนหน้า Dashboard จึงตรงกันเสมอโดยไม่ต้องคำนวณซ้ำ)
    const summary = dcaStatsService.getMonthSummary(
      await transactionRepository.findAllByUser(req.user.id)
    );

    return res.status(201).json({
      transaction: {
        id: result.transactionId,
        symbol: result.symbol,
        units: result.quantity,
        pricePerUnit: result.pricePerUnit,
        // amountTotal = ยอดที่บันทึกจริง (สกุลตาม currency) — ชื่อ Field ฝั่ง Service
        // คือ amountThb ด้วยเหตุผล Backward Compat (ดู migration 012) แต่ Contract
        // ของเว็บใช้ชื่อกลางๆ ที่ตรงความหมายจริงกว่า
        amountTotal: result.amountThb,
        currency: result.currency,
        date: result.date,
        note: result.note,
        priceSource: result.priceSource,
        newAssetCreated: result.newAssetCreated,
      },
      monthSummary: summary,
    });
  } catch (err) {
    if (err instanceof transactionService.TransactionServiceError) {
      return fail(res, err.code, err.details ?? {});
    }

    console.error(`[transactions] createTransaction failed: ${err.message}`);
    return fail(res, 'INTERNAL_ERROR');
  }
}

// POST /api/v1/transactions/undo-last — Expose คำสั่ง "ยกเลิกล่าสุด" ของ LINE
//
// Reuse undoTransaction.service ตัวเดิมทั้งหมด (Reversal Pattern / Immutable
// Ledger ตาม DATABASE.md § 8) — ไม่มี DELETE by id เด็ดขาด และยกเลิกได้เฉพาะ
// "รายการล่าสุดของ User คนนั้น" เหมือน LINE ทุกประการ (Service หา latest จาก
// userId เอง เว็บไม่ได้ส่ง id ใดๆ เข้าไปเลือกเอง = ไม่มีทาง Undo รายการของคนอื่น)
async function undoLast(req, res) {
  try {
    const result = await undoTransactionService.undoLastTransaction(req.user.id, {
      source: 'web',
    });

    return res.status(200).json({
      undone: {
        transactionId: result.originalTransactionId,
        type: result.originalType,
        symbol: result.symbol,
        units: result.quantity,
        pricePerUnit: result.pricePerUnit,
        amountTotal: result.amountThb,
      },
      reversal: {
        transactionId: result.reversalTransactionId,
        type: result.reversalType,
      },
      message: `ยกเลิกรายการ${result.originalType === 'buy' ? 'ซื้อ' : 'ขาย'} ${result.symbol} เรียบร้อยแล้ว`,
    });
  } catch (err) {
    if (err instanceof undoTransactionService.UndoTransactionError) {
      return fail(res, err.code, err.details ?? {});
    }

    console.error(`[transactions] undoLast failed: ${err.message}`);
    return fail(res, 'INTERNAL_ERROR');
  }
}

module.exports = { createTransaction, undoLast };
