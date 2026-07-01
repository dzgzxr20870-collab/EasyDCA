const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');

const DEFAULT_LIMIT = 5;

// ประวัติธุรกรรมล่าสุดของ User พร้อม Symbol ของแต่ละรายการ (ROADMAP.md
// Phase 1 — "ประวัติ" แสดง 5 รายการล่าสุด)
//
// Transaction เก็บแค่ asset_id ไม่มี symbol ตรงๆ — ดึง Asset ที่เกี่ยวข้อง
// ทั้งหมดด้วย Query เดียว (findByIds) แล้ว Map เป็น symbol แทนการ Query
// Asset ทีละ Transaction
async function getRecentHistory(userId, limit = DEFAULT_LIMIT) {
  const transactions = await transactionRepository.findRecentByUser(userId, limit);
  if (transactions.length === 0) return [];

  const assetIds = [...new Set(transactions.map((tx) => tx.assetId))];
  const assets = await assetRepository.findByIds(assetIds);
  const symbolByAssetId = new Map(assets.map((asset) => [asset.id, asset.symbol]));

  // findRecentByUser เรียงตาม date desc มาแล้ว — คงลำดับล่าสุด → เก่าสุดเดิม
  return transactions.map((tx) => ({
    symbol: symbolByAssetId.get(tx.assetId) ?? tx.assetId,
    type: tx.type,
    quantity: tx.quantity,
    pricePerUnit: tx.pricePerUnit,
    amountThb: tx.amountThb,
    date: tx.date,
  }));
}

module.exports = {
  getRecentHistory,
};
