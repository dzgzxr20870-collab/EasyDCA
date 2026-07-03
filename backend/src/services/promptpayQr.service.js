// ═══════════════════════════════════════════════════════════════════════
// promptpayQr.service — ประกอบยอดชำระ + สร้าง PromptPay Payload (Pure ล้วน)
// ═══════════════════════════════════════════════════════════════════════
// ใช้ Library มาตรฐาน "promptpay-qr" (MIT ใช้กันแพร่หลาย) สร้าง Payload EMVCo
// พร้อม CRC16 ที่สแกน/โอนได้จริง — ปลอดภัยกว่าเขียน CRC เอง
//
// รอบนี้ (Foundation) มีแค่ 2 ฟังก์ชัน Pure: ประกอบยอด + สร้าง Payload
// ส่วน "ตัวจัดสรร satang tag" ที่ query ยอด pending จาก DB อยู่รอบถัดไป
// (คู่กับ payment.repository) — ที่นี่ไม่แตะ DB/Network เลย

const generatePayload = require('promptpay-qr');

// ประกอบยอดที่ต้องโอนจริง = baseAmount + satangTag/100 (ปัดทศนิยม 2 ตำแหน่งเป๊ะ)
// เช่น (59, 17) → 59.17 / (590, 5) → 590.05
// satangTag ต้องเป็นจำนวนเต็ม 1-99 (0 หรือ 100 ทำให้ยอดไม่มี tag / ทดข้ามหลัก) → throw
function composePaymentAmount(baseAmount, satangTag) {
  const base = Number(baseAmount);
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error(`Invalid baseAmount: ${baseAmount}`);
  }

  const satang = Number(satangTag);
  if (!Number.isInteger(satang) || satang < 1 || satang > 99) {
    throw new Error(`Invalid satangTag: ${satangTag} (expected integer 1-99)`);
  }

  // ปัด 2 ตำแหน่งผ่านจำนวนเต็มสตางค์ กัน Floating Point Noise
  // (เช่น 59 + 0.17 อาจได้ 59.16999999) — คูณ 100 แล้ว round แล้วหารกลับ
  return Math.round((base + satang / 100) * 100) / 100;
}

// สร้าง PromptPay Payload (string EMVCo) จาก promptpayId + ยอด
// promptpayId = เบอร์พร้อมเพย์/เลขบัตร ปชช./e-Wallet ID (ตามที่ Library รองรับ)
// throw ถ้า promptpayId ว่าง หรือ amount ไม่ใช่จำนวนบวก
function buildPromptPayPayload(promptpayId, amount) {
  if (promptpayId === null || promptpayId === undefined || String(promptpayId).trim() === '') {
    throw new Error('promptpayId is required');
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid amount: ${amount} (expected a positive number)`);
  }

  return generatePayload(String(promptpayId).trim(), { amount: value });
}

module.exports = {
  composePaymentAmount,
  buildPromptPayPayload,
};
