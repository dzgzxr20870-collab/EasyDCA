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

// ── Round 2: Preview คำสั่งราคา USD ต้องโชว์ทั้งยอด USD และ THB ที่แปลงแล้ว ──────
describe('buildPreviewMessage — ราคาเป็น USD', () => {
  const baseUsdPending = {
    id: 'pending-usd-1',
    commandType: 'buy',
    assetSymbol: 'MSFT',
    quantity: 2,
    pricePerUnit: 10500, // THB (แปลงแล้ว)
    amountThb: 21000, // THB (ที่จะบันทึกจริง)
    priceSource: 'user',
    fx: { currency: 'USD', rate: 35, pricePerUnitOriginal: 300, amountOriginal: 600 },
  };

  test('มี fx (USD) → แสดงราคา USD ที่พิมพ์ + เรต + ยอด THB ที่แปลงแล้ว', () => {
    const text = JSON.stringify(buildPreviewMessage(baseUsdPending));

    // ยอด USD ที่ผู้ใช้พิมพ์ตรงๆ
    expect(text).toContain('300 USD');
    expect(text).toContain('600 USD');
    // FX Rate ที่ใช้ตอนนั้น
    expect(text).toContain('1 USD = 35 บาท');
    // ยอด THB ที่แปลงแล้ว (ที่จะบันทึกจริง)
    expect(text).toContain('21,000 บาท');
    expect(text).toContain('แปลงแล้ว');
  });

  test('ไม่มี fx (คำสั่ง THB ปกติ) → ไม่โชว์บรรทัด USD/เรต', () => {
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
    expect(text).not.toContain('แปลงแล้ว');
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

  test('Admin message: มี slipImageUrl → แนบรูปเป็น hero พร้อม action เปิด URL เต็ม', () => {
    const msg = buildAdminPaymentRequestMessage(
      { id: 'pay-1', amountThb: 59.17, billingPeriod: 'monthly', slipImageUrl: 'https://cdn.test/slip.jpg' },
      'สมชาย'
    );

    expect(msg.contents.hero).toBeDefined();
    expect(msg.contents.hero.url).toBe('https://cdn.test/slip.jpg');
    expect(msg.contents.hero.action.uri).toBe('https://cdn.test/slip.jpg');
    // ปุ่มอนุมัติ/ปฏิเสธเดิมยังอยู่ครบ
    const text = JSON.stringify(msg);
    expect(text).toContain('action=approve_payment&paymentId=pay-1');
    expect(text).toContain('action=reject_payment&paymentId=pay-1');
  });

  test('Admin message: ไม่มี slipImageUrl → ไม่มี hero (Flow เดิมไม่พัง)', () => {
    const msg = buildAdminPaymentRequestMessage(
      { id: 'pay-1', amountThb: 59.17, billingPeriod: 'monthly' },
      'สมชาย'
    );

    expect(msg.contents.hero).toBeUndefined();
    expect(JSON.stringify(msg)).toContain('action=approve_payment&paymentId=pay-1');
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
      totalAmountThb: 1000000,
      items: [
        { assetSymbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000, txnDate: '2026-07-10' },
        { assetSymbol: 'ETH', quantity: 2, pricePerUnit: 80000, amountThb: 160000, txnDate: '2026-03-01' },
      ],
    });
    const text = JSON.stringify(msg);

    expect(text).toContain('BTC');
    expect(text).toContain('ETH');
    expect(text).toContain('1,000,000');
    expect(text).toContain('action=confirm_bulk_import&batchId=batch-1');
    expect(text).toContain('action=cancel_bulk_import&batchId=batch-1');
    // Regression Guard: ไม่มี Item ไหนมี fx (Batch เป็น THB ล้วน) → ต้องไม่มี
    // ข้อความ USD/เรตหลุดมาปนโดยไม่ตั้งใจ
    expect(text).not.toContain('USD');
    expect(text).not.toContain('อัตราแลกเปลี่ยน');
    expect(text).not.toContain('ราคาที่พิมพ์');
  });

  test('buildBulkImportPreviewMessage → Item ที่มี fx (USD) โชว์ราคาที่พิมพ์ USD/หน่วย + เรตที่ใช้', () => {
    const msg = buildBulkImportPreviewMessage({
      batchId: 'batch-2',
      totalAmountThb: 10500,
      items: [
        {
          assetSymbol: 'MSFT',
          quantity: 3,
          pricePerUnit: 3500,
          amountThb: 10500,
          txnDate: '2026-07-10',
          fx: { currency: 'USD', rate: 35, pricePerUnitOriginal: 300, amountOriginal: 900 },
        },
      ],
    });
    const text = JSON.stringify(msg);

    expect(text).toContain('ราคาที่พิมพ์: 300 USD/หน่วย');
    expect(text).toContain('อัตราแลกเปลี่ยน: 1 USD = 35 บาท');
  });

  test('buildBulkImportPreviewMessage → Batch ปนกัน (USD + THB) แสดงบรรทัด USD เฉพาะ Item ที่มี fx เท่านั้น', () => {
    const msg = buildBulkImportPreviewMessage({
      batchId: 'batch-3',
      totalAmountThb: 760500,
      items: [
        { assetSymbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000, txnDate: '2026-07-10' },
        {
          assetSymbol: 'MSFT',
          quantity: 3,
          pricePerUnit: 3500,
          amountThb: 10500,
          txnDate: '2026-07-10',
          fx: { currency: 'USD', rate: 35, pricePerUnitOriginal: 300, amountOriginal: 900 },
        },
      ],
    });
    const text = JSON.stringify(msg);

    // BTC (ไม่มี fx) ต้องไม่มีบรรทัด USD ติดมาด้วย
    const btcIndex = text.indexOf('BTC');
    const msftIndex = text.indexOf('MSFT');
    const btcSection = text.slice(btcIndex, msftIndex);
    expect(btcSection).not.toContain('USD');
    expect(btcSection).not.toContain('อัตราแลกเปลี่ยน');

    // MSFT (มี fx) ต้องมีบรรทัด USD + เรต
    const msftSection = text.slice(msftIndex);
    expect(msftSection).toContain('300 USD/หน่วย');
    expect(msftSection).toContain('1 USD = 35 บาท');
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
