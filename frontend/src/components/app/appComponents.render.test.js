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

import { describe, test, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import AllocationDonut from './AllocationDonut.jsx';
import CreatePortfolioModal, { createPortfolioErrorText } from './CreatePortfolioModal.jsx';
import { createPortfolio } from '../../lib/portfolioApi.js';
import { setToken } from '../../lib/api.js';
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

// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ Seam: Error จริงจาก lib/api.js → createPortfolioErrorText (AI_WORK_POLICY § 3.1)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ชุดข้างบนเทสต์ Pure Function ด้วย **Argument ที่ถูกต้องอยู่แล้ว** จึงเขียวสนิท
// ตลอดเวลาที่บั๊กมีอยู่จริง — เพราะบั๊กอยู่ที่ "รอยต่อ" พอดี: Component ส่ง
// `err?.code` เข้าไป ซึ่ง api.js ไม่เคยแนบมาให้ (undefined) แทนที่จะเป็น Error Code
//
// นี่คือ Seam แบบเดียวกับที่ POSTMORTEM_AMOUNT_CONSISTENCY.md เตือนไว้เป๊ะ:
// ทั้งสองฝั่งมีเทสต์ครบและเขียวหมด แต่ไม่มีใครเทสต์ "ค่าที่ต้องรอดข้ามขอบเขต"
// → ชุดนี้จึงใช้ Error **ของจริง** จาก createPortfolio (Mock แค่ fetch ซึ่งเป็น
// ขอบนอกสุด) ไม่ใช่ Error ที่ประกอบขึ้นเอง
describe('⭐⭐ Seam — Error จาก createPortfolio ต้องแปลเป็นข้อความไทยได้จริง', () => {
  async function catchCreateError(errorCode) {
    setToken('t');
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: errorCode }),
    }));
    return createPortfolio({ name: 'x', type: 'custom' }).catch((e) => e);
  }

  afterEach(() => vi.unstubAllGlobals());

  // ⭐ อาการจริงที่ผู้ใช้เจอ: เห็น **โค้ดดิบ** "PORTFOLIO_NAME_EXISTS" บนหน้าจอ
  test('⭐ ชื่อซ้ำ → ผู้ใช้เห็นข้อความไทย ไม่ใช่โค้ดดิบจาก Backend', async () => {
    const err = await catchCreateError('PORTFOLIO_NAME_EXISTS');

    // เรียกด้วย Expression เดียวกับที่ Component ใช้จริงเป๊ะ
    const shown = createPortfolioErrorText(err?.code, err?.message);

    expect(shown).toBe('มีพอร์ตชื่อนี้อยู่แล้ว กรุณาใช้ชื่ออื่น');
    expect(shown).not.toBe('PORTFOLIO_NAME_EXISTS');
  });

  // ⭐⭐ กระทบเส้นทางรายได้โดยตรง — ปุ่ม "ดูแพ็กเกจ Premium" ผูกกับ
  // `errorCode === 'PORTFOLIO_LIMIT_REACHED'` ซึ่งเป็น false เสมอตอนบั๊กยังอยู่
  // → ผู้ใช้ Free ที่ชนเพดานพอร์ต **ไม่เคยเห็น CTA อัปเกรดเลย**
  test('⭐⭐ Free ชนเพดาน → errorCode ตรงกับเงื่อนไขที่ทำให้ปุ่ม "ดูแพ็กเกจ Premium" โผล่', async () => {
    const err = await catchCreateError('PORTFOLIO_LIMIT_REACHED');

    expect(err?.code).toBe('PORTFOLIO_LIMIT_REACHED');
    expect(createPortfolioErrorText(err?.code, err?.message)).toContain('อัปเกรด');
  });

  // Premium ที่ชน Sanity Cap 50 ต้อง **ไม่** โดนชวนอัปเกรด (เขาจ่ายอยู่แล้ว)
  test('⭐ Premium ชน Cap → ได้ข้อความของ cap ไม่ใช่ของ limit', async () => {
    const err = await catchCreateError('PORTFOLIO_CAP_REACHED');
    const shown = createPortfolioErrorText(err?.code, err?.message);

    expect(shown).not.toContain('อัปเกรด');
    expect(shown).toContain('ลบพอร์ต');
  });
});

describe('RecordTransactionModal — defaultType จากปุ่มหน้าพอร์ต', () => {
  const WRITABLE = { id: 'pf-1', name: 'ระยะยาว', canWrite: true };
  const LOCKED = { id: 'pf-2', name: 'ระยะสั้น', canWrite: false };

  // ⚠️ ต้องห่อ Router — Modal ใช้ useNavigate() พาไปหน้า /premium เมื่อเจอ
  // Error ที่แก้ได้ด้วยการอัพเกรด (OCR_PREMIUM_REQUIRED / OCR_TRIAL_EXHAUSTED)
  function render(props) {
    return renderToStaticMarkup(
      withRouter(
        React.createElement(RecordTransactionModal, {
          selectedPortfolio: WRITABLE,
          onClose() {},
          onSaved() {},
          ...props,
        })
      )
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

  // ⭐⭐ Regression (บั๊ก 29 ส.ค. 2569): Switcher เลือก "ทั้งหมด" → selectedPortfolio
  // เป็น null (AppShell.jsx: portfolioId === ALL_PORTFOLIOS ? null : ...) ซึ่งเป็น
  // **ค่าเริ่มต้นตอนเปิด /app** — portfolioWriteState(null).canAdd จึงเป็น false
  // แล้ว Modal ขึ้นว่า "แพ็กเกจ Premium หมดอายุแล้ว" ทั้งที่ผู้ใช้เป็น Premium Active
  // อยู่จริง (และเกิดกับ Free ที่เขียนพอร์ต Default ได้ด้วย) — "ไม่ได้เลือกพอร์ต"
  // ไม่ใช่ "พอร์ตถูกล็อก" ห้ามอ้างเหตุผลเรื่องแพ็กเกจหมดอายุเด็ดขาด
  test('⭐ ยังไม่ได้เลือกพอร์ต (ทั้งหมด) → ห้ามอ้างว่า Premium หมดอายุ และห้ามปิดปุ่มซื้อ', () => {
    const html = render({ selectedPortfolio: null });

    expect(html).not.toContain('แพ็กเกจ Premium หมดอายุแล้ว');
    expect(html).not.toContain('disabled="" value="buy"');
    expect(html).not.toContain('disabled="" value="dividend"');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ ช่อง "บันทึกลงพอร์ต" (มติ Founder 29 ส.ค. 2569)
  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️ เทสต์ชุดก่อนหน้าเคยยืนยันว่าฟอร์ม "บอกเสมอว่าปลายทางไม่ขึ้นกับ Switcher"
  // ซึ่งจริง **ตอนที่ฟอร์มยังส่ง portfolioId ไม่ได้** · ตอนนี้ผู้ใช้เลือกปลายทาง
  // ได้จริงแล้ว ข้อความนั้นจึงกลายเป็นเท็จและถูกแทนที่ ไม่ใช่ถูกลบทิ้งเฉยๆ
  const PORTFOLIOS = [
    { id: 'pf-1', name: 'ระยะยาว', isDefault: true, canWrite: true },
    { id: 'pf-2', name: 'ระยะสั้น', isDefault: false, canWrite: false },
    { id: 'pf-3', name: 'Dime', isDefault: false, canWrite: true },
  ];

  test('⭐ โหมดซื้อ → มีช่อง "บันทึกลงพอร์ต" พร้อมคำอธิบายกติกา "รวมที่พอร์ตเดิม"', () => {
    const html = render({ portfolios: PORTFOLIOS, defaultType: 'buy' });

    expect(html).toContain('บันทึกลงพอร์ต');
    expect(html).toContain('ระบบจะรวมไว้ที่พอร์ตเดิมแทน ไม่สร้างแยกใหม่');
  });

  // ⭐ พอร์ตที่ถูกล็อกต้องไม่โผล่เป็นตัวเลือกปลายทางของ "ของใหม่"
  test('⭐ Dropdown แสดงเฉพาะพอร์ตที่ canWrite === true', () => {
    const html = render({ portfolios: PORTFOLIOS, defaultType: 'buy' });

    expect(html).toContain('ระยะยาว');
    expect(html).toContain('Dime');
    expect(html).not.toContain('ระยะสั้น'); // canWrite: false
  });

  // ขาย/ปันผล ไม่มีคอนเซ็ปต์เลือกพอร์ตปลายทาง (Backend ไม่รับ Key นี้ทั้งคู่)
  test('⭐ โหมดขาย/ปันผล → ไม่มีช่อง "บันทึกลงพอร์ต" เลย', () => {
    expect(render({ portfolios: PORTFOLIOS, defaultType: 'sell' })).not.toContain('บันทึกลงพอร์ต');
    expect(render({ portfolios: PORTFOLIOS, defaultType: 'dividend' })).not.toContain(
      'บันทึกลงพอร์ต'
    );
  });

  // ไม่มีพอร์ตที่เขียนได้เลย → ซ่อนทั้งช่อง (Caller จะไม่ส่ง portfolioId ไป
  // Backend ด้วย = Fallback กลับพฤติกรรมเดิม) ห้าม Render Dropdown ว่างเปล่า
  test('ไม่มีพอร์ตที่เขียนได้เลย → ไม่ Render ช่องนี้ (ไม่ใช่ Dropdown ว่าง)', () => {
    const html = render({ portfolios: [], defaultType: 'buy' });
    expect(html).not.toContain('บันทึกลงพอร์ต');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // งาน UI 3 จุด (Founder ทดสอบ /app 29 ส.ค. 2569)
  // ═══════════════════════════════════════════════════════════════════════

  // งานที่ 1 — Input ไฟล์ต้องยังมี Class Hook เดิมที่ CSS (.slip-scan__input
  // ใน appShell.css) ใช้ซ่อนมันอยู่ · Regression Guard กันคนแก้ชื่อ Class ใน
  // Component โดยลืมแก้ CSS คู่กัน แล้ว Input โผล่ซ้อนปุ่มกลับมาแบบเดิม
  test('⭐ Input เลือกไฟล์สลิปยังมี class="slip-scan__input" (Hook ของ CSS ที่ซ่อนมันไว้)', () => {
    const html = render({ defaultType: 'buy' });
    expect(html).toContain('class="slip-scan__input"');
  });

  // งานที่ 2 — Dropdown โบรกต้องมีตัวเลือก "+ เพิ่มโบรก/Exchange ใหม่" เสมอ
  // และช่องพิมพ์ชื่อโบรกใหม่ต้อง **ไม่** โผล่มาตั้งแต่เปิด Modal (addingBroker
  // เริ่มที่ false — โผล่เฉพาะหลังผู้ใช้เลือก Option นี้เท่านั้น)
  test('⭐ Dropdown โบรกมีตัวเลือก "+ เพิ่มโบรก/Exchange ใหม่" แต่ช่องพิมพ์ชื่อยังไม่โผล่ตอนเปิด', () => {
    const html = render({ defaultType: 'buy' });

    expect(html).toContain('+ เพิ่มโบรก/Exchange ใหม่');
    expect(html).not.toContain('ชื่อโบรก/Exchange ใหม่');
  });

  // งานที่ 3 — ค่าธรรมเนียมเป็น Optional เฉพาะโหมดซื้อ/ขาย ไม่มีในโหมดปันผล
  // (Endpoint ปันผลไม่มี Field นี้ตาม Contract — ดู recordTransactionLogic.js)
  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ ซื้อสินทรัพย์ที่ยังไม่เคยถือ (Founder 29 ส.ค. 2569)
  // ═══════════════════════════════════════════════════════════════════════
  // เดิม Dropdown แสดงได้เฉพาะของที่ถืออยู่ (listAssets) → ผู้ใช้ใหม่ที่ยังไม่ถือ
  // อะไรเลยซื้อครั้งแรกไม่ได้ นอกจากจะอ่านสลิป ทั้งที่ § 15.2 รับ symbol ตรงๆ
  test('⭐ โหมดซื้อ → มีตัวเลือก "+ สินทรัพย์ใหม่ (พิมพ์เอง)" ใน Dropdown สินทรัพย์', () => {
    expect(render({ defaultType: 'buy' })).toContain('+ สินทรัพย์ใหม่ (พิมพ์เอง)');
  });

  // ⚠️ ขายเลือกได้แค่ของที่ถืออยู่จริงเท่านั้น (validateSell หาจาก Ledger ไม่ใช่
  // Registry) — ถ้าโผล่ในโหมดขายจะเป็นช่องที่เลือกแล้วได้ ASSET_NOT_FOUND เสมอ
  test('⭐ โหมดขาย → **ไม่มี** ตัวเลือกสินทรัพย์ใหม่ (ขายได้เฉพาะของที่ถืออยู่)', () => {
    expect(render({ defaultType: 'sell' })).not.toContain('+ สินทรัพย์ใหม่');
  });

  // 🔴 Regression: เดิม select ถูก disabled เมื่อ assets ว่าง ซึ่งจะปิดทางเดียว
  // ที่เหลือของผู้ใช้ใหม่ (ยังไม่ถืออะไรเลย = assets ว่างเสมอ) = บั๊กที่กำลังแก้
  test('⭐ ผู้ใช้ใหม่ (ยังไม่ถืออะไรเลย) → Dropdown สินทรัพย์ต้องไม่ถูก disabled ในโหมดซื้อ', () => {
    const html = render({ defaultType: 'buy' });
    // select ของสินทรัพย์ต้องเปิดให้กดได้ เพื่อเข้าถึง "+ สินทรัพย์ใหม่"
    expect(html).toContain('+ สินทรัพย์ใหม่ (พิมพ์เอง)');
    expect(html).not.toContain('<select disabled=""><option value="__new_asset__"');
  });

  test('⭐ โหมดซื้อ/ขาย → มีช่อง "ค่าธรรมเนียม (ถ้ามี)" · โหมดปันผล → ไม่มี', () => {
    expect(render({ defaultType: 'buy' })).toContain('ค่าธรรมเนียม (ถ้ามี)');
    expect(render({ defaultType: 'sell' })).toContain('ค่าธรรมเนียม (ถ้ามี)');
    expect(render({ defaultType: 'dividend' })).not.toContain('ค่าธรรมเนียม (ถ้ามี)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Founder ทดสอบฟอร์มขาย 30 ส.ค. 2569 — 4 ปัญหา (ปัญหาที่ 1 และ 3 ตรวจได้จาก
  // Render โดยตรง เพราะขึ้นกับ `type` state ล้วนๆ ไม่ต้องรอ Effect โหลดข้อมูล —
  // ปัญหาที่ 2/4 อยู่ที่การคำนวณ/ Payload จริง ดู transactions.controller.test.js
  // (Backend) และ recordTransactionLogic.test.js (buildTransactionPayload)
  // ═══════════════════════════════════════════════════════════════════════

  // ⭐ ปัญหาที่ 1 — ซ่อนช่องโบรกทั้งช่องตอนขาย (เลือกสินทรัพย์จาก Dropdown ที่
  // กำกับชื่อโบรกไว้แล้วก็รู้โบรกในตัวอยู่แล้ว ช่องแยกที่ไม่เคย Sync มีแต่จะสับสน)
  test('⭐ โหมดขาย → ไม่มีช่องเลือกโบรกเลย', () => {
    expect(render({ defaultType: 'sell' })).not.toContain('โบรก/Exchange');
  });

  test('โหมดซื้อ → ยังมีช่องเลือกโบรกเหมือนเดิม (ผู้ใช้ยังต้องเลือกเองได้)', () => {
    expect(render({ defaultType: 'buy' })).toContain('โบรก/Exchange');
  });

  // ⭐ ปัญหาที่ 3 — ปุ่ม "ขายทั้งหมด" เฉพาะโหมดขายเท่านั้น
  test('⭐ โหมดขาย → มีตัวเลือก "ขายทั้งหมด"', () => {
    expect(render({ defaultType: 'sell' })).toContain('ขายทั้งหมด');
  });

  test('โหมดซื้อ/ปันผล → ไม่มีตัวเลือก "ขายทั้งหมด" (จำกัดเฉพาะฝั่งขาย)', () => {
    expect(render({ defaultType: 'buy' })).not.toContain('ขายทั้งหมด');
    expect(render({ defaultType: 'dividend' })).not.toContain('ขายทั้งหมด');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SlipUploadField — แนบสลิปให้ AI อ่าน (§ 15.8)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ครอบเฉพาะ "สิ่งที่ Render ออกมา" — ตรรกะตัดสิน (side null / orderStatus /
// รูปร่าง Payload) อยู่ที่ `recordTransactionLogic.test.js` ซึ่งทดสอบเข้มกว่า
// เพราะ assert ตัว Object ที่จะถูกส่งไป Backend ตรงๆ
import SlipUploadField from './SlipUploadField.jsx';
import { slipOcrErrorMessage, isSlipOcrUpgradeError } from '../../lib/dcaErrors.js';

describe('SlipUploadField — สถานะต่างๆ ต้อง Render ได้โดยไม่พัง', () => {
  const base = { scanning: false, onPick() {}, onUpgrade() {} };

  test('สถานะปกติ → มีปุ่มเลือกรูป + บอกว่าแก้ไขได้ก่อนบันทึก', () => {
    const html = renderToStaticMarkup(React.createElement(SlipUploadField, base));

    expect(html).toContain('เลือกรูปสลิป');
    // ⚠️ ต้องสื่อชัดว่า AI ไม่ได้บันทึกให้เอง (API.md § 15.8)
    expect(html).toContain('แก้ไขได้ทุกช่อง');
    expect(html).toContain('ไม่บันทึกรายการให้อัตโนมัติ');
  });

  // ⭐ จุดเสียบ GIF ของ Founder — ต้องมี Element ห่อที่ชื่อคงที่ให้สลับทีหลังได้
  test('⭐ กำลังอ่าน → มี .slip-scan__indicator (จุดเดียวที่ต้องแก้ตอนใส่ GIF)', () => {
    const html = renderToStaticMarkup(
      React.createElement(SlipUploadField, { ...base, scanning: true })
    );

    expect(html).toContain('slip-scan__indicator');
    expect(html).toContain('กำลังให้ AI อ่านสลิป');
    // ปุ่มต้องกดซ้ำไม่ได้ระหว่างอ่าน (กันยิงซ้ำกินโควตา)
    expect(html).toContain('disabled');
  });

  test('ไม่ได้กำลังอ่าน → ไม่มี Loading Indicator ค้างอยู่', () => {
    const html = renderToStaticMarkup(React.createElement(SlipUploadField, base));

    expect(html).not.toContain('slip-scan__indicator');
  });

  // ⭐ Error ทุก Code ของ § 15.8 → ต้องไม่ Crash และต้องเห็นข้อความภาษาคน
  const OCR_CODES = [
    'OCR_PREMIUM_REQUIRED',
    'OCR_TRIAL_EXHAUSTED',
    'OCR_QUOTA_EXCEEDED',
    'OCR_CALL_LIMIT_EXCEEDED',
    'OCR_RATE_LIMITED',
    'OCR_NOT_A_SLIP',
    'OCR_MULTIPLE_ITEMS',
    'OCR_FAILED',
    'OCR_NOT_CONFIGURED',
    'INVALID_SLIP_CONTENT_TYPE',
    'SLIP_TOO_LARGE',
  ];

  test.each(OCR_CODES)('⭐ Error %s → ไม่ Crash + แสดงข้อความอ่านรู้เรื่อง ไม่โชว์ Code ดิบ', (code) => {
    const message = slipOcrErrorMessage(code);
    const html = renderToStaticMarkup(
      React.createElement(SlipUploadField, {
        ...base,
        error: message,
        showUpgrade: isSlipOcrUpgradeError(code),
      })
    );

    expect(html).toContain('app-state--error');
    // ⚠️ ห้ามให้ Error Code ดิบหลุดถึงสายตาผู้ใช้
    expect(html).not.toContain(code);
    expect(message.length).toBeGreaterThan(10);
  });

  // ปุ่มอัพเกรดต้องโผล่เฉพาะ Error ที่แก้ด้วยการอัพเกรดได้จริง — รูปเบลอ/ส่งถี่
  // ไม่ควรถูกขายของ
  test('⭐ ปุ่มอัพเกรดโผล่เฉพาะ OCR_PREMIUM_REQUIRED / OCR_TRIAL_EXHAUSTED', () => {
    const withUpgrade = renderToStaticMarkup(
      React.createElement(SlipUploadField, { ...base, error: 'x', showUpgrade: true })
    );
    const withoutUpgrade = renderToStaticMarkup(
      React.createElement(SlipUploadField, { ...base, error: 'x', showUpgrade: false })
    );

    expect(withUpgrade).toContain('Premium');
    expect(withoutUpgrade).not.toContain('ดูแพ็กเกจ Premium');
    expect(isSlipOcrUpgradeError('OCR_PREMIUM_REQUIRED')).toBe(true);
    expect(isSlipOcrUpgradeError('OCR_RATE_LIMITED')).toBe(false);
  });

  // ⭐ Banner ของคำสั่งที่ยังไม่เกิดขึ้นจริง (pending/cancelled)
  test('⭐ warning (orderStatus pending/cancelled) → แสดงเป็น alert ให้เห็นชัด', () => {
    const html = renderToStaticMarkup(
      React.createElement(SlipUploadField, {
        ...base,
        warning: 'สลิปนี้เป็นคำสั่งที่ "ยังไม่สำเร็จ" (รอจับคู่/รอดำเนินการ)',
      })
    );

    expect(html).toContain('app-state--warn');
    expect(html).toContain('ยังไม่สำเร็จ');
    expect(html).toContain('role="alert"');
  });

  test('notice (โควตา) → แสดงได้ไม่พัง', () => {
    const html = renderToStaticMarkup(
      React.createElement(SlipUploadField, { ...base, notice: 'โควตาอ่านสลิปเดือนนี้เหลือ 49 ครั้ง' })
    );

    expect(html).toContain('49');
  });
});
