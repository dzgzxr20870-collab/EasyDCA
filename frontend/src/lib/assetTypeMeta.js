// ═══════════════════════════════════════════════════════════════════════
// assetTypeMeta — Badge/สี ต่อประเภทสินทรัพย์ (S8 R1b) — Presentation ล้วน
// ═══════════════════════════════════════════════════════════════════════
// type ตรงกับที่ backend ส่งจริงใน GET /api/v1/assets/symbols และ allocation[].type
// (docs/API.md §15.1/§15.4) — ไม่ใช่แหล่งความจริงว่าระบบรองรับ Symbol ใด (นั่นคือ
// backend symbolRegistry) ไฟล์นี้แค่ตัดสินว่า "แสดงผล" อย่างไรให้ตรงกับ Design
// Token ใน Mockup (design/easydca-dashboard-redesign.html: t-us/t-th/t-cr/t-au)

// fullLabel: ใช้ในตำแหน่งที่ต้อง "แยกแยะ" ชัดเจน (Legend ของ Allocation) —
// gold_bar/gold_ornament ต้องคนละชื่อกัน เพราะ overview.allocation[] (API.md §15.4)
// Group ตาม type ดิบ (ไม่ยุบ 2 ชนิดทองเป็นก้อนเดียวเหมือน Chips ค้นหา) ถ้าผู้ใช้ถือ
// ทั้งทองแท่ง+ทองรูปพรรณจะมี 2 แถวมูลค่าต่างกัน — ต้องมี Label แยกไม่ให้สับสน
export const TYPE_META = {
  crypto: { label: 'Crypto', badgeClass: 'dh-t-cr', color: '#7A3FC0', fullLabel: 'คริปโต' },
  stock_th: { label: 'TH', badgeClass: 'dh-t-th', color: '#C06A2D', fullLabel: 'หุ้นไทย' },
  stock_us: { label: 'US', badgeClass: 'dh-t-us', color: '#2D6AC0', fullLabel: 'หุ้นต่างประเทศ' },
  gold_bar: { label: 'ทอง', badgeClass: 'dh-t-au', color: '#9A7B16', fullLabel: 'ทองคำแท่ง' },
  gold_ornament: { label: 'ทอง', badgeClass: 'dh-t-au', color: '#C9A227', fullLabel: 'ทองรูปพรรณ' },
};

const FALLBACK_META = { label: '?', badgeClass: 'dh-t-other', color: '#8B9587', fullLabel: 'อื่นๆ' };

// คืน Meta ของ type — Fallback ปลอดภัยถ้าเจอ type ที่ไม่รู้จัก (ไม่ควรเกิดขึ้นจริง
// เพราะ Backend Whitelist type ไว้แล้ว แต่กันพังไว้ไม่ให้ Component Crash)
export function typeMeta(type) {
  return TYPE_META[type] ?? FALLBACK_META;
}

// ป้ายหมวดสำหรับ Chips ค้นหา — "gold" รวม 2 Type ย่อย (gold_bar/gold_ornament)
// เป็นหมวดเดียว "ทองคำ" ตาม Mockup (au) ที่ไม่แยกแท่ง/รูปพรรณตอนกรอง
export const CATEGORIES = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'stock_us', label: 'หุ้น US' },
  { key: 'stock_th', label: 'หุ้นไทย' },
  { key: 'crypto', label: 'คริปโต' },
  { key: 'gold', label: 'ทองคำ' },
];
