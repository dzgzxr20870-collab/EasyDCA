const portfolioService = require('./portfolio.service');
const priceFeedService = require('./priceFeed.service');

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
  let totalCurrentValue = 0;
  let investedWithPriceFeed = 0;
  let excludedCount = 0;

  for (const holding of summary.holdings) {
    // getPortfolioSummary กรอง heldQuantity <= 0 ออกให้แล้ว แต่กันไว้อีกชั้น
    if (holding.heldQuantity <= 0) continue;

    const price = await priceFeedService.getCurrentPrice(holding.symbol);

    // ไม่มีราคาตลาด (หุ้นไทยที่ยังไม่มี Feed / API ล้มเหลว) → ไม่รวมเข้ายอดคำนวณ
    // กำไร-ขาดทุน แต่นับไว้เพื่อบอก User ว่าตัวเลขนี้ไม่ครบทุก Asset
    if (price === null) {
      excludedCount += 1;
      continue;
    }

    totalCurrentValue += holding.heldQuantity * price;
    investedWithPriceFeed += holding.totalInvested;
  }

  totalCurrentValue = roundToTwo(totalCurrentValue);
  investedWithPriceFeed = roundToTwo(investedWithPriceFeed);
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
  };
}

module.exports = {
  buildSummaryForUser,
};
