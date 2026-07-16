-- ═══════════════════════════════════════════════════════════════════════
-- Migration 016 — payments.amount_released_at (Lock-Until-Resolved)
-- ═══════════════════════════════════════════════════════════════════════
-- Bug ที่แก้: idx_payments_pending_amount_unique (migration 004, WHERE
-- status='pending') ปล่อยยอด (amount_thb) คืนให้ใช้ซ้ำได้ทันทีที่ paymentExpiry.job.js
-- เปลี่ยน status เป็น 'expired' (เกิน 24 ชม.) — แต่ QR PromptPay เป็น Static Tag 29
-- ไม่มี Expiry ระดับธนาคาร ผู้ใช้ยังสแกน QR เดิมโอนเงินได้ตามปกติหลังจากนั้น ถ้ามีคำขอ
-- ใหม่ได้ยอดเดียวกันไปแล้วก่อนโอน เงินที่โอนเข้ามาจะจับคู่กำกวมระหว่าง 2 คำขอ
--
-- แก้ไข: แยก "ยอดนี้ว่างให้ใช้ซ้ำได้หรือยัง" ออกจาก status ทั้งหมด — เพิ่มคอลัมน์ nullable
-- amount_released_at: NULL = ยอดยังถูกล็อกอยู่, ไม่ใช่ NULL = ปล่อยแล้ว นำ amount_thb
-- กลับมาใช้ได้ ตั้งค่าเฉพาะตอน (1) Admin Resolve จริง (Approve/Reject) หรือ (2) Auto-release
-- Safety Valve (Cron ใหม่ — 7 วันนับจาก created_at ไม่มีการ Resolve) เท่านั้น — status ยัง
-- รายงานสถานะจริงต่อไปตามเดิม (pending/confirmed/rejected/expired) ไม่ผูกกับการล็อกยอดอีก
--
-- Nullable column เดียวกับ Pattern slip_hash (migration 015) — ไม่เพิ่ม NOT NULL/CHECK
-- จึงไม่มีความเสี่ยง Constraint Violation กับแถวเดิม
--
-- ── Backfill (สำคัญ — ต้องทำก่อนสร้าง Unique Index ใหม่) ──────────────────────
-- ถ้าปล่อยแถวเดิมทั้งหมด (confirmed/rejected/expired รวมถึง pending) เป็น NULL เฉยๆ
-- (ตาม ADD COLUMN เปล่าๆ) จะ (ก) เสี่ยง CREATE UNIQUE INDEX ใหม่ Fail ทันทีถ้ามีแถวเก่า
-- คนละสถานะบังเอิญ amount_thb ซ้ำกัน (เป็นไปได้จริง — satang tag 1-99 หมุนเวียนคืนทุกเดือน)
-- (ข) ต่อให้ไม่ Fail ก็จะทำให้ยอดเก่าที่ Resolve ไปนานแล้วถูกล็อกใหม่โดยไม่มีเหตุผลจนกว่า
-- Cron 7 วันจะมาปล่อย — จึง Backfill amount_released_at ให้ตรงกับความจริงในอดีตก่อน:
--   • confirmed/rejected → amount_released_at = confirmed_at (เวลาที่ Resolve จริง)
--   • expired            → amount_released_at = updated_at (Trigger set_updated_at
--     Bump ตอน markExpired สั่ง UPDATE — คือเวลาที่โค้ดเดิมปล่อยยอดคืนจริงในอดีต)
--   • pending             → คงเป็น NULL ต่อไป (ยังถูกล็อกจริงในปัจจุบัน)
--
-- ── Pre-check (รันก่อน Migration นี้ — ยืนยันว่า idx_payments_pending_amount_unique
-- เดิมการันตีไม่มี amount_thb ซ้ำกันในกลุ่ม pending อยู่แล้วจริง ก่อนสร้าง Index ใหม่) ──
--   SELECT amount_thb, COUNT(*) FROM payments WHERE status = 'pending'
--   GROUP BY amount_thb HAVING COUNT(*) > 1;
--   → ต้องคืน 0 แถว
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS — เปิดอยู่แล้วที่ระดับตาราง ไม่ต้องเพิ่ม Policy),
-- § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE payments ADD COLUMN amount_released_at TIMESTAMPTZ;

-- Backfill แถวเดิมที่ Resolve แล้ว (confirmed/rejected) — ปล่อยตามเวลา Resolve จริง
UPDATE payments SET amount_released_at = confirmed_at
  WHERE status IN ('confirmed', 'rejected') AND amount_released_at IS NULL;

-- Backfill แถวเดิมที่ expired — ปล่อยตามเวลาที่ Cron markExpired สั่ง UPDATE จริง
-- (updated_at ถูก Bump โดย Trigger set_updated_at ตอนนั้น และไม่มีการ UPDATE แถวนี้อีก
-- หลังจากนั้นในโค้ดเดิม จึงเป็นเวลาที่ถูกต้องที่สุดเท่าที่ Backfill ย้อนหลังได้)
UPDATE payments SET amount_released_at = updated_at
  WHERE status = 'expired' AND amount_released_at IS NULL;

-- แถว pending: amount_released_at คงเป็น NULL (ยังถูกล็อกจริง ไม่ต้องทำอะไรเพิ่ม)

-- ── แทนที่ Partial Unique Index เดิม (Scope ตาม status) ด้วยตัวใหม่ (Scope ตาม
-- amount_released_at) — นี่คือหัวใจของ Lock-Until-Resolved ───────────────────
DROP INDEX idx_payments_pending_amount_unique;

CREATE UNIQUE INDEX idx_payments_amount_unresolved_unique
  ON payments(amount_thb)
  WHERE amount_released_at IS NULL;

-- รองรับ Cron ใหม่ (Auto-release Safety Valve) สแกนหาแถวที่ยัง unresolved
-- (amount_released_at IS NULL) แต่ created_at เกิน 7 วัน — ดู
-- payment.repository.releaseStaleAmounts / payment.service.autoReleaseStaleAmounts
CREATE INDEX idx_payments_unresolved_created_at
  ON payments(created_at)
  WHERE amount_released_at IS NULL;

-- RLS (§ 3): เปิดอยู่แล้วที่ระดับตาราง (migration 004) ไม่มี Policy สำหรับ
-- authenticated/anon — คอลัมน์ใหม่นี้เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
-- เหมือนคอลัมน์อื่นทั้งหมดในตาราง ไม่ต้องเพิ่ม Policy ใดๆ
