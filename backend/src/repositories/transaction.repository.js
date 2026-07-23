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
    // Multi-Currency (Round 10) — สกุลของ amount_thb/price_per_unit ในแถวนี้
    // (แถวเดิมทั้งหมด/ไม่มีค่า = 'THB' ตาม DEFAULT ของ migration 012)
    currency: row.currency ?? 'THB',
    feeThb: row.fee_thb,
    date: row.date,
    note: row.note,
    source: row.source,
    // Storage path ของรูปสลิปต้นฉบับที่ AI OCR อ่าน (migration 021) — null สำหรับ
    // ธุรกรรมที่ไม่ได้มาจากสลิป (พิมพ์เอง/Web/Bulk Import) ซึ่งเป็นกรณีส่วนใหญ่
    // ⚠️ เป็น "path" ไม่ใช่ URL — Bucket เป็น Private ต้อง Sign ก่อนใช้เปิดจริง
    slipImagePath: row.slip_image_path ?? null,
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
      // Multi-Currency (Round 10) — Default 'THB' เมื่อ Caller ไม่ส่ง (Path เดิม)
      currency: data.currency ?? 'THB',
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

// คืน user_id (Distinct) ของ User ทุกคนที่มี Transaction อย่างน้อย 1 รายการ —
// ใช้เป็นรายชื่อ User ที่ Cron Snapshot มูลค่าพอต (portfolioSnapshot.job) ต้องวน
// บันทึกให้ทุกวัน
//
// PostgREST ไม่มี DISTINCT ตรงๆ — ดึงเฉพาะคอลัมน์ user_id ทุกแถวแล้ว Dedupe ในชั้น
// App (Pattern เดียวกับ asset.repository.findUserIdsWithActiveAssets)
async function findAllUserIdsWithTransactions() {
  const { data, error } = await supabaseAdmin.from('transactions').select('user_id');

  if (error) {
    throw new Error(`Failed to find user ids with transactions: ${error.message}`);
  }

  const seen = new Set();
  for (const row of data) {
    seen.add(row.user_id);
  }

  return Array.from(seen);
}

// ดึง Transaction ของ User ที่ date อยู่ในช่วง [from, to] (ทั้งสองฝั่ง Inclusive)
// พร้อม Join assets เพื่อได้ symbol มาในคราวเดียว (เลี่ยง N+1) — ใช้สำหรับ Export
// รายงาน (Phase 3 Round 8) ที่ต้องกรอง "ประวัติธุรกรรม" ตามช่วงเวลาที่ผู้ใช้เลือก
// (ต่างจาก findAllByUser ที่คืนทั้งพอร์ต) from/to เป็น 'YYYY-MM-DD' (transactions.date
// เป็น DATE column — เทียบ String ได้ตรงตัว) เรียง date ASC, created_at ASC เพื่อให้
// รายงานอ่านไล่จากเก่า→ใหม่เหมือน Bank Statement
async function findByUserAndDateRange(userId, from, to) {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*, assets(symbol)')
    .eq('user_id', userId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(
      `Failed to find transactions in range for user ${userId}: ${error.message}`
    );
  }

  return data.map((row) => ({
    ...toTransaction(row),
    symbol: row.assets?.symbol ?? null,
  }));
}

// เรียง date ASC, created_at ASC (Pattern เดียวกับ findByUserAndDateRange) — จำเป็น
// สำหรับ Moving Average Cost Basis (portfolio.service.calculateTotalInvested) ที่ต้อง
// Replay ธุรกรรมตามลำดับเวลาจริง ไม่พึ่ง Row Order ตามธรรมชาติของ Postgres ซึ่งไม่การันตี
async function findAllByAsset(assetId) {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('asset_id', assetId)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to find transactions for asset ${assetId}: ${error.message}`);
  }

  return data.map(toTransaction);
}

// แนบ Storage path ของรูปสลิปเข้ากับ Transaction ที่ "สร้างสำเร็จไปแล้ว" (S8)
// — Pattern เดียวกับ payment.repository.updateSlipImageUrl (แนบหลักฐานทีหลัง
// แบบ Best-effort ไม่ใช่ส่วนหนึ่งของการสร้างรายการ)
//
// ⚠️ อัปเดตเฉพาะคอลัมน์ Metadata นี้คอลัมน์เดียว ห้ามแตะตัวเลขการเงินใดๆ —
// transactions เป็น Immutable Ledger (DATABASE.md § กฎห้ามลบ/แก้ย้อนหลัง)
// การเขียนนี้เป็นข้อยกเว้นที่ปลอดภัยเพราะเป็นการ "เติมหลักฐานประกอบ" ที่เดิมเป็น
// NULL ไม่ได้เปลี่ยนความหมายทางบัญชีของแถวเลย
//
// คืน Transaction ที่อัปเดตแล้ว | throw ถ้า DB error (Caller ห่อ try/catch เพื่อให้
// การแนบรูปล้มเหลวไม่ทำให้ธุรกรรมที่บันทึกสำเร็จแล้วพังตาม)
async function attachSlipImagePath(id, slipImagePath) {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .update({ slip_image_path: slipImagePath })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to attach slip image path to transaction ${id}: ${error.message}`);
  }

  return toTransaction(data);
}

// ดึง Transaction แถวเดียวโดยตรวจความเป็นเจ้าของไปพร้อมกัน (userId ต้องตรง) —
// ใช้โดย Endpoint เปิดรูปสลิปเพื่อกันผู้ใช้ขอ Signed URL ของสลิปคนอื่นด้วยการเดา
// transaction id คืน null ถ้าไม่พบ "หรือ" ไม่ใช่ของ User คนนั้น (แยกไม่ออกโดยเจตนา
// — ไม่บอกใบ้ว่า id นั้นมีอยู่จริงไหม)
async function findByIdForUser(id, userId) {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find transaction ${id}: ${error.message}`);
  }

  return toTransaction(data);
}

module.exports = {
  create,
  findRecentByUser,
  findAllByUser,
  findByUserAndDateRange,
  findAllByAsset,
  findAllUserIdsWithTransactions,
  attachSlipImagePath,
  findByIdForUser,
};
