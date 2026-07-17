import { describe, test, expect } from 'vitest';
import { transactionErrorMessage, undoErrorMessage } from './dcaErrors.js';

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
});
