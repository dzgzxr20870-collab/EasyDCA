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
  markNotified,
};
