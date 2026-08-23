// ═══════════════════════════════════════════════════════════════════════════
// transactionType.util — Unit Test (Stage 6a)
// ═══════════════════════════════════════════════════════════════════════════
// ไฟล์นี้คือ "แหล่งตัดสินความหมายของ transaction type ที่เดียวของทั้งระบบ"
// ทุกสูตรเงินในระบบเรียกใช้มัน — ถ้าไฟล์นี้ผิด เงินผิดทั้งระบบพร้อมกัน
// จึงต้องทดสอบ **ครบทุก type × ทุกฟังก์ชัน** ไม่ใช่แค่ Happy Path
//
// หัวใจของชุดเทสต์นี้มี 2 ข้อ:
//   1. buy/sell ต้องให้ผลตรงกับโค้ด Binary เดิม "เป๊ะ" (Stage 6a เป็น Pure
//      Refactor ห้ามเปลี่ยนพฤติกรรม)
//   2. type ที่ไม่รู้จักต้อง **throw** ไม่ใช่คืนค่าเดาๆ (ห้าม Silent Default)
const {
  TRANSACTION_TYPES,
  UnknownTransactionTypeError,
  heldQuantitySign,
  costBasisRole,
  dividendSign,
  reversalTypeFor,
  thaiLabel,
  directionTone,
  isKnownType,
} = require('../src/utils/transactionType.util');

// type ที่ต้องถูกปฏิเสธทุกกรณี — รวมค่าที่ "ดูเผินๆ เหมือนถูก" อย่าง 'BUY'
// ตัวใหญ่ และค่าที่เกิดจากบั๊ก Refactor จริง (undefined/null/object/number)
const REJECTED_TYPES = [
  'BUY',
  'Buy',
  'purchase',
  'stock_dividend', // ยังไม่รองรับ (Founder เลื่อนไปรอบหน้า Q4.4)
  '',
  undefined,
  null,
  0,
  42,
  {},
  [],
];

describe('TRANSACTION_TYPES', () => {
  test('มี 4 ค่าตามที่ออกแบบไว้ และ Freeze แล้ว (แก้ระหว่างรันไม่ได้)', () => {
    expect(TRANSACTION_TYPES).toEqual(['buy', 'sell', 'dividend', 'dividend_reversal']);
    expect(Object.isFrozen(TRANSACTION_TYPES)).toBe(true);
  });

  test('ยังไม่มี stock_dividend (Founder เลื่อนไปรอบหน้า — Q4.4)', () => {
    expect(TRANSACTION_TYPES).not.toContain('stock_dividend');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// heldQuantitySign — ผลต่อ "จำนวนที่ถือ"
// ═══════════════════════════════════════════════════════════════════════════
describe('heldQuantitySign', () => {
  test('buy = +1 (ตรงกับโค้ดเดิม `type === buy ? sum + qty : ...`)', () => {
    expect(heldQuantitySign('buy')).toBe(1);
  });

  test('sell = -1 (ตรงกับโค้ดเดิม `... : sum - qty`)', () => {
    expect(heldQuantitySign('sell')).toBe(-1);
  });

  // ⭐ ข้อนี้คือหัวใจของบั๊กที่ Design Doc § 2 เตือน — ถ้าคืน -1 แทน 0
  // จำนวนที่ถือจะหายไปเท่ากับ quantity ของรายการปันผลโดยไม่มี Error
  test('⭐ dividend = 0 — ปันผลเงินสดต้องไม่แตะจำนวนที่ถือ', () => {
    expect(heldQuantitySign('dividend')).toBe(0);
  });

  test('dividend_reversal = 0 — สมมาตรกับ dividend', () => {
    expect(heldQuantitySign('dividend_reversal')).toBe(0);
  });

  test.each(REJECTED_TYPES)('throw เมื่อเจอ type ที่ไม่รู้จัก: %p', (bad) => {
    expect(() => heldQuantitySign(bad)).toThrow(UnknownTransactionTypeError);
  });

  test('ข้อความ Error บอก context ที่เรียก เพื่อให้ไล่หาจุดต้นทางได้ทันที', () => {
    expect(() => heldQuantitySign('zzz', 'someCaller')).toThrow(/someCaller/);
  });

  test('Error มี code UNKNOWN_TRANSACTION_TYPE ให้ Caller ดักได้', () => {
    try {
      heldQuantitySign('zzz');
      throw new Error('ต้อง throw ก่อนถึงบรรทัดนี้');
    } catch (err) {
      expect(err.code).toBe('UNKNOWN_TRANSACTION_TYPE');
      expect(err.type).toBe('zzz');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// costBasisRole — ผลต่อ "ต้นทุน / กำไรที่รับรู้แล้ว"
// ═══════════════════════════════════════════════════════════════════════════
describe('costBasisRole', () => {
  test('buy = increase_cost', () => {
    expect(costBasisRole('buy')).toBe('increase_cost');
  });

  test('sell = realize_pnl', () => {
    expect(costBasisRole('sell')).toBe('realize_pnl');
  });

  // ⭐ ถ้าคืน realize_pnl ต้นทุนจะถูกตัดทิ้งและ ROI ของสินทรัพย์จะเพี้ยน
  test('⭐ dividend = income — ปันผลเป็นรายได้ ไม่ใช่การขาย', () => {
    expect(costBasisRole('dividend')).toBe('income');
  });

  test('dividend_reversal = income_reversal', () => {
    expect(costBasisRole('dividend_reversal')).toBe('income_reversal');
  });

  test.each(REJECTED_TYPES)('throw เมื่อเจอ type ที่ไม่รู้จัก: %p', (bad) => {
    expect(() => costBasisRole(bad)).toThrow(UnknownTransactionTypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dividendSign — ยอดเงินปันผลสะสม
// ═══════════════════════════════════════════════════════════════════════════
describe('dividendSign', () => {
  test('buy/sell = 0 — ไม่นับเข้ายอดปันผล', () => {
    expect(dividendSign('buy')).toBe(0);
    expect(dividendSign('sell')).toBe(0);
  });

  test('dividend = +1 / dividend_reversal = -1 (หักล้างกันได้พอดี)', () => {
    expect(dividendSign('dividend')).toBe(1);
    expect(dividendSign('dividend_reversal')).toBe(-1);
    expect(dividendSign('dividend') + dividendSign('dividend_reversal')).toBe(0);
  });

  test.each(REJECTED_TYPES)('throw เมื่อเจอ type ที่ไม่รู้จัก: %p', (bad) => {
    expect(() => dividendSign(bad)).toThrow(UnknownTransactionTypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// reversalTypeFor — ชนิดของแถวหักล้างตอน Undo (จุดที่อันตรายที่สุด)
// ═══════════════════════════════════════════════════════════════════════════
describe('reversalTypeFor', () => {
  test('buy → sell และ sell → buy (ตรงกับโค้ดเดิมเป๊ะ)', () => {
    expect(reversalTypeFor('buy')).toBe('sell');
    expect(reversalTypeFor('sell')).toBe('buy');
  });

  // ⭐⭐ ข้อนี้ร้ายแรงที่สุด: โค้ดเดิม `type === 'buy' ? 'sell' : 'buy'` จะคืน
  // 'buy' สำหรับ dividend = ย้อนปันผลแล้วได้ "การซื้อ" เพิ่มทั้งจำนวนที่ถือและ
  // ต้นทุนให้ผู้ใช้จากอากาศ
  test('⭐⭐ dividend → dividend_reversal (ห้ามเป็น buy เด็ดขาด)', () => {
    expect(reversalTypeFor('dividend')).toBe('dividend_reversal');
    expect(reversalTypeFor('dividend')).not.toBe('buy');
  });

  test('dividend_reversal → throw (ห้ามย้อนรายการหักล้างซ้อนกัน)', () => {
    expect(() => reversalTypeFor('dividend_reversal')).toThrow(UnknownTransactionTypeError);
    expect(() => reversalTypeFor('dividend_reversal')).toThrow(/ห้ามย้อนรายการหักล้างซ้ำ/);
  });

  test.each(REJECTED_TYPES)('throw เมื่อเจอ type ที่ไม่รู้จัก: %p', (bad) => {
    expect(() => reversalTypeFor(bad)).toThrow(UnknownTransactionTypeError);
  });

  test('ผลของ reversal ต้องหักล้างจำนวนที่ถือได้พอดีทุก type ที่ย้อนได้', () => {
    // สมบัติที่ต้องเป็นจริงเสมอ: sign(ต้นฉบับ) + sign(ตัวหักล้าง) = 0
    for (const type of ['buy', 'sell', 'dividend']) {
      const original = heldQuantitySign(type);
      const reversal = heldQuantitySign(reversalTypeFor(type));
      expect(original + reversal).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// thaiLabel / directionTone — ข้อความและโทนสีที่ผู้ใช้เห็น
// ═══════════════════════════════════════════════════════════════════════════
describe('thaiLabel', () => {
  // ข้อความ 2 ค่านี้ถูก assert ตรงๆ ในเทสต์เดิมหลายไฟล์ — ห้ามเปลี่ยนคำ
  test('buy = "ซื้อ" / sell = "ขาย" (ต้องตรงกับของเดิมเป๊ะ)', () => {
    expect(thaiLabel('buy')).toBe('ซื้อ');
    expect(thaiLabel('sell')).toBe('ขาย');
  });

  test('dividend = "ปันผล" / dividend_reversal = "ย้อนปันผล"', () => {
    expect(thaiLabel('dividend')).toBe('ปันผล');
    expect(thaiLabel('dividend_reversal')).toBe('ย้อนปันผล');
  });

  test('⭐ ปันผลต้องไม่ถูกแสดงเป็น "ขาย" (บั๊กที่ Design Doc § 2 เตือน)', () => {
    expect(thaiLabel('dividend')).not.toBe('ขาย');
  });

  test.each(REJECTED_TYPES)('throw เมื่อเจอ type ที่ไม่รู้จัก: %p', (bad) => {
    expect(() => thaiLabel(bad)).toThrow(UnknownTransactionTypeError);
  });
});

describe('directionTone', () => {
  test('buy = positive / sell = negative (ตรงกับ isBuy ? profit : loss เดิม)', () => {
    expect(directionTone('buy')).toBe('positive');
    expect(directionTone('sell')).toBe('negative');
  });

  test('dividend = positive (รับเงินเข้า) / dividend_reversal = negative', () => {
    expect(directionTone('dividend')).toBe('positive');
    expect(directionTone('dividend_reversal')).toBe('negative');
  });

  test.each(REJECTED_TYPES)('throw เมื่อเจอ type ที่ไม่รู้จัก: %p', (bad) => {
    expect(() => directionTone(bad)).toThrow(UnknownTransactionTypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isKnownType — ตัวเดียวในไฟล์ที่ "ไม่ throw" (ใช้ Validate Input ตอบ 400)
// ═══════════════════════════════════════════════════════════════════════════
describe('isKnownType', () => {
  test('คืน true กับ type ที่รองรับครบทั้ง 4', () => {
    for (const type of TRANSACTION_TYPES) {
      expect(isKnownType(type)).toBe(true);
    }
  });

  test.each(REJECTED_TYPES)('คืน false (ไม่ throw) กับค่าที่ไม่รู้จัก: %p', (bad) => {
    expect(isKnownType(bad)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ความครบถ้วน — กันคนเพิ่ม type ใหม่แล้วลืมเพิ่ม case ในบางฟังก์ชัน
// ═══════════════════════════════════════════════════════════════════════════
// นี่คือเทสต์ที่ทำให้ "ลืมไม่ได้จริง": ถ้ามีคนเพิ่มค่าที่ 5 เข้า TRANSACTION_TYPES
// แล้วเพิ่ม case ไม่ครบทุกฟังก์ชัน เทสต์นี้จะแดงทันทีโดยไม่ต้องรอให้เงินผิด
describe('ความครบถ้วนของ switch ทุกฟังก์ชัน', () => {
  test('ทุก type ใน TRANSACTION_TYPES ต้องมี case ในทุกฟังก์ชันที่ต้องรองรับ', () => {
    for (const type of TRANSACTION_TYPES) {
      expect(() => heldQuantitySign(type)).not.toThrow();
      expect(() => costBasisRole(type)).not.toThrow();
      expect(() => dividendSign(type)).not.toThrow();
      expect(() => thaiLabel(type)).not.toThrow();
      expect(() => directionTone(type)).not.toThrow();
    }
  });

  test('reversalTypeFor รองรับทุก type ยกเว้น dividend_reversal (ที่ห้ามย้อนซ้ำ)', () => {
    for (const type of TRANSACTION_TYPES) {
      if (type === 'dividend_reversal') {
        expect(() => reversalTypeFor(type)).toThrow();
      } else {
        expect(() => reversalTypeFor(type)).not.toThrow();
      }
    }
  });

  test('ผลของ reversalTypeFor ต้องเป็น type ที่ระบบรู้จักเสมอ', () => {
    for (const type of ['buy', 'sell', 'dividend']) {
      expect(isKnownType(reversalTypeFor(type))).toBe(true);
    }
  });
});
