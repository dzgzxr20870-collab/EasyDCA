const { supabaseAdmin } = require('../config/supabase');

// Bucket สาธารณะสำหรับเก็บรูปสลิปการชำระเงิน — ต้องสร้างเองผ่าน Supabase Dashboard
// เป็น "Public Bucket" ก่อนใช้งานจริง (สร้างผ่าน Migration SQL ไม่ได้ตามปกติ ดูรายงาน
// Round 5) เลือก Public เพื่อให้แนบ URL ในFlexMessage หา Admin ได้ทันทีโดยไม่ต้อง Sign
const SLIP_BUCKET = 'payment-slips';

// Bucket ส่วนตัวสำหรับเก็บไฟล์รายงาน Export (Phase 3 Round 8) — ต้องสร้างเองผ่าน
// Supabase Dashboard เป็น "Private Bucket" ก่อนใช้งานจริง (สร้างผ่าน Migration SQL
// ไม่ได้ตามปกติ เหมือน payment-slips ใน Round 5) เลือก Private (ต่างจาก payment-slips
// ที่เป็น Public) เพราะรายงานมีข้อมูลการเงินละเอียดของผู้ใช้ — เข้าถึงได้เฉพาะผ่าน
// Signed URL อายุสั้นที่ Backend สร้างให้เท่านั้น
const REPORT_BUCKET = 'reports';

// อายุของ Signed URL รายงาน = 15 นาที (900 วินาที) — Supabase createSignedUrl รับ
// expiresIn เป็น "วินาที" (ยืนยันจาก @supabase/storage-js: createSignedUrl(path, expiresIn))
const REPORT_SIGNED_URL_TTL_SECONDS = 15 * 60;

const REPORT_EXT = { pdf: 'pdf', excel: 'xlsx' };
const REPORT_CONTENT_TYPE = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

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

// อัปโหลดไฟล์รายงานขึ้น Bucket reports (Private) แล้วสร้าง Signed URL อายุ 15 นาที
// คืน { path, signedUrl, expiresInSeconds } — throw ถ้าอัปโหลด/Sign ล้มเหลว (Caller
// ห่อ try/catch เพื่อกัน Webhook พัง)
//
// ตั้งชื่อไฟล์ไม่ซ้ำด้วย {userId}-{timestamp}.{ext} (Pattern เดียวกับ payment-slips —
// กันชนกันเมื่อผู้ใช้ Export หลายครั้ง) format = 'pdf' | 'excel'
async function uploadReport(userId, buffer, format) {
  const ext = REPORT_EXT[format];
  const contentType = REPORT_CONTENT_TYPE[format];
  if (!ext || !contentType) {
    throw new Error(`Unknown report format: ${format}`);
  }

  const path = `${userId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(REPORT_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(`Failed to upload report for ${userId}: ${uploadError.message}`);
  }

  const { data, error: signError } = await supabaseAdmin.storage
    .from(REPORT_BUCKET)
    .createSignedUrl(path, REPORT_SIGNED_URL_TTL_SECONDS);

  if (signError || !data?.signedUrl) {
    throw new Error(
      `Failed to create signed URL for report ${path}: ${signError?.message ?? 'no signedUrl returned'}`
    );
  }

  return {
    path,
    signedUrl: data.signedUrl,
    expiresInSeconds: REPORT_SIGNED_URL_TTL_SECONDS,
  };
}

module.exports = {
  SLIP_BUCKET,
  REPORT_BUCKET,
  REPORT_SIGNED_URL_TTL_SECONDS,
  uploadPaymentSlip,
  uploadReport,
};
