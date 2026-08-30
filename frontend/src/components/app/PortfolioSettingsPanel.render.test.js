// ═══════════════════════════════════════════════════════════════════════════
// PortfolioSettingsPanel — Render Test (renderToStaticMarkup — repo นี้ไม่มี
// RTL/jsdom เหมือนไฟล์ *.render.test.js อื่นทั้งหมด — ดู recordTransactionLogic.test.js)
// ═══════════════════════════════════════════════════════════════════════════
// พิสูจน์ "ตัดสินใจแสดงผลถูกต้อง" ตามกติกาสิทธิ์ของแต่ละฟีเจอร์ย่อย (แก้ชื่อ /
// ย้ายสินทรัพย์ / ลบพอร์ต) ซึ่งแยกกันคนละกฎ — ไม่ใช่ Test เชิง Interaction (คลิก
// จริงแล้วเช็คว่ายิง API อะไร ทำใต้ renderToStaticMarkup ไม่ได้)

import { describe, test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PortfolioSettingsPanel, {
  renameErrorText,
  deleteErrorText,
  deleteSummaryTotals,
} from './PortfolioSettingsPanel.jsx';

const DEFAULT_PORTFOLIO = { id: 'pf-default', name: 'พอร์ตหลัก', isDefault: true, canWrite: true };
const NORMAL_PORTFOLIO = { id: 'pf-2', name: 'ระยะยาว', isDefault: false, canWrite: true };
const LOCKED_PORTFOLIO = { id: 'pf-3', name: 'Dime', isDefault: false, canWrite: false };

const HOLDINGS = [
  { assetId: 'a-1', symbol: 'BTC', brokerId: 'bk-1', heldQuantity: 0.5, totalInvested: 1000 },
  { assetId: 'a-2', symbol: 'EOSE', brokerId: 'bk-2', heldQuantity: 10, totalInvested: 106 },
];
const BROKERS = [
  { id: 'bk-1', name: 'Bitkub' },
  { id: 'bk-2', name: 'Binance' },
];

function renderPanel(props) {
  return renderToStaticMarkup(
    React.createElement(PortfolioSettingsPanel, {
      portfolio: NORMAL_PORTFOLIO,
      holdings: HOLDINGS,
      brokers: BROKERS,
      onClose() {},
      onRenamed() {},
      onMoveAsset() {},
      onDeleted() {},
      ...props,
    })
  );
}

describe('PortfolioSettingsPanel — โครงสร้างพื้นฐาน', () => {
  test('แสดงครบ 3 ส่วน: แก้ไขชื่อ / ย้ายสินทรัพย์ / ลบพอร์ต', () => {
    const html = renderPanel();

    expect(html).toContain('แก้ไขชื่อพอร์ต');
    expect(html).toContain('ย้ายสินทรัพย์ไปพอร์ตอื่น');
    expect(html).toContain('ลบพอร์ตนี้');
  });

  test('Input ชื่อโหลดค่าเริ่มต้นจากชื่อพอร์ตปัจจุบัน', () => {
    expect(renderPanel()).toContain('value="ระยะยาว"');
  });
});

describe('PortfolioSettingsPanel — แก้ไขชื่อ (ต้องเขียนได้เท่านั้น)', () => {
  // ⚠️ updatePortfolio ผ่าน assertCanAddToPortfolio → พอร์ตที่ถูกล็อก
  // (canWrite:false) แก้ชื่อไม่ได้ (PORTFOLIO_READ_ONLY) — ต้อง Disable ฟอร์ม
  test('⭐ พอร์ตที่ canWrite === false → ฟอร์มแก้ชื่อถูก Disable พร้อมคำอธิบาย', () => {
    const html = renderPanel({ portfolio: LOCKED_PORTFOLIO });

    expect(html).toContain('disabled');
    expect(html).toContain('พอร์ตนี้เพิ่มรายการใหม่ไม่ได้'); // LOCKED_PORTFOLIO_NOTICE.title
  });

  test('พอร์ตที่เขียนได้ → ฟอร์มแก้ชื่อใช้งานได้ปกติ ไม่มีคำเตือนเรื่องล็อก', () => {
    const html = renderPanel({ portfolio: NORMAL_PORTFOLIO });

    expect(html).not.toContain('พอร์ตนี้เพิ่มรายการใหม่ไม่ได้');
  });
});

describe('renameErrorText — ข้อความต่อ Error Code จริงจาก updatePortfolio', () => {
  test('แปล Error Code ที่ Backend ตอบได้จริงเป็นภาษาไทยอ่านรู้เรื่อง', () => {
    expect(renameErrorText('VALIDATION_ERROR')).toContain('60 ตัวอักษร');
    expect(renameErrorText('PORTFOLIO_NOT_FOUND')).toContain('ไม่พบพอร์ตนี้');
    expect(renameErrorText('PORTFOLIO_READ_ONLY')).toContain('พอร์ตนี้เพิ่มรายการใหม่ไม่ได้');
  });

  // Code ที่ไม่รู้จัก → ใช้ fallback (ปกติคือ err.message ดิบจาก Backend) ไม่ใช่ throw
  test('Error Code ที่ไม่รู้จัก → คืน fallback หรือข้อความ Default', () => {
    expect(renameErrorText('SOMETHING_NEW', 'ข้อความจากเซิร์ฟเวอร์')).toBe('ข้อความจากเซิร์ฟเวอร์');
    expect(renameErrorText(undefined, undefined)).toContain('ไม่สำเร็จ');
  });
});

describe('PortfolioSettingsPanel — ย้ายสินทรัพย์', () => {
  test('มี Dropdown สินทรัพย์ครบทุกแถวของพอร์ตนี้ พร้อมชื่อโบรกที่ Join มา', () => {
    const html = renderPanel();

    expect(html).toContain('BTC');
    expect(html).toContain('EOSE');
    expect(html).toContain('Bitkub');
    expect(html).toContain('Binance');
  });

  // ⚠️ ย้าย "ออก" ไม่เช็คสิทธิ์เขียนของพอร์ตต้นทาง (MoveAssetPortfolioDialog กรอง
  // ปลายทางเอง) → ต้องยังใช้ได้แม้พอร์ตนี้ถูกล็อก (LOCKED_PORTFOLIO_NOTICE.stillAllowed
  // มี "ย้ายสินทรัพย์ออกไปพอร์ตหลัก" อยู่แล้ว)
  test('⭐ พอร์ตที่ถูกล็อก → ยังย้ายสินทรัพย์ออกได้ (Dropdown ไม่ถูก Disable)', () => {
    const html = renderPanel({ portfolio: LOCKED_PORTFOLIO });

    expect(html).toContain('<select');
    expect(html).not.toMatch(/<select[^>]*disabled/);
  });

  test('พอร์ตว่าง → บอกว่าไม่มีสินทรัพย์ให้ย้าย ไม่มี Dropdown', () => {
    const html = renderPanel({ holdings: [] });

    expect(html).toContain('ยังไม่มีสินทรัพย์ในพอร์ตนี้ให้ย้าย');
    expect(html).not.toContain('<select');
  });
});

describe('PortfolioSettingsPanel — ลบพอร์ต (ต้องยึด Business Rule เดิมเป๊ะ)', () => {
  // ⚠️ Invariant migration 044/045: พอร์ตหลักต้องมีหนึ่งอันเป๊ะเสมอ — ลบไม่ได้
  test('⭐ พอร์ตหลัก (isDefault) → ปุ่มลบถูกซ่อน แสดงคำอธิบายแทน', () => {
    const html = renderPanel({ portfolio: DEFAULT_PORTFOLIO });

    expect(html).toContain('พอร์ตหลักลบไม่ได้');
    expect(html).not.toContain('ยืนยันลบพอร์ต');
  });

  // ⚠️ deletePortfolio ไม่ผ่าน assertCanAddToPortfolio โดยเจตนา — ต้องลบได้แม้ถูกล็อก
  // (เป็นทางออกจากพอร์ตที่ถูกล็อก ไม่ใช่ทางตัน — มติ Founder 24 ส.ค. 2569)
  test('⭐ พอร์ตที่ถูกล็อกแต่ไม่ใช่พอร์ตหลัก → ยังลบได้ปกติ', () => {
    const html = renderPanel({ portfolio: LOCKED_PORTFOLIO });

    expect(html).toContain('ลบพอร์ตนี้');
    expect(html).not.toContain('พอร์ตหลักลบไม่ได้');
  });

  test('พอร์ตปกติ (ไม่ใช่พอร์ตหลัก) → มีปุ่มลบให้กด', () => {
    const html = renderPanel({ portfolio: NORMAL_PORTFOLIO });

    expect(html).toContain('ลบพอร์ตนี้');
  });
});

describe('deleteErrorText — ข้อความต่อ Error Code จริงจาก deletePortfolio', () => {
  test('แปล Error Code ที่ Backend ตอบได้จริงเป็นภาษาไทยอ่านรู้เรื่อง พร้อมทางออก', () => {
    expect(deleteErrorText('CANNOT_DELETE_DEFAULT_PORTFOLIO')).toContain('พอร์ตหลักลบไม่ได้');

    const conflict = deleteErrorText('PORTFOLIO_HAS_CONFLICTING_ASSETS');
    expect(conflict).toContain('ซ้ำกับพอร์ตหลัก');
    expect(conflict).toContain('ย้ายสินทรัพย์'); // ต้องบอกทางออก ไม่ใช่แค่บอกว่าทำไม่ได้

    expect(deleteErrorText('PORTFOLIO_NOT_FOUND')).toContain('ไม่พบพอร์ตนี้');
  });

  test('Error Code ที่ไม่รู้จัก → คืน fallback หรือข้อความ Default', () => {
    expect(deleteErrorText('SOMETHING_NEW', 'ข้อความจากเซิร์ฟเวอร์')).toBe('ข้อความจากเซิร์ฟเวอร์');
    expect(deleteErrorText(undefined, undefined)).toContain('ไม่สำเร็จ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ deleteSummaryTotals — สรุปมูลค่ารวม (ต้นทุน) ก่อนยืนยันลบพอร์ต
// (Founder ทดสอบ UI Confirm 30 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ Dialog ยืนยันลบเปิดผ่าน useState ภายใน (confirmingDelete) ไม่ใช่ Prop/URL
// เหมือน AppDca.jsx จึง SSR-render ให้ตรงสถานะนั้นตรงๆ ไม่ได้ (ต้อง Click จริง) —
// ทดสอบ Logic คำนวณผ่าน Pure Function นี้แทน (Pattern เดียวกับ renameErrorText/
// deleteErrorText ข้างบน)
describe('⭐ deleteSummaryTotals — ต้องรวมถูกสกุล ไม่ถัวข้าม THB/USD', () => {
  test('⭐ รวมต้นทุนของทุกสินทรัพย์ในพอร์ต (สกุลเดียวกัน)', () => {
    expect(deleteSummaryTotals(HOLDINGS)).toEqual([{ currency: 'THB', total: 1106 }]);
  });

  // ⭐⭐ เคสสำคัญที่สุด — ผู้ใช้ Multi-Currency (Round 10) ถือทั้ง THB และ USD ใน
  // พอร์ตเดียวกันได้ ถ้ารวมข้ามสกุลตัวเลขที่โชว์จะไม่มีความหมายอะไรเลย
  test('⭐⭐ พอร์ตมีทั้ง THB และ USD → แยกยอดกันคนละสกุล ไม่ถัวรวม', () => {
    const mixed = [
      { symbol: 'BTC', totalInvested: 1000, currency: 'THB' },
      { symbol: 'AAPL', totalInvested: 500, currency: 'USD' },
      { symbol: 'PTT', totalInvested: 200, currency: 'THB' },
    ];

    const totals = deleteSummaryTotals(mixed);
    expect(totals).toContainEqual({ currency: 'THB', total: 1200 });
    expect(totals).toContainEqual({ currency: 'USD', total: 500 });
  });

  test('ไม่ระบุ currency (Field เดิมก่อน Round 10) → ถือเป็น THB', () => {
    expect(deleteSummaryTotals([{ symbol: 'PTT', totalInvested: 500 }])).toEqual([
      { currency: 'THB', total: 500 },
    ]);
  });

  test('พอร์ตว่าง/ไม่ส่ง holdings มา → คืน Array ว่าง ไม่ Throw', () => {
    expect(deleteSummaryTotals([])).toEqual([]);
    expect(deleteSummaryTotals(undefined)).toEqual([]);
  });
});
