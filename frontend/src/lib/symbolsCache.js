import { apiGet } from './api.js';

// ═══════════════════════════════════════════════════════════════════════
// symbolsCache — Cache รายการสินทรัพย์ฝั่ง Client (S8 R1b)
// ═══════════════════════════════════════════════════════════════════════
// GET /api/v1/assets/symbols เป็นข้อมูล Static (Cache-Control: private,
// max-age=3600 — API.md §15.1) ไม่ต้องยิงซ้ำทุกครั้งที่เปิดฟอร์มบันทึก DCA
// เก็บใน Module-level State ระดับ Session เดียว (หายเมื่อ Full Reload — สอดคล้อง
// กับ JWT ที่เก็บใน Memory เท่านั้นอยู่แล้ว ไม่ต้อง Persist ข้าม Session)

const CACHE_TTL_MS = 60 * 60 * 1000; // ตรงกับ max-age=3600 ที่ Backend ส่งมา

let cache = null; // { symbols, fetchedAt } | null
let inFlight = null; // กัน Fetch ซ้ำถ้ามีหลาย Component เรียกพร้อมกัน (เช่น React
// StrictMode Mount ซ้ำใน Dev หรือ AssetPicker เปิด/ปิดเร็วๆ)

// กองทุนรวม (type 'fund') ต้อง "ไม่มีวันโผล่" ใน Dropdown เว็บ ตามสัญญา API.md
// §15.1 (Resolve ผ่าน LINE เท่านั้น) — กรองเชิงป้องกันอีกชั้น + เตือนใน Console
// ถ้าเจอจริง (ไม่ควรเกิดขึ้นเลยตามสัญญา — ถ้าเห็น Warning นี้แปลว่า Backend
// เบี่ยงจากสัญญาที่ตกลงกันไว้ ต้องแจ้งทีม Backend ไม่ใช่ปล่อยผ่านเงียบๆ)
function sanitize(symbols) {
  const filtered = [];
  for (const s of symbols ?? []) {
    if (s.type === 'fund') {
      // eslint-disable-next-line no-console
      console.warn(
        `[assets/symbols] พบ type 'fund' (${s.symbol}) ทั้งที่สัญญา API บอกว่าไม่ควรมี — กรองออกจาก Dropdown`
      );
      continue;
    }
    filtered.push(s);
  }
  return filtered;
}

export async function getAssetSymbols() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.symbols;
  }
  if (inFlight) return inFlight;

  inFlight = apiGet('/api/v1/assets/symbols')
    .then((data) => {
      const symbols = sanitize(data.symbols);
      cache = { symbols, fetchedAt: Date.now() };
      return symbols;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

// สำหรับ Test เท่านั้น — เคลียร์ Cache ระหว่าง Test Case ไม่ให้ผลลัพธ์ค้างข้ามกัน
export function __resetSymbolsCacheForTest() {
  cache = null;
  inFlight = null;
}
