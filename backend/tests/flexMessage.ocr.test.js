// flexMessage.util — Builders สำหรับ AI Slip OCR (Round 9)
const flex = require('../src/utils/flexMessage.util');

function footerDatas(msg) {
  return msg.contents.footer.contents.map((b) => b.action.data);
}
function footerButtonCount(msg) {
  return msg.contents.footer.contents.length;
}

const CONFIRMABLE = {
  symbol: 'BTC',
  side: 'buy',
  quantity: 0.5,
  pricePerUnit: 1500000,
  amountThb: 750000,
  date: '05/07/2026',
  dateIso: '2026-07-05',
  confidence: 'high',
  remainingQuota: 47,
  quotaLimit: 50,
};

describe('buildOcrPreviewMessage', () => {
  test('ข้อมูลครบ (qty+price) → ปุ่ม ยืนยัน + แก้ไข, confirm พก qty/price/date', () => {
    const msg = flex.buildOcrPreviewMessage(CONFIRMABLE);
    expect(footerButtonCount(msg)).toBe(2);
    const datas = footerDatas(msg);
    expect(datas.some((d) => d.startsWith('action=ocr_confirm'))).toBe(true);
    const confirm = datas.find((d) => d.startsWith('action=ocr_confirm'));
    expect(confirm).toContain('sym=BTC');
    expect(confirm).toContain('qty=0.5');
    expect(confirm).toContain('price=1500000');
    expect(confirm).toContain('date=2026-07-05');
    expect(datas.some((d) => d.startsWith('action=ocr_edit'))).toBe(true);
  });

  test('มีแต่ยอดรวม (qty/price null, amountThb) → confirm พก amt แทน', () => {
    const msg = flex.buildOcrPreviewMessage({
      ...CONFIRMABLE,
      quantity: null,
      pricePerUnit: null,
      amountThb: 1000,
    });
    expect(footerButtonCount(msg)).toBe(2);
    const confirm = footerDatas(msg).find((d) => d.startsWith('action=ocr_confirm'));
    expect(confirm).toContain('amt=1000');
    expect(confirm).not.toContain('qty=');
  });

  test('ข้อมูลไม่พอ (qty/price/amount null) → ปุ่ม "แก้ไข" อย่างเดียว ไม่มี ยืนยัน', () => {
    const msg = flex.buildOcrPreviewMessage({
      ...CONFIRMABLE,
      quantity: null,
      pricePerUnit: null,
      amountThb: null,
    });
    expect(footerButtonCount(msg)).toBe(1);
    const datas = footerDatas(msg);
    expect(datas.some((d) => d.startsWith('action=ocr_confirm'))).toBe(false);
    expect(datas.some((d) => d.startsWith('action=ocr_edit'))).toBe(true);
  });

  test('Field อ่านไม่ได้แสดง "อ่านไม่ได้" + มี Disclaimer + โควตาคงเหลือ', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, quantity: null });
    const text = JSON.stringify(msg);
    expect(text).toContain('อ่านไม่ได้');
    expect(text).toContain('ไม่ใช่คำแนะนำการลงทุน');
    expect(text).toContain('47/50');
  });
});

// ── ทิศทางรายการ 3 สถานะ: buy / sell / null (Bug Fix: สลิปขายถูกบันทึกเป็นซื้อ) ──
// เดิมการ์ดใช้ `ocr.side !== 'sell'` ซึ่งยุบ null รวมกับ buy → ขึ้น "🟢 ซื้อ" อย่างมั่นใจ
// ทั้งที่อ่านไม่ชัด ผู้ใช้กดยืนยันแล้วได้ Ledger กลับด้าน (Preview ไม่ได้เป็น Safety Net จริง)
describe('buildOcrPreviewMessage — ทิศทางรายการ (buy/sell/null)', () => {
  test('side=sell → การ์ดแสดง "ขาย" + confirm พก side=sell', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, side: 'sell' });
    const text = JSON.stringify(msg);
    expect(text).toContain('🔴 ขาย BTC');
    expect(text).not.toContain('🟢 ซื้อ BTC');
    const confirm = footerDatas(msg).find((d) => d.startsWith('action=ocr_confirm'));
    expect(confirm).toContain('side=sell');
  });

  test('side=buy → การ์ดแสดง "ซื้อ" + confirm พก side=buy (Regression)', () => {
    const msg = flex.buildOcrPreviewMessage(CONFIRMABLE);
    expect(JSON.stringify(msg)).toContain('🟢 ซื้อ BTC');
    const confirm = footerDatas(msg).find((d) => d.startsWith('action=ocr_confirm'));
    expect(confirm).toContain('side=buy');
  });

  test('side=null → ไม่แสดง "ซื้อ" ลอยๆ แต่เตือนว่าอ่านไม่ชัด', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, side: null });
    const text = JSON.stringify(msg);
    expect(text).not.toContain('🟢 ซื้อ BTC');
    expect(text).toContain('⚠️');
    expect(text).toContain('ระบบอ่านไม่ชัดว่าเป็นรายการ');
  });

  test('side=null → มีปุ่มให้ผู้ใช้เลือก 2 ทาง (ซื้อ/ขาย) แทนปุ่มยืนยันเดียว', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, side: null });
    const confirms = footerDatas(msg).filter((d) => d.startsWith('action=ocr_confirm'));
    expect(confirms).toHaveLength(2);
    expect(confirms.some((d) => d.includes('side=buy'))).toBe(true);
    expect(confirms.some((d) => d.includes('side=sell'))).toBe(true);
    // ต้องไม่มีปุ่มยืนยันที่ไม่ระบุทิศทาง (กันกดพลาดแล้วระบบเดาให้)
    expect(confirms.every((d) => d.includes('side='))).toBe(true);
  });

  test('side=null → ปุ่มแก้ไขไม่พก side ไปเลย (ไม่ Bias เป็นซื้อ)', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, side: null });
    const edit = footerDatas(msg).find((d) => d.startsWith('action=ocr_edit'));
    expect(edit).not.toContain('side=');
  });
});

describe('buildOcrPreviewMessage — Manual Quantity Fallback (Round 10-B)', () => {
  const AMOUNT_ONLY = {
    ...CONFIRMABLE,
    symbol: 'EOSE',
    quantity: null,
    pricePerUnit: null,
    amountThb: 1000,
    currency: 'USD',
  };

  test('Amount-only + ไม่ใช่ Crypto (stock_us) → ปุ่ม "กรอกจำนวนหุ้น" + ข้อความชี้ทาง', () => {
    const msg = flex.buildOcrPreviewMessage({ ...AMOUNT_ONLY, assetType: 'stock_us' });
    const labels = msg.contents.footer.contents.map((b) => b.action.label);
    expect(labels).toContain('✏️ กรอกจำนวนหุ้น');
    // ปุ่มยืนยันเดิมยังอยู่ (ยังทำงานได้ถ้ามี Price Feed)
    expect(footerDatas(msg).some((d) => d.startsWith('action=ocr_confirm'))).toBe(true);
    expect(JSON.stringify(msg)).toContain('กรอกจำนวนหุ้น');
  });

  test('Amount-only + assetType ไม่รู้จัก (undefined) → เสนอ "กรอกจำนวนหุ้น" ไว้ก่อน', () => {
    const msg = flex.buildOcrPreviewMessage({ ...AMOUNT_ONLY, assetType: undefined });
    const labels = msg.contents.footer.contents.map((b) => b.action.label);
    expect(labels).toContain('✏️ กรอกจำนวนหุ้น');
  });

  test('Amount-only + เป็น Crypto → ไม่เสนอ "กรอกจำนวนหุ้น" (มี Price Feed อยู่แล้ว)', () => {
    const msg = flex.buildOcrPreviewMessage({ ...AMOUNT_ONLY, symbol: 'BTC', assetType: 'crypto' });
    const labels = msg.contents.footer.contents.map((b) => b.action.label);
    expect(labels).not.toContain('✏️ กรอกจำนวนหุ้น');
    expect(labels).toContain('✏️ แก้ไข');
  });

  test('มี qty+price (ไม่ใช่ Amount-only) → ไม่เสนอ "กรอกจำนวนหุ้น"', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, assetType: 'crypto' });
    const labels = msg.contents.footer.contents.map((b) => b.action.label);
    expect(labels).not.toContain('✏️ กรอกจำนวนหุ้น');
  });
});

// ── สถานะคำสั่ง: Limit Order ที่ยังไม่จับคู่ ต้องไม่มีปุ่ม "ยืนยันบันทึก" ──────────
// เดิมการ์ดตัดสิน confirmable จาก "ข้อมูลครบหรือไม่" ล้วนๆ — สลิป "รอเวลาทำการ" มี
// symbol+qty+price ครบ (เพราะเป็น Limit Order ที่ระบุราคาไว้แล้ว) จึงขึ้นปุ่มยืนยันทันที
// ทั้งที่คำสั่งอาจไม่มีวันจับคู่ → Ledger มีรายการที่ไม่เคยเกิดขึ้นจริง
describe('buildOcrPreviewMessage — สถานะคำสั่ง (pending/cancelled/filled/null)', () => {
  test('orderStatus=pending → ไม่มีปุ่มยืนยันบันทึก แต่ยังมีทางออกให้บันทึกเอง', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, orderStatus: 'pending' });
    const datas = footerDatas(msg);
    expect(datas.some((d) => d.startsWith('action=ocr_confirm'))).toBe(false);
    // ⚠️ ต้องไม่ถูกบล็อกตาย — ปุ่มแก้ไขคือทางออกเมื่อ AI อ่านสถานะผิด
    expect(datas.some((d) => d.startsWith('action=ocr_edit'))).toBe(true);
    expect(footerButtonCount(msg)).toBe(1);
  });

  test('orderStatus=pending → การ์ดบอกเหตุผลชัดเจนว่ายังไม่จับคู่ + ไม่โชว์ 🟢 ลอยๆ', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, orderStatus: 'pending' });
    const text = JSON.stringify(msg);
    expect(text).toContain('ยังไม่จับคู่');
    expect(text).toContain('ระบบจึงยังไม่บันทึกให้');
    // สีเขียว/ไอคอน 🟢 สื่อว่า "บันทึกได้เลย" ซึ่งขัดกับสิ่งที่การ์ดกำลังบอก
    expect(text).not.toContain('🟢 ซื้อ BTC');
  });

  test('orderStatus=pending → altText (Notification) ต้องไม่สื่อว่าบันทึกแล้ว', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, orderStatus: 'pending' });
    expect(msg.altText).toContain('ยังไม่จับคู่');
  });

  test('orderStatus=cancelled → ไม่มีปุ่มยืนยัน + บอกว่าไม่มีธุรกรรมเกิดขึ้นจริง', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, orderStatus: 'cancelled' });
    expect(footerDatas(msg).some((d) => d.startsWith('action=ocr_confirm'))).toBe(false);
    expect(JSON.stringify(msg)).toContain('ถูกยกเลิก/หมดอายุ');
  });

  test('orderStatus=filled → บันทึกได้ปกติเหมือนเดิม (Regression)', () => {
    const msg = flex.buildOcrPreviewMessage({ ...CONFIRMABLE, orderStatus: 'filled' });
    expect(footerDatas(msg).some((d) => d.startsWith('action=ocr_confirm'))).toBe(true);
    expect(footerButtonCount(msg)).toBe(2);
    expect(JSON.stringify(msg)).toContain('🟢 ซื้อ BTC');
  });

  // ⚠️ Regression ที่สำคัญที่สุด: สลิปทั่วไปส่วนใหญ่ไม่มีช่องสถานะเลย ห้ามถูกบล็อกตามไปด้วย
  test.each([
    ['orderStatus = null', null],
    ['ไม่มี field orderStatus เลย (Postback/Flow เก่า)', undefined],
  ])('%s → บันทึกได้ปกติ ไม่ถูกบล็อก', (_label, status) => {
    const ocr = { ...CONFIRMABLE };
    if (status === null) ocr.orderStatus = null;
    const msg = flex.buildOcrPreviewMessage(ocr);
    expect(footerDatas(msg).some((d) => d.startsWith('action=ocr_confirm'))).toBe(true);
    expect(footerButtonCount(msg)).toBe(2);
    expect(JSON.stringify(msg)).not.toContain('ยังไม่บันทึกให้');
  });

  // สถานะยังไม่จับคู่ต้องชนะทุกเงื่อนไขอื่น — รวมถึงเคสที่ทิศทางอ่านไม่ชัด (ซึ่งปกติจะ
  // แตกเป็นปุ่มยืนยัน 2 ทาง) ต้องไม่มีปุ่มยืนยันหลุดออกมาเลยแม้แต่ปุ่มเดียว
  test('pending + side=null → ต้องไม่มีปุ่มยืนยัน 2 ทางหลุดมา', () => {
    const msg = flex.buildOcrPreviewMessage({
      ...CONFIRMABLE,
      side: null,
      orderStatus: 'pending',
    });
    expect(footerDatas(msg).filter((d) => d.startsWith('action=ocr_confirm'))).toHaveLength(0);
  });

  // คำใบ้ Manual Quantity อ้างถึงปุ่ม "ยืนยันบันทึก" — ห้ามโผล่ตอนที่ปุ่มนั้นไม่มีอยู่จริง
  test('pending + Amount-only → ไม่โชว์คำใบ้ที่อ้างปุ่มยืนยันที่ไม่มีอยู่', () => {
    const msg = flex.buildOcrPreviewMessage({
      ...CONFIRMABLE,
      quantity: null,
      pricePerUnit: null,
      amountThb: 1000,
      assetType: 'stock_us',
      orderStatus: 'pending',
    });
    const text = JSON.stringify(msg);
    // ⚠️ ห้ามค้นด้วยสตริงที่มี " อยู่ข้างใน — JSON.stringify escape เป็น \" ทำให้
    // assertion ไม่มีวัน Match และผ่านตลอดแม้บั๊กยังอยู่ (เจอตอนรัน Red จริง)
    expect(text).not.toContain('แล้วระบบหาราคาตลาดไม่ได้');
    const labels = msg.contents.footer.contents.map((b) => b.action.label);
    expect(labels).toContain('✏️ บันทึกเอง');
  });
});

describe('buildOcrManualQuantityMessage', () => {
  test('แสดง Prefill "จำนวน + ยอดรวม" ให้ Copy + อธิบายการคำนวณราคาต่อหน่วย', () => {
    const msg = flex.buildOcrManualQuantityMessage('ซื้อ EOSE <จำนวนหุ้น> หุ้น รวม 1000 USD');
    const text = JSON.stringify(msg);
    expect(text).toContain('ซื้อ EOSE <จำนวนหุ้น> หุ้น รวม 1000 USD');
    expect(text).toContain('ยอดรวม ÷ จำนวนหุ้น');
  });
});

describe('buildOcrPremiumRequiredMessage', () => {
  test('มีปุ่มอัพเกรด request_payment รายเดือน/รายปี', () => {
    const msg = flex.buildOcrPremiumRequiredMessage();
    const datas = msg.contents.footer.contents.map((b) => b.action.data);
    expect(datas).toContain('action=request_payment&period=monthly');
    expect(datas).toContain('action=request_payment&period=yearly');
  });
});

describe('buildOcrEditPrefillMessage', () => {
  test('แสดงข้อความ Prefill ให้ Copy', () => {
    const msg = flex.buildOcrEditPrefillMessage('ซื้อ BTC 0.5 หุ้น ราคา 1500000');
    expect(JSON.stringify(msg)).toContain('ซื้อ BTC 0.5 หุ้น ราคา 1500000');
  });
});

describe('buildOcrErrorMessage', () => {
  test.each([
    ['OCR_QUOTA_EXCEEDED', 'ครบ 50 ครั้ง'],
    ['OCR_NOT_A_SLIP', 'ไม่พบข้อมูลการซื้อ'],
    ['OCR_MULTIPLE_ITEMS', 'นำเข้าพอร์ต'],
    ['OCR_RATE_LIMITED', 'ถี่เกินไป'],
    ['OCR_FAILED', 'อ่านสลิปไม่สำเร็จ'],
    ['OCR_NOT_CONFIGURED', 'ยังไม่พร้อม'],
  ])('code %s → ข้อความไทยตรงกรณี', (code, expected) => {
    expect(JSON.stringify(flex.buildOcrErrorMessage(code))).toContain(expected);
  });

  test('code ที่ไม่รู้จัก / undefined → Fallback OCR_FAILED', () => {
    expect(JSON.stringify(flex.buildOcrErrorMessage(undefined))).toContain('อ่านสลิปไม่สำเร็จ');
  });
});
