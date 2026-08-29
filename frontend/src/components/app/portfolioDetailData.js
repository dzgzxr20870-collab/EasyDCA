import { getAllocation, getAssetProfit } from '../../lib/portfolioApi.js';

// ═══════════════════════════════════════════════════════════════════════════
// portfolioDetailData — การตัดสินใจ "ยิง API อะไร เมื่อไหร่" ของหน้าพอร์ต
// ═══════════════════════════════════════════════════════════════════════════
// แยกออกจาก Component ด้วยเหตุผลเดียวกับ `recordTransactionLogic.js`: repo นี้
// ไม่มี jsdom/RTL (Test ฝั่ง FE เป็น renderToStaticMarkup + Pure Function ล้วน)
// → **Effect ไม่ทำงานใน Test** ถ้าปล่อยตรรกะการโหลดไว้ใน useEffect จะไม่มีทาง
// พิสูจน์ได้เลยว่า "ยิง getAllocation ด้วย portfolioId ที่ถูกต้องจริงไหม" ซึ่งเป็น
// จุดที่พลาดแล้วผู้ใช้จับไม่ได้ (ได้ตัวเลขของ **ทั้งพอร์ตรวม** มาแสดงบนหน้าพอร์ต
// เดียว — ดูเหมือนถูกทุกประการจนกว่าจะเอาไปเทียบมือ)
//
// ⚠️ **ห้ามคำนวณเงินในไฟล์นี้** (กฎยืนข้อ 1) — ทำแค่ 3 อย่าง: กรองแถว, ตัดสินว่า
// จะยิงอะไร, และจำผลไว้ไม่ให้ยิงซ้ำ · ตัวเลขทุกตัวส่งต่อจาก Backend ตามที่ได้มา

// ── เพดานจำนวนคำขอต่อการเปิดพอร์ตหนึ่งครั้ง ────────────────────────────────
// /dashboard/profit ยิงได้ทีละ Symbol เท่านั้น (ไม่มี Endpoint รวม) การเปิดพอร์ต
// ที่มี N สินทรัพย์ = N คำขอ · app.js มี Rate Limiter 300 req/15 นาที/IP
//
// 15 = จุดที่ยัง "ยิงขนานทีเดียวจบ" ได้อย่างสบายใจ (ผู้ใช้จริงตอนนี้ถือหลักหน่วย)
// เกินกว่านี้ตารางจะยังแสดง **จำนวนที่ถือ + ต้นทุน** ครบทุกแถวตามปกติ (สองค่านั้น
// มาจาก /dashboard/portfolio คำขอเดียว) แต่ไม่เติมคอลัมน์กำไร/ขาดทุนอัตโนมัติ
// → ผู้ใช้กดโหลดเองได้ ไม่ใช่หน้าค้างหรือโดน Rate Limit เตะ
//
// ⚠️ นี่คือ "ทางออกชั่วคราวที่ปลอดภัย" ไม่ใช่คำตอบสุดท้าย — ทางแก้จริงคือ Endpoint
// รวมฝั่ง Backend (คืนกำไร/ขาดทุนทุกแถวในคำขอเดียว) ซึ่งอยู่นอกขอบเขตเฟสนี้
export const MAX_PROFIT_FETCH = 15;

// เพดานการ์ดที่ดึง "มูลค่ารวม" อัตโนมัติบนหน้ารวม — เหตุผลเดียวกับด้านบน
// (มูลค่ารายพอร์ตต้องยิง /portfolio/allocation?portfolioId= ทีละพอร์ต เพราะ
// groupBy รองรับแค่ broker/sector/assetType ไม่มี 'portfolio' — ตรวจแล้วที่
// allocation.service.GROUP_BY_OPTIONS) · Premium มีได้ถึง 50 พอร์ต (Sanity Cap)
export const MAX_CARD_VALUE_FETCH = 12;

// ── Cache Key ──────────────────────────────────────────────────────────────
// ⚠️ ต้องมี groupBy ด้วย — สลับ "จัดกลุ่มตาม" แล้ว groups[] เปลี่ยนทั้งชุด
// (totalValueThb เท่าเดิมก็จริง แต่ถ้า Cache ข้ามกันโดนัทจะวาดกลุ่มผิดแบบ)
export function allocationCacheKey(portfolioId, groupBy) {
  return `alloc|${portfolioId ?? '__all__'}|${groupBy}`;
}

// ⚠️ ต้องมี brokerId ด้วย — Symbol เดียวกันต่างโบรกคือคนละแถว คนละต้นทุน
export function profitCacheKey(portfolioId, symbol, brokerId) {
  return `profit|${portfolioId ?? '__all__'}|${symbol}|${brokerId ?? 'none'}`;
}

// แถวที่อยู่ในพอร์ตนี้ — กรองล้วน ไม่คำนวณอะไรเลย
// (holding.portfolioId Backend ประทับมาให้แล้วใน getPortfolioSummary)
export function holdingsForPortfolio(holdings, portfolioId) {
  if (!portfolioId) return [];
  return (holdings ?? []).filter((h) => h?.portfolioId === portfolioId);
}

// นับสินทรัพย์ต่อพอร์ตสำหรับการ์ดหน้ารวม — คืน { [portfolioId]: จำนวนแถว }
// ⚠️ "นับแถว" ไม่ใช่ "รวมเงิน" — ตัวเลขมูลค่ามาจาก allocation.totalValueThb เสมอ
export function assetCountByPortfolio(holdings) {
  const counts = {};
  for (const h of holdings ?? []) {
    if (!h?.portfolioId) continue;
    counts[h.portfolioId] = (counts[h.portfolioId] ?? 0) + 1;
  }
  return counts;
}

// ── ดึง Allocation แบบจำผล ────────────────────────────────────────────────
// cache = Map (Component ถือไว้ใน useRef · Test ส่ง Map เปล่าเข้ามาได้ตรงๆ)
export async function fetchAllocationCached(cache, { portfolioId, groupBy }) {
  const key = allocationCacheKey(portfolioId, groupBy);
  if (cache.has(key)) return cache.get(key);

  const data = await getAllocation({ groupBy, portfolioId: portfolioId ?? undefined });
  cache.set(key, data);
  return data;
}

// ── ดึงกำไร/ขาดทุนของทุกแถวในพอร์ต ────────────────────────────────────────
// คืน { profitBySymbol, capped } — key ของ profitBySymbol ใช้ profitCacheKey
// เพื่อไม่ให้ Symbol เดียวกันคนละโบรกทับกัน
//
// ⚠️ ล้มทีละแถวได้โดยไม่ล้มทั้งตาราง (.catch(() => null)) — Pattern เดียวกับ
// DashboardHome เดิม · สินทรัพย์ที่ยังไม่มีราคาสด (PRICE_FEED_NOT_IMPLEMENTED)
// หรือขายหมดพอดี (NO_HOLDING_TO_CALCULATE_PROFIT) ต้องแสดงเป็น "—" ในคอลัมน์
// กำไร ไม่ใช่ทำให้ทั้งหน้าพัง
export async function fetchProfitsForPortfolio(cache, { portfolioId, rows, force = false }) {
  const capped = !force && (rows?.length ?? 0) > MAX_PROFIT_FETCH;
  const targets = capped ? [] : rows ?? [];

  const pending = targets.filter(
    (h) => !cache.has(profitCacheKey(portfolioId, h.symbol, h.brokerId))
  );

  await Promise.all(
    pending.map((h) =>
      getAssetProfit(h.symbol, { portfolioId, brokerId: h.brokerId ?? null })
        .then((profit) => cache.set(profitCacheKey(portfolioId, h.symbol, h.brokerId), profit))
        .catch(() => cache.set(profitCacheKey(portfolioId, h.symbol, h.brokerId), null))
    )
  );

  const profitBySymbol = {};
  for (const h of targets) {
    const key = profitCacheKey(portfolioId, h.symbol, h.brokerId);
    profitBySymbol[key] = cache.get(key) ?? null;
  }

  return { profitBySymbol, capped };
}
