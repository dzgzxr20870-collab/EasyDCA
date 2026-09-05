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

// โควตาอ่านสลิปด้วย AI ของสมาชิก Premium (ครั้ง/เดือน) — ⚠️ ต้องตรงกับ MONTHLY_QUOTA
// ใน backend/src/services/slipOcr.service.js เสมอ (Frontend คนละ Deploy กับ Backend
// เลย import ค่าจริงข้ามมาไม่ได้ — ตั้งเป็นค่าคงที่ตัวเดียวไว้ที่นี่แทนการพิมพ์เลข 50
// ลอยๆ ในข้อความ ถ้าปรับโควตาฝั่ง Backend ต้องแก้ค่านี้ตามด้วย มีเทสต์คู่กันคอย
// เตือนไม่ให้กลับไปพิมพ์ "ไม่จำกัด" ซึ่งเป็นข้อความเท็จ — Premium มีเพดานจริง)
export const PREMIUM_OCR_MONTHLY_QUOTA = 50;

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
  // ⭐ ครอบ 2 สถานการณ์ด้วยข้อความเดียว (มติ Founder 5 ก.ย. 2569) — "ถือครบ 2 ตัว
  // แล้วเพิ่มตัวใหม่ไม่ได้" และ "ตัวนี้ไม่ใช่ 1 ใน 2 ตัวแรกที่ยังซื้อเพิ่มได้" (ผู้ใช้
  // ที่เคยเป็น Premium แล้วดาวน์เกรด) — ต้องตรงกับฝั่ง Backend ทั้งสองช่องทางเป๊ะ
  // (transactions.controller.WEB_ERROR_MESSAGES + flexMessage.util ของ LINE)
  ASSET_LIMIT_REACHED:
    'แพ็กเกจ Free ซื้อเพิ่มได้เฉพาะ 2 สินทรัพย์แรกที่คุณเคยบันทึกไว้เท่านั้น — สินทรัพย์อื่นยังเปิดดูย้อนหลัง บันทึกการขาย และย้ายพอร์ตได้ตามปกติ ข้อมูลเดิมอยู่ครบทุกรายการ ไม่มีอะไรถูกลบ · อัพเกรดเป็น Premium เพื่อซื้อเพิ่มได้ทุกสินทรัพย์ไม่จำกัด',
  // หุ้นสหรัฐดึงราคาผ่าน Twelve Data ได้ทั้ง THB (ต้องยิง 2 Request: ราคาหุ้น + เรต
  // FX) และ USD (ยิง 1 Request ตรงๆ จึงเสถียรกว่าเมื่อโดน Rate Limit 8 Credit/นาที)
  PRICE_FEED_NOT_IMPLEMENTED:
    'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ (หุ้นสหรัฐ: สลับเป็นสกุล USD จะดึงราคาได้เสถียรกว่า) กรุณาลองใหม่ภายหลัง หรือกรอกราคาต่อหน่วยเอง',
  MARKET_PRICE_UNAVAILABLE: 'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้งภายหลัง',
  // ── ฝั่งขาย (side='sell') ────────────────────────────────────────────────
  // Code ชุดนี้มาจาก transaction.service.validateSell ผ่าน transactions.controller
  // (ดู API.md §15.2) — ต้องมีข้อความไทยของตัวเอง ไม่งั้นผู้ใช้จะเห็นข้อความ Fallback
  // "เกิดข้อผิดพลาดภายในระบบ" ทั้งที่เป็นเรื่องที่แก้เองได้
  ASSET_NOT_FOUND: 'คุณยังไม่มีสินทรัพย์นี้ในพอร์ต จึงบันทึกการขายไม่ได้',
  NOTHING_TO_SELL: 'สินทรัพย์นี้ขายออกไปหมดแล้ว ไม่มียอดคงเหลือให้ขาย',
  INSUFFICIENT_QUANTITY: 'ขายเกินจำนวนที่ถืออยู่จริง กรุณารีเฟรชหน้าเพื่อดูยอดล่าสุดแล้วลองใหม่',
  SELL_PRICE_REQUIRED: 'กรุณากรอก "ราคาที่ขายได้ต่อหน่วย" หรือกดปุ่ม "ขายทั้งหมด" เพื่อใช้ราคาตลาด',
  GOLD_PRICE_UNAVAILABLE:
    'ดึงราคาทองคำปัจจุบันไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หรือกรอกราคาต่อหน่วยเอง',
  UNAUTHORIZED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

// แนบสลิปหลักฐาน (Premium) — Error Code จาก POST /transactions/:id/slip
// (transactions.controller WEB_ERROR_MESSAGES) แยกตารางเพราะเป็นคนละ Endpoint/ชุด code
const SLIP_UPLOAD_ERROR_MESSAGES = {
  TRANSACTION_SLIP_PREMIUM_REQUIRED:
    'การแนบสลิปเป็นหลักฐานใช้ได้เฉพาะสมาชิก Premium',
  TRANSACTION_NOT_FOUND: 'ไม่พบรายการที่ต้องการแนบสลิป',
  SLIP_ALREADY_ATTACHED: 'รายการนี้มีสลิปแนบอยู่แล้ว ไม่สามารถแนบทับได้',
  CANNOT_ATTACH_TO_REVERSAL: 'แนบสลิปให้รายการย้อนไม่ได้',
  INVALID_SLIP_CONTENT_TYPE: 'ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น',
  SLIP_TOO_LARGE: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)',
  EMPTY_BODY: 'ไม่พบไฟล์รูป กรุณาเลือกรูปสลิปใหม่',
  UNAUTHORIZED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  INTERNAL_ERROR: 'แนบรูปสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
};

// AI อ่านสลิปบนเว็บ — Error Code จาก POST /transactions/slip-ocr
// (transactions.controller WEB_ERROR_MESSAGES ชุด OCR_*) แยกตารางเพราะเป็นคนละ
// Endpoint/ชุด code กับการแนบสลิปหลักฐานด้านบน
//
// ⚠️ ข้อความต้องบอกให้ชัดว่า "ครั้งนี้ถูกนับโควตาไหม" ในเคสที่อ่านไม่สำเร็จ —
// ผู้ใช้ที่จ่ายเงินค่า Premium ต้องไม่รู้สึกว่าโควตาหายไปกับรูปที่ระบบอ่านไม่ออก
// (ตรงกับที่ฝั่ง LINE สื่อไว้ใน flexMessage.OCR_ERROR ทุกประการ)
const SLIP_OCR_ERROR_MESSAGES = {
  OCR_PREMIUM_REQUIRED:
    'อ่านสลิปด้วย AI เป็นฟีเจอร์สำหรับสมาชิก Premium — อัพเกรดเพื่อให้ระบบอ่านสลิปและกรอกรายการให้อัตโนมัติ',
  // ⚠️ ห้ามเขียนว่า Premium "ไม่จำกัด" — โควตาจริงคือ PREMIUM_OCR_MONTHLY_QUOTA
  // ครั้ง/เดือน คนจ่ายเงินแล้วเจอเพดานจะรู้สึกถูกหลอก
  OCR_TRIAL_EXHAUSTED:
    `คุณใช้สิทธิ์ทดลองอ่านสลิปด้วย AI ครบแล้ว — อัพเกรดเป็น Premium เพื่ออ่านสลิปด้วย AI ได้ต่อ (สูงสุด ${PREMIUM_OCR_MONTHLY_QUOTA} ครั้ง/เดือน)`,
  OCR_QUOTA_EXCEEDED: 'ใช้โควตาอ่านสลิปด้วย AI ของเดือนนี้ครบแล้ว กรุณารอรอบเดือนถัดไป',
  OCR_CALL_LIMIT_EXCEEDED:
    'ระบบอ่านสลิปถูกใช้งานเกินเพดานของเดือนนี้แล้ว กรุณาลองใหม่ในรอบเดือนถัดไป หรือกรอกรายการเอง',
  OCR_RATE_LIMITED: 'คุณส่งรูปถี่เกินไป กรุณารอสักครู่ (ประมาณ 10 วินาที) แล้วลองใหม่',
  OCR_NOT_A_SLIP:
    'อ่านรูปนี้เป็นสลิปซื้อ/ขายสินทรัพย์ไม่ได้ กรุณาส่งรูปที่เห็นชื่อสินทรัพย์และตัวเลขชัดเจน (ครั้งนี้ไม่ถูกนับโควตา)',
  OCR_MULTIPLE_ITEMS:
    'รูปนี้มีหลายรายการ ระบบยังไม่รองรับการอ่านหลายรายการต่อรูป กรุณาส่งสลิปทีละรายการ (ครั้งนี้ไม่ถูกนับโควตา)',
  OCR_FAILED: 'อ่านสลิปไม่สำเร็จในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือกรอกรายการเอง (ไม่ถูกนับโควตา)',
  OCR_NOT_CONFIGURED: 'ระบบอ่านสลิปด้วย AI ยังไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลัง',
  INVALID_SLIP_CONTENT_TYPE: 'ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น',
  SLIP_TOO_LARGE: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)',
  EMPTY_BODY: 'ไม่พบไฟล์รูป กรุณาเลือกรูปสลิปใหม่',
  UNAUTHORIZED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  INTERNAL_ERROR: 'อ่านสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
};

// Error ที่ควรโชว์ปุ่ม "อัพเกรด Premium" คู่กับข้อความ (ไม่ใช่ทุก Error — เช่น
// รูปเบลอ/ส่งถี่เกินไป ผู้ใช้แก้เองได้ ไม่ควรถูกขายของ)
const SLIP_OCR_UPGRADE_CODES = new Set(['OCR_PREMIUM_REQUIRED', 'OCR_TRIAL_EXHAUSTED']);

export function slipOcrErrorMessage(code) {
  return SLIP_OCR_ERROR_MESSAGES[code] ?? SLIP_OCR_ERROR_MESSAGES.INTERNAL_ERROR;
}

export function isSlipOcrUpgradeError(code) {
  return SLIP_OCR_UPGRADE_CODES.has(code);
}

// ⚠️ ใช้คำว่า "ยกเลิก" ตลอดตารางนี้ (พรอมต์รวมคำ 30 ส.ค. 2569 — Founder ต้องการ
// คำเดียวที่เรียกฟีเจอร์นี้ทั้งเว็บ/LINE คือ "ยกเลิกรายการล่าสุด") — กลับคำจาก
// fix/misleading-messages เดิมที่ใช้ "ย้อน" เพราะกลัวชนกับ "ยกเลิก" ของ Pending
// ที่ยังไม่เคยบันทึก (transactionErrorMessage ด้านบน) แต่คำว่า "ล่าสุด"/"รายการนี้"
// ที่ต่อท้ายทุกข้อความในกลุ่มนี้เป็นตัวแยกบริบทอยู่แล้ว ไม่จำเป็นต้องใช้คนละคำ
const UNDO_ERROR_MESSAGES = {
  NO_TRANSACTION_TO_UNDO: 'ไม่มีรายการให้ยกเลิก',
  ALREADY_UNDONE: 'รายการล่าสุดถูกยกเลิกไปแล้ว',
  CANNOT_UNDO_QUANTITY_MISMATCH:
    'ยกเลิกรายการนี้ไม่ได้ เพราะมีการขายเกิดขึ้นหลังจากนั้นแล้ว ทำให้ยอดคงเหลือไม่พอให้ยกเลิก',
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

export function slipUploadErrorMessage(code) {
  return SLIP_UPLOAD_ERROR_MESSAGES[code] ?? SLIP_UPLOAD_ERROR_MESSAGES.INTERNAL_ERROR;
}
