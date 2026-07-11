const portfolioService = require('./portfolio.service');
const priceFeedService = require('./priceFeed.service');
const fxRateService = require('./fxRate.service');

// ปัดทศนิยม 2 ตำแหน่งสำหรับจำนวนเงินบาท (สอดคล้องกับ portfolio/profit service)
function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// สร้างข้อมูลสรุปพอร์ตของ User 1 คน สำหรับ Push รายสัปดาห์/รายเดือน (Cron เรียก)
//
// Reuse ทั้งหมด — ไม่คำนวณ heldQuantity/totalInvested/currentPrice ซ้ำเอง:
//  - portfolioService.getPortfolioSummary → holdings (มี heldQuantity, totalInvested
//    ที่กรอง Asset ขายหมดออกแล้ว) + totalInvested รวมทั้งพอร์ต + isEmpty
//  - priceFeedService.getCurrentPrice → ราคาตลาดปัจจุบันเป็น THB (null ถ้าไม่มี Feed)
//
// periodLabel ('weekly' | 'monthly') รับมาจาก Caller ใช้แค่ตกแต่งข้อความปลายทาง
// ไม่มีผลต่อ Logic คำนวณใดๆ
//
// คืน null เมื่อพอร์ตว่างเปล่า (isEmpty) → Caller ต้อง Skip ไม่ Push ให้ User
// ที่ไม่มีอะไรจะสรุป
async function buildSummaryForUser(userId, periodLabel) {
  const summary = await portfolioService.getPortfolioSummary(userId);

  if (summary.isEmpty) return null;

  // แยกยอด "ที่คำนวณกำไร/ขาดทุนได้จริง" (มีราคาตลาด) ออกจากยอดลงทุนรวมทั้งพอร์ต:
  //  - totalCurrentValue: มูลค่าตลาดรวมของ Asset ที่ "มีราคา" เท่านั้น
  //  - investedWithPriceFeed: เงินลงทุนรวมเฉพาะ Asset ที่มีราคา (ฐานของ % กำไร)
  //  - excludedCount: จำนวน Asset ที่ยังไม่มี Price Feed (เช่นหุ้นไทย) ที่ถูกข้าม
  // Multi-Currency (Round 10): สะสมมูลค่า/เงินลงทุน "แยกตามสกุล" (ไม่ถัวข้ามสกุล)
  // แล้วค่อยแปลง USD → THB ด้วยเรตเดียวตอนท้ายเพื่อทำ "ยอดรวมเทียบบาท"
  const valueByCurrency = { THB: 0, USD: 0 };
  const investedByCurrency = { THB: 0, USD: 0 };
  let excludedCount = 0;

  for (const holding of summary.holdings) {
    // getPortfolioSummary กรอง heldQuantity <= 0 ออกให้แล้ว แต่กันไว้อีกชั้น
    if (holding.heldQuantity <= 0) continue;

    // สกุลของสินทรัพย์ (จาก getPortfolioSummary) — USD ตีมูลค่าด้วยราคา USD ตามจริง
    const cur = holding.currency === 'USD' ? 'USD' : 'THB';

    // กองทุนรวม (Round 7) — ดึง NAV ตรง Class (proj_id+fund_class_name) แทน
    // getCurrentPrice (ที่รับ symbol อย่างเดียวไม่พอ) — ห่อ try/catch คืน null เอง
    // เพื่อให้ Cron สรุปพอร์ต "ข้าม" กองทุนที่ NAV ดึงไม่ได้ (นับ excluded) แทน
    // การพังทั้งงาน (Fail Isolated เหมือนสินทรัพย์ราคาไม่ได้ตัวอื่น)
    let price;
    if (holding.type === 'fund' && holding.projId && holding.fundClassName) {
      try {
        const nav = await priceFeedService.getMutualFundNav(holding.projId, holding.fundClassName);
        price = nav.lastVal;
      } catch (err) {
        price = null;
      }
    } else if (cur === 'USD') {
      price = await priceFeedService.getCurrentPriceUsd(holding.symbol);
    } else {
      price = await priceFeedService.getCurrentPrice(holding.symbol);
    }

    // ไม่มีราคาตลาด (หุ้นไทยที่ยังไม่มี Feed / API ล้มเหลว) → ไม่รวมเข้ายอดคำนวณ
    // กำไร-ขาดทุน แต่นับไว้เพื่อบอก User ว่าตัวเลขนี้ไม่ครบทุก Asset
    if (price === null || price === undefined) {
      excludedCount += 1;
      continue;
    }

    valueByCurrency[cur] += holding.heldQuantity * price;
    investedByCurrency[cur] += holding.totalInvested;
  }

  // แปลง USD → THB (เรตเดียว) เพื่อทำยอดรวมเทียบบาท — null ถ้าไม่มี USD หรือดึงเรตไม่ได้
  let fx = null;
  if (valueByCurrency.USD > 0 || investedByCurrency.USD > 0) {
    fx = await fxRateService.getUsdThbRate();
  }
  const usdRate = fx ? fx.rate : null;

  // ยอดรวม "เทียบบาท": THB ตรงๆ + USD ที่แปลงแล้ว (ถ้ามีเรต) — ถ้ามี USD แต่ดึงเรตไม่ได้
  // ตั้ง Flag ให้ Consumer รู้ว่ายอด THB ยังไม่รวมส่วน USD (fxUnavailableForUsd)
  const usdValueInThb = usdRate !== null ? valueByCurrency.USD * usdRate : 0;
  const usdInvestedInThb = usdRate !== null ? investedByCurrency.USD * usdRate : 0;
  const fxUnavailableForUsd = (valueByCurrency.USD > 0 || investedByCurrency.USD > 0) && usdRate === null;

  const totalCurrentValue = roundToTwo(valueByCurrency.THB + usdValueInThb);
  const investedWithPriceFeed = roundToTwo(investedByCurrency.THB + usdInvestedInThb);
  const totalProfitLoss = roundToTwo(totalCurrentValue - investedWithPriceFeed);

  // ป้องกันหารด้วยศูนย์ — ถ้าไม่มี Asset ที่มีราคาเลย (เช่นพอร์ตหุ้นไทยล้วน)
  // investedWithPriceFeed = 0 → percent เป็น null แทนการหารพัง (Infinity/NaN)
  const totalProfitLossPercent =
    investedWithPriceFeed === 0 ? null : roundToTwo((totalProfitLoss / investedWithPriceFeed) * 100);

  return {
    totalInvestedAllAssets: summary.totalInvested,
    totalCurrentValue,
    totalProfitLoss,
    totalProfitLossPercent,
    excludedCount,
    periodLabel,
    // Multi-Currency (Round 10) — รายละเอียดแยกสกุล + เรตที่ใช้แปลง (สำหรับ Consumer
    // ที่ต้องการแสดงยอดแยก THB/USD และกำกับเรต/วันที่) — ยอดหลักด้านบนเป็น "เทียบบาท"
    byCurrency: {
      THB: { currentValue: roundToTwo(valueByCurrency.THB), invested: roundToTwo(investedByCurrency.THB) },
      USD: { currentValue: roundToTwo(valueByCurrency.USD), invested: roundToTwo(investedByCurrency.USD) },
    },
    fxRate: usdRate,
    fxAsOf: fx ? fx.asOf : null,
    fxStale: fx ? fx.stale : false,
    fxUnavailableForUsd,
  };
}

module.exports = {
  buildSummaryForUser,
};
