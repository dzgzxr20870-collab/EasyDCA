-- ═══════════════════════════════════════════════════════════════════════
-- Migration 007 — bulk_import_sessions
-- ═══════════════════════════════════════════════════════════════════════
-- เก็บ "สถานะรอรับข้อความ Batch นำเข้าพอร์ต" (Phase 3 Round 6) — ผู้ใช้พิมพ์
-- "นำเข้าพอร์ต" (ข้อความที่ 1) → Bot อธิบาย Format → ผู้ใช้พิมพ์รายการหลายบรรทัด
-- เป็นข้อความถัดไป (ข้อความที่ 2) — ตารางนี้เป็นเพียง Flag บอกว่า "ข้อความ Text
-- ถัดไปของ User คนนี้ คือ Batch ที่ต้อง Parse" ไม่มี Step ย่อยเหมือน
-- dca_reminder_setup_sessions (migration 003) เพราะ Flow นี้มีขั้นตอนเดียว
--
-- เป็น "Working State ชั่วคราว" เช่นเดียวกับ pending_transactions (migration 001)
-- และ dca_reminder_setup_sessions (migration 003) — จึงเป็นข้อยกเว้นของกฎห้ามลบ
-- ข้อมูล (DATABASE.md § 8): ลบ/เขียนทับได้อิสระ ไม่ใช่ Ledger
--
-- ไม่แตะ pending_transactions / transactions เลย — ตัวข้อมูล Batch ที่ Parse
-- แล้วจะถูกเก็บเป็นแถว pending_transactions ปกติ (ผูกกันด้วย batch_id จาก
-- migration 008) ไม่ใช่ตารางนี้
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (updated_at trigger), § 9 (FK), § 10 (Index)
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE bulk_import_sessions (
  -- user_id เป็น PRIMARY KEY: 1 User รอส่ง Batch ได้แค่ 1 ครั้ง ณ ขณะหนึ่ง
  -- (พิมพ์ "นำเข้าพอร์ต" ซ้ำ = เขียนทับ TTL ใหม่ด้วย UPSERT)
  -- FK → users: RESTRICT ตาม § 9 (Pattern เดียวกับ pending_transactions.user_id)
  user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- updated_at ใช้เป็นฐานคำนวณ TTL (Sliding — Pattern เดียวกับ
  -- dca_reminder_setup_sessions) แม้ Flow นี้จะไม่มีการ "เดินขั้น" จริง
  -- (แค่สร้างแล้วรอข้อความถัดไป) แต่คงรูปแบบเดียวกันเพื่อความสม่ำเสมอ
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Cron Purge สแกนหา Session ที่ updated_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว)
CREATE INDEX idx_bulk_import_sessions_updated_at
  ON bulk_import_sessions(updated_at);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ pending_transactions / dca_reminder_setup_sessions
ALTER TABLE bulk_import_sessions ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON bulk_import_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
