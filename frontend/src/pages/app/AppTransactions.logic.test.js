// ═══════════════════════════════════════════════════════════════════════════
// AppTransactions — Pure Logic Test (buildHistoryQuery / hasActiveFilter)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ หน้านี้เป็น Stateful Page ที่พึ่ง useOutletContext (Router Context) จึง
// Render ตรงๆ ด้วย renderToStaticMarkup ไม่ได้ (Pattern ต่างจาก
// PortfolioSettingsPanel.render.test.js / BrokerSettingsPanel.render.test.js)
// — Logic ที่พลาดแล้วกระทบผู้ใช้จริงถูกดึงออกมาเป็น Pure Function ทดสอบแยกแทน

import { describe, test, expect } from 'vitest';
import { buildHistoryQuery, hasActiveFilter } from './AppTransactions.jsx';

const NO_FILTER = { symbolFilter: '', typeFilter: '', dateFrom: '', dateTo: '' };

describe('buildHistoryQuery — ประกอบ Query String ของ GET /dashboard/history', () => {
  test('ไม่มี Filter ใดๆ → มีแค่ limit/offset ไม่มี symbol/type/dateFrom/dateTo', () => {
    const qs = buildHistoryQuery({ ...NO_FILTER, limit: 50, offset: 0 });
    const params = new URLSearchParams(qs);

    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('0');
    expect(params.has('symbol')).toBe(false);
    expect(params.has('type')).toBe(false);
    expect(params.has('dateFrom')).toBe(false);
    expect(params.has('dateTo')).toBe(false);
  });

  test('มีครบทุก Filter → ส่งครบทุกตัวใน Query String', () => {
    const qs = buildHistoryQuery({
      symbolFilter: 'BTC',
      typeFilter: 'sell',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      limit: 50,
      offset: 0,
    });
    const params = new URLSearchParams(qs);

    expect(params.get('symbol')).toBe('BTC');
    expect(params.get('type')).toBe('sell');
    expect(params.get('dateFrom')).toBe('2026-07-01');
    expect(params.get('dateTo')).toBe('2026-07-31');
  });

  // ⭐ "โหลดเพิ่ม" ต้องใช้ offset ตรงตามที่ขอ — ผิดค่านี้จะได้แถวซ้ำหรือแถวหาย
  test('⭐ offset ที่ส่งเข้ามาต้องปรากฏใน Query String ตรงๆ (โหลดเพิ่ม)', () => {
    const qs = buildHistoryQuery({ ...NO_FILTER, limit: 50, offset: 50 });
    expect(new URLSearchParams(qs).get('offset')).toBe('50');
  });

  test('Filter บางส่วน (แค่ dateFrom ไม่มี dateTo) → ส่งเฉพาะที่มีค่าจริง', () => {
    const qs = buildHistoryQuery({ ...NO_FILTER, dateFrom: '2026-07-01', limit: 50, offset: 0 });
    const params = new URLSearchParams(qs);

    expect(params.get('dateFrom')).toBe('2026-07-01');
    expect(params.has('dateTo')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ hasActiveFilter — จุดที่พลาดแล้วกระทบ "ยกเลิกรายการล่าสุด" ตรงๆ (ดู
// Comment เต็มที่ handleAskUndo ใน AppTransactions.jsx)
// ═══════════════════════════════════════════════════════════════════════════
describe('⭐⭐ hasActiveFilter — ต้องครอบทั้ง 4 ตัวกรอง ไม่ใช่แค่ symbol', () => {
  test('ไม่มี Filter ใดๆ เลย → false (ใช้ transactions[0] ตรงๆ ได้ ไม่ต้องยิง Request แยก)', () => {
    expect(hasActiveFilter(NO_FILTER)).toBe(false);
  });

  test('มีแค่ symbolFilter → true (พฤติกรรมเดิมก่อนพรอมต์นี้)', () => {
    expect(hasActiveFilter({ ...NO_FILTER, symbolFilter: 'BTC' })).toBe(true);
  });

  // ⭐⭐ เคสสำคัญที่สุด — 3 ตัวกรองใหม่ (Prompt นี้เพิ่ม) ต้องถูกนับด้วย ไม่ใช่แค่
  // symbol ตัวเดียวเหมือนโค้ดเดิม ไม่งั้น "ยกเลิกรายการล่าสุด" จะยกเลิกรายการผิด
  // เงียบๆ ตอนกรอง Type/วันที่อยู่ (Modal Confirm โชว์ผิด ผู้ใช้กดยืนยันด้วยข้อมูลที่
  // เข้าใจผิด — ผลกระทบเดียวกับ Ledger Bug ระดับสูง)
  test('⭐⭐ มีแค่ typeFilter (ไม่มี symbol) → ต้องเป็น true ด้วย', () => {
    expect(hasActiveFilter({ ...NO_FILTER, typeFilter: 'sell' })).toBe(true);
  });

  test('⭐⭐ มีแค่ dateFrom (ไม่มี symbol/type) → ต้องเป็น true ด้วย', () => {
    expect(hasActiveFilter({ ...NO_FILTER, dateFrom: '2026-07-01' })).toBe(true);
  });

  test('⭐⭐ มีแค่ dateTo (ไม่มี symbol/type/dateFrom) → ต้องเป็น true ด้วย', () => {
    expect(hasActiveFilter({ ...NO_FILTER, dateTo: '2026-07-31' })).toBe(true);
  });

  test('มีหลาย Filter พร้อมกัน → true', () => {
    expect(
      hasActiveFilter({ symbolFilter: 'BTC', typeFilter: 'buy', dateFrom: '', dateTo: '' })
    ).toBe(true);
  });
});
