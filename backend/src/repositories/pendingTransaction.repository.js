const { supabaseAdmin } = require('../config/supabase');

// ตารางเก็บธุรกรรมที่รอ Confirm (migrations/001_create_pending_transactions.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role
// เท่านั้น — LINE User ไม่มี auth.uid() session
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
    feeThb: row.fee_thb,
    txnDate: row.txn_date,
    batchId: row.batch_id,
    // กองทุนรวมไทย (Round 7) — พก Class ผ่าน Flow Preview→Confirm (nullable)
    projId: row.proj_id ?? null,
    fundClassName: row.fund_class_name ?? null,
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
      fee_thb: data.feeThb ?? 0,
      txn_date: data.txnDate,
      // batch_id (migration 008) — nullable, ผูก N แถวที่มาจาก Bulk Import Batch
      // เดียวกัน (Phase 3 Round 6) เพื่อให้ Postback ยืนยัน/ยกเลิกทั้งก้อนใช้ค่านี้
      // ค้นหา ไม่ส่งมา (undefined) = NULL ตามปกติของ Flow ซื้อ/ขายทีละรายการเดิม
      batch_id: data.batchId ?? null,
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

async function findById(id) {
  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find pending transaction ${id}: ${error.message}`);
  }

  return toPending(data);
}

// ทุกแถวที่มาจาก Bulk Import Batch เดียวกัน (Phase 3 Round 6 — migration 008)
// ใช้ตอน Confirm/Cancel ทั้งก้อนด้วยปุ่มเดียว (Postback พก batch_id ตัวเดียว
// แทนที่จะพก pending id ทีละตัวซึ่งจะเกิน Limit ความยาวของ LINE Postback data)
async function findByBatchId(batchId) {
  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .select('*')
    .eq('batch_id', batchId);

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
async function claimForConfirm(id) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ status: 'confirmed', resolved_at: nowIso })
    .eq('id', id)
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
async function attachTransaction(id, transactionId) {
  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ transaction_id: transactionId })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to attach transaction to pending ${id}: ${error.message}`);
  }

  return toPending(data);
}

// ยกเลิกแบบ Atomic (เฉพาะแถวที่ยัง 'pending') คืน record หรือ null ถ้า resolve แล้ว
async function markCancelled(id) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ status: 'cancelled', resolved_at: nowIso })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to cancel pending transaction ${id}: ${error.message}`);
  }

  return toPending(data);
}

// ทำเครื่องหมายหมดอายุแถวเดียว (ใช้ตอน Confirm มาช้าเกิน expires_at)
async function markExpired(id) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('pending_transactions')
    .update({ status: 'expired', resolved_at: nowIso })
    .eq('id', id)
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
  findById,
  findByBatchId,
  claimForConfirm,
  attachTransaction,
  markCancelled,
  markExpired,
  expireOverdue,
  purgeResolvedBefore,
};
