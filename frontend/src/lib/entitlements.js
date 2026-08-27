// ═══════════════════════════════════════════════════════════════════════════
// entitlements.js — สิทธิ์จริงจาก Backend (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ ไฟล์นี้มาแทน `lib/demo/planEntitlements.js` ซึ่งเป็นของปลอมสำหรับ Demo ล้วน
// (Toggle Free/Premium เอง + Hardcode เพดานไว้ในโค้ด Frontend)
//
// ── กฎเหล็กของไฟล์นี้ ─────────────────────────────────────────────────────
//   1. **ห้าม Hardcode ตัวเลขเพดานใดๆ ที่นี่เด็ดขาด** — ทุกตัวเลขมาจาก
//      `GET /api/v1/dashboard/me` ซึ่งคำนวณจาก `entitlement.service.js`
//      (Single Source of Truth เดียวของทั้งระบบ)
//      Demo เดิม Hardcode `FREE_ASSET_CAP = 2` ไว้พร้อมคอมเมนต์ว่า "Grep แล้ว
//      22 ส.ค. 2569" ซึ่งเป็นวิธีที่จะเพี้ยนแน่นอนวันที่ Founder เปลี่ยนเพดาน
//
//   2. **นี่คือ Presentation Gate ไม่ใช่ Security Gate** — ทุกฟังก์ชันในไฟล์นี้
//      ใช้ตัดสินแค่ว่า "จะ Disable ปุ่ม / โชว์ Banner ไหม" เท่านั้น
//      **ด่านจริงอยู่ที่ Backend เสมอ** (`assertCanAddToPortfolio`,
//      `create_portfolio_locked`) — Frontend ซ่อนปุ่มคือ UX ไม่ใช่การป้องกัน
//      ถ้าผู้ใช้ยิง API ตรงๆ Backend ต้องปฏิเสธเองได้อยู่แล้ว
//
//   3. **ห้ามใช้ภาษาชี้นำการลงทุน** ในข้อความใดๆ ที่ไฟล์นี้ผลิต (กฎเหล็กข้อ 1)

// ค่าเริ่มต้นเมื่อยังโหลด /me ไม่เสร็จ หรือโหลดไม่สำเร็จ
// ⚠️ Fail-closed: ถือเป็น Free และ "ยังไม่รู้เพดาน" — ปลอดภัยกว่าเดาว่าเป็น Premium
// (ถ้าเดาสูงเกินจริง ผู้ใช้จะกดปุ่มแล้วเจอ Error จาก Backend ซึ่ง UX แย่กว่า)
export const UNKNOWN_ENTITLEMENTS = Object.freeze({
  plan: 'free',
  planExpiresAt: null,
  isPremiumActive: false,
  assetLimit: null,
  portfolioLimit: null,
  role: null,
  loaded: false,
});

// แปลง Response ของ GET /dashboard/me เป็นรูปที่ UI ใช้
// ⚠️ ไม่เติมค่า Default ให้ตัวเลขเพดานเมื่อ Backend ไม่ส่งมา — ปล่อยเป็น null
// แล้วให้ UI แสดง "ไม่ทราบเพดาน" แทนการเดา (Silent Default เป็น Anti-pattern
// เหมือนกันทั้งฝั่ง Backend และ Frontend)
export function fromMeResponse(me) {
  if (!me || typeof me !== 'object') return UNKNOWN_ENTITLEMENTS;

  return {
    plan: me.plan ?? 'free',
    planExpiresAt: me.planExpiresAt ?? null,
    isPremiumActive: Boolean(me.isPremiumActive),
    assetLimit: me.assetLimit ?? null,
    portfolioLimit: me.portfolioLimit ?? null,
    role: me.role ?? null,
    loaded: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// canCreatePortfolio — "ปุ่มสร้างพอร์ตควรกดได้ไหม"
// ═══════════════════════════════════════════════════════════════════════════
// คืน { allowed, reason } — reason ใช้เลือกข้อความ/ปลายทางของปุ่ม
//   'limit'   Free ที่มีพอร์ตครบแล้ว → ชวนอัปเกรด
//   'cap'     Premium ที่ชน Sanity Cap 50 → **ห้ามชวนอัปเกรด** (เขาจ่ายอยู่แล้ว)
//   'unknown' ยังโหลด /me ไม่เสร็จ → Disable ปุ่มไว้ก่อน ไม่เดา
export function canCreatePortfolio(entitlements, portfolioCount) {
  const { portfolioLimit, isPremiumActive, loaded } = entitlements ?? UNKNOWN_ENTITLEMENTS;

  if (!loaded || portfolioLimit === null || typeof portfolioCount !== 'number') {
    return { allowed: false, reason: 'unknown' };
  }
  if (portfolioCount < portfolioLimit) return { allowed: true, reason: null };

  return { allowed: false, reason: isPremiumActive ? 'cap' : 'limit' };
}

// ═══════════════════════════════════════════════════════════════════════════
// portfolioWriteState — "พอร์ตนี้ทำอะไรได้บ้าง" (มติ Founder 24 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ หัวใจของ Stage 9 ฝั่ง UI — ต้องสะท้อนกติกาที่ Backend บังคับไว้ให้ตรงเป๊ะ:
//
//   canAdd    = เพิ่มของใหม่ได้ไหม (ซื้อ · ปันผล · ย้ายสินทรัพย์เข้า)
//   canReduce = ลดของเดิม/แก้ให้ตรงความจริงได้ไหม (ขาย · ย้อนรายการ · ย้ายออก)
//
// ⚠️ **`canReduce` เป็น true เสมอ ไม่มีเงื่อนไข** — และนี่คือจุดที่ UI พลาดง่ายที่สุด
// ถ้า UI ซ่อนปุ่มขายไปด้วยตอนพอร์ตถูกล็อก ผู้ใช้จะเข้าใจว่า "ติดกับ" แล้ว
// **ไม่บันทึกการขายที่เกิดขึ้นจริงในโลกจริง** → ยอดในพอร์ตผิดถาวร ซึ่งเป็นสิ่งที่
// มติ 24 ส.ค. ตั้งใจกันตั้งแต่แรก (การล็อก = "โตต่อไม่ได้" ไม่ใช่ "ออกไม่ได้")
//
// portfolio.canWrite มาจาก Backend (GET /portfolios) — **ห้ามคำนวณเองจาก plan**
// เพราะกติกา "พอร์ตหลักยังเขียนได้" อยู่ที่ Backend ที่เดียว
export function portfolioWriteState(portfolio) {
  const canAdd = portfolio?.canWrite === true;

  return {
    canAdd,
    // ⚠️ ห้ามเปลี่ยนเป็น false เด็ดขาดไม่ว่าเงื่อนไขใด (ดูเหตุผลด้านบน)
    canReduce: true,
    isLocked: portfolio?.canWrite === false,
  };
}

// ข้อความอธิบายสถานะพอร์ตที่ถูกล็อก — ต้องบอก "ทางออกที่ยังทำได้จริง" ให้ครบ
// ⚠️ ต้องสอดคล้องกับข้อความฝั่ง Backend (PORTFOLIO_READ_ONLY) — ถ้าสองที่พูด
// ไม่ตรงกัน ผู้ใช้จะสับสนว่าตกลงทำได้หรือไม่ได้
export const LOCKED_PORTFOLIO_NOTICE = Object.freeze({
  title: 'พอร์ตนี้เพิ่มรายการใหม่ไม่ได้',
  reason: 'แพ็กเกจ Premium หมดอายุแล้ว',
  stillAllowed: [
    'บันทึกการขาย',
    'ย้อนรายการล่าสุด',
    'ย้ายสินทรัพย์ออกไปพอร์ตหลัก',
  ],
  dataSafety: 'ข้อมูลเดิมอยู่ครบทุกรายการ ไม่มีอะไรถูกลบ',
  recovery: 'ต่ออายุแล้วกลับมาเพิ่มรายการได้ทันที',
});
