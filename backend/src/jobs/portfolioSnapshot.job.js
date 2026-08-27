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
          // allowRetry:true — Cron เที่ยงคืนนี้เป็น Root Cause ของ 429 Burst ที่เจอใน
          // Production (ยิงหลาย Symbol หุ้นสหรัฐรัวๆ เกิน 8 Credit/นาทีของ Twelve
          // Data Free Tier) ไม่ Sensitive เรื่อง Latency จึงยอมรอ Throttle Slot +
          // Retry เมื่อโดน 429 แทนที่จะทิ้ง Asset นั้นไปเงียบๆ เหมือนเดิม
          // ⚠️ ต้องส่ง holding.brokerId เสมอ (Stage 5 — migration 046): ผู้ใช้ที่ถือ
          // Symbol เดียวกัน 2 โบรกจะมี holding 2 แถวที่ symbol เท่ากัน ถ้าไม่ระบุโบรก
          // getAssetProfit จะ throw AMBIGUOUS_ASSET_BROKER ทั้งสองแถว แล้วถูก catch
          // ด้านล่างนับเป็น excludedCount → มูลค่ารวมรายคืนขาด Symbol นั้นไปทั้งก้อน
          // แบบไม่มี Error ให้เห็นเลย (Snapshot คือตัวเลขเงินที่ผู้ใช้เห็นย้อนหลัง)
          // ⚠️⚠️ **ต้องส่ง holding.portfolioId ด้วย ห้ามส่ง null แบบ Hardcode**
          // (Stage 8-fix รอบ 4 — 27 ส.ค. 2569) เดิมบรรทัดนี้ส่ง `null` ซึ่งแปลว่า
          // **"เจาะจงว่าไม่มีพอร์ต"** → ค้นด้วย `.is('portfolio_id', null)` →
          // หลัง Backfill ของ 044 ไม่เหลือแถวแบบนั้นเลย → ASSET_NOT_FOUND ทุกแถว
          // → ถูก catch ด้านล่างนับเป็น excludedCount ทั้งหมด → **totalCurrentValue
          // กลายเป็น null ทุกคืน ทุกคน แบบไม่มี Error ที่ไหนเลย** (มี catch ครอบอยู่)
          //
          // ⚠️ และ **ห้ามเปลี่ยนเป็น undefined** ด้วย — ผู้ใช้ที่ถือ Symbol เดียวกัน
          // 2 พอร์ตจะมี holding 2 แถวที่ symbol เท่ากัน ถ้าไม่ระบุพอร์ตจะได้
          // AMBIGUOUS_ASSET_PORTFOLIO ทั้งคู่ แล้วตกหล่นทั้งสองแถวเหมือนกัน
          // (บทเรียนเดียวกับ brokerId ข้างบนเป๊ะ)
          //
          // holding พก portfolioId + brokerId มาให้แล้วจาก getPortfolioSummary
          // ซึ่งรวมกันเป็นคีย์ที่ระบุแถวได้เป๊ะตัวเดียวตาม UNIQUE ของ migration 046
          const profit = await profitService.getAssetProfit(
            userId,
            holding.symbol,
            holding.portfolioId ?? null,
            { allowRetry: true },
            holding.brokerId ?? null
          );
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
