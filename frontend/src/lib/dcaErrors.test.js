import { describe, test, expect } from 'vitest';
import {
  transactionErrorMessage,
  undoErrorMessage,
  slipOcrErrorMessage,
  slipUploadErrorMessage,
  PREMIUM_OCR_MONTHLY_QUOTA,
} from './dcaErrors.js';

describe('transactionErrorMessage', () => {
  test('code ที่รู้จัก → ข้อความไทยที่ตรงกัน', () => {
    expect(transactionErrorMessage('PRICE_REQUIRED_FOR_ASSET')).toMatch(/ราคาต่อหน่วย/);
    expect(transactionErrorMessage('ASSET_LIMIT_REACHED')).toMatch(/Premium/);
    expect(transactionErrorMessage('DATE_IN_FUTURE')).toMatch(/วันที่ไม่เกินวันนี้/);
  });

  test('code ที่ไม่รู้จัก → Fallback เป็น INTERNAL_ERROR เสมอ (ไม่โชว์ code ดิบ)', () => {
    expect(transactionErrorMessage('SOME_UNKNOWN_CODE_XYZ')).toBe(
      transactionErrorMessage('INTERNAL_ERROR')
    );
    expect(transactionErrorMessage(undefined)).toBe(transactionErrorMessage('INTERNAL_ERROR'));
  });

  test('ทุก Error Code ใน API.md §15.2 มีข้อความไทยครบ', () => {
    const codes = [
      'VALIDATION_ERROR',
      'SYMBOL_NOT_SUPPORTED',
      'PRICE_REQUIRED_FOR_ASSET',
      'CURRENCY_NOT_SUPPORTED_FOR_ASSET',
      'DATE_IN_FUTURE',
      'AMOUNT_TOO_SMALL_FOR_PRICE',
      'NOTE_RESERVED_PREFIX',
      'ASSET_LIMIT_REACHED',
      'PRICE_FEED_NOT_IMPLEMENTED',
      'MARKET_PRICE_UNAVAILABLE',
      'GOLD_PRICE_UNAVAILABLE',
    ];
    for (const code of codes) {
      expect(transactionErrorMessage(code)).not.toBe(transactionErrorMessage('SOME_UNKNOWN_CODE'));
    }
  });

  test('Error Code ฝั่งขายมีข้อความไทยเฉพาะตัว (ไม่ตกไป Fallback "ผิดพลาดภายในระบบ")', () => {
    // 4 Code นี้โยนมาจาก validateSell — ถ้าตารางนี้ไม่มี ผู้ใช้ที่ขายเกินยอดจะเห็น
    // "เกิดข้อผิดพลาดภายในระบบ" ทั้งที่แก้เองได้ (ลดจำนวนที่ขาย)
    const sellCodes = [
      'ASSET_NOT_FOUND',
      'NOTHING_TO_SELL',
      'INSUFFICIENT_QUANTITY',
      'SELL_PRICE_REQUIRED',
    ];
    for (const code of sellCodes) {
      expect(transactionErrorMessage(code)).not.toBe(transactionErrorMessage('SOME_UNKNOWN_CODE'));
    }
  });
});

describe('undoErrorMessage', () => {
  test('ทุก Error Code ใน API.md §15.3 มีข้อความไทยเฉพาะตัว', () => {
    const codes = ['NO_TRANSACTION_TO_UNDO', 'ALREADY_UNDONE', 'CANNOT_UNDO_QUANTITY_MISMATCH'];
    for (const code of codes) {
      expect(undoErrorMessage(code)).not.toBe(undoErrorMessage('SOME_UNKNOWN_CODE'));
    }
  });

  test('code ที่ไม่รู้จัก → Fallback เป็น INTERNAL_ERROR', () => {
    expect(undoErrorMessage('NOT_A_REAL_CODE')).toBe(undoErrorMessage('INTERNAL_ERROR'));
  });

  // ── พรอมต์รวมคำ 30 ส.ค. 2569: "ยกเลิก" ไม่ใช่ "ย้อน" ─────────────────────────
  // Founder ต้องการคำเดียวที่เรียกฟีเจอร์นี้ทั้งเว็บ/LINE คือ "ยกเลิกรายการล่าสุด"
  // — กลับคำจาก fix/misleading-messages เดิม (ตอนนั้นใช้ "ย้อน" กลัวชนกับ "ยกเลิก"
  // ของ Pending ที่ไม่เคยบันทึก แต่คำว่า "ล่าสุด"/"รายการนี้" ที่ต่อท้ายทุกข้อความ
  // ในกลุ่มนี้เป็นตัวแยกบริบทอยู่แล้ว)
  test('ทุก Error Code ในกลุ่มนี้ใช้คำว่า "ยกเลิก" ไม่ใช่ "ย้อน"', () => {
    const codes = ['NO_TRANSACTION_TO_UNDO', 'ALREADY_UNDONE', 'CANNOT_UNDO_QUANTITY_MISMATCH'];
    for (const code of codes) {
      expect(undoErrorMessage(code)).not.toContain('ย้อน');
      expect(undoErrorMessage(code)).toContain('ยกเลิก');
    }
  });
});

describe('ข้อ 1 (fix/misleading-messages) — OCR_TRIAL_EXHAUSTED ไม่โกหกว่า Premium "ไม่จำกัด"', () => {
  test('ไม่มีคำว่า "ไม่จำกัด" อีกต่อไป', () => {
    expect(slipOcrErrorMessage('OCR_TRIAL_EXHAUSTED')).not.toContain('ไม่จำกัด');
  });

  // พิสูจน์ว่าข้อความ "อ้างอิง" PREMIUM_OCR_MONTHLY_QUOTA จริง ไม่ใช่ Hardcode เลข 50
  // ลอยๆ ที่บังเอิญตรงกับค่าคงที่ (Assert เทียบกับ String(ค่าคงที่) ไม่ใช่ "50" ตรงๆ
  // — ถ้าใครแก้ค่าคงที่แต่ลืมแก้ข้อความ Test นี้จะจับได้ทันที)
  test('มีเลขโควตาจริงจาก PREMIUM_OCR_MONTHLY_QUOTA อยู่ในข้อความ', () => {
    expect(slipOcrErrorMessage('OCR_TRIAL_EXHAUSTED')).toContain(String(PREMIUM_OCR_MONTHLY_QUOTA));
  });
});

describe('ข้อ 2 (fix/misleading-messages) — CANNOT_ATTACH_TO_REVERSAL ไม่เขียน "(ยกเลิก)" กำกับ "ย้อน"', () => {
  test('ไม่มีคำว่า "(ยกเลิก)" ต่อท้าย "รายการย้อน" อีกต่อไป (สองคำซ้อนกันสื่อผิด)', () => {
    const text = slipUploadErrorMessage('CANNOT_ATTACH_TO_REVERSAL');
    expect(text).not.toContain('(ยกเลิก)');
    expect(text).toContain('ย้อน');
  });
});

describe('ข้อ 6 (fix/misleading-messages) — PRICE_FEED_NOT_IMPLEMENTED ไม่อ้างว่า "รองรับเฉพาะ Crypto"', () => {
  test('ไม่มีคำว่า "เฉพาะ" อีกต่อไป (หุ้นสหรัฐก็ดึงราคาอัตโนมัติได้เช่นกัน)', () => {
    expect(transactionErrorMessage('PRICE_FEED_NOT_IMPLEMENTED')).not.toContain('เฉพาะ');
  });

  test('พูดถึงหุ้นสหรัฐ + สกุล USD เป็นทางที่ใช้ได้จริง', () => {
    const text = transactionErrorMessage('PRICE_FEED_NOT_IMPLEMENTED');
    expect(text).toContain('หุ้นสหรัฐ');
    expect(text).toContain('USD');
  });
});
