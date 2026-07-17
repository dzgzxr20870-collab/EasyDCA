const { todayInBangkok } = require('./transaction.service');
const { excludeUndoneTransactions } = require('./undoTransaction.service');

// ═══════════════════════════════════════════════════════════════════════════
// dcaStats.service — สถิติ "พฤติกรรมการ DCA" จาก transactions (S8 Round 1a)
// ═══════════════════════════════════════════════════════════════════════════
// ขอบเขตของไฟล์นี้: "การนับ" เท่านั้น (จำนวนครั้ง / ยอดเงินที่ลงไป / ความต่อเนื่อง
// รายเดือน) — ไม่มีสูตรต้นทุน/กำไร/มูลค่าพอร์ตใดๆ ทั้งสิ้น (ของพวกนั้นอยู่ที่
// portfolio.service / portfolioSummary.service ตามเดิม ห้ามคำนวณซ้ำที่นี่)
//
// ── เรื่องเดือน/Timezone (สำคัญ) ─────────────────────────────────────────────
// ทุกฟังก์ชันตัดเดือนจาก transactions.date ซึ่งเป็น DATE column ที่เก็บ "วันตาม
// ปฏิทินไทย" อยู่แล้ว (transaction.service.todayInBangkok เป็นคนผลิตค่า Default
// และ Bulk Import/OCR ส่ง 'YYYY-MM-DD' ของวันไทยเข้ามา) จึงเทียบ Prefix 'YYYY-MM'
// แบบ String ได้ตรงๆ ไม่ต้องแปลง Timezone ซ้ำ
// จงใจไม่ใช้ created_at (TIMESTAMPTZ): การตัดเดือนแบบ UTC จะทำให้รายการที่บันทึก
// ช่วง 00:00–06:59 ของวันไทยตกไปเป็น "เดือนก่อน" ผิดจากที่ผู้ใช้เห็น
//
// ── เรื่องหลายสกุลเงิน (สำคัญ) ───────────────────────────────────────────────
// transactions.amount_thb เก็บ "ยอดในสกุลของแถวนั้น" ตามจริง (migration 012 —
// แถว currency='USD' เก็บ USD ไม่ใช่บาท) และ "ไม่มีคอลัมน์เก็บยอดเทียบบาท ณ วันที่
// ทำรายการ" ระบบก็ไม่เก็บราคา/เรตย้อนหลังไว้ที่ใดเลย → การรวม THB+USD เป็นก้อนเดียว
// ย้อนหลังต้องใช้ FX ย้อนหลังซึ่ง "ห้ามเดา" — ทุกฟังก์ชันจึงคืนยอด "แยกตามสกุล"
// (amountByCurrency) ให้ Consumer ตัดสินใจแสดงผลเอง ไม่บวกข้ามสกุลให้
function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// 'YYYY-MM' ของเดือนปัจจุบันตามเวลาไทย
function currentMonthKey() {
  return todayInBangkok().slice(0, 7);
}

// เลื่อนเดือนถอยหลัง n เดือนจาก 'YYYY-MM' (คำนวณด้วยเลขล้วน ไม่พึ่ง Date object
// เพื่อไม่ให้ Timezone ของ Server เข้ามาเกี่ยวข้องเลย)
function shiftMonth(monthKey, deltaMonths) {
  const [year, month] = monthKey.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + deltaMonths;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

// รายการซื้อที่ "มีผลจริง" (ตัดคู่ที่ถูกยกเลิกออก) — ฐานของทุกสถิติในไฟล์นี้
function effectiveBuys(transactions) {
  return excludeUndoneTransactions(transactions).filter(
    (tx) => tx.type === 'buy' && typeof tx.date === 'string'
  );
}

// รวมยอดแยกสกุล (ไม่บวกข้ามสกุล — เหตุผลด้านบน)
function sumByCurrency(transactions) {
  const totals = { THB: 0, USD: 0 };
  for (const tx of transactions) {
    const cur = tx.currency === 'USD' ? 'USD' : 'THB';
    totals[cur] += Number(tx.amountThb);
  }
  return { THB: roundToTwo(totals.THB), USD: roundToTwo(totals.USD) };
}

// ── DCA เดือนนี้: จำนวนครั้ง + ยอดเงิน (เดือนปัจจุบันตามเวลาไทย) ──────────────
function getMonthSummary(transactions) {
  const month = currentMonthKey();
  const buys = effectiveBuys(transactions).filter((tx) => tx.date.startsWith(month));

  return {
    month,
    count: buys.length,
    amountByCurrency: sumByCurrency(buys),
  };
}

// ── ภาพรวมตลอดกาล: เงินลงทุนสะสม + จำนวนครั้งที่บันทึก ────────────────────────
// หมายเหตุ: "เงินลงทุนสะสมทั้งหมด" ที่นี่ = ผลรวมยอดเงินของ "รายการซื้อทุกครั้ง"
// (เงินที่เคยใส่เข้าไป) ซึ่งเป็นคนละตัวกับ portfolio.service.totalInvested ที่เป็น
// "ต้นทุนของที่ยังถืออยู่" (Moving Average หักส่วนที่ขายออกแล้ว) — ทั้งสองค่าถูกต้อง
// คนละความหมาย ไม่ใช่การคำนวณซ้ำ/ขัดกัน (Consumer ต้องเลือกใช้ให้ตรงบริบท)
function getLifetimeSummary(transactions) {
  const buys = effectiveBuys(transactions);

  return {
    count: buys.length,
    amountByCurrency: sumByCurrency(buys),
  };
}

// ── Streak: จำนวน "เดือนติดต่อกัน" ที่มีรายการซื้ออย่างน้อย 1 รายการ ──────────
// นิยามที่ใช้ (ตาม Requirement รอบนี้):
//  - นับถอยหลังจากเดือนปัจจุบัน (เวลาไทย)
//  - เดือนปัจจุบันนับรวมถ้ามี ≥1 รายการ; ถ้าไม่มี ให้เริ่มนับจากเดือนก่อนหน้า
//    (เพื่อไม่ให้ Streak ตกเป็น 0 ทันทีในวันที่ 1 ของเดือนใหม่ทั้งที่ผู้ใช้ยัง DCA
//    ต่อเนื่องมาตลอด — ผู้ใช้ยังมีเวลาทั้งเดือนที่จะบันทึก)
//  - ขาดเดือนใดเดือนหนึ่ง = จบ Streak ทันที
//  - รายการที่ถูกยกเลิกไปแล้วไม่นับ (ผ่าน effectiveBuys)
//  - คำนวณจาก transactions จริงทุกครั้ง ไม่มีตาราง/คอลัมน์เก็บ Streak
function getStreakMonths(transactions) {
  const months = new Set(effectiveBuys(transactions).map((tx) => tx.date.slice(0, 7)));
  if (months.size === 0) return 0;

  const thisMonth = currentMonthKey();
  // เดือนปัจจุบันไม่มีรายการ → เริ่มนับที่เดือนก่อนหน้า (Grace ตามนิยามด้านบน)
  let cursor = months.has(thisMonth) ? thisMonth : shiftMonth(thisMonth, -1);

  let streak = 0;
  while (months.has(cursor)) {
    streak += 1;
    cursor = shiftMonth(cursor, -1);
  }

  return streak;
}

// ── กราฟ "เงินลงทุนสะสม" รายเดือน ย้อนหลังไม่เกิน 12 เดือน ────────────────────
// คืน "ยอดที่ใส่เข้าไปในแต่ละเดือน" (monthly) + "ยอดสะสมวิ่ง" (cumulative) แยกสกุล
//
// ⚠️ นี่คือกราฟ "เงินที่ลงไป" ไม่ใช่ "มูลค่าพอร์ตย้อนหลัง" — ระบบไม่เก็บราคาสินทรัพย์
// ในอดีต จึงสร้างมูลค่าพอร์ตย้อนหลังไม่ได้ และจะไม่พยายามทำ
//
// ⚠️ cumulative เริ่มนับจากเดือนแรกของหน้าต่าง 12 เดือนนี้เท่านั้น (ไม่รวมยอดก่อน
// หน้านั้น) — ตั้งใจให้เป็น "เงินที่ลงไปในช่วง 12 เดือนที่ผ่านมา" ตรงตามชื่อกราฟ
// Consumer ที่อยากได้ยอดสะสมตลอดกาลให้ใช้ getLifetimeSummary แทน
//
// เดือนที่ไม่มีรายการจะมีแถวอยู่ในผลลัพธ์ด้วย (ยอด 0) เพื่อให้กราฟมีแกนเวลาต่อเนื่อง
// ไม่กระโดดข้ามเดือน
function getMonthlyInvestedSeries(transactions, monthsBack = 12) {
  const buys = effectiveBuys(transactions);
  const thisMonth = currentMonthKey();

  const perMonth = new Map();
  for (const tx of buys) {
    const key = tx.date.slice(0, 7);
    if (!perMonth.has(key)) perMonth.set(key, []);
    perMonth.get(key).push(tx);
  }

  const series = [];
  const running = { THB: 0, USD: 0 };
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const month = shiftMonth(thisMonth, -i);
    const rows = perMonth.get(month) ?? [];
    const monthly = sumByCurrency(rows);
    running.THB = roundToTwo(running.THB + monthly.THB);
    running.USD = roundToTwo(running.USD + monthly.USD);

    series.push({
      month,
      count: rows.length,
      amountByCurrency: monthly,
      cumulativeByCurrency: { THB: running.THB, USD: running.USD },
    });
  }

  return series;
}

module.exports = {
  getMonthSummary,
  getLifetimeSummary,
  getStreakMonths,
  getMonthlyInvestedSeries,
  // Export ไว้ให้เทสต์/Consumer อื่นใช้ตรวจ Boundary เดือนได้ด้วยกฎเดียวกัน
  currentMonthKey,
  shiftMonth,
};
