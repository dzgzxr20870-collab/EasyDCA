// ═══════════════════════════════════════════════════════════════════════════
// Ownership Guard + Data Access Helper กลาง
// ═══════════════════════════════════════════════════════════════════════════
// เกิดจาก Security Audit (Cross-User Isolation): EasyDCA ใช้ service_role key
// และไม่ได้เปิด RLS — Database ไม่ตรวจสิทธิ์ให้เลย ทุกการกันข้อมูลข้ามบัญชีอยู่ที่
// โค้ด Backend ล้วนๆ (กฎยืน PROJECT_STATUS.md ข้อ 3 "Backend คือ Security
// Boundary เดียว — ทุก Query กรอง userId")
//
// ปัญหาที่ Audit รอบแรกเจอ: ตาราง pending_transactions ถูก Query ด้วย `id` ที่มา
// จาก LINE Postback ตรงๆ โดยไม่เคยเทียบ user_id เลย — ผู้ใช้ที่ถือ pendingId ของ
// คนอื่นสั่งยืนยัน/ยกเลิกธุรกรรมของคนอื่นได้ และรายละเอียดธุรกรรมของเหยื่อ (symbol,
// จำนวน, ยอดเงิน, ยอดคงเหลือในพอร์ต) ถูกตอบกลับไปในแชทของผู้โจมตี — แก้ด้วย
// requireUserId() ตรงๆ ในแต่ละจุด (pendingTransaction.repository.js)
//
// รอบที่สอง (นี้): สร้าง Helper กลางที่ requireUserId() เป็นส่วนประกอบ ให้ 8 จุด
// สีส้มที่เหลือ (ปลอดภัยอยู่เพราะวินัยของ Caller ไม่ใช่โครงสร้างบังคับ) ย้ายมาใช้
//
// ⚠️ กฎเหล็กของไฟล์นี้: ห้าม Silent Default ทุกรูปแบบ — โดยเฉพาะ "ไม่มี userId
// = ดึงทั้งหมด" ซึ่งเป็นรูปแบบความผิดพลาดที่อันตรายที่สุด ถ้า userId ว่าง/null/
// undefined ต้อง "พัง" ทันทีและดังที่สุด ไม่ใช่เงียบแล้วคืนข้อมูลของทุกคน
const { supabaseAdmin } = require('../config/supabase');

class OwnershipError extends Error {
  constructor(code, message, context) {
    super(message);
    this.name = 'OwnershipError';
    this.code = code;
    this.context = context;
  }
}

// คืน userId เดิมถ้าใช้ได้ / throw ถ้าไม่มีหรือไม่ใช่ String ที่มีเนื้อหา
//
// เช็คชนิดด้วย (ไม่ใช่แค่ Falsy) เพราะ userId ที่หลุดมาเป็น object/number จาก
// การ Refactor ผิดจุดจะทำให้ PostgREST เทียบ user_id ไม่ตรงกับใครเลยแล้ว "คืน
// ผลว่าง" อย่างเงียบๆ ซึ่งอ่านเหมือนไม่มีข้อมูลจริง — ปิดบังบั๊กแทนที่จะเปิดเผย
//
// context = ชื่อจุดที่เรียก (เช่น 'pendingTransaction.claimForConfirm') เพื่อให้
// Log/Stack ชี้ตรงไปที่ Query ที่ลืมใส่ ไม่ต้องไล่หาเอง
function requireUserId(userId, context) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new OwnershipError(
      'MISSING_USER_ID',
      `${context}: userId is required and must be a non-empty string ` +
        `(got ${userId === null ? 'null' : typeof userId}) — refusing to run an ` +
        'unscoped query on user-owned data',
      context
    );
  }

  return userId;
}

// ═══════════════════════════════════════════════════════════════════════════
// Table Registry — รายชื่อตารางที่เดียว บอกว่าตารางไหน "เป็นของ User" (ต้องผ่าน
// queryForUser) กับตารางไหนมีเหตุผลข้าม User ได้โดยเจตนา (queryAcrossUsers)
// ═══════════════════════════════════════════════════════════════════════════
// ครอบทุกตารางที่มีอยู่จริง (จาก docs/DATABASE.md § 2) ไม่ใช่แค่ 8 จุดที่ Audit
// รอบนี้แก้ — กันไม่ให้ตารางใหม่ในอนาคตหลุด Pattern แบบที่ pending_transactions
// เคยหลุดมาก่อน (เพิ่มตารางใหม่ = ต้องมาลงทะเบียนที่นี่ก่อน ไม่งั้น queryForUser/
// queryAcrossUsers จะ throw UNKNOWN_TABLE ทันที)
//
// ownedColumn: null = ไม่ใช่ตารางที่มีแนวคิด "เป็นของ User รายคน" ผ่าน Foreign
// Key คอลัมน์เดียว (เช่น users เอง — Row "คือ" User ไม่ใช่ "ของ" User, หรือ Log
// ของระบบ/Admin ที่ไม่ผูกกับ User ที่ถูกกระทำ) — queryForUser ใช้กับตารางกลุ่มนี้
// ไม่ได้ ต้องใช้ queryAcrossUsers เท่านั้น
const TABLE_REGISTRY = Object.freeze({
  // ── User-owned — มี user_id ชี้ผู้ใช้เจ้าของแถวจริง ─────────────────────────
  transactions: { ownedColumn: 'user_id' },
  assets: { ownedColumn: 'user_id' },
  payments: { ownedColumn: 'user_id' },
  pending_transactions: { ownedColumn: 'user_id' }, // บังคับผ่าน requireUserId() ตรงในไฟล์ตัวเองอยู่แล้ว (Audit รอบแรก) — ลงทะเบียนไว้เพื่อความครบถ้วน ไม่ได้ Refactor ให้ผ่าน Helper นี้ซ้ำ
  dca_reminders: { ownedColumn: 'user_id' },
  dca_reminder_setup_sessions: { ownedColumn: 'user_id' },
  guided_buy_sessions: { ownedColumn: 'user_id' },
  bulk_import_sessions: { ownedColumn: 'user_id' },
  ai_ocr_usage: { ownedColumn: 'user_id' },
  premium_grant_logs: { ownedColumn: 'user_id' },
  facebook_like_grant_requests: { ownedColumn: 'user_id' },
  support_requests: { ownedColumn: 'user_id' },
  portfolio_snapshots: { ownedColumn: 'user_id' },
  erasure_logs: { ownedColumn: 'user_id' },
  // เอกสารไว้ใน DATABASE.md § 2 แล้ว (มี user_id NOT NULL) แต่ยังไม่มี Repository
  // Code จริงในระบบ — ลงทะเบียนล่วงหน้ากัน Session ในอนาคตเขียน Repository ใหม่
  // แล้วลืมผ่าน Helper (นี่คือเจตนาของข้อ "ครอบทุกตารางที่มีอยู่")
  portfolios: { ownedColumn: 'user_id' },
  goals: { ownedColumn: 'user_id' },
  notifications: { ownedColumn: 'user_id' },
  user_settings: { ownedColumn: 'user_id' },
  watchlists: { ownedColumn: 'user_id' },

  // ── Cross-user โดยเจตนา — ไม่มีแนวคิด "เป็นของ User รายคนเดียว" ─────────────
  users: { ownedColumn: null }, // Row "คือ" User เอง (Self-keyed by id) ไม่ใช่ "ของ" User อื่น — findById(ownId) ไม่ใช่ Cross-user Pattern แบบตารางอื่น ส่วน findAll() (Admin) ใช้ queryAcrossUsers
  line_webhook_events: { ownedColumn: null }, // Keyed ด้วย event_id เพื่อ Idempotency ล้วนๆ ไม่มีแนวคิดผู้ใช้เจ้าของ
  broadcast_logs: { ownedColumn: null }, // sent_by = Admin ที่ Broadcast ไม่ใช่ "เจ้าของ" แถว
  audit_logs: { ownedColumn: null }, // admin_id = Admin ที่ทำ Action, target_id ทั่วไปอาจไม่ใช่ user เสมอ — เอกสารไว้แล้วแต่ยังไม่มี Repository จริง
  system_logs: { ownedColumn: null }, // user_id Nullable — เป็น Log ของระบบเป็นหลัก ไม่ใช่ตารางข้อมูลของ User
});

// Enum เหตุผลที่อนุญาตให้ Query ข้าม User ได้ — เป็น String อิสระไม่ได้ (พิมพ์ผิด/
// เดาเอาไม่ได้) ต้องเลือกจากรายการนี้เท่านั้น
//   - 'admin'           Route ผ่าน requireAdmin แล้ว (Admin Dashboard)
//   - 'cron'            Background Job บน worker — ไม่มี HTTP Surface
//   - 'system-table'    ตารางที่ไม่มีแนวคิด "เจ้าของเป็น User" ตั้งแต่ต้น (Log/Idempotency)
//   - 'fraud-check'     ตรวจจับการโกงข้าม User โดยเจตนา (เช่น สลิปซ้ำ)
//   - 'public-endpoint' Endpoint ที่เปิด Public จริงตามดีไซน์ (ไม่มี Session ผู้ใช้เลย
//                       เช่น LINE ต้อง Fetch รูป QR โดยไม่มี Authorization Header)
//                       — ต้องมั่นใจว่าข้อมูลที่คืนไม่มี PII/ตัวเลขที่ Sensitive
const VALID_CROSS_USER_REASONS = Object.freeze([
  'admin',
  'cron',
  'system-table',
  'fraud-check',
  'public-endpoint',
]);

function assertKnownTable(table, helperName) {
  const entry = TABLE_REGISTRY[table];
  if (!entry) {
    throw new OwnershipError(
      'UNKNOWN_TABLE',
      `${helperName}('${table}'): table is not registered in TABLE_REGISTRY ` +
        '(utils/ownership.util.js) — เพิ่มตารางนี้เข้า Registry ก่อน พร้อมระบุว่า ' +
        'เป็น User-owned (ownedColumn) หรือ Cross-user โดยเจตนา (ownedColumn: null)',
      table
    );
  }
  return entry;
}

// ═══════════════════════════════════════════════════════════════════════════
// queryForUser(table, userId, buildQuery) — ทางเข้า Query ข้อมูล "ของ User" เดียว
// ═══════════════════════════════════════════════════════════════════════════
// buildQuery รับ Query Builder ที่ยังไม่ผ่าน .from() มาให้ (จาก supabaseAdmin.from
// (table)) แล้วต้องคืน Builder หลัง .select()/.update()/.delete() + Filter อื่นๆ
// ของ Caller เอง (เช่น .eq('id', id)) — queryForUser จะต่อ .eq(ownedColumn, userId)
// "หลังสุดเสมอ" ก่อนคืนให้ Caller ไปต่อ .order()/.single()/.maybeSingle() เอง
//
// จุดสำคัญ: การกรอง userId ทำ "ที่นี่ที่เดียว" ไม่ใช่ให้ Caller ต้องจำไปเขียน
// .eq('user_id', userId) เอง — Caller ทำ Query อะไรก็ได้ใน buildQuery แต่ไม่มีทาง
// "ลืม" ใส่ userId เพราะ Helper เป็นคนต่อให้เองเสมอ โครงสร้างบังคับ ไม่ใช่วินัย
//
// ตัวอย่าง:
//   const { data, error } = await queryForUser('transactions', userId, (q) =>
//     q.select('*').eq('asset_id', assetId).order('date', { ascending: true })
//   );
function queryForUser(table, userId, buildQuery) {
  requireUserId(userId, `queryForUser(${table})`);

  const entry = assertKnownTable(table, 'queryForUser');
  if (!entry.ownedColumn) {
    throw new OwnershipError(
      'NOT_USER_OWNED_TABLE',
      `queryForUser('${table}'): table is registered as cross-user only ` +
        `(ownedColumn: null) — ใช้ queryAcrossUsers('${table}', reason) แทน`,
      table
    );
  }

  return buildQuery(supabaseAdmin.from(table)).eq(entry.ownedColumn, userId);
}

// ═══════════════════════════════════════════════════════════════════════════
// queryAcrossUsers(table, reason) — ทางเข้า Query ข้าม User โดยเจตนา
// ═══════════════════════════════════════════════════════════════════════════
// ไม่มีการกรอง userId ใดๆ (Caller ควบคุม Filter เองทั้งหมด) — จงใจแยกชื่อฟังก์ชัน
// จาก queryForUser ชัดเจน (ไม่ใช่ Flag ในอาร์กิวเมนต์เดียวกัน) เพื่อให้ grep หา
// ทุกจุดที่ข้าม User ได้ทันที และ reason ต้องอยู่ใน Enum ที่กำหนดไว้ล่วงหน้าเท่านั้น
// (กันเหตุผลลอยๆ ที่พิมพ์อะไรก็ได้ ตรวจสอบไม่ได้จริง)
//
// ตัวอย่าง:
//   const { data, error } = await queryAcrossUsers('payments', 'fraud-check')
//     .select('*').eq('slip_hash', slipHash).eq('status', 'confirmed').maybeSingle();
function queryAcrossUsers(table, reason) {
  if (!VALID_CROSS_USER_REASONS.includes(reason)) {
    throw new OwnershipError(
      'INVALID_CROSS_USER_REASON',
      `queryAcrossUsers('${table}'): reason '${reason}' is not a valid enum value ` +
        `(ต้องเป็นหนึ่งใน: ${VALID_CROSS_USER_REASONS.join(', ')})`,
      table
    );
  }

  assertKnownTable(table, 'queryAcrossUsers');

  return supabaseAdmin.from(table);
}

module.exports = {
  requireUserId,
  queryForUser,
  queryAcrossUsers,
  OwnershipError,
  TABLE_REGISTRY,
  VALID_CROSS_USER_REASONS,
};
