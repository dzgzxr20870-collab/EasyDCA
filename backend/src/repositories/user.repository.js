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
    // PDPA Compliance (migration 017/018) — NULL = ยังไม่เคย Consent /
    // บัญชียัง Active ปกติ ตามลำดับ ดู setPdpaConsent / anonymize ด้านล่าง
    pdpaConsentedAt: row.pdpa_consented_at ?? null,
    anonymizedAt: row.anonymized_at ?? null,
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

// คืน User ทั้งหมด (ใหม่→เก่า) สำหรับ Admin Dashboard (Round 4b) — Read-only List
// ยังไม่ทำ Pagination (Beta ยังมี User หลักสิบ ข้อมูลน้อย ถ้าจำเป็นค่อยเพิ่มทีหลัง)
async function findAll() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to find all users: ${error.message}`);
  }

  return (data ?? []).map(toUser);
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

// อัปเดตชื่อ/รูปโปรไฟล์ของ User เดิม — ใช้แก้บั๊กชื่อ Fallback "LINE User" ค้างถาวร
// (resolveUser เจอ Profile จริงในรอบถัดไปหลังจาก getProfile ล้มเหลวตอนสมัครครั้งแรก)
// Pattern เดียวกับ updatePlan ด้านบน
async function updateDisplayName(userId, displayName, pictureUrl) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      display_name: displayName,
      picture_url: pictureUrl,
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update display name for user ${userId}: ${error.message}`);
  }

  return toUser(data);
}

// Express Opt-in Consent (migration 017) — ตั้งค่า pdpa_consented_at = now()
// ตอน User กดยืนยัน Privacy Policy ครั้งแรก (POST /api/v1/auth/pdpa-consent)
async function setPdpaConsent(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ pdpa_consented_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to set PDPA consent for user ${userId}: ${error.message}`);
  }

  return toUser(data);
}

// PDPA Erasure (migration 018) — Anonymize แทน Hard Delete (Immutable Ledger
// ยังต้องอ้างอิง users.id ต่อไปได้ผ่าน transactions/payments.user_id เดิม ไม่ Orphan
// เพราะไม่ลบ Row นี้ทิ้ง แค่ล้างข้อมูลระบุตัวตน 3 คอลัมน์เดียวที่มีบนตาราง users
// (line_user_id/display_name/picture_url — ยืนยันจาก Schema จริงแล้ว ไม่มี Field
// ระบุตัวตนอื่นอีก) line_user_id คงค่า NOT NULL + UNIQUE ไว้ได้ด้วยค่าสังเคราะห์ที่
// Unique แน่นอนจาก Primary Key ของตัวเอง (กันชนกับ User อื่นที่ก็ถูก Anonymize ไปแล้ว)
async function anonymize(userId) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      line_user_id: `anonymized-${userId}`,
      display_name: 'ผู้ใช้ที่ถูกลบข้อมูล',
      picture_url: null,
      anonymized_at: nowIso,
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to anonymize user ${userId}: ${error.message}`);
  }

  return toUser(data);
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
  findAll,
  create,
  findExpiredPremiumUsers,
  updatePlan,
  updateDisplayName,
  setPdpaConsent,
  anonymize,
};
