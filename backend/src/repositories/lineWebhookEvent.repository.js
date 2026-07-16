const { supabaseAdmin } = require('../config/supabase');

// Claim event_id แบบ Atomic (migration 013) — ป้องกันประมวลผล LINE Webhook Event
// ซ้ำเมื่อ LINE Retry ส่ง Event เดิมมาอีกครั้ง (Server ตอบ 200 ไม่ทันรอบแรก)
//
// ใช้ upsert({ ignoreDuplicates: true }) แทน insert() ตรงๆ เพราะ Supabase JS Client
// ไม่มี insert().onConflict('DO NOTHING') ตรงๆ — upsert + ignoreDuplicates คือ
// INSERT ... ON CONFLICT (event_id) DO NOTHING ในคำสั่งเดียว (Atomic รอบเดียว ไม่ใช่
// SELECT แล้วค่อย INSERT ซึ่งมี Race Condition เมื่อ Request ซ้อนกันพอดี — Bug Class
// เดียวกับที่ pendingTransaction.claimForConfirm ถูกออกแบบมาป้องกัน)
//
// .select() ท้ายคำสั่งคืนแถวที่ถูก Insert จริงเท่านั้น — ถ้าชน Conflict (DO NOTHING)
// จะไม่มี Row ให้ RETURNING เลย จึงคืน [] ว่าง ใช้แยกระหว่าง "Insert สำเร็จ (Claim ได้)"
// กับ "มีอยู่แล้ว (Event ซ้ำ)" ได้ตรงๆ จากความยาว Array โดยไม่ต้อง Query แยก
async function claimEvent(eventId) {
  const { data, error } = await supabaseAdmin
    .from('line_webhook_events')
    .upsert({ event_id: eventId }, { onConflict: 'event_id', ignoreDuplicates: true })
    .select();

  if (error) {
    throw new Error(`Failed to claim webhook event ${eventId}: ${error.message}`);
  }

  return data.length > 0;
}

// ลบ Event ที่เก่ากว่า Retention Cutoff (7 วัน — webhookEventCleanup.job.js)
// คืนจำนวนแถวที่ถูกลบ (Pattern เดียวกับ pendingTransaction.repository.purgeResolvedBefore)
async function purgeOlderThan(cutoffDate) {
  const { data, error } = await supabaseAdmin
    .from('line_webhook_events')
    .delete()
    .lt('received_at', cutoffDate)
    .select('event_id');

  if (error) {
    throw new Error(`Failed to purge old webhook events: ${error.message}`);
  }

  return data ? data.length : 0;
}

module.exports = {
  claimEvent,
  purgeOlderThan,
};
