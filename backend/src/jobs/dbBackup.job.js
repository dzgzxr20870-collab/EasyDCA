const cron = require('node-cron');
const config = require('../config/env');
const { runPgDump } = require('../utils/pgDump.util');
const { encryptBuffer, loadKey } = require('../utils/backupEncryption.util');
const backupStorage = require('../services/backupStorage.service');
const { pushAdminAlert } = require('../services/healthAlert.service');

// ── Nightly Database Backup (Infra ก่อน Beta) ────────────────────────────────
// รันทุกคืนตี 3 เวลาไทย (ช่วง Traffic ต่ำสุด — เวลาเดียวกับ Cron Purge อื่นๆ) —
// pg_dump ฐานข้อมูล Supabase → บีบอัด (gzip) → เข้ารหัส AES-256-GCM (Client-side —
// ก่อนออกจาก Server เราเอง ดู backupEncryption.util.js) → อัปโหลดขึ้น Cloudflare
// R2 → ลบไฟล์เก่าเกิน Retention ทิ้ง (ดู config.backup.retentionDays)
//
// แจ้งเตือนถ้าล้มเหลว: Reuse healthAlert.service.pushAdminAlert เดิม (ไม่สร้าง
// กลไก Push ใหม่ซ้ำ) — ต่างจาก Debounce ของ /health เพราะ Backup รันแค่วันละครั้ง
// อยู่แล้ว ไม่มีความเสี่ยง Push รัวจากการเรียกถี่ จึง Push ตรงๆ ทุกครั้งที่ล้มเหลวได้
const BACKUP_PREFIX = 'db-backups/';

function backupKey(now = new Date()) {
  // ISO Timestamp แทน ':'/'.' ด้วย '-' กัน Object Key มีอักขระที่ S3-compatible
  // Storage บาง Client จัดการยาก (Path/URL ไม่ควรมี Colon) — Suffix .enc บอกชัดว่า
  // เข้ารหัสแล้ว กัน Confuse ว่าทำไม gunzip ตรงๆ ไม่ได้ (ต้องผ่าน decryptBackup.js ก่อน)
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${BACKUP_PREFIX}easydca-${timestamp}.sql.gz.enc`;
}

// ลบ Backup ที่เก่ากว่า Retention ทิ้ง — คืนจำนวนที่ลบสำเร็จ (Error Isolation ราย
// ไฟล์: ไฟล์หนึ่งลบไม่สำเร็จไม่ทำให้ทั้ง Batch หยุด — Pattern เดียวกับ Cron อื่นๆ
// ในโปรเจกต์ที่ Loop ทีละ Record)
async function purgeOldBackups(retentionDays = config.backup.retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const objects = await backupStorage.listBackups(BACKUP_PREFIX);
  const stale = objects.filter((obj) => obj.lastModified && obj.lastModified.getTime() < cutoff);

  let deletedCount = 0;
  for (const obj of stale) {
    try {
      await backupStorage.deleteBackup(obj.key);
      deletedCount += 1;
    } catch (err) {
      console.error(`[cron:db-backup] failed to delete stale backup ${obj.key}: ${err.message}`);
    }
  }
  return deletedCount;
}

async function runNightlyBackup() {
  const databaseUrl = config.supabase.databaseUrl;
  if (!databaseUrl) {
    const msg = 'DATABASE_URL is not configured';
    console.error(`[cron:db-backup] skipped: ${msg}`);
    await pushAdminAlert(`🔴 EasyDCA: Backup ฐานข้อมูลรายคืนข้ามรอบ — ${msg}`);
    return;
  }

  if (!backupStorage.isConfigured()) {
    const msg = 'R2 credentials (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME) are not fully configured';
    console.error(`[cron:db-backup] skipped: ${msg}`);
    await pushAdminAlert(`🔴 EasyDCA: Backup ฐานข้อมูลรายคืนข้ามรอบ — ${msg}`);
    return;
  }

  // เช็คก่อนรัน pg_dump เลย (Fail Fast) — ไม่มีประโยชน์ที่จะ Dump ฐานข้อมูลทั้งก้อน
  // แล้วมาเจอว่าเข้ารหัสไม่ได้ทีหลัง ที่สำคัญกว่านั้น: ห้ามอัปโหลดไฟล์ที่ "ไม่เข้ารหัส"
  // ขึ้น R2 เด็ดขาดไม่ว่ากรณีใด (มีข้อมูลส่วนบุคคลของผู้ใช้อยู่ข้างใน — ดู
  // BACKUP_AND_RECOVERY.md) จึงต้อง Skip ทั้งรอบไปเลยถ้าไม่มี Key ไม่ใช่ Fallback
  // ไปอัปโหลดแบบไม่เข้ารหัสแทน
  //
  // เรียก loadKey() เต็มรูปแบบ ไม่ใช่แค่เช็คว่ามีค่า — Key ที่ Format ผิด (พิมพ์ตก
  // ไปตัวหนึ่ง/Paste มาไม่ครบ) จะได้ถูกจับตั้งแต่ตรงนี้ ไม่หลุดไป Dump ฐานข้อมูล
  // ทั้งก้อนเสร็จก่อนแล้วค่อยพังตอน Encrypt ตามที่ Comment ด้านบนตั้งใจไว้แต่แรก
  try {
    loadKey(config.backup.encryptionKey);
  } catch (err) {
    console.error(`[cron:db-backup] skipped: ${err.message}`);
    await pushAdminAlert(`🔴 EasyDCA: Backup ฐานข้อมูลรายคืนข้ามรอบ — ${err.message}`);
    return;
  }

  const key = backupKey();

  try {
    const buffer = await runPgDump(databaseUrl);
    const encrypted = encryptBuffer(buffer, config.backup.encryptionKey);
    await backupStorage.uploadBackup(key, encrypted);
    console.log(`[cron:db-backup] uploaded ${key} (${encrypted.length} bytes, encrypted)`);

    const deletedCount = await purgeOldBackups();
    console.log(`[cron:db-backup] retention purge complete: deleted ${deletedCount} stale backup(s)`);
  } catch (err) {
    // ต้อง catch ไว้เสมอ — Cron พังแค่รอบเดียวไม่ควรทำให้ Worker Process Crash
    console.error(`[cron:db-backup] failed: ${err.message}`);
    await pushAdminAlert(`🔴 EasyDCA: Backup ฐานข้อมูลรายคืนล้มเหลว — ${err.message}`);
  }
}

function scheduleNightlyBackup() {
  // '0 3 * * *' = ตี 3 ทุกวัน Asia/Bangkok (เวลาเดียวกับ webhookEventCleanup/
  // reminderSetupCleanup/bulkImportCleanup — ช่วง Traffic ต่ำสุดของโปรเจกต์)
  return cron.schedule('0 3 * * *', runNightlyBackup, { timezone: 'Asia/Bangkok' });
}

module.exports = {
  scheduleNightlyBackup,
  // Export ฟังก์ชัน Run/Helper ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runNightlyBackup,
  purgeOldBackups,
  backupKey,
};
