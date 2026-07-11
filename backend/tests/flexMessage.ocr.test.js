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
