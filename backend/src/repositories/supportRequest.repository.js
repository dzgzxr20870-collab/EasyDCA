const { supabaseAdmin } = require('../config/supabase');

// ตาราง support_requests (migrations/025_create_support_requests.sql) — Append-only
// Log เขียนผ่าน supabaseAdmin (service_role) เท่านั้น (Pattern เดียวกับ
// broadcastLog.repository / premiumGrantLog.repository)
function toSupportRequest(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    message: row.message,
    adminCount: row.admin_count,
    notifiedCount: row.notified_count,
    createdAt: row.created_at,
  };
}

// บันทึก Log 1 แถวหลัง Push หา Admin เสร็จ (ผลนับจริง ณ ตอน Push — เรียกหลัง Push
// เท่านั้น ไม่ใช่ก่อน เพื่อให้ adminCount/notifiedCount เป็นค่าสุดท้ายในการ Insert
// ครั้งเดียว ไม่ต้องมี UPDATE ตามมาทีหลัง — Pattern เดียวกับ broadcastLogRepository.create)
async function create(data) {
  const { data: row, error } = await supabaseAdmin
    .from('support_requests')
    .insert({
      user_id: data.userId,
      message: data.message,
      admin_count: data.adminCount,
      notified_count: data.notifiedCount,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create support request log: ${error.message}`);
  }

  return toSupportRequest(row);
}

// คืนแถวล่าสุดของ User นี้ที่ created_at ใหม่กว่าหรือเท่ากับ cutoff (หรือ null ถ้า
// ไม่มี) — ใช้เช็ค Rate Limit (Service ส่ง cutoff = now - 1 ชม. มาให้)
async function findRecentByUser(userId, cutoffIso) {
  const { data, error } = await supabaseAdmin
    .from('support_requests')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find recent support request for user ${userId}: ${error.message}`);
  }

  return toSupportRequest(data);
}

module.exports = { create, findRecentByUser };
