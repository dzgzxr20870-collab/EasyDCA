import { describe, test, expect } from 'vitest';
import { todayBangkokIso } from './dateBangkok.js';

describe('todayBangkokIso', () => {
  test('คืนรูปแบบ YYYY-MM-DD', () => {
    expect(todayBangkokIso(new Date('2026-07-17T05:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('ใช้เวลาไทย ไม่ใช่ UTC — 17:30 UTC ของวันที่ 31 ก.ค. = 00:30 วันที่ 1 ส.ค. ไทย', () => {
    expect(todayBangkokIso(new Date('2026-07-31T17:30:00Z'))).toBe('2026-08-01');
  });

  test('เที่ยงคืน UTC พอดี (07:00 เช้าไทย) → วันเดียวกับ UTC', () => {
    expect(todayBangkokIso(new Date('2026-07-17T00:00:00Z'))).toBe('2026-07-17');
  });
});
