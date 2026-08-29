// ═══════════════════════════════════════════════════════════════════════════
// dcaPlanFormLogic — Payload ที่จะถูกส่งไป POST /api/v1/dca-plans ต้องตรง Contract
// ═══════════════════════════════════════════════════════════════════════════
// repo นี้ไม่มี jsdom/RTL → ทดสอบ "กรอกฟอร์มแล้วกดบันทึก" แบบ Interaction ไม่ได้
// การย้ายการตัดสินใจมาไว้ใน Pure Function ทำให้ assert **ตัว Payload ตรงๆ** ได้
// ซึ่งเข้มกว่าการ Mock ผ่าน Component
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • ถอดการตรวจช่วง frequencyValue ออก → เคส weekly 7 / monthly 32 แดง
//   • เปลี่ยน currency เป็นส่ง form.currency ดิบ → เคส USD/ค่าแปลก แดง
//   • ให้ existingPlanForSymbol เทียบแบบ case-sensitive → เคส 'btc' แดง

import { describe, test, expect } from 'vitest';
import {
  validateDcaPlanForm,
  existingPlanForSymbol,
  describeSchedule,
  WEEKDAY_OPTIONS,
} from './dcaPlanFormLogic.js';

const BTC = { symbol: 'BTC', name: 'Bitcoin', type: 'crypto' };
const PTT = { symbol: 'PTT', name: 'ปตท.', type: 'stock_th' };

const VALID = {
  picked: BTC,
  amountInput: '1000',
  currency: 'THB',
  frequency: 'weekly',
  frequencyValue: '4',
};

describe('⭐ validateDcaPlanForm — Payload ต้องตรง API.md § 15.5.1', () => {
  test('⭐ กรอกครบ → Payload มีครบทุก Field ตาม Contract', () => {
    const { payload, error } = validateDcaPlanForm(VALID);

    expect(error).toBeUndefined();
    expect(payload).toEqual({
      symbol: 'BTC',
      amountTotal: 1000,
      currency: 'THB',
      frequency: 'weekly',
      frequencyValue: 4,
    });
  });

  // ⚠️ frequencyValue ต้องเป็น "ตัวเลข" ไม่ใช่สตริงจาก <select>
  test('⭐ frequencyValue ต้องเป็น number ไม่ใช่สตริง', () => {
    const { payload } = validateDcaPlanForm(VALID);

    expect(typeof payload.frequencyValue).toBe('number');
    expect(typeof payload.amountTotal).toBe('number');
  });

  test('USD กับ crypto → ส่ง currency: "USD"', () => {
    const { payload } = validateDcaPlanForm({ ...VALID, currency: 'USD' });
    expect(payload.currency).toBe('USD');
  });

  // ค่าแปลกปลอมต้องถูกบีบเป็น THB เสมอ ไม่ส่งต่อดิบๆ ให้ Backend ตอบ 400
  test('currency ที่ไม่รู้จัก → บีบเป็น THB (ไม่ส่งค่าดิบต่อ)', () => {
    expect(validateDcaPlanForm({ ...VALID, currency: 'EUR' }).payload.currency).toBe('THB');
    expect(validateDcaPlanForm({ ...VALID, currency: undefined }).payload.currency).toBe('THB');
  });

  test('จำนวนเงินที่มี comma → พาร์สได้ (ผู้ใช้วางค่ามาจากที่อื่น)', () => {
    expect(validateDcaPlanForm({ ...VALID, amountInput: '1,500.50' }).payload.amountTotal).toBe(
      1500.5
    );
  });

  // ── เคสที่ต้อง Reject ก่อนยิง API ───────────────────────────────────────
  test('ไม่เลือกสินทรัพย์ → error ไม่มี payload', () => {
    const { error, payload } = validateDcaPlanForm({ ...VALID, picked: null });

    expect(error).toContain('เลือกสินทรัพย์');
    expect(payload).toBeUndefined();
  });

  test('จำนวนเงินไม่ถูกต้อง (ว่าง/0/ติดลบ/ไม่ใช่ตัวเลข) → error', () => {
    for (const amountInput of ['', '0', '-5', 'abc']) {
      expect(validateDcaPlanForm({ ...VALID, amountInput }).error).toBeTruthy();
    }
  });

  test('ไม่เลือกความถี่ / ความถี่ที่ไม่รองรับ → error', () => {
    expect(validateDcaPlanForm({ ...VALID, frequency: '' }).error).toBeTruthy();
    expect(validateDcaPlanForm({ ...VALID, frequency: 'daily' }).error).toBeTruthy();
  });

  // ⭐ ช่วงค่าต่างกันตามความถี่ — weekly 0–6 / monthly 1–31 (API.md § 15.5.1)
  test('⭐ weekly: รับ 0–6 เท่านั้น (0 = อาทิตย์ ต้องผ่าน ห้ามตกเพราะ falsy)', () => {
    expect(validateDcaPlanForm({ ...VALID, frequencyValue: '0' }).payload.frequencyValue).toBe(0);
    expect(validateDcaPlanForm({ ...VALID, frequencyValue: '6' }).payload.frequencyValue).toBe(6);
    expect(validateDcaPlanForm({ ...VALID, frequencyValue: '7' }).error).toBeTruthy();
    expect(validateDcaPlanForm({ ...VALID, frequencyValue: '-1' }).error).toBeTruthy();
  });

  test('⭐ monthly: รับ 1–31 เท่านั้น (0 ต้องไม่ผ่าน)', () => {
    const monthly = { ...VALID, frequency: 'monthly' };

    expect(validateDcaPlanForm({ ...monthly, frequencyValue: '1' }).payload.frequencyValue).toBe(1);
    expect(validateDcaPlanForm({ ...monthly, frequencyValue: '31' }).payload.frequencyValue).toBe(31);
    expect(validateDcaPlanForm({ ...monthly, frequencyValue: '0' }).error).toBeTruthy();
    expect(validateDcaPlanForm({ ...monthly, frequencyValue: '32' }).error).toBeTruthy();
  });

  test('ไม่เลือกวัน → error ไม่ส่ง NaN ไป Backend', () => {
    expect(validateDcaPlanForm({ ...VALID, frequencyValue: '' }).error).toBeTruthy();
  });
});

describe('existingPlanForSymbol — เตือน "จะแทนที่แผนเดิม" (UX ไม่ใช่ด่าน)', () => {
  const PLANS = [
    { id: 'p1', symbol: 'BTC', active: true },
    { id: 'p2', symbol: 'PTT', active: false },
  ];

  test('มีแผน Symbol เดิมอยู่ → คืนแผนนั้น', () => {
    expect(existingPlanForSymbol(PLANS, 'BTC')?.id).toBe('p1');
  });

  // ⚠️ แผนที่หยุดอยู่ก็ถูกแทนที่เหมือนกัน (Backend เก็บ 1 แผนต่อ symbol) —
  // ถ้าไม่นับ ผู้ใช้จะไม่ได้รับคำเตือนแล้วงงว่าแผนเดิมหายไปไหน
  test('⭐ แผนที่หยุดอยู่ (active: false) ก็ต้องนับว่ามีอยู่แล้ว', () => {
    expect(existingPlanForSymbol(PLANS, 'PTT')?.id).toBe('p2');
  });

  // Backend เทียบ Registry แบบ case-insensitive → เว็บต้องเตือนตรงกัน
  test('⭐ เทียบแบบไม่สนตัวพิมพ์ (ตรงกับที่ Backend ทำ)', () => {
    expect(existingPlanForSymbol(PLANS, 'btc')?.id).toBe('p1');
  });

  test('ยังไม่มีแผนของ Symbol นี้ / ไม่ระบุ Symbol → null', () => {
    expect(existingPlanForSymbol(PLANS, 'ETH')).toBeNull();
    expect(existingPlanForSymbol(PLANS, null)).toBeNull();
    expect(existingPlanForSymbol(undefined, 'BTC')).toBeNull();
  });
});

describe('describeSchedule — อธิบายรอบของแผน', () => {
  // Backend ส่ง dayLabel มาให้แล้ว → ใช้ตัวนั้นก่อนเสมอ (Single Source of Truth)
  test('มี dayLabel จาก Backend → ใช้ตรงๆ ไม่ประกอบเอง', () => {
    expect(describeSchedule({ dayLabel: 'ทุกวันศุกร์', frequency: 'weekly' })).toBe('ทุกวันศุกร์');
  });

  test('ไม่มี dayLabel → ประกอบจาก frequency + วัน', () => {
    expect(describeSchedule({ frequency: 'monthly', dayOfMonth: 25 })).toContain('25');
    expect(describeSchedule({ frequency: 'weekly', dayOfWeek: 5 })).toContain('ศุกร์');
  });

  // ⚠️ ค่าที่ไม่รู้จักแสดงตามจริง ไม่เดา (Silent Default เป็น Anti-pattern)
  test('ความถี่ที่ไม่รู้จัก → แสดงตามจริง ไม่เดาเป็นรายเดือน', () => {
    expect(describeSchedule({ frequency: 'daily' })).toBe('daily');
    expect(describeSchedule({})).toBe('ไม่ระบุรอบ');
  });

  test('WEEKDAY_OPTIONS ครบ 7 วัน เริ่มที่อาทิตย์ = 0 (ตรงกับ Contract)', () => {
    expect(WEEKDAY_OPTIONS).toHaveLength(7);
    expect(WEEKDAY_OPTIONS[0]).toEqual({ value: 0, label: 'อาทิตย์' });
  });
});
