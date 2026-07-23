jest.mock('../src/utils/pgDump.util');
jest.mock('../src/services/backupStorage.service');
jest.mock('../src/services/healthAlert.service');

jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    supabase: { ...actual.supabase, databaseUrl: 'postgresql://user:pass@host:5432/db' },
    backup: { ...actual.backup, retentionDays: 14 },
  };
});

const { runPgDump } = require('../src/utils/pgDump.util');
const backupStorage = require('../src/services/backupStorage.service');
const healthAlert = require('../src/services/healthAlert.service');
const config = require('../src/config/env');
const dbBackupJob = require('../src/jobs/dbBackup.job');

beforeEach(() => {
  jest.clearAllMocks();
  backupStorage.isConfigured.mockReturnValue(true);
  healthAlert.pushAdminAlert.mockResolvedValue(undefined);
});

describe('runNightlyBackup', () => {
  test('สำเร็จ: pg_dump → อัปโหลด → Purge เก่าเกิน Retention → ไม่ Push Alert', async () => {
    runPgDump.mockResolvedValue(Buffer.from('fake-gzip-content'));
    backupStorage.uploadBackup.mockResolvedValue(undefined);
    backupStorage.listBackups.mockResolvedValue([]);

    await dbBackupJob.runNightlyBackup();

    expect(runPgDump).toHaveBeenCalledWith('postgresql://user:pass@host:5432/db');
    expect(backupStorage.uploadBackup).toHaveBeenCalledTimes(1);
    const [key, buffer] = backupStorage.uploadBackup.mock.calls[0];
    expect(key).toMatch(/^db-backups\/easydca-.+\.sql\.gz$/);
    expect(buffer).toEqual(Buffer.from('fake-gzip-content'));
    expect(healthAlert.pushAdminAlert).not.toHaveBeenCalled();
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
  test('ประกอบ Key จาก Timestamp ที่ไม่มี Colon/Dot (Path-safe)', () => {
    const key = dbBackupJob.backupKey(new Date('2026-07-24T03:00:00.000Z'));
    expect(key).toBe('db-backups/easydca-2026-07-24T03-00-00-000Z.sql.gz');
  });
});
