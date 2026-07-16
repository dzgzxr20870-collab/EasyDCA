-- ═══════════════════════════════════════════════════════════════════════
-- Migration 017 — users.pdpa_consented_at (Express Opt-in Consent)
-- ═══════════════════════════════════════════════════════════════════════
-- PDPA (พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562) กำหนดให้ Consent ต้องเป็น
-- Express Opt-in (ผู้ใช้กดยืนยันจริง) ไม่ใช่ Implied Consent จากการใช้งานต่อเฉยๆ
-- เพิ่มคอลัมน์ nullable นี้เพื่อบันทึกว่า User "กดยืนยัน" นโยบายความเป็นส่วนตัว
-- (frontend/public/privacy.html) เมื่อไร — NULL = ยังไม่เคยกดยืนยัน (ต้องเจอหน้า
-- Consent ก่อนใช้งาน Dashboard/Admin/Payment ได้ ดู requireConsent middleware)
--
-- ตั้งใจให้ Nullable "ตลอดไป" ไม่ใช่แค่ระหว่าง Backfill — NULL เป็น State จริง
-- ที่เข้าถึงได้เสมอ (User สมัครใหม่ทุกคนเริ่มจาก NULL จนกว่าจะกดยืนยันเอง)
-- Pattern เดียวกับ payments.amount_released_at (migration 016)
--
-- ── Backfill (Grandfather Clause) ──────────────────────────────────────────
-- User เดิมที่สมัครไปแล้วก่อน Consent Flow นี้จะถูกใช้ระบบต่อได้เลยไม่ต้องเจอ
-- หน้า Consent ซ้ำ — ถือว่ายอมรับเงื่อนไขการใช้งาน/นโยบายความเป็นส่วนตัวที่มีผล
-- ใช้บังคับ ณ ตอนที่สมัครใช้งานไปแล้วโดยปริยาย (Implied Acceptance จากการสมัคร
-- ใช้บริการจริง ก่อนที่ Express Opt-in Flow นี้จะถูกสร้างขึ้น) Backfill ด้วย
-- created_at ของ User เอง (วันที่สมัครจริง) ไม่ใช่ now() เพื่อให้ Timestamp
-- สื่อความหมายตามจริงว่า "ยอมรับมาตั้งแต่วันที่เริ่มใช้งาน" — มีผลเฉพาะ User เดิม
-- เท่านั้น User ใหม่ทุกคนนับจาก Migration นี้ต้องกดยืนยันจริงก่อนใช้งานครั้งแรก
--
-- ── Pre-check (รันก่อน Migration นี้ — ยืนยันจำนวน User เดิมที่จะถูก Backfill) ──
--   SELECT COUNT(*) FROM users WHERE pdpa_consented_at IS NULL;
--   → ควรเท่ากับจำนวน User ทั้งหมดในตาราง (เพราะคอลัมน์เพิ่งถูกสร้าง ทุกแถวย่อม
--   เป็น NULL ก่อน Backfill)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS — เปิดอยู่แล้วที่ระดับตาราง ไม่ต้องเพิ่ม
-- Policy)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN pdpa_consented_at TIMESTAMPTZ;

-- Backfill User เดิมทั้งหมด — Grandfather Clause (เหตุผลด้านบน)
UPDATE users SET pdpa_consented_at = created_at
  WHERE pdpa_consented_at IS NULL;

-- RLS (§ 3): เปิดอยู่แล้วที่ระดับตาราง (users มีอยู่ก่อน Migration Folder นี้)
-- ไม่มี Policy สำหรับ authenticated/anon — เข้าถึงผ่าน supabaseAdmin เท่านั้น
