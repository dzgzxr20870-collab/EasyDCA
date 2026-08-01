const { supabaseAdmin } = require('../config/supabase');

// ═══════════════════════════════════════════════════════════════════════════
// premiumGrantLog.repository — Audit Trail การ Grant Premium ฟรีโดย Admin
// (migrations/023_create_premium_grant_logs.sql) — Append-only Log
// ═══════════════════════════════════════════════════════════════════════════
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role เท่านั้น
// (Pattern เดียวกับ payment.repository / erasureLog.repository)

function toGrantLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    grantedBy: row.granted_by,
    billingPeriod: row.billing_period,
    newExpiresAt: row.new_expires_at,
    createdAt: row.created_at,
  };
}

// บันทึก 1 แถวต่อ 1 ครั้งที่ Admin Grant สำเร็จ — เก็บ Snapshot วันหมดอายุใหม่ไว้ด้วย
// (ตรวจย้อนหลังได้ว่าครั้งนั้นต่อให้ถึงเมื่อไร แม้ users.plan_expires_at ถูกทับภายหลัง)
async function create(data) {
  const { data: row, error } = await supabaseAdmin
    .from('premium_grant_logs')
    .insert({
      user_id: data.userId,
      granted_by: data.grantedBy,
      billing_period: data.billingPeriod,
      new_expires_at:
        data.newExpiresAt instanceof Date ? data.newExpiresAt.toISOString() : data.newExpiresAt,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create premium grant log: ${error.message}`);
  }

  return toGrantLog(row);
}

// ประวัติการ Grant ทั้งหมดของผู้ใช้รายนี้ (ใช้ Index idx_premium_grant_logs_user_id)
// — freeTrial.service ใช้ตรวจว่า "เคยได้ Premium ฟรีจาก Admin มาก่อนไหม" (Beta Wave 1)
//
// ⚠️ ใช้เป็น "เงื่อนไขคัดกรองเพิ่ม" เท่านั้น ห้ามใช้เป็น Guard หลักกันกดซ้ำ — ตารางนี้
// ไม่มี UNIQUE constraint และถูกเขียนแบบ best-effort (try/catch) ทั้งใน adminGrant
// และ freeTrial จึงอาจขาดแถวได้ Guard หลักคือ users.free_trial_claimed_at (Atomic)
async function findAllByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('premium_grant_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to find premium grant logs for user ${userId}: ${error.message}`);
  }

  return (data ?? []).map(toGrantLog);
}

module.exports = { create, findAllByUserId, toGrantLog };
