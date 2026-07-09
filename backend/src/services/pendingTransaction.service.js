const pendingRepository = require('../repositories/pendingTransaction.repository');
const transactionService = require('./transaction.service');
const commandParser = require('./commandParser.service');

const { COMMANDS } = commandParser;

// Retention Default สำหรับ Cron purge (DATABASE.md § 8 — ลบแถวที่ resolve แล้ว
// เก่ากว่า 24 ชม.) เก็บเป็นค่าเดียวที่นี่ให้ Cron/Test อ้างอิงตรงกัน
const PURGE_RETENTION_HOURS = 24;

// Error ที่มี code เฉพาะของ Confirm Flow เพื่อให้ Controller (Webhook) Map เป็น
// ข้อความไทยได้ แบบเดียวกับ TransactionServiceError (API.md § 5)
class PendingTransactionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PendingTransactionError';
    this.code = code;
    this.details = details;
  }
}

// แปลง Pending record → params สำหรับส่งให้ transaction.service ตอน Commit
// ใช้ txnDate ที่ถูก Snapshot ไว้ตอนสร้าง Preview (ไม่ใช่ today ตอน Confirm)
// เพื่อให้วันที่ตรงกับตอนผู้ใช้กดสั่งจริง
function toCommitParams(pending) {
  return {
    symbol: pending.assetSymbol,
    name: pending.assetName ?? undefined,
    type: pending.assetType ?? undefined,
    quantity: Number(pending.quantity),
    pricePerUnit: Number(pending.pricePerUnit),
    feeThb: pending.feeThb !== null && pending.feeThb !== undefined ? Number(pending.feeThb) : 0,
    date: pending.txnDate,
    portfolioId: pending.portfolioId ?? null,
  };
}

// สร้าง Pending รอ Confirm จากคำสั่งที่ Parse แล้ว (SRS.md § 2.3 [4-5])
// Validate เต็มรูปแบบก่อนสร้าง (Freemium/type/ยอดคงเหลือ) — ถ้าไม่ผ่านจะ throw
// TransactionServiceError โดยไม่สร้าง Pending เลย เพื่อให้ผู้ใช้เห็น Error ทันที
// ก่อนถึงหน้า Preview (ตรงลำดับ SRS ที่เช็ค Limit ใน [2] ก่อน Preview ใน [4])
async function createPending(userId, parsed, options = {}) {
  const { command, params } = parsed;

  if (command !== COMMANDS.BUY && command !== COMMANDS.SELL) {
    throw new PendingTransactionError(
      'UNSUPPORTED_COMMAND',
      `Pending flow supports BUY/SELL only, got ${command}`,
      { command }
    );
  }

  let amounts;
  let assetType = null;

  if (command === COMMANDS.BUY) {
    // validateBuy คืน amounts + จำแนกว่าเป็น Asset ใหม่ไหม — เก็บ asset_type
    // เฉพาะกรณี Asset ใหม่ (Asset เดิม type รู้ได้ตอน Confirm อยู่แล้ว → NULL)
    const result = await transactionService.validateBuy(userId, params, options);
    amounts = result.amounts;
    assetType = result.newAsset ? result.assetType : null;
  } else {
    const result = await transactionService.validateSell(userId, params);
    amounts = result.amounts;
  }

  const pending = await pendingRepository.create({
    userId,
    portfolioId: params.portfolioId ?? null,
    commandType: command === COMMANDS.BUY ? 'buy' : 'sell',
    assetSymbol: params.symbol,
    assetName: params.name ?? null,
    assetType,
    quantity: amounts.quantity,
    pricePerUnit: amounts.pricePerUnit,
    amountThb: amounts.amountThb,
    feeThb: params.feeThb ?? 0,
    txnDate: params.date ?? transactionService.todayInBangkok(),
  });

  // priceSource + fx ไม่มี Column รองรับใน pending_transactions (ตรวจ Migration แล้ว)
  // จึงไม่ Insert ลง DB — Enrich กลับเข้า Object ที่คืนให้ Controller ใช้สร้าง
  // Preview Message ได้ทันทีแทน (ไหลเป็น JS Object เท่านั้น ไม่ Persist)
  // fx = null เมื่อไม่ใช่คำสั่งราคา USD (Preview จะไม่แสดงบรรทัด USD/เรต)
  return { ...pending, priceSource: amounts.priceSource, fx: amounts.fx ?? null };
}

// ยืนยัน Pending → บันทึก Transaction จริง (SRS.md § 2.3 [6])
// ขั้นตอน:
//  1. Claim แบบ Atomic (pending → confirmed) กัน Double-tap และตรวจหมดอายุ
//  2. ถ้า Claim ไม่ได้ → หาสาเหตุ (หมดอายุ/resolve ไปแล้ว/ไม่พบ) แล้ว throw
//  3. Execute ผ่าน transaction.service (Validate ซ้ำอีกครั้ง ณ เวลา Commit)
//  4. ผูก transaction_id กลับเข้า Pending เพื่อ Trace
//
// หมายเหตุ Semantics: ถ้าขั้นที่ 3 throw (เช่น INSUFFICIENT_QUANTITY เพราะยอด
// เปลี่ยนไประหว่างรอ Confirm) แถวจะค้างสถานะ 'confirmed' + transaction_id = NULL
// ซึ่งแปลว่า "ผู้ใช้ยืนยันแล้วแต่ Execute ไม่สำเร็จ" — เป็นข้อมูล Debug ที่มี
// ประโยชน์ และ Error จะถูกโยนต่อให้ Controller แปลเป็นข้อความไทยตามเดิม
async function confirmPending(pendingId, options = {}) {
  const claimed = await pendingRepository.claimForConfirm(pendingId);

  if (!claimed) {
    const current = await pendingRepository.findById(pendingId);

    if (!current) {
      throw new PendingTransactionError('PENDING_NOT_FOUND', `Pending ${pendingId} not found`, {
        pendingId,
      });
    }

    // ยัง 'pending' อยู่แต่ Claim ไม่ได้ = หมดอายุแล้ว (expires_at ผ่านไป)
    if (current.status === 'pending') {
      await pendingRepository.markExpired(pendingId);
      throw new PendingTransactionError('PENDING_EXPIRED', `Pending ${pendingId} has expired`, {
        pendingId,
      });
    }

    // resolve ไปแล้ว (confirmed/cancelled/expired) — เช่น กดยืนยันซ้ำ
    throw new PendingTransactionError(
      'PENDING_ALREADY_RESOLVED',
      `Pending ${pendingId} already ${current.status}`,
      { pendingId, status: current.status }
    );
  }

  const params = toCommitParams(claimed);
  // result มี priceSource ติดมาด้วยแล้ว (คำนวณใหม่ผ่าน resolveQuantityAndPrice
  // ตอน Commit จริง) — ส่งต่อให้ Controller สร้าง Success Message ได้เลย
  // ไม่ต้องอ่านจาก Pending record ใน DB (ไม่มี Column นี้อยู่แล้ว)
  const result =
    claimed.commandType === 'buy'
      ? await transactionService.processBuyCommand(claimed.userId, params, options)
      : await transactionService.processSellCommand(claimed.userId, params);

  // ⚠️ GAP สำคัญ: มาถึงบรรทัดนี้ = Transaction จริงถูกบันทึกลง DB สำเร็จแล้ว
  // (Source of Truth คือตาราง transactions) การผูก transaction_id กลับเข้า
  // pending record เป็นเพียง Metadata สำหรับ Trace เท่านั้น
  //
  // ถ้า attachTransaction พังทีหลัง (เช่น Network Error) "ห้าม Retry สร้าง
  // Transaction ใหม่" เพราะจะได้ Transaction ซ้ำ — จึง Swallow Error ไว้แค่
  // Log แล้วคืน result สำเร็จตามเดิม เพื่อให้ Caller/ผู้ใช้เห็นว่า "สำเร็จ"
  // (เพราะรายการเกิดขึ้นจริงแล้ว) ผลที่ตามมาคือ pending row นั้นค้างสถานะ
  // 'confirmed' + transaction_id = NULL ซึ่งยอมรับได้ (เป็นแค่ Trace ที่ขาดไป)
  try {
    await pendingRepository.attachTransaction(pendingId, result.transactionId);
  } catch (attachErr) {
    console.error(
      `[pending] attachTransaction failed AFTER commit (pendingId=${pendingId}, ` +
        `transactionId=${result.transactionId}): ${attachErr.message} — transaction ` +
        'is already persisted; NOT retrying to avoid a duplicate'
    );
  }

  return { commandType: claimed.commandType, result };
}

// ยกเลิก Pending (SRS.md § 2.3 — ปุ่ม ❌ ยกเลิก)
async function cancelPending(pendingId) {
  const cancelled = await pendingRepository.markCancelled(pendingId);

  if (!cancelled) {
    const current = await pendingRepository.findById(pendingId);

    if (!current) {
      throw new PendingTransactionError('PENDING_NOT_FOUND', `Pending ${pendingId} not found`, {
        pendingId,
      });
    }

    throw new PendingTransactionError(
      'PENDING_ALREADY_RESOLVED',
      `Pending ${pendingId} already ${current.status}`,
      { pendingId, status: current.status }
    );
  }

  return cancelled;
}

// ── สำหรับ Cron (การ Schedule จะทำในขั้น Controller/Job ถัดไป) ──────────────
// ทำเครื่องหมาย Pending ที่หมดอายุแล้วทั้งหมดเป็น 'expired'
async function expireOverduePending() {
  return pendingRepository.expireOverdue();
}

// ลบแถวที่ resolve แล้วเก่ากว่า Retention (Default 24 ชม.)
async function purgeOldPending(retentionHours = PURGE_RETENTION_HOURS) {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
  return pendingRepository.purgeResolvedBefore(cutoff);
}

module.exports = {
  PendingTransactionError,
  PURGE_RETENTION_HOURS,
  createPending,
  confirmPending,
  cancelPending,
  expireOverduePending,
  purgeOldPending,
};
