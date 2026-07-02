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

// คืนราคาปัจจุบันของ Symbol เป็น THB (Number) หรือ null ถ้าหาไม่ได้
//  - Symbol ไม่มีใน Mapping → คืน null ทันที ไม่ยิง API (ไม่เดา ไม่ throw)
//  - CoinGecko/Twelve Data ล้มเหลว/Timeout → คืน null (Caller ต้อง Fallback เอง)
// เจตนา: ไม่ throw เลย เพื่อให้ Caller (transaction.service) ตัดสินใจ Fallback
// เป็น PRICE_FEED_NOT_IMPLEMENTED ได้เมื่อราคาหาไม่ได้จริง ไม่ใช่ Error ชนิดใหม่
async function getCurrentPrice(symbol) {
  if (typeof symbol !== 'string') return null;
  const normalized = symbol.trim().toUpperCase();

  // หุ้นสหรัฐ (stock_us) → Twelve Data (แปลง USD→THB) — จัดเส้นทางก่อนแล้ว return
  // ไม่แตะ Logic Crypto (CoinGecko) ด้านล่างเลย
  if (symbolRegistry.lookupType(normalized) === 'stock_us') {
    return getUsStockPriceThb(normalized);
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

module.exports = {
  getCurrentPrice,
  COINGECKO_IDS,
};
