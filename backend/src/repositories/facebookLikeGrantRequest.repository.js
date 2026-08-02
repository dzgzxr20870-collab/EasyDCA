const { supabaseAdmin } = require('../config/supabase');

// ═══════════════════════════════════════════════════════════════════════════
// facebookLikeGrantRequest.repository — คำขอ Premium ฟรีจากแคมเปญ Like Facebook
// (migrations/032_create_facebook_like_grant_requests.sql)
// ═══════════════════════════════════════════════════════════════════════════
// ต่างจาก premiumGrantLog.repository (Append-only Log) — ตารางนี้ "มี Life Cycle จริง"
// (pending → approved/rejected) จึงมี UPDATE + updated_at Trigger
//
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role เท่านั้น
// (Pattern เดียวกับ payment.repository / supportRequest.repository)

function toRequest(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    // Path ใน Private Bucket (ไม่ใช่ URL) — ต้องสร้าง Signed URL ตอนแสดงให้ Admin ดู
    screenshotPath: row.screenshot_path,
    message: row.message ?? null,
    status: row.status,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    rejectReason: row.reject_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// สร้างคำขอใหม่ (status='pending' ตาม DEFAULT ของ DB)
//
// ⚠️ อาจ throw ด้วย Postgres error code 23505 (unique_violation) จาก Partial Unique
// Index uniq_facebook_like_pending_per_user เมื่อผู้ใช้มีคำขอ pending ค้างอยู่แล้ว —
// Service ต้องดักโค้ดนี้แล้วแปลงเป็น Error ที่สื่อความหมาย (ห้ามปล่อยเป็น 500)
// นี่คือด่านกัน Race จริงที่ระดับ DB: เช็คก่อนด้วย findPendingByUserId อย่างเดียว
// ไม่พอ (สอง Request พร้อมกันผ่านการเช็คได้ทั้งคู่)
async function create(data) {
  const payload = {
    user_id: data.userId,
    screenshot_path: data.screenshotPath,
  };
  // ไม่ใส่ Key เลยถ้าไม่มีค่า (ปล่อยให้เป็น NULL ตาม Schema) — Pattern เดียวกับ
  // supportRequest.repository.create ที่ไม่ Insert undefined ทับ Default
  if (data.message !== undefined && data.message !== null) {
    payload.message = data.message;
  }

  const { data: row, error } = await supabaseAdmin
    .from('facebook_like_grant_requests')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    // คง code เดิมไว้ให้ Service ตรวจได้ (Supabase คืน error.code เป็น SQLSTATE ตรงๆ)
    const err = new Error(`Failed to create facebook like grant request: ${error.message}`);
    err.code = error.code;
    throw err;
  }

  return toRequest(row);
}

async function findById(id) {
  const { data, error } = await supabaseAdmin
    .from('facebook_like_grant_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find facebook like grant request ${id}: ${error.message}`);
  }

  return toRequest(data);
}

// คำขอที่ยัง pending ของผู้ใช้รายนี้ (หรือ null) — ใช้ตอบผู้ใช้ว่า "ส่งไปแล้ว รอตรวจอยู่"
// ก่อนจะไปชน Unique Index จริง (UX ดีกว่าปล่อยให้ Insert พังแล้วค่อยแปล Error)
async function findPendingByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('facebook_like_grant_requests')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find pending facebook like request for user ${userId}: ${error.message}`);
  }

  return toRequest(data);
}

// ประวัติคำขอทั้งหมดของผู้ใช้รายนี้ (ใหม่→เก่า) — ใช้ Index idx_..._user_id
async function findAllByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('facebook_like_grant_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to find facebook like requests for user ${userId}: ${error.message}`);
  }

  return (data ?? []).map(toRequest);
}

// รายการคำขอตามสถานะ สำหรับหน้า Admin — เรียง "เก่า→ใหม่" สำหรับ pending โดยเจตนา
// (เข้าคิวก่อนได้ตรวจก่อน — ตรงกับ Index idx_..._status_created_at ที่เป็น ASC)
async function listByStatus(status, limit = 100) {
  const { data, error } = await supabaseAdmin
    .from('facebook_like_grant_requests')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list facebook like requests (status=${status}): ${error.message}`);
  }

  return (data ?? []).map(toRequest);
}

// ── Atomic Claim: pending → approved/rejected ────────────────────────────────
// Pattern เดียวกับ payment.repository.claimForApproval เป๊ะ: เงื่อนไข
// WHERE status='pending' อยู่ใน UPDATE Statement เดียวกับการเปลี่ยนสถานะ ทำให้
// Admin สองคน (หรือคนเดียวกดรัว/เปิดสองแท็บ) กด Approve พร้อมกันจะมีแค่คนเดียวที่
// ได้แถวกลับมา อีกคนได้ null → Service ตอบ ALREADY_RESOLVED แทนการ Grant ซ้ำสองรอบ
//
// คืน null = มีคน Resolve ไปก่อนแล้ว / ไม่พบคำขอ | คืน request = Claim สำเร็จ
async function claimForReview(id, { status, reviewedBy, rejectReason = null, now = new Date() }) {
  const payload = {
    status,
    reviewed_by: reviewedBy,
    reviewed_at: now.toISOString(),
  };
  // เก็บเหตุผลเฉพาะตอนปฏิเสธ (approved ไม่มีเหตุผลให้เก็บ)
  if (status === 'rejected' && rejectReason) {
    payload.reject_reason = rejectReason;
  }

  const { data, error } = await supabaseAdmin
    .from('facebook_like_grant_requests')
    .update(payload)
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim facebook like request ${id} for review: ${error.message}`);
  }

  return toRequest(data);
}

module.exports = {
  create,
  findById,
  findPendingByUserId,
  findAllByUserId,
  listByStatus,
  claimForReview,
  toRequest,
};
