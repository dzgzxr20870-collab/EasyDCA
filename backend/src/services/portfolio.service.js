const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');
const { calculateHeldQuantity } = require('./transaction.service');
// Stage 6a — แหล่งตัดสิน "ความหมายของ transaction type" ที่เดียวของทั้งระบบ
const { costBasisRole } = require('../utils/transactionType.util');

// ปัดทศนิยม 2 ตำแหน่งสำหรับจำนวนเงินบาท (สอดคล้องกับ transaction.service)
function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ปัดทศนิยม 8 ตำแหน่งสำหรับราคาต่อหน่วย รองรับ Crypto (DATABASE.md
// price_per_unit NUMERIC(20,8)) — เลี่ยง Floating Point Noise ตอนหาร
function roundToEight(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

// เรียงธุรกรรมตามเวลาจริง (date แล้ว created_at) โดยไม่พึ่ง Order ที่ Caller ส่งมา —
// Repository เพิ่ม ORDER BY แล้ว (transaction.repository.findAllByAsset) แต่ฟังก์ชันนี้
// ป้องกันซ้ำอีกชั้น เพราะ Moving Average ผิดลำดับ = ผลลัพธ์ผิดทันที (Sort เป็น Stable
// Sort ของ JS ตั้งแต่ ES2019 — Transaction ที่ไม่มี date/createdAt จะคงลำดับเดิมไว้)
function sortChronologically(transactions) {
  return [...transactions].sort((a, b) => {
    const dateA = a.date ?? '';
    const dateB = b.date ?? '';
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    const createdA = a.createdAt ?? '';
    const createdB = b.createdAt ?? '';
    if (createdA !== createdB) return createdA < createdB ? -1 : 1;
    return 0;
  });
}

// Moving Average Cost Basis — Replay ธุรกรรมตามลำดับเวลา คำนวณ "ต้นทุนคงเหลือจริง"
// (ไม่ใช่ Net Cash Flow แบบเดิมที่ทำให้ totalInvested ติดลบได้เมื่อขายราคาสูงกว่าทุน):
//   ซื้อ  → costBasis += amountThb, heldQty += quantity
//   ขาย  → costPerUnit = ต้นทุนเฉลี่ย "ก่อน" ขายครั้งนี้ (costBasis/heldQty)
//          หักต้นทุนเฉพาะส่วนที่ขายออก (costPerUnit * quantity) ออกจาก costBasis
//          ส่วนต่างจากราคาขายจริง (amountThb) เทียบต้นทุนส่วนนั้น = realizedPnL
// คืนทั้ง totalInvested (ต้นทุนคงเหลือ) และ realizedPnL (กำไร/ขาดทุนที่รับรู้แล้วจากการขาย)
function calculateTotalInvested(transactions) {
  const sorted = sortChronologically(transactions);

  let costBasis = 0;
  let heldQty = 0;
  let realizedPnL = 0;

  for (const t of sorted) {
    const amount = Number(t.amountThb);
    let quantity = Number(t.quantity);

    // Stage 6a — เดิมเขียนแบบ Binary `if (t.type === 'buy') {...} else {...ตัดต้นทุน...}`
    // ซึ่งแปลว่า "ทุก type ที่ไม่ใช่ buy = ขาย" — ถ้า dividend เข้ามาได้ ต้นทุนจะ
    // ถูกตัดทิ้งและ realizedPnL จะเพี้ยนทันทีโดยไม่มี Error ใดๆ (Design Doc § 2)
    const role = costBasisRole(t.type, 'portfolio.calculateTotalInvested');

    if (role === 'increase_cost') {
      costBasis += amount;
      heldQty += quantity;
      continue;
    }

    // ปันผล (และรายการหักล้างปันผล) ไม่แตะต้นทุนและไม่แตะจำนวนที่ถือเลย —
    // เป็น "รายได้" คนละก้อนกับกำไรจากส่วนต่างราคา (Design Doc § 5.3)
    // ยอดปันผลสะสมคำนวณแยกต่างหาก ไม่ปนกับ realizedPnL ที่นี่
    if (role === 'income' || role === 'income_reversal') {
      continue;
    }

    // ถึงตรงนี้ได้เฉพาะ role === 'realize_pnl' (ขาย) เท่านั้น
    // ป้องกัน Data Inconsistency (ไม่ควรเกิดเพราะมี NOTHING_TO_SELL/INSUFFICIENT_QUANTITY
    // Guard อยู่แล้วตอนบันทึกธุรกรรม) — Clamp แทนการ throw เพราะนี่คือ Read-Path สรุปผล
    // ไม่ใช่ Write-Path ธุรกรรม
    if (quantity > heldQty) {
      // eslint-disable-next-line no-console
      console.warn(
        `calculateTotalInvested: sell quantity (${quantity}) เกิน heldQty ที่มี (${heldQty}) — Clamp ป้องกัน costBasis ติดลบ`
      );
      quantity = heldQty;
    }

    const costPerUnit = heldQty > 0 ? costBasis / heldQty : 0;
    const costOfSoldUnits = costPerUnit * quantity;

    realizedPnL += amount - costOfSoldUnits;
    costBasis -= costOfSoldUnits;
    heldQty -= quantity;
  }

  return {
    totalInvested: roundToTwo(costBasis),
    realizedPnL: roundToTwo(realizedPnL),
  };
}

// สรุปภาพรวมพอร์ตของ User โดยคำนวณจาก transactions ทุกครั้ง (DATABASE.md § 12)
// ไม่เก็บ Quantity/Average Cost สะสมเป็น Column แยก
//
// หมายเหตุ: ยังไม่มี Current Market Value / กำไร-ขาดทุน เพราะยังไม่มี Price
// Feed Service — สรุปเฉพาะเงินต้นที่ลงทุน (totalInvested) และต้นทุนเฉลี่ย
async function getPortfolioSummary(userId) {
  const assets = await assetRepository.findActiveByUser(userId);

  const holdings = [];
  // Multi-Currency (Round 10): แยกเงินลงทุนตามสกุล ไม่ถัวข้ามสกุล (THB/USD)
  const investedByCurrency = { THB: 0, USD: 0 };

  for (const asset of assets) {
    const transactions = await transactionRepository.findAllByAsset(asset.id, userId);
    const heldQuantity = calculateHeldQuantity(transactions);

    // กรอง Asset ที่ขายหมดแล้ว (heldQuantity = 0) ออก — แม้ is_active ยังเป็น
    // true ในฐานข้อมูล ก็ไม่ต้องแสดงในพอร์ต
    if (heldQuantity <= 0) continue;

    const { totalInvested, realizedPnL } = calculateTotalInvested(transactions);
    // averageCost = null เมื่อ heldQuantity = 0 (แต่ถูกกรองไปแล้วด้านบน)
    // ป้องกันหารด้วยศูนย์ที่ให้ Infinity/NaN
    const averageCost = heldQuantity > 0 ? roundToEight(totalInvested / heldQuantity) : null;
    // สกุลเงินของสินทรัพย์ อนุมานจากประวัติธุรกรรม (Default 'THB')
    const currency = transactions.some((tx) => tx.currency === 'USD') ? 'USD' : 'THB';

    holdings.push({
      symbol: asset.symbol,
      name: asset.name,
      type: asset.type,
      // ⚠️ Stage 5 (migration 046) — ตั้งแต่ถือ Symbol เดียวกันได้หลายโบรก
      // "symbol" ไม่ใช่ Key ที่ระบุ Holding ได้อีกต่อไป (BTC โผล่ได้ 2 แถว)
      // ทุก Consumer ที่เอา holding.symbol ไป Lookup ต่อ ต้องพา brokerId ไปด้วย
      // มิฉะนั้นจะเจอ AMBIGUOUS_ASSET_BROKER แล้ว "ตกหล่นทั้งสองแถว" เงียบๆ
      // (เคสจริงที่ต้องระวัง: portfolioSnapshot.job นับ excludedAssetCount แล้ว
      // มูลค่ารวมรายคืนจะขาด BTC ไปทั้งก้อนโดยไม่มี Error ให้เห็น)
      assetId: asset.id,
      brokerId: asset.brokerId ?? null,
      // กองทุนรวม (Round 7) — พา proj_id/fund_class_name ไปให้ portfolioSummary ดึง NAV
      // ตรง Class (null สำหรับสินทรัพย์อื่น) ไม่กระทบ Consumer เดิมที่ไม่ได้อ่าน Field นี้
      projId: asset.projId ?? null,
      fundClassName: asset.fundClassName ?? null,
      // Multi-Currency (Round 10) — สกุลของ totalInvested/averageCost (Default THB)
      currency,
      heldQuantity,
      totalInvested,
      averageCost,
      // กำไร/ขาดทุนที่ "รับรู้แล้ว" จากการขายบางส่วนของ Asset นี้ (Moving Average) —
      // แยกจาก profitLoss (Unrealized) ที่คำนวณใน profit.service ต่อยอดจาก totalInvested นี้
      realizedPnL,
    });

    investedByCurrency[currency] += totalInvested;
  }

  return {
    holdings,
    // Multi-Currency (Round 10): แยกยอดตามสกุล — investedByCurrency คือแหล่งจริง
    // totalInvested คงไว้ = ยอด THB เท่านั้น เพื่อ Backward Compat (พอร์ต THB ล้วน
    // ได้ค่าเท่าเดิมทุกประการ; Consumer ที่รองรับหลายสกุลให้อ่าน investedByCurrency)
    investedByCurrency: {
      THB: roundToTwo(investedByCurrency.THB),
      USD: roundToTwo(investedByCurrency.USD),
    },
    totalInvested: roundToTwo(investedByCurrency.THB),
    isEmpty: holdings.length === 0,
  };
}

module.exports = {
  getPortfolioSummary,
  calculateTotalInvested,
};
