// ═══════════════════════════════════════════════════════════════════════
// dcaErrors — ตาราง Error Code → ข้อความไทย สำหรับกล่องบันทึก DCA บนเว็บ (S8 R1b)
// ═══════════════════════════════════════════════════════════════════════
// แยกจาก Logic อื่นตามที่ Requirement ระบุ ("ทำ mapping table ใน frontend
// (code → ข้อความไทย) แยกจาก logic อื่น จะได้ maintain ง่าย") — Error Code มาจาก
// docs/API.md §15.2/§15.3 (สัญญาจริงของ POST /transactions และ /undo-last)
//
// หมายเหตุ: Backend เองก็ส่ง `message` ภาษาไทยมาด้วยอยู่แล้ว (API.md §15 หัวข้อ
// Error Format) แต่ frontend/src/lib/api.js (apiPost เดิม) throw เป็น
// `new Error(body?.error)` ทิ้งแค่ Error Code — ไม่ได้ต่อ `message`/`details` ออกมา
// ด้วย (Behavior เดิมที่ Login/Admin/Dashboard เก่าพึ่งอยู่ ไม่แตะ) จึงต้องมีตาราง
// แปลของตัวเองที่นี่แทนการเปลี่ยน Contract ของ api.js

const TRANSACTION_ERROR_MESSAGES = {
  VALIDATION_ERROR: 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  SYMBOL_NOT_SUPPORTED: 'ระบบยังไม่รองรับสินทรัพย์นี้ กรุณาเลือกจากรายการสินทรัพย์ที่มีให้',
  PRICE_REQUIRED_FOR_ASSET:
    'สินทรัพย์นี้ยังไม่มีราคาตลาดอัตโนมัติ (เช่น หุ้นไทย) กรุณากรอก "ราคาต่อหน่วย" ที่ซื้อด้วย',
  CURRENCY_NOT_SUPPORTED_FOR_ASSET:
    'สินทรัพย์นี้บันทึกเป็นสกุล USD ไม่ได้ รองรับเฉพาะคริปโตและหุ้นสหรัฐ',
  DATE_IN_FUTURE: 'บันทึกรายการล่วงหน้าไม่ได้ กรุณาเลือกวันที่ไม่เกินวันนี้',
  AMOUNT_TOO_SMALL_FOR_PRICE:
    'จำนวนเงินน้อยเกินไปเมื่อเทียบกับราคาต่อหน่วย กรุณาเพิ่มจำนวนเงินหรือตรวจสอบราคาอีกครั้ง',
  NOTE_RESERVED_PREFIX: 'ข้อความในช่องรายละเอียดใช้ไม่ได้ กรุณาแก้ไขข้อความแล้วลองใหม่',
  ASSET_LIMIT_REACHED:
    'คุณใช้ครบ 2 สินทรัพย์ตามแพ็กเกจ Free แล้ว หากต้องการเพิ่มสินทรัพย์ใหม่ กรุณาอัพเกรดเป็น Premium',
  PRICE_FEED_NOT_IMPLEMENTED:
    'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หรือกรอกราคาต่อหน่วยเอง',
  MARKET_PRICE_UNAVAILABLE: 'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้งภายหลัง',
  GOLD_PRICE_UNAVAILABLE:
    'ดึงราคาทองคำปัจจุบันไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หรือกรอกราคาต่อหน่วยเอง',
  UNAUTHORIZED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

const UNDO_ERROR_MESSAGES = {
  NO_TRANSACTION_TO_UNDO: 'ไม่มีรายการให้ยกเลิก',
  ALREADY_UNDONE: 'รายการล่าสุดถูกยกเลิกไปแล้ว',
  CANNOT_UNDO_QUANTITY_MISMATCH:
    'ยกเลิกรายการนี้ไม่ได้ เพราะมีการขายเกิดขึ้นหลังจากนั้นแล้ว ทำให้ยอดคงเหลือไม่พอย้อนกลับ',
  UNAUTHORIZED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

// code ที่ไม่รู้จัก (ไม่อยู่ใน API.md §15) → Fallback เป็นข้อความกลางๆ เสมอ ไม่โชว์
// Error Code ดิบให้ผู้ใช้เห็นเด็ดขาด (ตรงตาม Requirement "ห้ามโชว์ error code ดิบ")
export function transactionErrorMessage(code) {
  return TRANSACTION_ERROR_MESSAGES[code] ?? TRANSACTION_ERROR_MESSAGES.INTERNAL_ERROR;
}

export function undoErrorMessage(code) {
  return UNDO_ERROR_MESSAGES[code] ?? UNDO_ERROR_MESSAGES.INTERNAL_ERROR;
}
