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
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to find recent transactions for user ${userId}: ${error.message}`);
  }

  return data.map(toTransaction);
}

module.exports = {
  create,
  findRecentByUser,
};
