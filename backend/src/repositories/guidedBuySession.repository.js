const { supabaseAdmin } = require('../config/supabase');

// ตารางเก็บ State การบันทึก DCA แบบหลายขั้นตอน (Guided Buy — S8 R2 รอบ 2)
// (migrations/022_create_guided_buy_sessions.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role
// เท่านั้น — LINE User ไม่มี auth.uid() session (Pattern เดียวกับ
// reminderSetupSession.repository / pending_transactions)
function toSession(row) {
  if (!row) return null;

  return {
    userId: row.user_id,
    step: row.step,
    symbol: row.symbol,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// สร้าง/เขียนทับ Session ของ User (user_id เป็น PK → UPSERT) — ใช้ตอน startFlow
// เพื่อ Reset ทุก Field เป็นค่าเริ่มต้นของ Flow ใหม่เสมอ (ไม่ให้ 2 Session ปนกัน)
async function upsert(data) {
  const { data: row, error } = await supabaseAdmin
    .from('guided_buy_sessions')
    .upsert(
      {
        user_id: data.userId,
        step: data.step,
        symbol: data.symbol ?? null,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to upsert guided buy session: ${error.message}`);
  }

  return toSession(row);
}

// คืน Session ที่ "ยังไม่หมดอายุ" — updated_at ต้องใหม่กว่าหรือเท่ากับ cutoff
// (Service ส่ง cutoff = now - TTL มาให้) ถ้าหมดอายุแล้วจะคืน null เสมือนไม่มี
// Session เพื่อให้ Flow ตอบ GUIDED_BUY_SESSION_NOT_FOUND แนะนำให้เริ่มใหม่
async function findValidByUser(userId, cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('guided_buy_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('updated_at', cutoffIso)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find guided buy session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// อัปเดตบาง Field ของ Session (เดินขั้นถัดไป) — updated_at ถูก Bump โดย Trigger
// patch เป็น Object แบบ snake_case ที่พร้อมส่งเข้า Supabase แล้ว
async function updateByUser(userId, patch) {
  const { data, error } = await supabaseAdmin
    .from('guided_buy_sessions')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update guided buy session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// ลบ Session ทิ้ง (จบ Flow สำเร็จ หรือผู้ใช้กดยกเลิก) — Working State ลบจริงได้
async function deleteByUser(userId) {
  const { error } = await supabaseAdmin
    .from('guided_buy_sessions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete guided buy session for user ${userId}: ${error.message}`);
  }
}

// Hard DELETE Session ที่ updated_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว) —
// สำหรับ Cron Purge คืนจำนวนแถวที่ถูกลบ
async function purgeStaleBefore(cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('guided_buy_sessions')
    .delete()
    .lt('updated_at', cutoffIso)
    .select('user_id');

  if (error) {
    throw new Error(`Failed to purge stale guided buy sessions: ${error.message}`);
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
