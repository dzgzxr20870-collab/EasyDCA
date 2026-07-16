-- ═══════════════════════════════════════════════════════════════════════
-- Migration 019 — erasure_logs
-- ═══════════════════════════════════════════════════════════════════════
-- Audit Trail สำหรับคำขอลบข้อมูลตาม PDPA (Self-Service ผ่าน LINE Chat — ดู
-- migration 018 / userErasure.service.js) — บันทึกว่าใคร (user_id) ถูก Anonymize
-- เมื่อไร และ ณ ตอนนั้นมี Payment ที่ยังไม่ Resolve ค้างอยู่ไหม (had_pending_payment
-- — สำคัญเผื่อ Admin ต้องสืบย้อนหลังว่าทำไมถึงตรวจสอบ Payment รายการหนึ่งไม่ได้
-- อีกต่อไปว่าเป็นของใคร)
--
-- Migration นี้ทำแค่ "Schema" — Repository ที่เขียนตารางนี้อยู่คนละไฟล์
-- (erasureLog.repository.js / userErasure.service.js รอบเดียวกัน)
--
-- erasure_logs — Append-only Log (1 แถวต่อ 1 ครั้งที่ Anonymize สำเร็จ) ไม่มี
-- UPDATE/DELETE จึงไม่มี updated_at/trigger (Pattern เดียวกับ broadcast_logs —
-- migration 006 — ที่เป็น Append-only Log เช่นกัน)
--
-- user_id เป็น FK จริง (ต่างจาก broadcast_logs.sent_by ที่เป็น TEXT ดิบ) เพราะ
-- users Row "ไม่เคยถูกลบทิ้ง" แม้จะถูก Anonymize แล้ว (Anonymize = แก้ไขข้อมูลใน
-- แถวเดิม ไม่ใช่ DELETE) FK นี้จึงไม่มีทาง Dangling/Orphan แม้ผ่านไปนานแค่ไหน
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 9 (FK RESTRICT), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ── erasure_logs (Append-only) ──────────────────────────────────────────
CREATE TABLE erasure_logs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 — users Row ไม่เคยถูก DELETE จริง (Anonymize
  -- เท่านั้น) FK นี้จึงอ้างอิงได้เสมอไม่มี Orphan
  user_id               UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- มี Payment ที่ยังไม่ Resolve ค้างอยู่ตอนที่ Anonymize ไหม (Admin สืบย้อนหลังได้
  -- ว่าทำไมถึงตรวจสอบ Payment รายการนั้นไม่ได้อีกต่อไปว่าเป็นของใคร)
  had_pending_payment   BOOLEAN       NOT NULL DEFAULT false,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query หลัก: "ประวัติการลบข้อมูลล่าสุด" (ใหม่→เก่า) เผื่อ Admin ตรวจสอบย้อนหลัง
CREATE INDEX idx_erasure_logs_created_at
  ON erasure_logs (created_at DESC);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ broadcast_logs/payments: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
ALTER TABLE erasure_logs ENABLE ROW LEVEL SECURITY;
