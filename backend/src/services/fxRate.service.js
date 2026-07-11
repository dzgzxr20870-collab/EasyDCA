// FX Rate Service — อัตราแลกเปลี่ยน USD→THB สำหรับ "แสดงผล/แปลงยอดรวม" ในระบบ
// Multi-Currency (Phase 3 Round 10)
//
// ⚠️ ขอบเขตหน้าที่: บริการนี้ใช้ "แปลงเพื่อการแสดงผล" เท่านั้น (Preview, ยอดรวมพอร์ต
// แปลงเป็นบาท, รายงาน) — ไม่ใช้แปลงตอนบันทึกธุรกรรม เพราะ Round 10 เก็บสกุลเงิน
// ตามจริง (USD เก็บเป็น USD) การดึงเรตไม่สำเร็จจึง "ไม่ควร" Block การบันทึก
//
// ทำไมแยกจาก priceFeed.getUsdThbFxRate (Twelve Data)?
//  - priceFeed ใช้ Twelve Data (ต้องมี TWELVE_DATA_API_KEY) สำหรับตีราคาหุ้นสหรัฐ/
//    ทองเป็น THB อยู่แล้ว — คงไว้ไม่แตะ (เลี่ยง Regression Round 7)
//  - บริการนี้ใช้ Frankfurter (ฟรี ไม่ต้องใช้ Key — ที่มาข้อมูล: ECB) เป็นแหล่ง FX
//    หลักของฟีเจอร์ Multi-Currency เพื่อให้ทำงานได้แม้ไม่ได้ตั้ง Twelve Data Key
//
// รูปแบบ Cache + Timeout + "ไม่ throw" ยึดตาม priceFeed.service.js ทุกประการ

// Frankfurter — Open-source FX API ของ ECB reference rates ไม่ต้อง Auth/Key
// GET /latest?from=USD&to=THB → { amount, base:'USD', date:'YYYY-MM-DD', rates:{ THB } }
const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.app/latest';

// ระยะเวลารอสูงสุดก่อน Timeout (เท่า priceFeed) — กัน Flow ตอบ LINE ค้างรอเรต
const REQUEST_TIMEOUT_MS = 5000;

// TTL 60 นาที — ECB reference rate อัปเดตวันละครั้ง (วันทำการ) จึงไม่ต้องยิงถี่
// (นานกว่าราคาหุ้น/Crypto โดยตั้งใจ เพราะ FX ผันผวนช้าและใช้เพื่อแสดงผลเท่านั้น)
const CACHE_TTL_MS = 60 * 60 * 1000;

// Cache ระดับ Module: { rate, asOf, expiresAt }
//  - rate    = จำนวน THB ต่อ 1 USD (Number บวก)
//  - asOf    = วันที่ของเรตจาก Frankfurter (ISO date string) — ใช้กำกับใน UI ว่าใช้
//              เรตของวันไหนแปลง
let cache = null;
// Last-known-good แยกไว้ต่างหาก "ไม่หมดอายุ" — ใช้เป็น Fallback เมื่อ API ล่ม
// (คืนเรตจริงที่เคยดึงได้ล่าสุด พร้อม stale:true ไม่เดา/ปั้นเรตขึ้นมาเอง)
let lastGood = null;

// ยิง Frankfurter คืน { rate, asOf } หรือ null ถ้าล้มเหลวทุกกรณี (ไม่ throw)
async function fetchUsdThbFromFrankfurter() {
  const url = `${FRANKFURTER_LATEST_URL}?from=USD&to=THB`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[fxRate] Frankfurter API failed: ${response.status} ${detail}`);
      return null;
    }

    const data = await response.json();
    const rate = Number(data?.rates?.THB);

    // เรตต้องเป็นเลขบวก Finite เท่านั้น — กัน Response รูปแบบผิด/ว่าง
    if (!Number.isFinite(rate) || rate <= 0) {
      console.error('[fxRate] Frankfurter returned no valid USD/THB rate');
      return null;
    }

    // asOf = วันที่ของเรต (Frankfurter field 'date') — Fallback เป็นวันนี้ถ้าไม่มี
    const asOf = typeof data?.date === 'string' && data.date ? data.date : null;
    return { rate, asOf };
  } catch (err) {
    console.error(`[fxRate] Frankfurter request error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// อัตราแลกเปลี่ยน USD→THB (จำนวน THB ต่อ 1 USD) พร้อม Cache 60 นาที
// คืน Object เสมอเมื่อ "เคย" ดึงเรตได้อย่างน้อยครั้งหนึ่ง:
//   { rate, asOf, stale }
//     - stale=false : เรตสดจาก Cache/ยิงใหม่สำเร็จ
//     - stale=true  : ยิงใหม่ไม่สำเร็จ (API ล่ม) → คืน Last-known-good (Fallback)
// คืน null เฉพาะกรณี "ยังไม่เคยดึงเรตได้เลย และยิงครั้งนี้ก็ล้มเหลว"
async function getUsdThbRate() {
  if (cache && cache.expiresAt > Date.now()) {
    return { rate: cache.rate, asOf: cache.asOf, stale: false };
  }

  const fresh = await fetchUsdThbFromFrankfurter();
  if (fresh !== null) {
    cache = { rate: fresh.rate, asOf: fresh.asOf, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGood = { rate: fresh.rate, asOf: fresh.asOf };
    return { rate: fresh.rate, asOf: fresh.asOf, stale: false };
  }

  // ── Fallback: API ล่ม แต่เคยมีเรตจริง → ใช้ Last-known-good (ไม่ปั้นเรตเดา) ──
  if (lastGood !== null) {
    return { rate: lastGood.rate, asOf: lastGood.asOf, stale: true };
  }

  // ไม่เคยดึงเรตได้เลย — Caller (การแสดงผล) ต้องรับมือ null เอง (แสดงเฉพาะสกุลจริง)
  return null;
}

// แปลงจำนวนเงิน USD → THB สำหรับการแสดงผล/ยอดรวม คืน
//   { thb, rate, asOf, stale } หรือ null ถ้าดึงเรตไม่ได้เลย
// ปัด thb เป็น 2 ตำแหน่ง (หน่วยเงินบาท — Pattern เดียวกับ service อื่น)
async function convertUsdToThb(amountUsd) {
  const fx = await getUsdThbRate();
  if (fx === null) return null;

  const thb = Math.round((Number(amountUsd) * fx.rate + Number.EPSILON) * 100) / 100;
  return { thb, rate: fx.rate, asOf: fx.asOf, stale: fx.stale };
}

// สำหรับเทสต์: ล้าง Cache + Last-known-good (เลี่ยงต้อง resetModules ทุก Test)
function _resetCache() {
  cache = null;
  lastGood = null;
}

module.exports = {
  getUsdThbRate,
  convertUsdToThb,
  _resetCache,
};
