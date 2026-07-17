const { getSymbols } = require('../src/controllers/assets.controller');
const symbolRegistry = require('../src/services/symbolRegistry.service');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

describe('GET /api/v1/assets/symbols', () => {
  test('คืนรายการสินทรัพย์ครบทุกตัวใน Registry พร้อม symbol/name/type', () => {
    const res = mockRes();
    getSymbols({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { symbols } = res.json.mock.calls[0][0];

    expect(symbols).toHaveLength(Object.keys(symbolRegistry.SYMBOL_TYPES).length);
    expect(symbols[0]).toEqual(
      expect.objectContaining({
        symbol: expect.any(String),
        name: expect.any(String),
        type: expect.any(String),
      })
    );
  });

  test('ตั้ง Cache-Control แบบ private (ข้อมูล Static แต่อยู่หลัง Login)', () => {
    const res = mockRes();
    getSymbols({}, res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
  });
});

describe('symbolRegistry.listSymbols (แหล่งข้อมูลของ Endpoint)', () => {
  const symbols = symbolRegistry.listSymbols();

  test('ทุกตัวมี type ตรงกับ SYMBOL_TYPES (แหล่งความจริงเดียว)', () => {
    for (const { symbol, type } of symbols) {
      expect(type).toBe(symbolRegistry.SYMBOL_TYPES[symbol]);
    }
  });

  test('ทุกตัวมีชื่อแสดงผลจริง ไม่ Fallback เป็น Symbol ซ้ำ', () => {
    const missingName = symbols.filter((s) => s.name === s.symbol);
    expect(missingName).toEqual([]);
  });

  test('ไม่มี Symbol ซ้ำ', () => {
    const seen = new Set(symbols.map((s) => s.symbol));
    expect(seen.size).toBe(symbols.length);
  });

  test('ทุกตัวบันทึกได้จริง (lookupType ไม่คืน null) — Dropdown ไม่โชว์ของที่ใช้ไม่ได้', () => {
    for (const { symbol } of symbols) {
      expect(symbolRegistry.lookupType(symbol)).not.toBeNull();
    }
  });

  test('ไม่มีกองทุนรวม (fund) ใน List — Resolve ผ่าน LINE flow เท่านั้น', () => {
    expect(symbols.some((s) => s.type === 'fund')).toBe(false);
  });

  test('ครอบคลุมครบทุกประเภทที่เว็บต้องใช้ (crypto/หุ้นไทย/หุ้นสหรัฐ/ทอง)', () => {
    const types = new Set(symbols.map((s) => s.type));
    expect(types).toEqual(new Set(['crypto', 'stock_th', 'stock_us', 'gold_bar', 'gold_ornament']));
  });

  test('lookupType เดิมไม่ถูกกระทบจากการเพิ่ม SYMBOL_NAMES (Backward Compat)', () => {
    expect(symbolRegistry.lookupType('btc')).toBe('crypto');
    expect(symbolRegistry.lookupType(' PTT ')).toBe('stock_th');
    expect(symbolRegistry.lookupType('BRK.B')).toBe('stock_us');
    expect(symbolRegistry.lookupType('ไม่มีจริง')).toBeNull();
    expect(symbolRegistry.lookupType(null)).toBeNull();
  });

  test('lookupName คืนชื่อ (case-insensitive) และ null เมื่อไม่รู้จัก', () => {
    expect(symbolRegistry.lookupName('btc')).toBe('Bitcoin บิตคอยน์');
    expect(symbolRegistry.lookupName('PTT')).toBe('ปตท.');
    expect(symbolRegistry.lookupName('NOPE')).toBeNull();
  });
});
