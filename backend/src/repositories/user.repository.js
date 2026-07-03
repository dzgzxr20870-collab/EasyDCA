const { supabaseAdmin } = require('../config/supabase');

function toUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    plan: row.plan,
    // entitlement.service ใช้ planExpiresAt (คู่กับ plan) ตัดสินว่า Premium ยัง
    // Active ไหม (null = ไม่เคย/หมดแล้ว = ถือเป็น Free)
    planExpiresAt: row.plan_expires_at,
    isLocked: row.is_locked,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findByLineUserId(lineUserId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find user by lineUserId: ${error.message}`);
  }

  return toUser(data);
}

// หา User ด้วย Primary Key (id) — ใช้ตอนอนุมัติ Payment ที่มีแต่ payment.user_id
// (คนละตัวกับ findByLineUserId ที่ค้นด้วย LINE User ID)
async function findById(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find user by id: ${error.message}`);
  }

  return toUser(data);
}

async function create(lineUserId, displayName, pictureUrl) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      line_user_id: lineUserId,
      display_name: displayName,
      picture_url: pictureUrl,
      plan: 'free',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  return toUser(data);
}

// หา user ที่ plan='premium' แต่ plan_expires_at เลยเวลาปัจจุบันไปแล้ว (หมดอายุ)
// — Downgrade Cron (planDowngrade.job) ใช้ปรับกลับเป็น Free + แจ้งผู้ใช้
// หมายเหตุ: กรอง plan_expires_at IS NOT NULL โดยปริยายผ่าน .lt() (แถวที่ค่าเป็น
// null จะไม่ Match ตัวกรอง Less-than อยู่แล้ว) จึงไม่หยิบ Premium ที่ยังไม่ตั้ง
// วันหมดอายุมาลดชั้นผิดๆ
async function findExpiredPremiumUsers(now = new Date()) {
  const nowIso = now.toISOString();

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('plan', 'premium')
    .lt('plan_expires_at', nowIso);

  if (error) {
    throw new Error(`Failed to find expired premium users: ${error.message}`);
  }

  return (data ?? []).map(toUser);
}

async function updatePlan(userId, plan, expiresAt) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      plan,
      plan_expires_at: expiresAt,
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update plan for user ${userId}: ${error.message}`);
  }

  return toUser(data);
}

module.exports = {
  findByLineUserId,
  findById,
  create,
  findExpiredPremiumUsers,
  updatePlan,
};
