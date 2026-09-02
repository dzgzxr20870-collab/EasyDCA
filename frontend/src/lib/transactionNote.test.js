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

  // พรอมต์รวมคำ 30 ส.ค. 2569: Founder ต้องการคำเดียวที่เรียกฟีเจอร์นี้ทั้งเว็บ/LINE
  // คือ "ยกเลิกรายการล่าสุด" — กลับคำจาก fix/misleading-messages ข้อ 2 เดิมที่ห้าม
  // ใช้ "ยกเลิก" กับรายการนี้ (ตอนนั้นกลัวชนกับ Pending ที่ไม่เคยบันทึก แต่คำว่า
  // "ล่าสุด" ที่ต่อท้ายทุกจุดเป็นตัวแยกความกำกวมอยู่แล้ว)
  test('ใช้คำว่า "ยกเลิก" กับรายการ Reversal (ไม่ใช่ "ย้อน" อีกต่อไป)', () => {
    const text = formatTransactionNote('UNDO_OF:9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f');
    expect(text).toContain('ยกเลิก');
    expect(text).not.toContain('ย้อน');
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
