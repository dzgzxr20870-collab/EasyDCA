const {
  buildProfitMessage,
  buildReminderSetMessage,
  buildReminderListMessage,
  buildReminderDeletedMessage,
  buildReminderPushMessage,
} = require('../src/utils/flexMessage.util');

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
