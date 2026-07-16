const {
  buildPreviewMessage,
  buildProfitMessage,
  buildReminderSetMessage,
  buildReminderListMessage,
  buildReminderDeletedMessage,
  buildReminderPushMessage,
  buildPortfolioSummaryPushMessage,
  buildSymbolQuickReply,
  buildFrequencyQuickReply,
  buildDayOfWeekQuickReply,
  buildDayOfMonthQuickReply,
  buildAskAmountMessage,
  buildReminderSetupCancelledMessage,
  buildAddGuideMessage,
} = require('../src/utils/flexMessage.util');

// ดึง data ของทุกปุ่ม Quick Reply ออกมาเป็น Array ของ String
function quickReplyData(message) {
  return message.quickReply.items.map((item) => item.action.data);
}

const CANCEL_DATA = 'action=cancel_reminder_setup';

const BASE_PROFIT = {
  symbol: 'BTC',
  heldQuantity: 0.01,
  averageCost: 3000000,
  totalInvested: 30000,
  currentPrice: 4000000,
  currentValue: 40000,
  profitLoss: 10000,
  profitLossPercent: 33.33,
};

// ดึงเฉพาะ Text ทั้งหมดใน Flex Message มารวมเป็น String เดียว เพื่อค้นหาคำง่ายๆ
function allText(message) {
  return JSON.stringify(message.contents.body.contents);
}

describe('buildAddGuideMessage — คำแนะนำวิธีพิมพ์คำสั่งซื้อ/ขาย (ปุ่ม "เพิ่มรายการ")', () => {
  test('มีตัวอย่างคำสั่งซื้อ/ขายจริงปรากฏอยู่ในเนื้อหา', () => {
    const message = buildAddGuideMessage();
    const text = allText(message);

    expect(text).toContain('ซื้อ BTC 0.01 หุ้น ราคา 3400000');
    expect(text).toContain('ขาย PTT 50 หุ้น ราคา 34');
  });
});

describe('buildProfitMessage — priceSourceNote ตามแหล่งราคาจริง', () => {
  test('priceSource: coingecko (Crypto) → ข้อความพูดถึง CoinGecko (ไม่ Regression)', () => {
    const message = buildProfitMessage({ ...BASE_PROFIT, priceSource: 'coingecko' });

    expect(allText(message)).toContain('CoinGecko');
    expect(allText(message)).not.toContain('Twelve Data');
  });

  test('priceSource: twelvedata (หุ้นสหรัฐ AAPL) → ข้อความพูดถึง Twelve Data ไม่ใช่ CoinGecko', () => {
    const message = buildProfitMessage({
      ...BASE_PROFIT,
      symbol: 'AAPL',
      priceSource: 'twelvedata',
    });

    expect(allText(message)).toContain('Twelve Data');
    expect(allText(message)).not.toContain('CoinGecko');
  });

  test('priceSource: user (ราคาที่ User ระบุเอง) → ไม่มีข้อความอ้างอิงแหล่งราคาใดๆ', () => {
    const message = buildProfitMessage({ ...BASE_PROFIT, priceSource: 'user' });

    expect(allText(message)).not.toContain('CoinGecko');
    expect(allText(message)).not.toContain('Twelve Data');
  });
});

describe('buildReminderSetMessage', () => {
  test('weekly → แสดงชื่อวันไทย + จำนวนเงิน + ย้ำว่าไม่ซื้ออัตโนมัติ', () => {
    const message = buildReminderSetMessage({
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      amountThb: 1000,
    });
    const text = allText(message);

    expect(text).toContain('BTC');
    expect(text).toContain('ทุกวันจันทร์');
    expect(text).toContain('1,000');
    expect(text).toContain('ไม่ได้ซื้อ');
  });

  test('monthly → แสดง "ทุกวันที่ 5"', () => {
    const message = buildReminderSetMessage({
      symbol: 'AAPL',
      frequency: 'monthly',
      dayOfMonth: 5,
      amountThb: 3000,
    });

    expect(allText(message)).toContain('ทุกวันที่ 5');
  });
});

describe('buildReminderListMessage', () => {
  test('ไม่มี Reminder → ข้อความแนะนำให้เริ่มตั้ง', () => {
    const message = buildReminderListMessage([]);
    const text = allText(message);

    expect(text).toContain('ยังไม่มีการตั้งเตือน');
    expect(text).toContain('ตั้งเตือน BTC');
  });

  test('มีหลายรายการ → แสดงครบทั้ง weekly และ monthly', () => {
    const message = buildReminderListMessage([
      { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 3, amountThb: 1000 },
      { symbol: 'AAPL', frequency: 'monthly', dayOfMonth: 5, amountThb: 3000 },
    ]);
    const text = allText(message);

    expect(text).toContain('BTC');
    expect(text).toContain('ทุกวันพุธ');
    expect(text).toContain('AAPL');
    expect(text).toContain('ทุกวันที่ 5');
  });
});

describe('buildReminderDeletedMessage', () => {
  test('ยืนยันปิดเตือน + ระบุว่าประวัติยังอยู่ (Soft-delete)', () => {
    const message = buildReminderDeletedMessage('BTC');
    const text = allText(message);

    expect(text).toContain('BTC');
    expect(text).toContain('ยังถูกเก็บไว้');
  });
});

describe('buildReminderPushMessage — ข้อความ Push ตอน Cron', () => {
  test('เป็น Flex Message (มี altText/contents) เชิญชวนให้พิมพ์คำสั่งซื้อเอง ไม่ซื้ออัตโนมัติ', () => {
    const message = buildReminderPushMessage({
      symbol: 'BTC',
      frequency: 'weekly',
      dayOfWeek: 1,
      amountThb: 1000,
    });

    // โครง Flex ที่ LINE Push API รับได้ (เหมือน Reply)
    expect(message.type).toBe('flex');
    expect(message.altText).toBeTruthy();
    expect(message.contents.type).toBe('bubble');

    const text = allText(message);
    expect(text).toContain('BTC');
    expect(text).toContain('ซื้อ BTC 1,000'); // ตัวอย่างคำสั่งที่ให้ไปพิมพ์เอง
    expect(text).toContain('ไม่ได้ซื้อ');
  });
});

describe('buildPortfolioSummaryPushMessage — สรุปพอร์ตรายสัปดาห์/รายเดือน', () => {
  const BASE_SUMMARY = {
    totalInvestedAllAssets: 30000,
    totalCurrentValue: 40000,
    totalProfitLoss: 10000,
    totalProfitLossPercent: 33.33,
    excludedCount: 0,
    periodLabel: 'weekly',
  };

  test('เป็น Flex Message (มี altText/contents) แสดงเงินลงทุนรวม + มูลค่าปัจจุบัน + กำไร/ขาดทุน', () => {
    const message = buildPortfolioSummaryPushMessage(BASE_SUMMARY);

    expect(message.type).toBe('flex');
    expect(message.altText).toBeTruthy();
    expect(message.contents.type).toBe('bubble');

    const text = allText(message);
    expect(text).toContain('30,000'); // เงินลงทุนรวมทั้งพอร์ต
    expect(text).toContain('40,000'); // มูลค่าปัจจุบันรวม
    expect(text).toContain('+10,000'); // กำไรรวม
    expect(text).toContain('33.33');
  });

  test('weekly → Header "ประจำสัปดาห์", monthly → Header "ประจำเดือน"', () => {
    expect(allText(buildPortfolioSummaryPushMessage(BASE_SUMMARY))).toBeTruthy();
    expect(buildPortfolioSummaryPushMessage(BASE_SUMMARY).altText).toContain('ประจำสัปดาห์');
    expect(
      buildPortfolioSummaryPushMessage({ ...BASE_SUMMARY, periodLabel: 'monthly' }).altText
    ).toContain('ประจำเดือน');
  });

  test('ขาดทุน → เครื่องหมายลบ + สีแดง (loss)', () => {
    const message = buildPortfolioSummaryPushMessage({
      ...BASE_SUMMARY,
      totalCurrentValue: 25000,
      totalProfitLoss: -5000,
      totalProfitLossPercent: -16.67,
    });
    const text = allText(message);

    expect(text).toContain('-5,000');
    expect(text).toContain('16.67');
    // สีแดงตาม Design System (UI_UX.md § 1.1)
    expect(text).toContain('#DC2626');
  });

  test('percent เป็น null (พอร์ตไม่มีราคาเลย) → ข้ามการแสดง % ไม่ Error', () => {
    const message = buildPortfolioSummaryPushMessage({
      totalInvestedAllAssets: 2900,
      totalCurrentValue: 0,
      totalProfitLoss: 0,
      totalProfitLossPercent: null,
      excludedCount: 2,
      periodLabel: 'weekly',
    });
    const text = allText(message);

    // ไม่มีวงเล็บ % ในบรรทัดกำไร/ขาดทุน
    expect(text).not.toContain('%');
    expect(text).toContain('กำไร/ขาดทุนรวม');
  });

  test('excludedCount > 0 → มีข้อความบอกว่าไม่รวม N สินทรัพย์ที่ยังไม่มีราคาตลาด', () => {
    const message = buildPortfolioSummaryPushMessage({ ...BASE_SUMMARY, excludedCount: 3 });
    const text = allText(message);

    expect(text).toContain('ไม่รวม 3 สินทรัพย์');
    expect(text).toContain('หุ้นไทย');
  });

  test('excludedCount = 0 → ไม่มีข้อความเตือนเรื่องสินทรัพย์ที่ถูกข้าม', () => {
    const message = buildPortfolioSummaryPushMessage({ ...BASE_SUMMARY, excludedCount: 0 });

    expect(allText(message)).not.toContain('ไม่รวม');
  });
});

describe('Reminder Setup Quick Reply — ทุกข้อความต้องแนบปุ่มยกเลิก', () => {
  test('buildSymbolQuickReply → ปุ่มรายสัญลักษณ์ + ปุ่มยกเลิกท้ายสุด', () => {
    const message = buildSymbolQuickReply(['BTC', 'ETH']);

    expect(message.type).toBe('text');
    const data = quickReplyData(message);
    expect(data).toContain('action=reminder_symbol&symbol=BTC');
    expect(data).toContain('action=reminder_symbol&symbol=ETH');
    // ปุ่มยกเลิกต้องเป็นอันสุดท้ายเสมอ
    expect(data[data.length - 1]).toBe(CANCEL_DATA);
  });

  test('buildSymbolQuickReply → จำกัดไม่เกิน 12 Symbol (LINE 13 items รวมยกเลิก)', () => {
    const many = Array.from({ length: 20 }, (_, i) => `SYM${i}`);
    const message = buildSymbolQuickReply(many);

    // 12 symbol + 1 cancel = 13
    expect(message.quickReply.items).toHaveLength(13);
    expect(quickReplyData(message)[12]).toBe(CANCEL_DATA);
  });

  test('buildFrequencyQuickReply → weekly/monthly + ยกเลิก', () => {
    const data = quickReplyData(buildFrequencyQuickReply());
    expect(data).toContain('action=reminder_freq&frequency=weekly');
    expect(data).toContain('action=reminder_freq&frequency=monthly');
    expect(data).toContain(CANCEL_DATA);
  });

  test('buildDayOfWeekQuickReply → ครบ 7 วัน (dayOfWeek 0-6) + ยกเลิก', () => {
    const message = buildDayOfWeekQuickReply();
    const data = quickReplyData(message);

    for (let dow = 0; dow <= 6; dow++) {
      expect(data).toContain(`action=reminder_day&dayOfWeek=${dow}`);
    }
    expect(message.quickReply.items).toHaveLength(8); // 7 วัน + ยกเลิก
    expect(data[data.length - 1]).toBe(CANCEL_DATA);
  });

  test('buildDayOfMonthQuickReply → ปุ่มวันยอดนิยม + คำแนะนำให้พิมพ์เอง + ยกเลิก', () => {
    const message = buildDayOfMonthQuickReply();
    const data = quickReplyData(message);

    expect(data).toContain('action=reminder_day&dayOfMonth=1');
    expect(data).toContain('action=reminder_day&dayOfMonth=25');
    expect(message.text).toContain('พิมพ์ตัวเลข'); // แนะนำพิมพ์วันอื่นเองได้
    expect(data).toContain(CANCEL_DATA);
  });

  test('buildAskAmountMessage → Text ธรรมดา (ไม่มีปุ่มจำนวนเงิน) มีแค่ปุ่มยกเลิก', () => {
    const message = buildAskAmountMessage('BTC');

    expect(message.type).toBe('text');
    expect(message.text).toContain('BTC');
    expect(message.text).toContain('1000'); // ตัวอย่าง
    // มีแต่ปุ่มยกเลิกปุ่มเดียว
    expect(message.quickReply.items).toHaveLength(1);
    expect(message.quickReply.items[0].action.data).toBe(CANCEL_DATA);
  });

  test('buildReminderSetupCancelledMessage → ยืนยันยกเลิก + แนะนำเริ่มใหม่', () => {
    const message = buildReminderSetupCancelledMessage();
    const text = allText(message);
    expect(text).toContain('ยกเลิก');
    expect(text).toContain('ตั้งเตือน DCA');
  });
});

// ── Round 10: Preview สกุล USD เก็บ "ตามจริง" — โชว์ USD เป็นหลัก + ยอดเทียบบาท ────
describe('buildPreviewMessage — สกุลเงิน USD (Native)', () => {
  const baseUsdPending = {
    id: 'pending-usd-1',
    commandType: 'buy',
    assetSymbol: 'MSFT',
    quantity: 2,
    pricePerUnit: 300, // USD ตามจริง (ไม่แปลง)
    amountThb: 600, // ยอดรวมเป็น USD (ชื่อ Key คงเดิม)
    currency: 'USD',
    priceSource: 'user',
    // fx = ยอดเทียบบาทเพื่อแสดงผลเท่านั้น (600 USD × 35 = 21000)
    fx: { rate: 35, asOf: '2026-07-11', stale: false, amountThb: 21000, pricePerUnitThb: 10500 },
  };

  test('สกุล USD → แสดงราคา/ยอดเป็น USD ตามจริง + ยอดเทียบบาท + เรต/วันที่', () => {
    const text = JSON.stringify(buildPreviewMessage(baseUsdPending));

    // ราคา/ยอดเป็น USD ตามจริง (ไม่แปลงตอนบันทึก)
    expect(text).toContain('300 USD');
    expect(text).toContain('600 USD');
    // ยอดเทียบบาท + เรต + วันที่อ้างอิง
    expect(text).toContain('≈ 21,000 บาท');
    expect(text).toContain('1 USD = 35 บาท');
    expect(text).toContain('2026-07-11');
    // ต้องไม่มีคำว่า "แปลงแล้ว" อีก (ไม่แปลงตอนบันทึกแล้ว)
    expect(text).not.toContain('แปลงแล้ว');
  });

  test('สกุล USD แต่ดึงเรตไม่ได้ (fx=null) → ยังโชว์ USD ได้ + หมายเหตุว่าตีบาทไม่ได้', () => {
    const text = JSON.stringify(buildPreviewMessage({ ...baseUsdPending, fx: null }));

    expect(text).toContain('600 USD');
    expect(text).toContain('ยังตีเป็นบาทไม่ได้');
  });

  test('THB ปกติ (ไม่มี currency) → ไม่โชว์บรรทัด USD/เรต (Path เดิมไม่กระทบ)', () => {
    const thbPending = {
      id: 'pending-thb-1',
      commandType: 'sell',
      assetSymbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
      amountThb: 1700,
      priceSource: 'user',
      fx: null,
    };
    const text = JSON.stringify(buildPreviewMessage(thbPending));

    expect(text).not.toContain('USD');
    expect(text).not.toContain('อัตราแลกเปลี่ยน');
    expect(text).toContain('1,700 บาท');
  });
});

describe('buildSlipReceivedMessage + Admin message แนบสลิป (Round 5)', () => {
  const {
    buildSlipReceivedMessage,
    buildAdminPaymentRequestMessage,
  } = require('../src/utils/flexMessage.util');

  test('buildSlipReceivedMessage → ยืนยัน "ได้รับสลิป" + รอ Admin ตรวจสอบ', () => {
    const text = JSON.stringify(buildSlipReceivedMessage());
    expect(text).toContain('ได้รับ');
    expect(text).toContain('รอ Admin');
  });

  test('Admin message: มี slipImageUrl → แนบรูปเป็น hero พร้อม action เปิด URL เต็ม + มีรูป QR ใน body', () => {
    const msg = buildAdminPaymentRequestMessage(
      { id: 'pay-1', amountThb: 59.17, billingPeriod: 'monthly', slipImageUrl: 'https://cdn.test/slip.jpg' },
      'สมชาย',
      'https://api.test/api/v1/payment/pay-1/qr.png'
    );

    expect(msg.contents.hero).toBeDefined();
    expect(msg.contents.hero.url).toBe('https://cdn.test/slip.jpg');
    expect(msg.contents.hero.action.uri).toBe('https://cdn.test/slip.jpg');
    // ปุ่มอนุมัติ/ปฏิเสธเดิมยังอยู่ครบ
    const text = JSON.stringify(msg);
    expect(text).toContain('action=approve_payment&paymentId=pay-1');
    expect(text).toContain('action=reject_payment&paymentId=pay-1');
    // migration 016 — รูป QR (Deterministic จาก paymentId) แนบอยู่ใน body คู่กับสลิป
    expect(text).toContain('https://api.test/api/v1/payment/pay-1/qr.png');
  });

  test('Admin message: ไม่มี slipImageUrl → ไม่มี hero (Flow เดิมไม่พัง) แต่ยังมีรูป QR เสมอ', () => {
    const msg = buildAdminPaymentRequestMessage(
      { id: 'pay-1', amountThb: 59.17, billingPeriod: 'monthly' },
      'สมชาย',
      'https://api.test/api/v1/payment/pay-1/qr.png'
    );

    expect(msg.contents.hero).toBeUndefined();
    const text = JSON.stringify(msg);
    expect(text).toContain('action=approve_payment&paymentId=pay-1');
    // QR ไม่ผูกกับสลิป — คำขอ pending ทุกอันมี QR ที่ Render ได้แน่นอน
    expect(text).toContain('https://api.test/api/v1/payment/pay-1/qr.png');
  });
});

describe('Bulk Import Flex Builders (Phase 3 Round 6)', () => {
  const {
    buildBulkImportInstructionsMessage,
    buildBulkImportEmptyMessage,
    buildBulkImportRejectedMessage,
    buildBulkImportPreviewMessage,
    buildBulkImportConfirmedMessage,
  } = require('../src/utils/flexMessage.util');

  test('buildBulkImportInstructionsMessage → มี Format + ตัวอย่างครบ', () => {
    const text = JSON.stringify(buildBulkImportInstructionsMessage());
    expect(text).toContain('BTC 0.5 ต้นทุน 1500000');
    expect(text).toContain('วันที่ 01/03/2569');
    expect(text).toContain('MSFT 3 ต้นทุน 300 USD');
  });

  test('buildBulkImportEmptyMessage → แจ้งไม่พบรายการ', () => {
    const text = JSON.stringify(buildBulkImportEmptyMessage());
    expect(text).toContain('ไม่พบรายการ');
  });

  test('buildBulkImportRejectedMessage → แสดงทุกบรรทัดที่ผิด (Parse-level: reason พร้อมใช้)', () => {
    const msg = buildBulkImportRejectedMessage([
      { line: 2, reason: 'รูปแบบไม่ถูกต้อง (ตัวอย่าง: BTC 0.5 ต้นทุน 1500000)' },
      { line: 5, reason: 'วันที่ไม่ถูกต้อง (32/13/2569)' },
    ]);
    const text = JSON.stringify(msg);

    expect(text).toContain('บรรทัด 2');
    expect(text).toContain('รูปแบบไม่ถูกต้อง');
    expect(text).toContain('บรรทัด 5');
    expect(text).toContain('วันที่ไม่ถูกต้อง');
  });

  test('buildBulkImportRejectedMessage → Business-level (code) แปลผ่าน ERROR_MESSAGES', () => {
    const msg = buildBulkImportRejectedMessage([
      { line: 3, symbol: 'AAAA', code: 'VALIDATION_ERROR' },
    ]);
    const text = JSON.stringify(msg);

    expect(text).toContain('บรรทัด 3');
    expect(text).toContain('AAAA');
    expect(text).toContain('ไม่รู้จักสินทรัพย์นี้');
  });

  test('buildBulkImportRejectedMessage → Aggregate Asset Limit (line:null) ไม่มี "บรรทัด" นำหน้า', () => {
    const msg = buildBulkImportRejectedMessage([{ line: null, code: 'ASSET_LIMIT_REACHED' }]);
    const text = JSON.stringify(msg);

    expect(text).not.toContain('บรรทัด null');
    expect(text).toContain('Free');
  });

  test('buildBulkImportPreviewMessage → ตารางรายการ + ยอดรวม + ปุ่ม Postback พก batchId', () => {
    const msg = buildBulkImportPreviewMessage({
      batchId: 'batch-1',
      items: [
        { assetSymbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000, txnDate: '2026-07-10' },
        { assetSymbol: 'ETH', quantity: 2, pricePerUnit: 80000, amountThb: 160000, txnDate: '2026-03-01' },
      ],
    });
    const text = JSON.stringify(msg);

    expect(text).toContain('BTC');
    expect(text).toContain('ETH');
    // ยอดรวม (บาท) คำนวณจากรายการจริง = 750,000 + 160,000 = 910,000 (ไม่พึ่ง field
    // totalAmountThb ที่ส่งมา เพื่อรองรับการแยกยอดตามสกุลเงิน Round 10)
    expect(text).toContain('รวม (บาท): 910,000 บาท');
    expect(text).toContain('action=confirm_bulk_import&batchId=batch-1');
    expect(text).toContain('action=cancel_bulk_import&batchId=batch-1');
    // Regression Guard: ไม่มี Item ไหนมี fx (Batch เป็น THB ล้วน) → ต้องไม่มี
    // ข้อความ USD/เรตหลุดมาปนโดยไม่ตั้งใจ
    expect(text).not.toContain('USD');
    expect(text).not.toContain('อัตราแลกเปลี่ยน');
    expect(text).not.toContain('ราคาที่พิมพ์');
  });

  test('buildBulkImportPreviewMessage → Item สกุล USD (Native) โชว์ยอด USD ตามจริง + ยอดเทียบบาท', () => {
    const msg = buildBulkImportPreviewMessage({
      batchId: 'batch-2',
      items: [
        {
          assetSymbol: 'MSFT',
          quantity: 3,
          pricePerUnit: 300, // USD ตามจริง
          amountThb: 900, // USD ตามจริง
          currency: 'USD',
          txnDate: '2026-07-10',
          fx: { rate: 35, asOf: '2026-07-11', stale: false, amountThb: 31500, pricePerUnitThb: 10500 },
        },
      ],
    });
    const text = JSON.stringify(msg);

    // แสดง USD ตามจริง (@ 300 USD, มูลค่า 900 USD) + ยอดรวมสกุล USD
    expect(text).toContain('300 USD');
    expect(text).toContain('900 USD');
    expect(text).toContain('รวม (USD): 900 USD');
    // ยอดเทียบบาท (จาก fx) + เรต
    expect(text).toContain('≈ 31,500 บาท');
    expect(text).toContain('1 USD = 35 บาท');
  });

  test('buildBulkImportPreviewMessage → Batch ปนกัน (USD + THB) แยกยอดรวมตามสกุล ไม่ถัวข้ามสกุล', () => {
    const msg = buildBulkImportPreviewMessage({
      batchId: 'batch-3',
      items: [
        { assetSymbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000, currency: 'THB', txnDate: '2026-07-10' },
        {
          assetSymbol: 'MSFT',
          quantity: 3,
          pricePerUnit: 300,
          amountThb: 900,
          currency: 'USD',
          txnDate: '2026-07-10',
          fx: { rate: 35, asOf: '2026-07-11', stale: false, amountThb: 31500, pricePerUnitThb: 10500 },
        },
      ],
    });
    const text = JSON.stringify(msg);

    // BTC (THB) ต้องไม่มีบรรทัด USD ติดมาด้วย
    const btcIndex = text.indexOf('BTC');
    const msftIndex = text.indexOf('MSFT');
    const btcSection = text.slice(btcIndex, msftIndex);
    expect(btcSection).not.toContain('USD');

    // MSFT (USD) ต้องมียอด USD ตามจริง + เรต
    const msftSection = text.slice(msftIndex);
    expect(msftSection).toContain('300 USD');
    expect(msftSection).toContain('1 USD = 35 บาท');

    // ยอดรวมแยกสกุล: 750,000 บาท และ 900 USD (ไม่รวมเป็นก้อนเดียว)
    expect(text).toContain('รวม (บาท): 750,000 บาท');
    expect(text).toContain('รวม (USD): 900 USD');
  });

  test('buildBulkImportConfirmedMessage → ทุกรายการสำเร็จ (ไม่มี failed)', () => {
    const msg = buildBulkImportConfirmedMessage({ total: 2, succeeded: [{}, {}], failed: [] });
    const text = JSON.stringify(msg);

    expect(text).toContain('2/2');
    expect(text).toContain('สำเร็จ');
    expect(text).not.toContain('ไม่สำเร็จ');
  });

  test('buildBulkImportConfirmedMessage → สำเร็จบางส่วน แสดงรายการที่ล้มเหลวพร้อมเหตุผล', () => {
    const msg = buildBulkImportConfirmedMessage({
      total: 3,
      succeeded: [{}, {}],
      failed: [{ symbol: 'BTC', code: 'INSUFFICIENT_QUANTITY' }],
    });
    const text = JSON.stringify(msg);

    expect(text).toContain('2/3');
    expect(text).toContain('สำเร็จบางส่วน');
    expect(text).toContain('BTC');
    expect(text).toContain('มากกว่าที่คุณถือครองอยู่');
  });
});

describe('ทองคำ (Phase 3 Round 7) — แสดงราคา THB + USD', () => {
  const {
    buildProfitMessage,
    buildPreviewMessage,
    buildErrorMessage,
  } = require('../src/utils/flexMessage.util');

  test('buildErrorMessage(GOLD_PRICE_UNAVAILABLE) → ข้อความไทยเรื่องราคาทอง (ไม่โชว์ Code ดิบ)', () => {
    const text = JSON.stringify(buildErrorMessage('GOLD_PRICE_UNAVAILABLE'));
    expect(text).toContain('ราคาทองคำ');
    expect(text).not.toContain('GOLD_PRICE_UNAVAILABLE');
  });

  test('buildProfitMessage ทอง (priceSource thaigold + usd) → โชว์ทั้ง THB และ USD + หมายเหตุแหล่งราคา', () => {
    const msg = buildProfitMessage({
      symbol: 'GOLD',
      heldQuantity: 2,
      averageCost: 70000,
      totalInvested: 140000,
      currentPrice: 70950,
      currentValue: 141900,
      profitLoss: 1900,
      profitLossPercent: 1.36,
      priceSource: 'thaigold',
      usd: { usdThbRate: 35, currentPriceUsd: 2027.14, currentValueUsd: 4054.29 },
    });
    const text = JSON.stringify(msg);

    // THB เดิมยังอยู่
    expect(text).toContain('70,950');
    expect(text).toContain('141,900');
    // USD คู่กัน
    expect(text).toContain('2,027.14 USD/บาททองคำ');
    expect(text).toContain('1 USD = 35 บาท');
    expect(text).toContain('4,054.29 USD');
    // หมายเหตุแหล่งราคาทอง
    expect(text).toContain('สมาคมค้าทองคำ');
  });

  test('buildProfitMessage ทองแต่ usd = null (ดึงเรตไม่ได้) → โชว์ THB อย่างเดียว ไม่มีบรรทัด USD', () => {
    const msg = buildProfitMessage({
      symbol: 'GOLD',
      heldQuantity: 1,
      averageCost: 70000,
      totalInvested: 70000,
      currentPrice: 70950,
      currentValue: 70950,
      profitLoss: 950,
      profitLossPercent: 1.36,
      priceSource: 'thaigold',
      usd: null,
    });
    const text = JSON.stringify(msg);

    expect(text).toContain('70,950');
    expect(text).not.toContain('USD');
  });

  test('buildPreviewMessage ทอง (goldUsd) → โชว์ราคาต้นทุน USD อ้างอิงคู่กับ THB', () => {
    const msg = buildPreviewMessage({
      id: 'pending-gold',
      commandType: 'buy',
      assetSymbol: 'GOLD',
      quantity: 1,
      pricePerUnit: 71150,
      amountThb: 71150,
      priceSource: 'thaigold',
      fx: null,
      goldUsd: { usdThbRate: 35, pricePerUnitUsd: 2032.86 },
    });
    const text = JSON.stringify(msg);

    expect(text).toContain('71,150'); // THB
    expect(text).toContain('2,032.86 USD/บาททองคำ'); // USD อ้างอิง
    expect(text).toContain('1 USD = 35 บาท');
  });

  test('buildPreviewMessage สินทรัพย์ปกติ (ไม่มี goldUsd) → ไม่มีบรรทัด USD/บาททองคำ (ไม่ Regression)', () => {
    const msg = buildPreviewMessage({
      id: 'pending-ptt',
      commandType: 'buy',
      assetSymbol: 'PTT',
      quantity: 50,
      pricePerUnit: 34,
      amountThb: 1700,
      priceSource: 'user',
      fx: null,
    });
    const text = JSON.stringify(msg);

    expect(text).toContain('1,700');
    expect(text).not.toContain('บาททองคำ');
  });
});

describe('กองทุนรวมไทย (Round 7) — Class Picker + Fund Display', () => {
  const {
    buildFundClassPickerMessage,
    buildFundNotFoundMessage,
    buildPreviewMessage,
    buildProfitMessage,
    buildErrorMessage,
  } = require('../src/utils/flexMessage.util');

  const PROJECT = {
    projId: 'M0001',
    projAbbrName: 'K-SELECT',
    classes: [
      { fundClassName: 'K-SELECT-A(A)', fundClassDetail: 'ชนิดสะสมมูลค่า' },
      { fundClassName: 'K-SELECT-A(D)', fundClassDetail: 'ชนิดจ่ายปันผล' },
      { fundClassName: 'K-SELECT-C(A)', fundClassDetail: 'ชนิดผู้ลงทุนสถาบัน' },
    ],
  };

  test('(b) Class Picker → มีปุ่มครบทุก Class + fund_class_detail + ปุ่ม "ไม่แน่ใจ" ท้ายสุด', () => {
    const msg = buildFundClassPickerMessage(PROJECT, { amountThb: 5000 });

    // ข้อความแสดง detail ประกอบ
    expect(msg.text).toContain('K-SELECT-A(A)');
    expect(msg.text).toContain('ชนิดสะสมมูลค่า');

    const items = msg.quickReply.items;
    // 3 Class + 1 ปุ่มไม่แน่ใจ = 4 items
    expect(items).toHaveLength(4);
    // ปุ่มสุดท้ายคือ "ไม่แน่ใจ" → action fund_buy_auto
    const last = items[items.length - 1];
    expect(last.action.label).toContain('ไม่แน่ใจ');
    expect(last.action.data).toContain('action=fund_buy_auto');
    expect(last.action.data).toContain('projId=M0001');
    // ปุ่ม Class พก projId + class + ยอด (amt) — encode "(A)" ปลอดภัย
    expect(items[0].action.data).toContain('action=fund_buy');
    expect(items[0].action.data).toContain('projId=M0001');
    expect(items[0].action.data).toContain('amt=5000');
    // class ถูก encode (มี ( ) ) → ถอดกลับได้เป็น K-SELECT-A(A)
    const params = new URLSearchParams(items[0].action.data);
    expect(params.get('class')).toBe('K-SELECT-A(A)');
  });

  test('Class Picker กับคำสั่งพิมพ์จำนวน+ราคา → Postback พก qty+price', () => {
    const msg = buildFundClassPickerMessage(PROJECT, { quantity: 100, pricePerUnit: 12.34 });
    const params = new URLSearchParams(msg.quickReply.items[0].action.data);
    expect(params.get('qty')).toBe('100');
    expect(params.get('price')).toBe('12.34');
    expect(params.get('amt')).toBeNull();
  });

  test('(g) buildFundNotFoundMessage → แจ้งไม่พบ + แนะนำตรวจสอบชื่อย่อ', () => {
    const text = JSON.stringify(buildFundNotFoundMessage('XXX'));
    expect(text).toContain('ไม่พบกองทุน');
    expect(text).toContain('XXX');
  });

  test('buildPreviewMessage กองทุน → แสดงชนิดหน่วยลงทุน (Class) ไม่ใช่แค่ชื่อย่อ', () => {
    const text = JSON.stringify(
      buildPreviewMessage({
        id: 'p1', commandType: 'buy', assetSymbol: 'K-SELECT',
        fundClassName: 'K-SELECT-A(A)',
        quantity: 100, pricePerUnit: 12.5, amountThb: 1250,
        priceSource: 'secnav', fx: null,
      })
    );
    expect(text).toContain('ชนิดหน่วยลงทุน: K-SELECT-A(A)');
    // priceSourceNote secnav
    expect(text).toContain('ก.ล.ต.');
  });

  test('buildProfitMessage กองทุน → แสดง Class + note NAV จาก ก.ล.ต.', () => {
    const text = JSON.stringify(
      buildProfitMessage({
        symbol: 'K-SELECT', fundClassName: 'K-SELECT-A(A)', navDate: '2024-11-22',
        heldQuantity: 100, averageCost: 10, totalInvested: 1000,
        currentPrice: 12.5, currentValue: 1250, profitLoss: 250, profitLossPercent: 25,
        priceSource: 'secnav', usd: null,
      })
    );
    expect(text).toContain('K-SELECT-A(A)');
    expect(text).toContain('ก.ล.ต.');
  });

  test('buildErrorMessage(MUTUAL_FUND_NAV_UNAVAILABLE / SEC_NOT_CONFIGURED) → ข้อความไทย ไม่โชว์ Code', () => {
    const t1 = JSON.stringify(buildErrorMessage('MUTUAL_FUND_NAV_UNAVAILABLE'));
    expect(t1).toContain('NAV');
    expect(t1).not.toContain('MUTUAL_FUND_NAV_UNAVAILABLE');
    const t2 = JSON.stringify(buildErrorMessage('SEC_NOT_CONFIGURED'));
    expect(t2).toContain('กองทุนรวมยังไม่พร้อม');
    expect(t2).not.toContain('SEC_NOT_CONFIGURED');
  });

  test('สินทรัพย์ปกติ (ไม่มี fundClassName) → Preview ไม่มีบรรทัด "ชนิดหน่วยลงทุน" (ไม่ Regression)', () => {
    const text = JSON.stringify(
      buildPreviewMessage({
        id: 'p1', commandType: 'buy', assetSymbol: 'PTT',
        quantity: 50, pricePerUnit: 34, amountThb: 1700, priceSource: 'user', fx: null,
      })
    );
    expect(text).not.toContain('ชนิดหน่วยลงทุน');
  });
});
