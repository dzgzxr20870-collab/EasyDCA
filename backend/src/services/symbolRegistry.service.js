// Symbol → asset type mapping แบบ Hardcode สำหรับสินทรัพย์ยอดนิยม
// type อ้างอิงจาก DATABASE.md § assets — CHECK (type IN
// ('crypto', 'stock_th', 'stock_us', 'etf', 'fund'))
//
// นี่เป็นทางเลือกชั่วคราวก่อนจะมี Market Data Service จริง — ครอบคลุมเฉพาะ
// สินทรัพย์ที่พบบ่อยเท่านั้น ถ้าไม่รู้จัก Symbol จะคืน null (ไม่เดา type มั่ว)
// เพื่อไม่ให้บันทึกสินทรัพย์ที่จำแนกประเภทผิดลง DB
const SYMBOL_TYPES = {
  // ── Crypto ──────────────────────────────────────────────────────────
  BTC: 'crypto',
  ETH: 'crypto',
  USDT: 'crypto',
  BNB: 'crypto',
  XRP: 'crypto',
  SOL: 'crypto',
  DOGE: 'crypto',
  ADA: 'crypto',

  // ── หุ้นไทย (SET) ───────────────────────────────────────────────────
  PTT: 'stock_th',
  CPALL: 'stock_th',
  AOT: 'stock_th',
  ADVANC: 'stock_th',
  SCB: 'stock_th',
  KBANK: 'stock_th',
  BBL: 'stock_th',
  SET: 'stock_th',
  PTTEP: 'stock_th',
  SCC: 'stock_th',
  GULF: 'stock_th',
  INTUCH: 'stock_th',
  TRUE: 'stock_th',
  DELTA: 'stock_th',
  OR: 'stock_th',
  GPSC: 'stock_th',
  BDMS: 'stock_th',
  CPN: 'stock_th',
  MINT: 'stock_th',
  KTB: 'stock_th',
  TTB: 'stock_th',
  CPF: 'stock_th',
  IVL: 'stock_th',
  EA: 'stock_th',

  // ── หุ้นสหรัฐ ─────────────────────────────────────────────────────────
  AAPL: 'stock_us',
  GOOGL: 'stock_us',
  MSFT: 'stock_us',
  TSLA: 'stock_us',
  AMZN: 'stock_us',
  NVDA: 'stock_us',
  META: 'stock_us',
};

// คืน type ของ Symbol ถ้ารู้จัก หรือ null ถ้าไม่รู้จัก (ไม่เดามั่ว)
// รับ Symbol แบบ case-insensitive เผื่อ Caller ยังไม่ได้ Normalize
function lookupType(symbol) {
  if (typeof symbol !== 'string') return null;
  return SYMBOL_TYPES[symbol.trim().toUpperCase()] ?? null;
}

module.exports = {
  lookupType,
  SYMBOL_TYPES,
};
