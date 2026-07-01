const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const { calculateHeldQuantity } = require('./transaction.service');

// ปัดทศนิยม 2 ตำแหน่งสำหรับจำนวนเงินบาท (สอดคล้องกับ transaction.service)
function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ปัดทศนิยม 8 ตำแหน่งสำหรับราคาต่อหน่วย รองรับ Crypto (DATABASE.md
// price_per_unit NUMERIC(20,8)) — เลี่ยง Floating Point Noise ตอนหาร
function roundToEight(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

// totalInvested = Σ(amount_thb ฝั่ง buy) − Σ(amount_thb ฝั่ง sell)
// = เงินต้นสุทธิที่ยังจมอยู่ในสินทรัพย์นี้ (ไม่ใช่มูลค่าตลาดปัจจุบัน)
function calculateTotalInvested(transactions) {
  const total = transactions.reduce((sum, tx) => {
    const amount = Number(tx.amountThb);
    return tx.type === 'buy' ? sum + amount : sum - amount;
  }, 0);

  return roundToTwo(total);
}

// สรุปภาพรวมพอร์ตของ User โดยคำนวณจาก transactions ทุกครั้ง (DATABASE.md § 12)
// ไม่เก็บ Quantity/Average Cost สะสมเป็น Column แยก
//
// หมายเหตุ: ยังไม่มี Current Market Value / กำไร-ขาดทุน เพราะยังไม่มี Price
// Feed Service — สรุปเฉพาะเงินต้นที่ลงทุน (totalInvested) และต้นทุนเฉลี่ย
async function getPortfolioSummary(userId) {
  const assets = await assetRepository.findActiveByUser(userId);

  const holdings = [];
  let portfolioTotalInvested = 0;

  for (const asset of assets) {
    const transactions = await transactionRepository.findAllByAsset(asset.id);
    const heldQuantity = calculateHeldQuantity(transactions);

    // กรอง Asset ที่ขายหมดแล้ว (heldQuantity = 0) ออก — แม้ is_active ยังเป็น
    // true ในฐานข้อมูล ก็ไม่ต้องแสดงในพอร์ต
    if (heldQuantity <= 0) continue;

    const totalInvested = calculateTotalInvested(transactions);
    // averageCost = null เมื่อ heldQuantity = 0 (แต่ถูกกรองไปแล้วด้านบน)
    // ป้องกันหารด้วยศูนย์ที่ให้ Infinity/NaN
    const averageCost = heldQuantity > 0 ? roundToEight(totalInvested / heldQuantity) : null;

    holdings.push({
      symbol: asset.symbol,
      name: asset.name,
      type: asset.type,
      heldQuantity,
      totalInvested,
      averageCost,
    });

    portfolioTotalInvested += totalInvested;
  }

  return {
    holdings,
    totalInvested: roundToTwo(portfolioTotalInvested),
    isEmpty: holdings.length === 0,
  };
}

module.exports = {
  getPortfolioSummary,
  calculateTotalInvested,
};
