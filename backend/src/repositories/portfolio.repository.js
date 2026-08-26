const { supabaseAdmin } = require('../config/supabase');
const { queryForUser, requireUserId } = require('../utils/ownership.util');

// ═══════════════════════════════════════════════════════════════════════════
// portfolio.repository — ตาราง portfolios (Base Schema + migration 044)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ตารางนี้มีอยู่ตั้งแต่ Base Schema แต่ **ไม่เคยมี Repository จริง** จนถึง
// Stage 8 (portfolio_id ถูกใช้เป็น NULL แทบ 100% ในระบบก่อนหน้า) — ownership.util
// ลงทะเบียน 'portfolios' ไว้ล่วงหน้าแล้วโดยเจตนา เพื่อกัน Session ในอนาคตเขียน
// Repository ใหม่แล้วลืมผ่าน Helper ซึ่งคือเคสนี้พอดี
//
// ⚠️ กฎเหล็กของไฟล์นี้ (เหมือน broker.repository เป๊ะ): ทุก Query ที่ "อ่าน/แก้/ลบ
// แถวที่มีอยู่แล้ว" ต้องผ่าน queryForUser('portfolios', userId, ...) ไม่มีข้อยกเว้น
// รวมถึง "หาพอร์ตด้วย id" ด้วย — ห้าม .eq('id', id) เดี่ยวๆ เด็ดขาด เพราะ id มา
// จากฝั่ง Client ที่ผู้ใช้กำหนดเองได้ 100% ถ้าไม่เทียบ user_id ด้วย ผู้ใช้ A ที่
// ถือ portfolioId ของ B จะอ่าน/แก้/ลบของ B ได้ทันที
// (EasyDCA ไม่ได้เปิด RLS จริง — Backend คือ Security Boundary เดียว)
//
// ── Invariant ที่ไฟล์นี้ต้องไม่ทำพัง (migration 044/045) ─────────────────────
//   "ผู้ใช้ทุกคนมีพอร์ต Default หนึ่งอันเป๊ะ และสินทรัพย์ทุกแถวสังกัดพอร์ตเสมอ"
// migration 045 เป็น Guard ที่ RAISE EXCEPTION ถ้า Invariant นี้ไม่จริง และโค้ด
// ทั้งระบบพึ่งข้อนี้ได้ — ดูรายละเอียดที่ deleteByIdForUser() ด้านล่าง

class PortfolioWriteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PortfolioWriteError';
    this.code = code;
    this.details = details;
  }
}

// Postgres check_violation — CHECK ของ portfolios.type
const PG_CHECK_VIOLATION = '23514';
// Postgres unique_violation — idx_portfolios_one_default_per_user (Partial Unique)
const PG_UNIQUE_VIOLATION = '23505';

function toPortfolio(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    // migration 044 — พอร์ตเริ่มต้น มีได้ 1 อันต่อ user เป๊ะ (Partial Unique Index)
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function throwIfConstraintViolation(error, context) {
  if (error.code === PG_CHECK_VIOLATION) {
    throw new PortfolioWriteError('VALIDATION_ERROR', `${context}: failed DB CHECK`, {});
  }
  if (error.code === PG_UNIQUE_VIOLATION) {
    // ชนได้ทางเดียวคือ idx_portfolios_one_default_per_user — แปลว่ามีคนพยายาม
    // ตั้งพอร์ต Default ตัวที่ 2 ซึ่งเป็นบั๊กของโค้ด ไม่ใช่ Input ของผู้ใช้
    throw new PortfolioWriteError(
      'DEFAULT_PORTFOLIO_CONFLICT',
      `${context}: user already has a default portfolio`,
      { constraint: 'idx_portfolios_one_default_per_user' }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// findAllByUser — พอร์ตทั้งหมดของ user เรียงตาม created_at (เก่า → ใหม่)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ลำดับนี้ "มีความหมายเชิงสิทธิ์" ไม่ใช่แค่ความสวยงามของ UI —
// entitlement.getWritablePortfolioIds ใช้ลำดับนี้ตัดสินว่าพอร์ตไหนคือ "ส่วนเกิน"
// ตอน Premium หมดอายุ (พอร์ตแรกสุด = ยังเขียนได้) การเปลี่ยน order เป็นอย่างอื่น
// จะเปลี่ยนสิทธิ์การเขียนของผู้ใช้ทันทีโดยไม่มีใครตั้งใจ
//
// Tie-break ด้วย id เพราะ Backfill ของ migration 044 สร้างพอร์ตให้ทุกคนใน
// Transaction เดียว → created_at เท่ากันเป๊ะได้จริง (now() คงที่ทั้ง Transaction)
async function findAllByUser(userId) {
  const { data, error } = await queryForUser('portfolios', userId, (q) =>
    q.select('*').order('created_at', { ascending: true }).order('id', { ascending: true })
  );

  if (error) {
    throw new Error(`Failed to list portfolios for user: ${error.message}`);
  }

  return (data ?? []).map(toPortfolio);
}

// หาพอร์ตด้วย id "ของ user คนนี้เท่านั้น" — คืน null ถ้าไม่มีจริงหรือเป็นของคนอื่น
// (Caller ต้องแปลง null เป็น 404 ไม่ใช่ 403 — ห้ามยืนยันการมีอยู่ของ resource
// ของผู้ใช้คนอื่นให้ผู้โจมตีรู้ ตาม Design Doc § 6.3)
//
// ⚠️ .maybeSingle() ต้องต่อ "นอก" queryForUser เสมอ (ดู broker.repository)
async function findByIdForUser(portfolioId, userId) {
  requireUserId(userId, 'portfolio.findByIdForUser');

  const { data, error } = await queryForUser('portfolios', userId, (q) =>
    q.select('*').eq('id', portfolioId)
  ).maybeSingle();

  if (error) {
    throw new Error(`Failed to find portfolio by id: ${error.message}`);
  }

  return toPortfolio(data);
}

// พอร์ต Default ของ user (Invariant migration 044/045: มีหนึ่งอันเป๊ะเสมอ)
// คืน null ได้เฉพาะกรณี Invariant พัง ซึ่ง Caller ต้องปฏิบัติเป็น Error ของระบบ
// ไม่ใช่ "ปกติแต่ยังไม่มี" — migration 045 มีไว้ดักกรณีนี้โดยเฉพาะ
async function findDefaultByUser(userId) {
  requireUserId(userId, 'portfolio.findDefaultByUser');

  const { data, error } = await queryForUser('portfolios', userId, (q) =>
    q.select('*').eq('is_default', true)
  ).maybeSingle();

  if (error) {
    throw new Error(`Failed to find default portfolio: ${error.message}`);
  }

  return toPortfolio(data);
}

// ═══════════════════════════════════════════════════════════════════════════
// create — สร้างพอร์ตใหม่ (ไม่เคยเป็น Default)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ is_default = false เสมอโดยเจตนา ไม่เปิดให้ Caller ส่งมา — พอร์ต Default
// เกิดได้ทางเดียวคือ Backfill ของ migration 044 (หนึ่งอันต่อ user ตลอดไป)
// ถ้าเปิดให้สร้าง Default ใหม่ได้ จะชน Partial Unique Index ทันที และเปิดช่อง
// ให้ผู้ใช้มีพอร์ต Default 0 อันได้ถ้าลบตัวเดิมทิ้ง = Invariant พัง
//
// ใช้ supabaseAdmin ตรงไม่ผ่าน queryForUser เหมือน broker.create — queryForUser
// ต่อ .eq() ซึ่งไม่มีความหมายกับ INSERT การกันข้ามบัญชีอยู่ที่ "ค่าที่ใส่ลง
// คอลัมน์ user_id" ซึ่งบังคับด้วย requireUserId() + รับ userId จาก JWT เท่านั้น
async function create(userId, { name, type, portfolioLimit = null }) {
  requireUserId(userId, 'portfolio.create');

  // ⚠️ ผ่าน RPC create_portfolio_locked (migration 048) ไม่ใช่ INSERT ตรงๆ —
  // RPC Lock แถว users → นับ → Validate → INSERT ในธุรกรรมเดียว ทำให้เพดานพอร์ต
  // เป็น **Atomic จริง** (เดิมเป็น check-then-insert: สองแท็บพร้อมกันอ่านได้
  // current = 1 ทั้งคู่ → ผ่านทั้งคู่ → ทะลุเพดาน Free)
  //
  // portfolioLimit ส่งมาจาก entitlement.service ผ่าน Service Layer เสมอ —
  // SQL ไม่ Hardcode ตัวเลข (Pattern เดียวกับ p_asset_limit ของ migration 035)
  const { data: rows, error } = await supabaseAdmin.rpc('create_portfolio_locked', {
    p_user_id: userId,
    p_name: name,
    p_type: type,
    p_portfolio_limit: portfolioLimit,
  });

  if (error) {
    // RPC โยน Business Rule ผ่าน RAISE EXCEPTION (ERRCODE P0001) — แปลงเป็น
    // Error ของโดเมนให้ Service ตัดสินต่อ (Pattern เดียวกับ asset.repository)
    const raw = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
    if (raw.includes('PORTFOLIO_LIMIT_REACHED')) {
      throw new PortfolioWriteError(
        'PORTFOLIO_LIMIT_REACHED',
        'portfolio.create: limit reached (enforced under lock)',
        {}
      );
    }
    if (raw.includes('DEFAULT_PORTFOLIO_CONFLICT')) {
      throw new PortfolioWriteError('DEFAULT_PORTFOLIO_CONFLICT', 'portfolio.create', {});
    }
    if (raw.includes('USER_NOT_FOUND')) {
      throw new PortfolioWriteError('USER_NOT_FOUND', 'portfolio.create', {});
    }
    throwIfConstraintViolation(error, 'portfolio.create');
    throw new Error(`Failed to create portfolio: ${error.message}`);
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  return toPortfolio(row ?? null);
}

// ═══════════════════════════════════════════════════════════════════════════
// setDefaultForUser — สลับ "พอร์ตหลัก" ของผู้ใช้ (migration 048)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ต้องผ่าน RPC เท่านั้น ห้าม UPDATE 2 ครั้งจากที่นี่ —
// idx_portfolios_one_default_per_user เป็น Partial UNIQUE บน (user_id)
// WHERE is_default = TRUE → ตั้งตัวใหม่ก่อนปลดตัวเก่าจะชน Index ทันที
// และถ้าแยกเป็น 2 คำสั่งแล้วพังกลางทาง ผู้ใช้จะไม่มีพอร์ต Default เลย =
// Invariant ของ migration 044/045 พังค้างถาวร (ดูเหตุผลเต็มในหัวไฟล์ 048)
async function setDefaultForUser(userId, portfolioId) {
  requireUserId(userId, 'portfolio.setDefaultForUser');

  const { data: rows, error } = await supabaseAdmin.rpc('set_default_portfolio_locked', {
    p_user_id: userId,
    p_portfolio_id: portfolioId,
  });

  if (error) {
    const raw = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
    if (raw.includes('PORTFOLIO_NOT_FOUND')) {
      throw new PortfolioWriteError('PORTFOLIO_NOT_FOUND', 'portfolio.setDefaultForUser', {
        portfolioId,
      });
    }
    throw new Error(`Failed to set default portfolio: ${error.message}`);
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  return toPortfolio(row ?? null);
}

// แก้ชื่อ/ประเภทพอร์ต — Scope ด้วย user_id เสมอ คืน null ถ้าไม่เจอ
// (id ผิด หรือเป็นของคนอื่น — สองกรณีนี้ต้องแยกไม่ออกจากมุมของผู้เรียก)
//
// ⚠️ ไม่เปิดให้แก้ is_default เด็ดขาด (เหตุผลเดียวกับ create)
async function updateByIdForUser(portfolioId, userId, patch) {
  requireUserId(userId, 'portfolio.updateByIdForUser');

  const update = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.type !== undefined) update.type = patch.type;
  update.updated_at = new Date().toISOString();

  const { data, error } = await queryForUser('portfolios', userId, (q) =>
    q.update(update).eq('id', portfolioId).select('*')
  );

  if (error) {
    throwIfConstraintViolation(error, 'portfolio.updateByIdForUser');
    throw new Error(`Failed to update portfolio: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [data].filter(Boolean);
  return toPortfolio(rows[0] ?? null);
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteByIdForUser — ลบพอร์ต (ไม่ใช่ลบสินทรัพย์/ธุรกรรม)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ นี่ไม่ใช่การละเมิดกฎเหล็ก "ห้ามลบข้อมูลผู้ใช้": พอร์ตเป็น "กล่องจัดหมวด"
// ที่ผู้ใช้ตั้งเอง ไม่ใช่ Ledger หรือประวัติธุรกรรม (Pattern เดียวกับ brokers)
// สินทรัพย์และธุรกรรมทุกแถวยังอยู่ครบ ไม่ถูกแตะแม้แถวเดียว
//
// ⚠️⚠️ **ห้ามพึ่ง ON DELETE SET NULL ของ FK เด็ดขาด** — assets.portfolio_id
// เป็น ON DELETE SET NULL จริง แต่ถ้าปล่อยให้ทำงาน สินทรัพย์ในพอร์ตที่ถูกลบจะ
// กลายเป็น portfolio_id = NULL ซึ่ง **ทำ Invariant ของ migration 044/045 พัง
// ทันที** ("สินทรัพย์ทุกแถวสังกัดพอร์ตเสมอ") แล้ว migration 045 ที่ใช้เป็น
// Health Check จะ RAISE EXCEPTION และโค้ดที่พึ่ง Invariant นี้จะเริ่มเพี้ยน
//
// Service จึงต้อง "ย้ายสินทรัพย์เข้าพอร์ต Default ก่อน" แล้วค่อยเรียกฟังก์ชันนี้
// (ดู portfolio.service.deletePortfolio) — ฟังก์ชันนี้ทำหน้าที่ลบแถวอย่างเดียว
async function deleteByIdForUser(portfolioId, userId) {
  requireUserId(userId, 'portfolio.deleteByIdForUser');

  const { data, error } = await queryForUser('portfolios', userId, (q) =>
    q.delete().eq('id', portfolioId).select('id')
  );

  if (error) {
    throw new Error(`Failed to delete portfolio: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [data].filter(Boolean);
  return rows.length;
}

// นับจำนวนพอร์ตของ user — ใช้ตรวจเพดานก่อนสร้างใหม่
async function countByUser(userId) {
  requireUserId(userId, 'portfolio.countByUser');

  const { count, error } = await queryForUser('portfolios', userId, (q) =>
    q.select('id', { count: 'exact', head: true })
  );

  if (error) {
    throw new Error(`Failed to count portfolios: ${error.message}`);
  }

  return count ?? 0;
}

module.exports = {
  PortfolioWriteError,
  findAllByUser,
  findByIdForUser,
  findDefaultByUser,
  create,
  setDefaultForUser,
  updateByIdForUser,
  deleteByIdForUser,
  countByUser,
};
