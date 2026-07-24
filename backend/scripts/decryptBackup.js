// Disaster Recovery — ถอดรหัส Backup ที่ dbBackup.job.js เข้ารหัสไว้ (AES-256-GCM)
// กลับมาเป็นไฟล์ .sql.gz ธรรมดา (gunzip + psql restore ต่อได้ตามปกติ)
//
// ไม่ใช่ส่วนหนึ่งของ Server ที่รันทุกครั้ง (ไม่ require จาก src/index.js/worker.js)
// รันด้วยมือตอนต้อง Restore จริงเท่านั้น (ดูขั้นตอนเต็มใน BACKUP_AND_RECOVERY.md § 3)
//
// Usage:
//   node scripts/decryptBackup.js <input.sql.gz.enc> <output.sql.gz> [--force]
//
// ต้องตั้ง BACKUP_ENCRYPTION_KEY ใน Environment ก่อนรัน (Key เดียวกับที่ Railway
// ใช้ตอนเข้ารหัสไฟล์นั้นจริง — ถ้า Key ไม่ตรง Decrypt จะ Fail ชัดเจนเสมอ ไม่คืน
// ขยะเงียบๆ ดู backupEncryption.util.js) — ตั้งผ่าน .env ในเครื่อง (dotenv โหลดให้
// อัตโนมัติด้านล่าง) หรือ Export ใน Shell ก็ได้
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { decryptBuffer } = require('../src/utils/backupEncryption.util');

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const [inputPath, outputPath] = args.filter((arg) => arg !== '--force');

  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/decryptBackup.js <input.sql.gz.enc> <output.sql.gz> [--force]');
    process.exitCode = 1;
    return;
  }

  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key) {
    console.error('[decrypt-backup] BACKUP_ENCRYPTION_KEY is not set (.env หรือ Shell Environment)');
    process.exitCode = 1;
    return;
  }

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  // ปฏิเสธเขียนทับไฟล์ที่มีอยู่แล้ว — ตอน Disaster Recovery จริงคนที่รันคำสั่งนี้
  // กำลังกดดันและรีบ พิมพ์ Path ปลายทางผิดไปตรงกับไฟล์ที่มีอยู่ = ทับทิ้งถาวรกู้ไม่ได้
  // ขัดกับกฎเหล็ก "ห้ามลบข้อมูลผู้ใช้เด็ดขาด" ของ BACKUP_AND_RECOVERY.md — ต้องตั้งใจ
  // ใส่ --force เองเท่านั้นถึงจะทับได้ (เช็คก่อน Decrypt เพื่อไม่ให้เสียเวลาถอดไฟล์
  // ใหญ่ๆ จนเสร็จแล้วมาโดนปฏิเสธตอนท้าย)
  if (fs.existsSync(resolvedOutput) && !force) {
    console.error(`[decrypt-backup] ปฏิเสธเขียนทับไฟล์ที่มีอยู่แล้ว: ${resolvedOutput}`);
    console.error('  → เปลี่ยนชื่อไฟล์ Output เป็นชื่อใหม่ หรือใส่ --force ถ้าตั้งใจเขียนทับจริง');
    process.exitCode = 1;
    return;
  }

  let encrypted;
  try {
    encrypted = fs.readFileSync(resolvedInput);
  } catch (err) {
    console.error(`[decrypt-backup] failed to read ${resolvedInput}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let decrypted;
  try {
    decrypted = decryptBuffer(encrypted, key);
  } catch (err) {
    // decryptBuffer โยน Error ที่อ่านออกเสมอ (Key ผิด / ไฟล์เสียหาย / ไม่ใช่รูปแบบนี้)
    console.error(`[decrypt-backup] decryption failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(resolvedOutput, decrypted);
  console.log(`[decrypt-backup] decrypted ${inputPath} -> ${outputPath} (${decrypted.length} bytes)`);
  console.log('');
  console.log('ขั้นตอนถัดไป (Restore เข้า Database):');
  console.log(`  gunzip ${outputPath}`);
  console.log(`  psql "$DATABASE_URL" < ${outputPath.replace(/\.gz$/, '')}`);
}

main();
