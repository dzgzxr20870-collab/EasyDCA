-- ═══════════════════════════════════════════════════════════════════════
-- Migration 006 — broadcast_logs
-- ═══════════════════════════════════════════════════════════════════════
-- Phase 3 (Round 4c): Admin Broadcast — Log ทุกครั้งที่ Admin กดส่งข้อความ
-- ประชาสัมพันธ์ (Push) หาผู้ใช้จำนวนมาก เพื่อเป็น Audit Trail (ส่งอะไร/หากลุ่มไหน/
-- ใครส่ง/สำเร็จกี่คน) — สอดคล้อง PROJECT_BRIEF § 7 Phase 3 (Broadcast Message +
-- Audit Log)
--
-- Migration นี้ทำแค่ "Schema" — Repository/Service ที่เขียนตารางนี้อยู่ในไฟล์แยก
-- (broadcastLog.repository.js / broadcast.service.js) รอบเดียวกัน
--
-- broadcast_logs — Append-only Log (1 แถวต่อ 1 ครั้งที่กดส่ง) ไม่มี UPDATE/DELETE
-- จึงไม่มี updated_at/trigger (Pattern เดียวกับ portfolio_snapshots ที่มีแต่ created_at)
--
-- sent_by เก็บ LINE User ID ของ Admin แบบ TEXT (Audit Trail) ไม่ทำ FK → users
-- เพราะเป็น Identifier ดิบของผู้กดส่ง (Pattern เดียวกับ payments.confirmed_by)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ── broadcast_logs (Append-only) ───────────────────────────────────────
CREATE TABLE broadcast_logs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- LINE User ID ของ Admin ที่กดส่ง (Audit Trail — ไม่ FK เหมือน payments.confirmed_by)
  sent_by           TEXT          NOT NULL,

  -- กลุ่มเป้าหมายที่เลือกส่ง
  target_group      TEXT          NOT NULL CHECK (target_group IN ('all', 'free', 'premium')),

  -- ประเภทข้อความ (ใช้จัด Template ฝั่ง UI + จัดหมวดใน Log)
  message_type      TEXT          NOT NULL
                    CHECK (message_type IN ('news', 'system_update', 'promotion', 'other')),

  -- เนื้อหาข้อความที่ส่งจริง (เก็บไว้ตรวจย้อนหลังว่าส่งอะไรไป)
  message_content   TEXT          NOT NULL,

  -- ผลการส่ง ณ ครั้งนั้น: จำนวนผู้รับทั้งหมด / สำเร็จ / ล้มเหลว
  -- (success_count + failure_count = total_recipients เสมอ)
  total_recipients  INTEGER       NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
  success_count     INTEGER       NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count     INTEGER       NOT NULL DEFAULT 0 CHECK (failure_count >= 0),

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query หลัก: "ประวัติการส่งล่าสุด" (ใหม่→เก่า) สำหรับหน้า Admin ในอนาคต
CREATE INDEX idx_broadcast_logs_created_at
  ON broadcast_logs (created_at DESC);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ payments/portfolio_snapshots: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
ALTER TABLE broadcast_logs ENABLE ROW LEVEL SECURITY;
