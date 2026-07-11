// Price Feed Service — ดึงราคาตลาดปัจจุบันเป็นเงินบาท (THB)
//
// Scope ขั้นนี้: Crypto ผ่าน CoinGecko Public API (ไม่ต้องใช้ Key) และหุ้นสหรัฐ
// (stock_us) ผ่าน Twelve Data (ต้องใช้ TWELVE_DATA_API_KEY + แปลง USD→THB) —
// หุ้นไทยยังไม่มี Free API ที่น่าเชื่อถือพอ เก็บไว้ทำทีหลัง
//
// หน้าที่ของไฟล์นี้ "บอกว่าจะไปหาราคาจากไหน" ต่างจาก symbolRegistry.service.js
// ที่ "บอกว่า Symbol นั้นเป็นสินทรัพย์ประเภทใด" — จึงแยก Mapping กันคนละไฟล์
// ไม่ปนกัน (Registry อาจรู้จัก Symbol แต่ยังไม่มีแหล่งราคาก็ได้ เช่น หุ้นไทย)
//
// ใช้ symbolRegistry เพื่อ "จัดเส้นทาง" ว่า Symbol ไหนไป CoinGecko/Twelve Data
// (symbolRegistry ไม่ได้ import ไฟล์นี้กลับ จึงไม่เกิด Circular Dependency)

const symbolRegistry = require('./symbolRegistry.service');

const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';

// ระยะเวลารอ CoinGecko สูงสุดก่อนถือว่า Timeout — ป้องกันไม่ให้ Flow ตอบกลับ
// LINE (ต้องเร็ว) ค้างรอราคานานเกินไปหาก CoinGecko ช้า/ไม่ตอบ
const REQUEST_TIMEOUT_MS = 5000;

// TTL ของ Cache = 60 วินาที — เลือกค่านี้เพื่อสมดุลระหว่าง:
//  (1) ราคายัง "สดพอ" สำหรับการบันทึก DCA (คลาดเคลื่อนได้ไม่เกิน 1 นาที
//      ไม่มีนัยสำคัญต่อการบันทึกธุรกรรมระยะยาว), และ
//  (2) ไม่ยิง CoinGecko ถี่เกินไป — Free Tier มี Rate Limit ต่ำมาก
//      (ราว ~5-15 req/นาที) ถ้าหลาย User ยิงคำสั่งซื้อ Symbol เดียวกัน
//      พร้อมกัน Cache 60 วินาทีจะยุบเหลือ 1 Request จริงต่อ Symbol/นาที
const CACHE_TTL_MS = 60 * 1000;

// Symbol → CoinGecko ID — ครอบคลุมเฉพาะ Crypto ที่ symbolRegistry รู้จักตอนนี้
// (BTC, ETH, USDT, BNB, XRP, SOL, DOGE, ADA) ถ้าเพิ่ม Crypto ใหม่ใน Registry
// ต้องเพิ่ม Mapping ที่นี่ด้วย มิฉะนั้นจะหาราคาไม่ได้ (คืน null)
const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  BNB: 'binancecoin',
  XRP: 'ripple',
  SOL: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
};

// In-memory Cache ระดับ Module (อยู่ในหน่วยความจำของ Process เดียว)
// โครงสร้าง: Map<symbol, { price: number, expiresAt: number }>
//
// ⚠️ คำเตือนเรื่อง Scale: Cache นี้ผูกกับ Process เดียว ถ้าวันหน้า Scale เป็น
// Multi-instance (เช่น Railway scale up หลาย Replica) แต่ละ Instance จะมี
// Cache แยกกัน ไม่ Sync กัน → รวมกันอาจยิง CoinGecko เกิน Rate Limit ได้อยู่ดี
// ต้องย้ายไปใช้ Shared Cache (Redis) แทนตอนนั้น
const priceCache = new Map();

// ── Twelve Data (หุ้นสหรัฐ) ────────────────────────────────────────────────
const TWELVE_DATA_QUOTE_URL = 'https://api.twelvedata.com/quote';
const TWELVE_DATA_EXCHANGE_RATE_URL = 'https://api.twelvedata.com/exchange_rate';
const USD_THB_PAIR = 'USD/THB';

// TTL ของอัตราแลกเปลี่ยน USD/THB = 10 นาที (นานกว่าราคาหุ้น 60 วินาที) โดยตั้งใจ
// เพราะ FX Rate ผันผวนช้ากว่าราคาหุ้นรายตัวมาก — Cache นานขึ้นช่วยลดจำนวน Request
// (Twelve Data Free Tier จำกัดราว 8 req/นาที, 800 req/วัน) โดยไม่กระทบความแม่นยำ
// ของการบันทึก DCA อย่างมีนัยสำคัญ
const FX_RATE_CACHE_TTL_MS = 10 * 60 * 1000;

// Cache แยกกัน 2 ชุด (ไม่ปนกับ priceCache ของ Crypto เพื่อไม่แตะ Logic เดิม):
//  - stockPriceCache: ราคาหุ้น "เป็น THB แล้ว" TTL 60 วินาที (เท่า Crypto)
//  - fxRateCache: อัตราแลกเปลี่ยน USD/THB TTL 10 นาที
const stockPriceCache = new Map();
const fxRateCache = new Map();

// ราคา "เป็น USD ตามจริง" (Native) TTL 60 วินาที — ใช้เฉพาะ Multi-Currency Round 10
// ตอนผู้ใช้ซื้อ/ขายด้วย "จำนวนเงินรวมเป็น USD" (ต้องหาร quantity จากราคา USD ไม่ใช่ THB
// เพราะบันทึกธุรกรรมเป็น USD ตามจริง) — แยก Cache จาก stockPriceCache (ที่เก็บ THB)
const usdPriceCache = new Map();

// ── ทองคำไทย (Phase 3 Round 7) ─────────────────────────────────────────────
// Community API ที่ Scrape ราคาจากสมาคมค้าทองคำแห่งประเทศไทย (ไม่มี API ทางการ /
// ไม่ต้อง Auth) — ยิงครั้งเดียวได้ราคาทั้งทองคำแท่งและทองรูปพรรณพร้อมกัน
const THAI_GOLD_API_URL = 'https://api.chnwt.dev/thai-gold-api/latest';

// TTL 10 นาที (เท่า FX Rate) — API ชุมชนไม่มี SLA + ราคาทองไทยอัปเดตไม่กี่ครั้ง/วัน
// (ต่างจาก Crypto ที่ผันผวนวินาทีต่อวินาที) จึง Cache นานได้โดยไม่กระทบความแม่นยำ
const GOLD_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

// goldType (canonical — ตรงกับ assets.type) → Key ใน response.price ของ API
// ⚠️ ยืนยันจาก Response จริง + Doc ทางการของ API: ทองรูปพรรณใช้ Key 'gold'
// (ไม่ใช่ 'gold_ornament' ตามที่พรอมต์สมมติไว้) ส่วนทองคำแท่งใช้ 'gold_bar'
const GOLD_API_PRICE_KEY = {
  gold_bar: 'gold_bar',
  gold_ornament: 'gold',
};

// Cache ราคาทอง TTL 10 นาที — Map<goldType, { buy, sell, updatedAt, expiresAt }>
// (แยกจาก Cache อื่นทั้งหมด ไม่แตะ Logic เดิม)
const goldPriceCache = new Map();

// ── กองทุนรวมไทย (SEC Open Data API — Round 7) ──────────────────────────────
// Endpoint 1 (Daily NAV) — Verified Live แล้ว (ยิงจริงได้ 401 เมื่อไม่มี Key)
// จึง Hardcode Path นี้ได้ (ยืนยันแล้ว)
const SEC_NAV_URL = 'https://api.sec.or.th/v2/fund/daily-info/nav';
// Base สำหรับประกอบ Path Endpoint 2 (Master List) ที่มาจาก Env
const SEC_API_BASE = 'https://api.sec.or.th';

// ⚠️ Endpoint 2 (Fund Master List) — Path ยัง "UNVERIFIED" (ยังไม่เคยยิงจริง เพราะ
// ยังไม่มี Key + Portal ต้อง Login) จึงอ่าน Path จาก Env เต็ม ห้าม Hardcode —
// ถ้า Env ขึ้นต้นด้วยคำนี้ให้ถือว่า "ยังไม่ได้ตั้งค่า" (กันยิง Request ด้วย Path ปลอม)
const SEC_PATH_PLACEHOLDER_PREFIX = 'UNVERIFIED';

// TTL: NAV อัปเดตวันละครั้ง → Cache 6 ชม. | Master List เปลี่ยนน้อยมาก → 24 ชม.
const NAV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FUND_MASTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// จำนวนวันย้อนหลังที่ดึง NAV มาเผื่อหา "วันล่าสุดที่มี last_val จริง" (วันหยุด/ยังไม่
// อัปเดต ค่าจะว่าง ต้อง Fallback ไปวันก่อนหน้า ไม่ปัดเป็น 0)
const NAV_LOOKBACK_DAYS = 10;
// เพดานจำนวนหน้าที่ไล่ next_cursor ของ Master List (กัน Loop ไม่รู้จบถ้า API เพี้ยน)
const FUND_MASTER_MAX_PAGES = 200;

const navCache = new Map(); // Map<`${projId}|${className}`, { navDate, lastVal, expiresAt }>
let fundMasterCache = null; // { items: [...], expiresAt } — ทั้ง Master List (Cache รวม)

// ยิง CoinGecko แล้วคืนราคา THB เป็น Number — คืน null ถ้าล้มเหลวทุกกรณี
// (Network error, Timeout, Status ไม่ใช่ 2xx, Response ไม่มีราคาที่คาดไว้)
// ไม่ throw เพื่อให้ getCurrentPrice จัดการ Fallback ได้ที่เดียว
async function fetchPriceFromCoinGecko(coingeckoId) {
  const url =
    `${COINGECKO_SIMPLE_PRICE_URL}?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=thb`;

  // AbortController ตัด Request ที่ค้างเกิน REQUEST_TIMEOUT_MS ทิ้ง
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[priceFeed] CoinGecko API failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    const price = data?.[coingeckoId]?.thb;

    // ราคาต้องเป็นตัวเลขบวกที่ Finite เท่านั้น — กัน Response รูปแบบผิด/ว่าง
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      console.error(`[priceFeed] CoinGecko returned no valid price for ${coingeckoId}`);
      return null;
    }

    return price;
  } catch (err) {
    console.error(`[priceFeed] CoinGecko request error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ยิง CoinGecko คืน "ราคาเป็น USD" (Number) — Pattern เดียวกับ fetchPriceFromCoinGecko
// แต่ vs_currencies=usd (ใช้สำหรับ Multi-Currency Round 10) คืน null ถ้าล้มเหลว ไม่ throw
async function fetchCryptoPriceUsd(coingeckoId) {
  const url =
    `${COINGECKO_SIMPLE_PRICE_URL}?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[priceFeed] CoinGecko USD price failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    const price = data?.[coingeckoId]?.usd;

    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      console.error(`[priceFeed] CoinGecko returned no valid USD price for ${coingeckoId}`);
      return null;
    }

    return price;
  } catch (err) {
    console.error(`[priceFeed] CoinGecko USD request error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ยิง Twelve Data /quote คืน "ราคาปิดล่าสุดเป็น USD" (Number) — คืน null ถ้า
// ล้มเหลวทุกกรณี (เช่นเดียวกับ CoinGecko) ไม่ throw
async function fetchUsStockPriceUsd(symbol, apiKey) {
  const url =
    `${TWELVE_DATA_QUOTE_URL}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[priceFeed] Twelve Data quote API failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    // /quote คืน field "close" เป็น String เช่น "185.92" (ราคาปิดล่าสุด) — เมื่อ
    // Error Twelve Data คืน { status:'error', code, message } (ไม่มี close) ทำให้
    // Number(undefined) = NaN แล้วถูกกรองด้วยเงื่อนไข Finite ด้านล่าง
    const priceUsd = Number(data?.close);

    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      console.error(
        `[priceFeed] Twelve Data returned no valid close for ${symbol}: ${data?.message ?? ''}`
      );
      return null;
    }

    return priceUsd;
  } catch (err) {
    console.error(`[priceFeed] Twelve Data quote request error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ยิง Twelve Data /exchange_rate คืน "จำนวน THB ต่อ 1 USD" (Number) — คืน null
// ถ้าล้มเหลว ไม่ throw
async function fetchUsdThbRate(apiKey) {
  const url =
    `${TWELVE_DATA_EXCHANGE_RATE_URL}?symbol=${encodeURIComponent(USD_THB_PAIR)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[priceFeed] Twelve Data exchange_rate API failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    // /exchange_rate คืน { symbol:'USD/THB', rate: 35.xx, ... } — rate = THB ต่อ 1 USD
    const rate = Number(data?.rate);

    if (!Number.isFinite(rate) || rate <= 0) {
      console.error(
        `[priceFeed] Twelve Data returned no valid USD/THB rate: ${data?.message ?? ''}`
      );
      return null;
    }

    return rate;
  } catch (err) {
    console.error(`[priceFeed] Twelve Data exchange_rate request error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// อัตราแลกเปลี่ยน USD/THB พร้อม Cache 10 นาที (ห้าม Cache null — Retry ได้ทันที
// เหมือน Pattern Crypto)
async function getUsdThbRate(apiKey) {
  const cached = fxRateCache.get(USD_THB_PAIR);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rate;
  }

  const rate = await fetchUsdThbRate(apiKey);
  if (rate === null) return null;

  fxRateCache.set(USD_THB_PAIR, { rate, expiresAt: Date.now() + FX_RATE_CACHE_TTL_MS });
  return rate;
}

// Public wrapper: อัตราแลกเปลี่ยน USD→THB (จำนวน THB ต่อ 1 USD) สำหรับแปลง "ราคา
// ที่ผู้ใช้พิมพ์เป็น USD" → THB ในคำสั่งซื้อ/ขาย — Reuse getUsdThbRate(apiKey) +
// fxRateCache เดิม (ไม่เขียน FX Conversion ใหม่) อ่าน TWELVE_DATA_API_KEY จาก env
// เองแบบเดียวกับ getUsStockPriceThb คืน null ถ้า Key ไม่ได้ตั้ง / ดึง Rate ไม่ได้
// (Caller ต้องโยน Error ให้ผู้ใช้ ไม่ Fallback เป็นเรตเดา)
async function getUsdThbFxRate() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    console.error('[priceFeed] Twelve Data API key (TWELVE_DATA_API_KEY) is not configured');
    return null;
  }

  return getUsdThbRate(apiKey);
}

// ราคาหุ้นสหรัฐเป็น THB = ราคา USD × อัตราแลกเปลี่ยน USD/THB
// (rate = จำนวน THB ต่อ 1 USD จึงต้อง "คูณ" ไม่ใช่ "หาร") — Cache ราคา THB 60s
// คืน null ถ้า Key ไม่ได้ตั้ง / ราคา / rate อย่างใดอย่างหนึ่งหาไม่ได้
async function getUsStockPriceThb(symbol) {
  // อ่านจาก process.env โดยตรง (config/env.js ก็ Expose ไว้ที่ twelveData.apiKey)
  // เพื่อให้ไฟล์นี้ไม่ต้อง import config/env ที่มี Side Effect validateEnv ตอน require
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    console.error('[priceFeed] Twelve Data API key (TWELVE_DATA_API_KEY) is not configured');
    return null;
  }

  const cached = stockPriceCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.price;
  }

  // ดึงราคาหุ้นก่อน — ถ้าหุ้นหาราคาไม่ได้ ไม่ต้องเปลือง Request ดึง FX ต่อ
  const priceUsd = await fetchUsStockPriceUsd(symbol, apiKey);
  if (priceUsd === null) return null;

  const rate = await getUsdThbRate(apiKey);
  if (rate === null) return null;

  const priceThb = priceUsd * rate;

  stockPriceCache.set(symbol, { price: priceThb, expiresAt: Date.now() + CACHE_TTL_MS });
  return priceThb;
}

// แปลงราคาทองจาก String ของ API ("69,523.76") → Number (69523.76)
// คืน null ถ้าว่าง/ไม่ใช่ตัวเลขบวก — เช่นก่อนตลาดเปิด API คืน "" (สังเกตจริงตอน
// ~06:38 น. เวลาไทย) ต้องถือเป็น "ราคายังไม่พร้อม" ไม่ใช่ 0 (กันบันทึกราคา 0)
function parseThaiGoldPrice(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ยิง Thai Gold API แล้วแยกราคาทั้ง 2 ประเภท คืน
//   { gold_bar: {buy,sell}|null, gold_ornament: {buy,sell}|null, updatedAt: string|null }
// หรือ null ถ้า "ยิงไม่ได้จริง" (Network/Timeout/Status ไม่ 2xx/JSON เพี้ยน/status≠success)
// — แยกแยะจากกรณี "ยิงได้แต่ราคาบางประเภทว่าง" (คืน object โดย Field ประเภทนั้นเป็น null)
// เพื่อให้ getGoldPriceThb ตัดสิน GOLD_PRICE_UNAVAILABLE เฉพาะประเภทที่ขอได้ถูกต้อง
async function fetchThaiGoldPrices() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(THAI_GOLD_API_URL, { method: 'GET', signal: controller.signal });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[priceFeed] Thai Gold API failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    const price = data?.response?.price;
    if (data?.status !== 'success' || !price) {
      console.error('[priceFeed] Thai Gold API returned unexpected shape');
      return null;
    }

    // ประกอบราคาต่อประเภท — ต้องได้ทั้ง buy และ sell เป็นเลขบวก มิฉะนั้นประเภทนั้น = null
    const buildType = (node) => {
      const buy = parseThaiGoldPrice(node?.buy);
      const sell = parseThaiGoldPrice(node?.sell);
      return buy !== null && sell !== null ? { buy, sell } : null;
    };

    return {
      gold_bar: buildType(price.gold_bar),
      gold_ornament: buildType(price.gold), // ⚠️ ทองรูปพรรณ = Key 'gold' ใน API
      updatedAt:
        [data.response.update_date, data.response.update_time].filter(Boolean).join(' ') || null,
    };
  } catch (err) {
    console.error(`[priceFeed] Thai Gold API request error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ราคาทองปัจจุบันเป็น THB ของประเภทที่ระบุ ({ buy, sell, updatedAt }) — Number ทั้งคู่
//  - buy  = ราคาสมาคม "รับซื้อคืน" (ลูกค้าได้ราคานี้ตอนขาย → ใช้ตีมูลค่าพอร์ต/กำไร)
//  - sell = ราคาสมาคม "ขายออก" (ลูกค้าจ่ายราคานี้ตอนซื้อทองใหม่ → ใช้เป็นต้นทุน Default)
//
// ⚠️ throw Error(code='GOLD_PRICE_UNAVAILABLE') ถ้าดึงไม่ได้/Format ผิด/ราคาประเภทนี้ว่าง
// (ไม่เดาราคา) — ต่างจาก getCurrentPrice/getUsStockPriceThb ที่คืน null โดยเจตนา
// (getCurrentPrice จะห่อ getGoldPriceThb ด้วย try/catch แล้วคืน null เองสำหรับ
//  Use Case สรุปพอร์ตที่ต้องข้าม Asset ราคาไม่ได้แทนที่จะพังทั้งงาน)
//
// ยิง API ครั้งเดียวได้ราคาทั้ง 2 ประเภท → Cache ทั้งคู่พร้อมกัน (ลด Request ครึ่งหนึ่ง
// เมื่อผู้ใช้ถือทองทั้ง 2 ประเภท)
async function getGoldPriceThb(goldType) {
  const priceKey = GOLD_API_PRICE_KEY[goldType];
  if (!priceKey) {
    const err = new Error(`Unknown gold type: ${goldType}`);
    err.code = 'GOLD_PRICE_UNAVAILABLE';
    throw err;
  }

  const cached = goldPriceCache.get(goldType);
  if (cached && cached.expiresAt > Date.now()) {
    return { buy: cached.buy, sell: cached.sell, updatedAt: cached.updatedAt };
  }

  const all = await fetchThaiGoldPrices();
  if (all === null) {
    const err = new Error('Thai gold price feed unavailable');
    err.code = 'GOLD_PRICE_UNAVAILABLE';
    throw err;
  }

  // Cache ทุกประเภทที่ได้ราคาครบ (ห้าม Cache null — Retry ได้ทันทีเหมือน Pattern Crypto)
  const expiresAt = Date.now() + GOLD_PRICE_CACHE_TTL_MS;
  for (const type of ['gold_bar', 'gold_ornament']) {
    if (all[type]) {
      goldPriceCache.set(type, { ...all[type], updatedAt: all.updatedAt, expiresAt });
    }
  }

  const result = all[goldType];
  if (!result) {
    const err = new Error(`Gold price for ${goldType} is unavailable (empty/invalid)`);
    err.code = 'GOLD_PRICE_UNAVAILABLE';
    throw err;
  }

  return { buy: result.buy, sell: result.sell, updatedAt: all.updatedAt };
}

// สร้าง Error ที่มี code (Pattern เดียวกับ Service Error อื่น) ให้ Caller แปลไทยได้
function secError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// อ่าน Subscription Key จาก Env — คืน null ถ้าไม่ได้ตั้ง (ห้าม Hardcode)
function getSecKey() {
  const key = process.env.SEC_API_SUBSCRIPTION_KEY;
  return key && key.trim() ? key.trim() : null;
}

// อ่าน Path ของ Endpoint 2 (Master List) จาก Env — คืน null ถ้ายังไม่ตั้ง หรือยังเป็น
// Placeholder "UNVERIFIED..." (ถือว่ายังไม่ได้ตั้งค่า จะได้ไม่ยิง Request ด้วย Path ปลอม)
function getFundMasterPath() {
  const raw = process.env.SEC_FUND_MASTER_LIST_PATH;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().startsWith(SEC_PATH_PLACEHOLDER_PREFIX)) return null;
  return trimmed;
}

// วันที่รูปแบบ YYYY-MM-DD (Asia/Bangkok) ย้อนหลัง n วันจากวันนี้ — ใช้ทำ Date Range
// ให้ SEC NAV Endpoint (คำนวณเองในไฟล์นี้ ไม่ import transaction.service กัน Circular)
function bangkokDateMinusDays(days) {
  const now = Date.now();
  const d = new Date(now - days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
}

// แปลงค่า NAV (last_val) จาก API เป็น Number บวก — Defensive: รับได้ทั้ง number และ
// string (เผื่อ Field จริงต่างจากตัวอย่าง) คืน null ถ้า null/0/ติดลบ/ไม่ใช่ตัวเลข
// (กัน Mark-to-market ด้วยราคา 0 ตอน บลจ. ยังไม่อัปเดต NAV ของวัน)
function parseNav(raw) {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'string' ? Number(raw.replace(/,/g, '').trim()) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ยิง SEC NAV Endpoint (Endpoint 1 — Verified) ดึง NAV ของ proj_id + fund_class_name
// ในช่วง NAV_LOOKBACK_DAYS วันล่าสุด แล้วเลือก "วันที่ล่าสุดที่มี last_val ใช้ได้จริง"
// คืน { navDate, lastVal } หรือ null ถ้ายิงไม่ได้/ไม่มีข้อมูลใช้ได้เลย (Caller ตัดสิน)
async function fetchLatestFundNav(projId, fundClassName, apiKey) {
  const endDate = bangkokDateMinusDays(0);
  const startDate = bangkokDateMinusDays(NAV_LOOKBACK_DAYS);
  const url =
    `${SEC_NAV_URL}?proj_id=${encodeURIComponent(projId)}` +
    `&fund_class_name=${encodeURIComponent(fundClassName)}` +
    `&start_nav_date=${startDate}&end_nav_date=${endDate}&page_size=100`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[priceFeed] SEC NAV API failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : null;
    if (!items) {
      console.error('[priceFeed] SEC NAV API returned unexpected shape (no items[])');
      return null;
    }

    // เลือกเฉพาะ Row ของ Class ที่ขอ (Defensive — เผื่อ API ไม่กรอง fund_class_name ให้)
    // ที่มี last_val ใช้ได้ แล้วเอา nav_date ล่าสุดสุด (Fallback ข้ามวันที่ค่าว่างเอง)
    let best = null;
    for (const item of items) {
      if (item?.fund_class_name && item.fund_class_name !== fundClassName) continue;
      const lastVal = parseNav(item?.last_val);
      if (lastVal === null) continue;
      const navDate = item?.nav_date ?? '';
      if (!best || navDate > best.navDate) {
        best = { navDate, lastVal };
      }
    }

    return best; // null ถ้าไม่มี Row ไหนมี last_val ใช้ได้ในช่วงนั้น
  } catch (err) {
    console.error(`[priceFeed] SEC NAV request error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// NAV ล่าสุดของกองทุน (proj_id + fund_class_name) — { navDate, lastVal } เป็น Number
// ⚠️ throw เสมอเมื่อดึงไม่ได้ (ไม่เดาราคา) เพื่อให้ Caller แปลเป็นข้อความไทยชัดเจน:
//   - SEC_NOT_CONFIGURED         : ไม่ได้ตั้ง SEC_API_SUBSCRIPTION_KEY (ไม่ยิง Request)
//   - MUTUAL_FUND_NAV_UNAVAILABLE: ดึงไม่ได้/ไม่มี last_val ใช้ได้ในช่วงที่ค้น
// Cache 6 ชม. ต่อคู่ (projId|className) — ห้าม Cache ค่า Error (Retry ได้ทันที)
async function getMutualFundNav(projId, fundClassName) {
  if (!projId || !fundClassName) {
    throw secError(
      'MUTUAL_FUND_NAV_UNAVAILABLE',
      `getMutualFundNav requires proj_id and fund_class_name (got ${projId}, ${fundClassName})`
    );
  }

  const apiKey = getSecKey();
  if (!apiKey) {
    throw secError(
      'SEC_NOT_CONFIGURED',
      'SEC_API_SUBSCRIPTION_KEY is not configured — cannot fetch mutual fund NAV'
    );
  }

  const cacheKey = `${projId}|${fundClassName}`;
  const cached = navCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { navDate: cached.navDate, lastVal: cached.lastVal };
  }

  const nav = await fetchLatestFundNav(projId, fundClassName, apiKey);
  if (nav === null) {
    throw secError(
      'MUTUAL_FUND_NAV_UNAVAILABLE',
      `No usable NAV for ${projId} / ${fundClassName} in the last ${NAV_LOOKBACK_DAYS} days`
    );
  }

  navCache.set(cacheKey, { ...nav, expiresAt: Date.now() + NAV_CACHE_TTL_MS });
  return nav;
}

// โหลด Fund Master List ทั้งหมด (Endpoint 2) แบบไล่ next_cursor — Cache 24 ชม.
// ⚠️ throw SEC_NOT_CONFIGURED (ไม่ยิง Request) ถ้าไม่มี Key หรือ Path ยังเป็น
// Placeholder/ไม่ได้ตั้ง | throw MUTUAL_FUND_LIST_UNAVAILABLE ถ้ายิงแล้วล้มเหลว
// คืน Array ของ items (Raw จาก API) — Parse แบบ Defensive ที่ mutualFund.service
async function fetchFundMasterList() {
  if (fundMasterCache && fundMasterCache.expiresAt > Date.now()) {
    return fundMasterCache.items;
  }

  const apiKey = getSecKey();
  const path = getFundMasterPath();
  if (!apiKey || !path) {
    // (h) ยังไม่ได้ตั้งค่า → Fail Gracefully "โดยไม่ยิง Request ออกไปจริง"
    throw secError(
      'SEC_NOT_CONFIGURED',
      'SEC fund master list is not configured (SEC_API_SUBSCRIPTION_KEY / SEC_FUND_MASTER_LIST_PATH) — request NOT sent'
    );
  }

  const baseUrl = /^https?:\/\//i.test(path) ? path : `${SEC_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const items = [];
  let cursor = null;
  try {
    for (let page = 0; page < FUND_MASTER_MAX_PAGES; page += 1) {
      const url = `${baseUrl}?page_size=100${cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ''}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let data;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Ocp-Apim-Subscription-Key': apiKey },
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          console.error(`[priceFeed] SEC fund list API failed: ${response.status} ${detail}`);
          throw secError('MUTUAL_FUND_LIST_UNAVAILABLE', `SEC fund list HTTP ${response.status}`);
        }
        data = await response.json();
      } finally {
        clearTimeout(timeout);
      }

      const pageItems = Array.isArray(data?.items) ? data.items : [];
      items.push(...pageItems);

      // next_cursor ว่าง/ไม่มี → จบ Pagination
      cursor = data?.next_cursor || null;
      if (!cursor || pageItems.length === 0) break;
    }
  } catch (err) {
    if (err.code) throw err;
    console.error(`[priceFeed] SEC fund list request error: ${err.message}`);
    throw secError('MUTUAL_FUND_LIST_UNAVAILABLE', `SEC fund list request error: ${err.message}`);
  }

  fundMasterCache = { items, expiresAt: Date.now() + FUND_MASTER_CACHE_TTL_MS };
  return items;
}

// คืนราคาปัจจุบันของ Symbol เป็น THB (Number) หรือ null ถ้าหาไม่ได้
//  - Symbol ไม่มีใน Mapping → คืน null ทันที ไม่ยิง API (ไม่เดา ไม่ throw)
//  - CoinGecko/Twelve Data ล้มเหลว/Timeout → คืน null (Caller ต้อง Fallback เอง)
// เจตนา: ไม่ throw เลย เพื่อให้ Caller (transaction.service) ตัดสินใจ Fallback
// เป็น PRICE_FEED_NOT_IMPLEMENTED ได้เมื่อราคาหาไม่ได้จริง ไม่ใช่ Error ชนิดใหม่
// หมายเหตุ: กองทุนรวม "ไม่" route ผ่าน getCurrentPrice เพราะ NAV ต้องใช้ proj_id +
// fund_class_name (symbol อย่างเดียวไม่พอ) — profit/portfolio เรียก getMutualFundNav ตรง
async function getCurrentPrice(symbol) {
  if (typeof symbol !== 'string') return null;
  const normalized = symbol.trim().toUpperCase();

  const type = symbolRegistry.lookupType(normalized);

  // หุ้นสหรัฐ (stock_us) → Twelve Data (แปลง USD→THB) — จัดเส้นทางก่อนแล้ว return
  // ไม่แตะ Logic Crypto (CoinGecko) ด้านล่างเลย
  if (type === 'stock_us') {
    return getUsStockPriceThb(normalized);
  }

  // ทองคำ → ราคา "รับซื้อคืน" (buy) สำหรับตีมูลค่าพอร์ต/กำไร (Mark-to-market)
  // getGoldPriceThb throw เมื่อดึงไม่ได้ แต่ getCurrentPrice ต้องคง Contract เดิม
  // (คืน null ถ้าหาราคาไม่ได้) เพื่อให้ผู้เรียกที่ Loop สรุปพอร์ต (portfolioSummary)
  // "ข้าม" Asset ที่ราคาไม่ได้แทนการพังทั้งงาน — จึงห่อ try/catch คืน null ที่นี่
  if (type === 'gold_bar' || type === 'gold_ornament') {
    try {
      const gold = await getGoldPriceThb(type);
      return gold.buy;
    } catch (err) {
      return null;
    }
  }

  const coingeckoId = COINGECKO_IDS[normalized];
  if (!coingeckoId) return null;

  // Cache Hit ที่ยังไม่หมดอายุ → ใช้เลย ไม่ยิง API
  const cached = priceCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.price;
  }

  const price = await fetchPriceFromCoinGecko(coingeckoId);

  // สำคัญ: ห้าม Cache ค่า null/Error — ปล่อยให้ Request ถัดไป Retry ทันที
  // ไม่ต้องรอ TTL หมด (ป้องกันกรณี CoinGecko ล้มชั่วคราวแล้ว User ติด Error
  // ยาวถึง 60 วินาทีทั้งที่ API อาจกลับมาทำงานแล้ว)
  if (price === null) return null;

  priceCache.set(normalized, { price, expiresAt: Date.now() + CACHE_TTL_MS });
  return price;
}

// คืนราคาปัจจุบันของ Symbol "เป็น USD ตามจริง" (Native, Number) หรือ null ถ้าหาไม่ได้
// — ใช้เฉพาะ Multi-Currency Round 10 ตอนซื้อ/ขายด้วย "จำนวนเงินรวมเป็น USD" เพื่อหาร
// quantity ให้ตรงสกุลที่บันทึก (ไม่แปลงผ่าน THB) รองรับ:
//   - หุ้นสหรัฐ (stock_us) → Twelve Data /quote (ราคา USD ดิบ ไม่คูณ FX)
//   - Crypto              → CoinGecko vs_currencies=usd
//   - อื่นๆ (หุ้นไทย/ทอง/กองทุน) → null (ไม่รองรับซื้อด้วยจำนวนเงิน USD)
// ไม่ throw (คืน null) เพื่อให้ transaction.service ตัดสิน PRICE_FEED_NOT_IMPLEMENTED เอง
async function getCurrentPriceUsd(symbol) {
  if (typeof symbol !== 'string') return null;
  const normalized = symbol.trim().toUpperCase();

  const cached = usdPriceCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.price;
  }

  const type = symbolRegistry.lookupType(normalized);
  let price = null;

  if (type === 'stock_us') {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      console.error('[priceFeed] Twelve Data API key (TWELVE_DATA_API_KEY) is not configured');
      return null;
    }
    price = await fetchUsStockPriceUsd(normalized, apiKey);
  } else if (COINGECKO_IDS[normalized]) {
    price = await fetchCryptoPriceUsd(COINGECKO_IDS[normalized]);
  } else {
    return null;
  }

  // ห้าม Cache null (Retry ทันที เหมือน Pattern อื่น)
  if (price === null) return null;

  usdPriceCache.set(normalized, { price, expiresAt: Date.now() + CACHE_TTL_MS });
  return price;
}

module.exports = {
  getCurrentPrice,
  getCurrentPriceUsd,
  getUsdThbFxRate,
  getGoldPriceThb,
  getMutualFundNav,
  fetchFundMasterList,
  COINGECKO_IDS,
};
