-- ═══════════════════════════════════════════════════════════════════════
-- Migration 008 — pending_transactions.batch_id
-- ═══════════════════════════════════════════════════════════════════════
-- Phase 3 Round 6 (นำเข้าพอร์ตแบบ Multi-line) ต้องการให้ N แถวของ
-- pending_transactions ที่เกิดจาก Batch เดียวกัน ผูกกับปุ่มยืนยัน/ยกเลิก
-- "ปุ่มเดียว" ได้ (Postback data พก batch_id ตัวเดียวแทนที่จะพก pending id
-- ทีละตัว ซึ่งจะเกิน Limit ความยาว 300 ตัวอักษรของ LINE Postback ได้ง่ายถ้า
-- Batch มีหลายรายการ)
--
-- เป็น Column nullable ล้วน — Flow ซื้อ/ขายทีละรายการเดิม (Round ก่อนหน้า)
-- ไม่ส่งค่านี้มา (batch_id = NULL) จึงไม่กระทบ Flow เดิมเลย ไม่ต้องแก้
-- Constraint ใดๆ ที่มีอยู่แล้วใน migration 001
--
-- Cron Cleanup เดิม (pendingCleanup.job.js → expireOverduePending/
-- purgeOldPending) ทำงานกับทุกแถวในตารางนี้อยู่แล้วโดยไม่สนใจ batch_id
-- จึงครอบคลุมแถว Batch ให้อัตโนมัติ ไม่ต้องเขียน Cron ใหม่สำหรับ Cleanup
-- ฝั่ง pending_transactions
--
-- อ้างอิงหลักการ: DATABASE.md § 10 (Index — FK/Filter Column ควรมี Index)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE pending_transactions
  ADD COLUMN batch_id UUID;

-- Partial Index (ส่วนใหญ่เป็น NULL เพราะการซื้อ/ขายทีละรายการไม่มี batch_id)
-- ใช้เร่ง Query "ทุกแถว Pending ของ Batch นี้" ตอน Confirm/Cancel ทั้งก้อน
CREATE INDEX idx_pending_transactions_batch_id
  ON pending_transactions(batch_id)
  WHERE batch_id IS NOT NULL;
