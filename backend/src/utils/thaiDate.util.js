// ═══════════════════════════════════════════════════════════════════════
// Thai Date Helpers — ใช้ร่วมกันระหว่าง Command Parser (ชื่อวัน → day_of_week)
// Flex Message (day_of_week → ชื่อวัน) และ dcaReminder.service (คำนวณ due date)
// รวมไว้ที่เดียวกันไม่ให้ Map ชื่อวันซ้ำสองที่ (เลี่ยง Drift ระหว่างไฟล์)
// ═══════════════════════════════════════════════════════════════════════

// index ตรงกับ day_of_week ใน dca_reminders (migration 002): 0=อาทิตย์ .. 6=เสาร์
// (ตรงกับ Date.prototype.getDay() / getUTCDay() ของ JS ด้วย)
const THAI_DAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// ชื่อเดือนไทยเต็ม (index 0=มกราคม .. 11=ธันวาคม) — ใช้จัดรูปวันหมดอายุ Premium
// เป็นภาษาไทย/พ.ศ. (formatThaiDate) แสดงในข้อความ LINE
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// ชื่อวัน (รวม Alias ที่ผู้ใช้พิมพ์ได้จริง) → day_of_week
// "พฤหัส" เป็นคำย่อของ "พฤหัสบดี" ที่คนไทยพิมพ์บ่อย จึงรับด้วย
const THAI_DAY_TO_DOW = THAI_DAY_NAMES.reduce((acc, name, dow) => {
  acc[name] = dow;
  return acc;
}, {});
THAI_DAY_TO_DOW['พฤหัส'] = 4;

// รายชื่อวันทั้งหมด เรียงยาว→สั้น สำหรับใช้สร้าง Regex Alternation ให้ชื่อยาว
// (พฤหัสบดี) ถูกลองก่อนชื่อสั้น (พฤหัส) — กัน Match ครึ่งคำ
const THAI_DAY_PATTERNS = Object.keys(THAI_DAY_TO_DOW).sort((a, b) => b.length - a.length);

// คืน day_of_week (0-6) ของชื่อวันไทย หรือ null ถ้าไม่รู้จัก (ไม่เดามั่ว)
function dayNameToDow(name) {
  if (typeof name !== 'string') return null;
  const dow = THAI_DAY_TO_DOW[name.trim()];
  return dow === undefined ? null : dow;
}

// คืนชื่อวันไทยของ day_of_week (0-6) หรือ null ถ้านอกช่วง
function dowToDayName(dow) {
  return THAI_DAY_NAMES[dow] ?? null;
}

// แยกส่วนของสตริงวันที่ 'YYYY-MM-DD' เป็นตัวเลข — เลี่ยง new Date(string) ที่
// ตีความ Timezone ไม่แน่นอน (บาง Runtime มองเป็น UTC บางที่มองเป็น Local)
function parseDateParts(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return { year, month, day };
}

// day_of_week (0=อาทิตย์) ของวันที่ที่กำหนด — ใช้ Date.UTC บนส่วนประกอบที่ระบุ
// ตรงๆ จึง Deterministic ไม่ผูกกับ Timezone ของเครื่องที่รัน Cron
function dayOfWeekOf(dateStr) {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// วันสุดท้ายของเดือนนั้น (28/29/30/31) — day 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้
// ใช้ตัดสินกรณี day_of_month ที่ตั้งไว้เกินจำนวนวันของเดือน (เช่น 31 ในเดือน ก.พ.)
function lastDayOfMonthOf(dateStr) {
  const { year, month } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// จัดรูปวันที่เป็นภาษาไทย/พ.ศ. เช่น "4 กรกฎาคม 2569" ตามเขตเวลา Asia/Bangkok
// รับได้ทั้ง Date และ ISO string — คำนวณ ปี/เดือน/วัน ในเขตเวลาไทยผ่าน Intl ก่อน
// (กันคลาดวันเมื่อเวลาใกล้เที่ยงคืน UTC) แล้วบวก 543 เป็นพุทธศักราช
function formatThaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month'); // 1-12
  const day = get('day');

  return `${day} ${THAI_MONTH_NAMES[month - 1]} ${year + 543}`;
}

// คืน "ปี-เดือน" (คริสต์ศักราช, 'YYYY-MM') ตามเขตเวลา Asia/Bangkok — ใช้เทียบว่า
// สอง Timestamp อยู่ในเดือนปฏิทินเดียวกันไหม (เช่น Admin Dashboard revenueThisMonth:
// นับ Payment ที่ confirmed_at อยู่ในเดือนปัจจุบันของไทย) ใช้ Intl แบบเดียวกับ
// formatThaiDate จึง Handle Timezone/ข้ามเที่ยงคืน UTC ถูกต้อง ไม่เขียน Date Logic ใหม่
// รับได้ทั้ง Date และ ISO string (เหมือน formatThaiDate)
function bangkokYearMonth(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value));

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}`;
}

// ── Parse วันที่ที่ผู้ใช้พิมพ์เอง "DD/MM/YYYY" (Phase 3 Round 6 — Bulk Import) ──
// ต่างจาก formatThaiDate (ค.ศ.→พ.ศ. ทางเดียวสำหรับแสดงผล): ฟังก์ชันนี้ทำทางกลับ
// (รับ Input ผู้ใช้ → ISO ค.ศ.) และต้องเดาว่าปีที่พิมพ์เป็น พ.ศ. หรือ ค.ศ.

// ปี ค.ศ. ของธุรกรรมจริงไม่มีทางเกิน 2100 ในเร็วๆ นี้ ส่วนปี พ.ศ. ปัจจุบันอยู่ที่
// 2568-2569 — ใช้ 2100 เป็นเส้นแบ่งที่ปลอดภัย (>= ถือเป็น พ.ศ. แล้วลบ 543)
const BUDDHIST_ERA_THRESHOLD = 2100;

// จำนวนวันของแต่ละเดือน (Index 0 = มกราคม) — เดือน 2 (กุมภาพันธ์) คำนวณปีอธิกสุรทิน
// แยกต่างหากด้วย isLeapYear ด้านล่าง ไม่ Hardcode 28/29 ตรงๆ
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

// Parse "DD/MM/YYYY" (รองรับ D/M หลักเดียว, ปีต้อง 4 หลักเสมอกันตีความปีผิด) เป็น
// ISO 'YYYY-MM-DD' (ค.ศ. เสมอ ตรงกับ transactions.date ที่เป็น DATE column)
// คืน null ถ้ารูปแบบผิดหรือวันที่ไม่มีอยู่จริง (เช่น 31/02/2569) — ไม่เดา/ไม่ปัดเอง
function parseDateInput(raw) {
  if (typeof raw !== 'string') return null;

  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);

  if (year >= BUDDHIST_ERA_THRESHOLD) {
    year -= 543;
  }

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

module.exports = {
  THAI_DAY_NAMES,
  THAI_MONTH_NAMES,
  THAI_DAY_PATTERNS,
  dayNameToDow,
  dowToDayName,
  parseDateParts,
  dayOfWeekOf,
  lastDayOfMonthOf,
  formatThaiDate,
  bangkokYearMonth,
  parseDateInput,
};
