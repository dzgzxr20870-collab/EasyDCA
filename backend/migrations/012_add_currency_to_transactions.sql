-- ═══════════════════════════════════════════════════════════════════════
-- Migration 012 — เพิ่มคอลัมน์ currency (Multi-Currency Support — Round 10)
-- ═══════════════════════════════════════════════════════════════════════
-- Phase 3 Round 10 — รองรับการบันทึกธุรกรรมเป็นสกุลเงิน USD "ตามจริง" (Native)
-- ไม่แปลงเป็นบาทตอนบันทึกอีกต่อไป (ต่างจากพฤติกรรมเดิมที่แปลง USD→THB ด้วย FX
-- ตอน Save) — ต้นทุนเฉลี่ย/กำไรขาดทุนคำนวณแยกตามสกุลเงิน ไม่ถัวข้ามสกุล
--
-- ⚠️ Semantics สำคัญ (อ่านก่อนใช้):
--   คอลัมน์ amount_thb และ price_per_unit เดิม "ถูกใช้ซ้ำ" เก็บค่าเป็นหน่วยของ
--   currency ในแถวนั้น (THB สำหรับแถวเดิมทั้งหมด / USD สำหรับแถว currency='USD')
--   ไม่ได้เปลี่ยนชื่อคอลัมน์เพื่อเลี่ยง Breaking Change กับโค้ด/รายงานที่อ้างชื่อเดิม
--   — currency คือ "ป้ายบอกหน่วย" ของตัวเลขในสองคอลัมน์นั้น
--
-- ปลอดภัยแบบ Additive: DEFAULT 'THB' + NOT NULL ทำให้แถวเดิมทุกแถวกลายเป็น 'THB'
-- อัตโนมัติ (เท่ากับพฤติกรรมเดิมทุกประการ) โค้ด/เทสต์ Path THB ไม่ต้องแก้พฤติกรรม
--
-- ต้องเพิ่ม 2 ที่ (เหมือน Pattern migration 009/010):
--   1) transactions.currency          — ตารางธุรกรรมจริง (นิยามใน docs/DATABASE.md)
--   2) pending_transactions.currency   — Preview รอ Confirm (migration 001) เพื่อ
--      พก currency ผ่าน Flow Preview→Confirm ไปบันทึกลง transactions ให้ตรง
-- ═══════════════════════════════════════════════════════════════════════

-- 1) transactions.currency ───────────────────────────────────────────────
ALTER TABLE transactions
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'THB'
  CHECK (currency IN ('THB', 'USD'));

-- 2) pending_transactions.currency ───────────────────────────────────────
ALTER TABLE pending_transactions
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'THB'
  CHECK (currency IN ('THB', 'USD'));
