const { supabaseAdmin } = require('../config/supabase');
const { requireUserId } = require('../utils/ownership.util');

// ตารางเก็บธุรกรรมที่รอ Confirm (migrations/001_create_pending_transactions.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role
// เท่านั้น — LINE User ไม่มี auth.uid() session
//
// ⚠️ Security Audit (Cross-User Isolation): ทุกฟังก์ชันที่แตะแถวราย `id`/`batch_id`
// ต้องรับ userId แล้วกรอง `.eq('user_id', userId)` ไปพร้อมกันในคำสั่งเดียว "เสมอ"
// — ห้ามดึงมาแล้วค่อยเทียบเจ้าของในชั้น Service (Race + ลืมง่าย) และห้ามให้ userId
// เป็น Optional เพราะ id เหล่านี้มาจาก LINE Postback ซึ่งเป็นค่าจากฝั่ง Client
// requireUserId() ทำให้ "ลืมส่ง userId" พังทันทีแทนที่จะกลายเป็น Query ข้ามบัญชี
//
// ยกเว้น 2 ฟังก์ชันท้ายไฟล์ (expireOverdue / purgeResolvedBefore) ที่เป็น Cron
// ระดับระบบโดยเจตนา — ไม่มี HTTP surface และไม่คืนข้อมูลผู้ใช้ออกไปที่ใดเลย
function toPending(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    portfolioId: row.portfolio_id,
    commandType: row.command_type,
    assetSymbol: row.asset_symbol,
    assetName: row.asset_name,
    assetType: row.asset_type,
    quantity: row.quantity,
    pricePerUnit: row.price_per_unit,
    amountThb: row.amount_thb,
    // Multi-Currency (Round 10 — migration 012) — สกุลของ amount_thb/price_per_unit
    // (แถวเดิม/ไม่มีค่า = 'THB' ตาม DEFAULT) พกผ่าน Flow Preview→Confirm
    currency: row.currency ?? 'THB',
    feeThb: row.fee_thb,
    txnDate: row.txn_date,
    batchId: row.batch_id,
    // กองทุนรวมไทย (Round 7) — พก Class ผ่าน Flow Preview→Confirm (nullable)
    projId: row.proj_id ?? null,
    fundClassName: row.fund_class_name ?? null,
    // แนบรูปสลิป (S8 — migration 021) — token ของไฟล์ที่อัปโหลดไว้ตอน AI OCR อ่าน
    // พกข้ามขั้น Preview→Confirm เพื่อให้แนบเข้า transaction ตอนบันทึกจริงได้
    // (null สำหรับธุรกรรมที่ไม่ได้มาจากสลิป ซึ่งเป็นกรณีส่วนใหญ่)
    slipToken: row.slip_token ?? null,
    status: row.status,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    transactionId: row.transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// สร้าง Pending ใหม่ — status ('pending') และ expires_at (now + 5 นาที) ใช้
// DEFAULT ของ DB ไม่ต้องส่งมาจาก App
async function create(data) {
  const { data: row, error } = await supabaseAdmin
    .from('pending_transactions')
    .insert({
      user_id: data.userId,
      portfolio_id: data.portfolioId ?? null,
      command_type: data.commandType,
      asset_symbol: data.assetSymbol,
      asset_name: data.assetName ?? null,
      asset_type: data.assetType ?? null,
      quantity: data.quantity,
      price_per_unit: data.pricePerUnit,
      amount_thb: data.amountThb,
      // Multi-Currency (Round 10) — Default 'THB' เมื่อ Caller ไม่ส่ง (Path เดิม)
      currency: data.currency ?? 'THB',
      fee_thb: data.feeThb ?? 0,
      txn_date: data.txnDate,
      // batch_id (migration 008) — nullable, ผูก N แถวที่มาจาก Bulk Import Batch
      // เดียวกัน (Phase 3 Round 6) เพื่อให้ Postback ยืนยัน/ยกเลิกทั้งก้อนใช้ค่านี้
      // ค้นหา ไม่ส่งมา (undefined) = NULL ตามปกติของ Flow ซื้อ/ขายทีละรายการเดิม
      batch_id: data.batchId ?? null,
      // แนบรูปสลิป (S8) — nullable, มีค่าเฉพาะ Pending ที่มาจาก AI Slip OCR
      slip_token: data.slipToken ?? null,
      // กองทุนรวมไทย (Round 7 — migration 010) — nullable สำหรับสินทรัพย์อื่น
      proj_id: data.projId ?? null,
      fund_class_name: data.fundClassName ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create pending transaction: ${error.message}`);
  }

  return toPending(row);
}

// ดึงแถวเดียวโดยตรวจความเป็นเจ้าของไปพร้อมกัน (Pattern เดียวกับ
// transaction.repository.findByIdForUser) — คืน null ทั้งกรณี "ไม่มีจริง" และ
// "ไม่ใช่ของ User คนนั้น" แยกไม่ออกโดยเจตนา (ไม่บอกใบ้ว่า id นั้นมีอยู่จริงไหม)
async function findByIdForUser(id, userId) {
  requireUserId(userId, 'pendingTransaction.findByIdForUser');

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find pending transaction ${id}: ${error.message}`);
  }

  return toPending(data);
}

// ทุกแถวที่มาจาก Bulk Import Batch เดียวกัน (Phase 3 Round 6 — migration 008)
// ใช้ตอน Confirm/Cancel ทั้งก้อนด้วยปุ่มเดียว (Postback พก batch_id ตัวเดียว
// แทนที่จะพก pending id ทีละตัวซึ่งจะเกิน Limit ความยาวของ LINE Postback data)
async function findByBatchIdForUser(batchId, userId) {
  requireUserId(userId, 'pendingTransaction.findByBatchIdForUser');

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .select('*')
    .eq('batch_id', batchId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to find pending transactions for batch ${batchId}: ${error.message}`);
  }

  return (data ?? []).map(toPending);
}

// เปลี่ยนสถานะ pending → confirmed แบบ Atomic (กัน Double-tap ปุ่มยืนยัน)
// เงื่อนไข WHERE ครอบทั้ง status='pending' และ expires_at ยังไม่หมด — ถ้ามี
// Request สองตัวเข้ามาพร้อมกัน มีเพียงตัวเดียวที่ Match แถวและได้ row กลับ
// อีกตัวได้ null (แถวถูกเปลี่ยนสถานะไปแล้ว) → ไม่ Execute ซ้ำ
// คืน record ที่ Claim สำเร็จ หรือ null ถ้า Claim ไม่ได้ (resolve แล้ว/หมดอายุ)
async function claimForConfirm(id, userId) {
  requireUserId(userId, 'pendingTransaction.claimForConfirm');

  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ status: 'confirmed', resolved_at: nowIso })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim pending transaction ${id}: ${error.message}`);
  }

  return toPending(data);
}

// ผูก transaction_id หลัง Execute สำเร็จ (status เป็น 'confirmed' อยู่แล้วจาก
// claimForConfirm — ผ่าน CHECK pending_tx_txn_id_only_when_confirmed)
async function attachTransaction(id, transactionId, userId) {
  requireUserId(userId, 'pendingTransaction.attachTransaction');

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ transaction_id: transactionId })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to attach transaction to pending ${id}: ${error.message}`);
  }

  return toPending(data);
}

// ยกเลิกแบบ Atomic (เฉพาะแถวที่ยัง 'pending') คืน record หรือ null ถ้า resolve แล้ว
async function markCancelled(id, userId) {
  requireUserId(userId, 'pendingTransaction.markCancelled');

  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ status: 'cancelled', resolved_at: nowIso })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to cancel pending transaction ${id}: ${error.message}`);
  }

  return toPending(data);
}

// ทำเครื่องหมายหมดอายุแถวเดียว (ใช้ตอน Confirm มาช้าเกิน expires_at)
async function markExpired(id, userId) {
  requireUserId(userId, 'pendingTransaction.markExpired');

  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ status: 'expired', resolved_at: nowIso })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to expire pending transaction ${id}: ${error.message}`);
  }

  return toPending(data);
}

// Bulk expire สำหรับ Cron — ทุกแถวที่ยัง 'pending' แต่ expires_at ผ่านไปแล้ว
// คืนจำนวนแถวที่ถูก Expire
async function expireOverdue() {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ status: 'expired', resolved_at: nowIso })
    .eq('status', 'pending')
    .lt('expires_at', nowIso)
    .select('id');

  if (error) {
    throw new Error(`Failed to expire overdue pending transactions: ${error.message}`);
  }

  return data ? data.length : 0;
}

// Hard DELETE แถวที่ resolve แล้ว (ไม่ใช่ 'pending') และ resolved_at เก่ากว่า
// cutoff — สำหรับ Cron Retention (DATABASE.md § 8 ข้อยกเว้น Working State)
// คืนจำนวนแถวที่ถูกลบ
async function purgeResolvedBefore(cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .delete()
    .neq('status', 'pending')
    .lt('resolved_at', cutoffIso)
    .select('id');

  if (error) {
    throw new Error(`Failed to purge resolved pending transactions: ${error.message}`);
  }

  return data ? data.length : 0;
}

module.exports = {
  create,
  findByIdForUser,
  findByBatchIdForUser,
  claimForConfirm,
  attachTransaction,
  markCancelled,
  markExpired,
  expireOverdue,
  purgeResolvedBefore,
};
