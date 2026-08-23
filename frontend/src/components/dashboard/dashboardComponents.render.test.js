// Render Smoke Test (S8 R1b) — เรนเดอร์ทุก Component ใหม่ของ Dashboard ด้วยข้อมูล
// จริงตามรูปแบบ docs/API.md §15.4 ผ่าน react-dom/server เพื่อจับ Bug ระดับ Render
// (เข้าถึง Field ที่ไม่มีจริง, ชื่อ Field ผิด, .map บน Shape ที่ไม่ตรง) โดยไม่ต้องมี
// jsdom/เบราว์เซอร์จริง — Repo นี้ยังไม่มี React Testing Library ติดตั้งไว้ (Test เดิม
// ทั้งหมดเป็น Pure-function Unit Test ล้วน) จึงใช้ renderToStaticMarkup แทน (ไม่ต้อง
// เพิ่ม Dependency ใหม่) ครอบคลุมทั้งกรณี "พอร์ตมีของ" และ "พอร์ตว่างเปล่า"
//
// ข้อจำกัด: Effect (Click-outside, วาด Chart, Fetch) ไม่ทำงานภายใต้
// renderToStaticMarkup — Test ชุดนี้พิสูจน์แค่ว่า "Render Body เอง" ไม่ Throw เมื่อ
// ได้รับข้อมูลจริงตามสัญญา ไม่ใช่ Test เชิง Interaction (Keyboard Nav/Click ฯลฯ)
import { describe, test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// DcaForm ใช้ useNavigate (Default onUpgrade) → ต้อง Render ใต้ Router Context
import { MemoryRouter } from 'react-router-dom';

// ห่อ Element ด้วย MemoryRouter (ให้ useNavigate ใน DcaForm ทำงานได้ใน Render Test)
function withRouter(element) {
  return React.createElement(MemoryRouter, null, element);
}

import StatCards from './StatCards.jsx';
import AllocationCard from './AllocationCard.jsx';
import RecentList from './RecentList.jsx';
import InvestedChart from './InvestedChart.jsx';
import SidePanels from './SidePanels.jsx';
import UndoConfirmModal from './UndoConfirmModal.jsx';
import AssetPicker from './AssetPicker.jsx';
import AssetAvatar from './AssetAvatar.jsx';
import DcaForm from './DcaForm.jsx';
import DcaPlansSection from './DcaPlansSection.jsx';
import PortfolioDetailSection from './PortfolioDetailSection.jsx';

const SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple แอปเปิล', type: 'stock_us' },
  { symbol: 'PTT', name: 'ปตท.', type: 'stock_th' },
  { symbol: 'BTC', name: 'Bitcoin บิตคอยน์', type: 'crypto' },
  { symbol: 'GOLD', name: 'ทองคำแท่ง (ราคาสมาคมฯ)', type: 'gold_bar' },
];

const overviewFull = {
  portfolio: {
    totalCurrentValue: 87500.25,
    unrealizedPnL: 4200.5,
    unrealizedPnLPercent: 5.05,
    realizedPnLByCurrency: { THB: 1500, USD: 0 },
    realizedPnLThbEquivalent: 1500,
    investedByCurrency: { THB: 83299.75, USD: 100 },
    excludedCount: 1,
    isEmpty: false,
  },
  lifetime: { count: 42, amountByCurrency: { THB: 85000, USD: 300 } },
  thisMonth: { month: '2026-07', count: 3, amountByCurrency: { THB: 3000, USD: 50 } },
  streakMonths: 6,
  allocation: [
    {
      type: 'stock_us',
      valueByCurrency: { THB: 45850, USD: 0 },
      valueThbEquivalent: 45850,
      assets: [
        { symbol: 'AAPL', name: 'AAPL', currency: 'THB', units: 10, value: 25000, priceUnavailable: false },
      ],
    },
    {
      type: 'stock_th',
      valueByCurrency: { THB: 25000, USD: 0 },
      valueThbEquivalent: 25000,
      assets: [
        { symbol: 'PTT', name: 'PTT', currency: 'THB', units: 50, value: 1700, priceUnavailable: true },
      ],
    },
  ],
  recent: [
    {
      id: '9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f',
      symbol: 'NVDA',
      side: 'buy',
      amountTotal: 1000,
      currency: 'THB',
      date: '2026-07-14',
      createdAt: '2026-07-14T14:04:00.000Z',
      note: 'DCA รายเดือน',
      source: 'web',
    },
  ],
  monthlyInvested: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    count: 1,
    amountByCurrency: { THB: 1000, USD: 0 },
    cumulativeByCurrency: { THB: 1000 * (i + 1), USD: 0 },
  })),
  fxRate: 35.12,
  fxAsOf: '2026-07-17',
  fxStale: false,
  fxUnavailableForUsd: false,
  // S8 R3 รอบ 3 — แผนที่ถึงรอบวันนี้ (SidePanels.CalendarPlaceholder อ่าน Field นี้ตรงๆ)
  todayDuePlans: [
    {
      id: 'plan-due-1',
      symbol: 'BTC',
      name: 'Bitcoin บิตคอยน์',
      amountTotal: 1000,
      currency: 'THB',
      frequency: 'weekly',
      dayOfWeek: 4,
      dayOfMonth: null,
      dayLabel: 'ทุกวันพฤหัสบดี',
      active: true,
    },
  ],
};

const overviewEmpty = {
  portfolio: { isEmpty: true },
  lifetime: { count: 0, amountByCurrency: { THB: 0, USD: 0 } },
  thisMonth: { month: '2026-07', count: 0, amountByCurrency: { THB: 0, USD: 0 } },
  streakMonths: 0,
  allocation: [],
  recent: [],
  monthlyInvested: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    count: 0,
    amountByCurrency: { THB: 0, USD: 0 },
    cumulativeByCurrency: { THB: 0, USD: 0 },
  })),
  fxRate: null,
  fxAsOf: null,
  fxStale: false,
  fxUnavailableForUsd: false,
  todayDuePlans: [],
};

const assetTypeBySymbol = new Map([
  ['AAPL', 'stock_us'],
  ['PTT', 'stock_th'],
]);

// S8 R3 รอบ 3 — Plans fixture (GET /api/v1/dca-plans shape) ใช้ทั้ง SidePanels
// (hasActivePlans) และ DcaPlansSection (List Active+Paused ปนกัน)
const PLANS_MIXED = [
  {
    id: 'plan-1',
    symbol: 'BTC',
    name: 'Bitcoin บิตคอยน์',
    amountTotal: 1000,
    currency: 'THB',
    frequency: 'weekly',
    dayOfWeek: 4,
    dayOfMonth: null,
    dayLabel: 'ทุกวันพฤหัสบดี',
    active: true,
  },
  {
    id: 'plan-2',
    symbol: 'PTT',
    name: 'ปตท.',
    amountTotal: 2000,
    currency: 'THB',
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 16,
    dayLabel: 'ทุกวันที่ 16 ของเดือน',
    active: false,
  },
];

describe('Render smoke test (renderToStaticMarkup — no crash given realistic API shapes)', () => {
  test('StatCards — พอร์ตมีของ / พอร์ตว่าง', () => {
    expect(() => renderToStaticMarkup(React.createElement(StatCards, { overview: overviewFull }))).not.toThrow();
    expect(() => renderToStaticMarkup(React.createElement(StatCards, { overview: overviewEmpty }))).not.toThrow();
  });

  test('AllocationCard — มี Allocation / ว่างเปล่า', () => {
    expect(() =>
      renderToStaticMarkup(React.createElement(AllocationCard, { allocation: overviewFull.allocation }))
    ).not.toThrow();
    expect(() => renderToStaticMarkup(React.createElement(AllocationCard, { allocation: [] }))).not.toThrow();
  });

  test('RecentList — มีรายการ / ไม่มีรายการ', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(RecentList, {
          recent: overviewFull.recent,
          assetTypeBySymbol,
          onRequestUndo: () => {},
        })
      )
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(React.createElement(RecentList, { recent: [], assetTypeBySymbol, onRequestUndo: () => {} }))
    ).not.toThrow();
  });

  test('RecentList — Symbol ที่ไม่อยู่ใน assetTypeBySymbol (สินทรัพย์ขายหมดแล้ว) ไม่ Crash', () => {
    const orphanRecent = [{ ...overviewFull.recent[0], symbol: 'SOLDOUT' }];
    expect(() =>
      renderToStaticMarkup(
        React.createElement(RecentList, { recent: orphanRecent, assetTypeBySymbol, onRequestUndo: () => {} })
      )
    ).not.toThrow();
  });

  // S8 R3 — Reversal Transaction (note = 'UNDO_OF:<id>') ต้องไม่ Crash และไม่โชว์
  // UUID ดิบ (dcaPlansErrors ปกป้อง Error Code ดิบ ตัวนี้ปกป้อง Note ดิบแบบเดียวกัน)
  test('RecentList — รายการ Reversal (note = UNDO_OF:<id>) ไม่ Crash', () => {
    const reversalRecent = [{ ...overviewFull.recent[0], note: 'UNDO_OF:9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f' }];
    expect(() =>
      renderToStaticMarkup(
        React.createElement(RecentList, { recent: reversalRecent, assetTypeBySymbol, onRequestUndo: () => {} })
      )
    ).not.toThrow();
  });

  // ── ข้อ 2/4 (fix/misleading-messages): ปุ่มบนแถวต้องใช้คำเดียวกับ Modal ที่มันเปิด ──
  // ปุ่มนี้เปิด UndoConfirmModal ที่แก้ให้ใช้คำว่า "ย้อน" แล้ว (รายการนี้บันทึกลง
  // Ledger ไปแล้วจริง ไม่ใช่ Pending) — ถ้าปุ่มยังเขียน "ยกเลิก" หน้าจอจะขัดกันเอง
  test('RecentList — ปุ่ม Undo แถวแรกใช้คำว่า "ย้อน" สอดคล้องกับ UndoConfirmModal', () => {
    const html = renderToStaticMarkup(
      React.createElement(RecentList, { recent: overviewFull.recent, assetTypeBySymbol, onRequestUndo: () => {} })
    );
    expect(html).toContain('↩︎ ย้อน');
    expect(html).not.toContain('↩︎ ยกเลิก');
  });

  // Label ของรายการ Reversal ในประวัติถาวรก็ต้องใช้คำเดียวกัน — จุดที่ผู้ใช้เห็น
  // ซ้ำๆ ทุกครั้งที่เปิดดูรายการ ไม่ใช่แค่ตอนกดปุ่ม
  test('RecentList — Note ของรายการ Reversal แสดง "ย้อนรายการ" ไม่ใช่ "ยกเลิกรายการ"', () => {
    const reversalRecent = [{ ...overviewFull.recent[0], note: 'UNDO_OF:9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f' }];
    const html = renderToStaticMarkup(
      React.createElement(RecentList, { recent: reversalRecent, assetTypeBySymbol, onRequestUndo: () => {} })
    );
    expect(html).toContain('ย้อนรายการ');
    expect(html).not.toContain('ยกเลิกรายการ');
  });

  test('InvestedChart — มีข้อมูล / ทุกเดือน count=0', () => {
    expect(() =>
      renderToStaticMarkup(React.createElement(InvestedChart, { monthlyInvested: overviewFull.monthlyInvested }))
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(React.createElement(InvestedChart, { monthlyInvested: overviewEmpty.monthlyInvested }))
    ).not.toThrow();
  });

  test('SidePanels — พอร์ตมีของ (มีแผนถึงรอบวันนี้) / พอร์ตว่าง (ไม่มีแผนเลย)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(SidePanels, {
          overview: overviewFull,
          symbols: SYMBOLS,
          plans: PLANS_MIXED,
          onQuickRecord: () => {},
        })
      )
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        React.createElement(SidePanels, {
          overview: overviewEmpty,
          symbols: SYMBOLS,
          plans: [],
          onQuickRecord: () => {},
        })
      )
    ).not.toThrow();
  });

  test('SidePanels — มีแผน Active อยู่ แต่ไม่มีแผนถึงรอบวันนี้ (Empty State ข้อความต่างจากไม่มีแผนเลย)', () => {
    const overviewNoneDueToday = { ...overviewFull, todayDuePlans: [] };
    expect(() =>
      renderToStaticMarkup(
        React.createElement(SidePanels, {
          overview: overviewNoneDueToday,
          symbols: SYMBOLS,
          plans: PLANS_MIXED, // มี plan-1 active:true แต่ไม่อยู่ใน todayDuePlans รอบนี้
          onQuickRecord: () => {},
        })
      )
    ).not.toThrow();
  });

  test('UndoConfirmModal — target null (ไม่ Render) / มี target', () => {
    expect(() =>
      renderToStaticMarkup(React.createElement(UndoConfirmModal, { target: null, onConfirm: () => {}, onClose: () => {} }))
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        React.createElement(UndoConfirmModal, {
          target: { type: 'buy', symbol: 'AAPL', amountTotal: 1000, currency: 'THB' },
          onConfirm: () => {},
          onClose: () => {},
        })
      )
    ).not.toThrow();
  });

  // ── ข้อ 4 (fix/misleading-messages): ปุ่ม "ไม่ยกเลิก" ปฏิเสธซ้อนปฏิเสธ ──────
  // หัวข้อ "ยืนยันยกเลิกรายการ" คู่กับปุ่ม "ไม่ยกเลิก" ตีความได้ 2 ทาง (ไม่ย้อน
  // รายการ? หรือไม่ปิดหน้าต่าง?) และเป็นปุ่มฝั่งปลอดภัยที่กดผิดแล้วข้อมูลเปลี่ยน —
  // เปลี่ยนเป็น "ปิด" (ไม่กำกวม) พร้อมปรับหัวข้อ/ปุ่มยืนยันให้ใช้คำว่า "ย้อน"
  // สอดคล้องกับข้อ 2 (ห้ามใช้คำเดียวกับ "ยกเลิก" ของ Pending ที่ยังไม่บันทึก)
  test('UndoConfirmModal — ปุ่มฝั่งปลอดภัยไม่กำกวมอีกต่อไป (ไม่มี "ไม่ยกเลิก")', () => {
    const html = renderToStaticMarkup(
      React.createElement(UndoConfirmModal, {
        target: { type: 'buy', symbol: 'AAPL', amountTotal: 1000, currency: 'THB' },
        onConfirm: () => {},
        onClose: () => {},
      })
    );

    expect(html).not.toContain('ไม่ยกเลิก');
    expect(html).toContain('ปิด');
    expect(html).toContain('ยืนยันย้อนรายการนี้');
    expect(html).toContain('ยืนยันย้อนรายการล่าสุด');
    expect(html).not.toContain('ยืนยันยกเลิกรายการ');
  });

  test('AssetPicker — ไม่มีค่าเลือก / มีค่าเลือกแล้ว', () => {
    expect(() =>
      renderToStaticMarkup(React.createElement(AssetPicker, { symbols: SYMBOLS, value: null, onChange: () => {} }))
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(React.createElement(AssetPicker, { symbols: SYMBOLS, value: SYMBOLS[0], onChange: () => {} }))
    ).not.toThrow();
  });

  test('DcaForm — Render เริ่มต้นไม่ Crash (symbols จริง 224 ตัวจำลอง)', () => {
    expect(() =>
      renderToStaticMarkup(
        withRouter(
          React.createElement(DcaForm, {
            symbols: SYMBOLS,
            pickerOpenSignal: 0,
            onRecorded: () => {},
            onRequestUndo: () => {},
          })
        )
      )
    ).not.toThrow();
  });

  // P0-1 (Code Review) — Regression: DcaForm ต้องแสดง "ช่องเลือกไฟล์" เมื่อ isPremiumActive
  // = true (ไม่ใช่กล่อง Locked) — จับบั๊กที่ Premium User แนบสลิปไม่ได้เพราะ Component
  // Render ผิดสถานะ (เดิมบั๊กจริงคือ Parent ไม่ส่ง prop → Default false → Locked ตลอด)
  test('DcaForm — Premium เห็นช่องเลือกรูปสลิป (ไม่ใช่กล่อง Locked)', () => {
    const html = renderToStaticMarkup(
      withRouter(
        React.createElement(DcaForm, {
          symbols: SYMBOLS,
          pickerOpenSignal: 0,
          onRecorded: () => {},
          onRequestUndo: () => {},
          isPremiumActive: true,
        })
      )
    );
    expect(html).toContain('เลือกรูปสลิป'); // ปุ่มเลือกไฟล์ของ Premium
    expect(html).not.toContain('สำหรับสมาชิก Premium'); // ต้องไม่ใช่กล่อง Locked
  });

  test('DcaForm — Free เห็นกล่อง Locked + ปุ่มอัพเกรด (แม้ Parent ไม่ส่ง onUpgrade)', () => {
    // จงใจไม่ส่ง onUpgrade — ปุ่มต้องยังอยู่ (Default พาไป /premium) ไม่หายไป/ไม่ตาย
    const html = renderToStaticMarkup(
      withRouter(
        React.createElement(DcaForm, {
          symbols: SYMBOLS,
          pickerOpenSignal: 0,
          onRecorded: () => {},
          onRequestUndo: () => {},
          isPremiumActive: false,
        })
      )
    );
    expect(html).toContain('สำหรับสมาชิก Premium'); // กล่อง Locked
    expect(html).toContain('อัพเกรด'); // ปุ่มอัพเกรดยังแสดงเสมอ (P0-1 default)
  });

  // S8 R3 รอบ 3 — prefillSignal prop ใหม่ (Render ไม่ Throw เท่านั้น: useEffect ที่
  // ใช้ prefillSignal ไม่ทำงานภายใต้ renderToStaticMarkup — ดู
  // frontend/src/lib/dcaPlanPrefill.test.js สำหรับ Test เชิง Logic จริงของ Prefill)
  test('DcaForm — รับ prefillSignal ไม่ Crash', () => {
    expect(() =>
      renderToStaticMarkup(
        withRouter(
          React.createElement(DcaForm, {
            symbols: SYMBOLS,
            pickerOpenSignal: 0,
            onRecorded: () => {},
            onRequestUndo: () => {},
            prefillSignal: { symbol: 'BTC', amountTotal: 1000, currency: 'THB', nonce: 1 },
          })
        )
      )
    ).not.toThrow();
  });

  // PortfolioDetailSection (S8 R3 รอบ 2) — Shape ตรงกับ GET /dashboard/portfolio,
  // /dashboard/profit/:symbol, /dashboard/history?limit=1000 (Endpoint เดิมของ
  // Dashboard.jsx ที่ย้าย Logic มา — คนละ Shape กับ overview ของ §15.4)
  const LEGACY_PORTFOLIO = {
    holdings: [
      { symbol: 'AAPL', currency: 'THB', heldQuantity: 10, averageCost: 2500, totalInvested: 25000 },
      { symbol: 'PTT', currency: 'THB', heldQuantity: 50, averageCost: 34, totalInvested: 1700 },
    ],
    investedByCurrency: { THB: 26700, USD: 0 },
    totalInvested: 26700,
    isEmpty: false,
  };
  const LEGACY_PROFIT = {
    AAPL: { currentValue: 27000, profitLoss: 2000, profitLossPercent: 8 },
    PTT: null, // หุ้นไทยไม่มีราคาตลาด — ทดสอบ excludedCount + Fallback '-'
  };
  const LEGACY_TRANSACTIONS = [
    // S8 R3 — note ปกติที่ผู้ใช้พิมพ์เอง ต้องแสดงตรงๆ ในคอลัมน์ "รายละเอียด"
    { id: 't1', symbol: 'AAPL', type: 'buy', amountThb: 2500, pricePerUnit: 2500, quantity: 1, currency: 'THB', date: '2026-07-14', note: 'DCA รายเดือน' },
    // note = 'UNDO_OF:<id>' (Reversal Transaction) ต้องแปลงเป็นข้อความอ่านง่าย ไม่โชว์ UUID ดิบ
    { id: 't2', symbol: 'PTT', type: 'sell', amountThb: 340, pricePerUnit: 34, quantity: 10, currency: 'THB', date: '2026-06-01', note: 'UNDO_OF:9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f' },
    // ไม่มี note เลย (รายการเก่า) → คอลัมน์ต้องไม่พัง แสดง '-'
    { id: 't3', symbol: 'AAPL', type: 'buy', amountThb: 1000, pricePerUnit: 2500, quantity: 0.4, currency: 'THB', date: '2026-05-01' },
  ];

  test('PortfolioDetailSection — แท็บพอร์ตของฉัน (มี Holding + Excluded)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(PortfolioDetailSection, {
          portfolio: LEGACY_PORTFOLIO,
          profitBySymbol: LEGACY_PROFIT,
          transactions: LEGACY_TRANSACTIONS,
          loadError: null,
          activeTab: 'portfolio',
          onTabChange: () => {},
        })
      )
    ).not.toThrow();
  });

  test('PortfolioDetailSection — แท็บประวัติรายการ', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(PortfolioDetailSection, {
          portfolio: LEGACY_PORTFOLIO,
          profitBySymbol: LEGACY_PROFIT,
          transactions: LEGACY_TRANSACTIONS,
          loadError: null,
          activeTab: 'history',
          onTabChange: () => {},
        })
      )
    ).not.toThrow();
  });

  // S8 — คอลัมน์ "สลิป" ในตารางประวัติ: แสดงปุ่มดูสลิปเฉพาะแถวที่ hasSlip
  test('PortfolioDetailSection — แท็บประวัติ: แถวที่ hasSlip โชว์ปุ่มดูสลิป, แถวอื่นโชว์ "-"', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioDetailSection, {
        portfolio: LEGACY_PORTFOLIO,
        profitBySymbol: LEGACY_PROFIT,
        transactions: [
          { ...LEGACY_TRANSACTIONS[0], hasSlip: true },
          { ...LEGACY_TRANSACTIONS[1] }, // ไม่มี hasSlip เลย (รายการเก่าก่อน migration 021)
        ],
        loadError: null,
        activeTab: 'history',
        onTabChange: () => {},
      })
    );

    expect(html).toContain('<th>สลิป</th>');
    expect(html).toContain('ดูสลิป');
    // แถวที่ไม่มีสลิปต้องไม่มีปุ่ม (นับจำนวนปุ่มต้องเป็น 1 ตัวเท่านั้น)
    expect(html.match(/ดูสลิป/g)).toHaveLength(1);
  });

  test('PortfolioDetailSection — แท็บประวัติ: ไม่มีรายการไหนมีสลิปเลย → ไม่มีปุ่มดูสลิป (Backward Compat)', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioDetailSection, {
        portfolio: LEGACY_PORTFOLIO,
        profitBySymbol: LEGACY_PROFIT,
        transactions: LEGACY_TRANSACTIONS, // ทั้งหมดไม่มี field hasSlip (Response เดิม)
        loadError: null,
        activeTab: 'history',
        onTabChange: () => {},
      })
    );

    expect(html).toContain('<th>สลิป</th>');
    expect(html).not.toContain('ดูสลิป');
  });

  test('PortfolioDetailSection — แท็บวิธีใช้งาน (Static ล้วน)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(PortfolioDetailSection, {
          portfolio: LEGACY_PORTFOLIO,
          profitBySymbol: LEGACY_PROFIT,
          transactions: LEGACY_TRANSACTIONS,
          loadError: null,
          activeTab: 'howto',
          onTabChange: () => {},
        })
      )
    ).not.toThrow();
  });

  test('PortfolioDetailSection — พอร์ตว่างเปล่า (isEmpty)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(PortfolioDetailSection, {
          portfolio: { holdings: [], investedByCurrency: { THB: 0, USD: 0 }, totalInvested: 0, isEmpty: true },
          profitBySymbol: {},
          transactions: [],
          loadError: null,
          activeTab: 'portfolio',
          onTabChange: () => {},
        })
      )
    ).not.toThrow();
  });

  test('PortfolioDetailSection — ยังโหลดไม่เสร็จ (portfolio=null)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(PortfolioDetailSection, {
          portfolio: null,
          profitBySymbol: {},
          transactions: [],
          loadError: null,
          activeTab: 'portfolio',
          onTabChange: () => {},
        })
      )
    ).not.toThrow();
  });

  test('PortfolioDetailSection — Endpoint ชุดนี้ล่ม (loadError)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(PortfolioDetailSection, {
          portfolio: null,
          profitBySymbol: {},
          transactions: [],
          loadError: 'โหลดข้อมูลรายละเอียดพอร์ตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
          activeTab: 'portfolio',
          onTabChange: () => {},
        })
      )
    ).not.toThrow();
  });

  // DcaPlansSection (S8 R3 รอบ 3 — หน้าจัดการแผน DCA)
  test('DcaPlansSection — มีแผน Active+Paused ปนกัน', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(DcaPlansSection, {
          plans: PLANS_MIXED,
          symbols: SYMBOLS,
          loadError: null,
          onChanged: () => {},
          showToast: () => {},
        })
      )
    ).not.toThrow();
  });

  test('DcaPlansSection — ไม่มีแผนเลย (Empty State)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(DcaPlansSection, {
          plans: [],
          symbols: SYMBOLS,
          loadError: null,
          onChanged: () => {},
          showToast: () => {},
        })
      )
    ).not.toThrow();
  });

  test('DcaPlansSection — โหลด plans ไม่สำเร็จ (loadError)', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(DcaPlansSection, {
          plans: [],
          symbols: SYMBOLS,
          loadError: 'โหลดแผน DCA ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
          onChanged: () => {},
          showToast: () => {},
        })
      )
    ).not.toThrow();
  });
});

// ── โหมดขายในกล่องบันทึกรายการ (Toggle ซื้อ/ขาย) ──────────────────────────────
// renderToStaticMarkup ไม่รัน Interaction จึงสลับโหมดด้วยการคลิกไม่ได้ — ใช้ prop
// defaultSide (โหมดเริ่มต้นของฟอร์ม) เปิดโหมดขายมาตรงๆ แทน
describe('DcaForm — โหมดขาย', () => {
  const HOLDINGS = [
    { symbol: 'AAPL', name: 'AAPL', type: 'stock_us', units: 12.5, currency: 'USD' },
    { symbol: 'BTC', name: 'BTC', type: 'crypto', units: 0.05231467, currency: 'THB' },
  ];

  function renderForm(props) {
    return renderToStaticMarkup(
      withRouter(
        React.createElement(DcaForm, {
          symbols: SYMBOLS,
          pickerOpenSignal: 0,
          onRecorded: () => {},
          onRequestUndo: () => {},
          ...props,
        })
      )
    );
  }

  test('มี Toggle ซื้อ/ขาย และค่าเริ่มต้นคือ "ซื้อ" (พฤติกรรมเดิมของหน้า)', () => {
    const html = renderForm({ holdings: HOLDINGS });

    expect(html).toContain('ซื้อ (DCA)');
    expect(html).toContain('🔴 ขาย');
    // Default = ซื้อ → ต้องยังเห็นฟอร์ม DCA เดิมครบ
    expect(html).toContain('จำนวนเงินที่ลงทุน (DCA)');
    expect(html).toContain('บันทึก DCA');
    expect(html).not.toContain('จำนวนหน่วยที่ขาย');
  });

  test('Regression — ส่ง holdings มาแล้วโหมดซื้อต้องไม่เปลี่ยนอะไรเลย', () => {
    // กันเคสที่การเพิ่มโหมดขายไปซ่อน/ย้าย Field ของฝั่งซื้อโดยไม่ตั้งใจ
    expect(renderForm({ holdings: HOLDINGS })).toBe(renderForm({ holdings: [] }));
  });

  test('โหมดขาย → เห็นช่องจำนวนหน่วย + ราคาที่ขายได้ + ปุ่มขายทั้งหมด (ไม่ใช่ช่องจำนวนเงิน)', () => {
    const html = renderForm({ holdings: HOLDINGS, defaultSide: 'sell' });

    expect(html).toContain('จำนวนหน่วยที่ขาย');
    expect(html).toContain('ราคาที่ขายได้');
    expect(html).toContain('ขายทั้งหมด');
    expect(html).toContain('บันทึกการขาย');
    // ช่อง/ปุ่มของฝั่งซื้อต้องหายไปหมด ไม่ปนกัน
    expect(html).not.toContain('จำนวนเงินที่ลงทุน (DCA)');
    expect(html).not.toContain('บันทึก DCA');
  });

  test('โหมดขายไม่มีช่องแนบสลิป (รอบนี้เปิดเฉพาะฝั่งซื้อ) แม้เป็น Premium', () => {
    const html = renderForm({ holdings: HOLDINGS, defaultSide: 'sell', isPremiumActive: true });
    expect(html).not.toContain('เลือกรูปสลิป');
  });

  test('โหมดขายตอนพอร์ตว่าง → Empty State + ปุ่มบันทึกถูกปิด (ไม่ปล่อยให้กดแล้วเจอ Error)', () => {
    const html = renderForm({ holdings: [], defaultSide: 'sell' });

    expect(html).toContain('ยังไม่มีสินทรัพย์ในพอร์ตให้ขาย');
    expect(html).toContain('disabled');
    // ไม่ควรโชว์ช่องกรอกจำนวน/ราคาเลยเมื่อไม่มีอะไรให้ขาย
    expect(html).not.toContain('จำนวนหน่วยที่ขาย');
  });
});

// ── AssetAvatar — โลโก้สินทรัพย์ (ดึงอัตโนมัติ) ────────────────────────────────
// renderToStaticMarkup ไม่รัน useEffect (ดูหมายเหตุหัวไฟล์) จึงตรวจได้แค่ "Render
// ครั้งแรก" (ก่อน Fetch ใดๆ เสร็จ) — Logic Fallback ตอน onError จริง/CoinGecko
// สำเร็จ-ล้มเหลว ถูก Unit Test แยกใน lib/assetLogo.test.js แล้ว (ฟังก์ชัน Pure ที่
// Component นี้เรียกใช้) ที่นี่พิสูจน์แค่ว่า Component เลือก "จุดเริ่มต้น" ถูก Path
describe('AssetAvatar', () => {
  test('หุ้นที่มี Domain รู้จัก (AAPL) → Render เป็น <img> ทันทีตั้งแต่ Render แรก (Sync)', () => {
    const html = renderToStaticMarkup(React.createElement(AssetAvatar, { symbol: 'AAPL', type: 'stock_us' }));
    expect(html).toContain('<img');
    expect(html).toContain('cdn.tickerlogos.com/apple.com');
  });

  test('หุ้นที่ไม่มี Domain ใน Map (EOSE) → Fallback ตัวอักษรย่อทันที ไม่มี <img>', () => {
    const html = renderToStaticMarkup(React.createElement(AssetAvatar, { symbol: 'EOSE', type: 'stock_us' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('EOSE'); // slice(0,4) ของ 'EOSE' = 'EOSE' เต็มคำพอดี
  });

  test('Crypto (BTC) → Render แรกยังไม่มี <img> เสมอ (ต้องรอ CoinGecko Fetch ผ่าน useEffect ก่อน)', () => {
    const html = renderToStaticMarkup(React.createElement(AssetAvatar, { symbol: 'BTC', type: 'crypto' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('BTC');
  });

  test('ทอง (gold_bar) → ไม่มี Logo บริษัท เป็นตัวอักษรย่อเสมอ', () => {
    const html = renderToStaticMarkup(React.createElement(AssetAvatar, { symbol: 'GOLD', type: 'gold_bar' }));
    expect(html).not.toContain('<img');
  });

  test('Symbol ยาวเกิน 4 ตัวอักษร (Fallback) → ตัดเหลือ 4 ตัวเหมือนของเดิม (GOLDORN → GOLD)', () => {
    const html = renderToStaticMarkup(React.createElement(AssetAvatar, { symbol: 'GOLDORN', type: 'gold_ornament' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('GOLD');
  });

  test('ยังคงเป็น <span className="dh-avatar"> ครอบไว้เสมอ (CSS/Layout เดิมไม่พัง)', () => {
    const html = renderToStaticMarkup(React.createElement(AssetAvatar, { symbol: 'AAPL', type: 'stock_us' }));
    expect(html).toContain('dh-avatar');
  });
});
