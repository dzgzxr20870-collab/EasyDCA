// ═══════════════════════════════════════════════════════════════════════════
// BrokerSettingsPanel — Render Test (renderToStaticMarkup — repo นี้ไม่มี
// RTL/jsdom เหมือนไฟล์ *.render.test.js อื่นทั้งหมด — ดู PortfolioSettingsPanel.render.test.js)
// ═══════════════════════════════════════════════════════════════════════════

import { describe, test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import BrokerSettingsPanel, {
  brokerRenameErrorText,
  brokerDeleteErrorText,
  assetsForBroker,
} from './BrokerSettingsPanel.jsx';

const BROKERS = [
  { id: 'bk-1', name: 'Bitkub' },
  { id: 'bk-2', name: 'Binance' },
];

const HOLDINGS = [
  { assetId: 'a-1', symbol: 'BTC', brokerId: 'bk-1', portfolioId: 'pf-1', heldQuantity: 0.5 },
  { assetId: 'a-2', symbol: 'ETH', brokerId: 'bk-1', portfolioId: 'pf-2', heldQuantity: 2 },
  { assetId: 'a-3', symbol: 'PTT', brokerId: null, portfolioId: 'pf-1', heldQuantity: 100 },
];

function renderPanel(props) {
  return renderToStaticMarkup(
    React.createElement(BrokerSettingsPanel, {
      brokers: BROKERS,
      holdings: HOLDINGS,
      onClose() {},
      onRenamed() {},
      onDeleted() {},
      ...props,
    })
  );
}

describe('BrokerSettingsPanel — โครงสร้างพื้นฐาน', () => {
  test('แสดงรายชื่อโบรกทั้งหมดของผู้ใช้', () => {
    const html = renderPanel();
    expect(html).toContain('Bitkub');
    expect(html).toContain('Binance');
  });

  test('ไม่มีโบรกเลย → ข้อความ Empty State บอกวิธีเพิ่ม ไม่ใช่ตารางว่าง', () => {
    const html = renderPanel({ brokers: [] });
    expect(html).toContain('ยังไม่มีโบรก');
    expect(html).not.toContain('<ul');
  });

  // ⚠️ ไม่มี "สร้างโบรกใหม่" ในนี้โดยเจตนา — สร้างได้อยู่แล้วตอนบันทึกธุรกรรม
  // (ไม่ใช่ขอบเขตของงานนี้)
  test('ไม่มีฟอร์ม "สร้างโบรกใหม่" — สร้างได้จากที่บันทึกธุรกรรมเท่านั้น', () => {
    const html = renderPanel();
    expect(html).not.toContain('สร้างโบรกใหม่');
  });

  test('แต่ละแถวมีปุ่มแก้ไขชื่อ + ลบ', () => {
    const html = renderPanel();
    expect(html).toContain('แก้ไขชื่อ');
    expect((html.match(/>ลบ</g) ?? []).length).toBe(BROKERS.length);
  });
});

describe('brokerRenameErrorText — ข้อความต่อ Error Code จริงจาก updateBroker', () => {
  test('แปล Error Code ที่ Backend ตอบได้จริงเป็นภาษาไทยอ่านรู้เรื่อง', () => {
    expect(brokerRenameErrorText('VALIDATION_ERROR')).toContain('60 ตัวอักษร');
    expect(brokerRenameErrorText('BROKER_NAME_EXISTS')).toContain('มีโบรกชื่อนี้อยู่แล้ว');
    expect(brokerRenameErrorText('BROKER_NOT_FOUND')).toContain('ไม่พบโบรกนี้');
  });

  test('Error Code ที่ไม่รู้จัก → คืน fallback หรือข้อความ Default', () => {
    expect(brokerRenameErrorText('SOMETHING_NEW', 'ข้อความจากเซิร์ฟเวอร์')).toBe(
      'ข้อความจากเซิร์ฟเวอร์'
    );
    expect(brokerRenameErrorText(undefined, undefined)).toContain('ไม่สำเร็จ');
  });
});

describe('brokerDeleteErrorText — ข้อความต่อ Error Code จริงจาก deleteBroker', () => {
  test('แปล Error Code ที่ Backend ตอบได้จริงเป็นภาษาไทยอ่านรู้เรื่อง', () => {
    expect(brokerDeleteErrorText('BROKER_NOT_FOUND')).toContain('ไม่พบโบรกนี้');
  });

  test('Error Code ที่ไม่รู้จัก → คืน fallback หรือข้อความ Default', () => {
    expect(brokerDeleteErrorText('SOMETHING_NEW', 'ข้อความจากเซิร์ฟเวอร์')).toBe(
      'ข้อความจากเซิร์ฟเวอร์'
    );
    expect(brokerDeleteErrorText(undefined, undefined)).toContain('ไม่สำเร็จ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ assetsForBroker — ตัวเลขจริงก่อนยืนยันลบ (ไม่ยิง API เพิ่ม — Pattern เดียวกับ
// deleteSummaryTotals ของ PortfolioSettingsPanel)
// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ assetsForBroker — กรองสินทรัพย์ที่ผูกกับโบรกนี้จาก holdings ที่โหลดมาแล้ว', () => {
  test('⭐ กรองเฉพาะแถวที่ brokerId ตรงกัน (ข้ามพอร์ต — holdings เป็นของทุกพอร์ตรวมกัน)', () => {
    const result = assetsForBroker(HOLDINGS, 'bk-1');
    expect(result).toHaveLength(2);
    expect(result.map((h) => h.symbol)).toEqual(['BTC', 'ETH']);
  });

  test('โบรกที่ไม่มีสินทรัพย์ผูกอยู่ → คืน Array ว่าง', () => {
    expect(assetsForBroker(HOLDINGS, 'bk-2')).toEqual([]);
  });

  test('ไม่ส่ง holdings มา → คืน Array ว่าง ไม่ Throw', () => {
    expect(assetsForBroker(undefined, 'bk-1')).toEqual([]);
  });
});

describe('BrokerSettingsPanel — Empty/Confirm State ของแต่ละโบรก (Static Render)', () => {
  // ⚠️ Confirm Dialog เปิดผ่าน useState ภายใน เหมือน PortfolioSettingsPanel —
  // renderToStaticMarkup เห็นแค่สถานะเริ่มต้น (ยังไม่กด "ลบ") ทดสอบ Logic คำนวณ
  // ผ่าน assetsForBroker (Pure Function) แทน — ดู Comment เดียวกันใน
  // PortfolioSettingsPanel.render.test.js
  test('สถานะเริ่มต้น (ยังไม่กดลบ) → ไม่มี Dialog ยืนยันแสดงอยู่', () => {
    const html = renderPanel();
    expect(html).not.toContain('ยืนยันลบโบรก');
  });
});
