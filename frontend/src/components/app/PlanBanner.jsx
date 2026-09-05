import { NavLink } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════════════════
// PlanBanner — แบนเนอร์ Free/Premium ติดตามบนหน้า /app/* (พรอมต์ ก.ย. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ข้อความ/เงื่อนไข Reuse จาก pages/Dashboard.jsx (`.dashboard-plan-banner`)
// ทุกประการ — ต่างกันแค่ Class/Layout ให้เข้ากับธีมของ `/app/*` (appShell.css)
//
// ⚠️ entitlements.loaded === false → ไม่แสดงอะไรเลย (ไม่เดาเป็น Free ก่อน —
// ตรงกับกฎเหล็ก Fail-closed ของ lib/entitlements.js)

// ชื่อเดือนไทยเต็ม — Pattern เดียวกับ pages/Dashboard.jsx (formatThaiDate เขียน
// inline ซ้ำที่นี่เพราะไม่ import ข้าม pages/components ได้)
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function formatThaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');

  return `${day} ${THAI_MONTH_NAMES[month - 1]} ${year + 543}`;
}

function PlanBanner({ entitlements }) {
  if (!entitlements?.loaded) return null;

  if (entitlements.isPremiumActive) {
    return (
      <section className="app-plan-banner app-plan-banner--premium" role="status">
        <p>👑 คุณเป็นสมาชิก Premium (หมดอายุ {formatThaiDate(entitlements.planExpiresAt)})</p>
      </section>
    );
  }

  return (
    <NavLink to="/premium" className="app-plan-banner app-plan-banner--free" role="status">
      <p>
        คุณใช้แผน Free (จำกัด {entitlements.assetLimit} สินทรัพย์) — อัพเกรดเป็น Premium
        เพื่อไม่จำกัดจำนวนสินทรัพย์
      </p>
    </NavLink>
  );
}

export default PlanBanner;
