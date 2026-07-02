const {
  buildProfitMessage,
  buildReminderSetMessage,
  buildReminderListMessage,
  buildReminderDeletedMessage,
  buildReminderPushMessage,
  buildSymbolQuickReply,
  buildFrequencyQuickReply,
  buildDayOfWeekQuickReply,
  buildDayOfMonthQuickReply,
  buildAskAmountMessage,
  buildReminderSetupCancelledMessage,
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
