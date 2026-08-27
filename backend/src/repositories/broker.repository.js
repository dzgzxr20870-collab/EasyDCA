const { supabaseAdmin } = require('../config/supabase');
const { queryForUser, requireUserId } = require('../utils/ownership.util');

// ═══════════════════════════════════════════════════════════════════════════
// broker.repository — ตาราง brokers (migration 042)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ กฎเหล็กของไฟล์นี้: ทุก Query ที่ "อ่าน/แก้/ลบแถวที่มีอยู่แล้ว" ต้องผ่าน
// queryForUser('brokers', userId, ...) ไม่มีข้อยกเว้น — รวมถึง "หาโบรกด้วย id"
// ด้วย ห้าม .eq('id', id) เดี่ยวๆ เด็ดขาด (นี่คือรูปแบบช่องโหว่ที่
// pending_transactions เคยโดนมาแล้ว: id มาจากฝั่ง Client ที่ผู้ใช้กำหนดเองได้
// 100% ถ้าไม่เทียบ user_id ด้วย ผู้ใช้ A ที่ถือ brokerId ของ B จะอ่าน/แก้/ลบ
// ของ B ได้ทันที) — EasyDCA ไม่ได้เปิด RLS จริง Backend คือ Security Boundary
// เดียว (PROJECT_STATUS.md กฎยืนข้อ 3)
//
// ── ข้อยกเว้นเดียว: INSERT ─────────────────────────────────────────────────
// create() ใช้ supabaseAdmin ตรง ไม่ผ่าน queryForUser โดยเจตนา เพราะ
// queryForUser ทำงานด้วยการต่อ ".eq(user_id, ...)" ซึ่งเป็น "ตัวกรองแถวที่มี
// อยู่แล้ว" — ต่อเข้ากับ POST ของ PostgREST ไม่มีความหมาย (ไม่มีแถวให้กรอง)
// และเสี่ยงถูกตีความต่างจากที่คิด การกันข้ามบัญชีของ INSERT อยู่ที่ "ค่าที่ใส่ลง
// คอลัมน์ user_id" แทน ซึ่งบังคับด้วย requireUserId() + รับ userId จาก JWT
// เท่านั้น (ไม่เคยรับจาก Body/Query) — Pattern เดียวกับ supportRequest.repository
//
// Error ของชั้น Repository ตาม Pattern เดียวกับ AssetWriteError /
// LedgerWriteError: Repository ไม่ throw Error ของโดเมน Service ตรงๆ (กัน
// Circular Dependency) — Service เป็นคนแปลงเป็น Error ของตัวเอง

class BrokerWriteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrokerWriteError';
    this.code = code;
    this.details = details;
  }
}

// Postgres unique_violation — เกิดได้ทั้งจาก uniq_brokers_user_name_ci (ชื่อซ้ำ
// แบบไม่สนตัวพิมพ์) ตอน INSERT และตอน UPDATE เปลี่ยนชื่อไปชนของเดิม
const PG_UNIQUE_VIOLATION = '23505';
// Postgres check_violation — btrim(name) <> '' AND char_length(name) <= 60
const PG_CHECK_VIOLATION = '23514';

function toBroker(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// แปลง Error ของ Postgres ที่ "เป็นกติกาทางธุรกิจ" ให้เป็น BrokerWriteError
// ส่วน Error อื่นปล่อยผ่านให้ Caller โยนเป็น Error ทั่วไป (= ระบบพังจริง ต้อง 500)
function throwIfConstraintViolation(error, context) {
  if (error.code === PG_UNIQUE_VIOLATION) {
    throw new BrokerWriteError('BROKER_NAME_EXISTS', `${context}: broker name already exists`, {
      constraint: 'uniq_brokers_user_name_ci',
    });
  }
  if (error.code === PG_CHECK_VIOLATION) {
    throw new BrokerWriteError('INVALID_BROKER_NAME', `${context}: broker name failed DB CHECK`, {});
  }
}

async function findAllByUser(userId) {
  const { data, error } = await queryForUser('brokers', userId, (q) =>
    q.select('*').order('name', { ascending: true })
  );

  if (error) {
    throw new Error(`Failed to list brokers for user: ${error.message}`);
  }

  return (data ?? []).map(toBroker);
}

// หาโบรกด้วย id "ของ user คนนี้เท่านั้น" — คืน null ถ้าไม่มีจริงหรือเป็นของคนอื่น
// (Caller ต้องแปลง null เป็น 404 ไม่ใช่ 403 — ห้ามยืนยันการมีอยู่ของ resource
// ของผู้ใช้คนอื่นให้ผู้โจมตีรู้ ตาม Design Doc § 6.3)
//
// ⚠️ .maybeSingle() ต้องต่อ "นอก" queryForUser เสมอ เพราะ Helper เป็นคนต่อ
// .eq('user_id', ...) ปิดท้ายให้เอง (ดู Comment ใน ownership.util.js) — ถ้าเผลอ
// ปิดด้วย .maybeSingle() ข้างใน Builder จะไม่มีเมธอด .eq() ให้ Helper ต่อแล้ว
async function findByIdForUser(brokerId, userId) {
  requireUserId(userId, 'broker.findByIdForUser');

  const { data, error } = await queryForUser('brokers', userId, (q) =>
    q.select('*').eq('id', brokerId)
  ).maybeSingle();

  if (error) {
    throw new Error(`Failed to find broker by id: ${error.message}`);
  }

  return toBroker(data);
}

async function create(userId, name) {
  requireUserId(userId, 'broker.create');

  const { data, error } = await supabaseAdmin
    .from('brokers')
    // user_id มาจาก JWT ที่ requireAuth Verify แล้วเท่านั้น — ไม่เคยรับจาก Body
    .insert({ user_id: userId, name })
    .select('*')
    .single();

  if (error) {
    throwIfConstraintViolation(error, 'broker.create');
    throw new Error(`Failed to create broker: ${error.message}`);
  }

  return toBroker(data);
}

// เปลี่ยนชื่อโบรก — Scope ด้วย user_id เสมอผ่าน queryForUser คืน null ถ้าไม่เจอ
// (id ผิด หรือเป็นของคนอื่น — สองกรณีนี้ต้องแยกไม่ออกจากมุมของผู้เรียก)
async function updateName(brokerId, userId, name) {
  requireUserId(userId, 'broker.updateName');

  const { data, error } = await queryForUser('brokers', userId, (q) =>
    q.update({ name }).eq('id', brokerId).select('*')
  );

  if (error) {
    throwIfConstraintViolation(error, 'broker.updateName');
    throw new Error(`Failed to update broker: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [data].filter(Boolean);
  return toBroker(rows[0] ?? null);
}

// ═══════════════════════════════════════════════════════════════════════════
// anonymizeNamesForUser — ล้างชื่อโบรกตอน PDPA Erasure
// ═══════════════════════════════════════════════════════════════════════════
// `brokers.name` เป็นข้อความที่ผู้ใช้พิมพ์เอง จึงอาจมี PII จริง (เช่น "พอร์ตของสมชาย")
// และเป็น **ป้ายกำกับล้วน ไม่เข้าสูตรเงินสักสูตร** — เกราะ "Immutable Ledger" ที่ใช้
// ปกป้อง transactions ไม่ครอบตารางนี้ (มติ Founder 27 ส.ค. 2569)
//
// ⚠️ **เปลี่ยนชื่อ ไม่ใช่ DELETE** — ลบแถวจะทำให้ assets.broker_id กลายเป็น NULL
// (FK ON DELETE SET NULL) ซึ่งเท่ากับแก้ข้อมูลการลงทุนของผู้ใช้ · โครงสร้างต้องอยู่ครบ
// Pattern เดียวกับที่ userRepository.anonymize ทำกับ users
//
// 🔴⚠️ **ห้ามตั้งชื่อซ้ำกันทุกแถวเด็ดขาด** — ตารางนี้มี
//     uniq_brokers_user_name_ci ON (user_id, lower(name))     [migration 042]
// ผู้ใช้ที่มี 3 โบรกแล้วเปลี่ยนเป็น "โบรก" เหมือนกันหมด จะ **ชน UNIQUE →
// Erasure ล้มทั้งก้อน** และคนที่ยื่นคำขอลบข้อมูลตาม PDPA จะลบไม่ได้เลย
// → ต่อท้ายด้วย 8 ตัวแรกของ id (Hex ไม่ซ้ำกันแน่นอน และไม่ใช่ PII)
//
// อัปเดตทีละแถวโดยเจตนา: PostgREST อัปเดตด้วย "นิพจน์ที่อ้างคอลัมน์ของแถวนั้น"
// ไม่ได้ จึงคำนวณชื่อในชั้น App แล้วยิงทีละแถว (จำนวนโบรกต่อผู้ใช้น้อยมาก)
async function anonymizeNamesForUser(userId) {
  requireUserId(userId, 'broker.anonymizeNamesForUser');

  const brokers = await findAllByUser(userId);
  let count = 0;

  for (const broker of brokers) {
    const { error } = await queryForUser('brokers', userId, (q) =>
      q.update({ name: `โบรก ${String(broker.id).slice(0, 8)}` }).eq('id', broker.id)
    );

    if (error) {
      throw new Error(`Failed to anonymize broker names: ${error.message}`);
    }
    count += 1;
  }

  return count;
}

// ลบโบรก — Scope ด้วย user_id เสมอ คืนจำนวนแถวที่ถูกลบจริง (0 = ไม่ใช่ของ user)
//
// ⚠️ นี่ไม่ใช่การละเมิดกฎเหล็ก "ห้ามลบข้อมูลผู้ใช้": brokers เป็น "ป้ายกำกับที่
// ผู้ใช้ตั้งเอง" ไม่ใช่ Ledger หรือประวัติธุรกรรม (Pattern เดียวกับ dca_reminders
// ที่ DELETE ได้ปกติ) — และสินทรัพย์ที่ผูกอยู่ "ไม่หายไปไหนแม้แถวเดียว" เพราะ FK
// เป็น ON DELETE SET NULL (migration 042) แค่กลับไปเป็น "ไม่ระบุโบรก"
async function deleteByIdForUser(brokerId, userId) {
  requireUserId(userId, 'broker.deleteByIdForUser');

  const { data, error } = await queryForUser('brokers', userId, (q) =>
    q.delete().eq('id', brokerId).select('id')
  );

  if (error) {
    throw new Error(`Failed to delete broker: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [data].filter(Boolean);
  return rows.length;
}

module.exports = {
  BrokerWriteError,
  findAllByUser,
  findByIdForUser,
  create,
  updateName,
  anonymizeNamesForUser,
  deleteByIdForUser,
};
