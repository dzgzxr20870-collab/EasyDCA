// Cache ของ priceFeed.service เป็น Module-level (Map) และ TTL อิง Date.now()
// จึงใช้ 2 เทคนิคคู่กัน:
//  (1) jest.resetModules() + re-require ในแต่ละ Test เพื่อล้าง Cache ให้สะอาด
//  (2) jest.useFakeTimers() คุม Date.now() เพื่อทดสอบพฤติกรรม TTL แบบ Deterministic

const SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';

// Mock CoinGecko ตอบราคาสำเร็จสำหรับ coingeckoId ที่ระบุ
function mockCoinGeckoSuccess(coingeckoId, priceThb) {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ [coingeckoId]: { thb: priceThb } }),
  });
}

let priceFeedService;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  jest.restoreAllMocks();
  // re-require หลัง resetModules เพื่อได้ Instance ใหม่ที่ Cache ว่างเปล่า
  priceFeedService = require('../src/services/priceFeed.service');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('getCurrentPrice — Symbol รู้จัก + API สำเร็จ', () => {
  test('BTC → คืนราคา THB ที่ CoinGecko ตอบกลับ', async () => {
    mockCoinGeckoSuccess('bitcoin', 3400000);

    const price = await priceFeedService.getCurrentPrice('BTC');

    expect(price).toBe(3400000);
    // ต้องยิงไปที่ CoinGecko ด้วย coingecko id ที่ Map ถูกต้อง + vs_currencies=thb
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain(SIMPLE_PRICE_URL);
    expect(calledUrl).toContain('ids=bitcoin');
    expect(calledUrl).toContain('vs_currencies=thb');
  });

  test('รับ Symbol แบบ case-insensitive (btc) → Normalize เป็น BTC', async () => {
    mockCoinGeckoSuccess('bitcoin', 3400000);

    const price = await priceFeedService.getCurrentPrice('btc');

    expect(price).toBe(3400000);
  });
});

describe('getCurrentPrice — Symbol ไม่รู้จัก', () => {
  test('Symbol ที่ไม่มีใน Mapping (PTT หุ้น) → คืน null และไม่ยิง API', async () => {
    jest.spyOn(global, 'fetch');

    const price = await priceFeedService.getCurrentPrice('PTT');

    expect(price).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('getCurrentPrice — API ล้มเหลว (ต้องคืน null ไม่ throw)', () => {
  test('CoinGecko ตอบ Error Status (429 Rate Limit) → คืน null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    });

    await expect(priceFeedService.getCurrentPrice('ETH')).resolves.toBeNull();
  });

  test('Network Error (fetch throw) → คืน null ไม่ throw ออกไป', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(priceFeedService.getCurrentPrice('ETH')).resolves.toBeNull();
  });

  test('Response ไม่มีราคาที่คาดไว้ (Shape ผิด) → คืน null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(priceFeedService.getCurrentPrice('ETH')).resolves.toBeNull();
  });
});

describe('getCurrentPrice — Cache (TTL 60 วินาที)', () => {
  test('เรียกซ้ำภายใน TTL → ใช้ Cache ไม่ยิง API ซ้ำ', async () => {
    mockCoinGeckoSuccess('bitcoin', 3400000);

    const first = await priceFeedService.getCurrentPrice('BTC');
    // ยังไม่ถึง TTL (ผ่านไปแค่ 30 วินาที)
    jest.advanceTimersByTime(30 * 1000);
    const second = await priceFeedService.getCurrentPrice('BTC');

    expect(first).toBe(3400000);
    expect(second).toBe(3400000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('เรียกซ้ำหลัง TTL หมด → ยิง API ใหม่', async () => {
    mockCoinGeckoSuccess('bitcoin', 3400000);

    await priceFeedService.getCurrentPrice('BTC');
    // เลย TTL 60 วินาทีไปแล้ว (61 วินาที) → Cache หมดอายุ
    jest.advanceTimersByTime(61 * 1000);
    await priceFeedService.getCurrentPrice('BTC');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('ราคาที่เป็น null ไม่ถูก Cache → เรียกใหม่ทันทีก็ยิง API อีกครั้ง (ไม่รอ TTL)', async () => {
    // ครั้งแรก API ล้มเหลว (คืน null) — ต้องไม่ Cache ค่า null
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bitcoin: { thb: 3400000 } }) });

    const firstFail = await priceFeedService.getCurrentPrice('BTC');
    // เรียกซ้ำทันที (ไม่ Advance เวลา) — ถ้า Cache null ไว้จะไม่ยิงรอบสอง
    const secondOk = await priceFeedService.getCurrentPrice('BTC');

    expect(firstFail).toBeNull();
    expect(secondOk).toBe(3400000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
