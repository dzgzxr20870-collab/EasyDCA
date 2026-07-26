-- ═══════════════════════════════════════════════════════════════════════
-- Migration 026 — เพิ่ม category/source ให้ support_requests
-- ═══════════════════════════════════════════════════════════════════════
-- Pivot Flow "ติดต่อ Admin/Support" จากเดิม (พิมพ์ Trigger → พิมพ์ข้อความใน LINE
-- Chat โดยตรง) เป็นหน้าเว็บ /support แยกต่างหาก — เหตุผล: Webhook ตอบอัตโนมัติชน
-- กับตอน Admin เข้าไปตอบมือใน LINE Chat Mode เดียวกัน (Bot ทับคำตอบของ Admin)
--
-- category — หมวดปัญหาที่ผู้ใช้เลือกจาก Dropdown บนหน้าเว็บ (Flow เดิมไม่มีการแยก
-- หมวดเลย จึง Nullable ไม่ใช่ NOT NULL — แถวเก่าก่อน Migration นี้ไม่มีข้อมูลหมวด
-- ย้อนหลังให้ Backfill ได้จริง ปล่อยเป็น NULL ตรงไปตรงมากว่าเดายัดใส่)
--
-- source — ช่องทางที่ส่งมา ('line' = Flow เดิมที่พิมพ์ในแชทตรงๆ ก่อน Pivot นี้,
-- 'web' = ผ่านหน้า /support ใหม่) DEFAULT 'line' เพราะแถวเก่าทั้งหมดมาจาก LINE
-- Chat จริง (Backward-compat แบบเดียวกับ transactions.currency ใน migration 012)
--
-- อ้างอิงหลักการ: DATABASE.md § 9 (ALTER TABLE เพิ่มคอลัมน์แบบ Additive ปลอดภัย)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE support_requests
  ADD COLUMN category TEXT
  CHECK (category IN ('payment_premium', 'ocr', 'portfolio_ledger', 'other'));

ALTER TABLE support_requests
  ADD COLUMN source TEXT NOT NULL DEFAULT 'line'
  CHECK (source IN ('line', 'web'));
