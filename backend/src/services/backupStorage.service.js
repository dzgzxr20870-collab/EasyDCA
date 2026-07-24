const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const config = require('../config/env');

// Cloudflare R2 — S3-compatible Object Storage (Infra ก่อน Beta — Nightly Backup)
// เลือกแทน Google Drive/Google Cloud Storage เพราะ Auth เป็น Access Key ตรงๆ
// (S3-compatible) ไม่ต้องพึ่ง OAuth Refresh Token/Service Account JSON ที่ซับซ้อนกว่า
// Free Tier: 10GB Storage + ไม่มีค่า Egress (สำคัญเพราะต้องดาวน์โหลดตอน Restore จริง)
//
// ⚠️ ต้องสร้าง Client "ใหม่ทุกครั้ง" ที่เรียกใช้ (ไม่ Cache เป็น Module-level Singleton)
// เพราะ Test ต้อง Mock config.backup.* ที่ต่างกันได้ต่อ Test Case โดยไม่ต้อง
// Re-require Module — ต้นทุนสร้าง Client ต่ำมาก ไม่คุ้มที่จะซับซ้อนเรื่อง Cache
function buildClient() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.backup.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.backup.r2AccessKeyId,
      secretAccessKey: config.backup.r2SecretAccessKey,
    },
  });
}

// ตรวจว่าตั้งค่า R2 ครบหรือยัง — dbBackup.job เรียกเช็คก่อนเริ่มทำงานจริง เพื่อ
// Fail Gracefully ด้วยข้อความชัดเจน แทนที่จะโยน Error ดิบจาก S3Client ตอน Connect
function isConfigured() {
  return Boolean(
    config.backup.r2AccountId &&
      config.backup.r2AccessKeyId &&
      config.backup.r2SecretAccessKey &&
      config.backup.r2Bucket
  );
}

async function uploadBackup(key, buffer) {
  const client = buildClient();
  await client.send(
    new PutObjectCommand({
      Bucket: config.backup.r2Bucket,
      Key: key,
      Body: buffer,
      // ไฟล์เข้ารหัสแล้วเสมอ (AES-256-GCM — ดู backupEncryption.util.js) ไม่ใช่
      // gzip ตรงๆ อีกต่อไป — octet-stream กันเครื่องมือ/เบราว์เซอร์พยายาม gunzip
      // ตรงๆ แล้วพัง (ต้องผ่าน scripts/decryptBackup.js ก่อนเสมอ)
      ContentType: 'application/octet-stream',
    })
  );
}

// คืน [{ key, lastModified }] ของทุก Object ใต้ Prefix ที่ระบุ — ใช้ตัดสิน
// Retention (ลบของเก่ากว่ากำหนด) ใน dbBackup.job
async function listBackups(prefix) {
  const client = buildClient();
  const result = await client.send(
    new ListObjectsV2Command({ Bucket: config.backup.r2Bucket, Prefix: prefix })
  );
  return (result.Contents ?? []).map((obj) => ({
    key: obj.Key,
    lastModified: obj.LastModified,
  }));
}

async function deleteBackup(key) {
  const client = buildClient();
  await client.send(new DeleteObjectCommand({ Bucket: config.backup.r2Bucket, Key: key }));
}

module.exports = { isConfigured, uploadBackup, listBackups, deleteBackup };
