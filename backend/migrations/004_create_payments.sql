-- ═══════════════════════════════════════════════════════════════════════
-- Migration 004 — payments
-- ═══════════════════════════════════════════════════════════════════════
-- Phase 2 Step 3 (Foundation): ระบบ Premium ผ่าน PromptPay QR ล้วน + ต่ออายุเอง
-- (Manual renewal) — รายเดือน 59 บาท / รายปี 590 บาท | Free = 2 สินทรัพย์เหมือนเดิม
--
-- Migration นี้ทำแค่ "Schema" — ยังไม่มี Endpoint/Repository/Cron ที่เขียน-อ่าน
-- ตาราง payments (อยู่รอบถัดไป) รอบนี้เตรียมโครงสร้างให้ถูกต้อง Atomic ที่ระดับ DB
--
-- หมายเหตุ "วันหมดอายุ Premium": ใช้คอลัมน์ users.plan_expires_at ที่มีอยู่เดิม
-- (สร้างไว้แล้วในตาราง users — user.repository.updatePlan() เขียนลงตัวนี้อยู่แล้ว)
-- entitlement.service ตัดสิน "Premium Active" จาก plan = 'premium' AND
-- plan_expires_at > now() — Migration นี้จึง "ไม่เพิ่มคอลัมน์วันหมดอายุใหม่"
-- เพื่อเลี่ยงคอลัมน์ซ้ำซ้อน (อนุมัติเขียนที่หนึ่ง แต่ entitlement อ่านอีกที่)
--
-- payments — Immutable Ledger (ห้ามลบข้อมูล ตาม DATABASE.md § 8) เก็บทุกคำขอ
-- ชำระเงินและสถานะการอนุมัติ
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (updated_at trigger),
-- § 8 (Immutable Ledger), § 9 (FK RESTRICT), § 10 (Index)
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

-- ── payments (Immutable Ledger) ────────────────────────────────────────
CREATE TABLE payments (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 (ห้ามลบ user ที่ยังมีข้อมูลผูกอยู่ + Ledger ห้ามลบ)
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- รอบบิล: รายเดือน / รายปี
  billing_period    TEXT          NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),

  -- ยอดฐานตามแพ็กเกจ (59 หรือ 590) ก่อนบวก satang tag
  base_amount_thb   NUMERIC(10,2) NOT NULL CHECK (base_amount_thb > 0),

  -- satang_tag: เศษสตางค์ 1-99 ที่ระบบสุ่ม/จัดสรรให้แต่ละคำขอ เพื่อทำให้ยอดรวม
  -- ไม่ซ้ำกัน (ดู Partial Unique Index ด้านล่าง) — Admin ใช้ยอดนี้แมตช์กลับหาคำขอ
  satang_tag        INTEGER       NOT NULL CHECK (satang_tag BETWEEN 1 AND 99),

  -- ยอดที่ต้องโอนจริง = base + satang/100 (เช่น 59.17) — เก็บซ้ำเพื่อความชัดเจน
  -- และเป็นคีย์ที่ Admin/ระบบใช้แมตช์ยอดเข้าบัญชี
  amount_thb        NUMERIC(10,2) NOT NULL CHECK (amount_thb > 0),

  -- สถานะคำขอ:
  --   pending   = รอโอน/รอตรวจสลิป
  --   confirmed = Admin อนุมัติแล้ว (ต่ออายุ Premium ให้ user แล้ว)
  --   rejected  = Admin ปฏิเสธ (ยอด/สลิปไม่ตรง)
  --   expired   = คำขอหมดอายุก่อนถูกยืนยัน (เกิน expires_at)
  status            TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),

  -- URL รูปสลิปที่ผู้ใช้อัพโหลด (nullable — บางคำขออาจยังไม่แนบ)
  slip_image_url    TEXT,

  -- line_user_id ของ Admin ที่กดอนุมัติ (Audit trail — ไม่ FK เพราะ Admin อาจไม่ใช่ user
  -- ในตาราง users; เก็บเป็น Identifier ดิบตาม Pattern audit_logs)
  confirmed_by      TEXT,
  confirmed_at      TIMESTAMPTZ,

  -- คำขอหมดอายุเมื่อไร (สร้างตอน + 24 ชม. ในรอบถัดไป) — Cron จะ mark 'expired'
  -- และ Partial Unique Index จะปล่อยยอดนั้นให้ว่างกลับมาใช้ใหม่ได้
  expires_at        TIMESTAMPTZ   NOT NULL,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Rule 1: FK Column + Query "คำขอของ user นี้ตามสถานะ" (แสดงประวัติ/หาคำขอ pending)
CREATE INDEX idx_payments_user_status
  ON payments(user_id, status);

-- Cron สแกนหาคำขอ 'pending' ที่เลย expires_at เพื่อ mark 'expired'
CREATE INDEX idx_payments_status_expires_at
  ON payments(status, expires_at);

-- ── หัวใจของการแมตช์ยอดแบบ Atomic ──────────────────────────────────────
-- บังคับที่ระดับ DB ว่า "ณ เวลาหนึ่ง จะมีคำขอ pending ยอดเท่ากันได้ไม่เกิน 1 อัน"
-- ทำให้ Admin/ระบบแมตช์ยอดที่โอนเข้าบัญชีกลับหาคำขอได้แบบไม่กำกวม (การันตีด้วย DB
-- ไม่ใช่ App Layer — Pattern เดียวกับ pending_transactions ใน Phase 1)
-- เมื่อคำขอ resolve (confirmed/rejected/expired) ยอดนั้นจะว่างและถูกนำกลับมาใช้ได้
CREATE UNIQUE INDEX idx_payments_pending_amount_unique
  ON payments(amount_thb)
  WHERE status = 'pending';

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ pending_transactions/dca_reminders: เปิด RLS แต่ไม่มี Policy
-- สำหรับ authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
