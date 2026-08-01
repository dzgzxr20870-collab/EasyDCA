import { describe, test, expect, vi } from 'vitest';
import {
  resolveStockLogoUrl,
  resolveCoingeckoId,
  getCryptoLogoUrl,
  readCache,
  writeCache,
  SUCCESS_TTL_MS,
  ERROR_TTL_MS,
} from './assetLogo.js';

// Fake localStorage แบบง่าย — Repo นี้ไม่มี jsdom (vitest environment = 'node' ตาม
// vite.config.js ที่ไม่ได้ระบุ) จึงไม่มี window.localStorage จริงให้ใช้ ทุกฟังก์ชัน
// ใน assetLogo.js จึงรับ storage เป็น Parameter แทนการอ้าง window ตรงๆ (Inject ได้)
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    _dump: () => data,
  };
}

describe('resolveStockLogoUrl', () => {
  test('Symbol ที่อยู่ใน Map → คืน URL cdn.tickerlogos.com/{domain}', () => {
    expect(resolveStockLogoUrl('AAPL')).toBe('https://cdn.tickerlogos.com/apple.com');
    expect(resolveStockLogoUrl('PTT')).toBe('https://cdn.tickerlogos.com/pttplc.com');
  });

  test('รับ Symbol ตัวพิมพ์เล็ก (case-insensitive เหมือนจุดอื่นของระบบ)', () => {
    expect(resolveStockLogoUrl('aapl')).toBe('https://cdn.tickerlogos.com/apple.com');
  });

  test('Symbol ที่ไม่อยู่ใน Curated Map → null (ให้ Caller Fallback ทันที ไม่ยิง Request เปล่า)', () => {
    expect(resolveStockLogoUrl('EOSE')).toBeNull();
    expect(resolveStockLogoUrl('NOTREAL')).toBeNull();
  });

  test.each([[null], [undefined], [123]])('Input ที่ไม่ใช่ String ปกติ (%s) → null ไม่ Throw', (value) => {
    expect(resolveStockLogoUrl(value)).toBeNull();
  });
});

describe('resolveCoingeckoId', () => {
  test('Crypto ทั้ง 8 ตัวใน Registry มี id ครบ', () => {
    const symbols = ['BTC', 'ETH', 'USDT', 'BNB', 'XRP', 'SOL', 'DOGE', 'ADA'];
    for (const s of symbols) {
      expect(resolveCoingeckoId(s)).not.toBeNull();
    }
  });

  test('Symbol ที่ไม่ใช่ Crypto → null', () => {
    expect(resolveCoingeckoId('AAPL')).toBeNull();
  });
});

describe('readCache / writeCache', () => {
  test('เขียนแล้วอ่านได้ค่าเดิม (status=ok)', () => {
    const storage = fakeStorage();
    writeCache(storage, 'BTC', { status: 'ok', url: 'https://example.com/btc.png' });
    expect(readCache(storage, 'BTC')).toMatchObject({ status: 'ok', url: 'https://example.com/btc.png' });
  });

  test('ไม่มี Cache เลย → null', () => {
    expect(readCache(fakeStorage(), 'BTC')).toBeNull();
  });

  test('storage เป็น null (localStorage ถูกปิด/Private Mode) → readCache/writeCache ไม่ Throw', () => {
    expect(() => readCache(null, 'BTC')).not.toThrow();
    expect(readCache(null, 'BTC')).toBeNull();
    expect(() => writeCache(null, 'BTC', { status: 'ok', url: 'x' })).not.toThrow();
  });

  test('JSON เสียใน Storage → readCache คืน null แทนที่จะ Throw', () => {
    const storage = fakeStorage({ 'easydca:logo:BTC': '{not valid json' });
    expect(readCache(storage, 'BTC')).toBeNull();
  });

  test('Cache status=ok หมดอายุหลัง SUCCESS_TTL_MS → null (ต้องดึงใหม่)', () => {
    const storage = fakeStorage();
    const now = Date.now();
    storage.setItem(
      'easydca:logo:BTC',
      JSON.stringify({ status: 'ok', url: 'x', cachedAt: now - SUCCESS_TTL_MS - 1 })
    );
    expect(readCache(storage, 'BTC')).toBeNull();
  });

  test('Cache status=ok ยังไม่หมดอายุ (เกือบครบ TTL) → ยังอ่านได้', () => {
    const storage = fakeStorage();
    const now = Date.now();
    storage.setItem(
      'easydca:logo:BTC',
      JSON.stringify({ status: 'ok', url: 'x', cachedAt: now - SUCCESS_TTL_MS + 1000 })
    );
    expect(readCache(storage, 'BTC')).not.toBeNull();
  });

  test('Cache status=error ใช้ TTL สั้นกว่า status=ok (ลองใหม่เร็วกว่าเมื่อเคยพลาด)', () => {
    const storage = fakeStorage();
    const now = Date.now();
    // อายุเกิน ERROR_TTL_MS แต่ยังไม่เกิน SUCCESS_TTL_MS — status=error ต้องถือว่าหมดอายุแล้ว
    storage.setItem(
      'easydca:logo:BTC',
      JSON.stringify({ status: 'error', cachedAt: now - ERROR_TTL_MS - 1000 })
    );
    expect(readCache(storage, 'BTC')).toBeNull();
  });
});

describe('getCryptoLogoUrl', () => {
  test('Symbol ที่ไม่ใช่ Crypto → null ทันที ไม่ยิง fetch เลย', async () => {
    const fetchImpl = vi.fn();
    const result = await getCryptoLogoUrl('AAPL', { fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('มี Cache ที่ยังไม่หมดอายุ (status=ok) → คืนค่าจาก Cache ไม่ยิง fetch', async () => {
    const storage = fakeStorage();
    writeCache(storage, 'BTC', { status: 'ok', url: 'https://cached.example/btc.png' });
    const fetchImpl = vi.fn();

    const result = await getCryptoLogoUrl('BTC', { storage, fetchImpl });

    expect(result).toBe('https://cached.example/btc.png');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('มี Cache status=error ที่ยังไม่หมดอายุ → คืน null ไม่ยิงซ้ำ (กันหา CoinGecko รัว)', async () => {
    const storage = fakeStorage();
    writeCache(storage, 'BTC', { status: 'error' });
    const fetchImpl = vi.fn();

    const result = await getCryptoLogoUrl('BTC', { storage, fetchImpl });

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('Cache Miss + fetch สำเร็จ → คืน image URL และเขียน Cache status=ok', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'bitcoin', image: 'https://coin-images.coingecko.com/btc.png' }],
    });

    const result = await getCryptoLogoUrl('BTC', { storage, fetchImpl });

    expect(result).toBe('https://coin-images.coingecko.com/btc.png');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('ids=bitcoin'),
      expect.anything()
    );
    expect(readCache(storage, 'BTC')).toMatchObject({
      status: 'ok',
      url: 'https://coin-images.coingecko.com/btc.png',
    });
  });

  test('API ตอบ ok:false (เช่น 429 Rate Limit) → null + Cache status=error (ไม่ Throw)', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });

    const result = await getCryptoLogoUrl('BTC', { storage, fetchImpl });

    expect(result).toBeNull();
    expect(readCache(storage, 'BTC')).toMatchObject({ status: 'error' });
  });

  test('API ตอบสำเร็จแต่ไม่มี Field image (Array ว่าง) → null + Cache status=error', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });

    const result = await getCryptoLogoUrl('BTC', { storage, fetchImpl });

    expect(result).toBeNull();
    expect(readCache(storage, 'BTC')).toMatchObject({ status: 'error' });
  });

  test('fetch throw Network Error → null (ไม่หลุด Exception ออกไปนอกฟังก์ชัน)', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getCryptoLogoUrl('BTC', { storage, fetchImpl })).resolves.toBeNull();
    expect(readCache(storage, 'BTC')).toMatchObject({ status: 'error' });
  });

  test('Timeout (fetch ค้างเกิน timeoutMs) → null ภายในเวลาที่กำหนด ไม่ค้างรอตลอดไป', async () => {
    const storage = fakeStorage();
    // fetch ที่ resolve ตาม AbortSignal จริง (จำลอง Network ค้าง) — ใช้ Timer จริง
    // สั้นๆ (10ms) แทน Fake Timer เพื่อเลี่ยงความซับซ้อนของ Fake Timer กับ Promise
    // Microtask queue (พฤติกรรมเดียวกัน แค่ย่อเวลาให้ Test เร็ว)
    const fetchImpl = vi.fn(
      (_url, { signal } = {}) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
    );

    const result = await getCryptoLogoUrl('BTC', { storage, fetchImpl, timeoutMs: 10 });

    expect(result).toBeNull();
    expect(readCache(storage, 'BTC')).toMatchObject({ status: 'error' });
  }, 2000);

  test('เรียกพร้อมกัน 2 ครั้งต่อ Symbol เดียวกัน (Cache Miss) → fetch แค่ครั้งเดียว (Dedupe)', async () => {
    const storage = fakeStorage();
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      return { ok: true, json: async () => [{ image: 'https://x/btc.png' }] };
    });

    const [a, b] = await Promise.all([
      getCryptoLogoUrl('BTC', { storage, fetchImpl }),
      getCryptoLogoUrl('BTC', { storage, fetchImpl }),
    ]);

    expect(a).toBe('https://x/btc.png');
    expect(b).toBe('https://x/btc.png');
    expect(callCount).toBe(1);
  });

  test('ไม่มี fetchImpl เลย (Environment ไม่รองรับ fetch) → null ไม่ Throw', async () => {
    const result = await getCryptoLogoUrl('BTC', { storage: fakeStorage(), fetchImpl: null });
    expect(result).toBeNull();
  });
});
