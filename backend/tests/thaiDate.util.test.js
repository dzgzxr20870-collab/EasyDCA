const { bangkokYearMonth } = require('../src/utils/thaiDate.util');

describe('bangkokYearMonth', () => {
  test('คืน YYYY-MM ตามเขตเวลา Asia/Bangkok (รับ ISO string)', () => {
    expect(bangkokYearMonth('2026-07-15T05:00:00.000Z')).toBe('2026-07');
  });

  test('เวลาใกล้สิ้นเดือนใน UTC แต่ข้ามเป็นเดือนถัดไปแล้วในไทย (+7) → เดือนไทย', () => {
    // 30 มิ.ย. 20:00 UTC = 1 ก.ค. 03:00 เวลาไทย → ต้องได้ '2026-07' ไม่ใช่ '2026-06'
    expect(bangkokYearMonth('2026-06-30T20:00:00.000Z')).toBe('2026-07');
  });

  test('ข้ามปี: 31 ธ.ค. 20:00 UTC = 1 ม.ค. ปีถัดไปเวลาไทย', () => {
    expect(bangkokYearMonth('2026-12-31T20:00:00.000Z')).toBe('2027-01');
  });

  test('รับ Date object ได้เช่นเดียวกับ ISO string', () => {
    expect(bangkokYearMonth(new Date('2026-03-10T00:00:00.000Z'))).toBe('2026-03');
  });
});
