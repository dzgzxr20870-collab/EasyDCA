const { supabaseAdmin } = require('../config/supabase');
const { queryForUser } = require('../utils/ownership.util');

// ═══════════════════════════════════════════════════════════════════════════
// Error ของชั้น Repository สำหรับ "เงื่อนไขทางธุรกิจที่ DB เป็นคนตัดสิน"
// ═══════════════════════════════════════════════════════════════════════════
// จงใจ "ไม่" throw TransactionServiceError ตรงจากที่นี่ เพราะ transaction.service
// require ไฟล์นี้อยู่แล้ว การ require กลับจะเกิด Circular Dependency (ตอน Load
// module.exports ของ service ยังไม่ถูกกำหนด → ได้ undefined)
//
// ชั้น Service เป็นคนแปลง Error นี้เป็น Error ของโดเมนตัวเองแทน ซึ่งถูกต้องกว่าด้วย
// เพราะเงื่อนไข "ขายเกินยอด" มีชื่อ Code ต่างกันตาม Flow:
//   - processSellCommand  → INSUFFICIENT_QUANTITY
//   - undoLastTransaction → CANNOT_UNDO_QUANTITY_MISMATCH
class LedgerWriteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LedgerWriteError';
    this.code = code;
    this.details = details;
  }
}

// แกะ DETAIL ที่ RPC ส่งมาในรูป 'requested=1050;held=50.00000000' เป็นตัวเลขจริง
// คืน {} ถ้ารูปแบบไม่ตรง (ไม่ให้การอ่าน Detail ที่เพี้ยนทำให้ Error หลักหายไป)
function parseQuantityDetail(detail) {
  if (typeof detail !== 'string') return {};
  const requested = detail.match(/requested=([\d.]+)/);
  const held = detail.match(/held=([\d.]+)/);
  if (!requested || !held) return {};
  return { requested: Number(requested[1]), held: Number(held[1]) };
}

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

// ═══════════════════════════════════════════════════════════════════════════
// ทางเข้า "เดียว" ของการเขียน Ledger ทั้งระบบ — ผ่าน RPC ที่ Lock แถว asset เสมอ
// ═══════════════════════════════════════════════════════════════════════════
// เดิมเป็น .insert() ตรงๆ ซึ่งทำให้การตรวจ "ขายเกินยอดคงเหลือ" ในชั้น Service เป็น
// check-then-insert ที่ไม่ Atomic: สองคำสั่งขาย Asset เดียวกันที่เข้ามาพร้อมกันจะ
// อ่านประวัติชุดเดียวกัน (Stale Read) แล้วผ่านการตรวจทั้งคู่ → ยอดคงเหลือติดลบ
// (เส้นทางเว็บยิงขนานได้ทันทีเพราะไม่มีขั้น Preview/Confirm คั่น)
//
// migration 034 ย้าย [Lock → คำนวณยอด → Validate → INSERT] ไปอยู่ใน Postgres
// Function เดียว (DATABASE.md § 12) — Supabase JS ทำ Row Lock/Multi-statement
// Transaction จาก Client ไม่ได้ จึงต้องเป็น RPC เท่านั้น
//
// ⚠️ เปลี่ยนที่ฟังก์ชันนี้จุดเดียวโดยเจตนา: จุด INSERT ของทั้งระบบมี 3 ที่
// (processBuyCommand / processSellCommand / undo Reversal) และทุกที่เรียกผ่าน
// create() ตัวนี้หมด → ได้ Lock ครบทุก Path โดยไม่ต้องแก้ Call Site และ "ไม่มีทาง
// ลืม Path ใหม่ในอนาคต" เพราะเหลือทางเข้า Ledger ทางเดียวจริงๆ
//
// คืน Transaction ที่บันทึกแล้ว + heldAfter (ยอดคงเหลือหลังบันทึก คำนวณจากยอดที่
// Lock ไว้แล้วจริง — แม่นกว่าให้ Caller คำนวณเองจาก Snapshot ก่อน Insert)
// throw LedgerWriteError('INSUFFICIENT_QUANTITY'|'ASSET_NOT_FOUND') ตามที่ DB ตัดสิน
async function create(data) {
  const { data: rows, error } = await supabaseAdmin.rpc('create_transaction_locked', {
    p_user_id: data.userId,
    p_asset_id: data.assetId,
    p_type: data.type,
    p_amount_thb: data.amountThb,
    p_price_per_unit: data.pricePerUnit,
    p_quantity: data.quantity,
    // Multi-Currency (Round 10) — Default 'THB' เมื่อ Caller ไม่ส่ง (Path เดิม)
    p_currency: data.currency ?? 'THB',
    p_fee_thb: data.feeThb ?? 0,
    p_date: data.date,
    p_note: data.note ?? null,
    p_source: data.source ?? 'line',
  });

  if (error) {
    // RPC RAISE ด้วย MESSAGE เป็นชื่อ Code ตรงๆ (ดู migration 034) — ทั้งสองเคสนี้
    // คือ "คำสั่งนี้ทำไม่ได้ตามกติกา" ไม่ใช่ระบบพัง จึงต้องแยกจาก Error ทั่วไป
    if (error.message === 'INSUFFICIENT_QUANTITY') {
      throw new LedgerWriteError(
        'INSUFFICIENT_QUANTITY',
        'Cannot sell more than the currently held quantity',
        parseQuantityDetail(error.details)
      );
    }
    if (error.message === 'ASSET_NOT_FOUND') {
      throw new LedgerWriteError('ASSET_NOT_FOUND', `Asset ${data.assetId} not found`, {
        assetId: data.assetId,
      });
    }
    throw new Error(`Failed to create transaction: ${error.message}`);
  }

  // RETURNS TABLE → PostgREST คืนเป็น Array เสมอ (แม้แถวเดียว)
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    throw new Error('Failed to create transaction: RPC returned no row');
  }

  return { ...toTransaction(row), heldAfter: Number(row.held_after) };
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
//
// ⚠️ Security Audit (Cross-User Isolation, รอบ 2): เดิมรับแค่ assetId — ปลอดภัย
// อยู่เพราะทุก Caller Resolve Asset แบบ user-scoped มาก่อนเสมอ (findByUserAndSymbol/
// findActiveByUser/findRecentByUser) แต่เป็นความปลอดภัยจากวินัยของ Caller ไม่ใช่
// โครงสร้างบังคับ — ย้ายมาผ่าน queryForUser ให้ userId เป็น Parameter บังคับ
// (throw ทันทีถ้าไม่ส่ง) และกรอง user_id ที่ชั้น Query จริง ไม่ใช่แค่พึ่ง assetId
async function findAllByAsset(assetId, userId) {
  const { data, error } = await queryForUser('transactions', userId, (q) =>
    q.select('*').eq('asset_id', assetId)
  )
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
//
// ⚠️ Security Audit (Cross-User Isolation, รอบ 2): เดิมรับแค่ id — ปลอดภัยอยู่
// เพราะทุก Caller ตรวจ Ownership ของ Transaction ก่อนเรียกอยู่แล้ว (findByIdForUser
// ที่ Controller / userId ที่ Authenticate แล้วที่ Webhook) แต่เป็นวินัยของ Caller
// ไม่ใช่โครงสร้างบังคับ — เพิ่ม userId เป็น Parameter บังคับ ผ่าน queryForUser
async function attachSlipImagePath(id, slipImagePath, userId) {
  const { data, error } = await queryForUser('transactions', userId, (q) =>
    q.update({ slip_image_path: slipImagePath }).eq('id', id)
  )
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
  LedgerWriteError,
  create,
  findRecentByUser,
  findAllByUser,
  findByUserAndDateRange,
  findAllByAsset,
  findAllUserIdsWithTransactions,
  attachSlipImagePath,
  findByIdForUser,
};
