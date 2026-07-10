-- ═══════════════════════════════════════════════════════════════════════
-- Migration 011 — ai_ocr_usage (Phase 3 Round 9 — AI Slip OCR)
-- ═══════════════════════════════════════════════════════════════════════
-- นับโควตาการใช้ "อ่านสลิปด้วย AI" ของผู้ใช้ Premium รายเดือน (50 ครั้ง/เดือน/user)
-- นับตามเดือนปฏิทิน Asia/Bangkok (year_month = 'YYYY-MM' ที่ App คำนวณผ่าน
-- thaiDate.util.bangkokYearMonth เดียวกับ Admin Dashboard Round 4b)
--
-- ⚠️ นับเฉพาะ "การอ่านที่สำเร็จและส่ง Preview ให้ผู้ใช้เห็นแล้ว" เท่านั้น (จุดตัดคือ
-- อ่านสำเร็จ ไม่ใช่ผู้ใช้กดยืนยันบันทึก) — Error/ไม่ใช่สลิป/หลายรายการ ไม่ Increment
-- (Logic นี้อยู่ที่ slipOcr.service — Migration นี้แค่เตรียม Schema + ฟังก์ชัน Atomic)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (updated_at trigger), § 9 (FK RESTRICT),
-- § 10 (Index) — Pattern เดียวกับ migration 004 (payments) / 002 (dca_reminders)
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE ai_ocr_usage (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 (ห้ามลบ user ที่ยังมีข้อมูลผูกอยู่)
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- เดือนปฏิทิน Asia/Bangkok รูปแบบ 'YYYY-MM' (ค.ศ.) เช่น '2026-07'
  year_month   TEXT        NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),

  -- จำนวนครั้งที่อ่านสลิปสำเร็จในเดือนนั้น (Increment แบบ Atomic ผ่านฟังก์ชันด้านล่าง)
  count        INTEGER     NOT NULL DEFAULT 0 CHECK (count >= 0),

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 1 แถวต่อ (user, เดือน) — เป็นคีย์ที่ฟังก์ชัน Upsert ใช้จับคู่เพื่อ +1
  UNIQUE (user_id, year_month)
);

-- ── Index (§ 10) — Query หลัก: โควตาของ user นี้ในเดือนนี้ ────────────────
-- (UNIQUE ด้านบนสร้าง Index ให้อยู่แล้ว แต่ประกาศชื่อชัดเจนเพื่อความอ่านง่าย)
CREATE INDEX idx_ai_ocr_usage_user_month ON ai_ocr_usage(user_id, year_month);

-- ── Atomic Increment (กัน Race Condition แทน Read-Modify-Write ในชั้น App) ──
-- INSERT ... ON CONFLICT DO UPDATE count = count + 1 ทำงานเป็น Statement เดียวที่ DB
-- การันตี Atomic แม้มีหลาย Request พร้อมกัน คืน "count ใหม่" หลังบวกแล้ว
-- Repository เรียกผ่าน supabaseAdmin.rpc('increment_ai_ocr_usage', {...})
CREATE OR REPLACE FUNCTION increment_ai_ocr_usage(p_user_id UUID, p_year_month TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO ai_ocr_usage (user_id, year_month, count)
  VALUES (p_user_id, p_year_month, 1)
  ON CONFLICT (user_id, year_month)
  DO UPDATE SET count = ai_ocr_usage.count + 1, updated_at = now()
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ payments/dca_reminders: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
ALTER TABLE ai_ocr_usage ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON ai_ocr_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
