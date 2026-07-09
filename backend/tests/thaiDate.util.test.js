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

describe('parseDateInput', () => {
  const { parseDateInput } = require('../src/utils/thaiDate.util');

  test('ปี พ.ศ. (>= 2100) → แปลงเป็น ค.ศ. อัตโนมัติ', () => {
    expect(parseDateInput('01/03/2569')).toBe('2026-03-01');
  });

  test('ปี ค.ศ. (< 2100) → ใช้ตรงๆ ไม่แปลง', () => {
    expect(parseDateInput('15/06/2026')).toBe('2026-06-15');
  });

  test('วัน/เดือนหลักเดียว → รองรับและ Pad เป็น 2 หลักใน Output', () => {
    expect(parseDateInput('1/3/2569')).toBe('2026-03-01');
  });

  test('29 กุมภาพันธ์ปีอธิกสุรทิน (ค.ศ. 2028) → ผ่าน', () => {
    expect(parseDateInput('29/02/2028')).toBe('2028-02-29');
  });

  test('29 กุมภาพันธ์ปีไม่อธิกสุรทิน (ค.ศ. 2026) → null', () => {
    expect(parseDateInput('29/02/2026')).toBeNull();
  });

  test('เดือนนอกช่วง (13) → null', () => {
    expect(parseDateInput('01/13/2569')).toBeNull();
  });

  test('วันนอกช่วงของเดือนนั้น (31 เมษายน) → null', () => {
    expect(parseDateInput('31/04/2569')).toBeNull();
  });

  test('รูปแบบผิด (ไม่ใช่ DD/MM/YYYY) → null', () => {
    expect(parseDateInput('2026-03-01')).toBeNull();
    expect(parseDateInput('01-03-2569')).toBeNull();
    expect(parseDateInput('ไม่ใช่วันที่')).toBeNull();
  });

  test('ปีไม่ครบ 4 หลัก → null (กันตีความปีผิด)', () => {
    expect(parseDateInput('01/03/69')).toBeNull();
  });

  test('ไม่ใช่ string → null', () => {
    expect(parseDateInput(null)).toBeNull();
    expect(parseDateInput(undefined)).toBeNull();
    expect(parseDateInput(20260301)).toBeNull();
  });
});
