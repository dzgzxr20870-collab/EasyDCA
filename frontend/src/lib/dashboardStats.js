// ═══════════════════════════════════════════════════════════════════════════
// dashboardStats — อ่านยอดเงินลงทุนจาก overview.lifetime / overview.thisMonth
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 บั๊กที่แก้ (E2E Chrome Test — บั๊กที่ 3): AppDashboard.jsx เดิมอ่าน
// `overview.lifetime.totalThb` / `overview.thisMonth.totalThb` ซึ่ง**ไม่มีจริง**
// ใน Response — Backend (dcaStats.service.getLifetimeSummary/getMonthSummary)
// ส่งเป็น `{ count, amountByCurrency: { THB, USD } }` เท่านั้น (ไม่มี totalThb
// เลยสักที่) `formatThb(undefined)` จึงคืน "—" ค้างตลอดไม่ว่าจะมีข้อมูลจริงแค่ไหน
//
// ⚠️ ยืนยันแล้วว่า Field ที่ถูกต้องคือ `amountByCurrency.THB` โดยเทียบกับหน้า
// Dashboard เก่าที่ยังทำงานถูก (components/dashboard/StatCards.jsx บรรทัด 62,
// SidePanels.jsx บรรทัด 27 — อ่าน Field เดียวกันนี้จาก overview ก้อนเดียวกันเป๊ะ)
//
// ⚠️ ไม่บวก THB+USD ข้ามสกุล (เหตุผลเดียวกับ dcaStats.service — ไม่มี FX ย้อนหลัง
// ให้แปลง) — คืนทั้งสองสกุลแยกกัน ให้ Caller แสดง USD เป็นส่วนเสริมเมื่อมากกว่า 0
// (Pattern เดียวกับ StatCards.jsx/SidePanels.jsx เป๊ะ)
//
// summary = overview.lifetime หรือ overview.thisMonth (Shape เดียวกัน)
export function investedAmount(summary) {
  const thb = summary?.amountByCurrency?.THB;
  const usd = summary?.amountByCurrency?.USD;
  return {
    thb: typeof thb === 'number' && Number.isFinite(thb) ? thb : null,
    usd: typeof usd === 'number' && Number.isFinite(usd) ? usd : null,
  };
}
