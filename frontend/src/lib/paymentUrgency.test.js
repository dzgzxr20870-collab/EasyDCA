import { describe, test, expect } from 'vitest';
import { getUrgencyLevel, isAutoReleased, isWithinDays } from './paymentUrgency.js';

const NOW = new Date('2026-07-17T00:00:00.000Z');

function hoursAgo(hours) {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

describe('getUrgencyLevel', () => {
  test('เพิ่งสร้าง (elapsed=0) → normal', () => {
    expect(getUrgencyLevel(hoursAgo(0), NOW)).toBe('normal');
  });

  test('เหลือ 49 ชม. (ยังไม่ถึง Threshold เตือน) → normal', () => {
    expect(getUrgencyLevel(hoursAgo(168 - 49), NOW)).toBe('normal');
  });

  test('เหลือพอดี 48 ชม. (Boundary) → warning', () => {
    expect(getUrgencyLevel(hoursAgo(168 - 48), NOW)).toBe('warning');
  });

  test('เหลือ 25 ชม. (ยังไม่ถึง Threshold แดง) → warning', () => {
    expect(getUrgencyLevel(hoursAgo(168 - 25), NOW)).toBe('warning');
  });

  test('เหลือพอดี 24 ชม. (Boundary) → urgent', () => {
    expect(getUrgencyLevel(hoursAgo(168 - 24), NOW)).toBe('urgent');
  });

  test('เลย 7 วันไปแล้วแต่ Cron ยังไม่ Auto-release (เวลาที่เหลือติดลบ) → urgent', () => {
    expect(getUrgencyLevel(hoursAgo(200), NOW)).toBe('urgent');
  });
});

describe('isAutoReleased', () => {
  test('amountReleasedAt ถูกตั้งค่า + ไม่มี confirmedBy → true (Cron ปล่อยยอดคืน ไม่มีใคร Resolve)', () => {
    expect(
      isAutoReleased({ amountReleasedAt: '2026-07-17T00:00:00.000Z', confirmedBy: null })
    ).toBe(true);
  });

  test('amountReleasedAt ถูกตั้งค่า + มี confirmedBy → false (Admin กด Approve/Reject เอง)', () => {
    expect(
      isAutoReleased({ amountReleasedAt: '2026-07-17T00:00:00.000Z', confirmedBy: 'Uadmin1' })
    ).toBe(false);
  });

  test('amountReleasedAt ยังเป็น null (ยังถูกล็อกอยู่) → false', () => {
    expect(isAutoReleased({ amountReleasedAt: null, confirmedBy: null })).toBe(false);
  });

  test('payment เป็น null/undefined → false (ไม่ Crash)', () => {
    expect(isAutoReleased(null)).toBe(false);
    expect(isAutoReleased(undefined)).toBe(false);
  });
});

describe('isWithinDays', () => {
  test('dateStr ว่าง → false', () => {
    expect(isWithinDays(null, 30, NOW)).toBe(false);
    expect(isWithinDays(undefined, 30, NOW)).toBe(false);
  });

  test('อยู่ในช่วง 30 วันล่าสุด → true', () => {
    const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 3_600_000).toISOString();
    expect(isWithinDays(tenDaysAgo, 30, NOW)).toBe(true);
  });

  test('พอดี 30 วัน (Boundary) → true', () => {
    const exactly30 = new Date(NOW.getTime() - 30 * 24 * 3_600_000).toISOString();
    expect(isWithinDays(exactly30, 30, NOW)).toBe(true);
  });

  test('เกิน 30 วันไปแล้ว → false', () => {
    const over30 = new Date(NOW.getTime() - (30 * 24 * 3_600_000 + 1)).toISOString();
    expect(isWithinDays(over30, 30, NOW)).toBe(false);
  });

  test('วันที่ในอนาคต (edge case ที่ไม่ควรเกิดจริง) → false', () => {
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(isWithinDays(future, 30, NOW)).toBe(false);
  });
});
