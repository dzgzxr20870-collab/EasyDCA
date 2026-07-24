import { describe, test, expect } from 'vitest';
import { dcaPlanErrorMessage, isUpgradeRequiredError } from './dcaPlansErrors.js';

describe('dcaPlanErrorMessage', () => {
  test('code ที่รู้จัก → ข้อความไทยตรงตัว', () => {
    expect(dcaPlanErrorMessage('SYMBOL_NOT_SUPPORTED')).toMatch(/ยังไม่รองรับ/);
  });

  test('PLAN_LIMIT_REACHED → ข้อความชวนอัพเกรด (DCA Planner Gate)', () => {
    expect(dcaPlanErrorMessage('PLAN_LIMIT_REACHED')).toMatch(/Premium/);
  });

  test('code ที่ไม่รู้จัก → Fallback ข้อความกลางๆ (ไม่โชว์ Code ดิบ)', () => {
    const msg = dcaPlanErrorMessage('SOMETHING_WEIRD');
    expect(msg).toBe(dcaPlanErrorMessage('INTERNAL_ERROR'));
  });
});

describe('isUpgradeRequiredError', () => {
  test('PLAN_LIMIT_REACHED → true (โชว์ปุ่มอัพเกรด)', () => {
    expect(isUpgradeRequiredError('PLAN_LIMIT_REACHED')).toBe(true);
  });

  test('Error อื่น → false (แก้ที่ฟอร์มได้เอง ไม่ต้องอัพเกรด)', () => {
    expect(isUpgradeRequiredError('VALIDATION_ERROR')).toBe(false);
    expect(isUpgradeRequiredError('SYMBOL_NOT_SUPPORTED')).toBe(false);
    expect(isUpgradeRequiredError(undefined)).toBe(false);
  });
});
