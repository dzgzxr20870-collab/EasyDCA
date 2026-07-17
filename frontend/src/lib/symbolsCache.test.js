import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.js', () => ({ apiGet: vi.fn() }));

import { apiGet } from './api.js';
import { getAssetSymbols, __resetSymbolsCacheForTest } from './symbolsCache.js';

beforeEach(() => {
  __resetSymbolsCacheForTest();
  apiGet.mockReset();
});

describe('getAssetSymbols', () => {
  test('เรียกครั้งแรก → ยิง apiGet ไปที่ /api/v1/assets/symbols', async () => {
    apiGet.mockResolvedValue({ symbols: [{ symbol: 'BTC', name: 'Bitcoin', type: 'crypto' }] });

    const result = await getAssetSymbols();

    expect(apiGet).toHaveBeenCalledWith('/api/v1/assets/symbols');
    expect(result).toEqual([{ symbol: 'BTC', name: 'Bitcoin', type: 'crypto' }]);
  });

  test('เรียกซ้ำภายใน TTL → ใช้ Cache ไม่ยิงซ้ำ', async () => {
    apiGet.mockResolvedValue({ symbols: [{ symbol: 'BTC', name: 'Bitcoin', type: 'crypto' }] });

    await getAssetSymbols();
    await getAssetSymbols();
    await getAssetSymbols();

    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  test('เรียกพร้อมกันหลายครั้งก่อน Resolve → ยิงแค่ 1 ครั้ง (กัน Race)', async () => {
    let resolvePromise;
    apiGet.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const p1 = getAssetSymbols();
    const p2 = getAssetSymbols();
    resolvePromise({ symbols: [{ symbol: 'ETH', name: 'Ethereum', type: 'crypto' }] });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  test('กรอง type "fund" ทิ้ง (ไม่ควรมีตามสัญญา API แต่กันไว้)', async () => {
    apiGet.mockResolvedValue({
      symbols: [
        { symbol: 'BTC', name: 'Bitcoin', type: 'crypto' },
        { symbol: 'SOMEFUND', name: 'กองทุนปลอม', type: 'fund' },
      ],
    });

    const result = await getAssetSymbols();

    expect(result).toEqual([{ symbol: 'BTC', name: 'Bitcoin', type: 'crypto' }]);
  });
});
