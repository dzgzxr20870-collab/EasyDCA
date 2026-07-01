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

async function create(userId, portfolioId, symbol, name, type) {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .insert({
      user_id: userId,
      portfolio_id: portfolioId,
      symbol,
      name,
      type,
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
};
