// ═══════════════════════════════════════════════════════════════════════
// entitlement.service — แหล่งตัดสินสิทธิ์เดียวของระบบ (Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════════
// Pure Logic ล้วน: ไม่มี DB/Network call ใดๆ — รับ object user เข้ามาแล้วตัดสิน
// (ทดสอบได้อิสระ ไม่ต้อง Mock อะไรเลย) ทุกจุดในระบบที่ต้องรู้ว่า "user คนนี้เป็น
// Premium ที่ยัง Active ไหม / จำกัดสินทรัพย์กี่ตัว" ให้เรียกผ่านที่นี่ที่เดียว
// แทนการเทียบ plan === 'premium' ตรงๆ กระจายหลายที่
//
// นิยาม "Premium Active" = plan เป็น 'premium' AND มีวันหมดอายุ AND ยังไม่เลยวัน
// (plan=premium แต่ planExpiresAt เป็น null หรือเลยวันแล้ว = ถือเป็น Free)
// ใช้ user.planExpiresAt (map จากคอลัมน์ users.plan_expires_at เดิม) เป็นวันหมดอายุ

// เพดานสินทรัพย์ของ Free Plan (PRD.md § 4.2 / § 6) — เก็บค่ากลางไว้ที่นี่ที่เดียว
// (transaction.service re-export ชื่อเดิม MAX_FREE_ASSETS จากค่านี้เพื่อ Backward
// Compat) ไม่ Hardcode เลข 2 ซ้ำหลายที่
const FREE_TIER_ASSET_LIMIT = 2;

// เพดานจำนวน "แผน DCA ที่ Active พร้อมกัน" ของ Free Plan (Business Model Beta —
// Export/DCA Planner Gate) เก็บค่ากลางไว้ที่นี่ที่เดียว (dcaReminder.service ใช้
// ตัดสินตอนสร้างแผนใหม่ ทั้งทางเว็บและ LINE) — ตั้งให้ตรงกับ FREE_TIER_ASSET_LIMIT (2):
// DCA Planner ผูกกับ Asset โดยธรรมชาติ Free จึงตั้งได้ 2 แผน Active เท่าจำนวนสินทรัพย์ที่ถือได้
const FREE_TIER_DCA_PLAN_LIMIT = 2;

// ═══════════════════════════════════════════════════════════════════════
// เพดานจำนวนพอร์ต (Stage 8 — Multi-Portfolio)
// ═══════════════════════════════════════════════════════════════════════
// Free = 1 พอร์ตเท่านั้น (AI_CONTEXT.md บรรทัด 95: Multiple Portfolio Free ❌)
// หลัง migration 044 ผู้ใช้ทุกคนมีพอร์ต Default 1 อันเป๊ะอยู่แล้ว → Free จึง
// "มีพอร์ตอยู่แล้ว 1 อัน แต่สร้างเพิ่มไม่ได้" ไม่ใช่ "ไม่มีพอร์ตเลย"
const FREE_TIER_PORTFOLIO_LIMIT = 1;

// เพดานของ Premium เป็น Sanity Cap กัน Abuse ไม่ใช่ Monetization Cap
// (มติ Founder 23 ส.ค. 2569 § 8.1(ข))
const PORTFOLIO_SANITY_CAP = 50;

// true เมื่อ user เป็น Premium ที่ยังไม่หมดอายุ ณ ขณะนี้
function isPremiumActive(user) {
  if (!user) return false;
  if (user.plan !== 'premium') return false;
  // ต้องมีวันหมดอายุจริง — plan=premium แต่ไม่มีวันหมดอายุ = ยังไม่ถือว่า Active
  if (user.planExpiresAt === null || user.planExpiresAt === undefined) return false;
  return new Date(user.planExpiresAt).getTime() > Date.now();
}

// เพดานสินทรัพย์ Active ที่ user ทำได้ — null = ไม่จำกัด (Premium Active) / เลข = Free
function getActiveAssetLimit(user) {
  return isPremiumActive(user) ? null : FREE_TIER_ASSET_LIMIT;
}

// เพดานจำนวนแผน DCA Active ที่ user ทำได้ — null = ไม่จำกัด (Premium) / เลข = Free
function getActiveDcaPlanLimit(user) {
  return isPremiumActive(user) ? null : FREE_TIER_DCA_PLAN_LIMIT;
}

// ═══════════════════════════════════════════════════════════════════════
// getActivePortfolioLimit — "สร้าง/เขียนพอร์ตได้กี่อัน" ณ ขณะนี้
// ═══════════════════════════════════════════════════════════════════════
// ⚠️ ต่างจาก getActiveAssetLimit/getActiveDcaPlanLimit ตรงที่ **ไม่มีวันคืน null**
// เพราะแม้แต่ Premium ก็มี Sanity Cap 50 — Caller จึงไม่ต้องมี Branch
// "null = ไม่จำกัด" สำหรับพอร์ตเลย
function getActivePortfolioLimit(user) {
  return isPremiumActive(user) ? PORTFOLIO_SANITY_CAP : FREE_TIER_PORTFOLIO_LIMIT;
}

// ═══════════════════════════════════════════════════════════════════════
// getWritablePortfolioIds — "Premium หมดอายุ = อ่านได้ เขียนไม่ได้"
// ═══════════════════════════════════════════════════════════════════════
// มติ Founder 23 ส.ค. 2569 § 8.1(ก): ผู้ใช้ที่เคยเป็น Premium แล้วสร้างไว้ 3 พอร์ต
// พอหมดอายุ **ห้ามลบข้อมูลเด็ดขาด** (กฎเหล็กข้อ 2) — พอร์ตส่วนเกินยังเปิดดู
// ย้อนหลังได้ปกติ · ต่ออายุแล้วกลับมาเขียนได้ทันทีโดยไม่ต้องทำอะไรเพิ่ม
// (ฟังก์ชันนี้คำนวณสดทุกครั้ง ไม่เก็บลง DB)
//
// ⚠️ "เขียนไม่ได้" ในที่นี้หมายถึง **"เพิ่มของใหม่ไม่ได้" เท่านั้น** ไม่ใช่
// "ทำอะไรไม่ได้เลย" — การขาย / Undo / ย้ายสินทรัพย์ออกไปพอร์ตหลัก **ยังทำได้เสมอ**
// (มติ Founder 24 ส.ค. 2569 · ดู portfolios.service.assertCanAddToPortfolio)
//
// ── ⭐ ตัดสินด้วย is_default ไม่ใช่ created_at เก่าสุด (มติ Founder 24 ส.ค. 2569) ──
// เดิมใช้ "พอร์ตที่ created_at เก่าสุด = พอร์ตที่ยังเขียนได้" ซึ่ง Deterministic ดี
// แต่ **มักไม่ใช่พอร์ตที่ผู้ใช้ใช้จริง**: พอร์ตเก่าสุดคือตัวที่ migration 044
// Backfill สร้างให้อัตโนมัติ (ชื่อ Default ชนิด 'custom' อาจแทบว่างเปล่า) ส่วน
// พอร์ตที่เขาใช้จริงคือตัวที่สร้างเองทีหลัง → ล็อกผิดตัว ผู้ใช้จะเขียนพอร์ตหลัก
// ของตัวเองไม่ได้ทั้งที่เขียนพอร์ตร้างได้
//
// `is_default` คือ "พอร์ตหลักของผู้ใช้" ตามความหมายอยู่แล้ว และ **ผู้ใช้เปลี่ยนได้เอง**
// ผ่าน PATCH /portfolios/{id} { isDefault: true } → ไม่ถูกขังอยู่กับพอร์ตที่ระบบ
// เลือกให้ · DB การันตีว่ามีได้ 1 อันต่อ user เป๊ะ (idx_portfolios_one_default_per_user)
//
// ⚠️ **Fallback = created_at + tie-break id ยังต้องอยู่ ห้ามลบทิ้ง** — ใช้เมื่อ
// is_default หายไป (Invariant ของ migration 044/045 พัง หรือชุดข้อมูลที่ส่งเข้ามา
// ไม่มีพอร์ต Default เลย) ถ้าไม่มี Fallback ฟังก์ชันจะคืน Set ว่าง = ล็อกผู้ใช้
// ออกจากทุกพอร์ตพร้อมกัน ซึ่งแย่กว่าการเลือกผิดตัวมาก
//
// ⚠️ Tie-break ด้วย id เมื่อ created_at เท่ากันเป๊ะ — จำเป็นจริง ไม่ใช่กันเหนียว:
// migration 044 Backfill สร้างพอร์ตให้ผู้ใช้ทุกคนใน Transaction เดียว ซึ่ง now()
// ของ Postgres คงที่ทั้ง Transaction → พอร์ตที่เกิดพร้อมกันจะมี created_at
// เท่ากันทุกตัวอักษร ถ้าไม่ Tie-break ลำดับจะขึ้นกับ Physical Row Order ของ
// Postgres ซึ่งเปลี่ยนได้ทุกเมื่อ (หลัง VACUUM/UPDATE)
//
// portfolios = รายการพอร์ตทั้งหมดของ user คนนั้น (ไม่ต้องเรียงมาก่อน)
// คืน Set ของ id ที่ "เขียนได้" — Caller เช็คด้วย .has(portfolioId)
function getWritablePortfolioIds(user, portfolios) {
  const limit = getActivePortfolioLimit(user);
  const list = [...(portfolios ?? [])];

  // เรียงตาม created_at (เก่า→ใหม่) + tie-break ด้วย id — เป็นทั้งลำดับ Fallback
  // และลำดับของ "พอร์ตที่เหลือ" เมื่อเพดาน > 1 (Premium ที่ชน Sanity Cap 50)
  list.sort((a, b) => {
    const at = new Date(a.createdAt ?? 0).getTime();
    const bt = new Date(b.createdAt ?? 0).getTime();
    if (at !== bt) return at - bt;
    return String(a.id).localeCompare(String(b.id));
  });

  // ⭐ พอร์ตหลัก (is_default) ต้องมาก่อนเสมอ แล้วค่อยตามด้วยพอร์ตอื่นตามลำดับเดิม
  // → เพดาน 1 (Free/หมดอายุ) จะได้พอร์ต Default เป็นตัวที่เขียนได้
  // → เพดาน 50 (Premium) ได้ครบทุกพอร์ตอยู่แล้ว ลำดับไม่มีผล
  const ordered = [...list.filter((p) => p.isDefault), ...list.filter((p) => !p.isDefault)];

  return new Set(ordered.slice(0, limit).map((p) => p.id));
}

// ═══════════════════════════════════════════════════════════════════════
// getWritableSymbols — "ซื้อเพิ่มได้ที่ Symbol ไหนบ้าง" (มติ Founder 5 ก.ย. 2569)
// ═══════════════════════════════════════════════════════════════════════
// ⭐ ปิดช่องโหว่: ผู้ใช้ที่สมัคร Premium 1 เดือน ถือ 20-30 Symbol แล้วดาวน์เกรด
// กลับเป็น Free **ยังซื้อเพิ่มในทุก Symbol ที่เคยถือได้ไม่จำกัดตลอดไป** เพราะ
// transaction.validateBuy เดิมเช็คแค่ "Symbol นี้มีอยู่แล้วไหม" ไม่เคยถามว่า
// "อยู่ในโควตาที่อนุญาตไหม" — เพดาน Free จึงบังคับใช้แค่ตอนสร้าง Symbol ใหม่
// เอี่ยมเท่านั้น (RPC create_asset_locked)
//
// กติกา: Free ซื้อเพิ่มได้เฉพาะ **N Symbol ที่มีธุรกรรมซื้อครั้งแรกเร็วที่สุดใน
// ประวัติทั้งหมดของบัญชี** (N = getActiveAssetLimit) — Symbol อื่นยังขาย/ดูประวัติ/
// ย้ายพอร์ตได้ปกติทุกตัว แค่ "ห้ามเติมเงินเพิ่ม" (สอดคล้องกฎเหล็กข้อ 2 ห้ามลบข้อมูล
// และมติ 24 ส.ค. 2569 ที่ว่า "ล็อก = โตต่อไม่ได้ ไม่ใช่ออกไม่ได้")
//
// ── คุณสมบัติที่ตั้งใจให้เป็นแบบนี้ (อย่าออกแบบใหม่โดยไม่ถาม Founder) ────────
//   1. **Stateless เต็มรูปแบบ** — คำนวณสดจาก Ledger ที่มีอยู่แล้วทุกครั้ง ไม่มี
//      Column/Migration/Cron ใหม่ · ไม่แตะข้อมูลเก่าแม้แต่แถวเดียว
//   2. **ไม่มีการ "ปลด Slot คืน"** — ขายจนเหลือ 0 หน่วยแล้ว Symbol นั้นยังนับเป็น
//      1 ใน N ตลอดไป (กันหมุนซื้อ-ขายสลับ Symbol ไปเรื่อยๆ ไม่จำกัด)
//   3. **ไม่ Reset ตอนกลับมา Free รอบใหม่** — เป็น N ตัวแรกของทั้งชีวิตบัญชีเสมอ
//      ไม่ว่าจะสลับ Premium/Free กี่รอบ (Trade-off ที่ Founder รับทราบแล้ว)
//
// buyHistory = [{ symbol, createdAt }] ทุกแถว type='buy' ของ user คนนั้น (ไม่ต้อง
// เรียง/Dedupe มาก่อน — ดู transactionRepository.findBuyHistory)
// คืน Set ของ Symbol ที่ซื้อเพิ่มได้ · **null = ไม่จำกัด** (Premium ที่ยัง Active)
// — Convention เดียวกับ getActiveAssetLimit เป๊ะ Caller จึงเช็ค null ก่อนเสมอ
function getWritableSymbols(user, buyHistory) {
  const limit = getActiveAssetLimit(user);
  if (limit === null) return null;

  // Dedupe ตาม **Symbol ไม่ใช่แถว/asset_id** — ถือ BTC 2 โบรก (migration 046) หรือ
  // BTC 2 พอร์ต = 1 สินทรัพย์เสมอ ตามมติ Founder 23 ส.ค. 2569 · เก็บ createdAt
  // ที่เก่าที่สุดของแต่ละ Symbol ไว้เป็นเวลาที่ใช้จัดลำดับ
  const firstBuyAt = new Map();
  for (const row of buyHistory ?? []) {
    if (!row?.symbol) continue;
    const at = new Date(row.createdAt ?? 0).getTime();
    // NaN (createdAt เพี้ยน/ไม่มี) → ถือเป็นเก่าสุด (0) แทนการทิ้งแถวนั้นทั้งแถว
    // ทิ้งแถวจะทำให้ Symbol หายจากลิสต์ = ผู้ใช้ถูกบล็อกจาก Symbol ของตัวเอง
    const at2 = Number.isFinite(at) ? at : 0;
    const prev = firstBuyAt.get(row.symbol);
    if (prev === undefined || at2 < prev) firstBuyAt.set(row.symbol, at2);
  }

  // ⚠️ Tie-break ด้วยชื่อ Symbol เมื่อ created_at เท่ากันเป๊ะ — จำเป็นจริงไม่ใช่กัน
  // เหนียว: การนำเข้าพอร์ตแบบหลายบรรทัด (bulkImport) อาจ INSERT หลายแถวด้วย now()
  // เดียวกันได้ ถ้าไม่ Tie-break ลำดับจะขึ้นกับลำดับแถวที่ Postgres คืนมา ซึ่ง
  // เปลี่ยนได้ทุกเมื่อ → Slot ของผู้ใช้จะสลับไปมาเองระหว่างคำขอ (เหตุผลเดียวกับ
  // Tie-break ด้วย id ใน getWritablePortfolioIds)
  const ordered = [...firstBuyAt.entries()]
    .sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : String(a[0]).localeCompare(String(b[0]))))
    .map(([symbol]) => symbol);

  return new Set(ordered.slice(0, limit));
}

// ═══════════════════════════════════════════════════════════════════════
// canBuySymbol — "ผู้ใช้คนนี้ซื้อเพิ่มใน Symbol นี้ได้ไหม" (ตัวตัดสินจริง)
// ═══════════════════════════════════════════════════════════════════════
// คืน { allowed, reason, limit, writableSymbols } — Pure ล้วน เทสต์ได้โดยไม่ต้องมี DB
//
// ⭐ กฎ "ยังมี Slot ว่าง" (writable.size < limit) คือสิ่งที่ทำให้ผู้ใช้ Free ปกติ
// **ไม่ถูกกระทบเลยแม้แต่นิดเดียว**: ผู้ใช้ใหม่ที่ยังไม่เคยซื้ออะไร (size 0) หรือ
// เพิ่งซื้อไปตัวเดียว (size 1) ยังซื้อ Symbol ใหม่ได้ตามปกติเหมือนเดิมทุกประการ
// — ด่านเพดานจำนวนสินทรัพย์ของ "Symbol ใหม่เอี่ยม" ยังเป็นหน้าที่ของ
// RPC create_asset_locked เหมือนเดิม (ที่นี่ไม่แตะ ไม่ทับซ้อน)
//
// ⚠️ เทียบ Symbol แบบตรงตัว (Exact Match) ตรงกับ Convention เดิมของ
// validateBuy (`activeSymbols.includes(params.symbol)`) — Caller ทุกทางส่ง Symbol
// ที่ Normalize เป็นตัวพิมพ์ใหญ่มาแล้ว ห้ามเพิ่มการแปลงตัวพิมพ์ที่นี่ให้ต่างจากเดิม
function canBuySymbol(user, buyHistory, symbol) {
  const limit = getActiveAssetLimit(user);
  const writableSymbols = getWritableSymbols(user, buyHistory);

  // Premium ที่ยัง Active → ไม่จำกัด (ไม่ถูกกระทบจากกติกานี้เลย)
  if (writableSymbols === null) return { allowed: true, reason: null, limit: null };

  if (writableSymbols.has(symbol)) {
    return { allowed: true, reason: null, limit, writableSymbols };
  }
  // ยังไม่ใช้ Slot ครบ → Symbol นี้เข้าไปจับจอง Slot ที่เหลือได้
  if (writableSymbols.size < limit) {
    return { allowed: true, reason: null, limit, writableSymbols };
  }

  return { allowed: false, reason: 'symbol_not_writable', limit, writableSymbols };
}

// คำนวณวันหมดอายุใหม่หลังต่ออายุ ตามกติกา Stacking:
//   - ถ้ายังมีอายุเหลือ (currentExpiresAt อยู่ในอนาคต) → ต่อจากวันหมดอายุเดิม
//     (ไม่เสียวันที่เหลือ) มิฉะนั้น (ไม่มี/หมดอายุแล้ว) → เริ่มนับจาก now
//   - บวก 1 เดือน (monthly) หรือ 1 ปี (yearly)
//
// ใช้ setUTCMonth/setUTCFullYear (UTC ล้วน) กันปัญหา Timezone — และ "ยอมรับ
// Rollover ปกติของ JS" เช่น 31 ม.ค. + 1 เดือน จะกลายเป็นต้นเดือน มี.ค.
// (เพราะ 31 ก.พ. ไม่มีจริง) หรือ 29 ก.พ. + 1 ปี → 1 มี.ค. — เอียงไปทางให้เวลา
// ผู้ใช้ "เกินเล็กน้อย" ดีกว่าขาด ซึ่งยอมรับได้สำหรับระบบสมัครสมาชิก
function computeRenewalExpiry(currentExpiresAt, billingPeriod, now = new Date()) {
  if (billingPeriod !== 'monthly' && billingPeriod !== 'yearly') {
    throw new Error(`Invalid billingPeriod: ${billingPeriod} (expected 'monthly' or 'yearly')`);
  }

  // เขียนเทียบ null/undefined แยกกันแทน `!= null` เพื่อให้ผ่าน eqeqeq ของ ESLint
  // (พฤติกรรมเหมือนเดิมเป๊ะ: `x != null` ≡ `x !== null && x !== undefined`)
  const hasRemainingTime =
    currentExpiresAt !== null &&
    currentExpiresAt !== undefined &&
    new Date(currentExpiresAt).getTime() > now.getTime();

  // ฐานการนับ: วันหมดอายุเดิม (ถ้ายังเหลือ) หรือ now (ถ้าไม่มี/หมดแล้ว)
  const base = hasRemainingTime ? new Date(currentExpiresAt) : new Date(now);
  const result = new Date(base.getTime());

  if (billingPeriod === 'monthly') {
    result.setUTCMonth(result.getUTCMonth() + 1);
  } else {
    result.setUTCFullYear(result.getUTCFullYear() + 1);
  }

  return result;
}

module.exports = {
  FREE_TIER_ASSET_LIMIT,
  FREE_TIER_DCA_PLAN_LIMIT,
  FREE_TIER_PORTFOLIO_LIMIT,
  PORTFOLIO_SANITY_CAP,
  isPremiumActive,
  getActiveAssetLimit,
  getActiveDcaPlanLimit,
  getActivePortfolioLimit,
  getWritablePortfolioIds,
  getWritableSymbols,
  canBuySymbol,
  computeRenewalExpiry,
};
