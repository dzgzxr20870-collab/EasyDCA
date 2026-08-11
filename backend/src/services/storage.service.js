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

// Bucket ส่วนตัวสำหรับเก็บรูปสลิปการชำระเงิน — ต้องสร้าง/ตั้งค่าเองผ่าน Supabase
// Dashboard (สร้างผ่าน Migration SQL ไม่ได้ตามปกติ ดูรายงาน Round 5)
//
// ⚠️ Offensive Review Round 2 (F4): เดิมเป็น "Public Bucket" โดยเจตนา เพื่อแนบ URL
// ใน Flex Message หา Admin ได้ทันทีโดยไม่ต้อง Sign — ซึ่งแลกมาด้วยราคาที่สูงเกินไป:
// สลิปโอนเงินมีชื่อ-นามสกุลจริงของผู้โอน เลขบัญชีบางส่วน ยอดเงิน และเวลาทำรายการ
// (PII เต็มรูปแบบตาม § 4.3 PDPA) และ Public URL ที่หลุดออกไปครั้งเดียวจะเปิดดูได้
// ตลอดกาลโดยไม่ต้อง Login — ชื่อไฟล์ {paymentId}-{timestamp} ก็เดาได้ถ้ารู้ paymentId
//
// ตอนนี้ Private เหมือน transaction-slips / facebook-like-proofs / reports ทั้งหมดแล้ว
// (โปรเจกต์ไม่มี Bucket Public เหลืออยู่อีก) — เข้าถึงผ่าน Signed URL อายุสั้นเท่านั้น
const SLIP_BUCKET = 'payment-slips';

// อายุ Signed URL ของสลิปชำระเงิน = 5 นาที (เท่า transaction-slips / facebook-like-proofs
// ด้วยเหตุผลเดียวกัน: Admin/ผู้ใช้กดแล้วเปิดรูปทันที ไม่ต้องมีเวลาดาวน์โหลดไฟล์ใหญ่
// เหมือนรายงาน PDF/Excel ที่ตั้งไว้ 15 นาที) — ลดหน้าต่างความเสี่ยงให้แคบที่สุดเท่าที่
// ยังใช้งานได้จริง
const PAYMENT_SLIP_SIGNED_URL_TTL_SECONDS = 5 * 60;

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

// Bucket ส่วนตัวสำหรับ Screenshot หลักฐานการกด Like Facebook (แคมเปญ Premium ฟรี)
//
// ⚠️ Private โดยเจตนา (ต่างจาก payment-slips ที่ Public) ด้วยเหตุผลเดียวกับ
// transaction-slips: Screenshot หน้า Facebook มักติดชื่อจริง รูปโปรไฟล์ และบางครั้ง
// รายชื่อเพื่อนของผู้ใช้ — เป็น PII ที่ถ้าเป็น Public URL หลุดออกไปครั้งเดียวจะเปิดดูได้
// ตลอดกาลโดยไม่ต้อง Login (§ 4.3 PDPA) Admin เข้าถึงผ่าน Signed URL อายุสั้นเท่านั้น
const FACEBOOK_LIKE_PROOF_BUCKET = 'facebook-like-proofs';

// อายุ Signed URL ของ Screenshot = 5 นาที (เท่า transaction-slips) — Admin เปิดดูรูป
// แล้วตัดสินทันที ไม่ต้องมีเวลาดาวน์โหลดไฟล์ใหญ่เหมือนรายงาน จึงลดหน้าต่างความเสี่ยง
// ให้แคบที่สุดเท่าที่ยังใช้งานได้จริง
const FACEBOOK_LIKE_PROOF_SIGNED_URL_TTL_SECONDS = 5 * 60;

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
// คืน "Storage path" กลับมา — throw ถ้าอัปโหลดล้มเหลว (Caller ห่อ try/catch กัน Webhook พัง)
//
// ⚠️ Offensive Review Round 2 (F4): เดิมคืน Public URL เต็ม (getPublicUrl) — ตอนนี้
// Bucket เป็น Private แล้ว จึงคืน path แล้วให้จุดที่ "จะแสดงผลจริง" สร้าง Signed URL
// อายุสั้นเอาเองตอนนั้น (createPaymentSlipSignedUrl) — Pattern เดียวกับ
// transaction-slips/facebook-like-proofs ทุกประการ
//
// ค่าที่คืนยังถูกเก็บลงคอลัมน์ payments.slip_image_url เหมือนเดิม (ไม่เปลี่ยนชื่อคอลัมน์
// เพื่อเลี่ยง Migration ที่ไม่จำเป็นบนตารางเส้นทางเงิน) — ความหมายของค่าข้างในเปลี่ยน
// จาก URL เป็น path ซึ่ง createPaymentSlipSignedUrl รองรับทั้งสองแบบอยู่แล้ว
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

  return path;
}

// แปลงค่าที่เก็บอยู่ใน payments.slip_image_url ให้เป็น "Storage path" เสมอ
//
// ⚠️ ต้องรองรับ 2 รูปแบบ เพราะแถวเก่าที่บันทึกไว้ตอน Bucket ยังเป็น Public เก็บ URL
// เต็มไว้ (https://<project>.supabase.co/storage/v1/object/public/payment-slips/<path>)
// ถ้าไม่แปลงกลับ Admin จะเปิดสลิปของคำขอเก่าที่ยังค้างอยู่ไม่ได้เลยทันทีที่ Founder
// สลับ Bucket เป็น Private — ตัดตรงหลัง "/payment-slips/" แล้วเอาไปเซ็นใหม่แทน
// (ตัด Query String ทิ้งด้วย เผื่อ URL เก่ามี ?t=... ติดมา)
function paymentSlipPathFrom(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();

  const marker = `/${SLIP_BUCKET}/`;
  const idx = raw.indexOf(marker);
  const path = idx === -1 ? raw : raw.slice(idx + marker.length);

  return path.split('?')[0] || null;
}

// สร้าง Signed URL อายุสั้นให้รูปสลิปชำระเงิน — คืน null ถ้าว่าง/Sign ไม่สำเร็จ
// (ไม่ throw: หน้า Admin ต้องแสดงรายการคำขอได้ต่อแม้เปิดรูปบางใบไม่ได้ — Pattern
// เดียวกับ createTransactionSlipSignedUrl / createFacebookLikeProofSignedUrl)
async function createPaymentSlipSignedUrl(pathOrLegacyUrl) {
  const path = paymentSlipPathFrom(pathOrLegacyUrl);
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(SLIP_BUCKET)
    .createSignedUrl(path, PAYMENT_SLIP_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error(
      `[storage] failed to sign payment slip ${path}: ${error?.message ?? 'no signedUrl'}`
    );
    return null;
  }

  return data.signedUrl;
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

// ลบรูปสลิปธุรกรรม "ไฟล์เดียว" ออกจาก Bucket transaction-slips (Compensating Delete)
// — ใช้ตอน "อัปโหลดสำเร็จแล้วแต่แนบ path เข้าธุรกรรมไม่สำเร็จ" เพื่อไม่ให้เหลือไฟล์
// Orphan ที่ไม่มีแถวไหนอ้างถึง (ต่างจาก deleteAllTransactionSlipsForUser ที่กวาดทั้ง User
// ตอน PDPA Erasure) — throw ถ้า Storage คืน error ให้ Caller ตัดสินใจ (Log path ค้างไว้)
async function deleteTransactionSlip(path) {
  if (!path) return;
  const { error } = await supabaseAdmin.storage.from(TRANSACTION_SLIP_BUCKET).remove([path]);
  if (error) {
    throw new Error(`Failed to delete transaction slip ${path}: ${error.message}`);
  }
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

// ── Screenshot หลักฐาน Like Facebook (แคมเปญ Premium ฟรี) ────────────────────
// อัปโหลดขึ้น Bucket facebook-like-proofs (Private) คืน path เต็ม
//
// ตั้งชื่อ "{userId}-{timestamp}.{ext}" — Pattern เดียวกับ transaction-slips: userId
// (UUID) เป็นส่วนนำที่ไม่เปลี่ยน ทำให้ (1) กวาดลบตอน PDPA Erasure ด้วย Prefix ได้ปลอดภัย
// และ (2) ตรวจความเป็นเจ้าของไฟล์จาก path ได้โดยไม่ต้อง Query DB
//
// ⚠️ ต่างจาก uploadTransactionSlip ตรงที่ "คืน path เต็ม ไม่ใช่ token" เพราะ path นี้
// ถูกเก็บลง DB (facebook_like_grant_requests.screenshot_path) ทันทีในคำขอเดียวกัน
// ไม่ได้ถูกพกผ่าน LINE Postback ที่ Client แก้ค่าได้ จึงไม่มี Attack Surface แบบนั้น
//
// ใช้ Guard MIME/ขนาดชุดเดียวกับ uploadPaymentSlip (Reuse ค่าคงที่เดิม ไม่ตั้งใหม่)
async function uploadFacebookLikeProof(userId, buffer, contentType) {
  if (!ALLOWED_SLIP_CONTENT_TYPES.includes(contentType)) {
    throw new StorageServiceError(
      'INVALID_SLIP_CONTENT_TYPE',
      `Unsupported content type for facebook like proof: ${contentType}`,
      { userId, contentType }
    );
  }

  if (buffer.length > MAX_SLIP_SIZE_BYTES) {
    throw new StorageServiceError(
      'SLIP_TOO_LARGE',
      `Facebook like proof exceeds max size (${buffer.length} > ${MAX_SLIP_SIZE_BYTES} bytes)`,
      { userId, size: buffer.length, maxSize: MAX_SLIP_SIZE_BYTES }
    );
  }

  const path = `${userId}-${Date.now()}.${extensionFromContentType(contentType)}`;

  const { error } = await supabaseAdmin.storage
    .from(FACEBOOK_LIKE_PROOF_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    throw new Error(`Failed to upload facebook like proof for ${userId}: ${error.message}`);
  }

  return path;
}

// สร้าง Signed URL อายุสั้นให้ Admin เปิดดู Screenshot — คืน null ถ้า path ว่าง/Sign
// ไม่สำเร็จ (ไม่ throw: หน้า Admin ต้องแสดงรายการคำขอได้ต่อแม้เปิดรูปบางใบไม่ได้)
async function createFacebookLikeProofSignedUrl(path) {
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(FACEBOOK_LIKE_PROOF_BUCKET)
    .createSignedUrl(path, FACEBOOK_LIKE_PROOF_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error(
      `[storage] failed to sign facebook like proof ${path}: ${error?.message ?? 'no signedUrl'}`
    );
    return null;
  }

  return data.signedUrl;
}

// PDPA Erasure (userErasure.service) — ลบ Screenshot ทั้งหมดของ User คนหนึ่งออกจาก
// Bucket facebook-like-proofs จริง (Hard Delete — เหตุผลเดียวกับ
// deleteAllTransactionSlipsForUser: รูปคือข้อมูลระบุตัวตนชัดเจนที่สุด และไม่มีประโยชน์
// เมื่อไม่มี User ระบุตัวตนผูกอยู่แล้ว) — แถวใน facebook_like_grant_requests ยังอยู่ครบ
// (มีแค่ "ไฟล์รูป" ที่หายไป path ค้างชี้ไปไฟล์ที่ไม่มีแล้ว ซึ่ง Signed URL จะคืน null เอง)
//
// ⚠️ List Bucket แล้ว Filter ด้วย Prefix "{userId}-" (ไม่ใช่ Query screenshot_path
// มาลบทีละ Path) ด้วยเหตุผลเดียวกับ deleteAllTransactionSlipsForUser: ผู้ใช้อาจอัปโหลด
// รูปแล้วไม่ได้กดส่งคำขอจริง (หรือส่งไม่สำเร็จ) → ไฟล์ค้างในถังโดยไม่มีแถวไหนอ้างถึง
// การลบจาก screenshot_path อย่างเดียวจะทิ้งไฟล์เหล่านั้นไว้ตลอดกาล = รูรั่ว PDPA
// คืนจำนวนไฟล์ที่ลบสำเร็จ — ไม่ throw ถ้าไม่มีไฟล์เลย (ผู้ใช้อาจไม่เคยส่งคำขอ)
async function deleteAllFacebookLikeProofsForUser(userId) {
  if (!userId) {
    return 0;
  }

  const { data: files, error: listError } = await supabaseAdmin.storage
    .from(FACEBOOK_LIKE_PROOF_BUCKET)
    .list('', { search: userId });

  if (listError) {
    throw new Error(`Failed to list facebook like proofs: ${listError.message}`);
  }

  const prefix = `${userId}-`;
  const matchedPaths = (files ?? [])
    .filter((file) => file.name.startsWith(prefix))
    .map((file) => file.name);

  if (matchedPaths.length === 0) {
    return 0;
  }

  const { error: removeError } = await supabaseAdmin.storage
    .from(FACEBOOK_LIKE_PROOF_BUCKET)
    .remove(matchedPaths);

  if (removeError) {
    throw new Error(`Failed to delete facebook like proofs: ${removeError.message}`);
  }

  return matchedPaths.length;
}

module.exports = {
  StorageServiceError,
  SLIP_BUCKET,
  PAYMENT_SLIP_SIGNED_URL_TTL_SECONDS,
  paymentSlipPathFrom,
  createPaymentSlipSignedUrl,
  REPORT_BUCKET,
  REPORT_SIGNED_URL_TTL_SECONDS,
  TRANSACTION_SLIP_BUCKET,
  TRANSACTION_SLIP_SIGNED_URL_TTL_SECONDS,
  FACEBOOK_LIKE_PROOF_BUCKET,
  FACEBOOK_LIKE_PROOF_SIGNED_URL_TTL_SECONDS,
  MAX_SLIP_SIZE_BYTES,
  uploadPaymentSlip,
  deleteAllSlipsForUser,
  uploadReport,
  uploadTransactionSlip,
  buildTransactionSlipPath,
  createTransactionSlipSignedUrl,
  deleteTransactionSlip,
  deleteAllTransactionSlipsForUser,
  uploadFacebookLikeProof,
  createFacebookLikeProofSignedUrl,
  deleteAllFacebookLikeProofsForUser,
};
