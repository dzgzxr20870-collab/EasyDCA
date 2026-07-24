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
// ตัดสินตอนสร้างแผนใหม่ ทั้งทางเว็บและ LINE) — Consistent กับ FREE_TIER_ASSET_LIMIT:
// DCA Planner ผูกกับ Asset โดยธรรมชาติ จำกัด 1 แผน Active สำหรับ Free
const FREE_TIER_DCA_PLAN_LIMIT = 1;

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

  const hasRemainingTime =
    currentExpiresAt != null && new Date(currentExpiresAt).getTime() > now.getTime();

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
  isPremiumActive,
  getActiveAssetLimit,
  getActiveDcaPlanLimit,
  computeRenewalExpiry,
};
