import { describe, test, expect } from 'vitest';
import { isReversalNote, formatTransactionNote } from './transactionNote.js';

describe('isReversalNote', () => {
  test('note ขึ้นต้นด้วย UNDO_OF: → true', () => {
    expect(isReversalNote('UNDO_OF:9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f')).toBe(true);
  });

  test('note ปกติที่ผู้ใช้พิมพ์เอง → false', () => {
    expect(isReversalNote('DCA รายเดือน')).toBe(false);
  });

  test('null/undefined/ค่าว่าง → false ไม่ Throw', () => {
    expect(isReversalNote(null)).toBe(false);
    expect(isReversalNote(undefined)).toBe(false);
    expect(isReversalNote('')).toBe(false);
  });
});

describe('formatTransactionNote', () => {
  test('Reversal note → ข้อความอ่านง่าย ไม่โชว์ UUID ดิบ', () => {
    expect(formatTransactionNote('UNDO_OF:9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f')).toBe('↩︎ ยกเลิกรายการ');
  });

  test('Note ปกติ → แสดงตามที่พิมพ์จริงตรงๆ ไม่แก้ไข', () => {
    expect(formatTransactionNote('DCA รายเดือน')).toBe('DCA รายเดือน');
  });

  test('null/undefined/ค่าว่าง → null (Caller ตัดสินใจเองว่าจะโชว์ - หรือเว้นว่าง)', () => {
    expect(formatTransactionNote(null)).toBeNull();
    expect(formatTransactionNote(undefined)).toBeNull();
    expect(formatTransactionNote('')).toBeNull();
  });
});
