const { supabaseAdmin } = require('../config/supabase');

// ตารางเก็บ State การตั้งเตือน DCA แบบหลายขั้นตอน
// (migrations/003_create_dca_reminder_setup_sessions.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role
// เท่านั้น — LINE User ไม่มี auth.uid() session (Pattern เดียวกับ pending_transactions)
function toSession(row) {
  if (!row) return null;

  return {
    userId: row.user_id,
    step: row.step,
    symbol: row.symbol,
    frequency: row.frequency,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// สร้าง/เขียนทับ Session ของ User (user_id เป็น PK → UPSERT) — ใช้ตอน startFlow
// เพื่อ Reset ทุก Field เป็นค่าเริ่มต้นของ Flow ใหม่เสมอ (ไม่ให้ 2 Session ปนกัน)
async function upsert(data) {
  const { data: row, error } = await supabaseAdmin
    .from('dca_reminder_setup_sessions')
    .upsert(
      {
        user_id: data.userId,
        step: data.step,
        symbol: data.symbol ?? null,
        frequency: data.frequency ?? null,
        day_of_week: data.dayOfWeek ?? null,
        day_of_month: data.dayOfMonth ?? null,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to upsert reminder setup session: ${error.message}`);
  }

  return toSession(row);
}

// คืน Session ที่ "ยังไม่หมดอายุ" — updated_at ต้องใหม่กว่าหรือเท่ากับ cutoff
// (Service ส่ง cutoff = now - TTL มาให้) ถ้าหมดอายุแล้วจะคืน null เสมือนไม่มี
// Session เพื่อให้ Flow ตอบ SETUP_SESSION_NOT_FOUND แนะนำให้เริ่มใหม่
async function findValidByUser(userId, cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminder_setup_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('updated_at', cutoffIso)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find reminder setup session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// อัปเดตบาง Field ของ Session (เดินขั้นถัดไป) — updated_at ถูก Bump โดย Trigger
// patch เป็น Object แบบ snake_case ที่พร้อมส่งเข้า Supabase แล้ว
async function updateByUser(userId, patch) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminder_setup_sessions')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update reminder setup session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// ลบ Session ทิ้ง (จบ Flow สำเร็จ หรือผู้ใช้กดยกเลิก) — Working State ลบจริงได้
async function deleteByUser(userId) {
  const { error } = await supabaseAdmin
    .from('dca_reminder_setup_sessions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete reminder setup session for user ${userId}: ${error.message}`);
  }
}

// Hard DELETE Session ที่ updated_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว) —
// สำหรับ Cron Purge คืนจำนวนแถวที่ถูกลบ
async function purgeStaleBefore(cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('dca_reminder_setup_sessions')
    .delete()
    .lt('updated_at', cutoffIso)
    .select('user_id');

  if (error) {
    throw new Error(`Failed to purge stale reminder setup sessions: ${error.message}`);
  }

  return data ? data.length : 0;
}

module.exports = {
  upsert,
  findValidByUser,
  updateByUser,
  deleteByUser,
  purgeStaleBefore,
};
