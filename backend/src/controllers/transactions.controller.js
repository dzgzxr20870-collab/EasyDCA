const transactionService = require('../services/transaction.service');
const undoTransactionService = require('../services/undoTransaction.service');
const symbolRegistry = require('../services/symbolRegistry.service');
const dcaStatsService = require('../services/dcaStats.service');
const transactionRepository = require('../repositories/transaction.repository');
const entitlementService = require('../services/entitlement.service');
const storageService = require('../services/storage.service');

// ═══════════════════════════════════════════════════════════════════════════
// transactions.controller — บันทึก DCA (ซื้อ) และการขาย จากเว็บ (S8 Round 1a)
// ═══════════════════════════════════════════════════════════════════════════
// หลักการเดียวของไฟล์นี้: "ไม่มีตรรกะสร้างธุรกรรมที่นี่เลย" — หน้าที่ทั้งหมดคือ
// แปลง (Map) ฟอร์มเว็บ → params รูปแบบเดิมของ transaction.service ตัวเดียวกับที่
// webhook.controller (LINE) ใช้ แล้วเรียก processBuyCommand / processSellCommand ตรงๆ
//
// ทุกอย่างที่เป็น "เงิน" (ดึงราคาตลาด / คำนวณจำนวนหน่วย / Multi-Currency / FX /
// Freemium Asset Limit / ตรวจยอดคงเหลือก่อนขาย) เกิดขึ้นใน transaction.service ที่เดียว
// เหมือนเดิมทุกประการ ไฟล์นี้ทำแค่ Validate Input + Map + แปลง Error เป็นข้อความไทย
//
// ⚠️ ข้อแตกต่างเดียวที่ตั้งใจให้ต่างจาก LINE: เว็บบันทึก "ทันที" (ไม่มี Preview →
// Confirm 2 ขั้นแบบ LINE) เพราะฟอร์มบนเว็บเห็นข้อมูลครบก่อนกดปุ่มอยู่แล้ว จึงเรียก
// processBuyCommand/processSellCommand ตรง (เส้นทางเดียวกับที่
// pendingTransaction.confirmPending เรียกตอนผู้ใช้กดยืนยันใน LINE) — ไม่ใช่การ Skip
// Validation ใดๆ เพราะทั้งสองฟังก์ชันเรียก validateBuy/validateSell เต็มรูปแบบใน
// ตัวเองอยู่แล้ว (รวมถึงการตรวจ "ขายเกินยอดคงเหลือ" ที่คำนวณจาก Ledger จริง)
//
// ── ฝั่งขาย (side='sell') ────────────────────────────────────────────────────
// รับ 2 รูปแบบเท่าที่ transaction.service รองรับอยู่แล้ว (ตรงกับคำสั่งพิมพ์ใน LINE
// ทุกประการ ไม่มีเส้นทางคำนวณใหม่):
//   1) quantity + pricePerUnit  = "ขาย PTT 50 หุ้น ราคา 34"  (ใช้ได้ทุกประเภทสินทรัพย์
//      รวมหุ้นไทยที่ไม่มี Price Feed — ผู้ใช้รู้ราคาที่ขายได้จริงอยู่แล้ว)
//   2) sellAll: true            = "ขาย BTC ทั้งหมด"          (Service ดึงยอดคงเหลือจาก
//      Ledger + ราคาตลาด ณ ตอนนี้ให้เอง จึงไม่มีเศษทศนิยมค้างจากการที่ Frontend
//      คำนวณจำนวนหน่วยเอง — Frontend "ห้าม" ส่งจำนวนที่คิดเองมาแทน)
// จงใจไม่รับ "ขายด้วยจำนวนเงิน" (amountTotal) บนเว็บ แม้ Service จะรองรับ — เพราะ
// เส้นทางนั้นต้องหาร quantity จากราคาตลาด ทำให้ผู้ใช้ที่ "ตั้งใจขายหมด" เหลือเศษ
// ค้างในพอร์ต และใช้กับหุ้นไทยไม่ได้เลย (ไม่มี Price Feed → 503)

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
  // ── ฝั่งขาย ────────────────────────────────────────────────────────────────
  // 3 Code แรกโยนมาจาก transaction.service.validateSell (มีมาตั้งแต่เส้นทาง LINE
  // แล้ว) แต่ไม่เคยถูก Map ที่ชั้นนี้เลยเพราะเว็บยังไม่มีปุ่มขาย — ถ้าไม่เติม
  // จะตกไป INTERNAL_ERROR 500 ทั้งที่เป็น Business Rule ที่ผู้ใช้แก้เองได้ (400)
  ASSET_NOT_FOUND: 'คุณยังไม่มีสินทรัพย์นี้ในพอร์ต จึงบันทึกการขายไม่ได้',
  NOTHING_TO_SELL: 'สินทรัพย์นี้ขายออกไปหมดแล้ว ไม่มียอดคงเหลือให้ขาย',
  INSUFFICIENT_QUANTITY: 'ขายเกินจำนวนที่ถืออยู่จริง กรุณาตรวจสอบยอดคงเหลือแล้วลองใหม่',
  SELL_PRICE_REQUIRED: 'กรุณากรอก "ราคาที่ขายได้ต่อหน่วย" ด้วย (หรือกดปุ่ม "ขายทั้งหมด" เพื่อใช้ราคาตลาด)',
  ASSET_LIMIT_REACHED:
    'คุณใช้ครบ 2 สินทรัพย์ตามแพ็กเกจ Free แล้ว หากต้องการเพิ่มสินทรัพย์ใหม่ กรุณาอัพเกรดเป็น Premium',
  // เกิดเมื่อสองคำสั่งซื้อ Symbol ใหม่เดียวกันชนกันพอดี (กดปุ่มซ้ำ/สองแท็บ) —
  // Pattern เดียวกับ flexMessage.util.js (ข้อความไทยเดียวกัน — คนละ Channel
  // แต่ผู้ใช้ควรเห็นคำอธิบายตรงกัน)
  ASSET_ALREADY_EXISTS: 'สินทรัพย์นี้เพิ่งถูกเพิ่มเข้าพอร์ตไปแล้ว (อาจกดซ้ำ) กรุณาตรวจสอบพอร์ตของคุณอีกครั้ง',
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
  // แนบสลิปหลักฐาน (Premium) — เก็บรูปประกอบรายการเฉยๆ ไม่มี AI อ่าน (ต่างจาก OCR ทาง LINE)
  TRANSACTION_SLIP_PREMIUM_REQUIRED:
    'การแนบสลิปเป็นหลักฐานเป็นฟีเจอร์สำหรับสมาชิก Premium — อัพเกรดเพื่อแนบรูปสลิปประกอบรายการ',
  TRANSACTION_NOT_FOUND: 'ไม่พบรายการที่ต้องการแนบสลิป (อาจถูกลบไปแล้ว)',
  // กันแนบทับหลักฐานเดิม (หลักฐานภาษีหายเงียบ = ร้ายแรงกว่าแนบไม่ได้) — โดยเฉพาะรายการ
  // ที่มาจาก LINE OCR ซึ่งมีสลิปแนบอยู่แล้ว
  SLIP_ALREADY_ATTACHED: 'รายการนี้มีสลิปแนบอยู่แล้ว ไม่สามารถแนบทับได้ (กันหลักฐานเดิมหาย)',
  // ไม่แนบให้ "รายการย้อน (Reversal)" ที่ระบบสร้างตอนกดยกเลิก — ไม่ใช่การซื้อ/ขายจริง
  CANNOT_ATTACH_TO_REVERSAL: 'แนบสลิปให้รายการย้อน (ยกเลิก) ไม่ได้ — แนบได้เฉพาะรายการซื้อ/ขายจริง',
  EMPTY_BODY: 'ไม่พบไฟล์รูป กรุณาเลือกรูปสลิปใหม่',
  INVALID_SLIP_CONTENT_TYPE: 'ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น',
  SLIP_TOO_LARGE: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)',
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
  // ฝั่งขาย — ทั้ง 4 ตัวเป็น Business Rule ที่ผู้ใช้แก้เองได้ (เลือกสินทรัพย์อื่น /
  // ลดจำนวน / กรอกราคา) จึงเป็น 400 ไม่ใช่ 404/500 ตาม API.md § 5-6
  ASSET_NOT_FOUND: 400,
  NOTHING_TO_SELL: 400,
  INSUFFICIENT_QUANTITY: 400,
  SELL_PRICE_REQUIRED: 400,
  NO_TRANSACTION_TO_UNDO: 400,
  ALREADY_UNDONE: 400,
  CANNOT_UNDO_QUANTITY_MISMATCH: 400,
  ASSET_LIMIT_REACHED: 403,
  // Symbol เดียวกันถูกสร้างไปแล้ว = ขัดสถานะปัจจุบัน (ไม่ใช่สิทธิ์ไม่พอ/Input ผิด)
  // → 409 (Pattern เดียวกับ SLIP_ALREADY_ATTACHED/CANNOT_ATTACH_TO_REVERSAL ด้านล่าง)
  ASSET_ALREADY_EXISTS: 409,
  PRICE_FEED_NOT_IMPLEMENTED: 503,
  MARKET_PRICE_UNAVAILABLE: 503,
  GOLD_PRICE_UNAVAILABLE: 503,
  SEC_NOT_CONFIGURED: 503,
  MUTUAL_FUND_NAV_UNAVAILABLE: 503,
  // แนบสลิปหลักฐาน (Premium) — Status ตรงกับ payment.controller (415 ชนิดไฟล์ผิด, 413 ใหญ่เกิน)
  TRANSACTION_SLIP_PREMIUM_REQUIRED: 403,
  TRANSACTION_NOT_FOUND: 404,
  SLIP_ALREADY_ATTACHED: 409,
  CANNOT_ATTACH_TO_REVERSAL: 409,
  EMPTY_BODY: 400,
  INVALID_SLIP_CONTENT_TYPE: 415,
  SLIP_TOO_LARGE: 413,
};

// UUID v4-ish รูปแบบ (Postgres uuid column) — Validate ก่อน Query กัน id ผิดรูปทำ Postgres
// throw 22P02 แล้วตกไป 500 (ควรเป็น 404 "ไม่พบรายการ" ตามความหมายจริง) Pattern เดียวกับ
// findByIdForUser ที่ตอบ null ทั้งกรณีไม่มีจริง/ไม่ใช่ของเรา
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// POST /api/v1/transactions — บันทึกรายการซื้อ (DCA) หรือขาย จากฟอร์มเว็บ
async function createTransaction(req, res) {
  const body = req.body ?? {};

  // ── 0) ทิศทางรายการ ────────────────────────────────────────────────────────
  // ไม่ส่ง side มา = 'buy' — Payload เดิมทุกตัว (ฟอร์มเว็บก่อนรอบนี้) จึงเดิน
  // เส้นทางเดิมเป๊ะโดยไม่ต้องแก้อะไรฝั่ง Client (Additive ล้วน)
  const side = body.side ?? 'buy';
  if (side !== 'buy' && side !== 'sell') {
    return fail(res, 'VALIDATION_ERROR', { field: 'side' });
  }
  const isSell = side === 'sell';
  // "ขายทั้งหมด" — Service ดึงยอดคงเหลือ + ราคาตลาดเอง (ไม่รับ quantity/price/สกุล
  // จาก Client เลยในเคสนี้) รับเฉพาะ true แท้ๆ ไม่รับ Truthy อื่น ('false'/1) กัน
  // Client ส่งค่าผิดชนิดแล้วกลายเป็นขายยกพอร์ตโดยไม่ตั้งใจ
  const sellAll = isSell && body.sellAll === true;

  // ── 1) Symbol ──────────────────────────────────────────────────────────────
  const rawSymbol = body.symbol;
  if (typeof rawSymbol !== 'string' || rawSymbol.trim() === '') {
    return fail(res, 'VALIDATION_ERROR', { field: 'symbol' });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  const type = symbolRegistry.lookupType(symbol);
  // ซื้อ: ต้องอยู่ใน Registry (แหล่งตัดสินเดียวกับ LINE) เพราะอาจต้องสร้าง Asset ใหม่
  // ซึ่ง validateBuy บังคับให้มี type เสมอ
  // ขาย: "ไม่" บังคับ — สินทรัพย์ที่ผู้ใช้ถืออยู่จริงอาจไม่อยู่ใน Registry ได้ (Dynamic
  //   Symbol / Manual Quantity Fallback Round 10-B เช่น EOSE) ถ้ากั้นด้วย Registry
  //   ผู้ใช้จะ "ซื้อผ่าน LINE ได้แต่ขายบนเว็บไม่ได้" — ตัวตัดสินที่ถูกต้องคือ Ledger
  //   (validateSell → findByUserAndSymbol → ASSET_NOT_FOUND) ไม่ใช่ Registry
  //   เส้นทาง LINE ก็ไม่เติม type ให้คำสั่งขายเช่นกัน (webhook.controller: เติมเฉพาะ BUY)
  if (!isSell && !type) {
    return fail(res, 'SYMBOL_NOT_SUPPORTED', { symbol });
  }

  // ── 2) จำนวน — คนละความหมายตามทิศทาง ───────────────────────────────────────
  //   ซื้อ: amountTotal = "จำนวนเงินรวม" (Service หารเป็นหน่วยให้)
  //   ขาย: quantity = "จำนวนหน่วยที่ขาย" (ไม่ใช่เงิน) — ยกเว้น sellAll ที่ไม่ต้องส่ง
  let amountTotal = null;
  let sellQuantity = null;
  if (isSell) {
    if (!sellAll) {
      sellQuantity = toPositiveNumber(body.quantity);
      if (sellQuantity === null) {
        return fail(res, 'VALIDATION_ERROR', { field: 'quantity' });
      }
    }
  } else {
    amountTotal = toPositiveNumber(body.amountTotal);
    if (amountTotal === null) {
      return fail(res, 'VALIDATION_ERROR', { field: 'amountTotal' });
    }
  }

  // ── 3) สกุลเงิน ────────────────────────────────────────────────────────────
  const currency = body.currency ?? 'THB';
  if (currency !== 'THB' && currency !== 'USD') {
    return fail(res, 'VALIDATION_ERROR', { field: 'currency' });
  }
  // เช็คกับ type ได้เฉพาะตอนรู้ type (ขาย Dynamic Symbol จะไม่รู้ — ดูเหตุผลข้อ 1)
  // ข้าม sellAll: ค่า currency ที่ส่งมาถูก "ละเว้น" อยู่แล้วในเคสนั้น (Service อนุมาน
  // จากประวัติจริง) — ปฏิเสธ Request เพราะ Field ที่เราไม่ได้ใช้เลยคือ Error ที่งง
  if (currency === 'USD' && !sellAll && type && !USD_SUPPORTED_TYPES.includes(type)) {
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

  // ── 6) ราคาต่อหน่วย + Map เข้าเส้นทางเดิมของ transaction.service ───────────
  const hasPrice = body.pricePerUnit !== undefined && body.pricePerUnit !== null && body.pricePerUnit !== '';
  const pricePerUnit = hasPrice ? toPositiveNumber(body.pricePerUnit) : null;
  if (hasPrice && pricePerUnit === null) {
    return fail(res, 'VALIDATION_ERROR', { field: 'pricePerUnit' });
  }
  if (isSell) {
    // ขายแบบระบุจำนวนหน่วย ต้องมีราคาที่ขายได้เสมอ — Service รองรับ "จำนวนหน่วย
    // อย่างเดียว" ไม่ได้ (resolveQuantityAndPrice จะโยน VALIDATION_ERROR ที่ความหมาย
    // ไม่ตรงกับปัญหาจริง) ตอบ Code เฉพาะที่นี่เพื่อให้ข้อความบอกทางออกได้ตรง
    if (!sellAll && !hasPrice) {
      return fail(res, 'SELL_PRICE_REQUIRED', { symbol });
    }
  } else if (!hasPrice && !LIVE_PRICE_TYPES.includes(type)) {
    // หุ้นไทย (และสินทรัพย์อื่นที่ไม่มีราคาสด) — บังคับกรอกราคาเอง ไม่งั้นเส้นทาง
    // "จำนวนเงินอย่างเดียว" จะไปจบที่ PRICE_FEED_NOT_IMPLEMENTED ของ Service อยู่ดี
    // (ตอบ 400 ที่นี่ก่อน เพื่อให้ผู้ใช้เว็บรู้ว่า "ต้องกรอกราคา" ตรงๆ ไม่ใช่ 503)
    return fail(res, 'PRICE_REQUIRED_FOR_ASSET', { symbol, type });
  }

  const params = {
    symbol,
    // type ใช้เฉพาะตอนซื้อ (validateBuy ต้องใช้สร้าง Asset ใหม่) — คำสั่งขายไม่ส่ง
    // เหมือนเส้นทาง LINE เป๊ะ (validateSell หา Asset จาก symbol ที่ผู้ใช้ถืออยู่จริง)
    ...(isSell ? {} : { type }),
    // ⚠️ จงใจ "ไม่" ส่ง name แม้จะมีชื่อสวยๆ ใน Registry (lookupName) — เส้นทาง LINE
    // ไม่ส่ง name เช่นกัน ทำให้ processBuyCommand ตั้ง assets.name = symbol เสมอ
    // ถ้าเว็บส่งชื่อเข้าไป สินทรัพย์ตัวเดียวกันจะมีชื่อไม่เหมือนกันขึ้นกับว่าถูกสร้าง
    // ครั้งแรกผ่านช่องทางไหน (เว็บ = "Apple แอปเปิล" / LINE = "AAPL") ซึ่งขัดหลัก
    // "เว็บ = LINE" ของรอบนี้ — ชื่อแสดงผลให้ Frontend Map เอาเองจาก
    // GET /api/v1/assets/symbols (เหตุผลที่มี Endpoint นั้น)
    // "ขายทั้งหมด" ไม่ส่งสกุลเงินไปเลย — validateSell อนุมานสกุลจากประวัติธุรกรรมจริง
    // ของสินทรัพย์นั้นเอง (deriveAssetCurrency) ซึ่งแม่นกว่าค่าที่ Client ส่งมา
    ...(currency === 'USD' && !sellAll ? { currency: 'USD' } : {}),
    ...(date ? { date } : {}),
    ...(note ? { note } : {}),
    // ช่องทาง 'web' — Field เดียวที่ตั้งใจให้ต่างจากรายการที่บันทึกผ่าน LINE
    source: 'web',
  };

  if (isSell) {
    if (sellAll) {
      // Service หา heldQuantity จาก Ledger + ราคาตลาด ณ ตอนนี้ให้เอง (เส้นทางเดียว
      // กับคำสั่ง "ขาย BTC ทั้งหมด" ใน LINE) — Controller ไม่คำนวณจำนวนใดๆ ทั้งสิ้น
      params.sellAll = true;
    } else {
      // ผู้ใช้กรอก "จำนวนหน่วย" มาตรงๆ อยู่แล้ว (ต่างจากซื้อที่กรอกเป็นเงิน) จึงส่ง
      // เข้า Service ในรูปแบบเดิมของมันได้เลย ไม่ต้องแปลงหน่วย/หารอะไรที่ชั้นนี้
      params.quantity = sellQuantity;
      params.pricePerUnit = pricePerUnit;
    }
  } else if (hasPrice) {
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
    //
    // ขายไม่ส่ง options เลย (เหมือน pendingTransaction.service เรียก processSellCommand)
    // — Freemium Asset Limit เป็นเรื่องของ "การสร้างสินทรัพย์ใหม่" เท่านั้น การขาย
    // ไม่สร้าง Asset จึงไม่มีอะไรให้ Gate (validateSell เองก็ไม่รับ options)
    const result = isSell
      ? await transactionService.processSellCommand(req.user.id, params)
      : await transactionService.processBuyCommand(req.user.id, params, {
          plan: req.userRecord?.plan,
          planExpiresAt: req.userRecord?.planExpiresAt,
        });

    // สรุป "เดือนนี้" สำหรับการ์ดตอบกลับ — Reuse dcaStats.service ตัวเดียวกับที่
    // Dashboard ใช้ (นิยาม "เดือนนี้/นับยังไง" มีที่เดียว ตัวเลขบนการ์ดหลังบันทึกกับ
    // บนหน้า Dashboard จึงตรงกันเสมอโดยไม่ต้องคำนวณซ้ำ)
    // หมายเหตุ: getMonthSummary นับเฉพาะ "รายการซื้อ" ตามนิยาม DCA เดิม — การขาย
    // จึงไม่ทำให้ตัวเลขนี้ขยับ (ตั้งใจ ไม่ใช่บั๊ก) แต่ยังคืนมาให้ Frontend ใช้ค่าเดียว
    // กับที่ Dashboard แสดง
    const summary = dcaStatsService.getMonthSummary(
      await transactionRepository.findAllByUser(req.user.id)
    );

    return res.status(201).json({
      transaction: {
        id: result.transactionId,
        // ทิศทางที่บันทึกจริง — Frontend ใช้เลือกข้อความ/สีบนการ์ดยืนยัน ไม่ต้องจำเอง
        // ว่ากดปุ่มไหนมา (เพิ่มใหม่รอบนี้ — Payload เดิมของฝั่งซื้อได้ side:'buy' ติดมา
        // ด้วย ซึ่งเป็น Field เพิ่ม ไม่กระทบ Consumer เดิมที่ไม่ได้อ่าน)
        side,
        symbol: result.symbol,
        units: result.quantity,
        pricePerUnit: result.pricePerUnit,
        // amountTotal = ยอดที่บันทึกจริง (สกุลตาม currency) — ชื่อ Field ฝั่ง Service
        // คือ amountThb ด้วยเหตุผล Backward Compat (ดู migration 012) แต่ Contract
        // ของเว็บใช้ชื่อกลางๆ ที่ตรงความหมายจริงกว่า
        // ฝั่งขาย = "เงินที่ได้รับจากการขาย" (quantity × ราคาที่ขายได้)
        amountTotal: result.amountThb,
        currency: result.currency,
        date: result.date,
        note: result.note,
        priceSource: result.priceSource,
        // ซื้อ: บอกว่าเพิ่งสร้างสินทรัพย์ใหม่ไหม / ขาย: ยอดคงเหลือหลังขาย (Service
        // คำนวณให้แล้วใน processSellCommand — Frontend ห้ามลบเอง)
        ...(isSell
          ? { remainingQuantity: result.remainingQuantity }
          : { newAssetCreated: result.newAssetCreated }),
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

// POST /api/v1/transactions/:id/slip — แนบรูปสลิป "เป็นหลักฐาน" ให้รายการที่บันทึกแล้ว
// (Premium เท่านั้น) — เก็บรูปเฉยๆ ไม่มี AI อ่าน/ไม่ Auto-fill ใดๆ (คนละเรื่องกับ
// AI Slip OCR ทาง LINE ที่ตีความตัวเลขจากรูป) ผู้ใช้กรอกเงิน/สินทรัพย์/วันที่เองครบแล้ว
//
// Body เป็น Binary รูปภาพดิบ (express.raw ที่ Route — req.body เป็น Buffer, Content-Type
// ของ Request = ชนิดรูปจริง) มิเรอร์ payment.controller.uploadSlip ทุกขั้น โดย Reuse
// Storage/Repository/Entitlement เดิมทั้งหมด (ไม่มี Logic คู่ขนานใหม่):
//   1) Premium Gate — entitlement.isPremiumActive (Single Source เดียวกับ Export Gate)
//      เป็น Security Boundary จริงฝั่ง Backend (Frontend ซ่อนช่องแค่ UX ไม่ใช่ Gate)
//   2) Ownership — findByIdForUser กรอง user_id ในตัว (กันเดา id แนบเข้าธุรกรรมคนอื่น)
//   3) Upload (Validate MIME/ขนาดในตัว) → attachSlipImagePath (คอลัมน์ slip_image_path
//      เดิมจาก migration 021 — Reuse ได้เพราะทั้ง OCR และหลักฐานเว็บคือ "รูปสลิปของ
//      ธุรกรรมนี้" เหมือนกัน) — บังคับจริงด้วยโค้ด: ถ้ารายการมีสลิปอยู่แล้ว (รวมรายการ
//      จาก LINE OCR) จะ Reject SLIP_ALREADY_ATTACHED ไม่ทับเงียบ (กันหลักฐานภาษีหาย)
//
// PDPA: ไฟล์ถูกตั้งชื่อ "{userId}-{token}" เหมือน OCR → userErasure.eraseUserData ที่
// เรียก deleteAllTransactionSlipsForUser(userId) กวาดลบให้อยู่แล้วโดยอัตโนมัติ (ไม่ต้องแก้)
async function uploadTransactionSlip(req, res) {
  // 1) Premium Gate ก่อนแตะ Body — ไม่ประมวลผลไฟล์ให้ผู้ใช้ที่ไม่มีสิทธิ์เลย
  if (!entitlementService.isPremiumActive(req.userRecord)) {
    return fail(res, 'TRANSACTION_SLIP_PREMIUM_REQUIRED');
  }

  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return fail(res, 'EMPTY_BODY');
  }
  const contentType = req.get('content-type');

  // 2) Validate รูปแบบ id ก่อนแตะ DB (P2-4) — id ที่ไม่ใช่ UUID จะทำให้ Postgres throw
  // 22P02 ตกไป 500; ตอบ 404 ที่นี่แทน (ความหมายจริง = "ไม่พบรายการ")
  if (!UUID_RE.test(String(req.params.id))) {
    return fail(res, 'TRANSACTION_NOT_FOUND');
  }

  // uploadedPath: เก็บ path ที่อัปโหลดสำเร็จไว้ เผื่อขั้น attach ล้มเหลว จะได้ลบทิ้ง
  // (Compensating Delete — กัน Orphan File) — ยังเป็น null ระหว่างที่ยังไม่อัปโหลด
  let uploadedPath = null;
  try {
    // 3) Ownership — คืน null ทั้งกรณี "ไม่มีจริง" และ "ไม่ใช่ของเรา" (ไม่บอกใบ้ว่า id มีอยู่)
    const tx = await transactionRepository.findByIdForUser(req.params.id, req.user.id);
    if (!tx) {
      return fail(res, 'TRANSACTION_NOT_FOUND');
    }

    // 4) ไม่แนบให้ "รายการย้อน (Reversal)" (P2-5) — แถวที่ระบบสร้างตอน Undo (note ขึ้นต้น
    // ด้วย UNDO_OF:) ไม่ใช่การซื้อ/ขายจริงของผู้ใช้ จึงไม่ควรมีสลิปหลักฐานภาษี Reuse
    // Marker เดียวกับ undoTransaction.service (Single Source ไม่ Hardcode สตริงซ้ำ)
    if (
      typeof tx.note === 'string' &&
      tx.note.trim().toUpperCase().startsWith(`${undoTransactionService.UNDO_MARKER}:`)
    ) {
      return fail(res, 'CANNOT_ATTACH_TO_REVERSAL');
    }

    // 5) กันแนบทับหลักฐานเดิม (P1-2) — ถ้ารายการมี slip_image_path อยู่แล้ว (เช่นมาจาก
    // LINE OCR) Reject ทันที ไม่ทับ/ไม่อัปโหลดซ้ำ (หลักฐานภาษีหายเงียบ = ร้ายแรงกว่า
    // แนบไม่ได้) — ผู้ใช้ที่ต้องเปลี่ยนรูปจริงๆ ต้องผ่านช่องทางอื่นที่ตั้งใจ ไม่ใช่ทับเงียบ
    if (tx.slipImagePath) {
      return fail(res, 'SLIP_ALREADY_ATTACHED');
    }

    // 6) Upload (throw StorageServiceError ถ้าชนิด/ขนาดไม่ผ่าน) → แนบ path เข้าธุรกรรม
    const { path } = await storageService.uploadTransactionSlip(req.user.id, buffer, contentType);
    uploadedPath = path;
    await transactionRepository.attachSlipImagePath(tx.id, path);

    return res.status(200).json({ status: 'slip_attached' });
  } catch (err) {
    // StorageServiceError (INVALID_SLIP_CONTENT_TYPE / SLIP_TOO_LARGE) → Map ผ่าน code เดิม
    // (เกิดตอน uploadTransactionSlip ซึ่งยังไม่ตั้ง uploadedPath — ไม่มีไฟล์ค้าง)
    if (err && err.name === 'StorageServiceError') {
      return fail(res, err.code);
    }

    // P1-3: ถ้า attach ล้มเหลว "หลัง" upload สำเร็จ (uploadedPath ถูกตั้งแล้ว) → ไฟล์กลาย
    // เป็น Orphan ถ้าไม่ลบทิ้ง ทำ Compensating Delete แบบ Best-effort — ถ้าลบไม่สำเร็จด้วย
    // ต้อง Log path ให้ตามเก็บได้ (ห้ามหายเงียบ)
    if (uploadedPath) {
      try {
        await storageService.deleteTransactionSlip(uploadedPath);
      } catch (cleanupErr) {
        console.error(
          `[transactions] ORPHAN transaction slip — attach failed and cleanup failed too: path=${uploadedPath} cleanupError=${cleanupErr.message}`
        );
      }
    }

    console.error(`[transactions] uploadTransactionSlip failed: ${err.message}`);
    return fail(res, 'INTERNAL_ERROR');
  }
}

module.exports = { createTransaction, undoLast, uploadTransactionSlip };
