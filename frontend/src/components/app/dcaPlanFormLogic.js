// ═══════════════════════════════════════════════════════════════════════════
// dcaPlanFormLogic — ตรรกะตัดสินของฟอร์มแผน DCA บน /app (Pure ล้วน)
// ═══════════════════════════════════════════════════════════════════════════
// แยกออกจาก Component ด้วยเหตุผลเดียวกับ `recordTransactionLogic.js`: repo นี้
// ไม่มี jsdom/RTL → Effect/Interaction ทดสอบไม่ได้ · การย้ายการตัดสินใจมาไว้ที่นี่
// ทำให้ทดสอบ **สิ่งที่สำคัญจริง** ได้ คือ Payload ที่จะถูกส่งไป Backend
//
// ⚠️ **ห้ามใส่ State/Effect/DOM/การเรียก API ในไฟล์นี้** — เข้ามาเป็น Argument
// ออกไปเป็นค่าคืนเสมอ
//
// ⚠️ **ห้ามเพิ่มด่านจำกัดจำนวนแผนเองที่นี่** — เพดาน Free (2 แผน) เป็นของ Backend
// (dcaReminder.service → PLAN_LIMIT_REACHED 403) ถ้า Frontend เดาเองจะเพี้ยนจาก
// ของจริงทันทีที่ธุรกิจเปลี่ยนเพดาน · หน้าที่ของเว็บคือ "แสดง Error ที่ได้มาให้
// อ่านรู้เรื่อง" ไม่ใช่ตัดสินสิทธิ์แทน

// ช่วงค่าที่ถูกต้องของ frequencyValue ตาม API.md § 15.5.1
//   weekly  = 0–6 (0 = อาทิตย์)
//   monthly = 1–31
const FREQUENCY_RANGE = {
  weekly: { min: 0, max: 6 },
  monthly: { min: 1, max: 31 },
};

export const WEEKDAY_OPTIONS = Object.freeze([
  { value: 0, label: 'อาทิตย์' },
  { value: 1, label: 'จันทร์' },
  { value: 2, label: 'อังคาร' },
  { value: 3, label: 'พุธ' },
  { value: 4, label: 'พฤหัสบดี' },
  { value: 5, label: 'ศุกร์' },
  { value: 6, label: 'เสาร์' },
]);

// แปลงช่องกรอกเป็นจำนวนเงิน — คืน null เมื่อไม่ใช่จำนวนบวกจริง
// (ตัด comma ที่ผู้ใช้พิมพ์/วางมาออกก่อน เช่น "1,000")
function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return null;

  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// validateDcaPlanForm — ตรวจก่อนยิง API เพื่อบอกผู้ใช้เร็ว **ไม่ใช่เพื่อความปลอดภัย**
// ═══════════════════════════════════════════════════════════════════════════
// คืน { error } เมื่อกรอกไม่ครบ/ผิดช่วง · คืน { payload } เมื่อพร้อมส่ง
//
// ⚠️ ด่านจริงอยู่ Backend เสมอ — ที่นี่แค่กันไม่ให้ผู้ใช้เสียเวลารอ Round-trip
// เพื่อมาเจอ VALIDATION_ERROR ที่เดาได้ตั้งแต่ยังไม่ส่ง
export function validateDcaPlanForm({ picked, amountInput, currency, frequency, frequencyValue }) {
  if (!picked?.symbol) {
    return { error: 'กรุณาเลือกสินทรัพย์ก่อนสร้างแผน' };
  }

  const amountTotal = parseAmount(amountInput);
  if (amountTotal === null) {
    return { error: 'กรุณากรอกจำนวนเงินที่ถูกต้อง (มากกว่า 0)' };
  }

  const range = FREQUENCY_RANGE[frequency];
  if (!range) {
    return { error: 'กรุณาเลือกความถี่ (รายสัปดาห์ หรือ รายเดือน)' };
  }

  const value = parseInt(frequencyValue, 10);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    return {
      error:
        frequency === 'weekly'
          ? 'กรุณาเลือกวันในสัปดาห์ (อาทิตย์–เสาร์)'
          : 'กรุณากรอกวันที่ของเดือน (1-31)',
    };
  }

  return {
    payload: {
      symbol: picked.symbol,
      amountTotal,
      // 'THB' เป็น Default ของ Backend อยู่แล้ว แต่ส่งไปตรงๆ เพื่อให้ Payload
      // อ่านแล้วรู้ทันทีว่ากำลังตั้งแผนสกุลไหน (Pattern เดียวกับฟอร์มบันทึกรายการ)
      currency: currency === 'USD' ? 'USD' : 'THB',
      frequency,
      frequencyValue: value,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// existingPlanForSymbol — "Symbol นี้มีแผนอยู่แล้วไหม"
// ═══════════════════════════════════════════════════════════════════════════
// ใช้เตือนผู้ใช้ว่า "การสร้างแผนใหม่จะแทนที่แผนเดิม" (API.md § 15.5.1: 1 แผนต่อ
// symbol — ถ้ามีอยู่แล้วจะแทนที่ของเดิม เหมือนฝั่ง LINE)
//
// ⚠️ **UX เท่านั้น ไม่ใช่ด่าน** — ห้ามบล็อกการส่งฟอร์มเพราะเคสนี้ เพราะ "แทนที่
// แผนเดิม" คือพฤติกรรมที่ถูกต้องตาม Contract ไม่ใช่ Error · ถ้าบล็อกไว้ผู้ใช้จะ
// แก้แผนเดิมด้วยการสร้างทับไม่ได้ ทั้งที่เป็นวิธีที่ระบบตั้งใจให้ทำ
//
// เทียบแบบ case-insensitive ให้ตรงกับ Backend (Registry เทียบไม่สนตัวพิมพ์)
export function existingPlanForSymbol(plans, symbol) {
  if (!symbol) return null;
  const target = String(symbol).toUpperCase();
  return (plans ?? []).find((p) => String(p?.symbol ?? '').toUpperCase() === target) ?? null;
}

// ข้อความอธิบายรอบของแผน — ค่าที่ไม่รู้จักแสดงตามจริง ไม่เดา (Silent Default
// เป็น Anti-pattern) · Backend ส่ง dayLabel มาให้แล้วจึงใช้ตัวนั้นก่อนเสมอ
export function describeSchedule(plan) {
  if (plan?.dayLabel) return plan.dayLabel;
  if (plan?.frequency === 'monthly') return `ทุกวันที่ ${plan.dayOfMonth ?? '-'} ของเดือน`;
  if (plan?.frequency === 'weekly') {
    const label = WEEKDAY_OPTIONS.find((d) => d.value === plan.dayOfWeek)?.label;
    return label ? `ทุกวัน${label}` : 'ทุกสัปดาห์';
  }
  return plan?.frequency ?? 'ไม่ระบุรอบ';
}
