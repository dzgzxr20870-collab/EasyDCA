const { supabaseAdmin } = require('../config/supabase');

// ตาราง broadcast_logs (migrations/006_create_broadcast_logs.sql) — Append-only Log
// เขียนผ่าน supabaseAdmin (service_role) เท่านั้น (Pattern เดียวกับ repository อื่น)
function toBroadcastLog(row) {
  if (!row) return null;

  return {
    id: row.id,
    sentBy: row.sent_by,
    targetGroup: row.target_group,
    messageType: row.message_type,
    messageContent: row.message_content,
    totalRecipients: row.total_recipients,
    successCount: row.success_count,
    failureCount: row.failure_count,
    createdAt: row.created_at,
  };
}

// บันทึก Log 1 แถวหลังส่ง Broadcast เสร็จ (ผลนับจริง success/failure ต่อครั้ง)
async function create(data) {
  const { data: row, error } = await supabaseAdmin
    .from('broadcast_logs')
    .insert({
      sent_by: data.sentBy,
      target_group: data.targetGroup,
      message_type: data.messageType,
      message_content: data.messageContent,
      total_recipients: data.totalRecipients,
      success_count: data.successCount,
      failure_count: data.failureCount,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create broadcast log: ${error.message}`);
  }

  return toBroadcastLog(row);
}

module.exports = { create };
