// ═══════════════════════════════════════════════════════════════════════════
// Transaction Type — แหล่งตัดสิน "ความหมายของ type" ที่เดียวของทั้งระบบ
// ═══════════════════════════════════════════════════════════════════════════
// Stage 6a ของ Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
// (ออกแบบไว้ที่ docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 2 + § 9)
//
// ── ปัญหาที่ไฟล์นี้เกิดมาเพื่อแก้ ──────────────────────────────────────────────
// โค้ดคำนวณเงินทั้งระบบเขียนบนสมมติฐานว่า type มีแค่ 2 ค่า จึงเขียนแบบ Binary
// (`buy` หรือ "ไม่ใช่ buy") ไม่ใช่ Enumerate ครบทุกค่า — วินาทีที่ `dividend`
// เข้า DB ได้ ทุกจุดจะ "ตีความ dividend เป็น sell ทันทีโดยไม่มี Error ใดๆ":
//
//   transaction.service.calculateHeldQuantity  → จำนวนที่ถือหายไปเท่ากับ qty ปันผล
//   portfolio.service.calculateTotalInvested   → ต้นทุนถูกตัดทิ้ง + realizedPnL เพี้ยน
//   flexMessage.util                           → LINE แสดงปันผลว่า "ขาย"
//   reportExport.service (PDF/Excel)           → Export ผิด
//   transactions.controller (ข้อความ Undo)     → ข้อความผิด
//
// ── วิธีแก้: เปลี่ยน Binary → Exhaustive switch ที่ `default: throw` ──────────
// ทำให้ type ใหม่ที่หลุดเข้ามาโดยยังไม่ได้ตั้งใจรองรับ **พังดังทันที** แทนที่จะ
// คำนวณเงินผิดเงียบๆ — สอดคล้องกฎ "ห้าม Silent Default" ใน ownership.util.js
//
// ⚠️ กฎเหล็กของไฟล์นี้: ห้ามเติม `default:` ที่คืนค่าอะไรก็ตามเด็ดขาด
//    ถ้ามี type ใหม่ ให้มาเพิ่ม `case` ที่นี่ทีเดียว แล้วทุกจุดในระบบจะรองรับ
//    พร้อมกันหมด — นี่คือเหตุผลที่รวมมาไว้ไฟล์เดียว ไม่ใช่ switch กระจาย 6 ที่
//    (switch กระจาย = วันหนึ่งจะมีคนเพิ่มครบ 5 ที่ ลืมที่ 6 แล้วไม่มีใครรู้)
//
// ⚠️ Stage 6a ต้องไม่เปลี่ยนพฤติกรรมแม้แต่นิดเดียว: วันนี้ CHECK ของ DB ยังรับแค่
//    ('buy','sell') เท่านั้น (dividend จะเปิดใน Stage 6b/migration ถัดไป) ดังนั้น
//    ผลลัพธ์ของทุกฟังก์ชันในไฟล์นี้สำหรับ buy/sell ต้องตรงกับโค้ด Binary เดิมเป๊ะ

class UnknownTransactionTypeError extends Error {
  constructor(type, context) {
    super(
      `${context}: ไม่รู้จัก transaction type '${type}' — ` +
        'ปฏิเสธการคำนวณแทนการเดา (ถ้าเพิ่ง Add type ใหม่เข้า DB CHECK ' +
        'ต้องมาเพิ่ม case ใน utils/transactionType.util.js ให้ครบทุกฟังก์ชันก่อน)'
    );
    this.name = 'UnknownTransactionTypeError';
    this.code = 'UNKNOWN_TRANSACTION_TYPE';
    this.type = type;
    this.context = context;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// รายชื่อ type ทั้งหมดที่ระบบ "รู้จัก" (ต้องตรงกับ CHECK ของ transactions.type)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ณ Stage 6a: DB ยังรับแค่ buy/sell — 2 ค่าล่างเตรียมไว้ให้โค้ดรองรับ "ก่อน"
// ที่ Migration จะเปิด CHECK จริง (ลำดับนี้บังคับโดย Design Doc § 2: Migration
// ที่ผ่อน CHECK ต้องเป็นตัวสุดท้าย และต้องมาหลังจากโค้ดรองรับครบแล้วเท่านั้น)
const TRANSACTION_TYPES = Object.freeze([
  'buy',
  'sell',
  'dividend',
  'dividend_reversal',
]);

// ═══════════════════════════════════════════════════════════════════════════
// heldQuantitySign — ผลต่อ "จำนวนที่ถือ" (Design Doc § 5.3)
// ═══════════════════════════════════════════════════════════════════════════
// ใช้แทน Pattern เดิม `tx.type === 'buy' ? sum + qty : sum - qty`
//
//   buy               +1  ซื้อเพิ่ม = ถือเพิ่ม
//   sell              -1  ขายออก   = ถือลด
//   dividend           0  ⭐ ปันผล "เงินสด" ไม่ทำให้ถือหุ้นเพิ่ม — นี่คือหัวใจ
//                         ของบั๊กที่ Design Doc § 2 เตือนไว้ ถ้าปล่อยให้ตกไปที่
//                         Branch "ไม่ใช่ buy" จำนวนที่ถือจะหายไปเท่ากับ quantity
//                         ของรายการปันผลทันทีโดยไม่มี Error
//                         (ปันผลเป็น "หุ้น" เป็นคนละเรื่อง — เลื่อนไปรอบหน้าตาม
//                          มติ Founder Q4.4 จะเป็น type ที่ 5 แยกต่างหาก)
//   dividend_reversal  0  หักล้างปันผล ก็ไม่แตะจำนวนที่ถือเช่นกัน (สมมาตรกัน)
function heldQuantitySign(type, context = 'heldQuantitySign') {
  switch (type) {
    case 'buy':
      return 1;
    case 'sell':
      return -1;
    case 'dividend':
    case 'dividend_reversal':
      return 0;
    default:
      throw new UnknownTransactionTypeError(type, context);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// costBasisRole — ผลต่อ "ต้นทุน / กำไรที่รับรู้แล้ว" (Design Doc § 5.3)
// ═══════════════════════════════════════════════════════════════════════════
// ใช้แทน Pattern เดิม `if (t.type === 'buy') {...} else { ...ตัด costBasis... }`
//
//   'increase_cost'    buy   → costBasis += amount, heldQty += qty
//   'realize_pnl'      sell  → ตัดต้นทุนตามสัดส่วนที่ขาย + รับรู้กำไร
//   'income'           dividend → ⭐ ไม่แตะ costBasis และไม่รวมใน realizedPnL
//                         ปันผลเป็น "รายได้" คนละก้อนกับกำไรจากส่วนต่างราคา
//                         (ตัดต้นทุนจะทำให้ ROI ของสินทรัพย์เพี้ยน)
//   'income_reversal'  dividend_reversal → หักยอดปันผลสะสมออก ไม่แตะต้นทุน
function costBasisRole(type, context = 'costBasisRole') {
  switch (type) {
    case 'buy':
      return 'increase_cost';
    case 'sell':
      return 'realize_pnl';
    case 'dividend':
      return 'income';
    case 'dividend_reversal':
      return 'income_reversal';
    default:
      throw new UnknownTransactionTypeError(type, context);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// dividendSign — ผลต่อยอด "เงินปันผลสะสม" (Design Doc § 5.2 ข้อ 6)
// ═══════════════════════════════════════════════════════════════════════════
// totalDividendThb = Σ(amount ที่ type='dividend') − Σ(amount ที่ 'dividend_reversal')
function dividendSign(type, context = 'dividendSign') {
  switch (type) {
    case 'buy':
    case 'sell':
      return 0;
    case 'dividend':
      return 1;
    case 'dividend_reversal':
      return -1;
    default:
      throw new UnknownTransactionTypeError(type, context);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// thaiLabel — ป้ายภาษาไทยของธุรกรรม (LINE / PDF / Excel / ข้อความ Undo)
// ═══════════════════════════════════════════════════════════════════════════
// ใช้แทน Pattern เดิม `tx.type === 'buy' ? 'ซื้อ' : 'ขาย'` ที่กระจายอยู่ 4 ไฟล์
//
// ⚠️ ค่าของ buy/sell ต้องเป็น 'ซื้อ'/'ขาย' เป๊ะตามเดิม — มีเทสต์เดิมหลายตัว
// assert ข้อความเหล่านี้ตรงๆ (เปลี่ยนคำ = เทสต์เดิมแดงทันที ซึ่งถูกต้องแล้ว
// เพราะข้อความที่ผู้ใช้เห็นไม่ควรเปลี่ยนโดยไม่ตั้งใจ)
function thaiLabel(type, context = 'thaiLabel') {
  switch (type) {
    case 'buy':
      return 'ซื้อ';
    case 'sell':
      return 'ขาย';
    case 'dividend':
      return 'ปันผล';
    case 'dividend_reversal':
      return 'ย้อนปันผล';
    default:
      throw new UnknownTransactionTypeError(type, context);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// directionTone — ใช้เลือก "สี/ไอคอน" ให้ตรงความหมาย (ไม่ใช่ตรรกะการเงิน)
// ═══════════════════════════════════════════════════════════════════════════
// แยกออกจาก thaiLabel เพราะ Caller แต่ละที่ใช้ชุดสีคนละระบบ (LINE COLOR.profit
// vs PDF_COLOR.profit) — ฟังก์ชันนี้ตอบแค่ "โทนบวกหรือลบ" แล้วให้ Caller
// Map เป็นสีของตัวเอง
//
//   buy               positive  (เงินออกไปเป็นสินทรัพย์ — เดิมใช้สีเขียว)
//   sell              negative  (เดิมใช้สีแดง)
//   dividend          positive  (รับเงินเข้า)
//   dividend_reversal negative  (หักล้างรายการที่รับไปแล้ว)
//
// ⚠️ buy=positive / sell=negative ตรงกับพฤติกรรมเดิมเป๊ะ (isBuy ? profit : loss)
function directionTone(type, context = 'directionTone') {
  switch (type) {
    case 'buy':
    case 'dividend':
      return 'positive';
    case 'sell':
    case 'dividend_reversal':
      return 'negative';
    default:
      throw new UnknownTransactionTypeError(type, context);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// reversalTypeFor — ชนิดของ "แถวหักล้าง" ตอน Undo (Design Doc § 5.2 ขั้น [3])
// ═══════════════════════════════════════════════════════════════════════════
// ใช้แทน Pattern เดิม `latest.type === 'buy' ? 'sell' : 'buy'`
// (undoTransaction.service.js) ซึ่งอันตรายมากถ้ามี type ที่ 3:
//
//   ⚠️ ถ้า dividend เข้ามาได้ การกด "ย้อนล่าสุด" บนรายการปันผลจะสร้างแถว **'buy'**
//      ขึ้นมาแทน — เพิ่มทั้งจำนวนที่ถือและต้นทุนให้ผู้ใช้จากอากาศ โดยไม่มี Error
//      นี่คือการทำ Ledger เพี้ยนที่ร้ายแรงที่สุดในบรรดาจุดที่ Design Doc § 2 ระบุ
//
// Immutable Ledger: การ Undo "ไม่เคยลบหรือแก้แถวเดิม" — สร้างแถวใหม่ที่หักล้างกัน
// เสมอ (AI_WORK_POLICY.md § 4.1) ฟังก์ชันนี้ตอบแค่ว่าแถวใหม่นั้นควรเป็น type อะไร
function reversalTypeFor(type, context = 'reversalTypeFor') {
  switch (type) {
    case 'buy':
      return 'sell';
    case 'sell':
      return 'buy';
    case 'dividend':
      // ไม่ใช้ 'sell' และไม่ใช้ amount ติดลบ — transactions.amount_thb มี CHECK
      // ว่าต้อง > 0 อยู่แล้ว การเปิดให้ติดลบเพื่อ dividend อย่างเดียวเท่ากับปิด
      // เกราะที่ป้องกันทั้งตารางอยู่ (Design Doc § 5.3)
      return 'dividend_reversal';
    case 'dividend_reversal':
      // ต้องถูกดักด้วย Double-Undo guard (isReversal/ALREADY_UNDONE) ก่อนถึงตรงนี้
      // เสมอ — ถ้ามาถึงได้แปลว่า Guard นั้นพัง ต้องดังทันที ห้ามย้อนของย้อนซ้อนกัน
      throw new UnknownTransactionTypeError(type, `${context} (ห้ามย้อนรายการหักล้างซ้ำ)`);
    default:
      throw new UnknownTransactionTypeError(type, context);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// isKnownType — ใช้ตรวจ Input จากภายนอกก่อนเข้าสูตร (ไม่ throw)
// ═══════════════════════════════════════════════════════════════════════════
// สำหรับจุดที่ต้องการ "ตอบ 400 ให้ผู้ใช้" แทนที่จะ throw 500 — เช่น Validation
// ของ Request Body ที่ผู้ใช้พิมพ์ type มาเอง
function isKnownType(type) {
  return TRANSACTION_TYPES.includes(type);
}

module.exports = {
  TRANSACTION_TYPES,
  UnknownTransactionTypeError,
  heldQuantitySign,
  costBasisRole,
  dividendSign,
  reversalTypeFor,
  thaiLabel,
  directionTone,
  isKnownType,
};
