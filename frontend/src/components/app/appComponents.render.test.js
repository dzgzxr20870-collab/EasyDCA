// ═══════════════════════════════════════════════════════════════════════════
// Render Smoke Test ของ Component ใหม่ใน Stage 9 (งานที่ 3)
// ═══════════════════════════════════════════════════════════════════════════
// ใช้ Pattern เดียวกับ `components/dashboard/dashboardComponents.render.test.js`
// เป๊ะ (renderToStaticMarkup — Repo นี้ยังไม่มี React Testing Library และ Test เดิม
// ทั้งหมดเป็น Pure-function/SSR ล้วน) เพื่อไม่ต้องเพิ่ม Dependency ใหม่
//
// ข้อจำกัดที่ต้องรู้: Effect (fetch อ้างอิง, วาด Chart จริง) **ไม่ทำงาน** ใต้
// renderToStaticMarkup — ชุดนี้พิสูจน์ว่า "Render Body ไม่ Throw กับข้อมูลจริงตาม
// สัญญาของ API" และ "ตัดสินใจแสดงผลถูกต้อง" ไม่ใช่ Test เชิง Interaction
//
// ⭐ สิ่งที่ชุดนี้ตั้งใจจับเป็นพิเศษ: **กราฟต้องไม่โชว์ตัวเลขมั่วเมื่อไม่มีข้อมูล**
// (ข้อบังคับของงานที่ 3 — "ต้องบอกว่าราคาไม่พร้อมใช้งาน ไม่ใช่โชว์ 0")

import { describe, test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import AllocationDonut from './AllocationDonut.jsx';
import CreatePortfolioModal, { createPortfolioErrorText } from './CreatePortfolioModal.jsx';
import RecordTransactionModal from './RecordTransactionModal.jsx';

function withRouter(element) {
  return React.createElement(MemoryRouter, null, element);
}

// Shape ตรงตาม GET /api/v1/portfolio/allocation (docs/API.md)
const GROUPS = [
  { key: 'crypto', label: 'คริปโต', valueThb: 60000, percent: 60, assetCount: 2, priceUnavailableCount: 0 },
  { key: 'stock_th', label: 'หุ้นไทย', valueThb: 40000, percent: 40, assetCount: 3, priceUnavailableCount: 1 },
];

describe('AllocationDonut — โดนัทสัดส่วนพอร์ต', () => {
  test('มีข้อมูล → วาดกราฟ + Legend ที่ใช้ percent จาก Backend ตรงๆ', () => {
    const html = renderToStaticMarkup(
      React.createElement(AllocationDonut, { groups: GROUPS, totalValueThb: 100000 })
    );

    expect(html).toContain('คริปโต');
    expect(html).toContain('60%');
    expect(html).toContain('40%');
    // ⚠️ ต้องบอกเมื่อมีรายการที่ตีมูลค่าที่ราคาทุน ไม่ใช่ปล่อยให้เข้าใจว่าเป็นราคาสด
    expect(html).toContain('ราคาทุน');
  });

  // ⭐⭐ เคสสำคัญที่สุดของไฟล์นี้ — ข้อบังคับของงานที่ 3
  test('⭐ ทุกกลุ่มมูลค่า 0 (ราคาดึงไม่ได้) → บอก "ราคาไม่พร้อมใช้งาน" ห้ามวาดวงว่าง', () => {
    const zeroGroups = GROUPS.map((g) => ({ ...g, valueThb: 0, percent: 0 }));
    const html = renderToStaticMarkup(
      React.createElement(AllocationDonut, { groups: zeroGroups, totalValueThb: 0 })
    );

    expect(html).toContain('ราคาไม่พร้อมใช้งาน');
    // ต้องไม่มี canvas ของกราฟเลย — วงกลมว่างเปล่าดูเหมือนระบบพัง
    expect(html).not.toContain('canvas');
  });

  test('ไม่มีกลุ่มเลย → ข้อความ "ยังไม่มีข้อมูล" (คนละเรื่องกับราคาดึงไม่ได้)', () => {
    const html = renderToStaticMarkup(
      React.createElement(AllocationDonut, { groups: [], totalValueThb: 0 })
    );

    expect(html).toContain('ยังไม่มีข้อมูล');
    expect(html).not.toContain('ราคาไม่พร้อมใช้งาน');
  });

  // ⚠️ groups เป็น undefined = Response ถูกตัดทอน/Endpoint เก่า — ต้องไม่พังทั้งหน้า
  test('groups เป็น undefined → ไม่ Throw', () => {
    expect(() =>
      renderToStaticMarkup(React.createElement(AllocationDonut, { groups: undefined }))
    ).not.toThrow();
  });
});

describe('CreatePortfolioModal — Modal สร้างพอร์ตใหม่', () => {
  test('Render ได้ พร้อมช่องชื่อและตัวเลือกประเภท', () => {
    const html = renderToStaticMarkup(
      withRouter(React.createElement(CreatePortfolioModal, { onClose() {}, onCreated() {} }))
    );

    expect(html).toContain('สร้างพอร์ตใหม่');
    expect(html).toContain('ชื่อพอร์ต');
    expect(html).toContain('ผสม / กำหนดเอง');
  });

  // ⚠️ 'mixed' ไม่มีจริงใน CHECK constraint (migration 044 แก้เป็น 'custom')
  // ถ้าหลุดเข้ามาในตัวเลือก ผู้ใช้จะเลือกแล้วโดน 400 VALIDATION_ERROR ทุกครั้ง
  test('⚠️ ห้ามมีประเภท "mixed" ในตัวเลือก (ไม่มีจริงใน DB)', () => {
    const html = renderToStaticMarkup(
      withRouter(React.createElement(CreatePortfolioModal, { onClose() {}, onCreated() {} }))
    );

    expect(html).not.toContain('value="mixed"');
  });
});

describe('createPortfolioErrorText — ข้อความต่อ Error Code', () => {
  // ⭐ คนที่ชน Sanity Cap คือผู้ใช้ Premium ที่จ่ายเงินอยู่แล้ว การชวน "อัปเกรด"
  // กับเขาคือข้อความที่ผิดและน่ารำคาญ — ทางออกจริงคือลบพอร์ตที่ไม่ได้ใช้
  test('⭐ limit กับ cap ต้องเป็นคนละข้อความ และ cap ต้องไม่ชวนอัปเกรด', () => {
    const limit = createPortfolioErrorText('PORTFOLIO_LIMIT_REACHED');
    const cap = createPortfolioErrorText('PORTFOLIO_CAP_REACHED');

    expect(limit).not.toBe(cap);
    expect(limit).toContain('อัปเกรด');
    expect(cap).not.toContain('อัปเกรด');
    expect(cap).toContain('ลบพอร์ต');
  });

  test('Code ที่ไม่รู้จัก → ใช้ข้อความจาก Backend ถ้ามี ไม่กลืนหาย', () => {
    expect(createPortfolioErrorText('SOMETHING_NEW', 'ข้อความจากเซิร์ฟเวอร์')).toBe(
      'ข้อความจากเซิร์ฟเวอร์'
    );
    expect(createPortfolioErrorText(undefined, undefined)).toContain('ไม่สำเร็จ');
  });
});

describe('RecordTransactionModal — defaultType จากปุ่มหน้าพอร์ต', () => {
  const WRITABLE = { id: 'pf-1', name: 'ระยะยาว', canWrite: true };
  const LOCKED = { id: 'pf-2', name: 'ระยะสั้น', canWrite: false };

  function render(props) {
    return renderToStaticMarkup(
      React.createElement(RecordTransactionModal, {
        selectedPortfolio: WRITABLE,
        onClose() {},
        onSaved() {},
        ...props,
      })
    );
  }

  test('defaultType="sell" → แท็บขายถูกเลือกไว้ตั้งแต่เปิด', () => {
    const html = render({ defaultType: 'sell' });

    // ⚠️ React SSR เรียง Attribute เป็น checked ก่อน value — ยึดตาม Output จริง
    expect(html).toContain('checked="" value="sell"');
  });

  test('ไม่ส่ง defaultType → ค่าเริ่มต้นยังเป็น "buy" เหมือนเดิม (Path เดิมไม่เปลี่ยน)', () => {
    expect(render({})).toContain('checked="" value="buy"');
  });

  // ⚠️ ห้ามให้ค่าที่ไม่รู้จักทำให้ไม่มีแท็บไหนถูกเลือกเลย (ฟอร์มค้างกดอะไรไม่ได้)
  test('defaultType ที่ไม่รู้จัก → Fallback เป็น "buy" ไม่ใช่ไม่เลือกอะไรเลย', () => {
    expect(render({ defaultType: 'transfer' })).toContain('checked="" value="buy"');
  });

  // ⭐ พอร์ตถูกล็อก: ซื้อ/ปันผลปิด แต่ขาย **ต้องเปิดเสมอ** (มติ Founder 24 ส.ค. 2569)
  test('⭐ พอร์ตถูกล็อก → ปุ่มขายต้องไม่ถูก disabled', () => {
    const html = render({ selectedPortfolio: LOCKED, defaultType: 'sell' });

    expect(html).toContain('disabled="" value="buy"');
    expect(html).toContain('disabled="" value="dividend"');
    // ⭐ ขายต้องเปิดเสมอ — ไม่มี disabled ติดมากับ value="sell" เลย
    expect(html).toContain('checked="" value="sell"');
    expect(html).not.toContain('disabled="" value="sell"');
  });
});
