-- ═══════════════════════════════════════════════════════════════════════
-- Migration 023 — premium_grant_logs
-- ═══════════════════════════════════════════════════════════════════════
-- Audit Trail สำหรับการที่ Admin กด "ให้ Premium ฟรี" ให้ผู้ใช้ตรงๆ (Beta Wave 1
-- — ดู adminGrant.service.js / admin.controller.grantPremium) โดย "ไม่ผ่าน Payment
-- Flow จริง" (ไม่มีเงินเข้า ไม่มีแถวใน payments) — จึงต้องมี Log แยกไว้ตรวจสอบย้อนหลัง
-- ว่าใคร (granted_by) ให้สิทธิ์ใคร (user_id) เมื่อไร กี่รอบบิล (billing_period)
-- และวันหมดอายุใหม่หลัง Stacking เป็นเท่าไร (new_expires_at)
--
-- ⚠️ ทำไมต้องมีตารางนี้แยกจาก payments: การ Grant ฟรี "ห้าม" สร้างแถวใน payments
-- ที่มี amount_thb/confirmed_at เพราะ GET /api/v1/admin/stats นับรายได้จาก
-- payments status='confirmed' — ถ้าใส่แถวปลอมจะทำให้ตัวเลขรายได้เพี้ยน วิธีที่ถูก
-- คือ Update users.plan/plan_expires_at ตรงๆ แล้วบันทึกร่องรอยไว้ที่ Log ตารางนี้แทน
--
-- Migration นี้ทำแค่ "Schema" — Repository ที่เขียนตารางนี้อยู่คนละไฟล์
-- (premiumGrantLog.repository.js / adminGrant.service.js รอบเดียวกัน)
--
-- premium_grant_logs — Append-only Log (1 แถวต่อ 1 ครั้งที่ Grant สำเร็จ) ไม่มี
-- UPDATE/DELETE จึงไม่มี updated_at/trigger (Pattern เดียวกับ broadcast_logs
-- — migration 006 — และ erasure_logs — migration 019 — ที่เป็น Append-only Log)
--
-- user_id เป็น FK จริง (ต่างจาก granted_by ที่เป็น TEXT ดิบ) เพราะ users Row
-- ไม่เคยถูกลบทิ้ง (Anonymize เท่านั้น) FK นี้จึงอ้างอิงได้เสมอไม่มี Orphan —
-- granted_by เก็บ LINE User ID ของ Admin เป็น TEXT ดิบ (Pattern เดียวกับ
-- payments.confirmed_by / broadcast_logs.sent_by: Admin อาจไม่ใช่ Row ในตาราง users)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 9 (FK RESTRICT), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ── premium_grant_logs (Append-only) ────────────────────────────────────
CREATE TABLE premium_grant_logs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 — ผู้ใช้ที่ได้รับสิทธิ์ (users Row ไม่เคยถูก DELETE
  -- จริง Anonymize เท่านั้น FK จึงอ้างอิงได้เสมอไม่มี Orphan)
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- LINE User ID ของ Admin ที่กด Grant (Audit — ไม่ FK เพราะ Admin อาจไม่ใช่ Row
  -- ในตาราง users; เก็บเป็น Identifier ดิบ Pattern เดียวกับ payments.confirmed_by)
  granted_by        TEXT          NOT NULL,

  -- รอบบิลที่ Grant: รายเดือน / รายปี (ใช้ Logic Stacking เดียวกับ payment จริง
  -- ผ่าน entitlement.computeRenewalExpiry — จึงจำกัดค่าให้ตรงกับ payments.billing_period)
  billing_period    TEXT          NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),

  -- วันหมดอายุ Premium ใหม่หลัง Stacking (Snapshot ณ ตอน Grant — เก็บไว้ตรวจย้อนหลัง
  -- ว่าครั้งนั้นต่อให้ถึงเมื่อไร ต่อให้ users.plan_expires_at ถูกทับด้วยการ Grant/จ่าย
  -- รอบถัดไปในภายหลังก็ยังสืบได้)
  new_expires_at    TIMESTAMPTZ   NOT NULL,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query หลัก: "ประวัติการ Grant ล่าสุด" (ใหม่→เก่า) เผื่อ Admin ตรวจสอบย้อนหลัง
CREATE INDEX idx_premium_grant_logs_created_at
  ON premium_grant_logs (created_at DESC);

-- Query รอง: "ประวัติการ Grant ของผู้ใช้รายนี้" (FK Column + by user)
CREATE INDEX idx_premium_grant_logs_user_id
  ON premium_grant_logs (user_id);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ broadcast_logs/erasure_logs/payments: เปิด RLS แต่ไม่มี Policy
-- สำหรับ authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
ALTER TABLE premium_grant_logs ENABLE ROW LEVEL SECURITY;
