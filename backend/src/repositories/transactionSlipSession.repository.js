const { supabaseAdmin } = require('../config/supabase');

// ตารางเก็บสถานะ "กำลังรอรูปสลิปของรายการที่เพิ่งบันทึก" (migration 040)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role เท่านั้น —
// LINE User ไม่มี auth.uid() session (Pattern เดียวกับ guidedBuySession.repository)
function toSession(row) {
  if (!row) return null;

  return {
    userId: row.user_id,
    transactionId: row.transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// สร้าง/เขียนทับ Session ของ User (user_id เป็น PK → UPSERT)
//
// ⚠️ ต้อง Touch updated_at เองตรงนี้ด้วย ไม่พึ่ง Trigger อย่างเดียว: Trigger
// update_updated_at ทำงานเฉพาะ BEFORE UPDATE — เคส UPSERT ที่ชนแถวเดิม (ผู้ใช้บันทึก
// รายการที่ 2 ระหว่างที่ยังรอสลิปของรายการแรก) Supabase ส่งเป็น INSERT ... ON CONFLICT
// DO UPDATE ซึ่ง "ผ่าน" Trigger จริง แต่การส่งค่ามาเองทำให้ TTL เริ่มนับใหม่แน่นอน
// ไม่ขึ้นกับว่า Trigger ติดตั้งครบหรือไม่ในสภาพแวดล้อมนั้น
async function upsert(userId, transactionId) {
  const { data, error } = await supabaseAdmin
    .from('transaction_slip_sessions')
    .upsert(
      {
        user_id: userId,
        transaction_id: transactionId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to upsert transaction slip session: ${error.message}`);
  }

  return toSession(data);
}

// คืน Session ที่ "ยังไม่หมดอายุ" — updated_at ต้องใหม่กว่าหรือเท่ากับ cutoff
// (Service ส่ง cutoff = now - TTL มาให้) หมดอายุแล้วคืน null เสมือนไม่มี Session
// → รูปที่ส่งเข้ามาจะไหลไปเข้า AI OCR ตามเส้นทางเดิมทุกประการ
async function findValidByUser(userId, cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('transaction_slip_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('updated_at', cutoffIso)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find transaction slip session for user ${userId}: ${error.message}`);
  }

  return toSession(data);
}

// ลบ Session ทิ้ง (แนบรูปสำเร็จ/ผู้ใช้กดไม่แนบ) — Working State ลบจริงได้
async function deleteByUser(userId) {
  const { error } = await supabaseAdmin
    .from('transaction_slip_sessions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete transaction slip session for user ${userId}: ${error.message}`);
  }
}

// Hard DELETE Session ที่ updated_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว) —
// สำหรับ Cron Purge คืนจำนวนแถวที่ถูกลบ (Pattern เดียวกับ guidedBuySession)
async function purgeStaleBefore(cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('transaction_slip_sessions')
    .delete()
    .lt('updated_at', cutoffIso)
    .select('user_id');

  if (error) {
    throw new Error(`Failed to purge stale transaction slip sessions: ${error.message}`);
  }

  return data ? data.length : 0;
}

module.exports = {
  upsert,
  findValidByUser,
  deleteByUser,
  purgeStaleBefore,
};
