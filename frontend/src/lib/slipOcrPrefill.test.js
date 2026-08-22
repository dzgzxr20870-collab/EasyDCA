import { describe, expect, it } from 'vitest';
import { buildOcrPrefill } from './slipOcrPrefill.js';

// ═══════════════════════════════════════════════════════════════════════
// buildOcrPrefill — กันบั๊ก BCPG ฝั่งเว็บ (สลิปขายถูกบันทึกเป็นซื้อ)
// ═══════════════════════════════════════════════════════════════════════
// ตรรกะนี้ตัดสินว่าตัวเลขอะไรถูกเติมลงฟอร์มก่อนผู้ใช้กดบันทึกลง Ledger — ผิดแล้ว
// กระทบ P&L/จำนวนหน่วยถือครองโดยตรง และเป็น Immutable Ledger ที่แก้ด้วย Reversal
// เท่านั้น จึงต้องคลุมทุกกิ่งของการตัดสิน side

const FULL_SLIP = {
  symbol: 'BCPG',
  quantity: 10,
  pricePerUnit: 6.9,
  amountTotal: 69,
  currency: 'THB',
  date: '2026-08-20',
  confidence: 'high',
};

describe('side อ่านไม่ได้ → ห้ามเดา ห้ามเติมตัวเลขที่ผูกกับทิศทาง', () => {
  // ⚠️ นี่คือ Test หลักของ Fix รอบนี้ — ถอด Fix ออก (ใช้ else ครอบ null เหมือนเดิม)
  // แล้ว Test ชุดนี้ต้องแดงทันที (พิสูจน์ Red-Green แล้ว ดูรายงาน)
  const UNRESOLVED_SIDES = [
    ['null', null],
    ['undefined', undefined],
    ['ค่าที่ไม่รู้จัก (Sell ตัวใหญ่)', 'Sell'],
    ['ค่าที่ไม่รู้จัก (ภาษาไทย)', 'ขาย'],
    ['ค่าที่ไม่รู้จัก (unknown)', 'unknown'],
    ['สตริงว่าง', ''],
  ];

  it.each(UNRESOLVED_SIDES)('side = %s → ไม่เลือกโหมดให้ (side เป็น null)', (_label, side) => {
    const result = buildOcrPrefill({ ...FULL_SLIP, side });

    // หัวใจ: ต้องไม่เดาเป็น 'buy' และต้องไม่เดาเป็น 'sell' เช่นกัน
    expect(result.side).toBeNull();
    expect(result.sideUnresolved).toBe(true);
  });

  it.each(UNRESOLVED_SIDES)(
    'side = %s → ไม่เติมตัวเลขที่ความหมายขึ้นกับทิศทางเลยสักช่อง',
    (_label, side) => {
      const result = buildOcrPrefill({ ...FULL_SLIP, side });

      // โหมดซื้อ: จำนวนเงิน/สกุล/ราคาต่อหน่วย
      expect(result.amountInput).toBeNull();
      expect(result.currency).toBeNull();
      expect(result.pricePerUnit).toBeNull();
      // โหมดขาย: จำนวนหน่วย/ราคาที่ขายได้
      expect(result.sellQuantity).toBeNull();
      expect(result.sellPrice).toBeNull();
    }
  );

  // ค่าที่ปลอดภัยทั้งสองโหมดยังเติมได้ — ไม่งั้นผู้ใช้ต้องกรอกใหม่ทั้งหมดโดยไม่จำเป็น
  it('ยังเติม "วันที่" ให้ได้ (ไม่ขึ้นกับทิศทาง)', () => {
    const result = buildOcrPrefill({ ...FULL_SLIP, side: null });

    expect(result.date).toBe('2026-08-20');
  });

  it('สลิปที่ไม่มีวันที่ → date เป็น null (ไม่ยัดค่าเพี้ยน)', () => {
    expect(buildOcrPrefill({ ...FULL_SLIP, side: null, date: null }).date).toBeNull();
    expect(buildOcrPrefill({ ...FULL_SLIP, side: null, date: '' }).date).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REGRESSION — เคสที่ side ชัดเจนต้อง Prefill ครบเหมือนเดิมทุกประการ
// ═══════════════════════════════════════════════════════════════════════
// นี่คือคุณค่าหลักของฟีเจอร์ (ผู้ใช้สแกนแล้วไม่ต้องพิมพ์เอง) — Fix เรื่อง side ไม่ชัด
// ต้องไม่ทำให้ 2 เคสนี้ถดถอย
describe('side = "sell" → Prefill โหมดขายครบ (ไม่ถดถอย)', () => {
  const result = buildOcrPrefill({ ...FULL_SLIP, side: 'sell' });

  it('สลับเป็นโหมดขาย', () => {
    expect(result.side).toBe('sell');
    expect(result.sideUnresolved).toBe(false);
  });

  it('เติมจำนวนหน่วย + ราคาที่ขายได้', () => {
    expect(result.sellQuantity).toBe('10');
    expect(result.sellPrice).toBe('6.9');
  });

  it('ไม่เติมช่องของโหมดซื้อ (คนละความหมายกัน)', () => {
    expect(result.amountInput).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.pricePerUnit).toBeNull();
  });
});

describe('side = "buy" → Prefill โหมดซื้อครบ (ไม่ถดถอย)', () => {
  const result = buildOcrPrefill({ ...FULL_SLIP, side: 'buy' });

  it('สลับเป็นโหมดซื้อ', () => {
    expect(result.side).toBe('buy');
    expect(result.sideUnresolved).toBe(false);
  });

  it('เติมจำนวนเงินรวม (ไม่ใช่จำนวนหน่วย)', () => {
    expect(result.amountInput).toBe('69');
  });

  // ⚠️ พฤติกรรมเปลี่ยนโดยเจตนา (fix/slip-quantity-from-slip): FULL_SLIP มีทั้ง
  // quantity และ pricePerUnit ครบ จึงถูกจัดเข้า buyQuantity/buyPricePerUnit
  // (ตัวเลขที่บันทึกจริง) แทนช่อง pricePerUnit เดิมของหุ้นไทย — กันไม่ให้หน้าจอ
  // มีช่องราคา 2 ช่องโชว์ค่าเดียวกันซ้อนกัน ส่วนเคสที่สลิป "ไม่มีจำนวนหน่วย"
  // ยังเติมช่อง pricePerUnit เดิมเหมือนเดิม (มี Test คลุมด้านล่าง)
  it('มีจำนวนหน่วยครบ → ราคาไปอยู่ที่ buyPricePerUnit ไม่ใช่ช่องราคาเดิม', () => {
    expect(result.pricePerUnit).toBeNull();
    expect(result.buyPricePerUnit).toBe('6.9');
  });

  it('ไม่เติมช่องของโหมดขาย', () => {
    expect(result.sellQuantity).toBeNull();
    expect(result.sellPrice).toBeNull();
  });

  it('สลิปสกุล USD → เติมสกุลเงินให้', () => {
    const usd = buildOcrPrefill({ ...FULL_SLIP, side: 'buy', currency: 'USD' });
    expect(usd.currency).toBe('USD');
  });

  it('สลิปสกุล THB → ไม่ต้องแตะช่องสกุล (ค่า Default อยู่แล้ว)', () => {
    expect(result.currency).toBeNull();
  });
});

describe('ค่าตัวเลขที่ใช้ไม่ได้ → ไม่เติม (คงพฤติกรรมเดิมของฟอร์ม)', () => {
  it.each([
    ['0', 0],
    ['ติดลบ', -5],
    ['null', null],
    ['ไม่ใช่ตัวเลข', 'abc'],
  ])('quantity = %s → ไม่เติม sellQuantity', (_label, quantity) => {
    const result = buildOcrPrefill({ ...FULL_SLIP, side: 'sell', quantity });
    expect(result.sellQuantity).toBeNull();
  });

  it.each([
    ['0', 0],
    ['ติดลบ', -5],
    ['null', null],
  ])('amountTotal = %s → ไม่เติม amountInput', (_label, amountTotal) => {
    const result = buildOcrPrefill({ ...FULL_SLIP, side: 'buy', amountTotal });
    expect(result.amountInput).toBeNull();
  });
});

describe('Input ที่ผิดรูปแบบสิ้นเชิง → ไม่ throw', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['object ว่าง', {}],
  ])('slip = %s → คืน base ที่ปลอดภัย', (_label, slip) => {
    expect(() => buildOcrPrefill(slip)).not.toThrow();

    const result = buildOcrPrefill(slip);
    expect(result.side).toBeNull();
    expect(result.sideUnresolved).toBe(true);
    expect(result.amountInput).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ใช้ "ตัวเลขจากสลิป" แทนการคำนวณใหม่จากราคาตลาด (fix/slip-quantity-from-slip)
// ═══════════════════════════════════════════════════════════════════════
// เคสจริง: สลิป ASTS 12 ส.ค. (20.0104114 หุ้น @ 74.84 USD) บันทึกวันที่ 22 ส.ค.
// เดิมส่งแค่ยอดเงิน → Backend ดึงราคาตลาดวันที่ 22 มาหารใหม่ → จำนวนหุ้นเพี้ยน
describe('buyQuantity/buyPricePerUnit — ตัวเลขที่จะถูกบันทึกจริง (โหมดซื้อ)', () => {
  const ASTS = {
    symbol: 'ASTS', side: 'buy', quantity: 20.0104114, pricePerUnit: 74.84,
    amountTotal: 1497.58, currency: 'USD', date: '2026-08-12', confidence: 'high',
  };

  it('สลิปมีจำนวนหน่วย + ราคาครบ → คืนคู่นี้ออกมาให้บันทึกตรงๆ', () => {
    const result = buildOcrPrefill(ASTS);

    expect(result.buyQuantity).toBe('20.0104114');
    expect(result.buyPricePerUnit).toBe('74.84');
  });

  // กันสองช่องราคาโชว์ค่าเดียวกันซ้อนกันบนหน้าจอ (pricePerUnit เป็นช่องของหุ้นไทย)
  it('เมื่อมีตัวเลขครบ → ไม่เติมช่องราคาต่อหน่วยแบบเดิมซ้ำ', () => {
    expect(buildOcrPrefill(ASTS).pricePerUnit).toBeNull();
  });

  it('ยังเติมยอดเงินไว้ให้เห็นภาพรวม (แต่ไม่ใช่ตัวที่ถูกบันทึก)', () => {
    expect(buildOcrPrefill(ASTS).amountInput).toBe('1497.58');
  });

  // ⚠️ เคสนี้ต้องไม่พัง — สลิปแอปที่ซื้อเป็น "จำนวนเงิน" ไม่มีจำนวนหุ้นมาให้
  it('สลิปมีแต่ยอดเงิน (ไม่มีจำนวนหน่วย) → ไม่มี buyQuantity ใช้เส้นทางเดิม', () => {
    const amountOnly = buildOcrPrefill({
      ...ASTS, quantity: null, pricePerUnit: null,
    });

    expect(amountOnly.buyQuantity).toBeNull();
    expect(amountOnly.buyPricePerUnit).toBeNull();
    expect(amountOnly.amountInput).toBe('1497.58');
  });

  it('มีจำนวนหน่วยแต่ไม่มีราคา → ไม่ใช้ตัวเลขจากสลิป (ครึ่งเดียวประกอบไม่ได้)', () => {
    const result = buildOcrPrefill({ ...ASTS, pricePerUnit: null });

    expect(result.buyQuantity).toBeNull();
    expect(result.buyPricePerUnit).toBeNull();
  });

  it('หุ้นไทยที่สลิปให้แค่ยอดเงิน + ราคา → ยังเติมช่องราคาเดิมให้กรอกได้', () => {
    const thai = buildOcrPrefill({ ...ASTS, quantity: null, currency: 'THB' });

    expect(thai.buyQuantity).toBeNull();
    expect(thai.pricePerUnit).toBe('74.84');
  });

  it('โหมดขายไม่มี buyQuantity (ใช้ sellQuantity/sellPrice แทน)', () => {
    const sell = buildOcrPrefill({ ...ASTS, side: 'sell' });

    expect(sell.buyQuantity).toBeNull();
    expect(sell.sellQuantity).toBe('20.0104114');
    expect(sell.sellPrice).toBe('74.84');
  });

  it('side อ่านไม่ได้ → ไม่มี buyQuantity เช่นกัน (ห้ามเดาทิศทาง)', () => {
    const unknown = buildOcrPrefill({ ...ASTS, side: null });

    expect(unknown.buyQuantity).toBeNull();
    expect(unknown.buyPricePerUnit).toBeNull();
  });
});
