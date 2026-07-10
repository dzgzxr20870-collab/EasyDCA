-- ═══════════════════════════════════════════════════════════════════════
-- Migration 010 — คอลัมน์สำหรับกองทุนรวมไทย (Mutual Fund NAV — Round 7)
-- ═══════════════════════════════════════════════════════════════════════
-- รองรับกองทุนรวมไทยที่ดึงราคา NAV จาก SEC Open Data API — ใช้ Asset Type เดิม
-- 'fund' ที่ assets.type / pending_transactions.asset_type อนุญาตอยู่แล้ว
-- (ตรวจ Constraint จริงแล้ว — ไม่ต้องแก้ CHECK จึงไม่มี Breaking Change)
--
-- แต่การดึง NAV ต้องใช้คู่ (proj_id + fund_class_name) เสมอ เพราะกองทุนเดียว
-- (proj_id) มีได้หลาย Class ที่ NAV ไม่เท่ากัน — symbol (proj_abbr_name) อย่างเดียว
-- ไม่พอ จึงต้อง "เก็บ Class ที่ผู้ใช้เลือกไว้ถาวร" เพื่อ Mark-to-market ตอนคำนวณ
-- มูลค่า/กำไรของกองทุนที่ถืออยู่ให้ตรง Class เดิม (ไม่ต้องพึ่ง Master List ทุกครั้ง)
--
-- ทั้ง 2 คอลัมน์เป็น nullable ล้วน (Additive ปลอดภัย): สินทรัพย์เดิมทุกชนิด
-- (Crypto/หุ้น/ทอง) ไม่ใช้ค่านี้ = NULL ตามปกติ ไม่กระทบ Flow เดิม
--
-- อ้างอิงหลักการ: DATABASE.md § 10 (Index — Filter Column ควรมี Index)
-- ═══════════════════════════════════════════════════════════════════════

-- 1) assets — เก็บ Class ที่ถือจริง (Source of Truth สำหรับ Mark-to-market) ───────
ALTER TABLE assets
  ADD COLUMN proj_id         TEXT,
  ADD COLUMN fund_class_name TEXT;

-- 2) pending_transactions — พก Class ผ่าน Flow Preview→Confirm ไปสร้าง Asset จริง ─
ALTER TABLE pending_transactions
  ADD COLUMN proj_id         TEXT,
  ADD COLUMN fund_class_name TEXT;

-- Index สำหรับค้น Asset กองทุนตาม proj_id (Partial — ส่วนใหญ่ NULL เพราะสินทรัพย์
-- อื่นไม่ใช้) เผื่อรายงาน/ดึงข้อมูลกองทุนในอนาคต
CREATE INDEX idx_assets_proj_id
  ON assets(proj_id)
  WHERE proj_id IS NOT NULL;
