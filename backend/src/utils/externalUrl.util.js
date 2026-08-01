const config = require('../config/env');

// ═══════════════════════════════════════════════════════════════════════════
// externalUrl.util — URL เปิดหน้าเว็บ Frontend ที่ "บังคับเปิดผ่าน Browser ภายนอก"
// ═══════════════════════════════════════════════════════════════════════════
// ปัญหาเดิม: ทุกจุดที่ลิงก์ไปหน้าเว็บ (Rich Menu ปุ่ม Dashboard/Premium, ข้อความ
// ลิงก์ Dashboard/Support ในแชท) ใช้ https://liff.line.me/{liffId}{path} ซึ่งเปิด
// ผ่าน "LIFF In-App Browser" ของ LINE เสมอ — In-App Browser ตัวนี้เปิดไม่ขึ้นใน
// บาง Case จริง (รายงานจาก User) ทางแก้คือให้เปิดผ่าน Browser ภายนอกของเครื่อง
// (Chrome/Safari) แทน
//
// LINE รองรับการบังคับ Browser ภายนอกผ่าน Query Parameter `openExternalBrowser=1`
// ต่อท้าย URL ของ Action Type 'uri' (Rich Menu/Flex Message/Quick Reply ทั้งหมด
// ใช้กลไกเดียวกัน) — แต่มีข้อจำกัดสำคัญที่ยืนยันจาก LINE Developers Docs โดยตรง
// (หัวข้อ "Using LINE features with the LINE URL scheme"):
//   "Even if you add these query parameters to a LIFF URL, it won't open in an
//    external browser" — พารามิเตอร์นี้ "ใช้ไม่ได้เลย" กับ URL รูปแบบ
//    https://liff.line.me/... จึงต้องเลิกใช้ liff.line.me แล้วชี้ Domain ของเว็บ
//    เราเอง (config.app.frontendUrl) ตรงๆ แทน ถึงจะเปิด External Browser ได้จริง
//
// Login/JWT ยังทำงานถูกต้องแม้เปิดผ่าน Browser ภายนอก (ไม่ผ่าน liff.line.me):
// frontend/src/pages/Login.jsx เรียก liff.init() แล้วเช็ค liff.isLoggedIn() ก่อน
// เรียก liff.login() เองด้วยมือ (ไม่ได้พึ่ง Auto-login ของ LIFF) — Pattern นี้เป็น
// วิธีที่ LINE รองรับอย่างเป็นทางการสำหรับ "LIFF app ที่เปิดนอก LINE App" (ยืนยันจาก
// LIFF API Reference: liff.login() ใช้ได้ปกติไม่ว่าจะเปิดจากที่ไหน โดยไม่ต้องพึ่ง
// withLoginOnExternalBrowser Config เลยถ้า Caller เช็ค isLoggedIn() เองแบบนี้อยู่แล้ว)
// และไม่มีหน้าอื่นในเว็บ (Dashboard/Premium/Support) เรียกใช้ LIFF SDK API ใดๆ ต่อ
// นอกจาก Login.jsx จุดเดียว จึงไม่มี Feature อื่นที่พังจากการเลิกผ่าน liff.line.me

// สร้าง URL เต็มไปหน้าเว็บ Frontend พร้อม ?openExternalBrowser=1 ต่อท้ายเสมอ —
// path ต้องขึ้นต้นด้วย '/' เช่น '/dashboard', '/support', '/premium'
//
// Pure Function — ไม่ Log เอง (Caller แต่ละที่ตัดสินใจว่าจะ Log/Throw ยังไงตาม
// Convention ของตัวเอง เช่น webhook.controller.js ใช้ logger.util ส่วน
// setupRichMenu.js เป็น Script แยกที่ใช้ console.error) คืน null ถ้ายังไม่ได้
// ตั้ง FRONTEND_URL — Caller ต้อง "ไม่" ส่ง uri ว่างๆ ต่อให้ LINE เพราะ LINE จะ
// ปฏิเสธทั้งข้อความด้วย 400 (Pattern เดียวกับ buildPrivacyPolicyUrl ที่มีอยู่แล้ว
// ใน webhook.controller.js)
function buildExternalUrl(path) {
  const base = config.app.frontendUrl;
  if (!base) return null;
  const url = new URL(path, base);
  url.searchParams.set('openExternalBrowser', '1');
  return url.toString();
}

module.exports = { buildExternalUrl };
