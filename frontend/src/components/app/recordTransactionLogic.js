import { buildOcrPrefill } from '../../lib/slipOcrPrefill.js';

// ═══════════════════════════════════════════════════════════════════════════
// recordTransactionLogic — ตรรกะตัดสินของ RecordTransactionModal (Pure ล้วน)
// ═══════════════════════════════════════════════════════════════════════════
// แยกออกจาก Component ด้วยเหตุผลเดียวกับที่ `lib/slipOcrPrefill.js` ถูกแยกออกจาก
// `DcaForm.jsx`: **ตรรกะนี้กระทบตัวเลขที่จะกลายเป็น Ledger จริง** จึงต้องมี Test
// คลุมทุกกิ่งโดยไม่ต้อง Render React
//
// ⚠️ repo นี้ไม่มี @testing-library/react และไม่มี jsdom (Test ฝั่ง FE ทั้งหมดเป็น
// `renderToStaticMarkup` แบบ SSR + Pure-function Unit Test) — การทดสอบ "อัปโหลด →
// แก้ค่า → กดบันทึก" แบบ Interaction จึงทำไม่ได้ตรงๆ · การย้ายการตัดสินใจทั้งหมด
// มาไว้ที่นี่ทำให้ทดสอบ **สิ่งที่สำคัญจริง** (payload ที่จะถูกส่ง) ได้เข้มกว่าเดิมด้วยซ้ำ
// เพราะ assert ตัว Object ตรงๆ ไม่ใช่ผ่าน Mock ที่หลวม
//
// ⚠️ **ห้ามใส่ State/Effect/DOM ใดๆ ในไฟล์นี้** — เข้ามาเป็น Argument ออกไปเป็น
// ค่าคืนเสมอ ถ้าเริ่มต้องรู้จัก React แปลว่าวางผิดที่

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ กฎเหล็ก: ค่าจาก AI ห้ามไหลลง Ledger โดยผู้ใช้ไม่เห็น/ไม่ยืนยัน
// ═══════════════════════════════════════════════════════════════════════════
// ทุกค่าที่ฟังก์ชันนี้คืนออกไปจะถูกเติมลง **ช่องกรอกที่ผู้ใช้แก้ได้** เท่านั้น
// ไม่มี State ซ่อนที่ถูกส่งไป Backend โดยไม่ผ่านหน้าจอ (API.md § 15.8 ย่อหน้าแรก
// + Pattern เดียวกับการ์ด Preview ฝั่ง LINE)

// สถานะคำสั่งที่ "ยังไม่เกิดขึ้นจริง" — Ledger ต้องไม่มีรายการที่ไม่เคยเกิด
const UNFILLED_STATUSES = new Set(['pending', 'cancelled']);

// คืน 'pending' | 'cancelled' | null — null = สลิปนี้ Prefill ได้ตามปกติ
//
// ⚠️ **ไม่ได้แปลว่า "ห้ามบันทึก"** — Frontend ไม่บล็อกปุ่มบันทึกเด็ดขาด (Backend
// เป็นด่านสุดท้ายเสมอ) แต่ต้อง **ไม่ Prefill ให้กดง่ายๆ** และเตือนให้ชัดที่สุด
// เพราะผู้ใช้อาจรู้ว่าคำสั่งจับคู่แล้วทีหลังและอยากกรอกเอง
export function slipBlockReason(slip) {
  const status = slip?.orderStatus;
  return UNFILLED_STATUSES.has(status) ? status : null;
}

// แปลงเป็น String สำหรับ <input> — รับเฉพาะจำนวนบวกจริง (เหมือน slipOcrPrefill)
function inputOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? String(value) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// buildSlipPrefill — "ผลอ่านสลิปควรเติมอะไรลงฟอร์มนี้บ้าง"
// ═══════════════════════════════════════════════════════════════════════════
// ทุก Field ที่เป็น null = **อย่าแตะช่องนั้น** (ผู้เรียกต้องไม่เรียก setter ของมัน)
//
// ⚠️ Reuse `buildOcrPrefill` ของ lib เป็นแกน **ห้ามเขียนกฎ side ใหม่เอง** — กฎ
// "ห้าม Default เป็น buy เมื่ออ่านทิศทางไม่ได้" (เคส BCPG) ถูกพิสูจน์ด้วย Test
// ไว้ที่นั่นแล้ว ถ้าเขียนซ้ำที่นี่จะกลายเป็นสองมาตรฐานที่เพี้ยนจากกันได้
//
// ที่นี่ทำแค่ **แปลงรูปร่าง** จาก Field ของ DcaForm (amountInput/sellQuantity/
// buyQuantity/…) มาเป็นชุดช่องของฟอร์มนี้ (quantity/pricePerUnit/amountTotal)
export function buildSlipPrefill(slip) {
  const blockReason = slipBlockReason(slip);
  const base = {
    blockReason,
    // 'buy' | 'sell' | null — ⚠️ null = **ห้ามเลือกประเภทให้ผู้ใช้เด็ดขาด**
    type: null,
    sideUnresolved: true,
    symbol: typeof slip?.symbol === 'string' && slip.symbol ? slip.symbol : null,
    quantity: null,
    pricePerUnit: null,
    amountTotal: null,
    // ⚠️ สกุลเงินไม่ขึ้นกับทิศทาง (เหมือน date) จึงอ่านจาก slip ตรงๆ ได้เสมอ
    // — `buildOcrPrefill` คืน currency ให้เฉพาะสาขา buy เท่านั้น (DcaForm ไม่มี
    // โหมดขายสกุล USD) แต่ฟอร์มนี้มีช่องสกุลเงินร่วมกันทั้งซื้อ/ขาย
    //
    // 🔴 ถ้าไม่พกค่านี้ไปด้วย สลิป USD จะถูกบันทึกเป็นบาท = ยอดเงินผิดใน Ledger จริง
    // (Backend Default เป็น 'THB' เมื่อไม่ส่ง currency มา — controller บรรทัด 369)
    currency: slip?.currency === 'USD' ? 'USD' : null,
    date: null,
    // ── ⭐ ค่าธรรมเนียมจากสลิป (Founder 29 ส.ค. 2569) ────────────────────────
    // Backend อ่านมาให้อยู่แล้ว (transactions.controller: `feeTotal: ocr.feeTotal`)
    // แต่เดิมฟอร์มทิ้งค่านี้ไปเฉยๆ ผู้ใช้ต้องพิมพ์เองทั้งที่ AI อ่านมาแล้ว
    //
    // ⚠️ อยู่ใน `base` คู่กับ currency โดยเจตนา — ค่าธรรมเนียม **ไม่ขึ้นกับทิศทาง**
    // (ซื้อก็มี ขายก็มี) ต่างจาก quantity/amountTotal ที่ความหมายเปลี่ยนตาม side
    //
    // ⚠️ inputOrNull ปัด 0 และค่าที่ไม่ใช่จำนวนบวกเป็น null → "สลิปไม่ระบุ
    // ค่าธรรมเนียม" (feeTotal: null) จะ **ไม่แตะช่องนี้เลย** ไม่ใช่เติม 0 ให้
    // (0 = "ยืนยันว่าไม่มีค่าธรรมเนียม" คนละความหมายกับ "ไม่รู้" — กฎยืนข้อ 11)
    feeThb: inputOrNull(slip?.feeTotal),
    lowConfidence: slip?.confidence === 'low',
  };

  // คำสั่งที่ยังไม่เกิดขึ้นจริง → ไม่เติมอะไรเลยแม้แต่ช่องเดียว (ให้ผู้ใช้กรอกเอง
  // ถ้ายืนยันว่าจับคู่แล้ว) — คืน symbol/currency ไว้ให้ Caller แสดงใน Banner ได้
  if (blockReason) return base;

  const prefill = buildOcrPrefill(slip);

  const mapped = {
    ...base,
    type: prefill.side,
    sideUnresolved: prefill.sideUnresolved,
    date: prefill.date,
  };

  if (prefill.side === 'sell') {
    return {
      ...mapped,
      quantity: prefill.sellQuantity,
      pricePerUnit: prefill.sellPrice,
    };
  }

  if (prefill.side === 'buy') {
    return {
      ...mapped,
      // ⭐ สลิประบุจำนวนหน่วย + ราคาครบ → ใช้ตัวเลขจริงจากสลิป (API.md § 15.2.1
      // เส้นทางแรก: priceSource='user' ไม่ดึงราคาตลาดมาคำนวณทับ) · ถ้าไม่ครบ
      // buildOcrPrefill จะคืน buyQuantity เป็น null แล้วให้ pricePerUnit แทน
      quantity: prefill.buyQuantity,
      pricePerUnit: prefill.buyQuantity ? prefill.buyPricePerUnit : prefill.pricePerUnit,
      amountTotal: prefill.amountInput,
    };
  }

  // ทิศทางไม่ชัด → ไม่เติมตัวเลขที่ความหมายขึ้นกับทิศทางเลยสักช่อง
  // (ช่อง "จำนวนหน่วย" ของขาย กับ "จำนวนเงินรวม" ของซื้อ คนละความหมายสิ้นเชิง)
  return mapped;
}

// ข้อความบอกโควตาที่เหลือ — คืน null เมื่อ Backend ไม่ได้ส่ง quota มา (ไม่เดาเลข)
export function quotaNotice(quota) {
  if (!quota || typeof quota.remaining !== 'number') return null;

  return quota.mode === 'trial'
    ? `ทดลองใช้ฟรี — เหลืออีก ${quota.remaining} ครั้ง (การเก็บรูปสลิปเป็นหลักฐานเป็นสิทธิ์ Premium)`
    : `โควตาอ่านสลิปเดือนนี้เหลือ ${quota.remaining} ครั้ง`;
}

// แปลงช่องกรอก (String) → number สำหรับ Payload · '' / 0 / ติดลบ → undefined
// (undefined = ไม่ใส่ Key นั้นลง Payload เลย ซึ่งคนละความหมายกับส่ง 0)
function numberOrUndefined(value) {
  const num = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(num) && num > 0
    ? num
    : undefined;
}

// ตัด Key ที่เป็น undefined ออกให้หมด — Payload ที่ส่งจริงต้องมีเฉพาะ Key ที่มีค่า
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ═══════════════════════════════════════════════════════════════════════════
// buildTransactionPayload — Body ของ POST /api/v1/transactions (§ 15.2)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ ชื่อ Field คือ **`amountTotal`** ไม่ใช่ `amountThb`
// (API.md § 15.2.1 + transactions.controller.js `toPositiveNumber(body.amountTotal)`)
//
// 🔴 บั๊กที่แก้ไปพร้อมงานนี้: ฟอร์มเดิมส่ง `amountThb` ซึ่ง Backend ไม่เคยอ่านเลย →
// ผู้ใช้ที่กรอก "จำนวนเงินรวม" อย่างเดียว (เคสซื้อ DCA ปกติที่สุด) ได้
// `VALIDATION_ERROR { field: 'amountTotal' }` ทุกครั้ง
// ⚠️ Endpoint ปันผล (§ 15.2 คนละตัว) ใช้ `amountThb` จริง — **อย่าเปลี่ยนตาม**
// (ดู buildDividendPayload ด้านล่าง · controller บรรทัด 754)
//
// ⚠️ ส่ง "ค่าที่อยู่ในช่องกรอกที่ผู้ใช้เห็น" เสมอ ไม่คำนวณอะไรเพิ่มเอง —
// ยอดที่บันทึกลง Ledger ต้องเท่ากับยอดที่ผู้ใช้เห็นตอนกดบันทึก (มติ Founder)
// Service ยังตรวจ resolveAgreedAmount (±2%) ให้อีกชั้นอยู่แล้ว
export function buildTransactionPayload(form) {
  // ⭐ ขายทั้งหมด (ปัญหาที่ 3, Founder ทดสอบฟอร์มขาย 30 ส.ค. 2569) — Backend
  // คำนวณจำนวน/ราคาเอง ต้อง **ไม่** ส่งจำนวน/ราคา/ยอดเงินไปเลยแม้ State ของฟอร์ม
  // จะมีค่าค้างอยู่ (เช่น ผู้ใช้เคยพิมพ์ไว้ก่อนติ๊กปุ่มนี้) — Backend เองก็เมิน
  // Field พวกนี้อยู่แล้วตอน sellAll แต่กันความสับสนไว้ตั้งแต่ Payload เลยดีกว่า
  const isSellAll = form.type === 'sell' && form.sellAll === true;

  return compact({
    side: form.type,
    symbol: form.symbol,
    // ⭐ assetId — Fast-Path Resolution ฝั่งขาย (ปัญหาที่ 4: AMBIGUOUS_ASSET_PORTFOLIO
    // ทั้งที่เลือกสินทรัพย์เจาะจงจาก Dropdown แล้ว) — ส่งเฉพาะตอนรู้แน่ชัดว่าเป็น
    // แถวไหนจริง (ผู้ใช้เลือกจาก Dropdown ที่มี assetId) ไม่ส่งตอนพิมพ์ Symbol ใหม่
    // ที่ยังไม่เคยถือ (ไม่มี assetId ให้ส่งอยู่แล้วในเคสนั้น) — Backend อ่านค่านี้
    // เฉพาะฝั่งขาย ส่งไปตอนซื้อก็ไม่มีผลอะไร (เมินทิ้งเงียบๆ)
    assetId: form.assetId || undefined,
    // ⭐ ขายทั้งหมด — รับเฉพาะ `true` แท้ๆ (ไม่ใช่ Truthy อื่น) ให้ตรงกับที่ Backend
    // รับ (`body.sellAll === true` Strict Boolean) — กัน Client ส่งค่าผิดชนิดแล้ว
    // กลายเป็นขายยกพอร์ตโดยไม่ตั้งใจ
    sellAll: isSellAll ? true : undefined,
    quantity: isSellAll ? undefined : numberOrUndefined(form.quantity),
    pricePerUnit: isSellAll ? undefined : numberOrUndefined(form.pricePerUnit),
    amountTotal: isSellAll ? undefined : numberOrUndefined(form.amountTotal),
    // 'THB' เป็นค่าเริ่มต้นของ Backend อยู่แล้ว แต่ส่งไปตรงๆ เพื่อให้ Payload
    // อ่านแล้วรู้ทันทีว่ากำลังบันทึกสกุลไหน (สลิป USD ต้องไม่กลายเป็นบาทเงียบๆ)
    currency: form.currency === 'USD' ? 'USD' : 'THB',
    // 'none' = "ระบุแล้วว่าไม่มีโบรก" ซึ่งคนละความหมายกับไม่ส่ง Key มาเลย
    brokerId: form.brokerId || undefined,
    date: form.date || undefined,
    note: form.note || undefined,
    // ⚠️ ผู้ใช้ Free/Trial ได้ slipToken = null → **ห้ามส่ง Key นี้เลย**
    // (ส่ง null ไปตรงๆ คนละเรื่องกับไม่ส่ง — API.md § 15.2 ระบุว่าเป็น Optional)
    slipToken: form.slipToken || undefined,
    // ── ⭐ ค่าธรรมเนียม — งานที่ 3 (Founder 29 ส.ค. 2569) ─────────────────────
    // Backend รองรับอยู่แล้วทั้งซื้อ/ขาย (migration 041, transactions.controller
    // บรรทัด 359-365) เป็น Optional Field — ⚠️ ไม่กรอก = "ไม่รู้ค่า" ต้องไม่ส่ง
    // Key นี้เลย (numberOrUndefined ปัด '' และ 0 เป็น undefined ให้อยู่แล้ว)
    // **ห้ามส่ง 0 แทนค่าว่าง** — Backend แยกความหมาย "ไม่กรอก" (NULL) กับ "กรอก 0
    // ยืนยันว่าไม่มีค่าธรรมเนียม" (0) ไว้คนละความหมาย ฟอร์มนี้ไม่มีช่องยืนยัน 0
    // แยกต่างหาก จึงส่งเฉพาะตอนกรอกค่าจริงมากกว่า 0 เท่านั้น (ตรงกับ numberOrUndefined)
    feeThb: numberOrUndefined(form.feeThb),
    // ── ⭐ พอร์ตปลายทางที่ผู้ใช้เลือก (มติ Founder 29 ส.ค. 2569) ───────────────
    // ไม่เลือก/ไม่มีพอร์ตให้เลือก → **ไม่ส่ง Key นี้เลย** = พฤติกรรมเดิมเป๊ะ
    // (Backend Resolve เป็นพอร์ตหลักให้เหมือนเดิม)
    //
    // ⚠️ Backend ใช้ค่านี้เป็น "ปลายทางของสินทรัพย์ใหม่" เท่านั้น — ถ้า Symbol นี้
    // ถืออยู่แล้วในพอร์ตอื่น รายการจะถูกรวมเข้าแถวเดิมและค่านี้ถูกละเว้นโดยตั้งใจ
    // (ดู transaction.service.validateBuy — กันสินทรัพย์เดียวกันแตกสองพอร์ต)
    // ฟอร์มจึงต้องบอกผู้ใช้ให้ชัดว่ากติกานี้มีอยู่ ไม่ใช่ปล่อยให้เดาเอง
    portfolioId: form.portfolioId || undefined,
    // ── ⭐ คำตอบของผู้ใช้เมื่อถือ Symbol นี้อยู่ในพอร์ตอื่นแล้ว ────────────────
    //   undefined = ยังไม่ได้ถาม → Backend จะตอบ 409 ASSET_EXISTS_IN_OTHER_PORTFOLIO
    //   true      = "แยกเป็นอีกแถวในพอร์ตที่เลือก"
    //   false     = "รวมเข้าพอร์ตเดิม" (พฤติกรรมเดิม)
    //
    // ⚠️ **ห้ามใช้ `|| undefined`** เหมือน Field อื่นในไฟล์นี้ — `false` เป็นคำตอบ
    // ที่มีความหมายจริง ถ้าถูกปัดเป็น undefined ผู้ใช้ที่เลือก "รวมพอร์ตเดิม" จะ
    // โดนถามซ้ำไม่รู้จบ (Backend แยก false ออกจาก undefined โดยตั้งใจ)
    confirmSeparatePortfolio:
      typeof form.confirmSeparatePortfolio === 'boolean'
        ? form.confirmSeparatePortfolio
        : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// defaultDestinationPortfolioId — ค่าตั้งต้นของช่อง "บันทึกลงพอร์ต"
// ═══════════════════════════════════════════════════════════════════════════
// ลำดับการเลือก (Pure — แยกออกมาเพื่อให้ทดสอบได้โดยไม่ต้อง Render):
//   1. พอร์ตที่ Switcher ด้านบนเลือกอยู่ — ถ้าเขียนได้
//   2. พอร์ตหลัก (isDefault) ที่เขียนได้ — ใช้เมื่อ Switcher เป็น "ทั้งหมด" (null)
//      หรือพอร์ตที่เลือกอยู่ถูกล็อก
//   3. พอร์ตแรกที่เขียนได้
//   4. null = ไม่มีพอร์ตให้เลือกเลย → Caller ต้องไม่ส่ง portfolioId ไป Backend
//
// ⚠️ ข้อ 1 ต้องเช็ค canWrite ด้วย ไม่ใช่หยิบ id มาดื้อๆ — ผู้ใช้เปิด Modal ค้างที่
// พอร์ตที่ถูกล็อกได้ (ปุ่ม "บันทึกการขาย" เปิดเสมอ) ถ้าตั้งเป็นปลายทางให้เลย
// ผู้ใช้จะเจอ 403 ทันทีที่สลับไปแท็บ "ซื้อ" ทั้งที่ไม่ได้ตั้งใจเลือกพอร์ตนั้น
export function defaultDestinationPortfolioId(selectedPortfolio, portfolios) {
  const writable = (portfolios ?? []).filter((p) => p?.canWrite === true);
  if (writable.length === 0) return null;

  if (selectedPortfolio?.canWrite === true) {
    const stillThere = writable.find((p) => p.id === selectedPortfolio.id);
    if (stillThere) return stillThere.id;
  }

  return (writable.find((p) => p.isDefault) ?? writable[0]).id;
}

// ═══════════════════════════════════════════════════════════════════════════
// needsSymbolFetch — "ต้องโหลดรายการสินทรัพย์จาก Registry อีกไหม"
// ═══════════════════════════════════════════════════════════════════════════
// ใช้กับปุ่ม "+ สินทรัพย์ใหม่ (พิมพ์เอง)" ซึ่งโหลด `GET /assets/symbols` แบบ Lazy
// (กรณีส่วนใหญ่คือซื้อของที่ถืออยู่แล้ว จึงไม่ควรยิงตอนเปิด Modal ทุกครั้ง)
//
// null/undefined = ยังไม่เคยโหลด · Array = โหลดแล้ว (รวมกรณี [] ที่ Registry ว่าง
// จริงๆ — ต้องไม่ยิงซ้ำไม่รู้จบ) กัน "กดเปิด/ปิดหลายรอบแล้วยิงซ้ำทุกรอบ"
//
// ⚠️ นี่เป็นด่านที่ **สอง** — `lib/symbolsCache.js` มี Cache ระดับ Module + กัน
// Fetch ซ้อน (inFlight) อยู่แล้ว ด่านนี้ทำให้ไม่ต้องเรียกฟังก์ชันนั้นซ้ำตั้งแต่ต้น
export function needsSymbolFetch(loadedSymbols) {
  return !Array.isArray(loadedSymbols);
}

// ═══════════════════════════════════════════════════════════════════════════
// normalizeBrokerName — ตัดช่องว่างหัวท้ายชื่อโบรกใหม่ก่อนส่งไป Backend (งานที่ 2)
// ═══════════════════════════════════════════════════════════════════════════
// คืน null เมื่อว่างเปล่า (พิมพ์แต่ Whitespace/ไม่ได้พิมพ์อะไรเลย) ให้ Caller เช็ค
// ก่อนยิง POST /api/v1/brokers แทนที่จะพึ่ง `disabled` ของปุ่มอย่างเดียว (กัน Race
// แปลกๆ จาก Autofill/Paste ที่ทำให้ State กับ DOM ไม่ตรงกันชั่วขณะ)
export function normalizeBrokerName(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// assetOptionLabel — ป้ายกำกับ Option ของ Dropdown "สินทรัพย์" (ซื้อ/ขาย/ปันผล)
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 บั๊กที่แก้ (Founder ทดสอบกดปุ่ม "+ บันทึกรายการขาย" 30 ส.ค. 2569): Label เดิม
// `${symbol} — ${name}` ส่วนใหญ่ name === symbol เป๊ะ (เช่น "EOSE — EOSE") จึง
// แยกไม่ออกว่าแถวไหนเป็นของโบรกไหน เมื่อ Symbol เดียวกันถืออยู่หลายโบรกในพอร์ต
// เดียวกัน (migration 046 อนุญาต) — ผู้ใช้เสี่ยงกดขายผิดพอร์ต/ผิดโบรกโดยไม่รู้ตัว
//
// ⚠️ Logic เดียวกับ `PortfolioSettingsPanel.jsx`'s assetOptionLabel() เป๊ะ — Copy
// มาแทนที่จะย้ายเป็น Shared Module เพราะไฟล์นั้นไม่ได้อยู่ในขอบเขตงานนี้ (ทั้งสอง
// จุด Logic เหมือนกันทุกตัวอักษร ถ้าจะรวมเป็น lib/ shared ทีหลังค่อยทำแยกต่างหาก)
export function assetOptionLabel(asset, brokers) {
  const brokerName = asset?.brokerId
    ? ((brokers ?? []).find((b) => b?.id === asset.brokerId)?.name ?? 'ไม่ระบุ')
    : 'ไม่ระบุ';
  return `${asset?.symbol ?? ''} — ${brokerName}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// assetListParams — Query Param ของ GET /assets ตอนเปิด Modal (งานที่ 1)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ กรองตาม portfolioId **เฉพาะตอนเปิดจากบริบทพอร์ตเจาะจง** (หน้ารายละเอียด
// พอร์ต ส่ง `scopePortfolioId` ลงมา) — เปิดจาก Topbar "+ บันทึกรายการ" ที่ไม่ได้
// ผูกกับพอร์ตไหน (scopePortfolioId เป็น undefined) ต้องเห็นสินทรัพย์ทุกพอร์ต
// เหมือนเดิมทุกประการ — ห้ามบังคับกรองจนพัง Use Case เดิม
//
// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ excludeZeroHolding (E2E Chrome Test — บั๊กที่ 1 ตามจริง, มติ Founder)
// ═══════════════════════════════════════════════════════════════════════════
// เฉพาะ "ขาย"/"ปันผล" เท่านั้นที่ควรกรองสินทรัพย์ 0 หน่วยออกจาก Dropdown —
// ทั้งสองโหมดนี้ระบุสินทรัพย์ที่ "มีอยู่จริง" เท่านั้น (ขายของที่ไม่มี/รับปันผล
// จากของที่ไม่มีไม่สมเหตุสมผล) ตรงข้ามกับ "ซื้อ" ที่ต้องยังเห็นสินทรัพย์เก่าที่
// 0 หน่วยได้ปกติ (ซื้อกลับเข้าแถวเดิม ไม่ต้องถูกบังคับสร้างสินทรัพย์ใหม่)
//
// ⚠️ type = undefined (ไม่รู้จัก/ยังไม่ได้ส่งมา) → **ไม่กรอง** (ปลอดภัยกว่า
// การกรองผิดโหมดโดยไม่ตั้งใจ — เหมือน Backend Default ที่ไม่กรองเมื่อไม่ส่ง
// Query Param มา)
export function assetListParams(scopePortfolioId, type) {
  return {
    ...(scopePortfolioId ? { portfolioId: scopePortfolioId } : {}),
    ...(type === 'sell' || type === 'dividend' ? { excludeZeroHolding: true } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// sellAllErrorText — ข้อความไทยสำหรับ Error ที่มาจากปุ่ม "ขายทั้งหมด" (ปัญหาที่ 3)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ `err.message` ของ lib/api.js เก็บ **Error Code ดิบจาก Backend** ไม่ใช่ข้อความ
// ไทย (ดู buildApiError ใน lib/api.js — ตั้งใจเก็บโค้ดไว้ที่ `.message` ให้ Caller
// เทียบ === ได้ตรงๆ) Catch-all เดิมของฟอร์มนี้จึงโชว์โค้ดดิบให้ผู้ใช้เห็นสำหรับ
// Error ที่ไม่ได้ถูก Map ไว้เฉพาะ — เป็นพฤติกรรมเดิมที่มีอยู่ก่อนงานนี้ (นอกขอบเขต
// ที่จะแก้ทั้งหมด) ที่นี่ Map เฉพาะ Code ที่ปุ่ม "ขายทั้งหมด" คาดว่าจะเจอจริง
//
// ⭐ ใช้ร่วมกัน 2 เส้นทาง (Founder ทดสอบ UI Confirm ก่อนกด 30 ส.ค. 2569):
//   1. บันทึกขายทั้งหมดจริง (POST /transactions sellAll:true) — NOTHING_TO_SELL /
//      MARKET_PRICE_UNAVAILABLE จาก transaction.service.validateSell
//   2. Preview ก่อนยืนยัน (GET /dashboard/profit/:symbol, Reuse Endpoint เดิม
//      ไม่แตะ Backend) — Error Code คนละชุดจาก profit.service ที่ความหมาย
//      ตรงกันเป๊ะกับข้อ 1 แต่ชื่อไม่เหมือนกัน (Endpoint คนละตัว คนละ Convention)
//      + Ambiguous Resolution ที่ไม่ควรเกิดจริง (ส่ง brokerId/portfolioId ของ
//      สินทรัพย์ที่เลือกไปด้วยเสมอ) แต่ Map ไว้กันเหนียวไม่ให้หลุดเป็นโค้ดดิบ
//
// ── Error ที่ไม่ผูกกับทิศทางซื้อ/ขาย (Generic) ───────────────────────────────
// ⚠️ resolveOwnedAsset (Asset Resolution) เป็น Logic ร่วมของทั้งซื้อและขาย —
// Code กลุ่มนี้จึง throw ได้จากทั้งสองทิศทาง ข้อความไม่มีคำว่า "ขายทั้งหมด"
// เลยจึงใช้ร่วมกันได้ตรงๆ ไม่ต้องแยกตามบริบท
const GENERIC_ASSET_ERROR_MSG = {
  ASSET_NOT_FOUND: 'ไม่พบสินทรัพย์นี้ในพอร์ต (อาจถูกย้าย/ลบไปแล้ว) กรุณาเลือกสินทรัพย์จากรายการใหม่อีกครั้ง',
  // ไม่ควรเกิดจริง (Fast-Path ส่ง assetId/brokerId/portfolioId ของสินทรัพย์ที่
  // เลือกไปด้วยเสมอ) — กันเหนียวไว้เผื่อข้อมูลเปลี่ยนระหว่างเปิดฟอร์ม ไม่ให้หลุด
  // เป็นโค้ดดิบ
  AMBIGUOUS_ASSET_BROKER: 'ระบบระบุสินทรัพย์ที่แน่นอนไม่ได้ กรุณาเลือกสินทรัพย์จากรายการใหม่อีกครั้ง',
  AMBIGUOUS_ASSET_PORTFOLIO: 'ระบบระบุสินทรัพย์ที่แน่นอนไม่ได้ กรุณาเลือกสินทรัพย์จากรายการใหม่อีกครั้ง',
};

// คืน null เมื่อไม่รู้จัก Code นี้ — Caller ต้อง Fallback เป็นพฤติกรรมเดิม (โชว์
// err.message ดิบ) เอง ไม่ใช่ปั้นข้อความเดาสุ่มจากที่นี่
export function sellAllErrorText(code) {
  const NO_PRICE_FEED_MSG =
    'ระบบดึงราคาตลาดปัจจุบันของสินทรัพย์นี้ไม่ได้ (เช่น หุ้นไทยที่ยังไม่มีราคาสดอัตโนมัติ) — กรุณายกเลิก "ขายทั้งหมด" แล้วกรอกจำนวนหน่วยและราคาที่ขายได้เองแทน';
  const NOTHING_TO_SELL_MSG = 'สินทรัพย์นี้ขายออกไปหมดแล้ว ไม่มียอดคงเหลือให้ขาย';

  const MAP = {
    ...GENERIC_ASSET_ERROR_MSG,
    NOTHING_TO_SELL: NOTHING_TO_SELL_MSG,
    // หุ้นไทยอย่าง EOSE ไม่มี Price Feed อัตโนมัติ — ต้องบอกทางออกจริงที่ทำได้
    // (กรอกจำนวน/ราคาเอง) ไม่ใช่แค่บอกว่า "ดึงราคาไม่ได้" เฉยๆ
    MARKET_PRICE_UNAVAILABLE: NO_PRICE_FEED_MSG,
    // ── Error จาก GET /dashboard/profit/:symbol (Preview) — ความหมายเดียวกับ
    // 2 Code ข้างบนเป๊ะ แค่มาจาก Service คนละตัว (profit.service ไม่ใช่
    // transaction.service) จึงใช้ชื่อ Code คนละชุด
    PRICE_FEED_NOT_IMPLEMENTED: NO_PRICE_FEED_MSG,
    GOLD_PRICE_UNAVAILABLE:
      'ระบบดึงราคาทองคำปัจจุบันไม่ได้ในขณะนี้ — กรุณายกเลิก "ขายทั้งหมด" แล้วกรอกจำนวนหน่วยและราคาที่ขายได้เองแทน',
    NO_HOLDING_TO_CALCULATE_PROFIT: NOTHING_TO_SELL_MSG,
  };
  return MAP[code] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// buyErrorText — ข้อความไทยสำหรับ Error ฝั่ง "ซื้อ" (บั๊ก Founder ทดสอบ 30 ส.ค.
// 2569: ซื้อด้วยยอดรวมอย่างเดียวเจอ PRICE_FEED_NOT_IMPLEMENT แล้วโดนบอกให้
// "เลือกขายทั้งหมด" ทั้งที่กำลังซื้อ — ปุ่มนั้นไม่มีอยู่ในโหมดซื้อเลย)
// ═══════════════════════════════════════════════════════════════════════════
// validateBuy's resolveQuantityAndPrice (backend transaction.service.js) โยน
// Code เดียวกับฝั่งขาย (Amount-only → คำนวณราคาต่อหน่วยจาก Price Feed ไม่ได้)
// แต่ทางออกที่ถูกต้องสำหรับซื้อคือ "กรอกจำนวนหน่วย/ราคาต่อหน่วยเอง" ไม่ใช่คำแนะนำ
// เกี่ยวกับปุ่ม "ขายทั้งหมด" — ห้ามใช้ sellAllErrorText() กับ Error ฝั่งซื้อเด็ดขาด
//
// คืน null เมื่อไม่รู้จัก Code นี้ — Caller ต้อง Fallback เป็น err.message ดิบเอง
export function buyErrorText(code) {
  const MAP = {
    ...GENERIC_ASSET_ERROR_MSG,
    MARKET_PRICE_UNAVAILABLE:
      'ระบบดึงราคาตลาดปัจจุบันของสินทรัพย์นี้ไม่ได้ (เช่น หุ้นไทยที่ยังไม่มีราคาสดอัตโนมัติ) — กรุณากรอกจำนวนหน่วยและราคาต่อหน่วยเองแทน',
    PRICE_FEED_NOT_IMPLEMENTED:
      'ระบบดึงราคาตลาดปัจจุบันของสินทรัพย์นี้ไม่ได้ (เช่น หุ้นไทยที่ยังไม่มีราคาสดอัตโนมัติ) — กรุณากรอกจำนวนหน่วยและราคาต่อหน่วยเองแทน',
    GOLD_PRICE_UNAVAILABLE:
      'ระบบดึงราคาทองคำปัจจุบันไม่ได้ในขณะนี้ — กรุณากรอกจำนวนหน่วยและราคาต่อหน่วยเองแทน',
  };
  return MAP[code] ?? null;
}

// Body ของ POST /api/v1/transactions/dividend — ⚠️ Endpoint นี้ใช้ `amountThb`
// จริงตาม Contract (controller: `toPositiveNumber(body.amountThb)`) อย่าเปลี่ยน
// ให้เหมือน § 15.2 · และไม่มีแนวคิดสลิป/ทิศทาง/โบรกในเส้นทางนี้
export function buildDividendPayload(form) {
  return compact({
    assetId: form.assetId,
    amountThb: numberOrUndefined(form.amountThb),
    quantity: numberOrUndefined(form.quantity),
    date: form.date || undefined,
    note: form.note || undefined,
  });
}
