const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const { calculateHeldQuantity, todayInBangkok } = require('./transaction.service');

// Marker ที่เก็บใน transactions.note เพื่อ Trace ว่ารายการนี้เป็น Reversal ของ
// รายการใด — ตาม DATABASE.md § 8: transactions เป็น Immutable, "ยกเลิกรายการ"
// ทำโดยสร้าง Transaction ตรงข้าม (ไม่ลบ/แก้ของเดิม) ใช้ note ที่มีอยู่แล้วแทน
// การเพิ่ม Column ใหม่ (ไม่ต้อง Migration) เพราะเป็นแค่ Metadata สำหรับ Trace
const UNDO_MARKER = 'UNDO_OF';

// Error ที่มี code (Pattern เดียวกับ TransactionServiceError/ProfitServiceError —
// API.md § 5) เพื่อให้ Controller (Webhook) Map เป็นข้อความไทยได้ ไม่ปล่อย Error
// ดิบถึง Client
class UndoTransactionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'UndoTransactionError';
    this.code = code;
    this.details = details;
  }
}

function buildReversalNote(originalTransactionId) {
  return `${UNDO_MARKER}:${originalTransactionId}`;
}

// รายการที่เกิดจากการกด "ยกเลิกล่าสุด" จะมี note ขึ้นต้นด้วย Marker เสมอ —
// ใช้ตรวจว่ารายการล่าสุดเป็น Reversal อยู่แล้วหรือไม่ (กัน Double-Undo)
function isReversal(transaction) {
  return typeof transaction.note === 'string' && transaction.note.startsWith(`${UNDO_MARKER}:`);
}

// ดึง "id ของรายการต้นฉบับ" ออกจาก note ของแถว Reversal — คืน null ถ้าไม่ใช่ Reversal
//
// ⚠️ ต้องตัดที่ช่องว่างแรก ไม่ใช่เอาทุกอย่างหลัง 'UNDO_OF:' ทั้งท่อน เพราะ note รองรับ
// การต่อท้ายเหตุผลไว้ให้คนอ่าน เช่น 'UNDO_OF:<id> (test data cleanup)' ถ้าเอาทั้งท่อน
// id ที่ได้จะกลายเป็น "<id> (test data cleanup)" ซึ่งไม่ตรงกับ transactions.id ของจริง
// ทำให้ excludeUndoneTransactions กันรายการต้นฉบับออกจากสถิติไม่ได้ (นับ DCA เกินจริง)
// และ Double-Undo guard ก็ตรวจไม่เจอว่าย้อนไปแล้ว
function parseReversedId(note) {
  if (typeof note !== 'string' || !note.startsWith(`${UNDO_MARKER}:`)) return null;
  const rest = note.slice(`${UNDO_MARKER}:`.length).trim();
  const [id] = rest.split(/\s/);
  return id || null;
}

// คืนเฉพาะรายการที่ "ยังมีผลอยู่จริง" — ตัดทั้งคู่ของการยกเลิกออก:
//  - แถว Reversal เอง (note = 'UNDO_OF:<id>')
//  - แถวต้นฉบับที่ถูกย้อน (id ตรงกับที่ Reversal อ้างถึง)
//
// ใช้สำหรับ "สถิติการบันทึก" (จำนวนครั้ง DCA / ยอดรวม / Streak / กราฟรายเดือน) ที่
// การบันทึกแล้วกดยกเลิกไม่ควรถูกนับ — ถ้านับแต่แถว buy โดยไม่ตัด จะได้จำนวนครั้ง/
// ยอดเงินเกินจริง (ทั้งที่ทั้งคู่หักล้างกันหมดแล้วในเชิงยอดคงเหลือ/ต้นทุน)
//
// อยู่ที่ไฟล์นี้เพราะเป็น "นิยามของการยกเลิก" (คู่กับ UNDO_MARKER/isReversal) —
// Consumer ทุกตัว (Web Controller / Dashboard Stats) Import จากที่เดียว ไม่ Hardcode
// รูปแบบ note ซ้ำ
//
// ⚠️ ไม่กระทบสูตรเงินใดๆ: portfolio.service/profit.service ยังคง Replay ธุรกรรม
// "ทุกแถวรวม Reversal" ตามเดิมทุกประการ (Reversal คือแถวจริงใน Ledger ที่ต้องนับ
// เพื่อให้ยอดคงเหลือ/ต้นทุนกลับไปเท่าก่อนบันทึก) — ฟังก์ชันนี้ใช้กับ "สถิติการนับ"
// เท่านั้น ห้ามนำไปกรองก่อนคำนวณต้นทุน/กำไร
function excludeUndoneTransactions(transactions) {
  const reversedIds = new Set();
  for (const tx of transactions) {
    const reversedId = parseReversedId(tx.note);
    if (reversedId) reversedIds.add(reversedId);
  }

  return transactions.filter((tx) => !isReversal(tx) && !reversedIds.has(tx.id));
}

// ยกเลิก (ย้อนกลับ) Transaction ล่าสุดของ User ด้วย Reversal Pattern
// (DATABASE.md § 8 — Immutable Ledger) โดยไม่ลบ/แก้ไขรายการเดิมเด็ดขาด
//
// options.source = ช่องทางที่กดยกเลิก ('line'|'web') — Default 'line' ทำให้ Caller
// เดิม (Webhook LINE) ได้พฤติกรรมเท่าเดิมทุกประการ ส่วนเว็บ (S8 R1a) ส่ง 'web' เข้ามา
// Semantics การยกเลิกอื่นๆ เหมือนกันทุกประการทั้งสองช่องทาง (ย้อนได้เฉพาะรายการล่าสุด)
//
// อาจ throw: NO_TRANSACTION_TO_UNDO / ALREADY_UNDONE / CANNOT_UNDO_QUANTITY_MISMATCH
async function undoLastTransaction(userId, options = {}) {
  const [latest] = await transactionRepository.findRecentByUser(userId, 1);

  // ไม่มีธุรกรรมเลย — ไม่มีอะไรให้ย้อน
  if (!latest) {
    throw new UndoTransactionError(
      'NO_TRANSACTION_TO_UNDO',
      'No transaction available to undo for this user',
      { userId }
    );
  }

  // Double-Undo guard ชั้นที่ 1: รายการล่าสุด "เป็น Reversal เอง" — แปลว่าเพิ่ง
  // กดยกเลิกไปแล้ว การกดซ้ำจะกลายเป็นย้อน Reversal (= ทำรายการเดิมใหม่) ต้องบล็อก
  if (isReversal(latest)) {
    throw new UndoTransactionError(
      'ALREADY_UNDONE',
      'The most recent transaction is already a reversal; nothing to undo',
      { transactionId: latest.id }
    );
  }

  // ดึงประวัติทั้ง Asset ครั้งเดียว ใช้ทั้ง (ก) เช็คว่ารายการล่าสุดถูกย้อนไปแล้ว
  // หรือยัง และ (ข) คำนวณยอดคงเหลือกันติดลบ
  const history = await transactionRepository.findAllByAsset(latest.assetId, userId);

  // Double-Undo guard ชั้นที่ 2: มี Reversal ของรายการล่าสุดอยู่แล้วในประวัติ —
  // ครอบคลุมกรณีที่ findRecentByUser เรียงตาม date (รายวัน) แล้วรายการเดิมกับ
  // Reversal มี date เดียวกัน จน Reversal ไม่ได้ถูกคืนมาเป็นตัวแรก (Tie ordering)
  // เทียบด้วย parseReversedId ไม่ใช่ note === buildReversalNote(...) ตรงตัว เพื่อให้
  // Reversal ที่มีเหตุผลต่อท้าย note ('UNDO_OF:<id> (test data cleanup)') ถูกตรวจเจอด้วย
  const alreadyReversed = history.some((tx) => parseReversedId(tx.note) === latest.id);
  if (alreadyReversed) {
    throw new UndoTransactionError(
      'ALREADY_UNDONE',
      'The most recent transaction has already been undone',
      { transactionId: latest.id }
    );
  }

  const reversalType = latest.type === 'buy' ? 'sell' : 'buy';

  // เฉพาะ Reversal ฝั่ง sell (ย้อน buy) เท่านั้นที่ลดยอดคงเหลือจนอาจติดลบ
  // Edge Case: รายการล่าสุดเป็น buy แต่มี sell วัน/รอบเดียวกันเกิดตามหลัง ทำให้
  // ยอดคงเหลือปัจจุบันน้อยกว่าจำนวนที่ซื้อไว้ — ย้อนไม่ได้ ต้อง throw ชัดเจน
  if (reversalType === 'sell') {
    const heldQuantity = calculateHeldQuantity(history);
    if (Number(latest.quantity) > heldQuantity) {
      throw new UndoTransactionError(
        'CANNOT_UNDO_QUANTITY_MISMATCH',
        'Cannot undo this buy because the current holding is lower than the purchased quantity',
        { requested: Number(latest.quantity), held: heldQuantity }
      );
    }
  }

  // สร้าง Transaction ตรงข้าม: quantity/pricePerUnit/amountThb เท่าเดิมทุกประการ
  // เพื่อให้ calculateHeldQuantity/calculateTotalInvested กลับไปเท่าก่อนรายการเดิม
  // ตั้ง fee_thb = 0 (ไม่คิดค่าธรรมเนียมซ้ำจากการย้อน — fee ไม่ถูกใช้ในสูตร
  // ยอดคงเหลือ/เงินลงทุนอยู่แล้ว จึงไม่กระทบความถูกต้อง) date = วันนี้ตาม
  // Asia/Bangkok เพื่อให้ Reversal เป็นรายการล่าสุด (สอดคล้อง Double-Undo guard)
  let reversal;
  try {
    reversal = await transactionRepository.create({
    userId,
    assetId: latest.assetId,
    type: reversalType,
    amountThb: latest.amountThb,
    pricePerUnit: latest.pricePerUnit,
    quantity: latest.quantity,
    // Multi-Currency (Round 10) — สกุลต้องตรงกับรายการต้นฉบับเสมอ
    //
    // เดิมไม่ได้ส่ง Field นี้ → Repository เติม DEFAULT 'THB' (migration 012) ทำให้การ
    // ย้อนรายการ USD ได้แถว Reversal ที่ "บอกสกุลผิด" (amount_thb เก็บ 50 แต่ติดป้าย
    // THB ทั้งที่เป็น 50 USD) — ยอดคงเหลือ/ต้นทุนไม่เพี้ยนเพราะ calculateHeldQuantity
    // และ calculateTotalInvested ไม่ได้อ่าน currency (บวก/ลบ amount_thb ตรงๆ ซึ่งหักล้าง
    // กันพอดีอยู่แล้ว) แต่ทุกจุดที่ "แสดงสกุล" ตามแถวจริงจะโชว์ผิด (รายการล่าสุดบน
    // Dashboard / GET /dashboard/history / Export รายงาน)
    //
    // latest.currency มาจาก transaction.repository.toTransaction ที่ Default 'THB'
    // ให้แถวเก่าอยู่แล้ว → รายการ THB ทั้งหมดได้ค่า 'THB' เท่าเดิมทุกประการ (ไม่มีผล
    // ต่อ Path เดิม) ต่างเฉพาะรายการ USD ที่เดิมติดป้ายผิดเท่านั้น
    currency: latest.currency,
    feeThb: 0,
    date: todayInBangkok(),
    note: buildReversalNote(latest.id),
    source: options.source ?? 'line',
    });
  } catch (err) {
    // ── ด่านจริงของ "ย้อนแล้วยอดติดลบ" อยู่ที่ DB (migration 034) ──────────────
    // Guard ด้านบน (heldQuantity เทียบ latest.quantity) เป็น Pre-check ที่ไม่ Atomic
    // เหมือนกับฝั่ง processSellCommand — ถ้ามีคำสั่งขายแทรกเข้ามาระหว่างที่เราตรวจ
    // เสร็จแล้วยังไม่ทัน INSERT (เช่น กด "ยกเลิกล่าสุด" บน LINE พร้อมกับกดขายบนเว็บ)
    // RPC จะปฏิเสธแทน — แปลงเป็น Error Code เดิมของ Flow นี้ (ไม่ใช่
    // INSUFFICIENT_QUANTITY ของฝั่งขาย) เพื่อให้ข้อความที่ผู้ใช้เห็นตรงกับสิ่งที่กดจริง
    if (err.code === 'INSUFFICIENT_QUANTITY') {
      throw new UndoTransactionError(
        'CANNOT_UNDO_QUANTITY_MISMATCH',
        'Cannot undo this buy because the current holding is lower than the purchased quantity',
        { requested: err.details?.requested ?? Number(latest.quantity), held: err.details?.held }
      );
    }
    throw err;
  }

  // transactions เก็บแค่ asset_id — ดึง symbol มาแสดงผลข้อความยืนยัน
  const [asset] = await assetRepository.findByIds([latest.assetId]);

  return {
    reversalTransactionId: reversal.id,
    originalTransactionId: latest.id,
    originalType: latest.type,
    reversalType,
    symbol: asset?.symbol ?? null,
    quantity: Number(latest.quantity),
    pricePerUnit: Number(latest.pricePerUnit),
    amountThb: Number(latest.amountThb),
  };
}

module.exports = {
  UndoTransactionError,
  UNDO_MARKER,
  buildReversalNote,
  isReversal,
  parseReversedId,
  excludeUndoneTransactions,
  undoLastTransaction,
};
