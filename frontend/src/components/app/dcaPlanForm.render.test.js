// ═══════════════════════════════════════════════════════════════════════════
// DcaPlanForm — Render Test (renderToStaticMarkup — repo นี้ไม่มี RTL/jsdom)
// ═══════════════════════════════════════════════════════════════════════════
// ชุดนี้พิสูจน์ "ตัดสินใจแสดงผลถูกต้อง" · ส่วน Payload/Validation อยู่ที่
// `dcaPlanFormLogic.test.js` ซึ่งเข้มกว่าเพราะ assert ตัว Object ที่จะส่งจริง

import { describe, test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DcaPlanForm from './DcaPlanForm.jsx';
import { dcaPlanErrorMessage, isUpgradeRequiredError } from '../../lib/dcaPlansErrors.js';

const SYMBOLS = [
  { symbol: 'BTC', name: 'Bitcoin', type: 'crypto' },
  { symbol: 'PTT', name: 'ปตท.', type: 'stock_th' },
];

function render(props) {
  return renderToStaticMarkup(
    React.createElement(DcaPlanForm, {
      plans: [],
      symbols: SYMBOLS,
      loadingSymbols: false,
      submitting: false,
      onSubmit: async () => true,
      ...props,
    })
  );
}

describe('DcaPlanForm — ฟอร์มสร้างแผน DCA', () => {
  test('แสดงช่องครบตาม Contract: สินทรัพย์ · จำนวนเงิน · สกุลเงิน · ความถี่', () => {
    const html = render();

    expect(html).toContain('สินทรัพย์');
    expect(html).toContain('จำนวนเงินต่อรอบ');
    expect(html).toContain('สกุลเงิน');
    expect(html).toContain('ความถี่');
    expect(html).toContain('ตั้งแผน DCA');
  });

  // ⚠️ ยังไม่เลือกสินทรัพย์ = ยังไม่รู้ว่ารองรับ USD ไหม → ต้องปิดไว้ก่อน
  // (Fail-safe: ปล่อยเปิดแล้วผู้ใช้เลือก USD กับหุ้นไทยจะโดน 400 ตอนกดบันทึก)
  test('⭐ ยังไม่เลือกสินทรัพย์ → ช่องสกุลเงินถูกปิดไว้ก่อน', () => {
    expect(render()).toContain('<select disabled=""');
  });

  test('ความถี่ยังไม่เลือก → ยังไม่แสดงช่องวัน (weekly/monthly คนละช่วงค่า)', () => {
    const html = render();

    expect(html).not.toContain('วันในสัปดาห์');
    expect(html).not.toContain('วันที่ของเดือน');
  });

  test('กำลังบันทึก → ปุ่มถูก disable และเปลี่ยนข้อความ', () => {
    expect(render({ submitting: true })).toContain('กำลังบันทึก...');
  });

  test('กำลังโหลดรายการสินทรัพย์ → บอกผู้ใช้ ไม่ใช่ช่องว่างเปล่า', () => {
    expect(render({ loadingSymbols: true })).toContain('กำลังโหลดรายการสินทรัพย์...');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ Error Codes ของ § 15.5 — ต้องแปลเป็นข้อความไทยครบทุกตัว ห้ามโชว์ Code ดิบ
// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ dcaPlanErrorMessage — ครอบทุก Error Code ที่ Backend ตอบได้จริง', () => {
  // รายการนี้ = ตาราง Error Codes ใน API.md § 15.5 ครบทุกแถว
  const CODES_IN_SPEC = [
    'VALIDATION_ERROR',
    'SYMBOL_NOT_SUPPORTED',
    'INVALID_FREQUENCY',
    'INVALID_FREQUENCY_VALUE',
    'CURRENCY_NOT_SUPPORTED_FOR_ASSET',
    'PLAN_NOT_FOUND',
  ];

  test('⭐ ทุก Code ในสเปกได้ข้อความไทยเฉพาะตัว ไม่ตกไป Fallback', () => {
    const fallback = dcaPlanErrorMessage('__UNKNOWN__');

    for (const code of CODES_IN_SPEC) {
      const msg = dcaPlanErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg).not.toBe(fallback); // ต้องไม่ใช่ข้อความกลางๆ
      expect(msg).not.toContain(code); // ห้ามโชว์ Error Code ดิบให้ผู้ใช้
    }
  });

  // 🔴 PLAN_LIMIT_REACHED **ไม่อยู่ในตาราง API.md § 15.5** แต่ Backend ตอบจริง
  // (dcaPlans.controller.js:29/42 → 403 · dcaReminder.service.js:153) เกิดเมื่อ
  // ผู้ใช้ Free ตั้งแผนเกินเพดาน — เอกสารตกหล่น ไม่ใช่โค้ดผิด
  //
  // ⚠️ เว็บ **ไม่นับเพดานเอง** (เพดานเป็นของ Backend) แค่ต้องแสดงผลให้ถูกเมื่อ
  // ได้รับมา ไม่งั้นผู้ใช้จะเห็น "เกิดข้อผิดพลาดภายในระบบ" แล้วไม่รู้ว่าต้องอัพเกรด
  test('⭐ PLAN_LIMIT_REACHED (ไม่มีในเอกสารแต่ Backend ตอบจริง) → ชวนอัพเกรด', () => {
    expect(dcaPlanErrorMessage('PLAN_LIMIT_REACHED')).toContain('Premium');
    expect(isUpgradeRequiredError('PLAN_LIMIT_REACHED')).toBe(true);
  });

  test('Error กรอกข้อมูลผิด → ไม่ใช่เคสอัพเกรด (ไม่ควรโชว์ปุ่ม Premium)', () => {
    for (const code of CODES_IN_SPEC) {
      expect(isUpgradeRequiredError(code)).toBe(false);
    }
  });

  test('Code ที่ไม่รู้จัก → Fallback ข้อความกลางๆ ไม่โชว์ Code ดิบ', () => {
    const msg = dcaPlanErrorMessage('SOMETHING_NEW');

    expect(msg).toBeTruthy();
    expect(msg).not.toContain('SOMETHING_NEW');
  });
});
