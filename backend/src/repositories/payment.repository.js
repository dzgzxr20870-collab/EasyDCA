const { supabaseAdmin } = require('../config/supabase');

// ตารางคำขอชำระเงิน Premium (migrations/004_create_payments.sql) — Immutable Ledger
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role เท่านั้น
// (Pattern เดียวกับ pendingTransaction.repository)
function toPayment(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    billingPeriod: row.billing_period,
    baseAmountThb: row.base_amount_thb,
    satangTag: row.satang_tag,
    amountThb: row.amount_thb,
    status: row.status,
    slipImageUrl: row.slip_image_url,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// สร้างคำขอใหม่ — status ('pending') ใช้ DEFAULT ของ DB ไม่ต้องส่งมาจาก App
// ⚠️ Partial Unique Index (amount_thb WHERE status='pending') อาจ Reject ด้วย
// Unique Violation (Postgres 23505) ถ้ามีคำขอ pending ยอดเท่ากันอยู่แล้ว —
// จึง "คง error.code ไว้" (ไม่กลืน) เพื่อให้ payment.service ตรวจจับแล้ว Retry
// จัดสรรเลขสตางค์ใหม่ได้ (ดู requestPayment)
async function create(data) {
  const { data: row, error } = await supabaseAdmin
    .from('payments')
    .insert({
      user_id: data.userId,
      billing_period: data.billingPeriod,
      base_amount_thb: data.baseAmountThb,
      satang_tag: data.satangTag,
      amount_thb: data.amountThb,
      expires_at: data.expiresAt instanceof Date ? data.expiresAt.toISOString() : data.expiresAt,
    })
    .select('*')
    .single();

  if (error) {
    const err = new Error(`Failed to create payment: ${error.message}`);
    // แนบ code เดิมของ Postgres/PostgREST ไว้ (เช่น '23505' Unique Violation)
    // เพื่อให้ Service Layer แยกแยะ Race Condition จัดสรรเลขสตางค์ชนกันได้
    err.code = error.code;
    throw err;
  }

  return toPayment(row);
}

async function findById(id) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find payment ${id}: ${error.message}`);
  }

  return toPayment(data);
}

// ดึงเลขสตางค์ (satang_tag) ที่ "ถูกจองอยู่" ณ ขณะนี้สำหรับยอดฐานหนึ่งๆ
// (payment ที่ยัง status='pending') — payment.service ใช้เลือกเลขว่างที่เหลือ
// คืน array ของ integer
async function findPendingSatangTagsByBaseAmount(baseAmountThb) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('satang_tag')
    .eq('base_amount_thb', baseAmountThb)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to load pending satang tags for base ${baseAmountThb}: ${error.message}`);
  }

  return (data ?? []).map((r) => r.satang_tag);
}

// อนุมัติแบบ Atomic (กัน Admin กดซ้ำ/สองคนกดพร้อมกัน/ชนกับ Cron หมดอายุ)
// เงื่อนไข WHERE status='pending' — มีเพียง Request เดียวที่ Match แถวและได้ row
// กลับ อีก Request/Cron ได้ null (แถวถูกเปลี่ยนสถานะไปแล้ว) → ไม่อนุมัติซ้ำ
// คืน payment ที่อัปเดตสำเร็จ หรือ null ถ้า Claim ไม่ได้ (resolve ไปแล้ว)
async function claimForApproval(id, adminLineUserId) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('payments')
    .update({ status: 'confirmed', confirmed_by: adminLineUserId, confirmed_at: nowIso })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim payment ${id} for approval: ${error.message}`);
  }

  return toPayment(data);
}

// ปฏิเสธแบบ Atomic — เหมือน claimForApproval แต่ SET status='rejected'
async function claimForRejection(id, adminLineUserId) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('payments')
    .update({ status: 'rejected', confirmed_by: adminLineUserId, confirmed_at: nowIso })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim payment ${id} for rejection: ${error.message}`);
  }

  return toPayment(data);
}

// คำขอ pending ทั้งหมดที่เลย expires_at ไปแล้ว (สำหรับ Cron หมดอายุ)
async function findExpiredPending(now = new Date()) {
  const nowIso = now.toISOString();

  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('status', 'pending')
    .lt('expires_at', nowIso);

  if (error) {
    throw new Error(`Failed to find expired pending payments: ${error.message}`);
  }

  return (data ?? []).map(toPayment);
}

// ทำเครื่องหมายหมดอายุแถวเดียวแบบ Atomic (status='pending' guard) — กันชนกับ
// Admin ที่กดอนุมัติ/ปฏิเสธพร้อมกันตอน Cron รัน คืน payment หรือ null ถ้า resolve แล้ว
async function markExpired(id) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .update({ status: 'expired' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to expire payment ${id}: ${error.message}`);
  }

  return toPayment(data);
}

module.exports = {
  create,
  findById,
  findPendingSatangTagsByBaseAmount,
  claimForApproval,
  claimForRejection,
  findExpiredPending,
  markExpired,
};
