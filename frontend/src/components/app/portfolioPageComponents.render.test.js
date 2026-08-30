// ═══════════════════════════════════════════════════════════════════════════
// หน้าพอร์ตแบบ 2 ระดับ (เฟส 1) — Render Test ของการ์ดพอร์ต + ตารางสินทรัพย์
// ═══════════════════════════════════════════════════════════════════════════
// Pattern เดียวกับ `appComponents.render.test.js` (renderToStaticMarkup — repo นี้
// ไม่มี RTL/jsdom) · ชุดนี้พิสูจน์ "ตัดสินใจแสดงผลถูกต้อง" ไม่ใช่ Interaction
//
// ⚠️ ส่วนที่เป็น "ยิง API อะไรด้วยพารามิเตอร์อะไร" อยู่ที่
// `portfolioDetailData.test.js` ซึ่งเข้มกว่า เพราะ assert Argument จริงของ API
// (Effect ไม่ทำงานใต้ renderToStaticMarkup จึงทดสอบจากตรงนี้ไม่ได้)

import { describe, test, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PortfolioCards from './PortfolioCards.jsx';
import PortfolioHoldingsTable from './PortfolioHoldingsTable.jsx';
import MoveAssetPortfolioDialog from './MoveAssetPortfolioDialog.jsx';
import { profitCacheKey } from './portfolioDetailData.js';

const P1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222';

const PORTFOLIOS = [
  { id: P1, name: 'พอร์ตหลัก', isDefault: true, canWrite: true },
  { id: P2, name: 'Dime', isDefault: false, canWrite: false },
];

function renderCards(props) {
  return renderToStaticMarkup(
    React.createElement(PortfolioCards, {
      portfolios: PORTFOLIOS,
      valueByPortfolio: { [P1]: 125000, [P2]: 4300 },
      assetCountByPortfolio: { [P1]: 3, [P2]: 1 },
      onOpen() {},
      onCreate() {},
      createGate: { allowed: true, reason: null },
      ...props,
    })
  );
}

describe('PortfolioCards — การ์ดพอร์ตบนหน้ารวม', () => {
  test('แสดงครบทุกพอร์ตพร้อมมูลค่าและจำนวนสินทรัพย์', () => {
    const html = renderCards();

    expect(html).toContain('พอร์ตหลัก');
    expect(html).toContain('Dime');
    expect(html).toContain('125,000');
    expect(html).toContain('3 สินทรัพย์');
  });

  // ⭐⭐ กฎเหล็กข้อ 2 (ห้ามลบข้อมูลผู้ใช้) — พอร์ตส่วนเกินหลัง Premium หมดอายุ
  // ข้อมูลยังอยู่ครบ ถ้าซ่อนการ์ดไป ผู้ใช้จะเข้าใจว่าพอร์ตหายไปแล้ว
  test('⭐ พอร์ตที่ canWrite === false ต้อง **แสดง** พร้อมธง ไม่ใช่ซ่อน', () => {
    const html = renderCards();

    expect(html).toContain('Dime');
    expect(html).toContain('พอร์ตนี้เพิ่มรายการใหม่ไม่ได้'); // LOCKED_PORTFOLIO_NOTICE.title
  });

  test('พอร์ตหลักติดธง "พอร์ตหลัก"', () => {
    expect(renderCards()).toContain('พอร์ตหลัก');
  });

  // ⚠️ ยังไม่รู้มูลค่า (เกินเพดานคำขอ/โหลดไม่สำเร็จ) ต้องเป็นขีดกลาง ไม่ใช่ 0
  // — "0 บาท" กับ "ยังไม่รู้" คนละความหมายกันสิ้นเชิง
  test('⭐ ไม่มีมูลค่าให้แสดง → ขีดกลาง ห้ามแสดงเลข 0', () => {
    const html = renderCards({ valueByPortfolio: {} });

    expect(html).toContain('—');
    expect(html).not.toContain('>0 บาท<');
  });

  // ปุ่มสร้างพอร์ตต้องอยู่ในแถวการ์ด (มติ Founder) — ปุ่มบน Topbar ยังอยู่แยกต่างหาก
  test('มีการ์ด "สร้างพอร์ตใหม่" ท้ายแถวเสมอ', () => {
    expect(renderCards()).toContain('สร้างพอร์ตใหม่');
  });

  // ไม่มีสิทธิ์ → ยังเห็นปุ่มแต่บอกเหตุผล (ซ่อนไปเลย = ผู้ใช้ Free ไม่รู้ว่ามีฟีเจอร์)
  test('ไม่มีสิทธิ์สร้าง → ยังแสดงปุ่มพร้อมเหตุผล ไม่ซ่อนหาย', () => {
    const html = renderCards({ createGate: { allowed: false, reason: 'limit' } });

    expect(html).toContain('สร้างพอร์ตใหม่');
    expect(html).toContain('ต้องใช้ Premium');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
const ROWS = [
  { symbol: 'BTC', name: 'Bitcoin', brokerId: 'bk-1', heldQuantity: 0.5, totalInvested: 1000, currency: 'THB' },
  { symbol: 'AAPL', name: 'Apple', brokerId: null, heldQuantity: 10, totalInvested: 200, currency: 'USD' },
];

function renderTable(props) {
  return renderToStaticMarkup(
    React.createElement(PortfolioHoldingsTable, {
      rows: ROWS,
      portfolioId: P1,
      profitBySymbol: {},
      ...props,
    })
  );
}

describe('PortfolioHoldingsTable — ตารางสินทรัพย์ในพอร์ต', () => {
  test('แสดงครบทุกคอลัมน์: Symbol · จำนวนที่ถือ · ต้นทุน · กำไร/ขาดทุน', () => {
    const html = renderTable();

    expect(html).toContain('สินทรัพย์');
    expect(html).toContain('จำนวนที่ถือ');
    expect(html).toContain('ต้นทุน');
    expect(html).toContain('กำไร/ขาดทุน');
    expect(html).toContain('BTC');
    expect(html).toContain('AAPL');
  });

  // ⚠️ ห้ามรวมยอดข้ามสกุล — แต่ละแถวต้องบอกสกุลของตัวเองตามที่ Backend ระบุมา
  test('⭐ แถว USD ต้องกำกับสกุลเงินของตัวเอง ไม่ถูกแสดงเป็นบาท', () => {
    const html = renderTable();

    expect(html).toContain('USD');
    expect(html).toContain('บาท');
  });

  test('กำไร/ขาดทุนที่โหลดมาแล้ว → แสดงเครื่องหมายและเปอร์เซ็นต์', () => {
    const html = renderTable({
      profitBySymbol: {
        [profitCacheKey(P1, 'BTC', 'bk-1')]: { profitLoss: 250.5, profitLossPercent: 25.05 },
      },
    });

    expect(html).toContain('+250.50');
    expect(html).toContain('25.05%');
  });

  // ⚠️ "ยังไม่รู้" (ราคาไม่พร้อม/ยังไม่โหลด) ต้องเป็นขีดกลาง ห้ามเป็น 0
  test('⭐ ไม่มีข้อมูลกำไร (null) → ขีดกลาง ไม่ใช่ 0', () => {
    const html = renderTable({
      profitBySymbol: { [profitCacheKey(P1, 'BTC', 'bk-1')]: null },
    });

    expect(html).toContain('—');
  });

  // พอร์ตว่าง → Empty State ไม่ใช่ตารางหัวโล้น
  test('⭐ พอร์ตว่าง → Empty State ไม่ใช่ตารางเปล่า', () => {
    const html = renderTable({ rows: [] });

    expect(html).toContain('ยังไม่มีสินทรัพย์ในพอร์ตนี้');
    expect(html).not.toContain('<table');
  });

  // Rate Limit Guard — ต้องบอกเหตุผลที่คอลัมน์กำไรยังว่าง พร้อมทางออก
  test('⭐ เกินเพดานคำขอ → บอกเหตุผล + ปุ่มโหลดเอง (ตารางยังแสดงต้นทุนครบ)', () => {
    const html = renderTable({ profitCapped: true });

    expect(html).toContain('โหลดกำไร/ขาดทุน');
    expect(html).toContain('BTC'); // แถวยังอยู่ครบ
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ คอลัมน์ "โบรก/Exchange" (Founder 30 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// เคสจริง: EOSE ดูเหมือนถือซ้ำ 2 แถวในพอร์ตเดียวกัน (106 USD จากสลิป, 600 USD
// จากกรอกเอง) — แท้จริงคือคนละโบรก (migration 046 ถือ Symbol เดียวกันได้หลาย
// โบรก) ซึ่งถูกต้องแล้ว แต่ตารางไม่เคยบอกว่าแถวไหนเป็นของโบรกไหน
const BROKERS = [
  { id: 'bk-1', name: 'Bitkub' },
  { id: 'bk-2', name: 'Binance' },
];

describe('⭐ คอลัมน์ "โบรก/Exchange" ในตาราง Holdings', () => {
  test('⭐ แถวที่มี brokerId → แสดงชื่อโบรกที่ Join มาจากลิสต์ที่ส่งมา', () => {
    const html = renderTable({ brokers: BROKERS });

    expect(html).toContain('Bitkub');
  });

  // holding.brokerId ดิบไม่มีชื่อติดมา (ตรวจแล้วที่ portfolio.service) — ต้อง Join
  // เอง ถ้า Join ไม่ได้ ต้องไม่ throw หรือแสดงค่าว่างเปล่า
  test('⭐ แถวที่ brokerId: null → แสดง "ไม่ระบุ" ไม่ใช่ช่องว่าง', () => {
    const html = renderTable({ brokers: BROKERS }); // AAPL ใน ROWS มี brokerId: null

    expect(html).toContain('ไม่ระบุ');
  });

  // ⭐⭐ เคสของ Founder โดยตรง — Symbol เดียวกันคนละโบรกต้องแยกแยะได้ชัดเจน
  // ไม่ใช่แค่ "ไม่ทับกัน" (React key) แต่ต้อง "อ่านออกว่าเป็นคนละโบรก" ด้วยตา
  test('⭐⭐ Symbol เดียวกันคนละโบรก (เคส EOSE) → ชื่อโบรกต่างกันชัดเจน ไม่ดูเหมือนซ้ำ', () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioHoldingsTable, {
        rows: [
          { symbol: 'EOSE', brokerId: 'bk-1', heldQuantity: 10, totalInvested: 106, currency: 'USD' },
          { symbol: 'EOSE', brokerId: 'bk-2', heldQuantity: 50, totalInvested: 600, currency: 'USD' },
        ],
        portfolioId: P1,
        brokers: BROKERS,
        profitBySymbol: {},
      })
    );

    expect(html).toContain('Bitkub');
    expect(html).toContain('Binance');
    // ทั้งสองแถวต้องมีอยู่จริง (ไม่ถูก React รวมเป็นแถวเดียวเพราะ key ชนกัน)
    expect((html.match(/EOSE/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // ⚠️ ไม่ส่ง brokers เลย (Prop เป็น Optional) → ต้องไม่พัง ตกไปที่ "ไม่ระบุ" เสมอ
  test('ไม่ส่ง brokers มาเลย → ไม่พัง แสดง "ไม่ระบุ" แทนการ Crash', () => {
    expect(() => renderTable({ brokers: undefined })).not.toThrow();
    expect(renderTable({ brokers: undefined })).toContain('ไม่ระบุ');
  });

  test('มีคอลัมน์หัวตาราง "โบรก/Exchange"', () => {
    expect(renderTable({ brokers: BROKERS })).toContain('โบรก/Exchange');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// ⭐ ย้ายสินทรัพย์ข้ามพอร์ต (มติ Founder 29 ส.ค. 2569 → ย้ายเข้าเมนู "ตั้งค่าพอร์ต"
// 30 ส.ค. 2569 — ดู PortfolioSettingsPanel.render.test.js)
// ═══════════════════════════════════════════════════════════════════════════
const HOLDING = { assetId: 'a-1', symbol: 'BTC', brokerId: null, heldQuantity: 0.5, totalInvested: 1000 };

// ⭐ Regression: ปุ่ม "ย้ายพอร์ต" ต่อแถวถูกย้ายเข้าเมนู "ตั้งค่าพอร์ต" ทั้งหมดแล้ว
// (มติ Founder 30 ส.ค. 2569) — ตารางต้อง **ไม่มี** ปุ่มนี้อีกต่อไปไม่ว่า Prop ใดจะส่งมา
describe('⭐ ตาราง Holdings ต้องไม่มีปุ่ม "ย้ายพอร์ต" ต่อแถวอีกต่อไป', () => {
  test('⭐ ไม่มีข้อความ "ย้ายพอร์ต" ปรากฏในตารางเลย (ทางเข้าใหม่คือเมนูตั้งค่าเท่านั้น)', () => {
    const html = renderTable();

    expect(html).not.toContain('ย้ายพอร์ต');
  });

  // ⭐⭐ Regression Guard จริง — ต้องพิสูจน์ว่า Component **ไม่รับ** onMove อีกต่อไป
  // ไม่ใช่แค่ "ไม่มีใครส่ง onMove มา" (ถ้าทดสอบแบบนั้น เทสต์นี้จะเขียวได้แม้กลับไป
  // เพิ่ม onMove ใน AppPortfolio.jsx อีกครั้ง เพราะไม่เคยเรียกใช้พารามิเตอร์นี้เอง)
  test('⭐⭐ ส่ง onMove มาด้วย (จำลอง Caller เก่า/พลาดกลับมาต่อสาย) → ต้องยังไม่มีปุ่มโผล่มา', () => {
    const html = renderTable({ onMove: () => {} });

    expect(html).not.toContain('ย้ายพอร์ต');
  });
});

describe('⭐ MoveAssetPortfolioDialog', () => {
  function renderDialog(props) {
    return renderToStaticMarkup(
      React.createElement(MoveAssetPortfolioDialog, {
        holding: HOLDING,
        portfolios: PORTFOLIOS,
        currentPortfolioId: P1,
        onClose() {},
        onMoved() {},
        ...props,
      })
    );
  }

  // ⭐ ต้องบอกให้ชัดว่านี่ไม่ใช่การซื้อขาย — กันผู้ใช้เข้าใจผิดว่าตัวเลขจะเปลี่ยน
  test('⭐ บอกชัดว่าย้ายพอร์ตไม่ใช่การซื้อ/ขาย และตัวเลขไม่เปลี่ยน', () => {
    const html = renderDialog();

    expect(html).toContain('ไม่ใช่การซื้อหรือขาย');
    expect(html).toContain('ต้นทุน');
  });

  // ⚠️ พอร์ตที่ถูกล็อกเป็นปลายทางไม่ได้ (จะโดน PORTFOLIO_READ_ONLY อยู่ดี)
  // และพอร์ตปัจจุบันก็ไม่ควรอยู่ในตัวเลือก
  test('⭐ ตัวเลือกปลายทาง = พอร์ตอื่นที่เขียนได้เท่านั้น', () => {
    const html = renderDialog();

    // P2 (Dime) canWrite:false → ต้องไม่เป็นตัวเลือก
    expect(html).not.toContain('Dime');
    // พอร์ตปัจจุบัน (P1) ก็ต้องไม่อยู่ในตัวเลือกปลายทาง
    expect(html).toContain('ยังไม่มีพอร์ตปลายทางให้ย้าย');
  });

  test('มีพอร์ตปลายทางที่เขียนได้ → แสดงตัวเลือกและปุ่มย้าย', () => {
    const html = renderDialog({
      portfolios: [
        ...PORTFOLIOS,
        { id: 'pf-3', name: 'ระยะยาว', isDefault: false, canWrite: true },
      ],
    });

    expect(html).toContain('ระยะยาว');
    expect(html).toContain('ย้ายพอร์ต');
    expect(html).not.toContain('ยังไม่มีพอร์ตปลายทางให้ย้าย');
  });
});
