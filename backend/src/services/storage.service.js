const { supabaseAdmin } = require('../config/supabase');

// Error ที่มี code (Pattern เดียวกับ TransactionServiceError/PaymentServiceError) เพื่อให้
// Controller Map เป็นข้อความไทยได้ ไม่ปล่อย Error ดิบถึงผู้ใช้
class StorageServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StorageServiceError';
    this.code = code;
    this.details = details;
  }
}

// MIME Type ที่อนุญาตสำหรับรูปสลิป (Payment Beta Hardening) — ตรงกับชุดที่
// extensionFromContentType ด้านล่างรู้จักอยู่แล้ว (jpeg/png/webp/gif) ปฏิเสธ Content-Type
// อื่นทั้งหมด (เช่น application/pdf, text/html) แทนการเดานามสกุลเป็น .jpg แบบเงียบๆ
// เหมือนพฤติกรรมเดิม — กันไฟล์ที่ไม่ใช่รูปถูกอัปโหลดขึ้น Storage จริง
const ALLOWED_SLIP_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ขนาดไฟล์สูงสุดของรูปสลิป — 10MB เพียงพอสำหรับรูปถ่ายสลิปโอนเงินจากมือถือ (ไม่มี
// ค่าคงที่เดิมในโปรเจกต์ให้ Reuse เรื่องขนาดไฟล์ จึงกำหนดใหม่ที่นี่)
const MAX_SLIP_SIZE_BYTES = 10 * 1024 * 1024;

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

// Bucket ส่วนตัวสำหรับรูปสลิปซื้อ/ขายสินทรัพย์ที่ AI OCR อ่าน (S8) — แยกจาก
// payment-slips คนละ Domain (นั่นคือหลักฐานโอนเงินค่า Premium, นี่คือหลักฐานธุรกรรม
// การลงทุนของผู้ใช้เอง)
//
// ⚠️ Private โดยเจตนา (ต่างจาก payment-slips ที่ Public): สลิปจากแอปโบรกเกอร์
// (Bitkub/Binance/Settrade/Dime) มักแสดงเลขที่บัญชี ยอดคงเหลือ และชื่อเต็มของผู้ใช้
// ซึ่งละเอียดอ่อนกว่าสลิปโอนเงินมาก — ถ้าเป็น Public URL หลุดออกไปครั้งเดียวจะเปิดดู
// ได้ตลอดกาลโดยไม่ต้อง Login เข้าถึงได้เฉพาะผ่าน Signed URL อายุสั้นที่ Backend
// สร้างให้ตอนเจ้าของกดดูเท่านั้น (Pattern เดียวกับ Bucket reports — Round 8)
const TRANSACTION_SLIP_BUCKET = 'transaction-slips';

// อายุ Signed URL ของสลิปธุรกรรม = 5 นาที (สั้นกว่ารายงาน 15 นาที) — ผู้ใช้กดดูแล้ว
// เปิดรูปทันที ไม่ต้องมีเวลาดาวน์โหลดไฟล์ใหญ่เหมือนรายงาน PDF/Excel จึงลดหน้าต่าง
// ความเสี่ยงให้แคบที่สุดเท่าที่ยังใช้งานได้จริง
const TRANSACTION_SLIP_SIGNED_URL_TTL_SECONDS = 5 * 60;

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
//
// ⚠️ Payment Beta Hardening — ตรวจ MIME Type + ขนาดไฟล์ "ก่อน" ยิง Supabase Storage
// เสมอ (ไม่ใช่แค่เดานามสกุลไฟล์เงียบๆ แบบเดิม) Reject ด้วย StorageServiceError ถ้า
// Content-Type ไม่อยู่ใน Allowlist หรือไฟล์ใหญ่เกิน MAX_SLIP_SIZE_BYTES — ไม่ตรวจเนื้อหา
// ภาพ (เช่นอ่านสลิปได้จริงไหม) นั่นเป็น Scope ของ slipOcr.service คนละเรื่องกัน
async function uploadPaymentSlip(paymentId, buffer, contentType) {
  if (!ALLOWED_SLIP_CONTENT_TYPES.includes(contentType)) {
    throw new StorageServiceError(
      'INVALID_SLIP_CONTENT_TYPE',
      `Unsupported content type for payment slip ${paymentId}: ${contentType}`,
      { paymentId, contentType }
    );
  }

  if (buffer.length > MAX_SLIP_SIZE_BYTES) {
    throw new StorageServiceError(
      'SLIP_TOO_LARGE',
      `Payment slip for ${paymentId} exceeds max size (${buffer.length} > ${MAX_SLIP_SIZE_BYTES} bytes)`,
      { paymentId, size: buffer.length, maxSize: MAX_SLIP_SIZE_BYTES }
    );
  }

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

// PDPA Erasure (userErasure.service) — ลบรูปสลิปทั้งหมดของ User คนหนึ่งออกจาก
// Bucket payment-slips จริง (Hard Delete — ต่างจาก users/transactions/payments ที่
// Anonymize เท่านั้น เพราะสลิปคือข้อมูลระบุตัวตนชัดเจนที่สุด และไม่มีประโยชน์ทาง
// บัญชีอีกต่อไปเมื่อไม่มี User ระบุตัวตนผูกอยู่แล้ว — ไม่ขัดกับ Payment Retention
// เพราะ payments Row ยังคงอยู่ครบ (Immutable) มีแค่ "รูปสลิปแนบ" เท่านั้นที่หายไป)
//
// รับ paymentIds ของ User คนนั้นทั้งหมด (ทุกสถานะ) — ต้อง List ไฟล์จริงในถัง Bucket
// แล้ว Filter ด้วย Prefix "{paymentId}-" (ไม่ใช่ Parse จาก payments.slip_image_url
// เฉยๆ) เพราะ uploadPaymentSlip ตั้งชื่อไฟล์ใหม่ทุกครั้งที่ผู้ใช้ส่งสลิปมา (upsert:
// false) — slip_image_url เก็บแค่ URL ล่าสุด ไฟล์เก่าที่เคยส่งมาก่อนหน้ายังค้างอยู่ใน
// Bucket โดยไม่มี Column ไหนอ้างอิงถึงแล้ว การ Parse จาก slip_image_url อย่างเดียว
// จะพลาดไฟล์เก่าเหล่านี้ไป
// คืนจำนวนไฟล์ที่ลบสำเร็จ — ไม่ throw ถ้าไม่มีไฟล์เลย (User ยังไม่เคยส่งสลิปมาก็ได้)
async function deleteAllSlipsForUser(paymentIds) {
  if (!paymentIds || paymentIds.length === 0) {
    return 0;
  }

  const { data: files, error: listError } = await supabaseAdmin.storage
    .from(SLIP_BUCKET)
    .list();

  if (listError) {
    throw new Error(`Failed to list payment slips: ${listError.message}`);
  }

  const prefixes = paymentIds.map((id) => `${id}-`);
  const matchedPaths = (files ?? [])
    .filter((file) => prefixes.some((prefix) => file.name.startsWith(prefix)))
    .map((file) => file.name);

  if (matchedPaths.length === 0) {
    return 0;
  }

  const { error: removeError } = await supabaseAdmin.storage
    .from(SLIP_BUCKET)
    .remove(matchedPaths);

  if (removeError) {
    throw new Error(`Failed to delete payment slips: ${removeError.message}`);
  }

  return matchedPaths.length;
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

// ── สลิปธุรกรรมจาก AI OCR (S8) ──────────────────────────────────────────────
// อัปโหลดรูปสลิปขึ้น Bucket transaction-slips (Private) คืน { path, token }
//
// token = ส่วนท้ายของชื่อไฟล์ ("{timestamp}.{ext}") ที่จะถูกพกผ่าน LINE Postback
// ไปยังขั้นยืนยัน — ⚠️ จงใจ "ไม่" พก path เต็มที่มี userId อยู่ข้างหน้า เพราะ Postback
// data มาจาก Client แก้ค่าได้: ถ้าพก path เต็ม ผู้ใช้ที่ประสงค์ร้ายสามารถแก้เป็น
// "{userIdคนอื่น}-....jpg" เพื่อแนบสลิปของคนอื่นเข้าธุรกรรมตัวเองได้ — ฝั่ง Confirm
// จึงประกอบ path กลับจาก user.id ที่ Authenticate แล้วเสมอ (buildTransactionSlipPath)
// ทำให้ token ที่ถูกแก้ชี้ได้แค่ไฟล์ในขอบเขตของผู้ใช้คนนั้นเองเท่านั้น
//
// ใช้ Guard MIME/ขนาดชุดเดียวกับ uploadPaymentSlip (Reuse ค่าคงที่เดิม ไม่ตั้งใหม่)
async function uploadTransactionSlip(userId, buffer, contentType) {
  if (!ALLOWED_SLIP_CONTENT_TYPES.includes(contentType)) {
    throw new StorageServiceError(
      'INVALID_SLIP_CONTENT_TYPE',
      `Unsupported content type for transaction slip: ${contentType}`,
      { userId, contentType }
    );
  }

  if (buffer.length > MAX_SLIP_SIZE_BYTES) {
    throw new StorageServiceError(
      'SLIP_TOO_LARGE',
      `Transaction slip exceeds max size (${buffer.length} > ${MAX_SLIP_SIZE_BYTES} bytes)`,
      { userId, size: buffer.length, maxSize: MAX_SLIP_SIZE_BYTES }
    );
  }

  const token = `${Date.now()}.${extensionFromContentType(contentType)}`;
  const path = buildTransactionSlipPath(userId, token);

  const { error } = await supabaseAdmin.storage
    .from(TRANSACTION_SLIP_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    throw new Error(`Failed to upload transaction slip for ${userId}: ${error.message}`);
  }

  return { path, token };
}

// ประกอบ Storage path จาก userId (Authenticate แล้ว) + token ที่พกมากับ Postback
// — จุดเดียวที่นิยามรูปแบบชื่อไฟล์ ใช้ร่วมกันทั้งตอน Upload และตอน Confirm เพื่อให้
// ทั้งสองฝั่งไม่มีทางประกอบชื่อไม่ตรงกัน
//
// Sanitize token กัน Path Traversal (เช่น "../../reports/xxx") — อนุญาตเฉพาะรูปแบบ
// "{ตัวเลข}.{นามสกุลรูป}" ที่ uploadTransactionSlip สร้างเท่านั้น คืน null ถ้าไม่ตรง
function buildTransactionSlipPath(userId, token) {
  if (!userId || typeof token !== 'string') return null;
  if (!/^\d{10,}\.(jpg|png|webp|gif)$/.test(token)) return null;
  return `${userId}-${token}`;
}

// สร้าง Signed URL อายุสั้นให้รูปสลิปธุรกรรม — คืน null ถ้า path ว่าง/Sign ไม่สำเร็จ
// (ไม่ throw: หน้า Dashboard ต้องแสดงรายการธุรกรรมได้ต่อแม้เปิดรูปไม่ได้)
async function createTransactionSlipSignedUrl(path) {
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(TRANSACTION_SLIP_BUCKET)
    .createSignedUrl(path, TRANSACTION_SLIP_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error(
      `[storage] failed to sign transaction slip ${path}: ${error?.message ?? 'no signedUrl'}`
    );
    return null;
  }

  return data.signedUrl;
}

// PDPA Erasure (userErasure.service) — ลบรูปสลิปธุรกรรมทั้งหมดของ User คนหนึ่งออกจาก
// Bucket transaction-slips จริง (Hard Delete — เหตุผลเดียวกับ deleteAllSlipsForUser ของ
// payment-slips: สลิปคือข้อมูลระบุตัวตนชัดเจนที่สุด ไม่มีประโยชน์เมื่อไม่มี User ผูกอยู่
// แล้ว ไม่ขัด Immutable Ledger เพราะ transactions Row ยังอยู่ครบ มีแค่ "รูปแนบ" หายไป)
//
// ⚠️ จงใจ List Bucket แล้ว Filter ด้วย Prefix "{userId}-" (ไม่ใช่ Query
// transactions.slip_image_path มาลบทีละ Path) ด้วยเหตุผลเดียวกับ deleteAllSlipsForUser:
// uploadTransactionSlip อัปโหลดไฟล์ขึ้นถัง "ตอน OCR อ่านสลิป" ก่อนผู้ใช้กดยืนยัน และ
// attachSlipImagePath เป็น Best-effort (Swallow Error) — ไฟล์ที่ผู้ใช้ส่งแล้วยกเลิก/แก้ไข
// หรือแนบไม่สำเร็จ จะค้างในถังโดยไม่มีแถวไหนอ้างถึง การลบจาก slip_image_path อย่างเดียว
// จะทิ้งไฟล์เหล่านั้น (ซึ่งมีเลขบัญชี/ยอดคงเหลือ) ไว้ตลอดกาล = รูรั่ว PDPA เดิมย้ายที่
//
// buildTransactionSlipPath การันตีชื่อไฟล์เป็น "{userId}-{token}" เสมอ — userId (UUID)
// เป็นส่วนนำที่ไม่เปลี่ยน จึง Filter ด้วย Prefix ปลอดภัย (UUID เต็มไม่เป็น Prefix ของ
// UUID อื่น) ส่ง search=userId ให้ Supabase กรองชั้นแรกก่อน ลดโอกาสชนเพดาน list
// คืนจำนวนไฟล์ที่ลบสำเร็จ — ไม่ throw ถ้าไม่มีไฟล์เลย (User ไม่เคยส่งสลิปธุรกรรมก็ได้)
async function deleteAllTransactionSlipsForUser(userId) {
  if (!userId) {
    return 0;
  }

  const { data: files, error: listError } = await supabaseAdmin.storage
    .from(TRANSACTION_SLIP_BUCKET)
    .list('', { search: userId });

  if (listError) {
    throw new Error(`Failed to list transaction slips: ${listError.message}`);
  }

  const prefix = `${userId}-`;
  const matchedPaths = (files ?? [])
    .filter((file) => file.name.startsWith(prefix))
    .map((file) => file.name);

  if (matchedPaths.length === 0) {
    return 0;
  }

  const { error: removeError } = await supabaseAdmin.storage
    .from(TRANSACTION_SLIP_BUCKET)
    .remove(matchedPaths);

  if (removeError) {
    throw new Error(`Failed to delete transaction slips: ${removeError.message}`);
  }

  return matchedPaths.length;
}

module.exports = {
  StorageServiceError,
  SLIP_BUCKET,
  REPORT_BUCKET,
  REPORT_SIGNED_URL_TTL_SECONDS,
  TRANSACTION_SLIP_BUCKET,
  TRANSACTION_SLIP_SIGNED_URL_TTL_SECONDS,
  MAX_SLIP_SIZE_BYTES,
  uploadPaymentSlip,
  deleteAllSlipsForUser,
  uploadReport,
  uploadTransactionSlip,
  buildTransactionSlipPath,
  createTransactionSlipSignedUrl,
  deleteAllTransactionSlipsForUser,
};
