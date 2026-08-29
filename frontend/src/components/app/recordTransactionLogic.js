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
  return compact({
    side: form.type,
    symbol: form.symbol,
    quantity: numberOrUndefined(form.quantity),
    pricePerUnit: numberOrUndefined(form.pricePerUnit),
    amountTotal: numberOrUndefined(form.amountTotal),
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
  });
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
