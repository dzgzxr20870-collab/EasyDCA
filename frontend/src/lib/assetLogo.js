// ═══════════════════════════════════════════════════════════════════════
// assetLogo — โลโก้สินทรัพย์บน Dashboard (Presentation ล้วน, ไม่แตะ Logic การเงิน)
// ═══════════════════════════════════════════════════════════════════════
// หลักการ: "ไม่มี Logo ที่มั่นใจไม่ได้ว่าถูกบริษัท" — ดีกว่าเดา Domain ผิดแล้วโชว์
// โลโก้บริษัทอื่น (สร้างความเข้าใจผิด) จึงมี Map เฉพาะสินทรัพย์ที่มั่นใจ Domain 100%
// เท่านั้น ตัวที่ไม่อยู่ใน Map จะ Fallback ไปตัวอักษรย่อ+สี (ดีไซน์เดิมของเว็บที่มี
// อยู่แล้วทุกจุด) โดยอัตโนมัติ — เพิ่ม Domain ตัวใหม่เข้า Map ทีหลังได้เรื่อยๆ
//
// 2 แหล่งโลโก้ตาม Asset Type:
//   - crypto: CoinGecko API (Public, ไม่ต้อง Key) — ไม่มี URL รูปตายตัว ต้องยิง API
//     หา Field `image` ก่อนเสมอ (Async) จึง Cache ผลไว้ใน localStorage กัน Async ซ้ำ
//   - stock_th/stock_us: cdn.tickerlogos.com/{domain} (ตัวแทน Clearbit Logo API ที่
//     ปิดตัวไปแล้ว 8 ธ.ค. 2568 — ยืนยันจากการค้นหาก่อนเลือกใช้ ไม่ได้เดา) เป็น URL
//     รูปตรงๆ (Sync) ไม่ต้อง Fetch เอง — คืน 404 สะอาดเมื่อไม่เจอ ให้ <img onError>
//     จัดการ Fallback ได้เลย ไม่ต้อง Cache (Browser HTTP Cache จัดการซ้ำให้อยู่แล้ว)
//   - gold_bar/gold_ornament: ไม่มีโลโก้บริษัท (ไม่ใช่หุ้น) → Fallback เสมอ

// ── Stock Domain Map — Curated เฉพาะตัวที่มั่นใจ Domain จริง 100% ──────────────
// (ตามที่ตกลง: Coverage ~50-60 ตัวหลักก่อน ตัวที่เหลือ Fallback เป็นตัวอักษรย่อ
// ไม่ใช่ Broken Image — เพิ่มตัวใหม่เข้ามาทีหลังได้ ไม่ต้องทำให้ครบทีเดียว)
const STOCK_LOGO_DOMAINS = {
  // ── หุ้นไทย (SET) ───────────────────────────────────────────────────
  PTT: 'pttplc.com',
  CPALL: 'cpall.co.th',
  AOT: 'airportthai.co.th',
  ADVANC: 'ais.co.th',
  SCB: 'scb.co.th',
  KBANK: 'kasikornbank.com',
  BBL: 'bangkokbank.com',
  PTTEP: 'pttep.com',
  SCC: 'scg.com',
  GULF: 'gulf.co.th',
  INTUCH: 'intouchcompany.com',
  TRUE: 'true.th',
  DELTA: 'deltaww.com',
  OR: 'pttor.com',
  BDMS: 'bangkokhospital.com',
  CPN: 'centralpattana.co.th',
  MINT: 'minor.com',
  KTB: 'ktb.co.th',
  TTB: 'ttbbank.com',
  CPF: 'cpfworldwide.com',
  IVL: 'indoramaventures.com',

  // ── Magnificent 7 + Big Tech ────────────────────────────────────────
  AAPL: 'apple.com',
  MSFT: 'microsoft.com',
  GOOGL: 'google.com',
  GOOG: 'google.com',
  AMZN: 'amazon.com',
  META: 'meta.com',
  TSLA: 'tesla.com',
  NVDA: 'nvidia.com',

  // ── เซมิคอนดักเตอร์ ───────────────────────────────────────────────────
  AMD: 'amd.com',
  INTC: 'intel.com',
  AVGO: 'broadcom.com',
  QCOM: 'qualcomm.com',
  TXN: 'ti.com',
  ORCL: 'oracle.com',
  CRM: 'salesforce.com',
  ADBE: 'adobe.com',

  // ── การเงิน/ธนาคาร US ────────────────────────────────────────────────
  JPM: 'jpmorganchase.com',
  BAC: 'bankofamerica.com',
  WFC: 'wellsfargo.com',
  GS: 'goldmansachs.com',
  V: 'visa.com',
  MA: 'mastercard.com',
  PYPL: 'paypal.com',

  // ── สุขภาพ ──────────────────────────────────────────────────────────
  JNJ: 'jnj.com',
  UNH: 'unitedhealthgroup.com',
  PFE: 'pfizer.com',

  // ── สินค้าอุปโภคบริโภค ──────────────────────────────────────────────
  WMT: 'walmart.com',
  COST: 'costco.com',
  KO: 'coca-cola.com',
  PEP: 'pepsico.com',
  MCD: 'mcdonalds.com',
  SBUX: 'starbucks.com',
  NKE: 'nike.com',
  DIS: 'disney.com',

  // ── พลังงาน/อุตสาหกรรม ──────────────────────────────────────────────
  XOM: 'exxonmobil.com',
  CVX: 'chevron.com',
  BA: 'boeing.com',

  // ── อื่นๆ ที่ใช้บ่อย ──────────────────────────────────────────────────
  NFLX: 'netflix.com',
  UBER: 'uber.com',
  ABNB: 'airbnb.com',
  COIN: 'coinbase.com',
};

// ── Crypto CoinGecko ID Map — ตายตัวมานาน ไม่เปลี่ยนบ่อย (id เป็น slug ถาวร) ──
const CRYPTO_COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  BNB: 'binancecoin',
  XRP: 'ripple',
  SOL: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
};

// URL โลโก้หุ้นแบบ Sync — คืน null ถ้าไม่มี Domain ใน Map (ให้ Caller Fallback ทันที
// โดยไม่ต้องลองยิง Request ที่รู้อยู่แล้วว่าไม่มีทางเจอ)
function resolveStockLogoUrl(symbol) {
  const domain = STOCK_LOGO_DOMAINS[String(symbol ?? '').toUpperCase()];
  return domain ? `https://cdn.tickerlogos.com/${domain}` : null;
}

// coingeckoId ของ Symbol — คืน null ถ้าไม่รู้จัก (Crypto นอก Registry 8 ตัวนี้)
function resolveCoingeckoId(symbol) {
  return CRYPTO_COINGECKO_IDS[String(symbol ?? '').toUpperCase()] ?? null;
}

// ── Cache (localStorage) เฉพาะฝั่ง Crypto ───────────────────────────────────
// สถานะที่เก็บ 2 แบบ TTL ต่างกัน: 'ok' (เจอโลโก้จริง) เก็บนาน เพราะโลโก้เหรียญไม่
// เปลี่ยนบ่อย / 'error' (ยิง API ไม่สำเร็จ/ไม่มีโลโก้) เก็บสั้นกว่า กันไม่ให้ค้าง
// สถานะ "ไม่มีโลโก้" ถาวรทั้งที่จริงๆ อาจเป็นแค่ปัญหาชั่วคราว (Network/Timeout)
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน
const ERROR_TTL_MS = 24 * 60 * 60 * 1000; // 1 วัน
const CACHE_PREFIX = 'easydca:logo:';

// storage เป็น Parameter (ไม่ใช้ window.localStorage ตรงๆ ในนี้) เพื่อ Test ได้โดย
// ไม่ต้องมี jsdom (Repo นี้ยังไม่มี jsdom/RTL ติดตั้ง — ดู dashboardComponents.render
// .test.js) — Component เป็นคน Inject localStorage จริงตอนใช้งานจริง
function readCache(storage, symbol) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_PREFIX + symbol);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ttl = parsed.status === 'ok' ? SUCCESS_TTL_MS : ERROR_TTL_MS;
    if (typeof parsed.cachedAt !== 'number' || Date.now() - parsed.cachedAt > ttl) return null;
    return parsed;
  } catch {
    // localStorage ถูกปิด (Private Mode) หรือ JSON เสีย — ข้ามไปเงียบๆ เหมือน Cache Miss
    return null;
  }
}

function writeCache(storage, symbol, record) {
  if (!storage) return;
  try {
    storage.setItem(CACHE_PREFIX + symbol, JSON.stringify({ ...record, cachedAt: Date.now() }));
  } catch {
    // Storage เต็ม/ถูกปิด — ไม่ Throw ต่อ (Cache เป็นแค่ Optimization ไม่ใช่ Correctness)
  }
}

// กันยิง CoinGecko ซ้ำพร้อมกันหลาย Component บนหน้าเดียว (เช่น BTC โผล่ทั้ง
// RecentList + SidePanels พร้อมกัน) — Promise เดียวใช้ร่วมกันต่อ coingeckoId ต่อ
// 1 รอบโหลดหน้า (Module-level — รีเซ็ตเองเมื่อ Refresh หน้า ไม่ต้อง Clear มือ)
const inflightRequests = new Map();

// ดึง URL โลโก้ Crypto จาก CoinGecko — ไม่ throw เด็ดขาด (คืน null ทุกกรณีที่ล้มเหลว
// ให้ Caller Fallback เป็นตัวอักษรย่อได้เสมอ) พารามิเตอร์ fetchImpl/now Inject ได้
// เพื่อ Unit Test Timeout/Error โดยไม่ต้องพึ่ง Network จริง
async function getCryptoLogoUrl(symbol, options = {}) {
  const {
    storage = null,
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    timeoutMs = 5000,
  } = options;

  const coingeckoId = resolveCoingeckoId(symbol);
  if (!coingeckoId) return null;

  const cached = readCache(storage, symbol);
  if (cached) return cached.status === 'ok' ? cached.url : null;

  if (inflightRequests.has(coingeckoId)) {
    return inflightRequests.get(coingeckoId);
  }

  const promise = (async () => {
    if (!fetchImpl) return null;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coingeckoId}`,
        controller ? { signal: controller.signal } : undefined
      );

      if (!response || !response.ok) {
        writeCache(storage, symbol, { status: 'error' });
        return null;
      }

      const data = await response.json();
      const url = Array.isArray(data) && data[0] && typeof data[0].image === 'string' ? data[0].image : null;

      if (!url) {
        writeCache(storage, symbol, { status: 'error' });
        return null;
      }

      writeCache(storage, symbol, { status: 'ok', url });
      return url;
    } catch {
      // Network Error / Timeout (AbortError) / JSON เสีย — ทั้งหมดจบที่ Fallback เดียวกัน
      writeCache(storage, symbol, { status: 'error' });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  inflightRequests.set(coingeckoId, promise);
  try {
    return await promise;
  } finally {
    inflightRequests.delete(coingeckoId);
  }
}

export {
  resolveStockLogoUrl,
  resolveCoingeckoId,
  getCryptoLogoUrl,
  readCache,
  writeCache,
  SUCCESS_TTL_MS,
  ERROR_TTL_MS,
  STOCK_LOGO_DOMAINS,
  CRYPTO_COINGECKO_IDS,
};
