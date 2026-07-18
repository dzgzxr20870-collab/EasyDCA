// ═══════════════════════════════════════════════════════════════════════
// dcaPlanPrefill — คำนวณ State ที่จะ Prefill ให้ DcaForm จากปุ่ม "บันทึกเลย" (S8 R3
// รอบ 3) — แยกเป็น Pure Function ต่างหากจาก DcaForm เพราะ repo นี้ไม่มี jsdom/React
// Testing Library (renderToStaticMarkup ที่มีอยู่ไม่รัน useEffect เลย) จึง Unit Test
// Logic ตรงนี้แทนการพึ่ง Component-level Interaction Test ที่ทำไม่ได้จริงใน Repo นี้
//
// prefillSignal: { symbol, amountTotal, currency, nonce } | null
// symbols: [{symbol,name,type}] จาก GET /api/v1/assets/symbols

function fmtAmountInput(n) {
  return n.toLocaleString('th-TH');
}

export function resolvePrefillState(prefillSignal, symbols) {
  if (!prefillSignal) return null;

  const picked = symbols.find((s) => s.symbol === prefillSignal.symbol) ?? null;

  return {
    picked,
    amountInputStr: fmtAmountInput(prefillSignal.amountTotal),
    currency: prefillSignal.currency ?? 'THB',
  };
}
