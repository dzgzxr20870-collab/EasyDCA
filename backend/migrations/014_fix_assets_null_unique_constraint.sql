-- ═══════════════════════════════════════════════════════════════════════
-- Migration 014 — Fix assets UNIQUE Constraint ไม่ปลอดภัยกับ NULL portfolio_id
-- ═══════════════════════════════════════════════════════════════════════
-- UNIQUE (user_id, symbol, portfolio_id) เดิมบน assets ไม่ป้องกัน Duplicate
-- เมื่อ portfolio_id IS NULL (กรณีส่วนใหญ่ในระบบวันนี้ — Free-tier ไม่มี
-- Multiple Portfolio) เพราะ PostgreSQL ถือว่า NULL <> NULL เสมอ สอง INSERT
-- ของ user+symbol เดียวกันที่ portfolio_id = NULL จึงผ่าน Constraint ทั้งคู่ได้
-- สร้าง Asset ซ้ำสอง asset_id แยกกัน ทำให้ Transaction ประวัติของ Symbol เดียวกัน
-- แตกกระจายคนละ asset_id — Moving Average Cost Basis (portfolio.service
-- calculateTotalInvested) จะเห็นแค่ครึ่งเดียวของประวัติ คำนวณ P&L ผิดทันที
--
-- นี่คือบัค Class เดียวกับที่พบและแก้ไปแล้วใน portfolio_snapshots (ดู
-- DATABASE.md § "ข้อควรระวัง: NULL กับ UNIQUE Constraint") — แก้ด้วยวิธีเดียวกัน
-- ตามที่เอกสารแนะนำ: UNIQUE NULLS NOT DISTINCT (PostgreSQL 15+) ให้ NULL ถูกมองว่า
-- เท่ากันเมื่อเทียบ Unique แทนการเช็คซ้ำในชั้น App (Production DB ยืนยันแล้วว่าเป็น
-- PostgreSQL 17.6 — รองรับ Syntax นี้)
--
-- ก่อนรัน Migration นี้ได้ตรวจสอบแล้วว่าไม่มีข้อมูลละเมิด (Production, ตรวจ
-- 2026-07-16):
--   SELECT user_id, symbol, COUNT(*) FROM assets WHERE portfolio_id IS NULL
--   GROUP BY user_id, symbol HAVING COUNT(*) > 1;
--   → คืน 0 แถว (ไม่มี Duplicate ให้ต้อง Merge ก่อน)
--
-- ชื่อ Constraint เดิมยืนยันจาก information_schema.table_constraints ตรงกับ
-- Pattern Auto-generate มาตรฐาน: assets_user_id_symbol_portfolio_id_key
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE assets
  DROP CONSTRAINT assets_user_id_symbol_portfolio_id_key,
  ADD CONSTRAINT assets_user_id_symbol_portfolio_id_key
    UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id);
