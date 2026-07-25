-- ═══════════════════════════════════════════════════════════════════════
-- Migration 025 — support_requests
-- ═══════════════════════════════════════════════════════════════════════
-- Audit Trail ของทุกครั้งที่ผู้ใช้ติดต่อ Admin/Support ผ่าน LINE Chat (ก่อนเปิด
-- Closed Beta Wave 1 — ดู supportRequestFlow.service.js / webhook.controller.js)
-- ใช้ 2 จุดประสงค์:
--   1) ประวัติย้อนหลัง (ยังไม่ทำหน้า Admin Dashboard แสดงผลรอบนี้ — TODO แยก)
--   2) Rate Limit 1 ครั้ง/ชั่วโมง/User — Query แถวล่าสุดของ user_id นี้แทนการทำ
--      In-memory Map แยก (ต่างจาก slipOcr.service ที่ผูกกับ Process เดียว) เพราะ
--      มีตาราง Log ถาวรอยู่แล้วพอดี และไม่มีปัญหาข้ามรอบ Restart/หลาย Instance
--
-- Migration นี้ทำแค่ "Schema" — Repository/Service ที่เขียนตารางนี้อยู่คนละไฟล์
-- (supportRequest.repository.js / supportRequestFlow.service.js รอบเดียวกัน)
--
-- support_requests — Append-only Log (1 แถวต่อ 1 ครั้งที่ส่งข้อความสำเร็จ) ไม่มี
-- UPDATE/DELETE จึงไม่มี updated_at/trigger (Pattern เดียวกับ broadcast_logs —
-- migration 006 — และ premium_grant_logs — migration 023)
--
-- admin_count/notified_count เก็บผลนับจริง ณ ตอน Push (Pattern เดียวกับ
-- broadcast_logs.total_recipients/success_count) แทนการทำ CHECK Enum สถานะ —
-- ให้รายละเอียดมากกว่า และคำนวณ "สำเร็จ/ไม่สำเร็จ" ย้อนหลังได้จาก notified_count > 0
-- โดยไม่ต้อง Sync 2 ค่าให้ตรงกันเอง (บั๊กเดิมที่เคยเจอกับ Payment auto-notify)
--
-- user_id เป็น FK จริง (เหมือน premium_grant_logs.user_id) เพราะ users Row ไม่เคย
-- ถูกลบทิ้งจริง (Anonymize เท่านั้น) FK นี้จึงอ้างอิงได้เสมอไม่มี Orphan
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 9 (FK RESTRICT), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ── support_requests (Append-only) ──────────────────────────────────────
CREATE TABLE support_requests (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 — ผู้ใช้ที่แจ้งปัญหา (users Row ไม่เคยถูก DELETE
  -- จริง Anonymize เท่านั้น FK จึงอ้างอิงได้เสมอไม่มี Orphan)
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- เนื้อหาที่ผู้ใช้พิมพ์แจ้ง (จำกัดความยาวฝั่ง Service ก่อนถึงตรงนี้แล้ว — ดู
  -- supportRequestFlow.validateMessage)
  message         TEXT          NOT NULL,

  -- จำนวน Admin ที่ตั้งค่าไว้ (ADMIN_LINE_USER_IDS) ณ ตอน Push / จำนวนที่ Push
  -- สำเร็จจริง (success_count เก่าไม่ได้อยู่กับความจริงเสมอถ้า Push ล้มเหลวบางคน)
  admin_count     INTEGER       NOT NULL DEFAULT 0 CHECK (admin_count >= 0),
  notified_count  INTEGER       NOT NULL DEFAULT 0 CHECK (notified_count >= 0),

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query หลัก: Rate Limit เช็ค "แถวล่าสุดของ User นี้" (WHERE user_id = ? ORDER BY
-- created_at DESC) — Composite Index ตรงกับรูปแบบ Query เป๊ะ
CREATE INDEX idx_support_requests_user_id_created_at
  ON support_requests (user_id, created_at DESC);

-- Query รอง: "ประวัติการแจ้งล่าสุดทั้งหมด" (ใหม่→เก่า) เผื่อหน้า Admin Dashboard ในอนาคต
CREATE INDEX idx_support_requests_created_at
  ON support_requests (created_at DESC);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ broadcast_logs/premium_grant_logs: เปิด RLS แต่ไม่มี Policy
-- สำหรับ authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
