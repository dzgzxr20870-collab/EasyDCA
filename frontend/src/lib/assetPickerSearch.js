// ═══════════════════════════════════════════════════════════════════════
// assetPickerSearch — ตรรกะค้นหา/กรองล้วน (Pure) ของ Dropdown เลือกสินทรัพย์
// ═══════════════════════════════════════════════════════════════════════
// แยกออกจาก AssetPicker.jsx (Component) เพื่อ Test การค้นหา/กรองได้โดยไม่ต้อง
// Render React — Port ตรงจาก Logic ใน Mockup (norm/filter ใน
// design/easydca-dashboard-redesign.html) พฤติกรรมเดิมทุกประการ

// Normalize: ตัวพิมพ์เล็ก + ตัดช่องว่างทั้งหมด — ให้ค้นหา "AMD"/"amd"/"a m d" เจอ
// เหมือนกัน (Pattern เดียวกับ Mockup: norm = s => s.toLowerCase().replace(/\s+/g,""))
export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

// 'gold' เป็นหมวดรวม 2 Type ย่อย (gold_bar/gold_ornament) — Type อื่น Match ตรงตัว
export function matchesCategory(type, categoryKey) {
  if (categoryKey === 'all') return true;
  if (categoryKey === 'gold') return type === 'gold_bar' || type === 'gold_ornament';
  return type === categoryKey;
}

// กรองรายการสินทรัพย์ตามหมวด + คำค้น (ค้นได้ทั้ง symbol และชื่อไทย/อังกฤษ)
// symbols: [{ symbol, name, type }] จาก GET /api/v1/assets/symbols
export function filterSymbols(symbols, { category = 'all', query = '' } = {}) {
  const q = normalize(query);

  return (symbols ?? []).filter((s) => {
    if (!matchesCategory(s.type, category)) return false;
    if (!q) return true;
    return normalize(s.symbol).includes(q) || normalize(s.name).includes(q);
  });
}
