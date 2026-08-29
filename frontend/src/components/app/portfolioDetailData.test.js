// ═══════════════════════════════════════════════════════════════════════════
// portfolioDetailData — "ยิง API อะไร ด้วยพารามิเตอร์อะไร" ต้องพิสูจน์ได้
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ เหตุผลที่ไฟล์นี้มีอยู่: ความผิดพลาดที่อันตรายที่สุดของหน้านี้คือ **ลืมส่ง
// portfolioId** แล้วได้ตัวเลขของ "ทุกพอร์ตรวมกัน" มาแสดงบนหน้าพอร์ตเดียว ซึ่ง
// หน้าจอจะดูถูกต้องสมบูรณ์ทุกประการจนกว่าผู้ใช้จะเอาไปเทียบมือ
// → จึง assert ที่ **Argument จริงของ API** ไม่ใช่แค่ผลลัพธ์ที่ Render ออกมา
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • ถอด portfolioId ออกจาก fetchAllocationCached → เคส ⭐ แดง
//   • ถอด brokerId ออกจาก getAssetProfit → เคส "หลายโบรก" แดง
//   • ถอด `if (cache.has(key)) return` ออก → เคส Cache แดง

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/portfolioApi.js', () => ({
  getAllocation: vi.fn(),
  getAssetProfit: vi.fn(),
}));

import { getAllocation, getAssetProfit } from '../../lib/portfolioApi.js';
import {
  allocationCacheKey,
  profitCacheKey,
  holdingsForPortfolio,
  assetCountByPortfolio,
  fetchAllocationCached,
  fetchProfitsForPortfolio,
  MAX_PROFIT_FETCH,
} from './portfolioDetailData.js';

const P1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222';

// holdings ตาม Shape จริงของ GET /dashboard/portfolio (portfolio.service)
const HOLDINGS = [
  { symbol: 'BTC', portfolioId: P1, brokerId: 'bk-1', heldQuantity: 0.5, totalInvested: 1000, currency: 'THB' },
  { symbol: 'BTC', portfolioId: P1, brokerId: null, heldQuantity: 0.2, totalInvested: 400, currency: 'THB' },
  { symbol: 'PTT', portfolioId: P2, brokerId: null, heldQuantity: 100, totalInvested: 3400, currency: 'THB' },
];

beforeEach(() => {
  vi.clearAllMocks();
  getAllocation.mockResolvedValue({ groups: [], totalValueThb: 0, isEmpty: true });
  getAssetProfit.mockResolvedValue({ profitLoss: 10, profitLossPercent: 1 });
});

describe('กรอง/นับแถวตามพอร์ต — ไม่มีการคำนวณเงินเลย', () => {
  test('holdingsForPortfolio คืนเฉพาะแถวของพอร์ตนั้น', () => {
    expect(holdingsForPortfolio(HOLDINGS, P2)).toHaveLength(1);
    expect(holdingsForPortfolio(HOLDINGS, P1)).toHaveLength(2);
  });

  // ไม่มี portfolioId (ยังไม่ได้เลือกพอร์ต) → ไม่ใช่ "คืนทุกแถว"
  test('ไม่ระบุพอร์ต → คืนชุดว่าง ไม่ใช่ทั้งหมด', () => {
    expect(holdingsForPortfolio(HOLDINGS, null)).toEqual([]);
    expect(holdingsForPortfolio(undefined, P1)).toEqual([]);
  });

  test('assetCountByPortfolio นับแถวต่อพอร์ต', () => {
    expect(assetCountByPortfolio(HOLDINGS)).toEqual({ [P1]: 2, [P2]: 1 });
  });
});

describe('⭐ fetchAllocationCached — portfolioId ต้องไปถึง Backend จริง', () => {
  test('⭐ ยิง getAllocation ด้วย portfolioId ที่เลือก (ไม่ใช่ทั้งพอร์ตรวม)', async () => {
    await fetchAllocationCached(new Map(), { portfolioId: P2, groupBy: 'assetType' });

    expect(getAllocation).toHaveBeenCalledWith({ groupBy: 'assetType', portfolioId: P2 });
  });

  // หน้ารวม (โดนัทบนสุด) = ทุกพอร์ต → ต้อง **ไม่ส่ง** portfolioId ไปเลย
  test('หน้ารวม → portfolioId เป็น undefined ไม่ใช่ null', async () => {
    await fetchAllocationCached(new Map(), { portfolioId: null, groupBy: 'broker' });

    expect(getAllocation).toHaveBeenCalledWith({ groupBy: 'broker', portfolioId: undefined });
  });

  test('⭐ กดเข้าพอร์ตเดิมซ้ำ → ใช้ค่าที่จำไว้ ไม่ยิง API ซ้ำ', async () => {
    const cache = new Map();
    await fetchAllocationCached(cache, { portfolioId: P1, groupBy: 'assetType' });
    await fetchAllocationCached(cache, { portfolioId: P1, groupBy: 'assetType' });

    expect(getAllocation).toHaveBeenCalledTimes(1);
  });

  // สลับ "จัดกลุ่มตาม" = groups[] คนละชุด ห้ามใช้ Cache ข้ามกัน
  test('เปลี่ยน groupBy ของพอร์ตเดิม → ต้องยิงใหม่ (คนละ Cache Key)', async () => {
    const cache = new Map();
    await fetchAllocationCached(cache, { portfolioId: P1, groupBy: 'assetType' });
    await fetchAllocationCached(cache, { portfolioId: P1, groupBy: 'sector' });

    expect(getAllocation).toHaveBeenCalledTimes(2);
  });

  test('Cache Key แยกพอร์ต/กลุ่มออกจากกันจริง', () => {
    expect(allocationCacheKey(P1, 'assetType')).not.toBe(allocationCacheKey(P2, 'assetType'));
    expect(allocationCacheKey(P1, 'assetType')).not.toBe(allocationCacheKey(P1, 'sector'));
    expect(allocationCacheKey(null, 'assetType')).toContain('__all__');
  });
});

describe('⭐ fetchProfitsForPortfolio — กันแถวตกหล่นเงียบๆ และกัน Rate Limit', () => {
  // ⚠️ ไม่ส่ง brokerId = 409 AMBIGUOUS_ASSET_BROKER → แถวนั้นได้ null แล้วผู้ใช้
  // เห็นช่องว่างโดยไม่รู้สาเหตุ (เคสที่ portfolio.service เตือนไว้ตรงๆ)
  test('⭐ ส่งทั้ง portfolioId และ brokerId ของแต่ละแถว', async () => {
    await fetchProfitsForPortfolio(new Map(), {
      portfolioId: P1,
      rows: holdingsForPortfolio(HOLDINGS, P1),
    });

    expect(getAssetProfit).toHaveBeenCalledWith('BTC', { portfolioId: P1, brokerId: 'bk-1' });
    expect(getAssetProfit).toHaveBeenCalledWith('BTC', { portfolioId: P1, brokerId: null });
    expect(getAssetProfit).toHaveBeenCalledTimes(2);
  });

  // Symbol เดียวกันคนละโบรก = คนละแถว คนละต้นทุน ห้ามทับกันใน Map ผลลัพธ์
  test('⭐ BTC สองโบรกในพอร์ตเดียว → ผลลัพธ์ต้องแยกกัน ไม่ทับกัน', async () => {
    getAssetProfit
      .mockResolvedValueOnce({ profitLoss: 111 })
      .mockResolvedValueOnce({ profitLoss: 222 });

    const { profitBySymbol } = await fetchProfitsForPortfolio(new Map(), {
      portfolioId: P1,
      rows: holdingsForPortfolio(HOLDINGS, P1),
    });

    expect(Object.keys(profitBySymbol)).toHaveLength(2);
    expect(profitBySymbol[profitCacheKey(P1, 'BTC', 'bk-1')]).not.toEqual(
      profitBySymbol[profitCacheKey(P1, 'BTC', null)]
    );
  });

  test('⭐ กดเข้าพอร์ตเดิมซ้ำ → ไม่ยิง /profit ซ้ำ', async () => {
    const cache = new Map();
    const rows = holdingsForPortfolio(HOLDINGS, P1);
    await fetchProfitsForPortfolio(cache, { portfolioId: P1, rows });
    await fetchProfitsForPortfolio(cache, { portfolioId: P1, rows });

    expect(getAssetProfit).toHaveBeenCalledTimes(2); // 2 แถว × 1 รอบ
  });

  // แถวที่ยิงไม่ผ่าน (ไม่มีราคาสด / ขายหมดพอดี) ต้องไม่ล้มทั้งตาราง
  test('บางแถวล้ม → ได้ null เฉพาะแถวนั้น แถวอื่นยังมาครบ', async () => {
    getAssetProfit
      .mockRejectedValueOnce(new Error('PRICE_FEED_NOT_IMPLEMENTED'))
      .mockResolvedValueOnce({ profitLoss: 50 });

    const { profitBySymbol } = await fetchProfitsForPortfolio(new Map(), {
      portfolioId: P1,
      rows: holdingsForPortfolio(HOLDINGS, P1),
    });

    const values = Object.values(profitBySymbol);
    expect(values).toContain(null);
    expect(values.some((v) => v?.profitLoss === 50)).toBe(true);
  });

  // ⭐ Rate Limit Guard — พอร์ตใหญ่ต้องไม่ยิงรัวจนโดน 300 req/15 นาที เตะ
  test('⭐ สินทรัพย์เกินเพดาน → ไม่ยิงเลย + ตั้งธง capped (ตารางยังแสดงต้นทุนได้)', async () => {
    const many = Array.from({ length: MAX_PROFIT_FETCH + 1 }, (_, i) => ({
      symbol: `S${i}`,
      portfolioId: P1,
      brokerId: null,
    }));

    const { capped, profitBySymbol } = await fetchProfitsForPortfolio(new Map(), {
      portfolioId: P1,
      rows: many,
    });

    expect(capped).toBe(true);
    expect(getAssetProfit).not.toHaveBeenCalled();
    expect(profitBySymbol).toEqual({});
  });

  test('เกินเพดานแต่ผู้ใช้กดโหลดเอง (force) → ยิงให้ครบทุกแถว', async () => {
    const many = Array.from({ length: MAX_PROFIT_FETCH + 1 }, (_, i) => ({
      symbol: `S${i}`,
      portfolioId: P1,
      brokerId: null,
    }));

    const { capped } = await fetchProfitsForPortfolio(new Map(), {
      portfolioId: P1,
      rows: many,
      force: true,
    });

    expect(capped).toBe(false);
    expect(getAssetProfit).toHaveBeenCalledTimes(MAX_PROFIT_FETCH + 1);
  });
});
