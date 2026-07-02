-- ═══════════════════════════════════════════════════════════════════════
-- Migration 002 — dca_reminders
-- ═══════════════════════════════════════════════════════════════════════
-- เก็บการตั้งเตือน DCA ของผู้ใช้ (รายสัปดาห์/รายเดือน) — Cron รายวันจะ Push
-- ข้อความเตือนผ่าน LINE ให้ผู้ใช้ "ไปพิมพ์คำสั่งซื้อเอง" ไม่ได้ซื้อ/บันทึก
-- ธุรกรรมให้อัตโนมัติ (กันความเสี่ยงบันทึกผิดจากราคาตลาด ณ ขณะนั้น และตรงกับ
-- หลักการ PROJECT_BRIEF § 17 — ระบบไม่ตัดสินใจลงทุนแทนผู้ใช้)
--
-- ไม่แตะตาราง transactions เลย (Immutable Ledger — DATABASE.md § 8)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (updated_at trigger),
-- § 9 (FK Cascade), § 10 (Index)
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE dca_reminders (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 (ห้ามลบ user ที่ยังมีข้อมูลผูกอยู่)
  user_id            UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  symbol             TEXT          NOT NULL,

  frequency          TEXT          NOT NULL CHECK (frequency IN ('weekly', 'monthly')),

  -- day_of_week: 0=อาทิตย์ .. 6=เสาร์ (ใช้เมื่อ frequency='weekly')
  day_of_week        SMALLINT      CHECK (day_of_week BETWEEN 0 AND 6),

  -- day_of_month: 1-31 (ใช้เมื่อ frequency='monthly') — ถ้าเดือนนั้นไม่มีวันนั้น
  -- (เช่น 31 ในเดือน ก.พ.) App Layer จะเลื่อนไปวันสุดท้ายของเดือนแทน (ไม่เก็บ
  -- Logic นั้นที่ DB — เก็บค่าที่ผู้ใช้ตั้งไว้ตรงๆ)
  day_of_month       SMALLINT      CHECK (day_of_month BETWEEN 1 AND 31),

  -- จำนวนเงินที่ตั้งใจจะซื้อ — ใช้แสดงในข้อความเตือนเท่านั้น ไม่ได้บันทึกธุรกรรม
  amount_thb         NUMERIC(15,2) NOT NULL CHECK (amount_thb > 0),

  active             BOOLEAN       NOT NULL DEFAULT true,

  -- วันที่ Push ล่าสุด (Asia/Bangkok) — กันการแจ้งเตือนซ้ำในวันเดียวกัน
  last_notified_date DATE,

  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── Integrity Guard ─────────────────────────────────────────────────
  -- weekly ต้องมี day_of_week (ไม่มี day_of_month) และ monthly ต้องมี
  -- day_of_month (ไม่มี day_of_week) — จับ Bug ถ้า App ส่งค่าไม่ครบ/สลับ
  CONSTRAINT dca_reminders_day_consistency CHECK (
    (frequency = 'weekly'  AND day_of_week  IS NOT NULL AND day_of_month IS NULL) OR
    (frequency = 'monthly' AND day_of_month IS NOT NULL AND day_of_week  IS NULL)
  )
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Rule 1: FK Column ต้องมี Index (เร่ง Query "reminder ของ user นี้")
CREATE INDEX idx_dca_reminders_user_id
  ON dca_reminders(user_id);

-- Rule 3: Partial Index ให้ Cron สแกนเฉพาะ reminder ที่ยัง Active (Subset เล็ก)
CREATE INDEX idx_dca_reminders_active_notify
  ON dca_reminders(last_notified_date)
  WHERE active = true;

-- บังคับ "1 reminder ที่ Active ต่อ (user, symbol)" ที่ระดับ DB — สอดคล้องกับ
-- createReminder ที่ปิดตัวเก่า (active=false) ก่อนสร้างใหม่ กันข้อมูลซ้ำซ้อน
-- และกัน Race Condition ที่สร้างซ้อนสองอันพร้อมกัน
CREATE UNIQUE INDEX idx_dca_reminders_one_active
  ON dca_reminders(user_id, symbol)
  WHERE active = true;

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ pending_transactions: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon เลย — LINE Bot Flow เข้าถึงผ่าน supabaseAdmin (service role)
ALTER TABLE dca_reminders ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON dca_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
