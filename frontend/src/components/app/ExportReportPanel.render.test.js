// ═══════════════════════════════════════════════════════════════════════════
// ExportReportPanel — Render Test (renderToStaticMarkup — repo นี้ไม่มี
// RTL/jsdom เหมือนไฟล์ *.render.test.js อื่นทั้งหมด — ดู PortfolioSettingsPanel.render.test.js)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ Effect/Interaction (กด Export จริง, apiDownload) ไม่ทำงานใต้ renderToStaticMarkup
// ชุดนี้พิสูจน์แค่ "ตัดสินใจแสดงผลถูกต้องตามสถานะ Premium/Free"

import { describe, test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import ExportReportPanel from './ExportReportPanel.jsx';

function renderPanel(props) {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(ExportReportPanel, { ...props }))
  );
}

describe('ExportReportPanel — Free ไม่เห็นฟอร์ม Export', () => {
  test('Free → เห็นปุ่มอัปเกรด ไม่มีฟอร์มเลือก Format/Range', () => {
    const html = renderPanel({ isPremiumActive: false });

    expect(html).toContain('อัปเกรดเป็น Premium');
    expect(html).toContain('href="/premium"');
    expect(html).not.toContain('รูปแบบไฟล์');
    expect(html).not.toContain('📑 Export');
  });
});

describe('ExportReportPanel — Premium เห็นฟอร์ม Export ครบ', () => {
  test('Premium → เห็นตัวเลือก Format/Range + ปุ่ม Export', () => {
    const html = renderPanel({ isPremiumActive: true });

    expect(html).toContain('รูปแบบไฟล์');
    expect(html).toContain('ช่วงเวลา');
    expect(html).toContain('📑 Export');
    expect(html).not.toContain('อัปเกรดเป็น Premium');
  });
});
