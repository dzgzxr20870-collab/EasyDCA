// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — dividend ต้องไม่ถูกตีความเป็น "ขาย" ในสูตรเงินใดๆ (Stage 6a)
// ═══════════════════════════════════════════════════════════════════════════
// ที่มา: docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 2
//
// โค้ดคำนวณเงินทั้งระบบเคยเขียนแบบ Binary (`buy` หรือ "ไม่ใช่ buy") ไม่ใช่
// enumerate ครบทุกค่า — วินาทีที่ `dividend` เข้า DB ได้ ทุกจุดจะตีความ
// dividend เป็น sell **ทันทีโดยไม่มี Error ใดๆ** (บั๊กเงียบที่แพงที่สุด)
//
// ── Fixture บังคับตาม Design Doc § 2 ────────────────────────────────────────
//     buy 10 หุ้น → dividend → sell 10 หุ้น
//     ต้องได้ heldQty = 0 และ costBasis ไม่ติดลบ
//
// ── ⚠️ หลักฐาน Red-Green (AI_WORK_POLICY.md § 3 ชั้น 3) ────────────────────
// "Test ที่ไม่เคยแดงไม่ได้พิสูจน์อะไร" — ชุดนี้ถูกพิสูจน์แล้วด้วยการถอด fix ออก
// จริง โดยแก้ transactionType.util.js ให้กลับไปเป็นพฤติกรรม Binary เดิม:
//
//     heldQuantitySign:  case 'dividend': return -1;   // แทน 0
//     costBasisRole:     case 'dividend': return 'realize_pnl';  // แทน 'income'
//     reversalTypeFor:   case 'dividend': return 'buy';          // แทน dividend_reversal
//
// ผลที่วัดได้จริงตอนถอด fix ออก (รันจริง ไม่ใช่คาดเดา — นับรวมไฟล์
// transactionType.util.test.js ที่รันคู่กัน):
//
//     Tests: 13 failed, 104 passed, 117 total
//
// รายการที่แดง 13 เคส:
//   ✕ heldQuantitySign › dividend = 0
//   ✕ heldQuantitySign › dividend_reversal = 0
//   ✕ costBasisRole › dividend = income
//   ✕ reversalTypeFor › dividend → dividend_reversal (ห้ามเป็น buy)
//   ✕ Fixture § 2 › heldQty ต้องเป็น 0 พอดี            (ได้ -1)
//   ✕ Fixture § 2 › heldQty ต้องไม่ติดลบ
//   ✕ Fixture § 2 › realizedPnL = 200 เท่านั้น         (ได้ 250 — ปันผลถูกนับเป็นการขาย)
//   ✕ ปันผลไม่ทำให้จำนวนที่ถือลดลง
//   ✕ ปันผลไม่ทำให้จำนวนที่ถือติดลบแม้ไม่เคยซื้อมาก่อน
//   ✕ ปันผลไม่แตะ costBasis และไม่แตะ realizedPnL
//   ✕ ปันผลที่ไม่ระบุ quantity (0 หน่วย) ก็ต้องไม่ทำให้อะไรเพี้ยน
//   ✕ dividend + dividend_reversal แล้วตัวเลขกลับไปเท่าเดิม
//   ✕ ย้อนปันผลต้องได้ dividend_reversal ไม่ใช่ buy
//
// ⭐ จุดที่ยืนยันว่าเทสต์ชุดนี้ "เจาะจงพอ" ไม่ใช่แดงมั่ว: 104 เคสที่เหลือ
//    (ทั้งหมดของ buy/sell) ยังเขียวตลอดทั้งตอนถอด fix — แปลว่าที่แดงคือ
//    ความหมายของ dividend ล้วนๆ ไม่ใช่ผลข้างเคียงที่ทำพังทั้งไฟล์
//
// ใส่ fix กลับ: เขียว 117/117
//
// ── กฎ Mock ของไฟล์นี้ (บทเรียนจาก POSTMORTEM_AMOUNT_CONSISTENCY) ──────────
// ⚠️ ห้าม Mock service ฝั่งใดฝั่งหนึ่งเด็ดขาด — บั๊ก "ยอดที่แสดง ≠ ยอดที่บันทึก"
// (2026-08-23) รอดสายตาเทสต์ทั้งสองฝั่งมาได้เพราะแต่ละไฟล์ Mock อีกฝั่งทิ้ง
// แล้วบั๊คไปอยู่ที่ "รอยต่อ" พอดี — ไฟล์นี้จึงใช้ transaction.service และ
// portfolio.service **ตัวจริงทั้งคู่** ไม่ Mock อะไรเลย (ทั้งสองฟังก์ชันที่
// ทดสอบเป็น Pure Function รับ array ธุรกรรมเข้า ไม่แตะ DB อยู่แล้ว)
const { calculateHeldQuantity } = require('../src/services/transaction.service');
const { calculateTotalInvested } = require('../src/services/portfolio.service');
const {
  heldQuantitySign,
  reversalTypeFor,
} = require('../src/utils/transactionType.util');

// helper สร้างแถวธุรกรรมให้ใกล้เคียงรูปร่างจริงจาก transaction.repository.toTransaction
let seq = 0;
function tx(type, { quantity = 0, amountThb = 0, date = '2026-08-01' } = {}) {
  seq += 1;
  return {
    id: `tx-${seq}`,
    type,
    quantity,
    amountThb,
    pricePerUnit: quantity > 0 ? amountThb / quantity : 0,
    date,
    currency: 'THB',
    note: null,
  };
}

describe('⭐ Fixture บังคับของ Design Doc § 2 — buy 10 → dividend → sell 10', () => {
  // ปันผลเงินสด 50 บาท โดยระบุ quantity มาด้วย (เคสที่อันตรายที่สุด เพราะโค้ด
  // Binary เดิมจะเอา quantity ก้อนนี้ไป "ลบ" ออกจากจำนวนที่ถือ)
  const history = [
    tx('buy', { quantity: 10, amountThb: 1000, date: '2026-08-01' }),
    tx('dividend', { quantity: 1, amountThb: 50, date: '2026-08-02' }),
    tx('sell', { quantity: 10, amountThb: 1200, date: '2026-08-03' }),
  ];

  test('heldQty ต้องเป็น 0 พอดี (ไม่ใช่ -1 จากการนับ dividend เป็นการขาย)', () => {
    expect(calculateHeldQuantity(history)).toBe(0);
  });

  test('heldQty ต้องไม่ติดลบ', () => {
    expect(calculateHeldQuantity(history)).toBeGreaterThanOrEqual(0);
  });

  test('costBasis (totalInvested) ต้องไม่ติดลบ', () => {
    const { totalInvested } = calculateTotalInvested(history);
    expect(totalInvested).toBeGreaterThanOrEqual(0);
  });

  test('ขายหมดแล้ว costBasis ต้องเป็น 0 พอดี', () => {
    const { totalInvested } = calculateTotalInvested(history);
    expect(totalInvested).toBe(0);
  });

  // ซื้อ 1000 ขาย 1200 → กำไรจากส่วนต่างราคา = 200 เท่านั้น
  // เงินปันผล 50 บาทเป็น "รายได้" คนละก้อน ห้ามบวกเข้า realizedPnL
  // (โค้ด Binary เดิมจะได้ 250 เพราะนับ dividend เป็นการขายด้วย)
  test('⭐ realizedPnL = 200 เท่านั้น — เงินปันผล 50 ต้องไม่ถูกนับรวม', () => {
    const { realizedPnL } = calculateTotalInvested(history);
    expect(realizedPnL).toBe(200);
  });
});

describe('dividend เดี่ยวๆ ต้องไม่ขยับตัวเลขใดเลย', () => {
  const buyOnly = [tx('buy', { quantity: 10, amountThb: 1000 })];
  const buyThenDividend = [
    tx('buy', { quantity: 10, amountThb: 1000 }),
    tx('dividend', { quantity: 2, amountThb: 80, date: '2026-08-05' }),
  ];

  test('ปันผลไม่ทำให้จำนวนที่ถือลดลง (ยังเป็น 10 เท่าเดิม)', () => {
    expect(calculateHeldQuantity(buyThenDividend)).toBe(10);
  });

  test('ปันผลไม่ทำให้จำนวนที่ถือติดลบแม้ไม่เคยซื้อมาก่อน', () => {
    const dividendOnly = [tx('dividend', { quantity: 3, amountThb: 90 })];
    expect(calculateHeldQuantity(dividendOnly)).toBe(0);
  });

  test('ปันผลไม่แตะ costBasis และไม่แตะ realizedPnL', () => {
    const before = calculateTotalInvested(buyOnly);
    const after = calculateTotalInvested(buyThenDividend);
    expect(after.totalInvested).toBe(before.totalInvested);
    expect(after.realizedPnL).toBe(before.realizedPnL);
  });

  test('ปันผลที่ไม่ระบุ quantity (0 หน่วย) ก็ต้องไม่ทำให้อะไรเพี้ยน', () => {
    const withZeroQty = [
      tx('buy', { quantity: 10, amountThb: 1000 }),
      tx('dividend', { quantity: 0, amountThb: 50, date: '2026-08-05' }),
    ];
    expect(calculateHeldQuantity(withZeroQty)).toBe(10);
    expect(calculateTotalInvested(withZeroQty).totalInvested).toBe(1000);
    expect(calculateTotalInvested(withZeroQty).realizedPnL).toBe(0);
  });
});

describe('dividend_reversal ต้องหักล้าง dividend ได้พอดี', () => {
  test('dividend + dividend_reversal แล้วตัวเลขกลับไปเท่าก่อนมีปันผลทุกตัว', () => {
    const base = [tx('buy', { quantity: 10, amountThb: 1000 })];
    const withPair = [
      tx('buy', { quantity: 10, amountThb: 1000 }),
      tx('dividend', { quantity: 1, amountThb: 50, date: '2026-08-05' }),
      tx('dividend_reversal', { quantity: 1, amountThb: 50, date: '2026-08-06' }),
    ];

    expect(calculateHeldQuantity(withPair)).toBe(calculateHeldQuantity(base));
    expect(calculateTotalInvested(withPair)).toEqual(calculateTotalInvested(base));
  });

  test('⭐⭐ ย้อนปันผลต้องได้ dividend_reversal ไม่ใช่ buy', () => {
    // โค้ดเดิม `latest.type === 'buy' ? 'sell' : 'buy'` จะคืน 'buy' ที่นี่
    // = สร้างการซื้อขึ้นมาจากอากาศ เพิ่มทั้งจำนวนที่ถือและต้นทุนให้ผู้ใช้
    expect(reversalTypeFor('dividend')).toBe('dividend_reversal');
    expect(heldQuantitySign(reversalTypeFor('dividend'))).toBe(0);
  });
});

describe('พฤติกรรมของ buy/sell ต้องไม่เปลี่ยนเลย (Stage 6a เป็น Pure Refactor)', () => {
  test('buy → sell ปกติยังให้ผลเท่าเดิมทุกตัวเลข', () => {
    const history = [
      tx('buy', { quantity: 10, amountThb: 1000, date: '2026-08-01' }),
      tx('sell', { quantity: 4, amountThb: 480, date: '2026-08-02' }),
    ];

    expect(calculateHeldQuantity(history)).toBe(6);
    // ต้นทุนเฉลี่ย 100/หน่วย ขาย 4 หน่วย → ตัดต้นทุน 400 เหลือ 600
    // ขายได้ 480 − ต้นทุนส่วนที่ขาย 400 = กำไร 80
    expect(calculateTotalInvested(history)).toEqual({
      totalInvested: 600,
      realizedPnL: 80,
    });
  });

  test('type ที่ไม่รู้จักหลุดเข้าสูตรต้อง throw ไม่ใช่คำนวณเงินผิดเงียบๆ', () => {
    const poisoned = [tx('transfer_in', { quantity: 5, amountThb: 500 })];
    expect(() => calculateHeldQuantity(poisoned)).toThrow(/transfer_in/);
    expect(() => calculateTotalInvested(poisoned)).toThrow(/transfer_in/);
  });
});
