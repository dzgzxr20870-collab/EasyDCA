const crypto = require('crypto');

// ── Client-side Encryption สำหรับ Nightly Backup (Infra ก่อน Beta — ปิดช่องโหว่ที่
// เจอใน BACKUP_AND_RECOVERY.md: ไฟล์ Backup มีข้อมูลส่วนบุคคล ต้องเข้ารหัส "ก่อน"
// ออกจาก Server เราเอง ไม่พึ่ง Encryption-at-rest ของ Provider (R2) อย่างเดียว) ──
//
// AES-256-GCM — เลือกเพราะ Node.js `crypto` มีในตัว (ไม่ต้องพึ่ง Library ภายนอก
// เพิ่ม) และเป็น Authenticated Encryption (AEAD): Decrypt ผิด Key หรือไฟล์ถูกแก้ไข/
// เสียหาย จะ Fail ชัดเจนเสมอ (Auth Tag ไม่ตรง) ไม่มีทางได้ "ขยะ" ออกมาเงียบๆ โดยไม่รู้ตัว
//
// รูปแบบไฟล์ที่เข้ารหัสแล้ว (Envelope เดียวจบ — ไม่ต้องพึ่ง Metadata แยกบน R2 ที่
// อาจหลุดหาย/ไม่ตรงกับไฟล์): [MAGIC 4B][VERSION 1B][IV 12B][AuthTag 16B][Ciphertext...]
const MAGIC = Buffer.from('EDBK', 'utf-8'); // "EasyDCA Backup"
const VERSION = 1;
const IV_LENGTH = 12; // GCM Recommended (96-bit) — Node Default ที่ตรงกับ Standard
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256 = 32 Bytes
const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH + AUTH_TAG_LENGTH;

// Key ต้องเป็น Hex String 64 ตัวอักษรเป๊ะ (32 Bytes) — ตรวจ Format ตรงๆ ก่อน
// Buffer.from(..., 'hex') เพราะ Node "ไม่ throw" ถ้า Hex String ผิดรูป (แค่ตัดทิ้ง
// เงียบๆ ที่ตัวอักษรแรกที่ผิด) ซึ่งจะได้ Key สั้นกว่าที่ควรแบบไม่มี Error ชัดเจน —
// เช็ค Regex ก่อนกันปัญหานี้ตั้งแต่ต้น ให้ Error Message ชี้สาเหตุจริงตรงๆ
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

function loadKey(keyHex) {
  // .trim() ก่อนตรวจเสมอ — การ Paste Key ลง Railway Variables/.env แล้วติด Newline
  // หรือ Space ท้ายเป็นเรื่องที่เกิดบ่อยมาก ถ้าไม่ตัดทิ้งจะกลายเป็น Backup พังทุกคืน
  // (Fail ดังๆ + Alert Admin อยู่ก็จริง ไม่ได้เงียบ แต่เป็นความเจ็บปวดที่ตัดจบได้
  // ด้วยโค้ดบรรทัดเดียว) — Whitespace ล้วนถือเป็น "ไม่ได้ตั้งค่า" ไม่ใช่ "Format ผิด"
  // เพราะสาเหตุจริงคือตัวแปรว่าง ไม่ใช่พิมพ์ Key ผิด
  const normalized = keyHex ? String(keyHex).trim() : '';

  if (!normalized) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY is not configured. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (!HEX_KEY_PATTERN.test(normalized)) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256) — got ${normalized.length} characters. ` +
        'Generate a valid one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(normalized, 'hex');
}

// เข้ารหัส Buffer ใดๆ (ในโปรเจกต์นี้คือผลลัพธ์ pg_dump ที่ gzip แล้วจาก pgDump.util)
// — IV สุ่มใหม่ทุกครั้งที่เรียก (ห้าม Reuse IV ข้าม Encryption ด้วย Key เดียวกัน
// เด็ดขาด — เป็นข้อกำหนดพื้นฐานของ AES-GCM ที่ถ้าผิดจะทำลาย Security Guarantee ทั้งหมด)
function encryptBuffer(plainBuffer, keyHex) {
  const key = loadKey(keyHex);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, authTag, ciphertext]);
}

// ถอดรหัส Envelope กลับเป็น Buffer เดิม — ใช้ทั้งใน Test และ scripts/decryptBackup.js
// (Disaster Recovery จริง) โยน Error ที่อ่านออกเสมอเมื่อ Key ผิด/ไฟล์เสียหาย/ไม่ใช่
// รูปแบบไฟล์นี้ — ห้ามคืนค่าเงียบๆ แบบผิดๆ เด็ดขาด (Silent Corruption อันตรายกว่า Error)
function decryptBuffer(envelopeBuffer, keyHex) {
  const key = loadKey(keyHex);

  if (!Buffer.isBuffer(envelopeBuffer) || envelopeBuffer.length < HEADER_LENGTH) {
    throw new Error(
      `Encrypted backup file is truncated or corrupt: expected at least ${HEADER_LENGTH} header bytes, got ${envelopeBuffer?.length ?? 0}`
    );
  }

  let offset = 0;
  const magic = envelopeBuffer.subarray(offset, offset + MAGIC.length);
  offset += MAGIC.length;
  if (!magic.equals(MAGIC)) {
    throw new Error('Not a valid EasyDCA encrypted backup file (magic bytes mismatch)');
  }

  const version = envelopeBuffer.readUInt8(offset);
  offset += 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported encrypted backup format version: ${version} (expected ${VERSION})`);
  }

  const iv = envelopeBuffer.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const authTag = envelopeBuffer.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;
  const ciphertext = envelopeBuffer.subarray(offset);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    // GCM Auth Tag ไม่ตรง = Key ผิด หรือไฟล์ถูกแก้ไข/เสียหาย/ไม่ครบ — Node ปฏิเสธ
    // ตรงนี้เองโดย Design ของ Authenticated Encryption ไม่ใช่ Bug ของเรา
    throw new Error(`Failed to decrypt backup (wrong BACKUP_ENCRYPTION_KEY, or file is corrupted/tampered): ${err.message}`);
  }
}

// Export loadKey ด้วย เพื่อให้ dbBackup.job Validate Key ได้ "ก่อน" เริ่ม pg_dump
// (ไม่ใช่แค่เช็คว่ามีค่าหรือเปล่า) — ดู Comment ที่ Guard ใน dbBackup.job.js
module.exports = { encryptBuffer, decryptBuffer, loadKey, KEY_LENGTH };
