// ═══════════════════════════════════════════════════════════════════════════
// Unit — Data Access Helper กลาง (queryForUser / queryAcrossUsers)
// ═══════════════════════════════════════════════════════════════════════════
// DoD ชั้นที่ 1 (Unit) ของงาน Data Access Helper — Guard Matrix ล้วนๆ แยกจาก
// การยิง DB จริง: userId ว่าง/null/undefined ต้อง throw, reason ไม่อยู่ใน Enum
// ต้อง throw, ตารางที่ไม่ได้ลงทะเบียนต้อง throw — ทุกกรณี "ก่อน" ที่จะมีโอกาส
// ยิง Query ออกไปเลย (ยืนยันด้วย supabaseAdmin.from ไม่ถูกเรียก)
//
// ใช้ Fake Supabase ตัวเดียวกับ Cross-User Isolation Regression Test (Reuse ตาม
// AI_WORK_POLICY.md — ไม่เขียน Mock คู่ขนาน) เพื่อพิสูจน์ Happy Path ว่า
// queryForUser ต่อ .eq(ownedColumn, userId) ให้จริง ไม่ใช่แค่ไม่ Throw
jest.mock('../src/config/supabase', () => {
  const { createClient } = require('./helpers/fakeSupabase');
  return { supabaseAdmin: createClient() };
});

const { supabaseAdmin } = require('../src/config/supabase');
const { tables, resetTables } = require('./helpers/fakeSupabase');
const {
  requireUserId,
  queryForUser,
  queryAcrossUsers,
  OwnershipError,
  TABLE_REGISTRY,
  VALID_CROSS_USER_REASONS,
} = require('../src/utils/ownership.util');

beforeEach(() => {
  resetTables({
    transactions: [
      { id: 't1', user_id: 'user-a', asset_id: 'asset-1', amount_thb: 100 },
      { id: 't2', user_id: 'user-b', asset_id: 'asset-1', amount_thb: 999 },
    ],
    users: [
      { id: 'user-a', display_name: 'A' },
      { id: 'user-b', display_name: 'B' },
    ],
  });
});

describe('requireUserId — Guard Matrix', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
    ['ช่องว่างล้วน', '   '],
    ['number', 42],
    ['object', { id: 'x' }],
  ])('userId = %s → throw MISSING_USER_ID', (_label, bad) => {
    expect(() => requireUserId(bad, 'test-context')).toThrow(OwnershipError);
    try {
      requireUserId(bad, 'test-context');
    } catch (err) {
      expect(err.code).toBe('MISSING_USER_ID');
    }
  });

  test('userId ใช้ได้ → คืนค่าเดิม ไม่ throw', () => {
    expect(requireUserId('user-a', 'ctx')).toBe('user-a');
  });
});

describe('queryForUser — Guard Matrix', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
    ['ช่องว่างล้วน', '   '],
  ])('userId = %s → throw MISSING_USER_ID และไม่ยิง Query เลย', (_label, bad) => {
    expect(() => queryForUser('transactions', bad, (q) => q.select('*'))).toThrow(
      expect.objectContaining({ code: 'MISSING_USER_ID' })
    );
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  test('ตารางที่ไม่ได้ลงทะเบียนใน Registry → throw UNKNOWN_TABLE', () => {
    expect(() => queryForUser('no_such_table', 'user-a', (q) => q.select('*'))).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_TABLE' })
    );
  });

  test('ตารางที่ลงทะเบียนเป็น Cross-user only (ownedColumn: null) → throw NOT_USER_OWNED_TABLE', () => {
    expect(() => queryForUser('users', 'user-a', (q) => q.select('*'))).toThrow(
      expect.objectContaining({ code: 'NOT_USER_OWNED_TABLE' })
    );
  });

  test('Happy Path: ต่อ .eq(ownedColumn, userId) ให้จริง — ผู้ใช้ A เห็นเฉพาะแถวของตัวเอง', async () => {
    const { data, error } = await queryForUser('transactions', 'user-a', (q) =>
      q.select('*').eq('asset_id', 'asset-1')
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: 't1', user_id: 'user-a' });
  });

  test('Happy Path: userId ของ B ไม่เห็นแถวของ A แม้ Filter อื่นตรงกันหมด', async () => {
    const { data } = await queryForUser('transactions', 'user-b', (q) =>
      q.select('*').eq('asset_id', 'asset-1')
    );

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: 't2', user_id: 'user-b' });
  });

  test('buildQuery ใส่ .eq(user_id, ...) เองไม่ได้ผลอะไรเพิ่ม — Helper ต่อให้เองเสมอ (โครงสร้างบังคับ ไม่ใช่วินัย)', async () => {
    // แม้ Caller "ลืม" ใส่ Filter อื่นเลย ก็ยังปลอดภัยเพราะ Helper ต่อ eq(ownedColumn) ให้
    const { data } = await queryForUser('transactions', 'user-a', (q) => q.select('*'));
    expect(data.every((row) => row.user_id === 'user-a')).toBe(true);
  });
});

describe('queryAcrossUsers — Guard Matrix', () => {
  test.each([
    ['String อิสระที่ไม่อยู่ใน Enum', 'because-i-said-so'],
    ['สตริงว่าง', ''],
    ['undefined', undefined],
    ['พิมพ์ผิดจาก Enum จริง (Admin ตัวใหญ่)', 'Admin'],
  ])('reason = %s → throw INVALID_CROSS_USER_REASON', (_label, badReason) => {
    expect(() => queryAcrossUsers('payments', badReason)).toThrow(
      expect.objectContaining({ code: 'INVALID_CROSS_USER_REASON' })
    );
  });

  test('ตารางที่ไม่ได้ลงทะเบียน → throw UNKNOWN_TABLE แม้ reason ถูกต้อง', () => {
    expect(() => queryAcrossUsers('no_such_table', 'admin')).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_TABLE' })
    );
  });

  test.each(VALID_CROSS_USER_REASONS)('reason = %s (ค่าจริงจาก Enum) → ไม่ throw', (reason) => {
    expect(() => queryAcrossUsers('payments', reason)).not.toThrow();
  });

  test('Happy Path: คืน Query ที่ไม่มี Filter ผู้ใช้ — เห็นข้อมูลข้าม User ได้ตามเจตนา', async () => {
    const { data } = await queryAcrossUsers('users', 'admin').select('*');
    expect(data).toHaveLength(2);
    expect(data.map((u) => u.id).sort()).toEqual(['user-a', 'user-b']);
  });
});

describe('TABLE_REGISTRY — ความครบถ้วน', () => {
  test('ครอบทุกตารางที่ 8 จุดสีส้มใช้จริง', () => {
    for (const table of ['transactions', 'assets', 'payments', 'facebook_like_grant_requests']) {
      expect(TABLE_REGISTRY[table]).toBeDefined();
      expect(TABLE_REGISTRY[table].ownedColumn).toBe('user_id');
    }
  });

  test('Registry เป็น Object ที่ Freeze แล้ว — แก้ไม่ได้โดยไม่ตั้งใจ', () => {
    expect(Object.isFrozen(TABLE_REGISTRY)).toBe(true);
  });
});
