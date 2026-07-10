const { supabaseAdmin } = require('../config/supabase');

// จำนวนครั้งที่อ่านสลิปสำเร็จของ user ในเดือน year_month ('YYYY-MM') — คืน 0 ถ้ายังไม่มีแถว
// (ยังไม่เคยใช้เดือนนี้) ใช้เช็คโควตา "ก่อน" เรียก Claude API (กันเสียเงินโดยไม่จำเป็น)
async function getUsageCount(userId, yearMonth) {
  const { data, error } = await supabaseAdmin
    .from('ai_ocr_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get AI OCR usage for user ${userId}: ${error.message}`);
  }

  return data?.count ?? 0;
}

// บวกโควตาการใช้ +1 แบบ Atomic ผ่าน Postgres Function (migration 011) — คืน "count ใหม่"
// หลังบวกแล้ว ใช้ RPC แทน Read-Modify-Write ในชั้น App เพื่อกัน Race Condition
// (สองรูปพร้อมกันของ user เดียวกันจะไม่นับหายไปแม้อ่านค่าเดิมชุดเดียวกัน)
async function incrementUsage(userId, yearMonth) {
  const { data, error } = await supabaseAdmin.rpc('increment_ai_ocr_usage', {
    p_user_id: userId,
    p_year_month: yearMonth,
  });

  if (error) {
    throw new Error(`Failed to increment AI OCR usage for user ${userId}: ${error.message}`);
  }

  return data; // count ใหม่ (Number)
}

module.exports = {
  getUsageCount,
  incrementUsage,
};
