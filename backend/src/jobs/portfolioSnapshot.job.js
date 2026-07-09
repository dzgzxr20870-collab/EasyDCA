const cron = require('node-cron');
const transactionRepository = require('../repositories/transaction.repository');
const portfolioSnapshotRepository = require('../repositories/portfolioSnapshot.repository');
const portfolioService = require('../services/portfolio.service');
const profitService = require('../services/profit.service');
const { todayInBangkok } = require('../services/transaction.service');

// ปัดทศนิยม 2 ตำแหน่งสำหรับจำนวนเงินบาท (สอดคล้องกับ portfolio/profit service) —
// currentValue/profitLoss รายตัวถูกปัด 2 ตำแหน่งมาแล้วจาก getAssetProfit แต่ผลรวม
// อาจมี Floating Point Noise (0.1 + 0.2) จึงปัดยอดรวมอีกครั้งก่อนบันทึกลง NUMERIC
function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ── เก็บ Snapshot มูลค่าพอตของทุก User ทุกวัน (PROJECT_BRIEF § 7 Phase 2) ──────
// รันวันละครั้ง (เที่ยงคืน Asia/Bangkok): วนทุก User ที่มี Transaction อย่างน้อย 1
// รายการ แล้วบันทึกเงินต้นรวม + มูลค่าตลาดรวม + กำไร/ขาดทุนรวม ณ วันนั้นลงตาราง
// portfolio_snapshots (upsert กัน Cron รันซ้ำวันเดียวกันสร้างข้อมูลซ้ำ)
//
// Error Isolation รายคน (Pattern เดียวกับ planDowngrade.job / portfolioSummary.job):
// 1 User Error (DB/คำนวณล้มเหลว) ต้องไม่ทำให้ทั้ง Cron ล้ม — Log ต่อรายแล้วไปต่อ
// ระดับ Asset ก็ Isolate อีกชั้น: Asset ที่ไม่มี Price Feed (เช่นหุ้นไทย) ถูกข้าม
// (นับใน excludedAssetCount) ไม่ให้ทั้ง User ล้ม
//
// snapshotDate: สตริง 'YYYY-MM-DD' ตาม Asia/Bangkok (Reuse todayInBangkok เดียวกับ
// dcaReminder.job) — รับเป็น Parameter ได้เพื่อให้ Unit Test ส่งวันคงที่เข้ามาได้
async function runPortfolioSnapshot(snapshotDate = todayInBangkok()) {
  let userIds;
  try {
    userIds = await transactionRepository.findAllUserIdsWithTransactions();
  } catch (err) {
    // ดึงรายชื่อไม่ได้ = ทำอะไรต่อไม่ได้ทั้งรอบ — Log แล้วจบ (ไม่ throw ให้ Process ตาย)
    console.error(
      `[cron:portfolio-snapshot] failed to load users with transactions: ${err.message}`
    );
    return { successCount: 0, errorCount: 0 };
  }

  let successCount = 0;
  let errorCount = 0;

  for (const userId of userIds) {
    try {
      const summary = await portfolioService.getPortfolioSummary(userId);

      // ไม่มี Holding เหลือ (ขายหมดแล้ว) — ไม่มีอะไรจะ Snapshot ข้ามไป
      if (summary.isEmpty) continue;

      // รวมเฉพาะ Holding ที่ "มีข้อมูล Profit จริง" (มี Price Feed) — Asset ที่
      // ไม่มีราคา (หุ้นไทย/API ล้มเหลว) ถูกข้ามและนับไว้ใน excludedCount แทน
      let totalCurrentValue = 0;
      let totalProfitLoss = 0;
      let hasAny = false;
      let excludedCount = 0;

      for (const holding of summary.holdings) {
        try {
          const profit = await profitService.getAssetProfit(userId, holding.symbol);
          totalCurrentValue += profit.currentValue;
          totalProfitLoss += profit.profitLoss;
          hasAny = true;
        } catch (err) {
          // ไม่มี Price Feed (เช่นหุ้นไทย) / คำนวณกำไรไม่ได้ — ข้าม Asset ตัวนี้
          // ไม่ให้ทั้ง User ล้ม แต่ยังนับไว้เพื่อบอกว่าตัวเลขไม่ครบทุก Asset
          excludedCount += 1;
        }
      }

      await portfolioSnapshotRepository.upsertSnapshot({
        userId,
        snapshotDate,
        totalInvested: summary.totalInvested,
        // ไม่มี Holding ไหนมีข้อมูล Profit เลย → null (ไม่ใช่ 0) ตาม Pattern
        // aggregatedProfit ฝั่ง Dashboard — แยก "ไม่มีข้อมูล" ออกจาก "มูลค่า 0 จริง"
        totalCurrentValue: hasAny ? roundToTwo(totalCurrentValue) : null,
        totalProfitLoss: hasAny ? roundToTwo(totalProfitLoss) : null,
        excludedAssetCount: excludedCount,
      });
      successCount += 1;
    } catch (err) {
      // 1 User Fail ไม่กระทบคนอื่น (Error Isolation) — ไม่ throw ต่อ
      errorCount += 1;
      console.error(`[cron:portfolio-snapshot] user ${userId} failed: ${err.message}`);
    }
  }

  console.log(
    `[cron:portfolio-snapshot] เสร็จสิ้น (${snapshotDate}): ${successCount} สำเร็จ, ${errorCount} ล้มเหลว`
  );
  return { successCount, errorCount };
}

function schedulePortfolioSnapshot() {
  // '0 0 * * *' = เที่ยงคืนทุกวัน Asia/Bangkok (เขตเวลาเดียวกับ Cron รายวันอื่น เช่น
  // portfolioSummary/dcaReminder) — ให้ snapshot_date ตรงกับวันปฏิทินไทย
  return cron.schedule('0 0 * * *', () => runPortfolioSnapshot(), { timezone: 'Asia/Bangkok' });
}

module.exports = {
  schedulePortfolioSnapshot,
  // Export ฟังก์ชัน Run ตรงๆ ให้ Unit Test เรียกได้โดยไม่ต้องรอ Cron Schedule จริง
  runPortfolioSnapshot,
};
