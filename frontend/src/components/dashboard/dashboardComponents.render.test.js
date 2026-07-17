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
};

const assetTypeBySymbol = new Map([
  ['AAPL', 'stock_us'],
  ['PTT', 'stock_th'],
]);

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

  test('SidePanels — พอร์ตมีของ / พอร์ตว่าง', () => {
    expect(() => renderToStaticMarkup(React.createElement(SidePanels, { overview: overviewFull }))).not.toThrow();
    expect(() => renderToStaticMarkup(React.createElement(SidePanels, { overview: overviewEmpty }))).not.toThrow();
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
});
