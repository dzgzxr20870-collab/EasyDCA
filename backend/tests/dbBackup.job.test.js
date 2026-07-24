const crypto = require('crypto');

jest.mock('../src/utils/pgDump.util');
jest.mock('../src/services/backupStorage.service');
jest.mock('../src/services/healthAlert.service');
// backupEncryption.util "ไม่" Mock โดยตั้งใจ — ใช้ตัวจริงทั้งใน Unit Test (เช็คว่า
// Buffer ที่อัปโหลดไม่ใช่ Plaintext ตรงๆ) และ Integration Test ท้ายไฟล์ (Encrypt
// จริง → Decrypt กลับมาเทียบกับต้นฉบับ พิสูจน์ว่า Round-trip ผ่าน Job เต็ม Flow ได้จริง)

const TEST_KEY = crypto.randomBytes(32).toString('hex');

jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    supabase: { ...actual.supabase, databaseUrl: 'postgresql://user:pass@host:5432/db' },
    backup: { ...actual.backup, retentionDays: 14, encryptionKey: null }, // ตั้งจริงใน beforeEach
  };
});

const { runPgDump } = require('../src/utils/pgDump.util');
const { decryptBuffer } = require('../src/utils/backupEncryption.util');
const backupStorage = require('../src/services/backupStorage.service');
const healthAlert = require('../src/services/healthAlert.service');
const config = require('../src/config/env');
const dbBackupJob = require('../src/jobs/dbBackup.job');

beforeEach(() => {
  jest.clearAllMocks();
  backupStorage.isConfigured.mockReturnValue(true);
  healthAlert.pushAdminAlert.mockResolvedValue(undefined);
  config.backup.encryptionKey = TEST_KEY;
});

describe('runNightlyBackup', () => {
  test('สำเร็จ: pg_dump → เข้ารหัส → อัปโหลด → Purge เก่าเกิน Retention → ไม่ Push Alert', async () => {
    const plainBackup = Buffer.from('fake-gzip-content');
    runPgDump.mockResolvedValue(plainBackup);
    backupStorage.uploadBackup.mockResolvedValue(undefined);
    backupStorage.listBackups.mockResolvedValue([]);

    await dbBackupJob.runNightlyBackup();

    expect(runPgDump).toHaveBeenCalledWith('postgresql://user:pass@host:5432/db');
    expect(backupStorage.uploadBackup).toHaveBeenCalledTimes(1);
    const [key, uploadedBuffer] = backupStorage.uploadBackup.mock.calls[0];
    expect(key).toMatch(/^db-backups\/easydca-.+\.sql\.gz\.enc$/);
    // ต้อง "ไม่" เป็น Plaintext ตรงๆ (ต้องเข้ารหัสก่อนเสมอ — ห้ามหลุด Plaintext ขึ้น R2)
    expect(uploadedBuffer.equals(plainBackup)).toBe(false);
    // Decrypt กลับมาต้องได้เนื้อหาเดิมเป๊ะ (พิสูจน์ว่าเข้ารหัสถูกต้องจริง ไม่ใช่แค่เบี้ยว Buffer)
    expect(decryptBuffer(uploadedBuffer, TEST_KEY).equals(plainBackup)).toBe(true);
    expect(healthAlert.pushAdminAlert).not.toHaveBeenCalled();
  });

  test('BACKUP_ENCRYPTION_KEY ไม่ได้ตั้งค่า → ข้ามรอบ + Push Alert ไม่เรียก pg_dump (ห้าม Fallback ไปอัปโหลดแบบไม่เข้ารหัส)', async () => {
    config.backup.encryptionKey = null;

    await dbBackupJob.runNightlyBackup();

    expect(runPgDump).not.toHaveBeenCalled();
    expect(backupStorage.uploadBackup).not.toHaveBeenCalled();
    expect(healthAlert.pushAdminAlert).toHaveBeenCalledTimes(1);
    expect(healthAlert.pushAdminAlert.mock.calls[0][0]).toContain('BACKUP_ENCRYPTION_KEY');
  });

  test('BACKUP_ENCRYPTION_KEY ตั้งค่าไว้แต่ Format ผิด (ไม่ใช่ 64 Hex) → ข้ามรอบตั้งแต่ก่อน pg_dump + Push Alert พร้อมเหตุผล', async () => {
    config.backup.encryptionKey = 'not-a-valid-hex-key';
    runPgDump.mockResolvedValue(Buffer.from('data'));

    await dbBackupJob.runNightlyBackup();

    // Guard ต้อง Validate Format เต็มรูปแบบ (loadKey) ไม่ใช่แค่เช็คว่ามีค่า — ถ้าเช็ค
    // แค่ค่าว่าง Key ที่พิมพ์ผิดจะหลุดไป Dump ฐานข้อมูลทั้งก้อนเสร็จก่อนแล้วค่อยพัง
    // ตอน Encrypt (เปลืองเปล่าและ Error คลุมเครือกว่า)
    expect(runPgDump).not.toHaveBeenCalled();
    expect(backupStorage.uploadBackup).not.toHaveBeenCalled();
    expect(healthAlert.pushAdminAlert).toHaveBeenCalledTimes(1);
    expect(healthAlert.pushAdminAlert.mock.calls[0][0]).toContain('64 hex characters');
  });

  test('BACKUP_ENCRYPTION_KEY ติด Whitespace ท้าย (Paste จาก Railway/.env) → Trim แล้วทำงานได้ปกติ', async () => {
    // เคสที่เกิดบ่อยที่สุดตอนตั้งค่าจริง — ต้องไม่ทำให้ Backup พังทุกคืน
    config.backup.encryptionKey = `  ${TEST_KEY}\n`;
    const plainBackup = Buffer.from('fake-gzip-content');
    runPgDump.mockResolvedValue(plainBackup);
    backupStorage.uploadBackup.mockResolvedValue(undefined);
    backupStorage.listBackups.mockResolvedValue([]);

    await dbBackupJob.runNightlyBackup();

    expect(backupStorage.uploadBackup).toHaveBeenCalledTimes(1);
    expect(healthAlert.pushAdminAlert).not.toHaveBeenCalled();
    // ถอดกลับด้วย Key ที่ "ไม่มี" Whitespace ต้องได้ต้นฉบับ (Trim ทั้งสองฝั่งตรงกัน)
    const [, uploadedBuffer] = backupStorage.uploadBackup.mock.calls[0];
    expect(decryptBuffer(uploadedBuffer, TEST_KEY).equals(plainBackup)).toBe(true);
  });

  test('DATABASE_URL ไม่ได้ตั้งค่า → ข้ามรอบ + Push Alert ไม่เรียก pg_dump', async () => {
    config.supabase.databaseUrl = null;

    await dbBackupJob.runNightlyBackup();

    expect(runPgDump).not.toHaveBeenCalled();
    expect(healthAlert.pushAdminAlert).toHaveBeenCalledTimes(1);
    expect(healthAlert.pushAdminAlert.mock.calls[0][0]).toContain('DATABASE_URL');

    config.supabase.databaseUrl = 'postgresql://user:pass@host:5432/db'; // restore
  });

  test('R2 ยังไม่ตั้งค่าครบ → ข้ามรอบ + Push Alert ไม่เรียก pg_dump', async () => {
    backupStorage.isConfigured.mockReturnValue(false);

    await dbBackupJob.runNightlyBackup();

    expect(runPgDump).not.toHaveBeenCalled();
    expect(healthAlert.pushAdminAlert).toHaveBeenCalledTimes(1);
    expect(healthAlert.pushAdminAlert.mock.calls[0][0]).toContain('R2');
  });

  test('pg_dump ล้มเหลว (เช่น Binary หาย) → ไม่ Upload + Push Alert พร้อมเหตุผล', async () => {
    runPgDump.mockRejectedValue(new Error('pg_dump spawn failed (binary missing from PATH?): ENOENT'));

    await dbBackupJob.runNightlyBackup();

    expect(backupStorage.uploadBackup).not.toHaveBeenCalled();
    expect(healthAlert.pushAdminAlert).toHaveBeenCalledTimes(1);
    expect(healthAlert.pushAdminAlert.mock.calls[0][0]).toContain('ENOENT');
  });

  test('Upload ล้มเหลว (R2 ปัญหา) → Push Alert พร้อมเหตุผล ไม่ Crash', async () => {
    runPgDump.mockResolvedValue(Buffer.from('x'));
    backupStorage.uploadBackup.mockRejectedValue(new Error('R2 connection timeout'));

    await dbBackupJob.runNightlyBackup();

    expect(healthAlert.pushAdminAlert).toHaveBeenCalledTimes(1);
    expect(healthAlert.pushAdminAlert.mock.calls[0][0]).toContain('R2 connection timeout');
  });
});

describe('purgeOldBackups — Retention Logic', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  test('ลบเฉพาะไฟล์เก่ากว่า Retention (14 วัน) ไฟล์ใหม่กว่ายังอยู่', async () => {
    const now = Date.now();
    backupStorage.listBackups.mockResolvedValue([
      { key: 'db-backups/old-20-days.sql.gz', lastModified: new Date(now - 20 * DAY_MS) },
      { key: 'db-backups/recent-5-days.sql.gz', lastModified: new Date(now - 5 * DAY_MS) },
      { key: 'db-backups/exactly-boundary.sql.gz', lastModified: new Date(now - 15 * DAY_MS) },
    ]);
    backupStorage.deleteBackup.mockResolvedValue(undefined);

    const deletedCount = await dbBackupJob.purgeOldBackups(14);

    expect(backupStorage.deleteBackup).toHaveBeenCalledWith('db-backups/old-20-days.sql.gz');
    expect(backupStorage.deleteBackup).toHaveBeenCalledWith('db-backups/exactly-boundary.sql.gz');
    expect(backupStorage.deleteBackup).not.toHaveBeenCalledWith('db-backups/recent-5-days.sql.gz');
    expect(deletedCount).toBe(2);
  });

  test('ไม่มีไฟล์เก่าเกิน Retention เลย → ไม่ลบอะไร คืน 0', async () => {
    backupStorage.listBackups.mockResolvedValue([
      { key: 'db-backups/recent.sql.gz', lastModified: new Date() },
    ]);

    const deletedCount = await dbBackupJob.purgeOldBackups(14);

    expect(backupStorage.deleteBackup).not.toHaveBeenCalled();
    expect(deletedCount).toBe(0);
  });

  test('ไฟล์หนึ่งลบไม่สำเร็จ → ไม่กระทบไฟล์อื่น (Error Isolation)', async () => {
    const now = Date.now();
    backupStorage.listBackups.mockResolvedValue([
      { key: 'db-backups/fail.sql.gz', lastModified: new Date(now - 20 * DAY_MS) },
      { key: 'db-backups/ok.sql.gz', lastModified: new Date(now - 21 * DAY_MS) },
    ]);
    backupStorage.deleteBackup.mockImplementation((key) =>
      key === 'db-backups/fail.sql.gz' ? Promise.reject(new Error('delete failed')) : Promise.resolve()
    );

    const deletedCount = await dbBackupJob.purgeOldBackups(14);

    expect(deletedCount).toBe(1);
  });
});

describe('backupKey', () => {
  test('ประกอบ Key จาก Timestamp ที่ไม่มี Colon/Dot (Path-safe) + Suffix .enc บอกว่าเข้ารหัสแล้ว', () => {
    const key = dbBackupJob.backupKey(new Date('2026-07-24T03:00:00.000Z'));
    expect(key).toBe('db-backups/easydca-2026-07-24T03-00-00-000Z.sql.gz.enc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration Test — จำลอง Backup Job เต็ม Flow (Dump Mock → Encrypt จริง →
// Upload Mock) แล้ว Decrypt กลับมาเทียบกับข้อมูลต้นฉบับ พิสูจน์ว่า Disaster
// Recovery ใช้งานได้จริงตลอดทาง ไม่ใช่แค่ Unit Test แยกส่วนที่ backupEncryption
// อาจถูก Mock บังตาไว้
// ═══════════════════════════════════════════════════════════════════════════
describe('Integration — Encrypt/Upload/Decrypt Round-trip ผ่าน Job เต็ม Flow', () => {
  test('pg_dump (จำลอง) → Job เข้ารหัสจริง → อัปโหลด (จำลอง) → Decrypt กลับมาต้องตรงต้นฉบับ', async () => {
    // จำลองผลลัพธ์ pg_dump ที่ผ่าน gzip แล้วจริง (Binary ปนกับ Text ตามสภาพจริง)
    const simulatedPgDumpOutput = Buffer.concat([
      Buffer.from('-- PostgreSQL database dump --\n'),
      crypto.randomBytes(256), // จำลองส่วนที่ gzip บีบอัดแล้ว (Binary)
      Buffer.from('\n-- Dump complete --\n'),
    ]);
    runPgDump.mockResolvedValue(simulatedPgDumpOutput);

    let capturedUpload = null;
    backupStorage.uploadBackup.mockImplementation(async (key, buffer) => {
      capturedUpload = { key, buffer };
    });
    backupStorage.listBackups.mockResolvedValue([]);

    await dbBackupJob.runNightlyBackup();

    expect(capturedUpload).not.toBeNull();
    expect(capturedUpload.key).toMatch(/\.sql\.gz\.enc$/);

    // ขั้นตอนเดียวกับที่ scripts/decryptBackup.js ทำจริงตอน Disaster Recovery
    const recovered = decryptBuffer(capturedUpload.buffer, TEST_KEY);

    expect(recovered.equals(simulatedPgDumpOutput)).toBe(true);
    const originalHash = crypto.createHash('sha256').update(simulatedPgDumpOutput).digest('hex');
    const recoveredHash = crypto.createHash('sha256').update(recovered).digest('hex');
    expect(recoveredHash).toBe(originalHash);
  });

  test('Decrypt ด้วย Key ผิด (จำลอง Key หายแล้วใช้ Key อื่น) → ต้อง Fail ไม่คืนขยะ', async () => {
    runPgDump.mockResolvedValue(Buffer.from('sensitive user data'));
    let capturedUpload = null;
    backupStorage.uploadBackup.mockImplementation(async (key, buffer) => {
      capturedUpload = { key, buffer };
    });
    backupStorage.listBackups.mockResolvedValue([]);

    await dbBackupJob.runNightlyBackup();

    const wrongKey = crypto.randomBytes(32).toString('hex');
    expect(() => decryptBuffer(capturedUpload.buffer, wrongKey)).toThrow();
  });
});
