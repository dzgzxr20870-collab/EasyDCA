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
    return {
      ...base,
      side: 'buy',
      sideUnresolved: false,
      // โหมดซื้อกรอกเป็น "จำนวนเงินรวม" (ไม่ใช่จำนวนหน่วย)
      currency: slip.currency === 'USD' ? 'USD' : null,
      amountInput: inputValueOrNull(slip.amountTotal),
      // หุ้นไทยไม่มี Price Feed ต้องกรอกราคาต่อหน่วยเอง — เติมให้ถ้าสลิปมี
      pricePerUnit: inputValueOrNull(slip.pricePerUnit),
    };
  }

  // ── ทิศทางไม่ชัด (null / undefined / ค่าที่ไม่รู้จัก เช่น 'Sell' 'ซื้อ' 'unknown') ──
  // คืน base ล้วน: ไม่มี side, ไม่มีตัวเลขที่ผูกกับทิศทางเลยสักช่อง
  return base;
}
