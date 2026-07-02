// Price Feed Service — ดึงราคาตลาดปัจจุบันเป็นเงินบาท (THB)
//
// Scope ขั้นนี้: รองรับเฉพาะ Crypto ผ่าน CoinGecko Public API (ไม่ต้องใช้ API
// Key) — หุ้นไทย/สหรัฐ ยังไม่มี Free API ที่น่าเชื่อถือพอ เก็บไว้ทำทีหลัง
//
// หน้าที่ของไฟล์นี้ "บอกว่าจะไปหาราคาจากไหน" ต่างจาก symbolRegistry.service.js
// ที่ "บอกว่า Symbol นั้นเป็นสินทรัพย์ประเภทใด" — จึงแยก Mapping กันคนละไฟล์
// ไม่ปนกัน (Registry อาจรู้จัก Symbol แต่ยังไม่มีแหล่งราคาก็ได้ เช่น หุ้น)

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

// คืนราคาปัจจุบันของ Symbol เป็น THB (Number) หรือ null ถ้าหาไม่ได้
//  - Symbol ไม่มีใน Mapping → คืน null ทันที ไม่ยิง API (ไม่เดา ไม่ throw)
//  - CoinGecko ล้มเหลว/Timeout → คืน null (Caller ต้อง Fallback เอง)
// เจตนา: ไม่ throw เลย เพื่อให้ Caller (transaction.service) ตัดสินใจ Fallback
// เป็น PRICE_FEED_NOT_IMPLEMENTED ได้เมื่อราคาหาไม่ได้จริง ไม่ใช่ Error ชนิดใหม่
async function getCurrentPrice(symbol) {
  if (typeof symbol !== 'string') return null;
  const normalized = symbol.trim().toUpperCase();

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
