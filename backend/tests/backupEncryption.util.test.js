const crypto = require('crypto');
const { encryptBuffer, decryptBuffer } = require('../src/utils/backupEncryption.util');

// Key ทดสอบ — Hex 64 ตัวอักษร (32 Bytes) ที่ถูกต้องตาม Format จริง
const VALID_KEY = crypto.randomBytes(32).toString('hex');
const OTHER_KEY = crypto.randomBytes(32).toString('hex');

describe('encryptBuffer / decryptBuffer — Round-trip', () => {
  test('Encrypt แล้ว Decrypt กลับมาต้องได้ Buffer เดิมเป๊ะ (Byte-for-byte)', () => {
    const original = Buffer.from('-- SQL dump content with ข้อมูลภาษาไทย --\n1234567890', 'utf-8');

    const encrypted = encryptBuffer(original, VALID_KEY);
    const decrypted = decryptBuffer(encrypted, VALID_KEY);

    expect(decrypted.equals(original)).toBe(true);
    // เทียบ Checksum ด้วยอีกชั้น (ตามที่ระบุใน DoD) ไม่ใช่แค่ .equals()
    const originalHash = crypto.createHash('sha256').update(original).digest('hex');
    const decryptedHash = crypto.createHash('sha256').update(decrypted).digest('hex');
    expect(decryptedHash).toBe(originalHash);
  });

  test('Buffer ว่างเปล่า (Edge Case) → Round-trip ได้ปกติ', () => {
    const original = Buffer.alloc(0);

    const encrypted = encryptBuffer(original, VALID_KEY);
    const decrypted = decryptBuffer(encrypted, VALID_KEY);

    expect(decrypted.equals(original)).toBe(true);
  });

  test('Buffer ขนาดใหญ่ (1MB จำลอง Real Backup) → Round-trip ได้ปกติ', () => {
    const original = crypto.randomBytes(1024 * 1024);

    const encrypted = encryptBuffer(original, VALID_KEY);
    const decrypted = decryptBuffer(encrypted, VALID_KEY);

    expect(decrypted.equals(original)).toBe(true);
  });

  test('เข้ารหัส Buffer เดิมซ้ำ 2 ครั้งด้วย Key เดียวกัน → ได้ Ciphertext ไม่เหมือนกัน (IV สุ่มใหม่ทุกครั้ง)', () => {
    const original = Buffer.from('same content');

    const encrypted1 = encryptBuffer(original, VALID_KEY);
    const encrypted2 = encryptBuffer(original, VALID_KEY);

    expect(encrypted1.equals(encrypted2)).toBe(false);
    // แต่ Decrypt กลับมาต้องได้ผลลัพธ์เดิมทั้งคู่
    expect(decryptBuffer(encrypted1, VALID_KEY).equals(original)).toBe(true);
    expect(decryptBuffer(encrypted2, VALID_KEY).equals(original)).toBe(true);
  });
});

describe('decryptBuffer — Key ผิด ต้อง Fail ชัดเจน', () => {
  test('Decrypt ด้วย Key อื่น (Format ถูกแต่คนละ Key) → throw ไม่คืนขยะเงียบๆ', () => {
    const original = Buffer.from('secret data');
    const encrypted = encryptBuffer(original, VALID_KEY);

    expect(() => decryptBuffer(encrypted, OTHER_KEY)).toThrow(/wrong BACKUP_ENCRYPTION_KEY|corrupted|tampered/);
  });
});

describe('decryptBuffer — IV/Envelope เสียหาย ต้อง Fail ชัดเจน', () => {
  test('ไฟล์สั้นเกินไป (ไม่มี IV/AuthTag ครบ) → throw บอกว่า Truncated/Corrupt', () => {
    const tooShort = Buffer.from('not a real backup file');

    expect(() => decryptBuffer(tooShort, VALID_KEY)).toThrow(/truncated or corrupt/);
  });

  test('Buffer ว่างเปล่าทั้งไฟล์ → throw บอกว่า Truncated/Corrupt', () => {
    expect(() => decryptBuffer(Buffer.alloc(0), VALID_KEY)).toThrow(/truncated or corrupt/);
  });

  test('Magic Bytes ไม่ตรง (ไม่ใช่ไฟล์ที่ Encrypt ด้วยระบบนี้) → throw บอกชัดเจน', () => {
    // ประกอบ Buffer ความยาวพอ (ผ่าน Length Check) แต่ Magic Bytes ผิด
    const fakeEnvelope = Buffer.concat([Buffer.from('XXXX'), crypto.randomBytes(29)]);

    expect(() => decryptBuffer(fakeEnvelope, VALID_KEY)).toThrow(/magic bytes mismatch/);
  });

  test('IV/AuthTag/Ciphertext ถูกแก้ไข (Tamper) → GCM Auth Tag ไม่ตรง → throw', () => {
    const original = Buffer.from('important data');
    const encrypted = encryptBuffer(original, VALID_KEY);

    // แก้ Byte 1 ตัวกลาง Ciphertext (หลัง Header 33 Bytes) — จำลองไฟล์เสียหาย/ถูกแก้
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decryptBuffer(tampered, VALID_KEY)).toThrow(/wrong BACKUP_ENCRYPTION_KEY|corrupted|tampered/);
  });

  test('Version Byte ไม่รู้จัก → throw บอก Unsupported Version', () => {
    const original = Buffer.from('data');
    const encrypted = encryptBuffer(original, VALID_KEY);
    const withBadVersion = Buffer.from(encrypted);
    withBadVersion[4] = 99; // Byte ที่ 5 (Index 4) คือ Version

    expect(() => decryptBuffer(withBadVersion, VALID_KEY)).toThrow(/Unsupported encrypted backup format version/);
  });
});

describe('Key Format Validation', () => {
  test('encryptBuffer: ไม่มี Key เลย → throw บอกวิธี Generate', () => {
    expect(() => encryptBuffer(Buffer.from('x'), null)).toThrow(/BACKUP_ENCRYPTION_KEY is not configured/);
    expect(() => encryptBuffer(Buffer.from('x'), undefined)).toThrow(/BACKUP_ENCRYPTION_KEY is not configured/);
    expect(() => encryptBuffer(Buffer.from('x'), '')).toThrow(/BACKUP_ENCRYPTION_KEY is not configured/);
  });

  test('encryptBuffer: Key สั้น/ยาวเกินไป → throw บอกต้อง 64 Hex Characters', () => {
    expect(() => encryptBuffer(Buffer.from('x'), 'abcd')).toThrow(/64 hex characters/);
    expect(() => encryptBuffer(Buffer.from('x'), 'a'.repeat(63))).toThrow(/64 hex characters/);
    expect(() => encryptBuffer(Buffer.from('x'), 'a'.repeat(65))).toThrow(/64 hex characters/);
  });

  test('encryptBuffer: Key มีตัวอักษรที่ไม่ใช่ Hex → throw (กัน Node Buffer.from Hex ตัดทิ้งเงียบๆ)', () => {
    // 'g' ไม่ใช่ Hex Digit — ถ้าไม่เช็ค Format เอง Buffer.from(hex) จะตัดทิ้งเงียบๆ
    // แล้วได้ Key สั้นกว่าที่ควรโดยไม่มี Error ชัดเจน
    const invalidHex = 'g'.repeat(64);
    expect(() => encryptBuffer(Buffer.from('x'), invalidHex)).toThrow(/64 hex characters/);
  });

  test('decryptBuffer: Key Format ผิดก็ต้อง Validate เหมือนกัน (ก่อนแม้แต่จะพยายามอ่าน Envelope)', () => {
    expect(() => decryptBuffer(Buffer.from('irrelevant'), 'not-a-valid-key')).toThrow(/64 hex characters/);
  });
});
