const { supabaseAdmin } = require('../config/supabase');

// ตารางเก็บการตั้งเตือน DCA (migrations/002_create_dca_reminders.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role
// เท่านั้น — LINE User ไม่มี auth.uid() session (Pattern เดียวกับ pending_transactions)
function toReminder(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    frequency: row.frequency,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    amountThb: row.amount_thb,
    // Multi-Currency (migration 020) — สกุลของ amount_thb ในแถวนี้ (แถวเดิม/ไม่มีค่า
    // = 'THB' ตาม DEFAULT) แบบเดียวกับ transaction.repository.toTransaction
    currency: row.currency ?? 'THB',
    active: row.active,
    lastNotifiedDate: row.last_notified_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // มีเฉพาะ Query ที่ Join users (findActiveDueCandidates) — Query อื่นเป็น null
    lineUserId: row.users?.line_user_id ?? null,
  };
}

async function insert(data) {
  const { data: row, error } = await supabaseAdmin
    .from('dca_reminders')
    .insert({
      user_id: data.userId,
      symbol: data.symbol,
      frequency: data.frequency,
      day_of_week: data.dayOfWeek ?? null,
      day_of_month: data.dayOfMonth ?? null,
      amount_thb: data.amountThb,
      // Default 'THB' เมื่อ Caller ไม่ส่ง (LINE Path เดิม) — migration 020
      currency: data.currency ?? 'THB',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create reminder: ${error.message}`);
  }

  return toReminder(row);
}

// Soft-delete: ปิด Reminder ที่ยัง active ของ (user, symbol) — ไม่ลบแถวจริง
// (DATABASE.md § 8) ใช้ทั้งตอน createReminder (ปิดตัวเก่าก่อนสร้างใหม่) และ
// deleteReminder — คืนจำนวนแถวที่ถูกปิด (0 = ไม่มี Active ให้ปิด)
async function deactivateActive(userId, symbol) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .update({ active: false })
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .eq('active', true)
    .select('id');

  if (error) {
    throw new Error(`Failed to deactivate reminder for ${symbol}: ${error.message}`);
  }

  return data ? data.length : 0;
}

async function findActiveByUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to find active reminders for user ${userId}: ${error.message}`);
  }

  return data.map(toReminder);
}

// ดึง Reminder ที่ยัง active และ "ยังไม่ถูก Notify ในวัน dateStr" — Join users
// เพื่อได้ line_user_id ไว้ Push ได้เลย การกรองว่าตรง "วันนี้" จริงไหม (day_of_week
// /day_of_month + สิ้นเดือน) ทำต่อที่ Service Layer เพราะ Logic สิ้นเดือนไม่เหมาะ
// เขียนใน SQL (migration 002 ระบุให้ App Layer จัดการ)
async function findActiveDueCandidates(dateStr) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .select('*, users(line_user_id)')
    .eq('active', true)
    .or(`last_notified_date.is.null,last_notified_date.neq.${dateStr}`);

  if (error) {
    throw new Error(`Failed to find due reminder candidates for ${dateStr}: ${error.message}`);
  }

  return data.map(toReminder);
}

// ── Web DCA Planner (S8 R3) — CRUD by id สำหรับ /api/v1/dca-plans ────────────
// ต่างจาก Path LINE (createReminder/deactivate by symbol) — เว็บจัดการรายแผน by id

// ดึงทุกแถวของ User แล้วเก็บ "แถวล่าสุดต่อ symbol" (latest by created_at) — ซ่อน
// tombstone เก่า (createReminder เดิม deactivate ตัวเก่า+insert ใหม่ทุกครั้ง จึงมีแถว
// active=false สะสม) และแสดงได้ทั้ง active (กำลังทำงาน) + paused (แถวล่าสุด active=false)
// PostgREST ไม่มี DISTINCT ON → Dedupe ในชั้น App (Pattern เดียวกับ
// transaction.repository.findAllUserIdsWithTransactions)
async function findLatestPerSymbolByUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to find plans for user ${userId}: ${error.message}`);
  }

  const seen = new Set();
  const latest = [];
  for (const row of data) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    latest.push(toReminder(row));
  }

  return latest;
}

// คืนแถวเดียว scope ด้วย user_id เสมอ (กัน IDOR — เว็บส่ง id มาแต่ userId มาจาก JWT)
// คืน null ถ้าไม่พบ/ไม่ใช่ของ user
async function findByIdForUser(id, userId) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find plan ${id}: ${error.message}`);
  }

  return toReminder(data);
}

// UPDATE เฉพาะ Field ที่ส่งมาใน patch (snake_case column) WHERE id + user_id
// คืนแถวใหม่ หรือ null ถ้าไม่พบ (ไม่ใช่ของ user / ไม่มี id นั้น)
async function updateByIdForUser(id, userId, patch) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update plan ${id}: ${error.message}`);
  }

  return toReminder(data);
}

// DELETE จริง (Hard delete) WHERE id + user_id — ตารางนี้เป็น Config ไม่ใช่ Ledger
// (ต่างจาก deactivateActive ที่เป็น Soft-delete ของ Path LINE) คืนจำนวนแถวที่ลบ (0/1)
async function deleteByIdForUser(id, userId) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    throw new Error(`Failed to delete plan ${id}: ${error.message}`);
  }

  return data ? data.length : 0;
}

// อัปเดต last_notified_date หลัง Push สำเร็จ — กัน Push ซ้ำในวันเดียวกัน
async function markNotified(id, dateStr) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminders')
    .update({ last_notified_date: dateStr })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to mark reminder ${id} as notified: ${error.message}`);
  }

  return toReminder(data);
}

module.exports = {
  insert,
  deactivateActive,
  findActiveByUser,
  findActiveDueCandidates,
  findLatestPerSymbolByUser,
  findByIdForUser,
  updateByIdForUser,
  deleteByIdForUser,
  markNotified,
};
