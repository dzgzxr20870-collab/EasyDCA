const { resolveFeeTotal, resolveGrossAmount } = require('../src/services/slipOcr.service');

// ═══════════════════════════════════════════════════════════════════════
// ค่าธรรมเนียม + การตัดสิน "มูลค่าหุ้น vs ยอดสุทธิ" (Migration 041)
// ═══════════════════════════════════════════════════════════════════════
// Fixture เป็นตัวเลขจากสลิป Dime! จริงที่ Founder ทดสอบแล้วยืนยันแล้ว:
//
//   EOSE : มูลค่าหุ้น 106.44 · ค่าคอม 0.25 · VAT 0.02 · ยอดจ่ายจริง 106.72
//          (ราคาจริง 4.2548 แสดงบนสลิปเป็น 4.25 → qty × price = 106.32 ไม่ตรง 106.44)
//   ASTS : มูลค่าหุ้น 1497.60 · ค่าคอม 2.24 · VAT 0.16 · ยอดจ่ายจริง 1500.00
//          (qty × price = 1497.58 ไม่ตรง 1497.60)
//
// ทั้งสองใบพิสูจน์ปัญหาเดียวกัน: ราคาต่อหน่วยบนสลิปถูกปัดเศษมาแสดง พอคูณกลับจึง
// ไม่ตรงกับ "มูลค่าหุ้น" ที่สลิประบุไว้ตรงๆ

const EOSE = {
  quantity: 25.0106, pricePerUnit: 4.25,
  slipGross: 106.44, commission: 0.25, vat: 0.02, net: 106.72,
};
const ASTS = {
  quantity: 20.0104114, pricePerUnit: 74.84,
  slipGross: 1497.6, commission: 2.24, vat: 0.16, net: 1500.0,
};

describe('resolveFeeTotal', () => {
  it('รวมค่าคอม + VAT เมื่อสลิปแยกบรรทัด (EOSE: 0.25 + 0.02 = 0.27)', () => {
    expect(resolveFeeTotal({ commission: EOSE.commission, vat: EOSE.vat })).toBe(0.27);
  });

  it('รวมค่าคอม + VAT (ASTS: 2.24 + 0.16 = 2.40)', () => {
    expect(resolveFeeTotal({ commission: ASTS.commission, vat: ASTS.vat })).toBe(2.4);
  });

  it('ใช้ fee_total ก่อนเสมอเมื่อโบรกให้ยอดรวมมาเลย', () => {
    expect(resolveFeeTotal({ feeTotal: 5, commission: 99, vat: 99 })).toBe(5);
  });

  it('มีแค่ค่าคอม ไม่มี VAT (โบรกคริปโตส่วนใหญ่) → ใช้ค่าคอมเป็นยอดรวม', () => {
    expect(resolveFeeTotal({ commission: 1.5, vat: null })).toBe(1.5);
  });

  // ⚠️ หัวใจ: null = "ไม่รู้" ไม่ใช่ 0 = "ไม่มีค่าธรรมเนียม" (ดู migration 041)
  it('สลิปไม่ระบุอะไรเลย → null (ห้ามเดาเป็น 0)', () => {
    expect(resolveFeeTotal({})).toBeNull();
    expect(resolveFeeTotal({ feeTotal: null, commission: null, vat: null })).toBeNull();
  });

  it('ค่าที่ใช้ไม่ได้ (0/ติดลบ/ไม่ใช่ตัวเลข) → ไม่นับ', () => {
    expect(resolveFeeTotal({ commission: 0, vat: 0 })).toBeNull();
    expect(resolveFeeTotal({ commission: -5, vat: null })).toBeNull();
    expect(resolveFeeTotal({ feeTotal: 'abc' })).toBeNull();
  });
});

describe('resolveGrossAmount — ใช้เลขจากสลิปเมื่อพิสูจน์ได้', () => {
  it('EOSE: ยืนยันด้วย net - fee แล้ว → ใช้ 106.44 จากสลิป (ไม่ใช่ 106.32 ที่คำนวณเอง)', () => {
    const result = resolveGrossAmount({
      side: 'buy',
      aiAmount: EOSE.slipGross,
      netAmount: EOSE.net,
      feeTotal: 0.27,
      quantity: EOSE.quantity,
      pricePerUnit: EOSE.pricePerUnit,
    });

    expect(result.amount).toBe(106.44);
    expect(result.source).toBe('slip_gross');
    // 106.72 - 0.27 = 106.45 ... ต่างจาก 106.44 อยู่ 0.01 = อยู่ในเกณฑ์ EXACT_MATCH
    expect(result.reason).toBe('verified_against_net_minus_fee');
  });

  it('ASTS: ยืนยันแล้ว → ใช้ 1497.60 จากสลิป (ไม่ใช่ 1497.58 ที่คำนวณเอง)', () => {
    const result = resolveGrossAmount({
      side: 'buy',
      aiAmount: ASTS.slipGross,
      netAmount: ASTS.net,
      feeTotal: 2.4,
      quantity: ASTS.quantity,
      pricePerUnit: ASTS.pricePerUnit,
    });

    expect(result.amount).toBe(1497.6);
    expect(result.source).toBe('slip_gross');
  });

  it('ฝั่งขาย: net = gross - fee (ได้รับน้อยลง) → สมการกลับเครื่องหมายถูกต้อง', () => {
    // ขายมูลค่า 1000 ค่าธรรมเนียม 5 → ได้รับจริง 995
    const result = resolveGrossAmount({
      side: 'sell',
      aiAmount: 1000,
      netAmount: 995,
      feeTotal: 5,
      quantity: 10,
      pricePerUnit: 100,
    });

    expect(result.amount).toBe(1000);
    expect(result.source).toBe('slip_gross');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REGRESSION — ช่องโหว่ BCPG ต้องยังปิดอยู่
// ═══════════════════════════════════════════════════════════════════════
// เคสจริง: AI หยิบ "ยอดสุทธิ" มาใส่ช่องมูลค่าหุ้น (Haiku หยิบ 68.89 แทน 69.00)
// เดิมกันด้วยการบังคับคำนวณเองเสมอ — ตอนนี้กันด้วยการตรวจสมการ ซึ่งแม่นกว่า
// เพราะรู้ค่าธรรมเนียมแล้วจึงแยกออกได้ว่าเลขไหนคืออะไร
describe('REGRESSION: AI หยิบยอดสุทธิมาใส่ช่องมูลค่าหุ้น (เคส BCPG)', () => {
  it('ASTS: AI ตอบ 1500.00 (ยอดจ่ายจริง) → ต้องไม่บันทึก 1500 ลง Ledger', () => {
    const result = resolveGrossAmount({
      side: 'buy',
      aiAmount: ASTS.net, // ← AI หยิบผิดช่อง
      netAmount: ASTS.net,
      feeTotal: 2.4,
      quantity: ASTS.quantity,
      pricePerUnit: ASTS.pricePerUnit,
    });

    expect(result.amount).not.toBe(1500);
    // net - fee = 1500.00 - 2.40 = 1497.60 (ตรงกับมูลค่าหุ้นจริงบนสลิป)
    expect(result.amount).toBe(1497.6);
    expect(result.source).toBe('derived_from_net');
    expect(result.reason).toBe('ai_returned_net_not_gross');
  });

  it('EOSE: AI ตอบ 106.72 (ยอดจ่ายจริง) → แก้กลับเป็น 106.45 ไม่ใช่ 106.72', () => {
    const result = resolveGrossAmount({
      side: 'buy',
      aiAmount: EOSE.net,
      netAmount: EOSE.net,
      feeTotal: 0.27,
      quantity: EOSE.quantity,
      pricePerUnit: EOSE.pricePerUnit,
    });

    expect(result.amount).not.toBe(106.72);
    expect(result.source).toBe('derived_from_net');
  });

  it('BCPG ต้นฉบับ: AI ตอบ 68.89 (สุทธิ) ค่าธรรมเนียม 0.11 → ได้ 69.00', () => {
    const result = resolveGrossAmount({
      side: 'sell',
      aiAmount: 68.89,
      netAmount: 68.89,
      feeTotal: 0.11,
      quantity: 10,
      pricePerUnit: 6.9,
    });

    expect(result.amount).toBe(69);
    expect(result.source).toBe('derived_from_net');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REGRESSION — เส้นทางเดิมต้องไม่ถดถอย (สลิปที่ไม่มีค่าธรรมเนียม)
// ═══════════════════════════════════════════════════════════════════════
describe('REGRESSION: สลิปไม่ระบุค่าธรรมเนียม → คำนวณเองเหมือนเดิมทุกประการ', () => {
  it('ไม่มี fee → ใช้ quantity × pricePerUnit (พฤติกรรมเดิม)', () => {
    const result = resolveGrossAmount({
      side: 'buy',
      aiAmount: 999, // AI ตอบอะไรมาก็ไม่เชื่อ เพราะตรวจสอบไม่ได้
      netAmount: 1000,
      feeTotal: null,
      quantity: 10,
      pricePerUnit: 100,
    });

    expect(result.amount).toBe(1000); // 10 × 100
    expect(result.source).toBe('computed');
    expect(result.reason).toBe('no_fee_or_net_to_verify');
  });

  it('ไม่มี net → ใช้ค่าคำนวณเหมือนเดิม', () => {
    const result = resolveGrossAmount({
      side: 'buy', aiAmount: 999, netAmount: null, feeTotal: 5,
      quantity: 10, pricePerUnit: 100,
    });

    expect(result.amount).toBe(1000);
    expect(result.source).toBe('computed');
  });

  it('สลิป Amount-only (ไม่มีจำนวน/ราคา) → Fallback ค่าที่ AI อ่านได้เหมือนเดิม', () => {
    const result = resolveGrossAmount({
      side: 'buy', aiAmount: 5000, netAmount: null, feeTotal: null,
      quantity: null, pricePerUnit: null,
    });

    expect(result.amount).toBe(5000);
    expect(result.source).toBe('ai_fallback');
  });

  it('ไม่มีข้อมูลเลย → null (ไม่เดา)', () => {
    const result = resolveGrossAmount({
      side: 'buy', aiAmount: null, netAmount: null, feeTotal: null,
      quantity: null, pricePerUnit: null,
    });

    expect(result.amount).toBeNull();
    expect(result.source).toBe('none');
  });
});

describe('เคสที่ตัวเลขไม่น่าเชื่อถือ → กลับไปใช้ค่าคำนวณ (ปลอดภัยที่สุด)', () => {
  it('aiAmount ไม่ตรงกับทั้ง net และ net-fee → ไม่เชื่อ ใช้ค่าคำนวณ', () => {
    const result = resolveGrossAmount({
      side: 'buy',
      aiAmount: 1234.56, // เลขมั่วคนละเรื่อง
      netAmount: 1500,
      feeTotal: 2.4,
      quantity: 20.0104114,
      pricePerUnit: 74.84,
    });

    expect(result.source).toBe('computed');
    expect(result.reason).toBe('ai_amount_inconsistent_with_net_and_fee');
  });

  // Guard: net/fee ที่อ่านมาผิดจนคำนวณย้อนแล้วห่างจากค่าคำนวณเกิน 2%
  it('net/fee เพี้ยนจนอนุมานแล้วห่างเกินเกณฑ์ → ใช้ค่าคำนวณแทน', () => {
    const result = resolveGrossAmount({
      side: 'buy',
      aiAmount: 5000, // = net (AI หยิบสุทธิ) แต่ net เพี้ยนไปไกลจากค่าคำนวณ
      netAmount: 5000,
      feeTotal: 10,
      quantity: 10,
      pricePerUnit: 100, // คำนวณได้ 1000 — ห่างจาก 4990 มาก
    });

    expect(result.amount).toBe(1000);
    expect(result.source).toBe('computed');
    expect(result.reason).toBe('ai_returned_net_derived_unreliable');
  });
});
