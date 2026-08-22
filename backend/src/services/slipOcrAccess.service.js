// ═══════════════════════════════════════════════════════════════════════
// slipOcrAccess.service — ใครมีสิทธิ์เรียก AI อ่านสลิปได้บ้าง (Premium + ทดลองฟรี)
// ═══════════════════════════════════════════════════════════════════════
// แยกออกมาเป็นไฟล์เดียวโดยเจตนา เพราะตอนนี้มี "3 ทางเข้า" ที่ต้องตัดสินเรื่องนี้ให้
// เหมือนกันเป๊ะ: LINE (webhook.controller.handleAssetSlipImage), เว็บ
// (transactions.controller.scanSlipWithAi) และการแสดงสถานะโควตาบนหน้าเว็บ
// ถ้าปล่อยให้แต่ละที่เช็คเอง จะเกิดเคสที่ "ช่องทางหนึ่งให้ผ่าน อีกช่องทางไม่ให้"
// ซึ่งคือช่องใช้เกินโควตาที่ Requirement เตือนไว้ตรงๆ
//
// ── ความสัมพันธ์กับ entitlement.service ──────────────────────────────────
// ไฟล์นี้ "ไม่ตัดสินสิทธิ์ Premium เอง" — เรียก entitlement.isPremiumActive ตัวเดิม
// เสมอ (Single Source of Truth ตาม AI_WORK_POLICY § 4.2) ที่เพิ่มมาคือชั้น "ทดลอง
// ฟรี" สำหรับผู้ใช้ที่ไม่ใช่ Premium เท่านั้น
//
// ── ทำไมโควตาทดลองผูกกับ ai_ocr_usage เดิม ไม่ใช่คอลัมน์ใหม่ ────────────────
// Requirement: "ต้องนับจากโควตาชุดเดียวกับระบบเดิม ห้ามสร้างตัวนับใหม่แยก"
// getLifetimeUsage รวม count/call_count ทุกเดือนของ user คนนั้น ทำให้:
//   - ใช้ทางเว็บแล้วโควตาฝั่ง LINE ลดตามทันที (และกลับกัน) — เป็นถังเดียวกันจริง
//   - ไม่ Reset ตอนขึ้นเดือนใหม่ (ต่างจากโควตา Premium 50/เดือน) ตามที่ระบุว่า
//     "ตลอดอายุบัญชี ไม่ใช่ต่อเดือน"
//
// ⚠️ ข้อจำกัดที่ต้องรู้ (รายงานให้ Founder แล้ว — ห้ามอ้างเกินจริงว่ากันได้):
// โควตานี้ผูกกับ users.id ซึ่ง map 1:1 กับ line_user_id — ผู้ใช้ที่สร้าง LINE Account
// ใหม่จะได้สิทธิ์ทดลองใหม่อีก 3 ครั้งเสมอ ระบบ "กันไม่ได้" ด้วยข้อมูลที่มีอยู่วันนี้
// (ไม่มีการยืนยันเบอร์/บัตรประชาชนในระบบ) สิ่งที่กันได้จริงคือ "บัญชีเดิมกด Reset เอง
// ไม่ได้" (ไม่ผูกกับเดือน/ไม่มีปุ่มล้าง) และเพดานค่าใช้จ่ายต่อบัญชีด้านล่าง
const entitlementService = require('./entitlement.service');
const aiOcrUsageRepository = require('../repositories/aiOcrUsage.repository');

// จำนวนครั้งที่ผู้ใช้ Free ได้ทดลอง "อ่านสลิปสำเร็จ" ตลอดอายุบัญชี (Founder อนุมัติ)
const FREE_TRIAL_OCR_LIMIT = 3;

// เพดานจำนวนครั้งที่ "เรียก Claude จริง" ของผู้ใช้ Free ตลอดอายุบัญชี
//
// ⚠️ ทำไมต้องมีตัวนี้แยกจาก FREE_TRIAL_OCR_LIMIT: count เดิมนับเฉพาะ "อ่านสำเร็จ"
// เท่านั้น (ดู slipOcr.service) แปลว่าผู้ใช้ Free ที่ส่งรูปวิว/รูปดำรัวๆ จะไม่กิน
// โควตาทดลองเลยสักครั้ง ทั้งที่จ่ายเงินค่า Claude Vision ไปแล้วจริงทุกครั้ง —
// ถ้าไม่มีเพดานนี้ ผู้ใช้ Free 1 คนยิงได้ถึง MONTHLY_CALL_LIMIT (200/เดือน) เท่ากับ
// Premium ทั้งที่ยังไม่จ่ายเงินสักบาท ซึ่งขัดเจตนาของฟีเจอร์ "ให้ชิม 3 ครั้ง"
//
// ตั้งเป็น 4 เท่าของโควตาทดลองพอดี — อัตราส่วนเดียวกับที่ slipOcr.service ใช้ระหว่าง
// MONTHLY_CALL_LIMIT (200) กับ MONTHLY_QUOTA (50) จงใจให้สอดคล้องกัน: ผู้ใช้สุจริต
// ที่ส่งรูปเบลอ/ถ่ายพลาดซ้ำ 3 เท่าของที่สำเร็จยังไม่ชน
const FREE_TRIAL_CALL_LIMIT = FREE_TRIAL_OCR_LIMIT * 4;

// ── ตรรกะล้วน (Pure) — แยกออกมาเพื่อ Unit Test โดยไม่ต้องแตะ DB ────────────
// คืน:
//   { allowed: true,  mode: 'premium' }
//   { allowed: true,  mode: 'trial', trialRemaining: n }  ← n คือ "ก่อน" ใช้ครั้งนี้
//   { allowed: false, reason: 'TRIAL_EXHAUSTED' | 'TRIAL_CALL_LIMIT' }
//
// เหตุผลที่ Premium ไม่สนใจ lifetime เลย: โควตา Premium เป็นรายเดือน (50) ซึ่ง
// slipOcr.service บังคับอยู่แล้วภายใน extractSlip — ชั้นนี้มีหน้าที่ตัดสินแค่
// "ได้เข้าประตูไหม" ไม่ใช่ตัดสินโควตารายเดือนซ้ำ (ห้ามมี Logic โควตาคู่ขนาน)
function decideAccess({ isPremiumActive, lifetimeCount, lifetimeCallCount }) {
  if (isPremiumActive) {
    return { allowed: true, mode: 'premium' };
  }

  if (lifetimeCount >= FREE_TRIAL_OCR_LIMIT) {
    return { allowed: false, reason: 'TRIAL_EXHAUSTED', trialRemaining: 0 };
  }

  // เพดานคุมต้นทุน: ชนได้ทั้งที่โควตาทดลองยังเหลือ (ส่งรูปที่อ่านไม่ออกรัวๆ)
  if (lifetimeCallCount >= FREE_TRIAL_CALL_LIMIT) {
    return {
      allowed: false,
      reason: 'TRIAL_CALL_LIMIT',
      trialRemaining: Math.max(0, FREE_TRIAL_OCR_LIMIT - lifetimeCount),
    };
  }

  return {
    allowed: true,
    mode: 'trial',
    trialRemaining: Math.max(0, FREE_TRIAL_OCR_LIMIT - lifetimeCount),
  };
}

// ── ตัวห่อที่แตะ DB (ใช้จริงใน Controller ทั้ง 2 ช่องทาง) ────────────────────
// ⚠️ Fail-closed: ถ้าอ่านยอดใช้งานไม่ได้ (DB ล่ม) ต้อง "ไม่ให้ผ่าน" สำหรับผู้ใช้ Free
// — เหตุผลเดียวกับ incrementCallCount ใน slipOcr.service: ตรงนี้ยังไม่จ่ายเงิน การ
// เดินต่อทั้งที่บังคับเพดานไม่ได้ = เปิดช่องยิงฟรีไม่จำกัดแค่ทำให้ DB ล่ม
// (ผู้ใช้ Premium ไม่กระทบ เพราะ Return ก่อนถึง Query เสมอ)
async function checkAccess(user) {
  if (entitlementService.isPremiumActive(user)) {
    return { allowed: true, mode: 'premium' };
  }

  let lifetime;
  try {
    lifetime = await aiOcrUsageRepository.getLifetimeUsage(user.id);
  } catch (err) {
    console.error(`[slipOcrAccess] lifetime usage lookup failed for ${user.id}: ${err.message}`);
    return { allowed: false, reason: 'TRIAL_CALL_LIMIT', trialRemaining: 0 };
  }

  return decideAccess({
    isPremiumActive: false,
    lifetimeCount: lifetime.count,
    lifetimeCallCount: lifetime.callCount,
  });
}

module.exports = {
  FREE_TRIAL_OCR_LIMIT,
  FREE_TRIAL_CALL_LIMIT,
  decideAccess,
  checkAccess,
};
