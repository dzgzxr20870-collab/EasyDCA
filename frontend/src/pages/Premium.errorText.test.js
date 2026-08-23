import { describe, test, expect } from 'vitest';
import { errorText } from './Premium.jsx';

// ═══════════════════════════════════════════════════════════════════════
// Premium.errorText — ข้อ 3.2 (fix/misleading-messages)
// ═══════════════════════════════════════════════════════════════════════
// เดิม PAYMENT_NOT_PENDING ตอบ "คำขอนี้ถูกดำเนินการไปแล้ว กรุณาเริ่มใหม่" เหมือนกัน
// หมดไม่ว่า Admin จะอนุมัติหรือปฏิเสธ — ผู้ใช้ไม่รู้ว่าได้ Premium หรือยัง ทั้งที่
// err.details.status ถูกเดินสายมาจาก payment.controller.handlePaymentError ผ่าน
// frontend/src/lib/api.js (apiPost/apiUpload แนบ .details ให้ Error ที่ throw) แล้ว
describe('errorText — PAYMENT_NOT_PENDING แยกข้อความตาม status จริง', () => {
  test('status=approved → บอกว่าอนุมัติแล้ว ได้ Premium', () => {
    expect(errorText('PAYMENT_NOT_PENDING', { status: 'approved' })).toContain('อนุมัติแล้ว');
  });

  test('status=rejected → บอกว่าถูกปฏิเสธ', () => {
    expect(errorText('PAYMENT_NOT_PENDING', { status: 'rejected' })).toContain('ถูกปฏิเสธ');
  });

  test('status=reviewing → บอกว่ากำลังตรวจสอบอยู่', () => {
    expect(errorText('PAYMENT_NOT_PENDING', { status: 'reviewing' })).toContain('ระหว่างตรวจสอบ');
  });

  test('status=expired → บอกว่าหมดเวลาแล้ว', () => {
    expect(errorText('PAYMENT_NOT_PENDING', { status: 'expired' })).toContain('หมดเวลา');
  });

  test('approved / rejected / reviewing / expired ได้ข้อความไม่ซ้ำกันเลยสักคู่', () => {
    const msgs = ['approved', 'rejected', 'reviewing', 'expired'].map((status) =>
      errorText('PAYMENT_NOT_PENDING', { status })
    );
    expect(new Set(msgs).size).toBe(4);
  });

  // err.details อาจไม่มี (Response เก่า/Network Error ที่ apiPost คืน Error ธรรมดา)
  // ต้อง Fallback ข้อความเดิม ไม่ throw
  test('ไม่มี details เลย → Fallback ข้อความเดิม', () => {
    expect(errorText('PAYMENT_NOT_PENDING')).toBe('คำขอนี้ถูกดำเนินการไปแล้ว กรุณาเริ่มใหม่');
  });

  test('status ที่ไม่รู้จัก → Fallback ข้อความเดิมเช่นกัน', () => {
    expect(errorText('PAYMENT_NOT_PENDING', { status: 'some_future_status' })).toBe(
      'คำขอนี้ถูกดำเนินการไปแล้ว กรุณาเริ่มใหม่'
    );
  });

  // Code อื่นที่ไม่ใช่ PAYMENT_NOT_PENDING ต้องไม่ถูกกระทบแม้ details.status จะมีค่า
  test('Code อื่น (PAYMENT_NOT_FOUND) ไม่ถูกกระทบแม้ details.status จะมีค่า', () => {
    expect(errorText('PAYMENT_NOT_FOUND', { status: 'approved' })).toBe(
      'ไม่พบคำขอชำระเงินนี้ กรุณาเริ่มใหม่'
    );
  });

  test('code ที่ไม่รู้จักเลย → Fallback INTERNAL_ERROR', () => {
    expect(errorText('SOME_UNKNOWN_CODE')).toBe('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  });
});
