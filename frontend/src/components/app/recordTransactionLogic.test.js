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
