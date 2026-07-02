-- ═══════════════════════════════════════════════════════════════════════
-- Migration 003 — dca_reminder_setup_sessions
-- ═══════════════════════════════════════════════════════════════════════
-- เก็บ "สถานะการตั้งเตือน DCA แบบสนทนาหลายขั้นตอน" (Quick Reply Flow) ที่ผู้ใช้
-- กำลังทำอยู่ ณ ขณะหนึ่ง — เป็น Ephemeral Working State เหมือน pending_transactions
-- (migration 001) จึงเป็นข้อยกเว้นของกฎห้ามลบข้อมูล (DATABASE.md § 8): ลบ/เขียนทับ
-- ได้อิสระ ไม่ใช่ Ledger
--
-- Flow: กดปุ่ม "⏰ ตั้งเตือน DCA" → เลือก Symbol → เลือกความถี่ → เลือกวัน →
-- พิมพ์จำนวนเงิน → จบด้วยการเรียก dcaReminder.service.createReminder() (ของเดิม)
-- แล้วลบ Session ทิ้ง ตัวตารางนี้ "ไม่สร้าง Reminder เอง" — เก็บแค่ State ระหว่างทาง
--
-- ไม่แตะตาราง dca_reminders / transactions เลย
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (updated_at trigger), § 9 (FK), § 10 (Index)
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE dca_reminder_setup_sessions (
  -- user_id เป็น PRIMARY KEY: 1 User มีได้แค่ 1 Session ที่กำลังตั้งอยู่ ณ ขณะหนึ่ง
  -- (เริ่ม Flow ใหม่ = เขียนทับของเก่าด้วย UPSERT ไม่ให้ 2 Session ปนกัน)
  -- FK → users: RESTRICT ตาม § 9 (Pattern เดียวกับ pending_transactions.user_id)
  user_id       UUID          PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,

  -- ขั้นตอนปัจจุบันของ State Machine (reminderSetupFlow.service)
  step          TEXT          NOT NULL CHECK (step IN (
                  'AWAITING_SYMBOL', 'AWAITING_FREQUENCY', 'AWAITING_DAY', 'AWAITING_AMOUNT'
                )),

  -- ข้อมูลที่สะสมระหว่างทาง (ค่อยๆ เติมทีละขั้น จึง nullable ทั้งหมด)
  symbol        TEXT,
  frequency     TEXT          CHECK (frequency IN ('weekly', 'monthly')),
  day_of_week   SMALLINT      CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month  SMALLINT      CHECK (day_of_month BETWEEN 1 AND 31),

  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- updated_at ถูก Bump ทุกครั้งที่เดินขั้นถัดไป (Trigger ด้านล่าง) — ใช้เป็นฐาน
  -- คำนวณ TTL แบบ Sliding 5 นาที (นับจากกิจกรรมล่าสุด ไม่ใช่ตอนสร้าง) เพื่อให้
  -- ผู้ใช้มีเวลาในแต่ละขั้นพอสมควร และเป็นตัวชี้วัดว่า Session ควรถูก Purge เมื่อไร
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Cron Purge สแกนหา Session ที่ updated_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว)
-- และ getCurrentSession กรอง Session ที่ยังไม่หมดอายุด้วย updated_at เช่นกัน
CREATE INDEX idx_dca_reminder_setup_sessions_updated_at
  ON dca_reminder_setup_sessions(updated_at);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ pending_transactions: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon เลย — LINE Bot Flow เข้าถึงผ่าน supabaseAdmin (service role)
ALTER TABLE dca_reminder_setup_sessions ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON dca_reminder_setup_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
