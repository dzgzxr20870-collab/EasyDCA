const { supabaseAdmin } = require('../config/supabase');

// Bucket สาธารณะสำหรับเก็บรูปสลิปการชำระเงิน — ต้องสร้างเองผ่าน Supabase Dashboard
// เป็น "Public Bucket" ก่อนใช้งานจริง (สร้างผ่าน Migration SQL ไม่ได้ตามปกติ ดูรายงาน
// Round 5) เลือก Public เพื่อให้แนบ URL ในFlexMessage หา Admin ได้ทันทีโดยไม่ต้อง Sign
const SLIP_BUCKET = 'payment-slips';

// เดานามสกุลไฟล์จาก Content-Type ที่ LINE ส่งมา — สลิปโอนเงินส่วนใหญ่เป็น JPEG
// จึง Fallback เป็น jpg ถ้าไม่รู้จัก (นามสกุลมีผลแค่ความสวยงามของ URL ไม่กระทบการแสดงผล
// เพราะเราตั้ง contentType ตอน upload ให้ตรงกับของจริงอยู่แล้ว)
function extensionFromContentType(contentType) {
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

// อัปโหลดรูปสลิปขึ้น Bucket payment-slips ด้วยชื่อไฟล์ไม่ซ้ำ ({paymentId}-{timestamp}.{ext})
// คืน Public URL เต็มกลับมา — throw ถ้าอัปโหลดล้มเหลว (Caller ห่อ try/catch เพื่อกัน Webhook พัง)
//
// ตั้งชื่อไฟล์ใหม่ทุกครั้ง (upsert: false, ไม่ Overwrite) เผื่อผู้ใช้ส่งสลิปหลายรูป —
// payments.slip_image_url จะถูกอัปเดตให้ชี้ไปรูป "ล่าสุด" เสมอ (ดู updateSlipImageUrl)
// ส่วนรูปเก่ายังคงอยู่ใน Storage โดยไม่กระทบการทำงาน (เลือกเก็บทุกรูปแทนการทับ เพื่อกัน
// Race และเผื่อ Admin ย้อนดูสลิปก่อนหน้าได้ถ้าจำเป็น)
async function uploadPaymentSlip(paymentId, buffer, contentType) {
  const ext = extensionFromContentType(contentType);
  const path = `${paymentId}-${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(SLIP_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    throw new Error(`Failed to upload payment slip for ${paymentId}: ${error.message}`);
  }

  const { data } = supabaseAdmin.storage.from(SLIP_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

module.exports = {
  SLIP_BUCKET,
  uploadPaymentSlip,
};
