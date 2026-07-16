const { supabaseAdmin } = require('../config/supabase');

// ตาราง erasure_logs (migrations/019_create_erasure_logs.sql) — Append-only Log
// เขียนผ่าน supabaseAdmin (service_role) เท่านั้น (Pattern เดียวกับ broadcastLog.repository)
function toErasureLog(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    hadPendingPayment: row.had_pending_payment,
    createdAt: row.created_at,
  };
}

// บันทึก Log 1 แถวหลัง Anonymize User สำเร็จ (PDPA Self-Service Erasure)
async function create(data) {
  const { data: row, error } = await supabaseAdmin
    .from('erasure_logs')
    .insert({
      user_id: data.userId,
      had_pending_payment: data.hadPendingPayment,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create erasure log: ${error.message}`);
  }

  return toErasureLog(row);
}

module.exports = { create };
