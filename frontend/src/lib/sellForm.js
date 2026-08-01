// ═══════════════════════════════════════════════════════════════════════
// sellForm — Logic ล้วนของ "โหมดขาย" ในกล่องบันทึกรายการ (Ledger ฝั่งขาย)
// ═══════════════════════════════════════════════════════════════════════
// แยกออกมาจาก DcaForm.jsx ด้วยเหตุผลเดียวกับ dcaPlanPrefill/dcaErrors: ตรรกะที่
// "ตัดสินว่าจะส่งอะไรไป Backend" ต้องทดสอบได้โดยไม่ต้องเรนเดอร์ React
//
// ⚠️ ขอบเขตของไฟล์นี้ — "ไม่คำนวณเงินเอง" แม้แต่บรรทัดเดียว:
//   - ยอดคงเหลือ (units) อ่านตรงจาก overview.allocation[].assets[].units ที่ Backend
//     คำนวณจาก Ledger มาแล้ว (transaction.service.calculateHeldQuantity) ไม่บวกลบเอง
//   - จำนวนเงินที่ได้จากการขาย (units × ราคา) "ไม่คิดที่นี่" — Backend คืนค่าที่บันทึก
//     จริงกลับมาให้แสดง (response.transaction.amountTotal)
//   - "ขายทั้งหมด" ส่ง sellAll:true ไปให้ Backend หายอดคงเหลือ + ราคาตลาดเอง ไม่ส่ง
//     จำนวนที่ Frontend อ่านมา (ยอดบนหน้าจออาจเก่ากว่าความจริงถ้ามีรายการเข้ามาทาง
//     LINE คั่น — ส่งไปจะกลายเป็นขายผิดจำนวน/เหลือเศษค้าง)
//
// การตรวจ "ขายเกินยอด" ที่นี่เป็น UX Guard เพื่อเตือนทันทีโดยไม่ต้องรอ Round-trip
// เท่านั้น — ด่านตัดสินจริงคือ transaction.service.validateSell ฝั่ง Backend เสมอ

// แปลงตัวเลขที่ผู้ใช้พิมพ์ (รับคอมม่าคั่นหลักพันได้) — คืน null ถ้าไม่ใช่ตัวเลขที่ใช้ได้
export function parseNumberInput(raw) {
  const n = parseFloat(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// แสดงจำนวนหน่วยแบบไม่ตัดทศนิยมของคริปโต (NUMERIC(20,8) ฝั่ง DB)
export function formatUnits(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('th-TH', { maximumFractionDigits: 8 });
}

// ── รายการสินทรัพย์ที่ "ขายได้จริง" ────────────────────────────────────────
// แบนราบ overview.allocation[].assets[] → รูปแบบเดียวกับ symbols ของ AssetPicker
// ({symbol,name,type}) จึง Reuse Component เดิมได้เลยโดยไม่ต้องทำ Picker ตัวที่สอง
//
// ต่างจากโหมดซื้อที่เลือกจาก Registry ทั้งหมด: โหมดขายต้องเลือกได้เฉพาะ "ที่ถืออยู่"
// เท่านั้น — ไม่งั้นผู้ใช้เลือกสินทรัพย์ที่ไม่มีในพอร์ตแล้วเจอ ASSET_NOT_FOUND
// ตอนกดบันทึก (Error ที่กันได้ตั้งแต่แรก)
export function buildHoldings(allocation) {
  if (!Array.isArray(allocation)) return [];

  const holdings = [];
  for (const group of allocation) {
    for (const asset of group?.assets ?? []) {
      const units = Number(asset?.units);
      // ยอด ≤ 0 = ขายออกไปหมดแล้ว (ยังมีแถว asset อยู่แต่ไม่มีอะไรให้ขาย) — ซ่อนไว้
      // ดีกว่าให้เลือกแล้วเจอ NOTHING_TO_SELL
      if (!Number.isFinite(units) || units <= 0) continue;

      holdings.push({
        symbol: asset.symbol,
        name: asset.name ?? asset.symbol,
        type: group.type,
        units,
        // สกุลของสินทรัพย์ตามที่ Backend อนุมานจากประวัติจริง — โหมดขาย "ล็อก" ตามนี้
        // ไม่ให้ผู้ใช้สลับเอง (ขายหุ้นที่ซื้อมาด้วย USD เป็นบาทจะทำให้ Ledger ปนสกุล)
        currency: asset.currency === 'USD' ? 'USD' : 'THB',
      });
    }
  }

  holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return holdings;
}

export function findHolding(holdings, symbol) {
  return holdings.find((h) => h.symbol === symbol) ?? null;
}

// ── สร้าง Payload ของ POST /api/v1/transactions (side='sell') ────────────────
// คืน { error: 'ข้อความไทย', field } เมื่อกรอกไม่ครบ/ไม่ถูก มิฉะนั้นคืน { payload }
export function buildSellPayload({
  holding,
  sellAll = false,
  quantityInput = '',
  priceInput = '',
  date,
  today,
  note = '',
}) {
  if (!holding) {
    return { error: 'กรุณาเลือกสินทรัพย์ที่ต้องการขายก่อน' };
  }

  if (date && today && date > today) {
    return { error: 'บันทึกรายการล่วงหน้าไม่ได้ กรุณาเลือกวันที่ไม่เกินวันนี้', field: 'date' };
  }

  const trimmedNote = note.trim();
  const base = {
    side: 'sell',
    symbol: holding.symbol,
    ...(date ? { date } : {}),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };

  // "ขายทั้งหมด" — ไม่ส่งจำนวน/ราคา/สกุลเลย ให้ Backend หาจาก Ledger + ราคาตลาดเอง
  if (sellAll) {
    return { payload: { ...base, sellAll: true } };
  }

  const quantity = parseNumberInput(quantityInput);
  if (quantity === null || quantity <= 0) {
    return { error: 'กรุณากรอกจำนวนหน่วยที่ต้องการขาย (มากกว่า 0)', field: 'quantity' };
  }
  if (quantity > holding.units) {
    return {
      error: `ขายเกินจำนวนที่ถืออยู่ — ตอนนี้ถือ ${formatUnits(holding.units)} ${holding.symbol}`,
      field: 'quantity',
    };
  }

  const pricePerUnit = parseNumberInput(priceInput);
  if (pricePerUnit === null || pricePerUnit <= 0) {
    return {
      error: 'กรุณากรอกราคาที่ขายได้ต่อหน่วย (หรือกด "ขายทั้งหมด" เพื่อใช้ราคาตลาด)',
      field: 'price',
    };
  }

  return {
    payload: { ...base, quantity, pricePerUnit, currency: holding.currency },
  };
}
