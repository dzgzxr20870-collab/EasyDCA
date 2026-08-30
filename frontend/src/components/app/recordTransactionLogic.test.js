// ═══════════════════════════════════════════════════════════════════════════
// recordTransactionLogic — ตรรกะที่กระทบตัวเลขใน Ledger จริง
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ repo นี้ไม่มี @testing-library/react และไม่มี jsdom — Test ฝั่ง FE ทั้งหมด
// เป็น `renderToStaticMarkup` แบบ SSR + Pure-function Unit Test
// (ดู `components/dashboard/dashboardComponents.render.test.js` หัวไฟล์)
//
// การตัดสินใจทั้งหมดของ Flow "อ่านสลิป → เติมฟอร์ม → บันทึก" จึงถูกย้ายมาไว้ใน
// Pure Function เพื่อให้ทดสอบ **สิ่งที่สำคัญจริง** ได้: Payload ที่จะถูกส่งไป
// Backend · ซึ่ง assert ตัว Object ตรงๆ เข้มกว่าการ Mock ผ่าน Component ด้วยซ้ำ
// (Pattern เดียวกับที่ `lib/slipOcrPrefill.js` ถูกแยกออกจาก `DcaForm.jsx`)
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • ให้ buildSlipPrefill คืน type:'buy' เมื่อ side เป็น null → เคส ⭐ แดง
//   • ถอด `if (blockReason) return base` ออก → เคส pending/cancelled แดง
//   • เปลี่ยน slipToken เป็น `slipToken: form.slipToken ?? null` → เคส Free แดง
//   • เปลี่ยน `amountTotal` กลับเป็น `amountThb` → เคส Contract แดง
//   • ถอด currency ออกจาก Payload → เคสสลิป USD แดง

import { describe, test, expect } from 'vitest';
import {
  slipBlockReason,
  buildSlipPrefill,
  quotaNotice,
  buildTransactionPayload,
  buildDividendPayload,
  normalizeBrokerName,
  defaultDestinationPortfolioId,
  needsSymbolFetch,
  assetOptionLabel,
  assetListParams,
  sellAllErrorText,
  buyErrorText,
} from './recordTransactionLogic.js';

// สลิปตามรูปแบบ Response ของ API.md § 15.8 เป๊ะ
const SLIP_BUY = {
  symbol: 'BTC',
  side: 'buy',
  orderStatus: 'filled',
  quantity: 0.01,
  pricePerUnit: 3400000,
  amountTotal: 34000,
  currency: 'THB',
  date: '2026-08-20',
  confidence: 'high',
};

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ slip.side === null — ห้ามเดาทิศทางให้ผู้ใช้เด็ดขาด', () => {
  // บทเรียนเคส BCPG: สลิป "ขาย" เคยถูกบันทึกเป็น "ซื้อ" เพราะโค้ด Default เป็น buy
  // → P&L และจำนวนหน่วยกลับด้าน และเป็น Immutable Ledger ที่แก้ได้ด้วย Reversal เท่านั้น
  test('⭐ side = null → type ต้องเป็น null (ผู้เรียกจะได้ไม่เรียก setType)', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, side: null });

    expect(prefill.type).toBeNull();
    expect(prefill.sideUnresolved).toBe(true);
  });

  // ⚠️ ตัวเลขที่ "ความหมายขึ้นกับทิศทาง" ต้องไม่ถูกเติมด้วย — ช่องจำนวนหน่วยของขาย
  // กับจำนวนเงินรวมของซื้อ เป็นคนละความหมายสิ้นเชิง เติมผิดโหมด = กรอกผิดให้ผู้ใช้
  test('⭐ side = null → ไม่เติมจำนวน/ราคา/ยอดเงินเลยสักช่อง', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, side: null });

    expect(prefill.quantity).toBeNull();
    expect(prefill.pricePerUnit).toBeNull();
    expect(prefill.amountTotal).toBeNull();
  });

  // ค่าที่ไม่ขึ้นกับทิศทางยังเติมได้ (ผู้ใช้ไม่ต้องกรอกใหม่ทั้งหมด)
  test('side = null → วันที่/สินทรัพย์/สกุลเงิน ยังเติมได้ (ไม่ขึ้นกับทิศทาง)', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, side: null, currency: 'USD' });

    expect(prefill.date).toBe('2026-08-20');
    expect(prefill.symbol).toBe('BTC');
    expect(prefill.currency).toBe('USD');
  });

  test.each(['Sell', 'ซื้อ', 'unknown', undefined])(
    'ค่า side ที่ไม่รู้จัก (%o) → ปฏิบัติเหมือน null ไม่ใช่เดาเป็น buy',
    (side) => {
      expect(buildSlipPrefill({ ...SLIP_BUY, side }).type).toBeNull();
    }
  );

  test('side ชัดเจน → เติมครบตามปกติ (คุณค่าหลักของฟีเจอร์ต้องไม่หาย)', () => {
    const prefill = buildSlipPrefill(SLIP_BUY);

    expect(prefill.type).toBe('buy');
    expect(prefill.sideUnresolved).toBe(false);
    expect(prefill.quantity).toBe('0.01');
    expect(prefill.pricePerUnit).toBe('3400000');
  });

  test('สลิปขาย → เติมจำนวนหน่วย + ราคาที่ขายได้', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, side: 'sell' });

    expect(prefill.type).toBe('sell');
    expect(prefill.quantity).toBe('0.01');
    expect(prefill.pricePerUnit).toBe('3400000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ orderStatus pending/cancelled — คำสั่งที่ยังไม่เกิดขึ้นจริง', () => {
  test.each(['pending', 'cancelled'])('⭐ orderStatus = %s → blockReason ตรงตามสถานะ', (status) => {
    expect(slipBlockReason({ orderStatus: status })).toBe(status);
    expect(buildSlipPrefill({ ...SLIP_BUY, orderStatus: status }).blockReason).toBe(status);
  });

  // ⚠️ ห้าม Prefill ให้กดบันทึกง่ายๆ — Ledger ต้องไม่มีรายการที่ไม่เคยเกิดขึ้น
  test.each(['pending', 'cancelled'])('⭐ orderStatus = %s → ไม่เติมค่าใดๆ เลย', (status) => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, orderStatus: status });

    expect(prefill.type).toBeNull();
    expect(prefill.quantity).toBeNull();
    expect(prefill.pricePerUnit).toBeNull();
    expect(prefill.amountTotal).toBeNull();
    expect(prefill.date).toBeNull();
  });

  test.each(['filled', null, undefined])('orderStatus = %o → ไม่บล็อก เติมได้ปกติ', (status) => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, orderStatus: status });

    expect(prefill.blockReason).toBeNull();
    expect(prefill.type).toBe('buy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ slipToken === null (Free/Trial) — ห้ามมี Key นี้ใน Payload', () => {
  const base = {
    type: 'buy',
    symbol: 'BTC',
    quantity: '0.01',
    pricePerUnit: '3400000',
    amountTotal: '34000',
    currency: 'THB',
    brokerId: 'none',
    date: '2026-08-20',
  };

  // ⚠️ ส่ง `slipToken: null` ไปตรงๆ คนละเรื่องกับ "ไม่ส่ง Key เลย" — API.md § 15.2
  // ระบุว่าเป็น Optional · Bug Class นี้เคยเกิดจริงในโปรเจกต์นี้มาแล้ว (undefined
  // vs null ของ portfolioId/brokerId — ดู POSTMORTEM_PORTFOLIO_RESOLUTION)
  test('⭐ slipToken = null → Payload ต้องไม่มี key "slipToken" เลย', () => {
    const payload = buildTransactionPayload({ ...base, slipToken: null });

    expect(Object.keys(payload)).not.toContain('slipToken');
    expect('slipToken' in payload).toBe(false);
  });

  test('slipToken เป็น string (Premium) → ส่งไปด้วย', () => {
    const payload = buildTransactionPayload({ ...base, slipToken: '1750000000000.jpg' });

    expect(payload.slipToken).toBe('1750000000000.jpg');
  });

  test('ไม่ได้แนบสลิปเลย (undefined) → ก็ต้องไม่มี key เช่นกัน', () => {
    expect('slipToken' in buildTransactionPayload(base)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ Payload ต้องตรง Contract ของ API.md § 15.2', () => {
  // 🔴 บั๊กจริงที่เจอตอนทำงานนี้: ฟอร์มเดิมส่ง `amountThb` แต่ Backend อ่าน
  // `body.amountTotal` → ช่อง "จำนวนเงินรวม" ไม่เคยถึง Backend เลย
  test('⭐ ใช้ชื่อ field "amountTotal" ไม่ใช่ "amountThb"', () => {
    const payload = buildTransactionPayload({
      type: 'buy',
      symbol: 'AAPL',
      amountTotal: '1000',
      currency: 'THB',
      date: '2026-08-20',
    });

    expect(payload.amountTotal).toBe(1000);
    expect('amountThb' in payload).toBe(false);
  });

  // 🔴 สลิป USD ที่ไม่ส่ง currency → Backend Default เป็น THB = ยอดเงินผิดใน Ledger
  test('⭐ สลิป USD → Payload ต้องมี currency: "USD"', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, currency: 'USD' });
    const payload = buildTransactionPayload({
      type: prefill.type,
      symbol: prefill.symbol,
      quantity: prefill.quantity,
      pricePerUnit: prefill.pricePerUnit,
      currency: prefill.currency,
      date: prefill.date,
    });

    expect(payload.currency).toBe('USD');
  });

  test('ไม่ระบุสกุล → เป็น THB เสมอ (ไม่ปล่อยให้ Key หายไปเงียบๆ)', () => {
    expect(buildTransactionPayload({ type: 'buy', symbol: 'PTT' }).currency).toBe('THB');
  });

  // สลิประบุจำนวนหน่วย + ราคาครบ → ส่งคู่กันเพื่อให้ Backend ใช้ priceSource='user'
  // ไม่ดึงราคาตลาด ณ ตอนกดบันทึกมาคำนวณทับ (API.md § 15.2.1 เส้นทางแรก)
  test('⭐ มาจากสลิป → ส่ง quantity + pricePerUnit คู่กันเสมอ', () => {
    const prefill = buildSlipPrefill(SLIP_BUY);
    const payload = buildTransactionPayload({
      type: prefill.type,
      symbol: prefill.symbol,
      quantity: prefill.quantity,
      pricePerUnit: prefill.pricePerUnit,
      amountTotal: prefill.amountTotal,
      currency: prefill.currency,
      date: prefill.date,
    });

    expect(payload.quantity).toBe(0.01);
    expect(payload.pricePerUnit).toBe(3400000);
  });

  test('ช่องที่เว้นว่าง → ไม่มี Key นั้นใน Payload (ไม่ส่ง 0/ค่าว่างไป)', () => {
    const payload = buildTransactionPayload({
      type: 'buy',
      symbol: 'BTC',
      quantity: '',
      pricePerUnit: '',
      amountTotal: '500',
      note: '',
    });

    expect('quantity' in payload).toBe(false);
    expect('pricePerUnit' in payload).toBe(false);
    expect('note' in payload).toBe(false);
    expect(payload.amountTotal).toBe(500);
  });

  // ปันผลเป็น Endpoint คนละตัวและใช้ `amountThb` จริงตาม Contract — ห้ามเปลี่ยนตาม
  test('⚠️ ปันผลยังใช้ "amountThb" (คนละ Endpoint กับ § 15.2)', () => {
    const payload = buildDividendPayload({
      assetId: 'asset-1',
      amountThb: '250',
      quantity: '10',
      date: '2026-08-20',
    });

    expect(payload.amountThb).toBe(250);
    expect('amountTotal' in payload).toBe(false);
    expect('slipToken' in payload).toBe(false);
    expect('currency' in payload).toBe(false);
  });

  // ⭐⭐ งานที่ 3 (Founder 29 ส.ค. 2569) — ค่าธรรมเนียม Optional ทั้งซื้อ/ขาย
  test('⭐ กรอกค่าธรรมเนียม → ส่ง feeThb เป็นตัวเลขไปกับ Payload', () => {
    const payload = buildTransactionPayload({
      type: 'buy',
      symbol: 'PTT',
      amountTotal: '1000',
      feeThb: '15.50',
    });

    expect(payload.feeThb).toBe(15.5);
  });

  // 🔴 Silent Default ของโปรเจกต์: ไม่กรอก = "ไม่รู้ค่า" ต้องไม่มี Key นี้เลย
  // (Backend แยกความหมาย "ไม่ส่ง Key" (NULL) กับ "ส่ง 0" (ยืนยันว่าไม่มีค่าธรรมเนียม)
  // ไว้คนละความหมาย — ฟอร์มนี้ไม่มีช่องยืนยัน 0 แยกต่างหาก จึงต้องไม่ส่ง 0 เอง)
  test('⭐ ไม่กรอกค่าธรรมเนียม (ว่าง/0) → ไม่มี Key "feeThb" ใน Payload เลย', () => {
    const emptyPayload = buildTransactionPayload({ type: 'buy', symbol: 'PTT', amountTotal: '1000' });
    const zeroPayload = buildTransactionPayload({
      type: 'buy',
      symbol: 'PTT',
      amountTotal: '1000',
      feeThb: '0',
    });

    expect('feeThb' in emptyPayload).toBe(false);
    expect('feeThb' in zeroPayload).toBe(false);
  });

  // ⚠️ Endpoint ปันผลไม่มี Field นี้ตาม Contract (§ 15.2 คนละตัว) — ต้องไม่รั่วเข้าไป
  test('⚠️ ปันผลไม่มี "feeThb" แม้ Caller จะส่งค่ามาก็ตาม', () => {
    const payload = buildDividendPayload({
      assetId: 'asset-1',
      amountThb: '250',
      quantity: '10',
      feeThb: '15',
    });

    expect('feeThb' in payload).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('normalizeBrokerName — ชื่อโบรกใหม่ที่พิมพ์ในฟอร์ม (งานที่ 2)', () => {
  test('ตัดช่องว่างหัวท้ายออกก่อนส่งไป Backend', () => {
    expect(normalizeBrokerName('  Bitkub  ')).toBe('Bitkub');
  });

  test('ว่างเปล่า/มีแต่ Whitespace → null (Caller ต้องไม่ยิง API)', () => {
    expect(normalizeBrokerName('')).toBeNull();
    expect(normalizeBrokerName('   ')).toBeNull();
  });

  test('ค่าที่ไม่ใช่ String (undefined/null) → null ไม่ throw', () => {
    expect(normalizeBrokerName(undefined)).toBeNull();
    expect(normalizeBrokerName(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ ค่าที่ผู้ใช้แก้เองต้องชนะค่าจาก AI เสมอ', () => {
  // พิสูจน์ว่า Prefill เป็นแค่ "ค่าเริ่มต้นในช่องกรอก" ไม่ใช่ค่าที่ล็อกไว้ —
  // Payload สร้างจาก State ปัจจุบันของฟอร์ม ไม่ได้อ้างอิงผลจาก AI อีกเลย
  test('⭐ อ่านสลิปแล้วแก้จำนวน/ราคา → ค่าที่ส่งต้องเป็นค่าที่แก้ ไม่ใช่ค่าดิบจาก AI', () => {
    const prefill = buildSlipPrefill(SLIP_BUY);

    expect(prefill.quantity).toBe('0.01'); // ค่าจาก AI
    expect(prefill.pricePerUnit).toBe('3400000');

    // ผู้ใช้แก้ทั้งสองช่องก่อนกดบันทึก
    const payload = buildTransactionPayload({
      type: prefill.type,
      symbol: prefill.symbol,
      quantity: '0.02',
      pricePerUnit: '3500000',
      currency: prefill.currency,
      date: prefill.date,
      slipToken: 'tok.jpg',
    });

    expect(payload.quantity).toBe(0.02);
    expect(payload.pricePerUnit).toBe(3500000);
    // Token ของรูปยังติดไปด้วย (รูปเป็นหลักฐานของรายการนี้ แม้ตัวเลขถูกแก้)
    expect(payload.slipToken).toBe('tok.jpg');
  });

  test('⭐ แก้ทิศทางเองหลัง AI อ่านได้ → side ที่ส่งเป็นของผู้ใช้', () => {
    const prefill = buildSlipPrefill(SLIP_BUY);
    expect(prefill.type).toBe('buy');

    const payload = buildTransactionPayload({
      type: 'sell',
      symbol: prefill.symbol,
      quantity: prefill.quantity,
      pricePerUnit: prefill.pricePerUnit,
    });

    expect(payload.side).toBe('sell');
  });

  test('⭐ แก้สกุลเงินเองหลัง AI อ่านเป็น USD → บันทึกตามที่ผู้ใช้เลือก', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, currency: 'USD' });
    expect(prefill.currency).toBe('USD');

    expect(buildTransactionPayload({ type: 'buy', symbol: 'BTC', currency: 'THB' }).currency).toBe(
      'THB'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('quotaNotice — แสดงโควตาที่เหลือให้ผู้ใช้เห็น', () => {
  test('Premium → บอกโควตารายเดือน', () => {
    expect(quotaNotice({ mode: 'premium', remaining: 49 })).toContain('49');
  });

  test('Trial → บอกว่าเป็นสิทธิ์ทดลอง และการเก็บรูปเป็นสิทธิ์ Premium', () => {
    const text = quotaNotice({ mode: 'trial', remaining: 2 });

    expect(text).toContain('2');
    expect(text).toContain('ทดลอง');
    expect(text).toContain('Premium');
  });

  // ⚠️ ไม่เดาเลขให้ — Backend ไม่ส่งมาก็ไม่ต้องแสดง (ห้าม Silent Default)
  test.each([null, undefined, {}, { mode: 'premium' }])('quota = %o → คืน null ไม่เดาเลข', (q) => {
    expect(quotaNotice(q)).toBeNull();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// พอร์ตปลายทาง — ช่อง "บันทึกลงพอร์ต" (มติ Founder 29 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// เคสจริง: สร้างพอร์ต "Dime" → เลือกไว้บน Switcher → ซื้อสินทรัพย์ใหม่ → รายการ
// ไปโผล่พอร์ตหลัก เพราะฟอร์มไม่เคยส่ง portfolioId ไป Backend เลยสักครั้ง
describe('⭐ portfolioId ใน Payload — พอร์ตปลายทางที่ผู้ใช้เลือก', () => {
  test('⭐ เลือกพอร์ตปลายทาง → Payload มี portfolioId ตรงกับที่เลือก', () => {
    const payload = buildTransactionPayload({
      type: 'buy',
      symbol: 'BTC',
      amountTotal: '1000',
      portfolioId: 'pf-dime',
    });

    expect(payload.portfolioId).toBe('pf-dime');
  });

  // ไม่มีพอร์ตให้เลือก (ยังโหลดไม่เสร็จ/ไม่มีพอร์ตที่เขียนได้) → ห้ามส่ง Key นี้
  // ไปเปล่าๆ ต้อง Fallback กลับพฤติกรรมเดิมคือให้ Backend Resolve ให้
  test('⭐ ไม่ได้เลือกพอร์ต (null/undefined/ว่าง) → ไม่มี Key "portfolioId" ใน Payload', () => {
    for (const portfolioId of [null, undefined, '']) {
      const payload = buildTransactionPayload({
        type: 'buy',
        symbol: 'BTC',
        amountTotal: '1000',
        portfolioId,
      });
      expect('portfolioId' in payload).toBe(false);
    }
  });

  // Endpoint ปันผลไม่รับ Key นี้ตาม Contract (dividend.service อ่าน asset.portfolioId)
  test('⚠️ ปันผลไม่มี "portfolioId" แม้ Caller จะส่งมาก็ตาม', () => {
    const payload = buildDividendPayload({
      assetId: 'asset-1',
      amountThb: '250',
      quantity: '10',
      portfolioId: 'pf-dime',
    });

    expect('portfolioId' in payload).toBe(false);
  });
});

describe('defaultDestinationPortfolioId — ค่าตั้งต้นของช่อง "บันทึกลงพอร์ต"', () => {
  const MAIN = { id: 'pf-1', name: 'หลัก', isDefault: true, canWrite: true };
  const LOCKED = { id: 'pf-2', name: 'ล็อก', isDefault: false, canWrite: false };
  const DIME = { id: 'pf-3', name: 'Dime', isDefault: false, canWrite: true };
  const ALL = [MAIN, LOCKED, DIME];

  test('Switcher เลือกพอร์ตที่เขียนได้อยู่ → ใช้พอร์ตนั้นเป็นค่าตั้งต้น', () => {
    expect(defaultDestinationPortfolioId(DIME, ALL)).toBe('pf-3');
  });

  // Switcher = "ทั้งหมด" (null) — เคสเริ่มต้นของทุกครั้งที่เปิด /app
  test('⭐ Switcher เป็น "ทั้งหมด" (null) → ตกไปที่พอร์ตหลัก', () => {
    expect(defaultDestinationPortfolioId(null, ALL)).toBe('pf-1');
  });

  // ⚠️ เปิด Modal ค้างที่พอร์ตที่ถูกล็อกได้ (ปุ่ม "บันทึกการขาย" เปิดเสมอ) —
  // ถ้าตั้งพอร์ตนั้นเป็นปลายทาง ผู้ใช้จะเจอ 403 ทันทีที่สลับไปแท็บ "ซื้อ"
  test('⭐ Switcher เลือกพอร์ตที่ถูกล็อก → ห้ามใช้เป็นปลายทาง ตกไปพอร์ตหลักแทน', () => {
    expect(defaultDestinationPortfolioId(LOCKED, ALL)).toBe('pf-1');
  });

  test('ไม่มีพอร์ตหลักที่เขียนได้ → ใช้พอร์ตแรกที่เขียนได้', () => {
    expect(defaultDestinationPortfolioId(null, [LOCKED, DIME])).toBe('pf-3');
  });

  // ไม่มีพอร์ตที่เขียนได้เลย → null = "อย่าส่ง portfolioId ไป Backend"
  test('⭐ ไม่มีพอร์ตที่เขียนได้เลย → null (Caller ต้องไม่ส่ง Key นี้)', () => {
    expect(defaultDestinationPortfolioId(null, [LOCKED])).toBeNull();
    expect(defaultDestinationPortfolioId(null, [])).toBeNull();
    expect(defaultDestinationPortfolioId(null, undefined)).toBeNull();
  });

  // พอร์ตที่เลือกไว้ถูกลบไประหว่างเปิดฟอร์ม → ต้องไม่คืน id ที่ไม่มีอยู่แล้ว
  test('พอร์ตที่ Switcher เลือกไม่อยู่ในรายการแล้ว → ตกไปพอร์ตหลัก', () => {
    const ghost = { id: 'pf-gone', isDefault: false, canWrite: true };
    expect(defaultDestinationPortfolioId(ghost, ALL)).toBe('pf-1');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// ⭐ ค่าธรรมเนียมจากสลิป (Founder 29 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// Backend อ่านมาให้อยู่แล้ว (`slip.feeTotal`) แต่เดิมฟอร์มทิ้งค่านี้ไปเฉยๆ
//
// ── RED-GREEN ────────────────────────────────────────────────────────────
//   • ถอด `feeThb: inputOrNull(slip?.feeTotal)` ออกจาก base → เคส ⭐ แดง
//   • เปลี่ยนเป็น `slip?.feeTotal ?? 0` → เคส "สลิปไม่ระบุ" แดง
describe('⭐ buildSlipPrefill — ค่าธรรมเนียมจากสลิป', () => {
  test('⭐ สลิประบุค่าธรรมเนียม → เติมลงช่อง feeThb ตรงค่า', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, feeTotal: 15.5 });

    expect(prefill.feeThb).toBe('15.5');
  });

  // 🔴 กฎยืนข้อ 11: "ไม่รู้" ต้องไม่ถูกแปลงเป็น 0 เงียบๆ — ผู้ใช้ที่เห็น 0 ในช่อง
  // จะเข้าใจว่าสลิปยืนยันแล้วว่าไม่มีค่าธรรมเนียม ทั้งที่สลิปแค่ไม่ได้ระบุ
  test('⭐ สลิปไม่ระบุ (feeTotal: null) → ต้องเป็น null ห้ามเป็น 0', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, feeTotal: null });

    expect(prefill.feeThb).toBeNull();
    expect(prefill.feeThb).not.toBe('0');
  });

  test('feeTotal เป็น 0 → ถือว่าไม่มีค่าให้เติม (ไม่แตะช่อง)', () => {
    expect(buildSlipPrefill({ ...SLIP_BUY, feeTotal: 0 }).feeThb).toBeNull();
  });

  // ค่าที่เติมมาต้องไหลลง Payload ได้ตามปกติ และผู้ใช้แก้ทับได้ (ค่าที่แก้ต้องชนะ)
  test('⭐ ค่าที่ AI เติม → ส่งลง Payload ได้ · ผู้ใช้แก้ทับแล้วค่าที่แก้ต้องชนะ', () => {
    const prefill = buildSlipPrefill({ ...SLIP_BUY, feeTotal: 15.5 });

    expect(buildTransactionPayload({ type: 'buy', symbol: 'BTC', feeThb: prefill.feeThb }).feeThb).toBe(15.5);
    expect(buildTransactionPayload({ type: 'buy', symbol: 'BTC', feeThb: '9' }).feeThb).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('needsSymbolFetch — Lazy Load รายการสินทรัพย์จาก Registry', () => {
  test('ยังไม่เคยโหลด (null/undefined) → ต้องโหลด', () => {
    expect(needsSymbolFetch(null)).toBe(true);
    expect(needsSymbolFetch(undefined)).toBe(true);
  });

  // ⭐ กดเปิด/ปิด "+ สินทรัพย์ใหม่" หลายรอบต้องไม่ยิงซ้ำ
  test('⭐ โหลดแล้ว → ไม่ยิงซ้ำ (รวมกรณี Registry ว่างจริงๆ)', () => {
    expect(needsSymbolFetch([{ symbol: 'BTC' }])).toBe(false);
    // [] = "โหลดแล้วและว่างจริง" ถ้าคืน true จะยิงซ้ำไม่รู้จบ
    expect(needsSymbolFetch([])).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// ⭐ confirmSeparatePortfolio — คำตอบ "แยก vs รวมพอร์ต" (มติ Founder 29 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// สามสถานะ ไม่ใช่ boolean ธรรมดา:
//   undefined = ยังไม่ได้ถาม → Backend ตอบ 409 ASSET_EXISTS_IN_OTHER_PORTFOLIO
//   true      = แยกเป็นอีกแถวในพอร์ตที่เลือก
//   false     = รวมเข้าพอร์ตเดิม
//
// ── RED-GREEN ────────────────────────────────────────────────────────────
//   • เปลี่ยนเป็น `form.confirmSeparatePortfolio || undefined` → เคส false แดง
describe('⭐ confirmSeparatePortfolio ใน Payload', () => {
  const BASE = { type: 'buy', symbol: 'BTC', amountTotal: '1000' };

  test('ยังไม่ได้ถาม (undefined) → ไม่มี Key นี้ใน Payload', () => {
    expect('confirmSeparatePortfolio' in buildTransactionPayload(BASE)).toBe(false);
  });

  test('⭐ ตอบ "แยกพอร์ต" → ส่ง true', () => {
    const payload = buildTransactionPayload({ ...BASE, confirmSeparatePortfolio: true });
    expect(payload.confirmSeparatePortfolio).toBe(true);
  });

  // 🔴 จุดตายที่สุด: false ต้อง **ไม่** ถูกปัดทิ้งเหมือน Field อื่นในไฟล์นี้
  // ถ้าหายไป Backend จะอ่านว่า "ยังไม่ได้ตอบ" แล้วถามซ้ำไม่รู้จบ
  test('⭐⭐ ตอบ "รวมพอร์ตเดิม" (false) → ต้องส่ง false ไปจริง ห้ามถูกปัดทิ้ง', () => {
    const payload = buildTransactionPayload({ ...BASE, confirmSeparatePortfolio: false });

    expect('confirmSeparatePortfolio' in payload).toBe(true);
    expect(payload.confirmSeparatePortfolio).toBe(false);
  });

  // ค่าผิดชนิดต้องถือว่า "ยังไม่ตอบ" ไม่ใช่ตีความเป็นคำตอบเงียบๆ
  test('ค่าที่ไม่ใช่ boolean → ถือว่ายังไม่ตอบ (ไม่มี Key)', () => {
    for (const v of ['true', 1, null]) {
      expect(
        'confirmSeparatePortfolio' in buildTransactionPayload({ ...BASE, confirmSeparatePortfolio: v })
      ).toBe(false);
    }
  });

  // ⚠️ ปันผลไม่มีคอนเซ็ปต์นี้ (ระบุด้วย assetId ซึ่งผูกพอร์ตอยู่แล้ว)
  test('⚠️ ปันผลไม่มี Key นี้แม้ Caller จะส่งมา', () => {
    const payload = buildDividendPayload({
      assetId: 'a1',
      amountThb: '100',
      quantity: '1',
      confirmSeparatePortfolio: true,
    });
    expect('confirmSeparatePortfolio' in payload).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ assetOptionLabel — ป้ายกำกับ Dropdown สินทรัพย์ (Founder ทดสอบ 30 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// บั๊กเดิม: Label เป็น `${symbol} — ${name}` ซึ่ง name === symbol เกือบทุกครั้ง
// → "EOSE — EOSE" ซ้ำกันหลายแถวเมื่อถือ Symbol เดียวกันหลายโบรก แยกไม่ออกว่า
// แถวไหนของโบรกไหน ผู้ใช้เสี่ยงกดขายผิดพอร์ต/ผิดโบรกโดยไม่รู้ตัว
//
// ── RED-GREEN ────────────────────────────────────────────────────────────
//   • เปลี่ยน Label กลับเป็น `${asset.symbol} — ${asset.name}` → ทุกเคสข้างล่างแดง
describe('⭐ assetOptionLabel — ต้องกำกับด้วยชื่อโบรก ไม่ใช่ name ที่มักซ้ำ symbol', () => {
  const BROKERS = [
    { id: 'br-1', name: 'Bitkub' },
    { id: 'br-2', name: 'Binance' },
  ];

  test('⭐ มีโบรก → Label เป็น "symbol — ชื่อโบรก" ไม่ใช่ "symbol — name"', () => {
    const asset = { id: 'a1', symbol: 'EOSE', name: 'EOSE', brokerId: 'br-1' };
    expect(assetOptionLabel(asset, BROKERS)).toBe('EOSE — Bitkub');
    expect(assetOptionLabel(asset, BROKERS)).not.toBe('EOSE — EOSE');
  });

  // ⭐⭐ เคสหลักของบั๊กที่ Founder เจอ — Symbol เดียวกันถืออยู่หลายโบรกในพอร์ต
  // เดียวกัน (migration 046) ต้องเห็น Label แยกกันชัดเจน ไม่ใช่ซ้ำกันเป๊ะ
  test('⭐⭐ Symbol เดียวกัน 2 โบรก → Label ต้องต่างกัน (ไม่ซ้ำกันเป๊ะเหมือนเดิม)', () => {
    const atBitkub = { id: 'a1', symbol: 'EOSE', name: 'EOSE', brokerId: 'br-1' };
    const atBinance = { id: 'a2', symbol: 'EOSE', name: 'EOSE', brokerId: 'br-2' };

    const labelA = assetOptionLabel(atBitkub, BROKERS);
    const labelB = assetOptionLabel(atBinance, BROKERS);

    expect(labelA).toBe('EOSE — Bitkub');
    expect(labelB).toBe('EOSE — Binance');
    expect(labelA).not.toBe(labelB);
  });

  test('ไม่มีโบรก (brokerId เป็น null) → "ไม่ระบุ" ไม่ใช่ name ที่ซ้ำ symbol', () => {
    const asset = { id: 'a1', symbol: 'BTC', name: 'BTC', brokerId: null };
    expect(assetOptionLabel(asset, BROKERS)).toBe('BTC — ไม่ระบุ');
  });

  // brokerId ชี้ไปโบรกที่ไม่มีในรายการ (ถูกลบไปแล้ว) — ต้องไม่ Throw หรือโชว์ undefined
  test('⚠️ brokerId ที่หาชื่อไม่เจอ (โบรกถูกลบไปแล้ว) → "ไม่ระบุ" ไม่ใช่ undefined/Throw', () => {
    const asset = { id: 'a1', symbol: 'BTC', name: 'BTC', brokerId: 'br-deleted' };
    expect(() => assetOptionLabel(asset, BROKERS)).not.toThrow();
    expect(assetOptionLabel(asset, BROKERS)).toBe('BTC — ไม่ระบุ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ assetListParams — กรอง Dropdown ตามพอร์ตที่กำลังเปิดดูอยู่ (งานที่ 1)
// ═══════════════════════════════════════════════════════════════════════════
// ── RED-GREEN ────────────────────────────────────────────────────────────
//   • เปลี่ยนเป็น `return { portfolioId: scopePortfolioId }` เสมอ → เคส Topbar แดง
describe('⭐ assetListParams — เปิดจากพอร์ตเจาะจง vs Topbar ที่ไม่ผูกพอร์ต', () => {
  test('⭐ เปิดจากหน้ารายละเอียดพอร์ต (มี scopePortfolioId) → กรองตามพอร์ตนั้น', () => {
    expect(assetListParams('pf-weblue')).toEqual({ portfolioId: 'pf-weblue' });
  });

  // ⭐⭐ Regression กันพัง Use Case เดิม — Topbar "+ บันทึกรายการ" ที่ Switcher
  // เป็น "ทั้งหมด" ต้องยังเห็นสินทรัพย์ทุกพอร์ตเหมือนเดิมทุกประการ
  test('⭐⭐ ไม่มี scopePortfolioId (Topbar, Switcher = ทั้งหมด) → ไม่กรอง (เหมือน listAssets() เดิม)', () => {
    expect(assetListParams(undefined)).toEqual({});
  });

  test('scopePortfolioId เป็น null → ไม่กรองเช่นกัน (ไม่ใช่ค่า id จริง)', () => {
    expect(assetListParams(null)).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ buildTransactionPayload — assetId + sellAll (Founder ทดสอบฟอร์มขาย
// 30 ส.ค. 2569 — ปัญหาที่ 3 และ 4)
// ═══════════════════════════════════════════════════════════════════════════
// ── RED-GREEN ────────────────────────────────────────────────────────────
//   • ลบ `assetId: form.assetId || undefined,` ออก → เคส assetId ทั้งชุดแดง
//   • เปลี่ยน `isSellAll ? undefined : numberOrUndefined(...)` กลับเป็น
//     `numberOrUndefined(...)` เฉยๆ (ไม่เช็ค isSellAll) → เคส "ไม่ส่งจำนวน/ราคา/
//     ยอดเงินตอนขายทั้งหมด" แดง (ยังหลุดค่าเก่าที่ค้างใน State ไปด้วย)
describe('⭐ buildTransactionPayload — assetId (ปัญหาที่ 4: Fast-Path Resolution ฝั่งขาย)', () => {
  const BASE = { type: 'sell', symbol: 'EOSE', quantity: '10', pricePerUnit: '5' };

  test('⭐ รู้ assetId แน่ชัด (เลือกจาก Dropdown) → ส่งไปด้วย', () => {
    const payload = buildTransactionPayload({ ...BASE, assetId: 'asset-eose-a' });
    expect(payload.assetId).toBe('asset-eose-a');
  });

  test('ไม่รู้ assetId (พิมพ์ Symbol ใหม่ที่ยังไม่เคยถือ) → ไม่มี Key นี้เลย', () => {
    const payload = buildTransactionPayload({ ...BASE, assetId: '' });
    expect('assetId' in payload).toBe(false);
  });

  test('assetId เป็น undefined (ไม่ส่งมาเลย) → ไม่มี Key นี้เช่นกัน', () => {
    const payload = buildTransactionPayload(BASE);
    expect('assetId' in payload).toBe(false);
  });
});

describe('⭐ buildTransactionPayload — sellAll (ปัญหาที่ 3: ปุ่ม "ขายทั้งหมด")', () => {
  test('⭐ ขายทั้งหมด (type=sell, sellAll=true) → ส่ง sellAll:true ไม่ส่งจำนวน/ราคา/ยอดเงินเลย', () => {
    const payload = buildTransactionPayload({
      type: 'sell',
      symbol: 'BTC',
      sellAll: true,
      // จำลอง State ที่ยังค้างจากก่อนติ๊กปุ่มนี้ — ต้องถูกตัดทิ้งทั้งหมด
      quantity: '0.5',
      pricePerUnit: '2000000',
      amountTotal: '1000000',
    });

    expect(payload.sellAll).toBe(true);
    expect('quantity' in payload).toBe(false);
    expect('pricePerUnit' in payload).toBe(false);
    expect('amountTotal' in payload).toBe(false);
  });

  // ⚠️ Backend รับเฉพาะ `true` แท้ๆ (Strict Boolean) — ต้องไม่ส่งค่า Truthy อื่น
  test('sellAll = false → ไม่มี Key นี้เลย (ไม่ใช่ส่ง false ไปตรงๆ)', () => {
    const payload = buildTransactionPayload({
      type: 'sell',
      symbol: 'BTC',
      sellAll: false,
      quantity: '1',
      pricePerUnit: '100',
    });

    expect('sellAll' in payload).toBe(false);
    // ไม่ได้ขายทั้งหมด → จำนวน/ราคาต้องยังส่งไปตามปกติ (Regression)
    expect(payload.quantity).toBe(1);
    expect(payload.pricePerUnit).toBe(100);
  });

  // ⭐⭐ Regression สำคัญที่สุด — ซื้อ/ปันผลต้องไม่ได้รับผลกระทบแม้ State sellAll
  // จะเผลอเป็น true ค้างมาจากตอนอยู่โหมดขาย (เช่น ยังไม่ทัน Reset)
  test('⭐⭐ type ไม่ใช่ sell (เช่น buy) แม้ sellAll จะเป็น true ค้างมา → เมินทิ้ง ไม่ส่ง sellAll', () => {
    const payload = buildTransactionPayload({
      type: 'buy',
      symbol: 'BTC',
      sellAll: true,
      amountTotal: '1000',
    });

    expect('sellAll' in payload).toBe(false);
    // ซื้อยังต้องส่งยอดเงินตามปกติ ไม่ถูกตัดทิ้งเพราะ sellAll ค้าง
    expect(payload.amountTotal).toBe(1000);
  });

  test('ไม่ส่ง sellAll มาเลย (Payload เดิม) → พฤติกรรมเดิมทุกประการ', () => {
    const payload = buildTransactionPayload({
      type: 'sell',
      symbol: 'AAPL',
      quantity: '4',
      pricePerUnit: '250',
    });

    expect('sellAll' in payload).toBe(false);
    expect(payload.quantity).toBe(4);
    expect(payload.pricePerUnit).toBe(250);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ sellAllErrorText — ข้อความไทยของ Error จากปุ่ม "ขายทั้งหมด" (ปัญหาที่ 3)
// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ sellAllErrorText', () => {
  test('⭐ NOTHING_TO_SELL → ข้อความไทยอ่านรู้เรื่อง ไม่ใช่โค้ดดิบ', () => {
    expect(sellAllErrorText('NOTHING_TO_SELL')).toBe(
      'สินทรัพย์นี้ขายออกไปหมดแล้ว ไม่มียอดคงเหลือให้ขาย'
    );
  });

  // ⭐⭐ เคสหลักที่ Founder ถามถึง — หุ้นไทยอย่าง EOSE ไม่มี Price Feed
  test('⭐⭐ MARKET_PRICE_UNAVAILABLE → บอกทางออกจริง (กรอกจำนวน/ราคาเอง) ไม่ใช่แค่บอกว่าดึงราคาไม่ได้', () => {
    const text = sellAllErrorText('MARKET_PRICE_UNAVAILABLE');
    expect(text).toContain('กรอกจำนวนหน่วยและราคาที่ขายได้เองแทน');
    expect(text).not.toBe('MARKET_PRICE_UNAVAILABLE');
  });

  test('Code ที่ไม่รู้จัก → คืน null (Caller ต้อง Fallback เอง ไม่ใช่ปั้นข้อความเดา)', () => {
    expect(sellAllErrorText('SOME_OTHER_CODE')).toBeNull();
    expect(sellAllErrorText(undefined)).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ Error จาก Preview (GET /dashboard/profit/:symbol — Founder ทดสอบ UI
  // Confirm 30 ส.ค. 2569) — คนละ Service กับที่บันทึกขายทั้งหมดจริง (profit.
  // service ไม่ใช่ transaction.service) จึงใช้ชื่อ Code คนละชุด แต่ความหมาย
  // ตรงกับ 2 Code ข้างบนเป๊ะ ต้อง Map ให้ผู้ใช้เห็นข้อความเดียวกัน
  // ═══════════════════════════════════════════════════════════════════════
  test('⭐ PRICE_FEED_NOT_IMPLEMENTED (จาก Preview) → ข้อความเดียวกับ MARKET_PRICE_UNAVAILABLE', () => {
    expect(sellAllErrorText('PRICE_FEED_NOT_IMPLEMENTED')).toBe(
      sellAllErrorText('MARKET_PRICE_UNAVAILABLE')
    );
  });

  test('NO_HOLDING_TO_CALCULATE_PROFIT (จาก Preview) → ข้อความเดียวกับ NOTHING_TO_SELL', () => {
    expect(sellAllErrorText('NO_HOLDING_TO_CALCULATE_PROFIT')).toBe(
      sellAllErrorText('NOTHING_TO_SELL')
    );
  });

  test('GOLD_PRICE_UNAVAILABLE → ข้อความอ่านรู้เรื่อง ไม่ใช่โค้ดดิบ', () => {
    const text = sellAllErrorText('GOLD_PRICE_UNAVAILABLE');
    expect(text).toContain('ราคาทองคำ');
    expect(text).not.toBe('GOLD_PRICE_UNAVAILABLE');
  });

  test('ASSET_NOT_FOUND (Preview) → บอกให้เลือกสินทรัพย์ใหม่', () => {
    expect(sellAllErrorText('ASSET_NOT_FOUND')).toContain('เลือกสินทรัพย์');
  });

  // ⚠️ ไม่ควรเกิดจริง (Preview ส่ง brokerId/portfolioId ของสินทรัพย์ที่เลือกไปด้วย
  // เสมอ) แต่ต้องไม่หลุดเป็นโค้ดดิบถ้าเกิดขึ้นจริง (ข้อมูลเปลี่ยนระหว่างเปิดฟอร์ม)
  test('⚠️ AMBIGUOUS_ASSET_BROKER/PORTFOLIO (กันเหนียว) → ไม่หลุดเป็นโค้ดดิบ', () => {
    expect(sellAllErrorText('AMBIGUOUS_ASSET_BROKER')).not.toBe('AMBIGUOUS_ASSET_BROKER');
    expect(sellAllErrorText('AMBIGUOUS_ASSET_PORTFOLIO')).not.toBe('AMBIGUOUS_ASSET_PORTFOLIO');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ buyErrorText — ข้อความไทยของ Error ฝั่ง "ซื้อ" ด้วยยอดรวมอย่างเดียว (บั๊ก
// Founder ทดสอบ 30 ส.ค. 2569: ซื้อเจอ PRICE_FEED_NOT_IMPLEMENTED แล้วโดนบอกให้
// "เลือกขายทั้งหมด" ทั้งที่กำลังซื้อ ปุ่มนั้นไม่มีในโหมดซื้อเลย)
// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ buyErrorText', () => {
  test('⭐⭐ PRICE_FEED_NOT_IMPLEMENTED → บอกให้กรอกจำนวน/ราคาเอง ไม่พูดถึง "ขายทั้งหมด" เลย', () => {
    const text = buyErrorText('PRICE_FEED_NOT_IMPLEMENTED');
    expect(text).toContain('กรอกจำนวนหน่วยและราคาต่อหน่วยเองแทน');
    expect(text).not.toContain('ขายทั้งหมด');
    expect(text).not.toBe('PRICE_FEED_NOT_IMPLEMENTED');
  });

  test('MARKET_PRICE_UNAVAILABLE → ข้อความเดียวกับ PRICE_FEED_NOT_IMPLEMENTED ไม่พูดถึง "ขายทั้งหมด"', () => {
    const text = buyErrorText('MARKET_PRICE_UNAVAILABLE');
    expect(text).toBe(buyErrorText('PRICE_FEED_NOT_IMPLEMENTED'));
    expect(text).not.toContain('ขายทั้งหมด');
  });

  test('GOLD_PRICE_UNAVAILABLE → บอกให้กรอกจำนวน/ราคาเอง ไม่พูดถึง "ขายทั้งหมด"', () => {
    const text = buyErrorText('GOLD_PRICE_UNAVAILABLE');
    expect(text).toContain('ราคาทองคำ');
    expect(text).not.toContain('ขายทั้งหมด');
  });

  test('ASSET_NOT_FOUND / AMBIGUOUS_ASSET_* → ใช้ข้อความ Generic เดียวกับ sellAllErrorText', () => {
    expect(buyErrorText('ASSET_NOT_FOUND')).toBe(sellAllErrorText('ASSET_NOT_FOUND'));
    expect(buyErrorText('AMBIGUOUS_ASSET_BROKER')).toBe(sellAllErrorText('AMBIGUOUS_ASSET_BROKER'));
    expect(buyErrorText('AMBIGUOUS_ASSET_PORTFOLIO')).toBe(sellAllErrorText('AMBIGUOUS_ASSET_PORTFOLIO'));
  });

  test('Code ที่ไม่รู้จัก หรือ Code เฉพาะฝั่งขาย (NOTHING_TO_SELL) → คืน null', () => {
    expect(buyErrorText('SOME_OTHER_CODE')).toBeNull();
    expect(buyErrorText(undefined)).toBeNull();
    expect(buyErrorText('NOTHING_TO_SELL')).toBeNull();
  });
});
