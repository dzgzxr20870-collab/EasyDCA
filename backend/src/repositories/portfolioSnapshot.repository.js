const { supabaseAdmin } = require('../config/supabase');

// ตาราง Snapshot มูลค่าพอตรายวัน (migrations/005_create_portfolio_snapshots.sql)
// ทุก Query ใช้ supabaseAdmin (service_role) เพราะ RLS เปิดแบบ service_role เท่านั้น
// (Pattern เดียวกับ payment.repository / pendingTransaction.repository)
function toSnapshot(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    snapshotDate: row.snapshot_date,
    totalInvested: row.total_invested,
    totalCurrentValue: row.total_current_value,
    totalProfitLoss: row.total_profit_loss,
    excludedAssetCount: row.excluded_asset_count,
    createdAt: row.created_at,
  };
}

// Upsert Snapshot ของ (user, วัน) หนึ่งๆ — ใช้ onConflict 'user_id,snapshot_date'
// (ตรงกับ UNIQUE (user_id, snapshot_date) ใน Migration) เพื่อให้ Cron รันซ้ำใน
// วันเดียวกัน (เช่น Restart ระหว่างวัน) เขียนทับค่าเดิมแทนการ Insert แถวซ้ำ
async function upsertSnapshot({
  userId,
  snapshotDate,
  totalInvested,
  totalCurrentValue,
  totalProfitLoss,
  excludedAssetCount,
}) {
  const { data, error } = await supabaseAdmin
    .from('portfolio_snapshots')
    .upsert(
      {
        user_id: userId,
        snapshot_date: snapshotDate,
        total_invested: totalInvested,
        total_current_value: totalCurrentValue,
        total_profit_loss: totalProfitLoss,
        excluded_asset_count: excludedAssetCount,
      },
      { onConflict: 'user_id,snapshot_date' }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to upsert portfolio snapshot for user ${userId}: ${error.message}`);
  }

  return toSnapshot(data);
}

module.exports = {
  upsertSnapshot,
};
