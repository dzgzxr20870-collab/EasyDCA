// SEC Open Data API (กองทุนรวมไทย) — Round 7
// Cache เป็น Module-level + TTL อิง Date.now() → ใช้ resetModules + fakeTimers
// เหมือน priceFeed.service.test.js เดิม | ทุก Test เป็น Mock (ไม่ยิง SEC จริง)

const SEC_NAV_URL = 'https://api.sec.or.th/v2/fund/daily-info/nav';

let priceFeedService;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  jest.restoreAllMocks();
  priceFeedService = require('../src/services/priceFeed.service');
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.SEC_API_SUBSCRIPTION_KEY;
  delete process.env.SEC_FUND_MASTER_LIST_PATH;
});

function mockSecNav(items) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ message: 'success', page_size: 100, next_cursor: '', items }),
  });
}

describe('getMutualFundNav (SEC Endpoint 1 — Verified)', () => {
  test('มี Key + มีข้อมูล → คืน last_val ล่าสุด (เลือก nav_date ล่าสุดสุด) + ส่ง Header Key', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    mockSecNav([
      { proj_id: 'M1', fund_class_name: 'K-SELECT-A(A)', nav_date: '2024-11-20', last_val: 12.1 },
      { proj_id: 'M1', fund_class_name: 'K-SELECT-A(A)', nav_date: '2024-11-22', last_val: 12.3456 },
      { proj_id: 'M1', fund_class_name: 'K-SELECT-A(A)', nav_date: '2024-11-21', last_val: 12.2 },
    ]);

    const nav = await priceFeedService.getMutualFundNav('M1', 'K-SELECT-A(A)');

    expect(nav).toEqual({ navDate: '2024-11-22', lastVal: 12.3456 });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain(SEC_NAV_URL);
    expect(url).toContain('proj_id=M1');
    expect(url).toContain(encodeURIComponent('K-SELECT-A(A)'));
    expect(opts.headers['Ocp-Apim-Subscription-Key']).toBe('test-key');
  });

  test('last_val ของวันล่าสุดเป็น null (บลจ.ยังไม่อัปเดต) → Fallback ไปวันก่อนหน้าที่มีค่า', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    mockSecNav([
      { proj_id: 'M1', fund_class_name: 'C1', nav_date: '2024-11-22', last_val: null },
      { proj_id: 'M1', fund_class_name: 'C1', nav_date: '2024-11-21', last_val: 12.2 },
    ]);

    const nav = await priceFeedService.getMutualFundNav('M1', 'C1');
    expect(nav).toEqual({ navDate: '2024-11-21', lastVal: 12.2 });
  });

  test('last_val เป็น string มี comma (Defensive) → Parse เป็น Number ได้', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    mockSecNav([{ proj_id: 'M1', fund_class_name: 'C1', nav_date: '2024-11-22', last_val: '1,234.5678' }]);

    const nav = await priceFeedService.getMutualFundNav('M1', 'C1');
    expect(nav.lastVal).toBe(1234.5678);
  });

  test('last_val = 0/null ทุกวัน → throw MUTUAL_FUND_NAV_UNAVAILABLE (ไม่ปัดเป็น 0)', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    mockSecNav([
      { proj_id: 'M1', fund_class_name: 'C1', nav_date: '2024-11-22', last_val: 0 },
      { proj_id: 'M1', fund_class_name: 'C1', nav_date: '2024-11-21', last_val: null },
    ]);

    await expect(priceFeedService.getMutualFundNav('M1', 'C1')).rejects.toMatchObject({
      code: 'MUTUAL_FUND_NAV_UNAVAILABLE',
    });
  });

  test('ตอบปนหลาย Class → เลือกเฉพาะ Class ที่ขอ (NAV ไม่ปนกัน)', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    mockSecNav([
      { proj_id: 'M1', fund_class_name: 'K-SELECT-A(A)', nav_date: '2024-11-22', last_val: 12.34 },
      { proj_id: 'M1', fund_class_name: 'K-SELECT-C(A)', nav_date: '2024-11-22', last_val: 99.99 },
    ]);

    const nav = await priceFeedService.getMutualFundNav('M1', 'K-SELECT-A(A)');
    expect(nav.lastVal).toBe(12.34);
  });

  test('ไม่ได้ตั้ง SEC_API_SUBSCRIPTION_KEY → throw SEC_NOT_CONFIGURED, ไม่ยิง Request', async () => {
    delete process.env.SEC_API_SUBSCRIPTION_KEY;
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(priceFeedService.getMutualFundNav('M1', 'C1')).rejects.toMatchObject({
      code: 'SEC_NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('SEC API ตอบ Error Status (500) → throw MUTUAL_FUND_NAV_UNAVAILABLE', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });

    await expect(priceFeedService.getMutualFundNav('M1', 'C1')).rejects.toMatchObject({
      code: 'MUTUAL_FUND_NAV_UNAVAILABLE',
    });
  });

  test('Network Error → throw MUTUAL_FUND_NAV_UNAVAILABLE (ไม่หลุด Error ดิบ)', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(priceFeedService.getMutualFundNav('M1', 'C1')).rejects.toMatchObject({
      code: 'MUTUAL_FUND_NAV_UNAVAILABLE',
    });
  });

  test('Cache 6 ชม.: เรียกซ้ำคู่เดิมไม่ยิง API ใหม่', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    mockSecNav([{ proj_id: 'M1', fund_class_name: 'C1', nav_date: '2024-11-22', last_val: 12.34 }]);

    await priceFeedService.getMutualFundNav('M1', 'C1');
    jest.advanceTimersByTime(60 * 60 * 1000);
    await priceFeedService.getMutualFundNav('M1', 'C1');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchFundMasterList (SEC Endpoint 2 — UNVERIFIED, Env-driven)', () => {
  test('(h) ไม่ได้ตั้ง Path/Key → throw SEC_NOT_CONFIGURED, ไม่ยิง Request', async () => {
    delete process.env.SEC_API_SUBSCRIPTION_KEY;
    delete process.env.SEC_FUND_MASTER_LIST_PATH;
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(priceFeedService.fetchFundMasterList()).rejects.toMatchObject({
      code: 'SEC_NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('(h) Path ยังเป็น Placeholder "UNVERIFIED..." → ถือว่าไม่ได้ตั้งค่า ไม่ยิง Request', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    process.env.SEC_FUND_MASTER_LIST_PATH = 'UNVERIFIED_PLACEHOLDER set before prod';
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(priceFeedService.fetchFundMasterList()).rejects.toMatchObject({
      code: 'SEC_NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('ตั้งค่าครบ → ยิง Endpoint 2 พร้อม Header Key + ไล่ next_cursor ครบทุกหน้า', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    process.env.SEC_FUND_MASTER_LIST_PATH = '/v2/fund/fund-general-info';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ proj_id: 'M1', proj_abbr_name: 'K-SELECT' }], next_cursor: 'c2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ proj_id: 'M2', proj_abbr_name: 'SCBRM' }], next_cursor: '' }),
      });

    const items = await priceFeedService.fetchFundMasterList();

    expect(items).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toContain('next_cursor=c2');
    expect(global.fetch.mock.calls[0][1].headers['Ocp-Apim-Subscription-Key']).toBe('test-key');
  });

  test('SEC API ล่ม (500) → throw MUTUAL_FUND_LIST_UNAVAILABLE (Fail Isolated)', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    process.env.SEC_FUND_MASTER_LIST_PATH = '/v2/fund/fund-general-info';
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });

    await expect(priceFeedService.fetchFundMasterList()).rejects.toMatchObject({
      code: 'MUTUAL_FUND_LIST_UNAVAILABLE',
    });
  });

  test('Cache 24 ชม.: เรียกซ้ำไม่ยิง API ใหม่', async () => {
    process.env.SEC_API_SUBSCRIPTION_KEY = 'test-key';
    process.env.SEC_FUND_MASTER_LIST_PATH = '/v2/fund/fund-general-info';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ proj_id: 'M1', proj_abbr_name: 'K-SELECT' }], next_cursor: '' }),
    });

    await priceFeedService.fetchFundMasterList();
    jest.advanceTimersByTime(12 * 60 * 60 * 1000);
    await priceFeedService.fetchFundMasterList();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
