// ═══════════════════════════════════════════════════════════════════════
// slipOcrPrefill — ตัดสินว่า "ผลอ่านสลิปจาก AI ควรเติมอะไรลงฟอร์มบ้าง"
// ═══════════════════════════════════════════════════════════════════════
// แยกออกจาก DcaForm.jsx เป็น Pure Function เพื่อให้ทดสอบตรรกะนี้ได้โดยไม่ต้อง Render
// React (Pattern เดียวกับ lib/sellForm.js / lib/dcaPlanPrefill.js) — ตรรกะนี้กระทบ
// ตัวเลขที่จะกลายเป็น Ledger จึงต้องมี Test คลุมทุกกิ่งอย่างชัดเจน
//
// ═══════════════════════════════════════════════════════════════════════
// ⚠️ กฎเหล็กของไฟล์นี้: ห้าม Default ทิศทางเป็น 'buy' เมื่ออ่าน side ไม่ได้
// ═══════════════════════════════════════════════════════════════════════
// บทเรียนเคส BCPG (ดู slipOcr.service.resolveSide): สลิปที่เขียน "ขาย BCPG" ชัดเจน
// เคยถูกบันทึกเป็น "ซื้อ" เพราะโค้ดเขียน `side === 'sell' ? 'sell' : 'buy'` ซึ่ง
// Default เป็น buy เงียบๆ ทุกกรณีที่ไม่ตรงเป๊ะ → P&L และจำนวนหน่วยถือครองกลับด้าน
// และเป็น Immutable Ledger ที่แก้ทีหลังต้องใช้ Reversal เท่านั้น
//
// Backend แก้แล้วด้วย resolveSide (คืน null เมื่อสัญญาณขัดกัน/ไม่ชัด) และฝั่ง LINE
// ก็เข้มแล้ว (webhook.controller case 'ocr_confirm' ตอบ buildOcrSideRequiredMessage
// แทนการเดา) — ไฟล์นี้คือการทำให้ "ฝั่งเว็บเข้มเท่ากัน" เพราะทั้งสองช่องทางลงตาราง
// transactions เดียวกัน จะมีมาตรฐานคนละแบบไม่ได้
//
// เมื่อ side ไม่ชัด: ไม่สลับโหมดให้ (ทั้ง buy และ sell) และไม่เติมตัวเลขใดๆ ที่
// ความหมายขึ้นกับทิศทาง — ช่อง "จำนวนเงิน" ของโหมดซื้อ กับ "จำนวนหน่วย" ของโหมดขาย
// เป็นคนละความหมายกันสิ้นเชิง เติมผิดโหมด = กรอกข้อมูลผิดให้ผู้ใช้แล้วรอให้กดบันทึก

// แปลงเป็น String สำหรับ <input> — รับเฉพาะตัวเลขบวกจริงเท่านั้น
// (คงพฤติกรรมเดิมของ DcaForm ที่ใช้ `if (slip.quantity)` = 0/ติดลบ/NaN ไม่เติม)
function inputValueOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? String(value) : null;
}

// buildOcrPrefill(slip) → { side, sideUnresolved, date, currency, amountInput,
//                           pricePerUnit, sellQuantity, sellPrice }
//
// ทุก Field ที่เป็น null = "อย่าแตะช่องนั้น" (ผู้เรียกต้องไม่เรียก setter ของมัน)
//   side           : 'buy' | 'sell' | null — null = ห้ามสลับโหมดให้ผู้ใช้เด็ดขาด
//   sideUnresolved : true = ต้องเตือน + ไฮไลต์ปุ่มซื้อ/ขายให้ผู้ใช้เลือกเอง
//
// ค่าที่ "ไม่ขึ้นกับทิศทาง" (date) ยังเติมได้เสมอแม้ side ไม่ชัด — ปลอดภัยทั้งสองโหมด
// และช่วยไม่ให้ผู้ใช้ต้องกรอกใหม่ทั้งหมด (สินทรัพย์ที่เลือกก็เช่นกัน แต่ผู้เรียก
// จัดการเองเพราะต้อง Match กับ Registry ก่อน — ดู DcaForm.handleScanSlip)
export function buildOcrPrefill(slip) {
  const base = {
    side: null,
    sideUnresolved: true,
    date: typeof slip?.date === 'string' && slip.date ? slip.date : null,
    currency: null,
    amountInput: null,
    pricePerUnit: null,
    sellQuantity: null,
    sellPrice: null,
    // โหมดซื้อ: จำนวนหน่วย + ราคาที่ได้จริงจากสลิป (มีค่าเมื่อสลิประบุครบทั้งคู่)
    // ⚠️ นี่คือค่าที่ "จะถูกบันทึกลง Ledger จริง" แทนการเอายอดเงินไปหารด้วยราคาตลาด
    // ณ ตอนกดบันทึก — ดูเหตุผลเต็มใน § "ทำไมต้องใช้ตัวเลขจากสลิป" ท้ายไฟล์
    buyQuantity: null,
    buyPricePerUnit: null,
    // ค่าธรรมเนียมจากสลิป (Migration 041) — null = สลิปไม่ระบุ ไม่ใช่ "ไม่มี"
    // ไม่ขึ้นกับทิศทาง จึงเติมได้เสมอแม้ side ไม่ชัด (เหมือน date)
    feeTotal: inputValueOrNull(slip?.feeTotal),
    // ยอดสุทธิที่จ่าย/รับจริงตามสลิป — ใช้แสดงผลอย่างเดียว ไม่ถูกบันทึกลง Ledger
    netAmount: inputValueOrNull(slip?.netAmount),
    // ── มูลค่าหุ้นที่ "พิสูจน์แล้วว่าเป็นเลขบนสลิปจริง" (บั๊ค B) ─────────────
    // มีค่าเฉพาะเมื่อ Backend ตอบ amountSource === 'slip_gross' เท่านั้น = ผ่านการ
    // ตรวจด้วยสมการค่าธรรมเนียมมาแล้ว (ดู slipOcr.service.resolveGrossAmount)
    //
    // ทำไมต้องพกมา: ราคาต่อหน่วยบนสลิปถูกปัดมาแสดง (EOSE จริง 4.2548 แสดง 4.25)
    // ฟอร์มที่คำนวณ quantity × price เองจึงได้ 106.32 ไม่ใช่ 106.44 ที่สลิประบุ
    //
    // 'computed' → null โดยตั้งใจ: Backend ก็คำนวณเองอยู่แล้ว ปล่อยให้ฟอร์มคำนวณ
    // ต่อไปตรงไปตรงมากว่า (ผลลัพธ์เท่ากัน และยังอัปเดตตามที่ผู้ใช้แก้ช่องได้ทันที)
    slipGrossAmount:
      slip?.amountSource === 'slip_gross' ? inputValueOrNull(slip?.amountTotal) : null,
  };

  // ── ทิศทางชัดเจน: Prefill ครบเหมือนเดิมทุกประการ (คุณค่าหลักของฟีเจอร์) ──
  if (slip?.side === 'sell') {
    return {
      ...base,
      side: 'sell',
      sideUnresolved: false,
      // โหมดขายกรอกเป็น "จำนวนหน่วย" + "ราคาที่ขายได้ต่อหน่วย"
      sellQuantity: inputValueOrNull(slip.quantity),
      sellPrice: inputValueOrNull(slip.pricePerUnit),
    };
  }

  if (slip?.side === 'buy') {
    const buyQuantity = inputValueOrNull(slip.quantity);
    const buyPricePerUnit = inputValueOrNull(slip.pricePerUnit);
    // สลิประบุครบทั้งจำนวนหน่วยและราคา = รู้ "สิ่งที่เกิดขึ้นจริง" แล้ว ไม่ต้องประมาณ
    const hasExactNumbers = buyQuantity !== null && buyPricePerUnit !== null;

    return {
      ...base,
      side: 'buy',
      sideUnresolved: false,
      currency: slip.currency === 'USD' ? 'USD' : null,
      // ⚠️ ยอดเงินยังเติมให้เสมอเพื่อให้ผู้ใช้เห็นภาพรวม แต่เมื่อมีตัวเลขครบ ค่าที่
      // "ถูกบันทึกจริง" คือ buyQuantity × buyPricePerUnit ไม่ใช่ยอดนี้ (ดู DcaForm)
      amountInput: inputValueOrNull(slip.amountTotal),
      // หุ้นไทยไม่มี Price Feed ต้องกรอกราคาต่อหน่วยเอง — เติมช่องเดิมไว้เฉพาะตอน
      // ที่ "ไม่มีตัวเลขครบ" เท่านั้น กันสองช่องราคาโชว์ค่าเดียวกันซ้ำซ้อนบนหน้าจอ
      pricePerUnit: hasExactNumbers ? null : buyPricePerUnit,
      buyQuantity: hasExactNumbers ? buyQuantity : null,
      buyPricePerUnit: hasExactNumbers ? buyPricePerUnit : null,
    };
  }

  // ── ทิศทางไม่ชัด (null / undefined / ค่าที่ไม่รู้จัก เช่น 'Sell' 'ซื้อ' 'unknown') ──
  // คืน base ล้วน: ไม่มี side, ไม่มีตัวเลขที่ผูกกับทิศทางเลยสักช่อง
  return base;
}
