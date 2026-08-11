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
    // Audit Trail ของการล็อก (migration 039) — ใครสั่ง/เพราะอะไร ค้างไว้เป็นประวัติ
    // แม้ปลดล็อกไปแล้ว (ดู setLock) NULL = ไม่เคยถูกล็อก
    lockedBy: row.locked_by ?? null,
    lockReason: row.lock_reason ?? null,
    // PDPA Compliance (migration 017/018) — NULL = ยังไม่เคย Consent /
    // บัญชียัง Active ปกติ ตามลำดับ ดู setPdpaConsent / anonymize ด้านล่าง
    pdpaConsentedAt: row.pdpa_consented_at ?? null,
    anonymizedAt: row.anonymized_at ?? null,
    // Self-service Free Trial (migration 029) — NULL = ยังไม่เคยกดรับ Premium ฟรี
    // (สิทธิ์ครั้งเดียวตลอดชีพ ห้าม Reset — ดู freeTrial.service)
    freeTrialClaimedAt: row.free_trial_claimed_at ?? null,
    // แคมเปญ Like Facebook (migration 031) — NULL = ยังไม่เคยได้สิทธิ์จากแคมเปญนี้
    // แยกจาก freeTrialClaimedAt เพราะเป็นคนละแคมเปญ (ดู facebookLikeGrant.service)
    facebookLikeGrantedAt: row.facebook_like_granted_at ?? null,
    // NULL = ยังไม่เคยถูกเตือน "Premium ใกล้หมดอายุ" ในรอบบิลปัจจุบัน (migration 030)
    // ถูก Reset ทุกครั้งที่ updatePlan (ดูเหตุผลในฟังก์ชันนั้น)
    expiryReminderSentAt: row.expiry_reminder_sent_at ?? null,
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

// ── ล็อก/ปลดล็อกบัญชี (Offensive Review Round 2 — F7, migration 039) ─────────
// ทางเข้า "เดียว" ของการเขียน is_locked ทั้งระบบ — is_locked มีมาตั้งแต่ Schema แรก
// แต่ไม่เคยมีโค้ดจุดไหนเขียนได้เลย (Dead Column) นี่คือจุดที่ทำให้ใช้งานได้จริง
//
// locked = true  → บันทึกครบ 4 คอลัมน์ (is_locked/locked_at/locked_by/lock_reason)
// locked = false → แตะแค่ is_locked
//
// ⚠️ จงใจ "ไม่" ล้าง locked_by/lock_reason/locked_at ตอนปลดล็อก — ค่าที่ค้างอยู่คือ
// ประวัติว่า "เคยถูกล็อกด้วยเหตุผลนี้" ซึ่งมีประโยชน์มากตอนเจอผู้ใช้คนเดิม Abuse ซ้ำ
// (ถ้าล้างทิ้ง จะไม่มีทางรู้เลยว่าคนนี้เคยมีประวัติ) ตัวชี้ขาดว่าถูกล็อกอยู่หรือไม่คือ
// is_locked เท่านั้น ทุกจุดที่บังคับใช้จึงต้องอ่าน is_locked ห้ามเดาจาก locked_at
async function setLock(userId, locked, { lockedBy = null, reason = null } = {}) {
  const update = { is_locked: locked };
  if (locked) {
    update.locked_at = new Date().toISOString();
    update.locked_by = lockedBy;
    update.lock_reason = reason;
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(update)
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to set lock=${locked} for user ${userId}: ${error.message}`);
  }

  // null = ไม่มี User id นี้จริง (Controller แปลงเป็น 404) — ใช้ maybeSingle ไม่ใช่
  // single() เพราะ single() จะ throw เป็น Error ดิบซึ่งกลายเป็น 500 ทั้งที่ความหมายคือ
  // "ไม่พบผู้ใช้" (Pattern เดียวกับ findById)
  return toUser(data);
}

// ทางเข้า "เดียว" ของการเขียน plan/plan_expires_at ทั้งระบบ (payment อนุมัติ /
// admin grant / free trial / downgrade เรียกตัวนี้ทั้งหมด)
//
// ⚠️ Reset expiry_reminder_sent_at = null ทุกครั้ง (migration 030): วันหมดอายุเพิ่ง
// เปลี่ยน "รอบบิลใหม่" จึงเริ่มนับการเตือนใหม่ด้วย — ถ้าไม่ Reset ผู้ใช้ที่ต่ออายุแล้ว
// จะไม่ได้รับการเตือนอีกเลยตลอดชีพ (ปั๊มค้างจากรอบก่อน) วางไว้ที่นี่จุดเดียวเพราะเป็น
// Choke Point ที่ทุก Path ต้องผ่าน — ไม่ต้องไล่แก้ทีละ Caller และไม่มีทางลืม
// (กรณี downgrade เป็น free ก็ Reset ด้วย ซึ่งถูกต้อง: ไม่มีอะไรให้เตือนแล้ว และถ้า
// กลับมา Premium อีกครั้งก็ควรเตือนได้ใหม่)
async function updatePlan(userId, plan, expiresAt) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      plan,
      plan_expires_at: expiresAt,
      expiry_reminder_sent_at: null,
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update plan for user ${userId}: ${error.message}`);
  }

  return toUser(data);
}

// ── Atomic Claim: กดรับ Premium ฟรี 1 เดือน (ครั้งเดียวตลอดชีพ) ────────────────
// หัวใจของการกัน "กดซ้ำ/กดรัวพร้อมกัน": ให้สิทธิ์ (plan + plan_expires_at) กับปั๊มว่า
// ใช้สิทธิ์แล้ว (free_trial_claimed_at) เกิดใน UPDATE Statement เดียวกัน พร้อมเงื่อนไข
// WHERE free_trial_claimed_at IS NULL — Postgres รับประกันว่ามีแค่ Request เดียวที่
// Match ได้ อีกตัวจะได้ 0 แถวกลับมา (Pattern เดียวกับ paymentRepository.claimForApproval)
//
// คืน null = "มีคนชิงไปแล้ว/เคยกดรับแล้ว" ให้ Caller ตอบ ALREADY_CLAIMED
// คืน user = Claim สำเร็จ (สิทธิ์ถูกเขียนลง DB เรียบร้อยแล้วจริง)
//
// ⚠️ ห้ามแยกเป็น 2 Statement (update plan แล้วค่อย update claimed_at) เด็ดขาด —
// Supabase JS ไม่มี Transaction ครอบ ถ้าแยกจะมีช่องให้ 2 Request ผ่าน Guard พร้อมกัน
// แล้วได้ Premium 2 เดือน (Stack) ซึ่งผิดข้อกำหนด "1 เดือนเท่านั้น"
async function claimFreeTrial(userId, expiresAt, now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      plan: 'premium',
      plan_expires_at: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
      free_trial_claimed_at: now.toISOString(),
      // รอบบิลใหม่ → เริ่มนับการเตือนใหม่ (เหตุผลเดียวกับ updatePlan ด้านบน)
      expiry_reminder_sent_at: null,
    })
    .eq('id', userId)
    .is('free_trial_claimed_at', null)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim free trial for user ${userId}: ${error.message}`);
  }

  return toUser(data);
}

// ── Atomic Grant: Premium ฟรี 1 เดือน จากแคมเปญ Like Facebook (Admin อนุมัติ) ──
// หลักการเดียวกับ claimFreeTrial ด้านบนเป๊ะ ต่างกันแค่คอลัมน์ Guard: ให้สิทธิ์
// (plan + plan_expires_at) กับปั๊มว่าใช้สิทธิ์แล้ว (facebook_like_granted_at) เกิดใน
// UPDATE Statement เดียวกัน พร้อมเงื่อนไข WHERE facebook_like_granted_at IS NULL
//
// ⚠️ ใช้คอลัมน์แยกจาก free_trial_claimed_at โดยเจตนา (migration 031) — คนละแคมเปญกัน
// การกัน "ได้ทั้งสองแคมเปญ" เป็นหน้าที่ของ Service (checkEligibility) ไม่ใช่คอลัมน์นี้
//
// คืน null = "เคยได้สิทธิ์แคมเปญนี้ไปแล้ว/มีคนชิงไปก่อน" ให้ Caller ตอบ ALREADY_GRANTED
// คืน user = Grant สำเร็จ (สิทธิ์ถูกเขียนลง DB เรียบร้อยแล้วจริง)
async function grantFacebookLikePremium(userId, expiresAt, now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({
      plan: 'premium',
      plan_expires_at: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
      facebook_like_granted_at: now.toISOString(),
      // รอบบิลใหม่ → เริ่มนับการเตือนใหม่ (เหตุผลเดียวกับ updatePlan/claimFreeTrial)
      expiry_reminder_sent_at: null,
    })
    .eq('id', userId)
    .is('facebook_like_granted_at', null)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to grant facebook like premium for user ${userId}: ${error.message}`);
  }

  return toUser(data);
}

// ── Cron เตือนก่อน Premium หมดอายุ ────────────────────────────────────────────
// หาคนที่ plan='premium' + วันหมดอายุอยู่ในช่วง (now, cutoff] + ยังไม่เคยเตือนรอบนี้
//
// .gt('plan_expires_at', nowIso) สำคัญ: ตัดคนที่ "หมดอายุไปแล้ว" ออก — คนกลุ่มนั้น
// เป็นงานของ planDowngrade.job (ตอบข้อความคนละแบบ: "หมดอายุแล้ว" ไม่ใช่ "ใกล้หมด")
// ถ้าไม่กรอง จะยิง Push ซ้อนกันสองใบในวันเดียวกัน
async function findPremiumExpiringBefore(cutoff, now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('plan', 'premium')
    .gt('plan_expires_at', now.toISOString())
    .lte('plan_expires_at', cutoff.toISOString())
    .is('expiry_reminder_sent_at', null);

  if (error) {
    throw new Error(`Failed to find premium users expiring soon: ${error.message}`);
  }

  return (data ?? []).map(toUser);
}

// ปั๊มว่าเตือนแล้ว — เรียก "หลัง" Push สำเร็จเท่านั้น (ถ้าปั๊มก่อนแล้ว Push พัง ผู้ใช้
// จะไม่ได้รับการเตือนเลยทั้งรอบบิล ซึ่งแย่กว่าการเสี่ยงเตือนซ้ำ 1 ใบ)
async function markExpiryReminderSent(userId, now = new Date()) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({ expiry_reminder_sent_at: now.toISOString() })
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to mark expiry reminder sent for user ${userId}: ${error.message}`);
  }
}

module.exports = {
  findByLineUserId,
  findById,
  findAll,
  create,
  findExpiredPremiumUsers,
  updatePlan,
  claimFreeTrial,
  grantFacebookLikePremium,
  findPremiumExpiringBefore,
  markExpiryReminderSent,
  updateDisplayName,
  setPdpaConsent,
  anonymize,
  setLock,
};
