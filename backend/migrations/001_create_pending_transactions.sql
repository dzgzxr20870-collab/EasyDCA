-- ═══════════════════════════════════════════════════════════════════════
-- Migration 001 — pending_transactions
-- ═══════════════════════════════════════════════════════════════════════
-- เก็บธุรกรรมที่ Parse แล้วแต่ "รอ Confirm" จากผู้ใช้ (SRS.md § 2.3 [4-6])
-- Flow ใหม่: BUY/SELL แสดง Preview + ปุ่ม [ยืนยัน]/[แก้ไข]/[ยกเลิก] ก่อน
-- ค่อยบันทึกลง transactions จริงเมื่อผู้ใช้กดยืนยัน
--
-- เป็น "Working State ชั่วคราว" ของ LINE Bot Flow — เทียบเท่า Redis/Memory
-- cache ที่ SRS § 2.3 [5] ระบุไว้เดิม แต่ใช้ตาราง Postgres เพื่อให้ทน
-- Restart/Multi-instance และรองรับ LINE Postback ที่มาคนละ Request กับตอน
-- สร้าง Preview (replyToken เดิมหมดอายุแล้ว)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 8 (Soft Delete — ตารางนี้เป็น
-- ข้อยกเว้นที่ลบจริงได้), § 9 (FK Cascade), § 10 (Index)
-- Dependency: ฟังก์ชัน update_updated_at() ต้องถูกสร้างไว้แล้วจาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE pending_transactions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 (ห้ามลบ user ที่ยังมีข้อมูลผูกอยู่)
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- FK → portfolios: SET NULL ตาม § 9 (ผู้ใช้ลบพอร์ตได้ ไม่ควรถูกบล็อค
  -- เพราะมี Pending ค้าง — เหตุผลเดียวกับ assets.portfolio_id)
  -- nullable เพราะ Free Plan ไม่มี Multiple Portfolio
  portfolio_id    UUID          REFERENCES portfolios(id) ON DELETE SET NULL,

  -- ── ข้อมูลธุรกรรมที่ Parse แล้ว (Snapshot ณ ตอนกดสั่ง) ────────────────
  command_type    TEXT          NOT NULL CHECK (command_type IN ('buy', 'sell')),

  -- เก็บ symbol/name/type ของ Asset แยกไว้ในแถว — ไม่ทำ FK ไป assets โดย
  -- เจตนา เพราะกรณี BUY Asset ใหม่ Asset ยังไม่ถูกสร้างตอน Preview (เลี่ยง
  -- Chicken-and-egg: Pending คือขั้นก่อนสร้าง Asset) ตอน Confirm ค่อยใช้
  -- ค่าเหล่านี้ค้น/สร้าง Asset จริง
  asset_symbol    TEXT          NOT NULL,
  asset_name      TEXT,         -- ใช้ตอนสร้าง Asset ใหม่ (ถ้า NULL → default = symbol)

  -- asset_type: จำเป็นเฉพาะกรณี BUY + Asset ใหม่; SELL หรือ Asset เดิม = NULL
  -- ไม่บังคับ NOT NULL แบบมีเงื่อนไขที่ระดับ DB ได้ (เพราะ "Asset ใหม่หรือไม่"
  -- ไม่อยู่ในแถวนี้) — บังคับที่ App Layer ตาม Logic เดิมใน transaction.service
  -- ที่ throw VALIDATION_ERROR อยู่แล้ว
  asset_type      TEXT          CHECK (asset_type IN ('crypto', 'stock_th', 'stock_us', 'etf', 'fund')),

  -- Precision ตรงกับ transactions ทุก Column (§ 2 transactions)
  quantity        NUMERIC(20,8) NOT NULL CHECK (quantity > 0),
  price_per_unit  NUMERIC(20,8) NOT NULL CHECK (price_per_unit > 0),
  amount_thb      NUMERIC(15,2) NOT NULL CHECK (amount_thb > 0),
  fee_thb         NUMERIC(10,2) NOT NULL DEFAULT 0,
  txn_date        DATE          NOT NULL,  -- วันที่ทำธุรกรรม (Asia/Bangkok ณ ตอน Parse)

  -- ── สถานะ + วงจรชีวิต ────────────────────────────────────────────────
  status          TEXT          NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),

  -- Timeout 5 นาที (SRS § 2.3 [5]) — คำนวณที่ DB ตอน INSERT ให้ Deterministic
  expires_at      TIMESTAMPTZ   NOT NULL DEFAULT (now() + interval '5 minutes'),

  -- เวลาที่ออกจากสถานะ 'pending' (ถูก confirm/cancel/expire)
  resolved_at     TIMESTAMPTZ,

  -- ผลลัพธ์เมื่อ Confirm สำเร็จ — Traceability: pending นี้กลายเป็น transaction ไหน
  -- SET NULL ตาม § 9 (transactions ไม่เคยถูกลบจริงตามกฎห้ามลบอยู่แล้ว จึงเป็น
  -- เพียง Safety Net)
  transaction_id  UUID          REFERENCES transactions(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── Integrity Guards ────────────────────────────────────────────────
  -- resolved_at ต้องถูกเซ็ตพอดีตอนออกจาก 'pending' (จับ Bug ถ้า App ลืมเซ็ต)
  CONSTRAINT pending_tx_resolved_at_consistency CHECK (
    (status = 'pending'  AND resolved_at IS NULL) OR
    (status <> 'pending' AND resolved_at IS NOT NULL)
  ),

  -- transaction_id ผูกได้เฉพาะแถวที่ confirm สำเร็จเท่านั้น
  CONSTRAINT pending_tx_txn_id_only_when_confirmed CHECK (
    transaction_id IS NULL OR status = 'confirmed'
  )
);

-- หมายเหตุ Concurrency: ไม่มี Unique Constraint บังคับ "1 pending ต่อ user"
-- โดยเจตนา — อนุญาตให้มี Pending หลายรายการพร้อมกันต่อ User (เช่นผู้ใช้พิมพ์
-- 2 คำสั่งซ้อนก่อนกดยืนยัน) เพราะ LINE Postback จะพก pending id เฉพาะเจาะจง
-- กลับมา ทำให้ Confirm/Cancel ระบุแถวได้ตรงตัวอยู่แล้ว

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Rule 1: FK Column ต้องมี Index (เร่ง Query "pending ของ user นี้")
CREATE INDEX idx_pending_transactions_user_id
  ON pending_transactions(user_id);

-- Rule 3: Partial Index ให้ Cron หา row ที่หมดอายุแล้วแต่ยังค้าง pending
CREATE INDEX idx_pending_transactions_expiry
  ON pending_transactions(expires_at)
  WHERE status = 'pending';

-- Rule 1 + 3: FK Index แบบ Partial (Free Plan portfolio_id = NULL เป็นส่วนใหญ่)
CREATE INDEX idx_pending_transactions_portfolio_id
  ON pending_transactions(portfolio_id)
  WHERE portfolio_id IS NOT NULL;

CREATE INDEX idx_pending_transactions_transaction_id
  ON pending_transactions(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- ตาม Pattern audit_logs / system_logs: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon เลย เข้าถึงได้เฉพาะ service_role (LINE Webhook Backend)
-- เหตุผล: เป็น Working State ภายในของ LINE Bot Flow ล้วนๆ ไม่แสดงบน Web
-- Dashboard และ LINE User ไม่มี auth.uid() session — Backend อ่าน/เขียน
-- ผ่าน supabaseAdmin (service role) อยู่แล้วเหมือนทุก Query ใน LINE Flow
ALTER TABLE pending_transactions ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
-- ใช้ฟังก์ชัน update_updated_at() ที่นิยามไว้แล้วใน DATABASE.md § 4
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON pending_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
