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

// In-memory Cache ระดับ Module (อยู่ในหน่วยความจำของ Process เดียว) — Crypto (CoinGecko)
// โครงสร้าง: Map<symbol, { thb?: number, usd?: number, expiresAt: number }>
// รวม THB + USD ไว้ Entry เดียวต่อ Symbol (แก้ Gap 2 — เดิมแยก priceCache/usdPriceCache
// คนละชุด ทำให้ getCurrentPrice/getCurrentPriceUsd ยิง CoinGecko คนละ Request สำหรับ
// Symbol เดียวกัน ทั้งที่ /simple/price รองรับ vs_currencies=thb,usd ในคำขอเดียวได้)
// Field thb/usd ที่ "ไม่มี" (undefined) หมายถึงสกุลนั้นยังไม่มี Cache ที่ใช้ได้ (ยิงไม่สำเร็จ
// ครั้งล่าสุด) ต้อง Fetch ใหม่ทันทีตอนถูกขอ ไม่ใช่รอ TTL เดิมของอีกสกุลหมดอายุ
//
// ⚠️ คำเตือนเรื่อง Scale: Cache นี้ผูกกับ Process เดียว ถ้าวันหน้า Scale เป็น
// Multi-instance (เช่น Railway scale up หลาย Replica) แต่ละ Instance จะมี
// Cache แยกกัน ไม่ Sync กัน → รวมกันอาจยิง CoinGecko เกิน Rate Limit ได้อยู่ดี
// ต้องย้ายไปใช้ Shared Cache (Redis) แทนตอนนั้น — ข้อจำกัดเดียวกันนี้ครอบคลุมถึง
// cryptoInFlightRequests ด้านล่างด้วย (Coalescing ทำงานแค่ภายใน Process เดียวกัน)
const cryptoPriceCache = new Map();

// Request Coalescing (แก้ Gap 1 — Dogpile): ถ้ามีการยิง CoinGecko สำหรับ Symbol นี้
// "ค้างอยู่แล้ว" (ยังไม่ Resolve) ให้รอ Promise เดิมแทนการยิงซ้ำ — กัน N Request พร้อมกัน
// ตอน Cache หมดอายุพอดี ยิง CoinGecko กลายเป็น N ครั้งทั้งที่ตั้งใจ Cache ไว้แค่ 1
// ครั้ง/นาที/Symbol อยู่แล้ว โครงสร้าง: Map<symbol, Promise<{thb, usd}>> — Key แยกตาม
// Symbol เพื่อให้ Symbol ต่างกันยิงพร้อมกันได้อิสระ ไม่ Serialize รวมกันเป็น Lock เดียว
// ทั้ง Module (จะทำให้ Latency ของ Symbol ที่ไม่เกี่ยวข้องกันแย่ลงโดยไม่ได้ประโยชน์อะไร)
const cryptoInFlightRequests = new Map();

// ── Twelve Data (หุ้นสหรัฐ) ────────────────────────────────────────────────
const TWELVE_DATA_QUOTE_URL = 'https://api.twelvedata.com/quote';
const TWELVE_DATA_EXCHANGE_RATE_URL = 'https://api.twelvedata.com/exchange_rate';
const USD_THB_PAIR = 'USD/THB';

// TTL ของอัตราแลกเปลี่ยน USD/THB = 10 นาที (นานกว่าราคาหุ้น 60 วินาที) โดยตั้งใจ
// เพราะ FX Rate ผันผวนช้ากว่าราคาหุ้นรายตัวมาก — Cache นานขึ้นช่วยลดจำนวน Request
// (Twelve Data Free Tier จำกัดราว 8 req/นาที, 800 req/วัน) โดยไม่กระทบความแม่นยำ
// ของการบันทึก DCA อย่างมีนัยสำคัญ
const FX_RATE_CACHE_TTL_MS = 10 * 60 * 1000;

// Cache แยกกัน 2 ชุด (ไม่ปนกับ cryptoPriceCache ของ Crypto เพื่อไม่แตะ Logic เดิม):
//  - stockPriceCache: ราคาหุ้น "เป็น THB แล้ว" TTL 60 วินาที (เท่า Crypto)
//  - fxRateCache: อัตราแลกเปลี่ยน USD/THB TTL 10 นาที
const stockPriceCache = new Map();
const fxRateCache = new Map();

// ราคา "เป็น USD ตามจริง" (Native) TTL 60 วินาที — ใช้เฉพาะ Multi-Currency Round 10
// ตอนผู้ใช้ซื้อ/ขายด้วย "จำนวนเงินรวมเป็น USD" (ต้องหาร quantity จากราคา USD ไม่ใช่ THB
// เพราะบันทึกธุรกรรมเป็น USD ตามจริง) — แยก Cache จาก stockPriceCache (ที่เก็บ THB)
// ⚠️ ใช้เฉพาะหุ้นสหรัฐ (stock_us) เท่านั้น — Crypto ย้ายไป cryptoPriceCache แล้ว
// (Entry เดียวกับราคา THB เพื่อยิง CoinGecko ครั้งเดียวได้ทั้งสองสกุล — แก้ Gap 2)
const usdPriceCache = new Map();

// ── Rate Limiter: Twelve Data Free Tier จำกัด 8 Credit/นาทีจริง (ยืนยันจาก
// Production Log — Burst 429 เกิดทุกคืนตอน Cron portfolioSnapshot เที่ยงคืนยิงหลาย
// Symbol รัวๆ ไม่มี Throttle คุมไว้เลย) ทั้ง /quote และ /exchange_rate ใช้ Budget
// เดียวกัน (Twelve Data นับรวมทุก Endpoint ต่อ API Key) จึงต้องมี Sliding Window
// เดียวคุมทั้งคู่
//
// Sliding Window (ไม่ใช่ Fixed Calendar-Minute แบบฝั่ง Twelve Data) ตั้งใจเข้มกว่า
// ของจริงเล็กน้อย กัน Burst คร่อมนาที (ยิง 8 ครั้งตอน :59 แล้วยิงอีก 8 ครั้งตอน :00
// ซึ่ง Fixed-Window ของเขาปล่อยผ่านได้ แต่ Sliding Window ของเรากันไว้)
const TWELVE_DATA_RATE_LIMIT = 8;
const TWELVE_DATA_WINDOW_MS = 60 * 1000;

// Retry เฉพาะตอนโดน 429 และ Caller "ยอมรอ" (allowRetry:true) เท่านั้น — สงวนไว้ให้
// Cron/Background Job (Latency ไม่สำคัญ) ส่วน Path ที่ User รอสด (Dashboard/ซื้อขาย)
// ไม่ส่ง allowRetry เลย (Default false) จะ Fail Fast เหมือนพฤติกรรมเดิมทุกประการ
const TWELVE_DATA_MAX_RETRIES = 3;
const TWELVE_DATA_RETRY_BACKOFF_MS = 15 * 1000; // Linear: 15s → 30s → 45s

let twelveDataTimestamps = []; // Sliding Window ของเวลาที่ "ยิงจริง" แต่ละ Request
// Serialize เฉพาะ Caller ที่ยอมรอ (allowRetry) กันคำนวณเวลาว่างพร้อมกันแล้วจองซ้อนกัน
// (Race) — Caller ที่ไม่ยอมรอ (Live) เช็ค/จองแบบ Sync ทันที ไม่ต้องเข้า Queue นี้
let twelveDataQueueTail = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneTwelveDataWindow(now) {
  while (twelveDataTimestamps.length && now - twelveDataTimestamps[0] >= TWELVE_DATA_WINDOW_MS) {
    twelveDataTimestamps.shift();
  }
}

function hasTwelveDataSlot(now) {
  pruneTwelveDataWindow(now);
  return twelveDataTimestamps.length < TWELVE_DATA_RATE_LIMIT;
}

// จองที่ตอน "จะยิง" ไม่ใช่ตอน "ยิงสำเร็จ" — Twelve Data นับ Credit ต่อ Request ที่ส่ง
// ไปจริง ไม่ใช่ต่อ Request ที่สำเร็จ (ยืนยันจาก Production Log: เลข Credit ไต่ขึ้นแม้
// Request นั้นเองโดน 429) นับผิดจะทำให้ Throttle ของเราหลวมกว่าของจริง
function reserveTwelveDataSlot() {
  twelveDataTimestamps.push(Date.now());
}

// รอจนกว่าจะมี Slot ว่างแล้วจองให้ทันที (Caller ที่ยอมรอ เช่น Cron) — ผ่าน Queue กลาง
// เดียวกันทั้ง Module กัน 2 Caller เช็ค/จองพร้อมกันแล้วนับซ้อน (Race)
function waitForTwelveDataSlot() {
  const task = twelveDataQueueTail.then(async () => {
    for (;;) {
      const now = Date.now();
      if (hasTwelveDataSlot(now)) {
        reserveTwelveDataSlot();
        return;
      }
      const waitMs = TWELVE_DATA_WINDOW_MS - (now - twelveDataTimestamps[0]) + 50;
      await sleep(waitMs);
    }
  });
  // กัน 1 Task Error ทำให้ Queue ตัน — Task ถัดไปต้องรันได้ต่อแม้ตัวก่อนหน้าพัง
  twelveDataQueueTail = task.catch(() => {});
  return task;
}

// ประตูเดียวก่อนยิง Twelve Data ทุกครั้ง (ทั้ง /quote และ /exchange_rate):
//  - allowRetry:true (Cron/Background) → รอจนมี Slot ว่างเสมอ ไม่ทิ้ง Request
//  - allowRetry:false (Live/Default) → มี Slot ว่างก็ยิงทันที ไม่มีก็คืน false ทันที
//    (รู้อยู่แล้วว่ายิงไปก็โดน 429 แน่ๆ — คืน null ให้ Caller เร็วกว่าเดิมด้วยซ้ำ แทนที่จะ
//    เปลือง Round-trip จริงไปโดนปฏิเสธ)
async function acquireTwelveDataSlot(allowRetry) {
  if (allowRetry) {
    await waitForTwelveDataSlot();
    return true;
  }
  if (hasTwelveDataSlot(Date.now())) {
    reserveTwelveDataSlot();
    return true;
  }
  return false;
}

// ── Request Coalescing สำหรับหุ้นสหรัฐ (Pattern เดียวกับ cryptoInFlightRequests
// ด้านบน — ปิด Gap ที่ Comment เดิมเคยระบุไว้ว่ามีแค่ฝั่ง Crypto) กัน 2 Request พร้อม
// กันของ Symbol/FX เดียวกันยิง Twelve Data ซ้ำตอน Cache หมดอายุพอดี (Dogpile) ซึ่ง
// เปลืองทั้ง Credit และเสี่ยงชน Rate Limit เร็วขึ้นโดยไม่จำเป็น
//
// ⚠️ Options (allowRetry) ของ Request ที่ "มาสมทบทีหลัง" ระหว่างมี In-flight Promise
// อยู่แล้วจะถูกละเว้น (ใช้ Options ของ Caller คนแรกที่สร้าง Promise) — Edge Case ที่
// ยอมรับได้เพราะจุดประสงค์ของ Coalescing คือลด Request ซ้ำ ไม่ได้ออกแบบมาให้แยก
// พฤติกรรมตาม Options ของแต่ละ Caller อยู่แล้ว
const stockQuoteInFlightRequests = new Map(); // symbol → Promise<number|null>
const fxRateInFlightRequests = new Map(); // USD_THB_PAIR → Promise<number|null>

function fetchCoalescedUsStockPriceUsd(symbol, apiKey, options) {
  const inFlight = stockQuoteInFlightRequests.get(symbol);
  if (inFlight) return inFlight;

  const promise = fetchUsStockPriceUsd(symbol, apiKey, options).finally(() => {
    stockQuoteInFlightRequests.delete(symbol);
  });
  stockQuoteInFlightRequests.set(symbol, promise);
  return promise;
}

function fetchCoalescedUsdThbRate(apiKey, options) {
  const inFlight = fxRateInFlightRequests.get(USD_THB_PAIR);
  if (inFlight) return inFlight;

  const promise = fetchUsdThbRate(apiKey, options).finally(() => {
    fxRateInFlightRequests.delete(USD_THB_PAIR);
  });
  fxRateInFlightRequests.set(USD_THB_PAIR, promise);
  return promise;
}

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

// ยิง CoinGecko "ครั้งเดียว" ได้ทั้งราคา THB และ USD (vs_currencies=thb,usd — แก้ Gap 2)
// คืน { thb: number|null, usd: number|null } — แต่ละสกุลตรวจสอบแยกกันเอง (ต้องเป็น
// ตัวเลขบวกที่ Finite มิฉะนั้นเป็น null) ไม่ปัดตกทั้ง Response แค่เพราะสกุลใดสกุลหนึ่ง
// มีปัญหา (เช่น CoinGecko อาจมี Response ผิดปกติเฉพาะบางสกุลได้) — คืน null ทั้งคู่เมื่อ
// ยิงไม่สำเร็จเลย (Network error, Timeout, Status ไม่ใช่ 2xx, Response Shape ผิด)
// ไม่ throw เพื่อให้ Caller จัดการ Fallback ได้ที่เดียว (Pattern เดิมของไฟล์นี้)
async function fetchCryptoPricesFromCoinGecko(coingeckoId) {
  const url =
    `${COINGECKO_SIMPLE_PRICE_URL}?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=thb,usd`;

  // AbortController ตัด Request ที่ค้างเกิน REQUEST_TIMEOUT_MS ทิ้ง
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[priceFeed] CoinGecko API failed: ${response.status} ${detail}`);
      return { thb: null, usd: null };
    }

    const data = await response.json();
    const rawThb = data?.[coingeckoId]?.thb;
    const rawUsd = data?.[coingeckoId]?.usd;

    // ราคาต้องเป็นตัวเลขบวกที่ Finite เท่านั้น — กัน Response รูปแบบผิด/ว่าง (ตรวจ
    // แยกรายสกุล — สกุลหนึ่งพังไม่ทำให้อีกสกุลที่ถูกต้องถูกทิ้งไปด้วย)
    const thb =
      typeof rawThb === 'number' && Number.isFinite(rawThb) && rawThb > 0 ? rawThb : null;
    const usd =
      typeof rawUsd === 'number' && Number.isFinite(rawUsd) && rawUsd > 0 ? rawUsd : null;

    if (thb === null) {
      console.error(`[priceFeed] CoinGecko returned no valid THB price for ${coingeckoId}`);
    }
    if (usd === null) {
      console.error(`[priceFeed] CoinGecko returned no valid USD price for ${coingeckoId}`);
    }

    return { thb, usd };
  } catch (err) {
    console.error(`[priceFeed] CoinGecko request error: ${err.message}`);
    return { thb: null, usd: null };
  } finally {
    clearTimeout(timeout);
  }
}

// Coalescing (แก้ Gap 1): ถ้ามี Fetch ของ Symbol นี้ค้างอยู่แล้ว คืน Promise เดิมแทน
// การยิง CoinGecko ซ้ำ — "ไม่ใช่" async function โดยตั้งใจ (ไม่มี await ในตัวมันเอง)
// เพื่อให้ทั้งการเช็ค Map, การเรียก fetchCryptoPricesFromCoinGecko, และการ Set Map
// เกิดขึ้น "Synchronous" ในจังหวะเดียวกันก่อน Caller จะ await — นี่คือสิ่งที่ทำให้ 2
// Request พร้อมกัน (Symbol เดียวกัน) เห็น In-flight Entry เดียวกันจริง ไม่ Race กัน
// ล้าง Entry ออกจาก Map ใน finally เสมอ (สำเร็จหรือพัง) ไม่งั้นรอบ Cache หมดอายุถัดไป
// จะเจอ Entry ค้าง (Stale) แทนที่จะเริ่ม Fetch ใหม่
function fetchCoalescedCryptoPrices(symbol, coingeckoId) {
  const inFlight = cryptoInFlightRequests.get(symbol);
  if (inFlight) return inFlight;

  const promise = fetchCryptoPricesFromCoinGecko(coingeckoId).finally(() => {
    cryptoInFlightRequests.delete(symbol);
  });
  cryptoInFlightRequests.set(symbol, promise);
  return promise;
}

// Cache ผลลัพธ์ที่ Fetch ได้ — เก็บเฉพาะสกุลที่สำเร็จ (ห้าม Cache ค่า null ตาม Pattern
// เดิมของไฟล์นี้ ปล่อยให้ Request ถัดไป Retry ทันทีไม่ต้องรอ TTL) ถ้าสำเร็จแค่สกุลเดียว
// ยัง Cache สกุลนั้นไว้ตามปกติ ไม่ทิ้งทั้งคู่เพียงเพราะอีกสกุลพัง (ดู Spec Gap 2)
//
// ⚠️ ต้อง Merge กับ Entry เดิมที่ยังไม่หมดอายุ ไม่ใช่สร้าง Entry ใหม่ทับทั้งก้อน — มิฉะนั้น
// ถ้ารอบ Fetch นี้ได้แค่สกุลเดียว (เช่น usd สำเร็จแต่ thb ล้มเหลวชั่วคราว) จะทำให้ thb ที่
// เพิ่งสำเร็จจากรอบก่อนหน้าและยังไม่หมดอายุถูกทิ้งไปด้วยทั้งที่ไม่มีอะไรผิดปกติกับค่านั้นเลย
// (Regression ที่พบตอน Review — บั่นทอนเป้าหมายของ Merged Cache ที่ต้องการลด Fetch)
function cacheCryptoPrices(symbol, prices) {
  if (prices.thb === null && prices.usd === null) return;

  const now = Date.now();
  const existing = cryptoPriceCache.get(symbol);
  // เริ่มจาก Field เดิมที่ยังไม่หมดอายุ (ถ้ามี) แล้วค่อยเอาผลรอบนี้ทับเฉพาะสกุลที่สำเร็จ
  // — สกุลที่รอบนี้ล้มเหลว (null) ต้องไม่ไปลบ/ทับ Field เดิมที่ยังใช้ได้
  const entry = existing && existing.expiresAt > now
    ? { thb: existing.thb, usd: existing.usd }
    : {};

  entry.expiresAt = now + CACHE_TTL_MS;
  if (prices.thb !== null) entry.thb = prices.thb;
  if (prices.usd !== null) entry.usd = prices.usd;
  cryptoPriceCache.set(symbol, entry);
}

// อ่าน/เติมราคา THB ของ Crypto Symbol หนึ่งตัว ผ่าน cryptoPriceCache ร่วมกับ
// getCryptoUsdPrice ด้านล่าง (Entry เดียวกัน) — Cache Hit เฉพาะเมื่อ field thb ของ
// Entry นี้ "มีอยู่จริง" (ไม่ใช่แค่ Entry ยังไม่หมดอายุ เพราะอีกสกุลอาจสำเร็จแต่ thb
// พังก็ได้ ต้องแยกเช็ครายสกุล)
async function getCryptoThbPrice(symbol, coingeckoId) {
  const cached = cryptoPriceCache.get(symbol);
  if (cached && cached.expiresAt > Date.now() && cached.thb !== undefined) {
    return cached.thb;
  }

  const prices = await fetchCoalescedCryptoPrices(symbol, coingeckoId);
  cacheCryptoPrices(symbol, prices);
  return prices.thb;
}

// อ่าน/เติมราคา USD ของ Crypto Symbol หนึ่งตัว — Pattern เดียวกับ getCryptoThbPrice
// (Entry/Cache/Coalescing เดียวกัน ต่างแค่ Field ที่อ่าน)
async function getCryptoUsdPrice(symbol, coingeckoId) {
  const cached = cryptoPriceCache.get(symbol);
  if (cached && cached.expiresAt > Date.now() && cached.usd !== undefined) {
    return cached.usd;
  }

  const prices = await fetchCoalescedCryptoPrices(symbol, coingeckoId);
  cacheCryptoPrices(symbol, prices);
  return prices.usd;
}

// ยิง Twelve Data /quote คืน "ราคาปิดล่าสุดเป็น USD" (Number) — คืน null ถ้า
// ล้มเหลวทุกกรณี (เช่นเดียวกับ CoinGecko) ไม่ throw
//
// options.allowRetry (Default false): true = ยอมรอ Throttle Slot ว่าง + Retry ด้วย
// Backoff เมื่อโดน 429 (สำหรับ Cron/Background ที่ไม่ Sensitive เรื่อง Latency) —
// false (Live/Default) = ไม่รอคิว ไม่ Retry เลย, Throttle เต็มก็คืน null ทันที
// (ประกันว่า User ไม่ต้องรอนานขึ้นจากที่เป็นอยู่)
async function fetchUsStockPriceUsd(symbol, apiKey, options = {}) {
  const { allowRetry = false } = options;
  const url =
    `${TWELVE_DATA_QUOTE_URL}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

  for (let attempt = 0; ; attempt += 1) {
    const acquired = await acquireTwelveDataSlot(allowRetry);
    if (!acquired) {
      console.error(
        `[priceFeed] Twelve Data throttled (8 credits/min ใช้ครบแล้ว) — ข้าม quote request สำหรับ ${symbol} โดยไม่ยิงจริง (Live Path ไม่รอคิว)`
      );
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error(`[priceFeed] Twelve Data quote API failed: ${response.status} ${detail}`);

        if (response.status === 429 && allowRetry && attempt < TWELVE_DATA_MAX_RETRIES) {
          await sleep(TWELVE_DATA_RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
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
}

// ยิง Twelve Data /exchange_rate คืน "จำนวน THB ต่อ 1 USD" (Number) — คืน null
// ถ้าล้มเหลว ไม่ throw — options.allowRetry ความหมายเดียวกับ fetchUsStockPriceUsd
async function fetchUsdThbRate(apiKey, options = {}) {
  const { allowRetry = false } = options;
  const url =
    `${TWELVE_DATA_EXCHANGE_RATE_URL}?symbol=${encodeURIComponent(USD_THB_PAIR)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  for (let attempt = 0; ; attempt += 1) {
    const acquired = await acquireTwelveDataSlot(allowRetry);
    if (!acquired) {
      console.error(
        `[priceFeed] Twelve Data throttled (8 credits/min ใช้ครบแล้ว) — ข้าม exchange_rate request โดยไม่ยิงจริง (Live Path ไม่รอคิว)`
      );
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error(`[priceFeed] Twelve Data exchange_rate API failed: ${response.status} ${detail}`);

        if (response.status === 429 && allowRetry && attempt < TWELVE_DATA_MAX_RETRIES) {
          await sleep(TWELVE_DATA_RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
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
}

// อัตราแลกเปลี่ยน USD/THB พร้อม Cache 10 นาที (ห้าม Cache null — Retry ได้ทันที
// เหมือน Pattern Crypto)
async function getUsdThbRate(apiKey, options = {}) {
  const cached = fxRateCache.get(USD_THB_PAIR);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rate;
  }

  const rate = await fetchCoalescedUsdThbRate(apiKey, options);
  if (rate === null) return null;

  fxRateCache.set(USD_THB_PAIR, { rate, expiresAt: Date.now() + FX_RATE_CACHE_TTL_MS });
  return rate;
}

// Public wrapper: อัตราแลกเปลี่ยน USD→THB (จำนวน THB ต่อ 1 USD) สำหรับแปลง "ราคา
// ที่ผู้ใช้พิมพ์เป็น USD" → THB ในคำสั่งซื้อ/ขาย — Reuse getUsdThbRate(apiKey) +
// fxRateCache เดิม (ไม่เขียน FX Conversion ใหม่) อ่าน TWELVE_DATA_API_KEY จาก env
// เองแบบเดียวกับ getUsStockPriceThb คืน null ถ้า Key ไม่ได้ตั้ง / ดึง Rate ไม่ได้
// (Caller ต้องโยน Error ให้ผู้ใช้ ไม่ Fallback เป็นเรตเดา)
// options ปกติไม่ถูกส่งมาจาก Caller ใดในโค้ดตอนนี้ (transaction.service เรียกตอน
// ซื้อ/ขายด้วยจำนวนเงิน USD — เป็น Live Path เสมอ) จึง Default allowRetry:false
// (Fail Fast) เหมือนเดิมทุกประการ — เก็บ Parameter ไว้เผื่ออนาคตมี Caller แบบ
// Cron/Background ต้องการอัตรานี้เหมือนกัน
async function getUsdThbFxRate(options = {}) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    console.error('[priceFeed] Twelve Data API key (TWELVE_DATA_API_KEY) is not configured');
    return null;
  }

  return getUsdThbRate(apiKey, options);
}

// ราคาหุ้นสหรัฐเป็น THB = ราคา USD × อัตราแลกเปลี่ยน USD/THB
// (rate = จำนวน THB ต่อ 1 USD จึงต้อง "คูณ" ไม่ใช่ "หาร") — Cache ราคา THB 60s
// คืน null ถ้า Key ไม่ได้ตั้ง / ราคา / rate อย่างใดอย่างหนึ่งหาไม่ได้
//
// options.allowRetry: true เฉพาะ Caller ฝั่ง Cron/Background (ดู getCurrentPrice)
async function getUsStockPriceThb(symbol, options = {}) {
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
  const priceUsd = await fetchCoalescedUsStockPriceUsd(symbol, apiKey, options);
  if (priceUsd === null) return null;

  const rate = await getUsdThbRate(apiKey, options);
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

// ประเภทสินทรัพย์ที่ระบบ Route ราคาได้จริง — ใช้ Validate knownType ที่รับมาจาก
// assets.type ก่อนเชื่อ (Data เก่า/ผิดปกติอาจมีค่านอกรายการนี้ได้ ต้องไม่เอาไป Route)
// ตรงกับ CHECK Constraint ของ assets.type ใน DATABASE.md § assets
const ROUTABLE_ASSET_TYPES = new Set([
  'crypto',
  'stock_th',
  'stock_us',
  'etf',
  'fund',
  'gold_bar',
  'gold_ornament',
]);

// เลือก "ประเภทสินทรัพย์" ที่จะใช้จัดเส้นทางราคา โดยให้ความสำคัญตามลำดับ:
//   1. knownType (assets.type จาก DB) — แหล่งความจริงสำหรับ Asset ที่มีอยู่แล้ว
//   2. symbolRegistry.lookupType(symbol) — Fallback สำหรับ Caller เดิมที่ไม่ได้ส่ง
//      Type มา (Path ฝั่ง "เขียน") และกรณี knownType ว่าง/ผิดรูปจาก Data เก่า
// คืน null เมื่อทั้งสองทางหาไม่ได้ → Caller คืน null ต่อ (ไม่เดา ไม่ยิง API)
function resolveAssetType(normalizedSymbol, knownType) {
  if (typeof knownType === 'string' && ROUTABLE_ASSET_TYPES.has(knownType)) {
    return knownType;
  }
  return symbolRegistry.lookupType(normalizedSymbol);
}

// คืนราคาปัจจุบันของ Symbol เป็น THB (Number) หรือ null ถ้าหาไม่ได้
//  - Symbol ไม่มีใน Mapping → คืน null ทันที ไม่ยิง API (ไม่เดา ไม่ throw)
//  - CoinGecko/Twelve Data ล้มเหลว/Timeout → คืน null (Caller ต้อง Fallback เอง)
// เจตนา: ไม่ throw เลย เพื่อให้ Caller (transaction.service) ตัดสินใจ Fallback
// เป็น PRICE_FEED_NOT_IMPLEMENTED ได้เมื่อราคาหาไม่ได้จริง ไม่ใช่ Error ชนิดใหม่
// หมายเหตุ: กองทุนรวม "ไม่" route ผ่าน getCurrentPrice เพราะ NAV ต้องใช้ proj_id +
// fund_class_name (symbol อย่างเดียวไม่พอ) — profit/portfolio เรียก getMutualFundNav ตรง
//
// knownType (Optional) — "ประเภทสินทรัพย์ที่รู้อยู่แล้ว" จาก assets.type ใน DB สำหรับ
// Path ฝั่ง "อ่าน" (Dashboard/Profit/Cron สรุปพอร์ต) ที่มี Asset อยู่ในมือแล้ว
// ⚠️ เหตุผลที่ต้องมี: Asset ที่สร้างผ่าน Manual Quantity Fallback (Round 10-B) มี
// assets.type ถูกต้องใน DB (เช่น 'stock_us') แต่ Symbol อาจยังไม่อยู่ใน symbolRegistry
// (ยังไม่มีใคร Manual เพิ่ม) — ถ้า Route ด้วย Registry อย่างเดียวจะได้ null ทั้งที่
// Type ที่ถูกต้องอยู่ในมือแล้ว (Root Cause ของบั๊ก EOSE/OKLO ที่เจอซ้ำ)
// Registry ยังคงเป็น Fallback (Defense in Depth) เมื่อ knownType ว่าง/ผิดรูป และยังเป็น
// แหล่งความจริงเดียวของ Path ฝั่ง "เขียน" (Validate Symbol ใหม่) ที่ไม่ได้แตะในงานนี้
async function getCurrentPrice(symbol, knownType = null, options = {}) {
  if (typeof symbol !== 'string') return null;
  const normalized = symbol.trim().toUpperCase();

  const type = resolveAssetType(normalized, knownType);

  // หุ้นสหรัฐ (stock_us) → Twelve Data (แปลง USD→THB) — จัดเส้นทางก่อนแล้ว return
  // ไม่แตะ Logic Crypto (CoinGecko) ด้านล่างเลย
  // options.allowRetry: true เฉพาะ Caller ฝั่ง Cron/Background (Throttle/Retry
  // ของ Twelve Data ดู priceFeed.service.js ส่วน Rate Limiter) — CoinGecko/ทองคำ
  // ด้านล่างไม่ใช้ options นี้เลย (Scope งานนี้คือ Twelve Data เท่านั้น)
  if (type === 'stock_us') {
    return getUsStockPriceThb(normalized, options);
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

  // Cache/Coalescing ร่วมกับ getCurrentPriceUsd (Entry เดียวกันต่อ Symbol — แก้ Gap 2)
  return getCryptoThbPrice(normalized, coingeckoId);
}

// คืนราคาปัจจุบันของ Symbol "เป็น USD ตามจริง" (Native, Number) หรือ null ถ้าหาไม่ได้
// — ใช้เฉพาะ Multi-Currency Round 10 ตอนซื้อ/ขายด้วย "จำนวนเงินรวมเป็น USD" เพื่อหาร
// quantity ให้ตรงสกุลที่บันทึก (ไม่แปลงผ่าน THB) รองรับ:
//   - หุ้นสหรัฐ (stock_us) → Twelve Data /quote (ราคา USD ดิบ ไม่คูณ FX)
//   - Crypto              → CoinGecko vs_currencies=usd
//   - อื่นๆ (หุ้นไทย/ทอง/กองทุน) → null (ไม่รองรับซื้อด้วยจำนวนเงิน USD)
// ไม่ throw (คืน null) เพื่อให้ transaction.service ตัดสิน PRICE_FEED_NOT_IMPLEMENTED เอง
//
// knownType (Optional) — เหตุผลและลำดับความสำคัญเหมือน getCurrentPrice ด้านบนทุกประการ
// (assets.type มาก่อน Registry เป็น Fallback) ดูคำอธิบายเต็มที่ resolveAssetType
async function getCurrentPriceUsd(symbol, knownType = null, options = {}) {
  if (typeof symbol !== 'string') return null;
  const normalized = symbol.trim().toUpperCase();

  const type = resolveAssetType(normalized, knownType);

  // Crypto (CoinGecko) — ใช้ cryptoPriceCache ร่วมกับ getCurrentPrice (Entry เดียวกัน
  // ต่อ Symbol แก้ Gap 2) แทน usdPriceCache เดิม — usdPriceCache ยังคงใช้เฉพาะหุ้น
  // สหรัฐด้านล่างเหมือนเดิมทุกประการ (ไม่แตะ Scope ของงานนี้)
  const coingeckoId = COINGECKO_IDS[normalized];
  if (coingeckoId) {
    return getCryptoUsdPrice(normalized, coingeckoId);
  }

  if (type === 'stock_us') {
    const cached = usdPriceCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.price;
    }

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      console.error('[priceFeed] Twelve Data API key (TWELVE_DATA_API_KEY) is not configured');
      return null;
    }

    const price = await fetchCoalescedUsStockPriceUsd(normalized, apiKey, options);

    // ห้าม Cache null (Retry ทันที เหมือน Pattern อื่น)
    if (price === null) return null;

    usdPriceCache.set(normalized, { price, expiresAt: Date.now() + CACHE_TTL_MS });
    return price;
  }

  return null;
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
