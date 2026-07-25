const { supabaseAdmin } = require('../config/supabase');

// ตารางเก็บสถานะ "รอข้อความแจ้งปัญหา" ของ Flow ติดต่อ Admin/Support
// (migrations/024_create_support_request_sessions.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role
// เท่านั้น — LINE User ไม่มี auth.uid() session (Pattern เดียวกับ
// guidedBuySession.repository / reminderSetupSession.repository)
function toSession(row) {
  if (!row) return null;

  return {
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

// สร้าง/เขียนทับ Session ของ User (user_id เป็น PK → UPSERT) — รีเซ็ต created_at
// เสมอ แม้เป็นการเขียนทับ Session ของตัวเอง (พิมพ์ Trigger ซ้ำ = เริ่มนับ TTL ใหม่)
async function upsert(userId) {
  const { data, error } = await supabaseAdmin
    .from('support_request_sessions')
    .upsert(
      { user_id: userId, created_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to upsert support request session: ${error.message}`);
  }

  return toSession(data);
}

// คืน Session ที่ "ยังไม่หมดอายุ" — created_at ต้องใหม่กว่าหรือเท่ากับ cutoff
// (Service ส่ง cutoff = now - TTL มาให้) ถ้าหมดอายุแล้วจะคืน null เสมือนไม่มี Session
async function findValidByUser(userId, cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('support_request_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', cutoffIso)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find support request session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// ลบ Session ทิ้ง (จบ Flow สำเร็จ หรือผู้ใช้กดยกเลิก) — Idempotent ลบซ้ำไม่เป็นไร
async function deleteByUser(userId) {
  const { error } = await supabaseAdmin
    .from('support_request_sessions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete support request session for user ${userId}: ${error.message}`);
  }
}

// Hard DELETE Session ที่ created_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว) —
// สำหรับ Cron Purge คืนจำนวนแถวที่ถูกลบ
async function purgeStaleBefore(cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('support_request_sessions')
    .delete()
    .lt('created_at', cutoffIso)
    .select('user_id');

  if (error) {
    throw new Error(`Failed to purge stale support request sessions: ${error.message}`);
  }

  return data ? data.length : 0;
}

module.exports = {
  upsert,
  findValidByUser,
  deleteByUser,
  purgeStaleBefore,
};
