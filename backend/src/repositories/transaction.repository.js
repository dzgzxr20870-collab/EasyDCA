const { supabaseAdmin } = require('../config/supabase');

function toTransaction(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    assetId: row.asset_id,
    type: row.type,
    amountThb: row.amount_thb,
    pricePerUnit: row.price_per_unit,
    quantity: row.quantity,
    feeThb: row.fee_thb,
    date: row.date,
    note: row.note,
    source: row.source,
    createdAt: row.created_at,
  };
}

async function create(data) {
  const { data: row, error } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id: data.userId,
      asset_id: data.assetId,
      type: data.type,
      amount_thb: data.amountThb,
      price_per_unit: data.pricePerUnit,
      quantity: data.quantity,
      fee_thb: data.feeThb,
      date: data.date,
      note: data.note,
      source: data.source,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create transaction: ${error.message}`);
  }

  return toTransaction(row);
}

async function findRecentByUser(userId, limit) {
  // date เป็นชนิด DATE (ไม่มีเวลา — DATABASE.md § 2) ธุรกรรมหลายรายการในวัน
  // เดียวกันจะมี date เท่ากันหมด ทำให้ ORDER BY date เดี่ยวไม่ Deterministic
  // (SQL ไม่การันตีลำดับแถวที่ค่าเท่ากัน) — เพิ่ม created_at DESC (TIMESTAMPTZ
  // ระดับเวลาจริง) เป็น Secondary Key เพื่อให้ "ล่าสุดจริง" ถูกคืนก่อนเสมอ
  // สำคัญต่อ undoLastTransaction (ย้อนรายการล่าสุด) และ history (แสดงล่าสุด N)
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to find recent transactions for user ${userId}: ${error.message}`);
  }

  return data.map(toTransaction);
}

// ดึง Transaction "ทั้งหมด" ของ User (ไม่จำกัด limit ต่างจาก findRecentByUser)
// พร้อม Join assets เพื่อได้ symbol มาด้วยในคราวเดียว (เลี่ยง N+1 Query) — ใช้
// สำหรับหน้า History ของ Dashboard ที่ต้อง Filter/Limit เองในชั้น Controller
// เรียงตาม date DESC, created_at DESC (Pattern เดียวกับ findRecentByUser — เหตุผล
// เดียวกัน: date เป็น DATE ไม่มีเวลา ต้องใช้ created_at เป็น Secondary Key)
async function findAllByUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*, assets(symbol)')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to find all transactions for user ${userId}: ${error.message}`);
  }

  return data.map((row) => ({
    ...toTransaction(row),
    symbol: row.assets?.symbol ?? null,
  }));
}

async function findAllByAsset(assetId) {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('asset_id', assetId);

  if (error) {
    throw new Error(`Failed to find transactions for asset ${assetId}: ${error.message}`);
  }

  return data.map(toTransaction);
}

module.exports = {
  create,
  findRecentByUser,
  findAllByUser,
  findAllByAsset,
};
