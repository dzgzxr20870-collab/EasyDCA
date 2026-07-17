const { lookupType, SYMBOL_TYPES } = require('../src/services/symbolRegistry.service');

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
