// fxRate.service — FX Rate USD→THB ผ่าน Frankfurter (Round 10)
// Cache เป็น Module-level + TTL อิง Date.now() จึงใช้ useFakeTimers + _resetCache
// (บริการ Expose _resetCache ให้ล้าง Cache/Last-known-good โดยไม่ต้อง resetModules)

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';

const fxRateService = require('../src/services/fxRate.service');

function mockFrankfurterSuccess(rateThb, date = '2026-07-11') {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ amount: 1, base: 'USD', date, rates: { THB: rateThb } }),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.restoreAllMocks();
  fxRateService._resetCache();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('getUsdThbRate — ยิงสำเร็จ', () => {
  test('คืน { rate, asOf, stale:false } และยิง Frankfurter USD→THB', async () => {
    mockFrankfurterSuccess(35.5, '2026-07-11');

    const fx = await fxRateService.getUsdThbRate();

    expect(fx).toEqual({ rate: 35.5, asOf: '2026-07-11', stale: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain(FRANKFURTER_URL);
    expect(url).toContain('from=USD');
    expect(url).toContain('to=THB');
  });

  test('Cache Hit ภายใน TTL → ไม่ยิง API ซ้ำ', async () => {
    mockFrankfurterSuccess(35.5);

    await fxRateService.getUsdThbRate();
    jest.advanceTimersByTime(30 * 60 * 1000); // 30 นาที < TTL 60 นาที
    const fx = await fxRateService.getUsdThbRate();

    expect(fx.rate).toBe(35.5);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('Cache หมดอายุ (เกิน 60 นาที) → ยิงใหม่', async () => {
    mockFrankfurterSuccess(35.5);
    await fxRateService.getUsdThbRate();

    jest.advanceTimersByTime(61 * 60 * 1000);
    mockFrankfurterSuccess(36.0);
    const fx = await fxRateService.getUsdThbRate();

    expect(fx.rate).toBe(36.0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('getUsdThbRate — API ล้มเหลว + Fallback', () => {
  test('ยังไม่เคยดึงเรตได้เลย + ยิงล้มเหลว → คืน null', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(fxRateService.getUsdThbRate()).resolves.toBeNull();
  });

  test('Status ไม่ใช่ 2xx → คืน null (ไม่ throw)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(fxRateService.getUsdThbRate()).resolves.toBeNull();
  });

  test('Response Shape ผิด (ไม่มี rates.THB) → คืน null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 1, base: 'USD', rates: {} }),
    });

    await expect(fxRateService.getUsdThbRate()).resolves.toBeNull();
  });

  test('Fallback: เคยดึงเรตได้ แล้ว API ล่มตอน Refresh → คืน Last-known-good + stale:true', async () => {
    mockFrankfurterSuccess(35.0, '2026-07-10');
    await fxRateService.getUsdThbRate(); // สำเร็จ เก็บ last-known-good

    jest.advanceTimersByTime(61 * 60 * 1000); // Cache หมดอายุ → บังคับ Refresh
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

    const fx = await fxRateService.getUsdThbRate();
    expect(fx).toEqual({ rate: 35.0, asOf: '2026-07-10', stale: true });
  });
});

describe('convertUsdToThb', () => {
  test('แปลงจำนวน USD → THB ด้วยเรตปัจจุบัน (ปัด 2 ตำแหน่ง)', async () => {
    mockFrankfurterSuccess(35.25);

    const res = await fxRateService.convertUsdToThb(100);

    expect(res).toEqual({ thb: 3525, rate: 35.25, asOf: '2026-07-11', stale: false });
  });

  test('ดึงเรตไม่ได้เลย → คืน null (การแสดงผลต้อง Fallback แสดงเฉพาะ USD เอง)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

    await expect(fxRateService.convertUsdToThb(100)).resolves.toBeNull();
  });

  test('ปัดเศษถูกต้อง: 33.33 USD × 35 = 1166.55', async () => {
    mockFrankfurterSuccess(35);

    const res = await fxRateService.convertUsdToThb(33.33);
    expect(res.thb).toBe(1166.55);
  });
});
