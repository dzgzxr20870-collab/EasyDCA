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

// ยกเลิก (ย้อนกลับ) Transaction ล่าสุดของ User ด้วย Reversal Pattern
// (DATABASE.md § 8 — Immutable Ledger) โดยไม่ลบ/แก้ไขรายการเดิมเด็ดขาด
//
// อาจ throw: NO_TRANSACTION_TO_UNDO / ALREADY_UNDONE / CANNOT_UNDO_QUANTITY_MISMATCH
async function undoLastTransaction(userId) {
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
  const history = await transactionRepository.findAllByAsset(latest.assetId);

  // Double-Undo guard ชั้นที่ 2: มี Reversal ของรายการล่าสุดอยู่แล้วในประวัติ —
  // ครอบคลุมกรณีที่ findRecentByUser เรียงตาม date (รายวัน) แล้วรายการเดิมกับ
  // Reversal มี date เดียวกัน จน Reversal ไม่ได้ถูกคืนมาเป็นตัวแรก (Tie ordering)
  const alreadyReversed = history.some((tx) => tx.note === buildReversalNote(latest.id));
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
  const reversal = await transactionRepository.create({
    userId,
    assetId: latest.assetId,
    type: reversalType,
    amountThb: latest.amountThb,
    pricePerUnit: latest.pricePerUnit,
    quantity: latest.quantity,
    feeThb: 0,
    date: todayInBangkok(),
    note: buildReversalNote(latest.id),
    source: 'line',
  });

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
  undoLastTransaction,
};
