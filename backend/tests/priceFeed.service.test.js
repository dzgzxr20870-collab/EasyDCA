// Cache ของ priceFeed.service เป็น Module-level (Map) และ TTL อิง Date.now()
// จึงใช้ 2 เทคนิคคู่กัน:
//  (1) jest.resetModules() + re-require ในแต่ละ Test เพื่อล้าง Cache ให้สะอาด
//  (2) jest.useFakeTimers() คุม Date.now() เพื่อทดสอบพฤติกรรม TTL แบบ Deterministic

const SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';

// Mock CoinGecko ตอบราคาสำเร็จสำหรับ coingeckoId ที่ระบุ (thb เท่านั้น — usd ไม่ส่งมา
// จำลอง Response แบบเดิมก่อน Gap 2 Fix ที่ยังใช้ได้ปกติ เพราะ vs_currencies=thb,usd
// เป็น Superset ของ vs_currencies=thb เดิม)
function mockCoinGeckoSuccess(coingeckoId, priceThb) {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ [coingeckoId]: { thb: priceThb } }),
  });
}

// Mock CoinGecko ตอบทั้ง THB และ USD พร้อมกัน (Response จริงหลัง Gap 2 Fix)
function mockCoinGeckoBothCurrencies(coingeckoId, priceThb, priceUsd) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ [coingeckoId]: { thb: priceThb, usd: priceUsd } }),
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

describe('getCurrentPrice / getCurrentPriceUsd — Request Coalescing + Merged THB/USD Cache', () => {
  test('2 Request พร้อมกันของ Symbol เดียวกัน (getCurrentPrice ซ้ำ) → ยิง CoinGecko แค่ 1 ครั้ง (แก้ Dogpile)', async () => {
    const fetchMock = mockCoinGeckoBothCurrencies('bitcoin', 3400000, 95000);

    const [first, second] = await Promise.all([
      priceFeedService.getCurrentPrice('BTC'),
      priceFeedService.getCurrentPrice('BTC'),
    ]);

    expect(first).toBe(3400000);
    expect(second).toBe(3400000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('ขอทั้ง THB (getCurrentPrice) และ USD (getCurrentPriceUsd) พร้อมกัน → ยิง CoinGecko แค่ 1 ครั้ง (แก้ Gap 2)', async () => {
    const fetchMock = mockCoinGeckoBothCurrencies('bitcoin', 3400000, 95000);

    const [thb, usd] = await Promise.all([
      priceFeedService.getCurrentPrice('BTC'),
      priceFeedService.getCurrentPriceUsd('BTC'),
    ]);

    expect(thb).toBe(3400000);
    expect(usd).toBe(95000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('vs_currencies=thb,usd');
  });

  test('Cache Warm ทั้งคู่แล้ว → เรียกซ้ำ (THB หรือ USD) ไม่ยิง API เพิ่ม', async () => {
    const fetchMock = mockCoinGeckoBothCurrencies('bitcoin', 3400000, 95000);

    await priceFeedService.getCurrentPrice('BTC');
    await priceFeedService.getCurrentPriceUsd('BTC');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // ยังอยู่ใน TTL (60s) — เรียกซ้ำทั้งสองฟังก์ชันต้องไม่ยิง API เพิ่มเลย
    jest.advanceTimersByTime(30 * 1000);
    const thbAgain = await priceFeedService.getCurrentPrice('BTC');
    const usdAgain = await priceFeedService.getCurrentPriceUsd('BTC');

    expect(thbAgain).toBe(3400000);
    expect(usdAgain).toBe(95000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('THB ถูกต้องแต่ USD Invalid (หรือขาดหาย) ในรอบ Fetch เดียวกัน → ยัง Cache/คืน THB ได้ตามปกติ ส่วน USD คืน null และไม่ถูก Cache (Retry รอบถัดไป)', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        // usd หายไปจาก Response รอบแรก (Shape ผิดปกติเฉพาะสกุลนี้) — thb ปกติ
        json: async () => ({ bitcoin: { thb: 3400000 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { thb: 3400000, usd: 95000 } }),
      });

    // ยิงพร้อมกัน (Coalesce เป็น Fetch เดียว) — thb/usd มาจาก Response รอบแรกรอบเดียวกัน
    const [thb, usdFirstTry] = await Promise.all([
      priceFeedService.getCurrentPrice('BTC'),
      priceFeedService.getCurrentPriceUsd('BTC'),
    ]);

    expect(thb).toBe(3400000);
    expect(usdFirstTry).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // เรียก USD ใหม่ (ไม่ถูก Cache จากรอบแรก → Retry ทันทีไม่รอ TTL) → ได้ค่าจาก Response รอบ 2
    const usdSecondTry = await priceFeedService.getCurrentPriceUsd('BTC');
    expect(usdSecondTry).toBe(95000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // thb เดิมยังใช้ Cache ได้ปกติ (ไม่ถูกกระทบจาก Retry ของ usd — ไม่ยิง Fetch ที่ 3)
    const thbStillCached = await priceFeedService.getCurrentPrice('BTC');
    expect(thbStillCached).toBe(3400000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('Field ที่ยังไม่หมดอายุจากรอบก่อน (thb) ต้องไม่ถูกทับด้วย null ตอนอีกสกุล (usd) Refetch รอบใหม่ (Merge ไม่ใช่ Replace)', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      // รอบ 1: thb สำเร็จ, usd ขาดหายจาก Response — thb เข้า Cache (usd ยังไม่ถูก Cache)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { thb: 3400000 } }),
      })
      // รอบ 2 (Trigger เพราะ usd ยังไม่เคย Cache จากรอบ 1): thb ล้มเหลวชั่วคราว (หายไปจาก
      // Response รอบนี้) แต่ usd สำเร็จ — thb เดิมจากรอบ 1 "ยังไม่หมดอายุ" ต้องไม่ถูกทับ
      // ด้วย null (นี่คือ Bug ที่พบตอน Review: cacheCryptoPrices เดิมสร้าง Entry ใหม่ทับ
      // ทั้งก้อนแทนที่จะ Merge ทำให้ thb ที่ยังใช้ได้หายไปจาก Cache ทั้งที่ไม่มีอะไรผิดปกติ)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { usd: 95000 } }),
      });

    const thbRound1 = await priceFeedService.getCurrentPrice('BTC');
    expect(thbRound1).toBe(3400000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // ยังไม่ Advance เวลาเลย (thb ยังไม่หมดอายุ) — usd ไม่เคยถูก Cache จากรอบ 1 จึง Trigger
    // Fetch รอบ 2
    const usdRound2 = await priceFeedService.getCurrentPriceUsd('BTC');
    expect(usdRound2).toBe(95000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Regression Check: thb จากรอบ 1 ต้องยังอยู่ใน Cache (ไม่ถูกรอบ 2 ทับด้วย null) —
    // เรียกซ้ำต้องได้ค่าเดิมจาก Cache โดยไม่ยิง Fetch รอบที่ 3
    const thbAfterRound2 = await priceFeedService.getCurrentPrice('BTC');
    expect(thbAfterRound2).toBe(3400000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('2 Request พร้อมกันของคนละ Symbol (BTC, ETH) → ยิงคนละ Request แยกกัน (ไม่ Over-coalesce)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('ids=bitcoin')) {
        return Promise.resolve({ ok: true, json: async () => ({ bitcoin: { thb: 3400000, usd: 95000 } }) });
      }
      if (url.includes('ids=ethereum')) {
        return Promise.resolve({ ok: true, json: async () => ({ ethereum: { thb: 120000, usd: 3500 } }) });
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => 'unexpected' });
    });

    const [btc, eth] = await Promise.all([
      priceFeedService.getCurrentPrice('BTC'),
      priceFeedService.getCurrentPrice('ETH'),
    ]);

    expect(btc).toBe(3400000);
    expect(eth).toBe(120000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── หุ้นสหรัฐ (Twelve Data) ────────────────────────────────────────────────
// Mock fetch แยกตาม URL: /quote คืนราคา USD (String), /exchange_rate คืน rate
function mockTwelveData({ closeUsd, rate }) {
  return jest.spyOn(global, 'fetch').mockImplementation((url) => {
    if (url.includes('/quote')) {
      return Promise.resolve({ ok: true, json: async () => ({ symbol: 'AAPL', close: String(closeUsd) }) });
    }
    if (url.includes('/exchange_rate')) {
      return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USD/THB', rate }) });
    }
    return Promise.resolve({ ok: false, status: 404, text: async () => 'unexpected url' });
  });
}

function countCalls(fetchMock, fragment) {
  return fetchMock.mock.calls.filter(([url]) => url.includes(fragment)).length;
}

describe('getCurrentPrice — หุ้นสหรัฐ (Twelve Data + แปลง USD→THB)', () => {
  beforeEach(() => {
    // getUsStockPriceThb อ่าน process.env ตอน Call — ตั้ง Key จำลองให้ยิง API ได้
    process.env.TWELVE_DATA_API_KEY = 'test-twelve-key';
  });

  afterEach(() => {
    delete process.env.TWELVE_DATA_API_KEY;
  });

  test('AAPL สำเร็จ → แปลงเป็น THB ด้วยการคูณ Rate ถูกทาง', async () => {
    // ราคา 185.5 USD, Rate 36 THB/USD → 185.5 × 36 = 6678 THB
    mockTwelveData({ closeUsd: 185.5, rate: 36 });

    const price = await priceFeedService.getCurrentPrice('AAPL');

    expect(price).toBeCloseTo(6678, 5);
    // ยิงทั้ง quote และ exchange_rate อย่างละครั้ง
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const quoteUrl = global.fetch.mock.calls.find(([u]) => u.includes('/quote'))[0];
    expect(quoteUrl).toContain('symbol=AAPL');
    expect(quoteUrl).toContain('apikey=test-twelve-key');
  });

  test('ป้องกัน Currency Bug: ผลลัพธ์ต้องเป็น USD×Rate ไม่ใช่ USD÷Rate', async () => {
    const closeUsd = 200;
    const rate = 35;
    mockTwelveData({ closeUsd, rate });

    const price = await priceFeedService.getCurrentPrice('TSLA');

    // ถูกต้อง = 7000; ถ้าเผลอหารผิดทางจะได้ ~5.71 — ยืนยันว่าไม่ใช่ค่าที่หารผิด
    expect(price).toBe(closeUsd * rate);
    expect(price).not.toBeCloseTo(closeUsd / rate, 5);
    // และราคา THB ต้องมากกว่าราคา USD เดิมเสมอ (Rate > 1) กันคูณ/หารสลับ
    expect(price).toBeGreaterThan(closeUsd);
  });

  test('Symbol case-insensitive (aapl) → Normalize เป็น AAPL แล้วยิง Twelve Data', async () => {
    mockTwelveData({ closeUsd: 100, rate: 35 });

    const price = await priceFeedService.getCurrentPrice('aapl');

    expect(price).toBe(3500);
  });

  test('Twelve Data /quote ล้มเหลว (Status Error) → คืน null ไม่ throw', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    });

    await expect(priceFeedService.getCurrentPrice('AAPL')).resolves.toBeNull();
  });

  test('Twelve Data Response ไม่มี close (Shape ผิด/error) → คืน null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'error', code: 401, message: 'Invalid API key' }),
    });

    await expect(priceFeedService.getCurrentPrice('AAPL')).resolves.toBeNull();
  });

  test('Network Error / Timeout (fetch reject) → คืน null ไม่ throw', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('aborted'));

    await expect(priceFeedService.getCurrentPrice('AAPL')).resolves.toBeNull();
  });

  test('ราคาหุ้นได้แต่ FX Rate ล้มเหลว → คืน null (ไม่คืนราคา USD ดิบ)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/quote')) {
        return Promise.resolve({ ok: true, json: async () => ({ close: '150' }) });
      }
      // exchange_rate ล้มเหลว
      return Promise.resolve({ ok: false, status: 500, text: async () => 'fx down' });
    });

    await expect(priceFeedService.getCurrentPrice('AAPL')).resolves.toBeNull();
  });

  test('ไม่ได้ตั้ง TWELVE_DATA_API_KEY → คืน null และไม่ยิง API', async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const fetchMock = jest.spyOn(global, 'fetch');

    const price = await priceFeedService.getCurrentPrice('AAPL');

    expect(price).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // IBM ถูกเพิ่มเข้า symbolRegistry จริงแล้ว (Beta Prep — ขยาย List หุ้นสหรัฐ) จึงเปลี่ยน
  // Symbol ตัวอย่างเป็น ZZZ (ยังไม่มีใน Registry แน่นอน) แทน — Intent ของ Test เดิมไม่
  // เปลี่ยน (ยืนยันว่า Symbol ที่ Registry ไม่รู้จักเลยจะไม่ยิง API)
  test('Symbol ที่ Registry ไม่รู้จักเลย (ZZZ) → คืน null ไม่ยิง API', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    const price = await priceFeedService.getCurrentPrice('ZZZ');

    expect(price).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('Cache ราคาหุ้น (TTL 60s): เรียกซ้ำภายใน TTL ไม่ยิง API ซ้ำ', async () => {
    mockTwelveData({ closeUsd: 100, rate: 35 });

    const first = await priceFeedService.getCurrentPrice('AAPL'); // quote + fx = 2
    jest.advanceTimersByTime(30 * 1000);
    const second = await priceFeedService.getCurrentPrice('AAPL'); // cache hit = 0

    expect(first).toBe(3500);
    expect(second).toBe(3500);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('FX Cache นานกว่า (10 นาที): หลังราคาหุ้นหมดอายุ 60s ยิงแค่ /quote ไม่ยิง FX ซ้ำ', async () => {
    const fetchMock = mockTwelveData({ closeUsd: 100, rate: 35 });

    await priceFeedService.getCurrentPrice('AAPL'); // quote(1) + exchange_rate(1)
    jest.advanceTimersByTime(61 * 1000); // ราคาหุ้นหมดอายุ (60s) แต่ FX ยังอยู่ (<10 นาที)
    await priceFeedService.getCurrentPrice('AAPL'); // quote(2) เท่านั้น — FX ใช้ Cache

    expect(countCalls(fetchMock, '/quote')).toBe(2);
    expect(countCalls(fetchMock, '/exchange_rate')).toBe(1);
  });

  // Bug ที่จับได้: EOSE ถือจริงผ่าน Manual Quantity Fallback (Round 10-B) แต่ไม่เคย
  // ถูกเพิ่มเข้า symbolRegistry.SYMBOL_TYPES → lookupType คืน null → getCurrentPrice
  // return null "ก่อน" ยิง Twelve Data เลยด้วยซ้ำ (ไม่ใช่ Twelve Data ตอบผิด/ล่ม) —
  // Response ด้านล่างคือ Response จริงที่ยืนยันแล้วจาก Twelve Data สำหรับ EOSE
  // (close เป็น String "4.13000", is_market_open: false, มี Field อื่นปนมาด้วย)
  // Test นี้กันไม่ให้ Symbol ที่มี Response Shape แบบนี้ (US หุ้นตลาดปิด) พังซ้ำ —
  // ทั้งจาก (1) เผลอเอา EOSE ออกจาก Registry อีก และ (2) Response Shape นี้ทำให้
  // Parse พังจริงในอนาคต (แยกสาเหตุออกจากกันให้ชัด)
  test('EOSE (อยู่ใน Registry แล้ว) + Response Shape จริงจาก Twelve Data (close เป็น String, is_market_open:false) → คำนวณราคา THB ได้ปกติ', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/quote')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            symbol: 'EOSE',
            name: 'Eos Energy Enterprises Inc.',
            exchange: 'NASDAQ',
            mic_code: 'XNGS',
            currency: 'USD',
            datetime: '2026-07-17',
            close: '4.13000',
            is_market_open: false,
          }),
        });
      }
      if (url.includes('/exchange_rate')) {
        return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USD/THB', rate: 36 }) });
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => 'unexpected url' });
    });

    const price = await priceFeedService.getCurrentPrice('EOSE');

    expect(price).toBeCloseTo(4.13 * 36, 5);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('EOSE + getCurrentPriceUsd (Response Shape เดียวกัน) → คืนราคา USD ดิบ ไม่แปลง THB', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: 'EOSE',
        name: 'Eos Energy Enterprises Inc.',
        exchange: 'NASDAQ',
        currency: 'USD',
        close: '4.13000',
        is_market_open: false,
      }),
    });

    const price = await priceFeedService.getCurrentPriceUsd('EOSE');

    expect(price).toBeCloseTo(4.13, 5);
  });

  // เดียวกับ EOSE — OKLO ก็เคยไม่อยู่ใน symbolRegistry.SYMBOL_TYPES (Bug Class เดียวกัน
  // ยืนยันด้วยการยิง Twelve Data /quote?symbol=OKLO ตรงจริง ก่อนเพิ่มเข้า Registry:
  // name="Oklo Inc.", exchange="NYSE", currency="USD", close="41.11000",
  // is_market_open:false — Response มี Field ซ้อน (fifty_two_week) ที่ EOSE ไม่มี
  // ด้วย ใช้ยืนยันว่า Parse ไม่สนใจ Field เกินที่ไม่รู้จัก
  test('OKLO (อยู่ใน Registry แล้ว) + Response Shape จริงจาก Twelve Data (NYSE, close เป็น String, มี Field ซ้อน fifty_two_week) → คำนวณราคา THB ได้ปกติ', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/quote')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            symbol: 'OKLO',
            name: 'Oklo Inc.',
            exchange: 'NYSE',
            mic_code: 'XNYS',
            currency: 'USD',
            datetime: '2026-07-17',
            close: '41.11000',
            previous_close: '41.70000',
            is_market_open: false,
            fifty_two_week: { low: '39.53000', high: '193.84000' },
          }),
        });
      }
      if (url.includes('/exchange_rate')) {
        return Promise.resolve({ ok: true, json: async () => ({ symbol: 'USD/THB', rate: 36 }) });
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => 'unexpected url' });
    });

    const price = await priceFeedService.getCurrentPrice('OKLO');

    expect(price).toBeCloseTo(41.11 * 36, 5);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('OKLO + getCurrentPriceUsd (Response Shape เดียวกัน) → คืนราคา USD ดิบ ไม่แปลง THB', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: 'OKLO',
        name: 'Oklo Inc.',
        exchange: 'NYSE',
        currency: 'USD',
        close: '41.11000',
        is_market_open: false,
      }),
    });

    const price = await priceFeedService.getCurrentPriceUsd('OKLO');

    expect(price).toBeCloseTo(41.11, 5);
  });

  // ── knownType (Dynamic Symbol Resolution) — เชื่อ assets.type ก่อน Registry ──────
  // แก้ Root Cause ของบั๊ก Class เดียวกับ EOSE/OKLO แบบถาวร: Asset ที่สร้างผ่าน Manual
  // Quantity Fallback มี assets.type ถูกต้องใน DB แต่ Symbol ยังไม่อยู่ใน Registry
  describe('knownType Parameter (assets.type มาก่อน symbolRegistry)', () => {
    test('Symbol ที่ Registry ไม่รู้จักเลย + knownType=stock_us → Route ไป Twelve Data ได้ (THB)', async () => {
      mockTwelveData({ closeUsd: 20, rate: 36 });

      // ไม่ส่ง knownType → คืน null ตามเดิม (พฤติกรรมเดิมไม่เปลี่ยน)
      expect(await priceFeedService.getCurrentPrice('ZZZ')).toBeNull();
      // ส่ง knownType → ใช้ Type นั้น Route แทนการถาม Registry
      expect(await priceFeedService.getCurrentPrice('ZZZ', 'stock_us')).toBeCloseTo(720, 5);
    });

    test('Symbol ที่ Registry ไม่รู้จักเลย + knownType=stock_us → getCurrentPriceUsd คืนราคา USD ดิบ', async () => {
      mockTwelveData({ closeUsd: 20, rate: 36 });

      expect(await priceFeedService.getCurrentPriceUsd('ZZZ')).toBeNull();
      expect(await priceFeedService.getCurrentPriceUsd('ZZZ', 'stock_us')).toBe(20);
    });

    test('knownType ที่ไม่อยู่ใน CHECK Constraint (ค่าเพี้ยน) → ไม่เชื่อ Fallback ไป Registry แทน', async () => {
      const fetchMock = mockTwelveData({ closeUsd: 20, rate: 36 });

      // AAPL อยู่ใน Registry (stock_us) → แม้ knownType เพี้ยนก็ยังได้ราคาผ่าน Registry
      expect(await priceFeedService.getCurrentPrice('AAPL', 'bogus_type')).toBeCloseTo(720, 5);
      // ZZZ ไม่อยู่ใน Registry + knownType เพี้ยน → null และต้องไม่ยิง API เพิ่ม
      const callsBefore = fetchMock.mock.calls.length;
      expect(await priceFeedService.getCurrentPrice('ZZZ', 'bogus_type')).toBeNull();
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    test('knownType=null/undefined (Caller เดิมที่ยังไม่ส่ง) → พฤติกรรมเหมือนเดิมทุกประการ', async () => {
      mockTwelveData({ closeUsd: 100, rate: 35 });

      expect(await priceFeedService.getCurrentPrice('AAPL', null)).toBe(3500);
      expect(await priceFeedService.getCurrentPrice('AAPL', undefined)).toBe(3500);
      expect(await priceFeedService.getCurrentPrice('AAPL')).toBe(3500);
    });

    test('knownType ต้องไม่ Override Crypto: Symbol Crypto + knownType=stock_us → ยังไป CoinGecko (COINGECKO_IDS มาก่อน)', async () => {
      // BTC มี COINGECKO_IDS → getCurrentPriceUsd เช็ค Crypto ก่อน type เสมอ
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ bitcoin: { thb: 3400000, usd: 95000 } }),
      });

      const price = await priceFeedService.getCurrentPriceUsd('BTC', 'stock_us');

      expect(price).toBe(95000);
      expect(fetchMock.mock.calls[0][0]).toContain('coingecko');
    });
  });
});

// ── ทองคำไทย (Phase 3 Round 7) ─────────────────────────────────────────────
const THAI_GOLD_URL = 'https://api.chnwt.dev/thai-gold-api/latest';

// รูปแบบ Response จริงจาก API (ยืนยันจาก Doc ทางการ) — ราคาเป็น String มี Comma
// gold = ทองรูปพรรณ, gold_bar = ทองคำแท่ง
function mockGoldSuccess({ bar = { buy: '70,950.00', sell: '71,150.00' }, orn = { buy: '69,523.76', sell: '71,950.00' } } = {}) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      status: 'success',
      response: {
        update_date: '02/02/2569',
        update_time: 'เวลา 17:23 น. (ครั้งที่ 69)',
        price: { gold: orn, gold_bar: bar },
      },
    }),
  });
}

describe('getGoldPriceThb — สำเร็จ', () => {
  test('gold_bar → คืน buy/sell เป็น Number (ตัด Comma) + updatedAt', async () => {
    mockGoldSuccess();

    const result = await priceFeedService.getGoldPriceThb('gold_bar');

    expect(result.buy).toBe(70950);
    expect(result.sell).toBe(71150);
    expect(result.updatedAt).toContain('02/02/2569');
    expect(global.fetch.mock.calls[0][0]).toBe(THAI_GOLD_URL);
  });

  test('gold_ornament → อ่านจาก Key "gold" ของ API (ไม่ใช่ "gold_ornament")', async () => {
    mockGoldSuccess();

    const result = await priceFeedService.getGoldPriceThb('gold_ornament');

    expect(result.buy).toBe(69523.76);
    expect(result.sell).toBe(71950);
  });

  test('ทองคำแท่งกับทองรูปพรรณใช้ราคาคนละชุด ไม่ปนกัน', async () => {
    mockGoldSuccess();

    const bar = await priceFeedService.getGoldPriceThb('gold_bar');
    const orn = await priceFeedService.getGoldPriceThb('gold_ornament');

    expect(bar.sell).toBe(71150);
    expect(orn.sell).toBe(71950);
    expect(bar.buy).not.toBe(orn.buy);
  });

  test('Cache TTL 10 นาที: ยิง API ครั้งเดียวได้ทั้ง 2 ประเภท (เรียกซ้ำไม่ยิงใหม่)', async () => {
    mockGoldSuccess();

    await priceFeedService.getGoldPriceThb('gold_bar'); // ยิง 1 ครั้ง cache ทั้งคู่
    await priceFeedService.getGoldPriceThb('gold_ornament'); // cache hit
    jest.advanceTimersByTime(9 * 60 * 1000);
    await priceFeedService.getGoldPriceThb('gold_bar'); // ยังอยู่ใน TTL

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('Cache หมดอายุหลัง 10 นาที → ยิง API ใหม่', async () => {
    mockGoldSuccess();

    await priceFeedService.getGoldPriceThb('gold_bar');
    jest.advanceTimersByTime(11 * 60 * 1000);
    await priceFeedService.getGoldPriceThb('gold_bar');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('getGoldPriceThb — ล้มเหลว (throw GOLD_PRICE_UNAVAILABLE, ไม่เดาราคา)', () => {
  test('ราคาว่าง "" (ก่อนตลาดเปิด) → throw GOLD_PRICE_UNAVAILABLE (ไม่ใช่ 0)', async () => {
    mockGoldSuccess({ bar: { buy: '', sell: '' }, orn: { buy: '', sell: '' } });

    await expect(priceFeedService.getGoldPriceThb('gold_bar')).rejects.toMatchObject({
      code: 'GOLD_PRICE_UNAVAILABLE',
    });
  });

  test('API ตอบ Error Status (5xx) → throw GOLD_PRICE_UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(priceFeedService.getGoldPriceThb('gold_bar')).rejects.toMatchObject({
      code: 'GOLD_PRICE_UNAVAILABLE',
    });
  });

  test('status ไม่ใช่ success → throw GOLD_PRICE_UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'error', response: {} }),
    });

    await expect(priceFeedService.getGoldPriceThb('gold_bar')).rejects.toMatchObject({
      code: 'GOLD_PRICE_UNAVAILABLE',
    });
  });

  test('Network Error (fetch throw) → throw GOLD_PRICE_UNAVAILABLE (ไม่หลุด Error ดิบ)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(priceFeedService.getGoldPriceThb('gold_bar')).rejects.toMatchObject({
      code: 'GOLD_PRICE_UNAVAILABLE',
    });
  });

  test('goldType ไม่รู้จัก → throw GOLD_PRICE_UNAVAILABLE ไม่ยิง API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(priceFeedService.getGoldPriceThb('gold_xxx')).rejects.toMatchObject({
      code: 'GOLD_PRICE_UNAVAILABLE',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('เฉพาะทองรูปพรรณว่าง (แท่งปกติ) → ขอแท่งได้ แต่ขอรูปพรรณ throw', async () => {
    mockGoldSuccess({ orn: { buy: '', sell: '' } });

    await expect(priceFeedService.getGoldPriceThb('gold_bar')).resolves.toMatchObject({ buy: 70950 });
    await expect(priceFeedService.getGoldPriceThb('gold_ornament')).rejects.toMatchObject({
      code: 'GOLD_PRICE_UNAVAILABLE',
    });
  });
});

describe('getCurrentPrice — ทองคำ (Mark-to-market ใช้ buy)', () => {
  test('GOLD → คืนราคา "รับซื้อคืน" (buy) ไม่ใช่ sell', async () => {
    mockGoldSuccess();

    const price = await priceFeedService.getCurrentPrice('GOLD');

    expect(price).toBe(70950); // = bar.buy (ไม่ใช่ sell 71150)
  });

  test('GOLDORN → คืน buy ของทองรูปพรรณ', async () => {
    mockGoldSuccess();
    expect(await priceFeedService.getCurrentPrice('GOLDORN')).toBe(69523.76);
  });

  test('API ล้มเหลว → getCurrentPrice คืน null (ไม่ throw — ให้สรุปพอร์ตข้าม Asset ได้)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(priceFeedService.getCurrentPrice('GOLD')).resolves.toBeNull();
  });
});
