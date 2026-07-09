const { supabaseAdmin } = require('../config/supabase');

// ตารางเก็บ State "รอรับข้อความ Batch นำเข้าพอร์ต" (migrations/007_create_bulk_import_sessions.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role
// เท่านั้น — LINE User ไม่มี auth.uid() session (Pattern เดียวกับ
// reminderSetupSession.repository / pendingTransaction.repository)
function toSession(row) {
  if (!row) return null;

  return {
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// เริ่ม/เขียนทับ Session ของ User (user_id เป็น PK → UPSERT) — พิมพ์ "นำเข้าพอร์ต"
// ซ้ำ = Reset TTL ใหม่เสมอ ไม่ throw
async function upsert(userId) {
  const { data, error } = await supabaseAdmin
    .from('bulk_import_sessions')
    .upsert({ user_id: userId }, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to upsert bulk import session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// คืน Session ที่ "ยังไม่หมดอายุ" — updated_at ต้องใหม่กว่าหรือเท่ากับ cutoff
// (Service ส่ง cutoff = now - TTL มาให้) หมดอายุแล้ว → คืน null เสมือนไม่มี Session
async function findValidByUser(userId, cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('bulk_import_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('updated_at', cutoffIso)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find bulk import session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// ลบ Session ทิ้ง (Batch สำเร็จแล้ว) — Idempotent ลบซ้ำไม่เป็นไร
async function deleteByUser(userId) {
  const { error } = await supabaseAdmin.from('bulk_import_sessions').delete().eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete bulk import session for user ${userId}: ${error.message}`);
  }
}

// Hard DELETE Session ที่ updated_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว) —
// สำหรับ Cron Purge คืนจำนวนแถวที่ถูกลบ
async function purgeStaleBefore(cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('bulk_import_sessions')
    .delete()
    .lt('updated_at', cutoffIso)
    .select('user_id');

  if (error) {
    throw new Error(`Failed to purge stale bulk import sessions: ${error.message}`);
  }

  return data ? data.length : 0;
}

module.exports = {
  upsert,
  findValidByUser,
  deleteByUser,
  purgeStaleBefore,
};
