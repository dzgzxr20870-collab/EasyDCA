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
    // migration 015 (Payment Beta) — Hash ของรูปสลิปสำหรับตรวจจับการส่งซ้ำ
    slipHash: row.slip_hash ?? null,
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

// คืน Payment ทั้งหมด (ใหม่→เก่า) สำหรับ Admin Dashboard (Round 4b) — Read-only List
// Join users(display_name) มาในคราวเดียว (เลี่ยง N+1) — status เป็น Filter Optional
// (ไม่ส่ง = คืนทุกสถานะ) | ค่า status ที่รับคือค่าจริงใน DB: pending/confirmed/
// rejected/expired (ไม่มี 'approved' — "อนุมัติแล้ว" = 'confirmed')
// ยังไม่ทำ Pagination เช่นเดียวกับ user.repository.findAll (ข้อมูล Beta น้อย)
async function findAll({ status } = {}) {
  let query = supabaseAdmin.from('payments').select('*, users(display_name)');

  if (status) {
    query = query.eq('status', status);
  }

  // ปิดท้ายด้วย order เสมอ (เป็น Method สุดท้ายที่ await) — PostgREST ให้ลำดับ
  // filter/order สลับกันได้ ไม่กระทบผลลัพธ์
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to find all payments: ${error.message}`);
  }

  // แนบ displayName จากตาราง users ที่ Join มา (toPayment เดิมไม่รู้จักคอลัมน์ Join
  // จึงประกอบเพิ่มที่ชั้นนี้ ไม่แก้ toPayment ให้ผูกกับ Join)
  return (data ?? []).map((row) => ({
    ...toPayment(row),
    displayName: row.users?.display_name ?? null,
  }));
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

// คำขอ pending ล่าสุดของ user คนนี้ (หรือ null ถ้าไม่มี) — ปุ่ม "Premium" ใช้
// ตัดสินว่าจะเสนอแพ็กเกจใหม่ หรือส่ง QR ของคำขอเดิมซ้ำ (ไม่สร้างคำขอซ้อน)
// เรียง created_at ใหม่→เก่า เอาตัวแรก (limit 1) — maybeSingle รับ 0/1 แถวได้
async function findPendingByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find pending payment for user ${userId}: ${error.message}`);
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

// ผูก URL รูปสลิปเข้ากับคำขอ — อัปเดต slip_image_url (+ slip_hash ถ้าส่งมา — migration
// 015 Payment Beta) ไม่แตะ status/ฟิลด์อื่น ไม่มี Guard status='pending' (ต่างจาก
// claimForApproval/claimForRejection) เพราะนี่ไม่ใช่การเปลี่ยนสถานะสุดท้ายของ Payment
// แค่แนบไฟล์เพิ่ม — คืน payment ที่อัปเดตแล้ว (หรือ null ถ้าไม่พบ id นั้น)
//
// slipHash เป็น Parameter Optional (undefined = ไม่ส่งมา) เพื่อไม่ Break Caller เดิมที่
// ยังไม่รู้จัก slip_hash — ใส่ Key เข้า Update เฉพาะตอนที่ Caller ส่งค่ามาจริงเท่านั้น
async function updateSlipImageUrl(id, slipImageUrl, slipHash) {
  const update = { slip_image_url: slipImageUrl };
  if (slipHash !== undefined) {
    update.slip_hash = slipHash;
  }

  const { data, error } = await supabaseAdmin
    .from('payments')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update slip image url for payment ${id}: ${error.message}`);
  }

  return toPayment(data);
}

// หา Payment ที่ slip_hash ตรงกันและ status='confirmed' (อนุมัติแล้วจริง) — ใช้ตรวจจับ
// Fraud: ส่งสลิปโอนเงินจริงใบเดียวมาขอ Premium ซ้ำสองรอบ (ดู payment.service.
// assertSlipNotReused) คืน Payment แถวแรกที่ตรง หรือ null ถ้าไม่มี — Payment ที่
// rejected/expired/pending มี slip_hash เดียวกันไม่ถือว่าเป็นปัญหา (ไม่ Query กรอง)
async function findConfirmedBySlipHash(slipHash) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('slip_hash', slipHash)
    .eq('status', 'confirmed')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find confirmed payment by slip hash: ${error.message}`);
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
  findAll,
  findById,
  findPendingByUserId,
  findPendingSatangTagsByBaseAmount,
  claimForApproval,
  claimForRejection,
  updateSlipImageUrl,
  findConfirmedBySlipHash,
  findExpiredPending,
  markExpired,
};
