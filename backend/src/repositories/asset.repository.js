const { supabaseAdmin } = require('../config/supabase');
const { queryForUser, requireUserId } = require('../utils/ownership.util');

// ═══════════════════════════════════════════════════════════════════════════
// Error ของชั้น Repository สำหรับ "เงื่อนไขทางธุรกิจที่ DB เป็นคนตัดสิน"
// ═══════════════════════════════════════════════════════════════════════════
// Pattern เดียวกับ LedgerWriteError ใน transaction.repository.js เป๊ะ (เหตุผล
// เดียวกัน: transaction.service require ไฟล์นี้อยู่แล้ว การ throw
// TransactionServiceError ตรงจากที่นี่จะเกิด Circular Dependency) — ชั้น Service
// เป็นคนแปลงเป็น Error ของโดเมนตัวเองแทน
class AssetWriteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AssetWriteError';
    this.code = code;
    this.details = details;
  }
}

// แกะ DETAIL ที่ RPC ส่งมาในรูป 'limit=0;current=6' เป็นตัวเลขจริง (Pattern เดียวกับ
// parseQuantityDetail ใน transaction.repository.js) คืน {} ถ้ารูปแบบไม่ตรง
function parseLimitDetail(detail) {
  if (typeof detail !== 'string') return {};
  const limit = detail.match(/limit=([\d.]+)/);
  const current = detail.match(/current=([\d.]+)/);
  if (!limit || !current) return {};
  return { limit: Number(limit[1]), current: Number(current[1]) };
}

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

// ═══════════════════════════════════════════════════════════════════════════
// ทางเข้า "เดียว" ของการสร้าง Asset ใหม่ทั้งระบบ — ผ่าน RPC ที่ Lock แถว users เสมอ
// ═══════════════════════════════════════════════════════════════════════════
// เดิมเป็น .insert() ตรงๆ ซึ่งทำให้การตรวจ "เกินเพดาน Free Plan" ในชั้น Service
// (validateBuy) เป็น check-then-insert ที่ไม่ Atomic: สองคำสั่งซื้อ Symbol ใหม่
// คนละตัวที่เข้ามาพร้อมกันจะอ่านจำนวน Asset ปัจจุบันชุดเดียวกัน (Stale Read) แล้ว
// ผ่านการตรวจทั้งคู่ → ได้ Asset เกินเพดาน 2 ตัวของ Free Plan
//
// migration 035 ย้าย [Lock แถว users → นับ Asset Active → Validate เพดาน → INSERT]
// ไปอยู่ใน Postgres Function เดียว (Pattern เดียวกับ migration 034 ที่ทำกับ
// transactions/assets แค่เปลี่ยนแถวที่ Lock เป็น users เพราะเพดานนับรวมทั้ง User)
//
// assetLimit: null = ไม่จำกัด (Premium ที่ยัง Active) — คำนวณจาก
// entitlement.getActiveAssetLimit() ในชั้น Service เหมือนเดิม (Single Source of
// Truth ของเลข "2" ยังอยู่ที่ entitlement.service.js ไม่ Hardcode ซ้ำใน SQL)
//
// throw AssetWriteError:
//   - 'ASSET_LIMIT_REACHED' — เกินเพดาน Free Plan
//   - 'ASSET_ALREADY_EXISTS' — Symbol เดียวกันถูกสร้างไปแล้ว (ชนกันพอดี/กดซ้ำ —
//     UNIQUE NULLS NOT DISTINCT กันไว้ที่ระดับ DB, RPC แปลงเป็นข้อความอ่านง่ายให้)
//   - 'USER_NOT_FOUND' — Defensive เท่านั้น แทบไม่ถึงในทางปฏิบัติ (Foreign Key
//     บังคับให้ userId ต้องมีอยู่จริงตั้งแต่ Auth แล้ว)
//
// fundInfo (Optional) = { projId, fundClassName } สำหรับ Asset ประเภทกองทุนรวม
// (Round 7) — สินทรัพย์อื่นไม่ส่งมา → เป็น null ตามปกติ
async function create(userId, portfolioId, symbol, name, type, fundInfo = {}, assetLimit = null) {
  const { data: rows, error } = await supabaseAdmin.rpc('create_asset_locked', {
    p_user_id: userId,
    p_portfolio_id: portfolioId,
    p_symbol: symbol,
    p_name: name,
    p_type: type,
    p_asset_limit: assetLimit,
    p_proj_id: fundInfo.projId ?? null,
    p_fund_class_name: fundInfo.fundClassName ?? null,
  });

  if (error) {
    // RPC RAISE ด้วย MESSAGE เป็นชื่อ Code ตรงๆ (ดู migration 035) — ทั้งสามเคสนี้
    // คือ "คำสั่งนี้ทำไม่ได้ตามกติกา" ไม่ใช่ระบบพัง จึงต้องแยกจาก Error ทั่วไป
    if (error.message === 'ASSET_LIMIT_REACHED') {
      throw new AssetWriteError(
        'ASSET_LIMIT_REACHED',
        `Free plan is limited to ${assetLimit} active assets`,
        parseLimitDetail(error.details)
      );
    }
    if (error.message === 'ASSET_ALREADY_EXISTS') {
      throw new AssetWriteError(
        'ASSET_ALREADY_EXISTS',
        `Asset ${symbol} already exists for this user`,
        { userId, symbol }
      );
    }
    if (error.message === 'USER_NOT_FOUND') {
      throw new AssetWriteError('USER_NOT_FOUND', `User ${userId} not found`, { userId });
    }
    throw new Error(`Failed to create asset: ${error.message}`);
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    throw new Error('Failed to create asset: RPC returned no row');
  }

  return toAsset(row);
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
//
// ⚠️ Security Audit (Cross-User Isolation, รอบ 2): เดิมรับแค่ assetIds — ปลอดภัย
// อยู่เพราะทุก Caller ส่ง assetId ที่มาจาก Transaction ของตัวเองมาแล้วเท่านั้น แต่
// เป็นวินัยของ Caller ไม่ใช่โครงสร้างบังคับ — ย้ายผ่าน queryForUser ให้ userId
// เป็น Parameter บังคับ ตรวจก่อนเสมอแม้ assetIds จะว่าง (กัน Caller ลืมส่ง userId
// แล้ว "ดูเหมือนทำงานถูก" เพราะ Early-return ทำให้ไม่มี Query ยิงออกไปจริง)
async function findByIds(assetIds, userId) {
  requireUserId(userId, 'asset.findByIds');
  if (!assetIds || assetIds.length === 0) return [];

  const { data, error } = await queryForUser('assets', userId, (q) =>
    q.select('*').in('id', assetIds)
  );

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
  AssetWriteError,
  findByUserAndSymbol,
  create,
  findActiveByUser,
  findByIds,
  countActiveByUser,
  countActiveSymbolsGroupedByUser,
  findUserIdsWithActiveAssets,
};
