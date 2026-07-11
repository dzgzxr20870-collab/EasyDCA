// ═══════════════════════════════════════════════════════════════════════
// portfolioMath — ฟังก์ชันบริสุทธิ์ (Pure) รวมยอดพอร์ต "เทียบเป็นบาท" (Round 10)
// ═══════════════════════════════════════════════════════════════════════
// แยกออกจาก Dashboard.jsx เพื่อ Test ตรรกะการแปลง/รวมสกุลเงินได้โดยไม่ต้อง Render
// React — Backend (portfolio/profit/reportExport service) แยกยอด THB/USD และแปลง
// USD→THB ด้วย fxRate.service ก่อนรวมแล้ว ฝั่ง Frontend ต้องทำแบบเดียวกันก่อน "รวม
// ข้ามสกุล" (การ์ดมูลค่ารวม/Donut/กราฟ) ไม่เอา USD กับ THB มาบวกกันดิบๆ
//
// usdRate = จำนวน THB ต่อ 1 USD (มาจาก /dashboard/portfolio → fxRate) หรือ null
// เมื่อไม่มี USD ในพอร์ต หรือดึงเรตไม่ได้ (Backend แจ้ง fxUnavailableForUsd)

// แปลงจำนวนเงินเป็นบาทตามสกุล:
//   - THB (หรือไม่มี currency) → คืนค่าเดิม (พอร์ต THB ล้วนไม่เปลี่ยนพฤติกรรม)
//   - USD + มีเรต → amount × usdRate
//   - USD + ไม่มีเรต (null) → คืน null (แปลงไม่ได้ ต้องให้ผู้เรียกตัดสินใจ)
export function toThb(amount, currency, usdRate) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (currency !== 'USD') return n;
  if (usdRate === null || usdRate === undefined) return null;
  return n * usdRate;
}

// มูลค่าปัจจุบัน + กำไร/ขาดทุน "รวมเทียบบาท" จาก Holdings + ผลกำไรต่อ Symbol
// (profit.currentValue / profit.profitLoss เป็นสกุลของ Holding นั้นๆ — Native)
// คืน { currentValue, profitLoss, fxUnavailable, hasAny }
//   - นับเฉพาะ Holding ที่มีข้อมูล Profit จริง (เหมือน Logic เดิม)
//   - USD Holding ที่แปลงเป็นบาทไม่ได้ (ไม่มีเรต) → ข้าม + ตั้ง fxUnavailable=true
//   - hasAny=false (ไม่มี Holding ไหนคำนวณได้เลย) → currentValue/profitLoss = null
export function aggregatePortfolioValueThb(holdings, profitBySymbol, usdRate) {
  let currentValue = 0;
  let profitLoss = 0;
  let hasAny = false;
  let fxUnavailable = false;

  for (const h of holdings ?? []) {
    const profit = profitBySymbol?.[h.symbol];
    if (!profit) continue;

    const cv = toThb(profit.currentValue, h.currency, usdRate);
    const pl = toThb(profit.profitLoss, h.currency, usdRate);
    if (cv === null || pl === null) {
      fxUnavailable = true; // USD ที่แปลงไม่ได้ — ไม่รวม เพื่อไม่ให้ยอดรวมผิด
      continue;
    }
    currentValue += cv;
    profitLoss += pl;
    hasAny = true;
  }

  return hasAny
    ? { currentValue, profitLoss, fxUnavailable, hasAny: true }
    : { currentValue: null, profitLoss: null, fxUnavailable, hasAny: false };
}

// ข้อมูล Donut สัดส่วนเงินลงทุน "เทียบบาทเดียวกันทั้งวง" (ไม่เทียบสัดส่วนข้ามสกุลดิบๆ)
// คืน { labels, data, fxUnavailable } — USD Holding ที่แปลงไม่ได้จะถูกข้าม (+ flag)
export function donutInvestedThb(holdings, usdRate) {
  const labels = [];
  const data = [];
  let fxUnavailable = false;

  for (const h of holdings ?? []) {
    const inv = toThb(h.totalInvested, h.currency, usdRate);
    if (inv === null) {
      fxUnavailable = true;
      continue;
    }
    labels.push(h.symbol);
    data.push(inv);
  }

  return { labels, data, fxUnavailable };
}

// ยอดซื้อ (buy) รวมเทียบบาท ของธุรกรรมที่ date ขึ้นต้นด้วย monthPrefix ('YYYY-MM')
// คืน { sum, fxUnavailable } — USD ที่แปลงไม่ได้ไม่ถูกนับ (+ flag เตือน)
export function monthBuyTotalThb(transactions, usdRate, monthPrefix) {
  let sum = 0;
  let fxUnavailable = false;

  for (const tx of transactions ?? []) {
    if (tx.type !== 'buy') continue;
    if (!String(tx.date ?? '').startsWith(monthPrefix)) continue;
    const v = toThb(tx.amountThb, tx.currency, usdRate);
    if (v === null) {
      fxUnavailable = true;
      continue;
    }
    sum += v;
  }

  return { sum, fxUnavailable };
}

// ยอดซื้อรวมเทียบบาท "แยกตามเดือน" สำหรับ months[] ('YYYY-MM') ที่กำหนด
// คืน { sums: { [month]: number }, fxUnavailable }
export function monthlyBuyTotalsThb(transactions, usdRate, months) {
  const sums = Object.fromEntries((months ?? []).map((m) => [m, 0]));
  let fxUnavailable = false;

  for (const tx of transactions ?? []) {
    if (tx.type !== 'buy') continue;
    const key = String(tx.date ?? '').slice(0, 7);
    if (!(key in sums)) continue;
    const v = toThb(tx.amountThb, tx.currency, usdRate);
    if (v === null) {
      fxUnavailable = true;
      continue;
    }
    sums[key] += v;
  }

  return { sums, fxUnavailable };
}

// เงินต้นสะสม (Cumulative) เทียบบาท จากธุรกรรมทั้งหมด (buy +, sell −)
// รับ transactions ที่ "ยังไม่เรียง" — เรียงตาม date ภายในเอง คืน
//   { points: [{ date, cumulative }], fxUnavailable }
// USD ที่แปลงไม่ได้ (ไม่มีเรต) จะไม่ถูกบวก/ลบ (contribute 0) + ตั้ง flag เตือน
export function cumulativePrincipalThb(transactions, usdRate) {
  const sorted = [...(transactions ?? [])].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  let running = 0;
  let fxUnavailable = false;
  const points = sorted.map((tx) => {
    const v = toThb(tx.amountThb, tx.currency, usdRate);
    if (v === null) {
      fxUnavailable = true; // USD แปลงไม่ได้ — ถือว่า 0 ในกราฟ (มี Note เตือนแยก)
    } else {
      running += tx.type === 'buy' ? v : -v;
    }
    return { date: tx.date, cumulative: running };
  });

  return { points, fxUnavailable };
}
