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

import StatCards from './StatCards.jsx';
import AllocationCard from './AllocationCard.jsx';
import RecentList from './RecentList.jsx';
import InvestedChart from './InvestedChart.jsx';
import SidePanels from './SidePanels.jsx';
import UndoConfirmModal from './UndoConfirmModal.jsx';
import AssetPicker from './AssetPicker.jsx';
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
        React.createElement(DcaForm, {
          symbols: SYMBOLS,
          pickerOpenSignal: 0,
          onRecorded: () => {},
          onRequestUndo: () => {},
        })
      )
    ).not.toThrow();
  });

  // S8 R3 รอบ 3 — prefillSignal prop ใหม่ (Render ไม่ Throw เท่านั้น: useEffect ที่
  // ใช้ prefillSignal ไม่ทำงานภายใต้ renderToStaticMarkup — ดู
  // frontend/src/lib/dcaPlanPrefill.test.js สำหรับ Test เชิง Logic จริงของ Prefill)
  test('DcaForm — รับ prefillSignal ไม่ Crash', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(DcaForm, {
          symbols: SYMBOLS,
          pickerOpenSignal: 0,
          onRecorded: () => {},
          onRequestUndo: () => {},
          prefillSignal: { symbol: 'BTC', amountTotal: 1000, currency: 'THB', nonce: 1 },
        })
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
    { id: 't1', symbol: 'AAPL', type: 'buy', amountThb: 2500, pricePerUnit: 2500, quantity: 1, currency: 'THB', date: '2026-07-14' },
    { id: 't2', symbol: 'PTT', type: 'sell', amountThb: 340, pricePerUnit: 34, quantity: 10, currency: 'THB', date: '2026-06-01' },
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
