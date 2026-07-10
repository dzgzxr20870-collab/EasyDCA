const { supabaseAdmin } = require('../config/supabase');

function toAsset(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    portfolioId: row.portfolio_id,
    symbol: row.symbol,
    name: row.name,
    type: row.type,
    // กองทุนรวมไทย (Round 7) — เก็บ Class ที่ถือจริง (nullable สำหรับสินทรัพย์อื่น)
    projId: row.proj_id ?? null,
    fundClassName: row.fund_class_name ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findByUserAndSymbol(userId, symbol, portfolioId) {
  let query = supabaseAdmin
    .from('assets')
    .select('*')
    .eq('user_id', userId)
    .eq('symbol', symbol);

  // portfolio_id เป็น nullable (Free Plan ไม่มี Multiple Portfolio)
  // ต้องใช้ .is() แทน .eq() เมื่อเทียบกับ null ตาม PostgREST
  query = portfolioId ? query.eq('portfolio_id', portfolioId) : query.is('portfolio_id', null);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Failed to find asset by user and symbol: ${error.message}`);
  }

  return toAsset(data);
}

// fundInfo (Optional) = { projId, fundClassName } สำหรับ Asset ประเภทกองทุนรวม
// (Round 7) — สินทรัพย์อื่นไม่ส่งมา → เป็น null ตามปกติ (Backward Compatible กับ
// Caller เดิมที่เรียกด้วย 5 Argument)
async function create(userId, portfolioId, symbol, name, type, fundInfo = {}) {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .insert({
      user_id: userId,
      portfolio_id: portfolioId,
      symbol,
      name,
      type,
      proj_id: fundInfo.projId ?? null,
      fund_class_name: fundInfo.fundClassName ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create asset: ${error.message}`);
  }

  return toAsset(data);
}

async function findActiveByUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to find active assets for user ${userId}: ${error.message}`);
  }

  return data.map(toAsset);
}

// ดึง Asset หลายตัวพร้อมกันด้วย 1 Query (ใช้ตอนต้อง Map assetId → symbol
// ของหลาย Transaction เช่นใน history.service — เลี่ยงการ Query ทีละตัว)
async function findByIds(assetIds) {
  if (!assetIds || assetIds.length === 0) return [];

  const { data, error } = await supabaseAdmin.from('assets').select('*').in('id', assetIds);

  if (error) {
    throw new Error(`Failed to find assets by ids: ${error.message}`);
  }

  return data.map(toAsset);
}

// คืนรายการ User ที่มี Asset Active อย่างน้อย 1 ตัว (Distinct ราย user_id) พร้อม
// line_user_id ที่ Join มาในคราวเดียว — ใช้เป็นรายชื่อ User ที่ Cron สรุปพอร์ต
// (portfolioSummary.job) ต้องวนคำนวณให้ การ Join users ที่นี่เลยกัน N+1 Query
// ตอน Push (ไม่ต้องยิงหา line_user_id ทีละ User)
//
// PostgREST ไม่มี DISTINCT ตรงๆ — ดึงทุกแถว Asset Active แล้ว Dedupe ราย user_id
// ในชั้น App (จำนวน Asset ต่อ User น้อย ไม่กระทบ Performance อย่างมีนัยสำคัญ)
async function findUserIdsWithActiveAssets() {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('user_id, users(line_user_id)')
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to find user ids with active assets: ${error.message}`);
  }

  const seen = new Map();
  for (const row of data) {
    if (seen.has(row.user_id)) continue;
    seen.set(row.user_id, {
      userId: row.user_id,
      lineUserId: row.users?.line_user_id ?? null,
    });
  }

  return Array.from(seen.values());
}

// คืน "จำนวน Symbol ที่ต่างกัน (Distinct) ของ Asset Active" แยกราย user_id เป็น
// object { [userId]: count } — ใช้ในหน้า Admin Dashboard (Round 4b) แสดง assetCount
// ต่อ User โดยยิง Query เดียวสำหรับทุก User (เลี่ยง N+1 ที่จะเกิดถ้าเรียก
// countActiveByUser ทีละคน) Dedupe ราย symbol เพราะ Premium อาจถือ symbol เดียวกัน
// ข้ามหลาย Portfolio (นับเป็น 1 สินทรัพย์ตาม "distinct symbol")
async function countActiveSymbolsGroupedByUser() {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('user_id, symbol')
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to count active symbols grouped by user: ${error.message}`);
  }

  const symbolsByUser = new Map();
  for (const row of data ?? []) {
    if (!symbolsByUser.has(row.user_id)) symbolsByUser.set(row.user_id, new Set());
    symbolsByUser.get(row.user_id).add(row.symbol);
  }

  const counts = {};
  for (const [userId, symbols] of symbolsByUser) {
    counts[userId] = symbols.size;
  }

  return counts;
}

async function countActiveByUser(userId) {
  const { count, error } = await supabaseAdmin
    .from('assets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to count active assets for user ${userId}: ${error.message}`);
  }

  return count ?? 0;
}

module.exports = {
  findByUserAndSymbol,
  create,
  findActiveByUser,
  findByIds,
  countActiveByUser,
  countActiveSymbolsGroupedByUser,
  findUserIdsWithActiveAssets,
};
