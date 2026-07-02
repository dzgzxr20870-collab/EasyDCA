const { buildProfitMessage } = require('../src/utils/flexMessage.util');

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
