-- ═══════════════════════════════════════════════════════════════════════
-- Migration 009 — เพิ่ม Asset Type "ทอง" (gold_bar / gold_ornament)
-- ═══════════════════════════════════════════════════════════════════════
-- Phase 3 Round 7 (ส่วนแรก) — รองรับทองคำแท่ง (gold_bar) และทองรูปพรรณ
-- (gold_ornament) เป็นสินทรัพย์ใหม่ พร้อม Price Feed จริงจากสมาคมค้าทองคำฯ
-- (ผ่าน Community API) — ราคาคิดเป็น "บาททองคำ" (น้ำหนัก) quantity ทศนิยมได้
-- ตาม NUMERIC(20,8) เดิม จึงไม่ต้องแก้ชนิด/Precision ของคอลัมน์ quantity/price
--
-- คอลัมน์ประเภทสินทรัพย์ถูกจำกัดด้วย CHECK Constraint (ไม่ใช่ Postgres ENUM Type
-- จริง) อยู่ 2 ที่ ต้องขยายทั้งคู่ มิฉะนั้น INSERT ทองจะถูก Reject:
--   1) assets.type                — ตาราง Asset จริง (นิยามใน docs/DATABASE.md)
--   2) pending_transactions.asset_type — Preview รอ Confirm (migration 001)
--
-- ⚠️ ห้ามลบ/แก้ค่าเดิม — เพิ่มเฉพาะ 'gold_bar','gold_ornament' ต่อท้ายรายการเดิม
-- ทำแบบ DROP + ADD CONSTRAINT (Postgres ไม่มี "ALTER CONSTRAINT ... IN" สำหรับ CHECK)
-- ใช้ชื่อ Constraint ตาม Convention Auto-name ของ Postgres สำหรับ Inline Column CHECK
-- คือ <table>_<column>_check (ถ้าฐานข้อมูลตั้งชื่อไว้ต่างจากนี้ ให้แก้ชื่อใน DROP
-- ให้ตรงก่อนรัน — ตรวจได้ด้วย \d assets / \d pending_transactions)
-- ═══════════════════════════════════════════════════════════════════════

-- 1) assets.type ─────────────────────────────────────────────────────────
ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_type_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_type_check
  CHECK (type IN ('crypto', 'stock_th', 'stock_us', 'etf', 'fund', 'gold_bar', 'gold_ornament'));

-- 2) pending_transactions.asset_type ─────────────────────────────────────
ALTER TABLE pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_asset_type_check;

ALTER TABLE pending_transactions
  ADD CONSTRAINT pending_transactions_asset_type_check
  CHECK (asset_type IN ('crypto', 'stock_th', 'stock_us', 'etf', 'fund', 'gold_bar', 'gold_ornament'));
