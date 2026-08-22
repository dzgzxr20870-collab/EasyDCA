import { describe, expect, it } from 'vitest';
import { slipOcrErrorMessage, isSlipOcrUpgradeError } from './dcaErrors.js';

// ═══════════════════════════════════════════════════════════════════════
// slipOcrErrorMessage / isSlipOcrUpgradeError (งานที่ 2.2)
// ═══════════════════════════════════════════════════════════════════════
// Error Code ทุกตัวต้องมาจาก transactions.controller (WEB_ERROR_MESSAGES ชุด OCR_*)
// ของจริง — ถ้าฝั่ง Backend เพิ่ม Code ใหม่แล้วลืมเติมที่นี่ ผู้ใช้จะเห็นข้อความ
// Fallback กลางๆ แทนคำอธิบายที่ทำตามได้ (แต่ต้องไม่เห็น Error Code ดิบเด็ดขาด)
describe('slipOcrErrorMessage', () => {
  const CODES_FROM_BACKEND = [
    'OCR_PREMIUM_REQUIRED',
    'OCR_TRIAL_EXHAUSTED',
    'OCR_QUOTA_EXCEEDED',
    'OCR_CALL_LIMIT_EXCEEDED',
    'OCR_RATE_LIMITED',
    'OCR_NOT_A_SLIP',
    'OCR_MULTIPLE_ITEMS',
    'OCR_FAILED',
    'OCR_NOT_CONFIGURED',
    'INVALID_SLIP_CONTENT_TYPE',
    'SLIP_TOO_LARGE',
    'EMPTY_BODY',
  ];

  it.each(CODES_FROM_BACKEND)('มีข้อความไทยเฉพาะสำหรับ %s (ไม่ตกไป Fallback)', (code) => {
    const message = slipOcrErrorMessage(code);
    expect(message).toBeTruthy();
    // ต้องไม่ใช่ข้อความ Fallback กลางๆ
    expect(message).not.toBe(slipOcrErrorMessage('SOME_UNKNOWN_CODE'));
    // ห้ามโชว์ Error Code ดิบให้ผู้ใช้เห็น
    expect(message).not.toContain(code);
  });

  it('code ที่ไม่รู้จัก → Fallback ข้อความกลางๆ ไม่โชว์ code ดิบ', () => {
    const message = slipOcrErrorMessage('TOTALLY_UNKNOWN');
    expect(message).toBe('อ่านสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    expect(message).not.toContain('TOTALLY_UNKNOWN');
  });

  it('undefined/null → Fallback ไม่ throw', () => {
    expect(() => slipOcrErrorMessage(undefined)).not.toThrow();
    expect(slipOcrErrorMessage(null)).toBeTruthy();
  });

  // เคสที่ระบบอ่านไม่ออก/ผู้ใช้ส่งถี่เกินไป ต้องบอกชัดว่าไม่ถูกนับโควตา —
  // ผู้ใช้ที่จ่ายค่า Premium ต้องไม่รู้สึกว่าโควตาหายไปกับรูปที่ระบบอ่านไม่ออก
  it.each(['OCR_NOT_A_SLIP', 'OCR_MULTIPLE_ITEMS', 'OCR_FAILED'])(
    '%s ต้องระบุว่าไม่ถูกนับโควตา',
    (code) => {
      expect(slipOcrErrorMessage(code)).toContain('โควตา');
    }
  );
});

describe('isSlipOcrUpgradeError', () => {
  // ปุ่ม "อัพเกรด Premium" ควรโผล่เฉพาะตอนที่การอัพเกรดแก้ปัญหาได้จริงเท่านั้น
  it.each(['OCR_PREMIUM_REQUIRED', 'OCR_TRIAL_EXHAUSTED'])('%s → โชว์ปุ่มอัพเกรด', (code) => {
    expect(isSlipOcrUpgradeError(code)).toBe(true);
  });

  // ⚠️ เคสที่ผู้ใช้แก้เองได้ ห้ามขายของซ้ำเติม (รูปเบลอ/ส่งถี่/ระบบล่ม) — และเคส
  // โควตาเดือนนี้เต็มก็อัพเกรดไม่ช่วย (เป็น Premium อยู่แล้ว)
  it.each([
    'OCR_NOT_A_SLIP',
    'OCR_MULTIPLE_ITEMS',
    'OCR_RATE_LIMITED',
    'OCR_FAILED',
    'OCR_QUOTA_EXCEEDED',
    'OCR_CALL_LIMIT_EXCEEDED',
    'SLIP_TOO_LARGE',
  ])('%s → ไม่โชว์ปุ่มอัพเกรด', (code) => {
    expect(isSlipOcrUpgradeError(code)).toBe(false);
  });

  it('code ที่ไม่รู้จัก → ไม่โชว์ปุ่มอัพเกรด', () => {
    expect(isSlipOcrUpgradeError('UNKNOWN')).toBe(false);
  });
});
