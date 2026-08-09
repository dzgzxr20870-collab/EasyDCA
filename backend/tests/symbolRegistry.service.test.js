const {
  lookupType,
  looksLikeThaiFundSymbol,
  SYMBOL_TYPES,
} = require('../src/services/symbolRegistry.service');

describe('symbolRegistry.lookupType — Symbol ที่รู้จัก', () => {
  test('Crypto → คืน type crypto', () => {
    expect(lookupType('BTC')).toBe('crypto');
    expect(lookupType('ETH')).toBe('crypto');
    expect(lookupType('USDT')).toBe('crypto');
  });

  test('หุ้นไทย → คืน type stock_th', () => {
    expect(lookupType('PTT')).toBe('stock_th');
    expect(lookupType('CPALL')).toBe('stock_th');
    expect(lookupType('KBANK')).toBe('stock_th');
  });

  test('หุ้นสหรัฐ → คืน type stock_us', () => {
    expect(lookupType('AAPL')).toBe('stock_us');
    expect(lookupType('TSLA')).toBe('stock_us');
    expect(lookupType('NVDA')).toBe('stock_us');
  });

  // Beta Prep — ขยาย List หลังพบว่า AMD หายไปจาก List เดิม (บั๊กที่รายงานมา)
  test('หุ้นสหรัฐที่เพิ่มใหม่ (Beta Prep) → คืน type stock_us ครบทุกหมวด', () => {
    // AMD คือ Symbol ที่รายงานว่าหายไปจริง — ต้องยืนยันว่าเจอแล้ว
    expect(lookupType('AMD')).toBe('stock_us');
    expect(lookupType('GOOG')).toBe('stock_us'); // Alphabet Class C (ต่างจาก GOOGL)
    // เซมิคอนดักเตอร์ + ADR ต่างชาติที่เทรดเป็น USD
    expect(lookupType('INTC')).toBe('stock_us');
    expect(lookupType('TSM')).toBe('stock_us');
    expect(lookupType('ASML')).toBe('stock_us');
    // Symbol ที่มีจุด (Share Class) — ต้องยัง Lookup เจอปกติ
    expect(lookupType('BRK.B')).toBe('stock_us');
    // ETF ยอดนิยม — จงใจ Classify เป็น stock_us (ไม่ใช่ 'etf') เพราะระบบยังไม่มี
    // Price Feed Route สำหรับ type 'etf' เลย (ดู Comment ในไฟล์จริง)
    expect(lookupType('SPY')).toBe('stock_us');
    expect(lookupType('QQQ')).toBe('stock_us');
  });

  // Bug Fix (2026-08-09) — สลิปซื้อจริงบน Production ผ่านโบรกเกอร์ Dime! ที่หลุดไป
  // โดน Error กองทุนรวมผิดฝาผิดตัว เพราะ Symbol ไม่อยู่ใน Whitelist ตอนนั้น
  test('SPCX (Bug Fix 2026-08-09) → คืน type stock_us', () => {
    expect(lookupType('SPCX')).toBe('stock_us');
    expect(lookupType('spcx')).toBe('stock_us'); // case-insensitive
  });

  test('ทองคำ → คืน type gold_bar / gold_ornament (Phase 3 Round 7)', () => {
    expect(lookupType('GOLD')).toBe('gold_bar');
    expect(lookupType('GOLDORN')).toBe('gold_ornament');
  });

  test('รับ Symbol แบบ case-insensitive และตัดช่องว่างหัวท้าย', () => {
    expect(lookupType('btc')).toBe('crypto');
    expect(lookupType('  ptt  ')).toBe('stock_th');
    expect(lookupType('AaPl')).toBe('stock_us');
    expect(lookupType('gold')).toBe('gold_bar');
    expect(lookupType('  goldorn  ')).toBe('gold_ornament');
  });
});

describe('symbolRegistry.lookupType — Symbol ที่ไม่รู้จัก', () => {
  test('Symbol ที่ไม่มีใน Registry → คืน null (ไม่เดามั่ว)', () => {
    expect(lookupType('UNKNOWNCOIN')).toBeNull();
    expect(lookupType('ZZZ')).toBeNull();
  });

  test('Input ที่ไม่ใช่ String → คืน null', () => {
    expect(lookupType(undefined)).toBeNull();
    expect(lookupType(null)).toBeNull();
    expect(lookupType(123)).toBeNull();
    expect(lookupType('')).toBeNull();
  });
});

// Bug Fix (2026-08-09, SPCX) — Heuristic กัน Symbol ที่ไม่รู้จัก แต่หน้าตาเป็น Ticker
// หุ้นสหรัฐ/ตลาดอื่น หลุดไปเรียก SEC API (tryResolveFundBuy ใน webhook.controller.js)
// แล้วโดน Error กองทุนรวมผิดฝาผิดตัว — ดู DoD: ต้องไม่หลุดไป Fund Path ผิดๆ ทั้งแบบ
// US Ticker และแบบไม่ใช่ Ticker
describe('symbolRegistry.looksLikeThaiFundSymbol', () => {
  test('Ticker หุ้นสหรัฐ/ตลาดอื่นล้วนตัวอักษร 1-4 ตัว (ไม่อยู่ใน Whitelist) → false (ไม่เข้าเกณฑ์กองทุนไทย)', () => {
    expect(looksLikeThaiFundSymbol('SPCX')).toBe(false); // เคสจริงที่พบบั๊ก (4 ตัวอักษร)
    expect(looksLikeThaiFundSymbol('AAPL')).toBe(false);
    expect(looksLikeThaiFundSymbol('A')).toBe(false);
    expect(looksLikeThaiFundSymbol('ZZZZ')).toBe(false); // ยาว 4 ตัวพอดี ยังเป็น Ticker
  });

  // ตัดที่ ≤4 ตัวอักษรโดยเจตนา (ไม่ใช่ ≤5) เพราะ SCBRM (5 ตัวอักษร ไม่มีขีด) เป็น
  // ตัวอย่างกองทุนไทยจริงที่มีอยู่แล้วในระบบ (Round 7 Test Fixture) — ต้องยัง Resolve
  // ผ่าน SEC ได้ ไม่ถูก Heuristic นี้กันไว้ก่อน
  test('ชื่อย่อกองทุนรวมไทยจริง (มีขีด/ยาวตั้งแต่ 5 ตัวอักษรขึ้นไป) → true (เข้าเกณฑ์ ให้ลองค้น SEC)', () => {
    expect(looksLikeThaiFundSymbol('K-SELECT')).toBe(true);
    expect(looksLikeThaiFundSymbol('SCBRM')).toBe(true); // 5 ตัวอักษรพอดี ไม่มีขีด
    expect(looksLikeThaiFundSymbol('ONE-UGG-RA')).toBe(true);
  });

  test('ยาวตั้งแต่ 5 ตัวอักษรแต่ไม่ใช่กองทุนจริง (เช่น Symbol พิมพ์ผิด) → ยัง true (ให้ Flow ทดลองค้น SEC ก่อน ไม่ตัดสินใจแทน)', () => {
    // ตั้งใจ False Positive ฝั่งนี้ได้ (ปลอดภัยกว่า): ถ้าค้น SEC แล้วไม่เจอจริง
    // resolveFundForBuy จะคืน not_found → ตกเป็น VALIDATION_ERROR ตามปกติอยู่ดี
    expect(looksLikeThaiFundSymbol('NOTEXIST')).toBe(true);
  });

  test('Input ว่าง/ไม่ใช่ String → false', () => {
    expect(looksLikeThaiFundSymbol('')).toBe(false);
    expect(looksLikeThaiFundSymbol('   ')).toBe(false);
    expect(looksLikeThaiFundSymbol(undefined)).toBe(false);
    expect(looksLikeThaiFundSymbol(null)).toBe(false);
    expect(looksLikeThaiFundSymbol(123)).toBe(false);
  });

  test('case-insensitive และตัดช่องว่างหัวท้ายเหมือน lookupType', () => {
    expect(looksLikeThaiFundSymbol('spcx')).toBe(false);
    expect(looksLikeThaiFundSymbol('  k-select  ')).toBe(true);
  });
});

describe('symbolRegistry — ความถูกต้องของ type ทั้ง Registry', () => {
  test('ทุก type ต้องอยู่ในชุดที่ DATABASE.md อนุญาต', () => {
    const allowed = new Set([
      'crypto', 'stock_th', 'stock_us', 'etf', 'fund', 'gold_bar', 'gold_ornament',
    ]);
    for (const type of Object.values(SYMBOL_TYPES)) {
      expect(allowed.has(type)).toBe(true);
    }
  });
});
