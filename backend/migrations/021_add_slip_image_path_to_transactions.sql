-- ═══════════════════════════════════════════════════════════════════════
-- Migration 021 — เพิ่มคอลัมน์ slip_image_path (แนบรูปสลิป OCR — S8)
-- ═══════════════════════════════════════════════════════════════════════
-- ให้ Transaction ที่บันทึกจากรูปสลิป (AI Slip OCR — Round 9) เก็บ "ตัวชี้ไปยัง
-- รูปสลิปต้นฉบับ" ไว้ดูย้อนหลังจาก Dashboard ได้ (เดิมรูปถูกส่งให้ Claude Vision
-- อ่านแล้วทิ้งทันที ไม่เคยถูกอัปโหลดเก็บที่ไหนเลย)
--
-- ⚠️ นี่คือ Metadata ล้วนๆ บน Immutable Ledger — ไม่ใช่ตัวเลขการเงิน:
--   - Nullable ไม่มี DEFAULT → แถวเดิมทุกแถวเป็น NULL อัตโนมัติ (ไม่ Rewrite ตาราง)
--   - ไม่มีผลย้อนหลังต่อ quantity/price_per_unit/amount_thb/fee_thb ใดๆ ทั้งสิ้น
--   - Transaction ที่ไม่ได้มาจาก OCR (พิมพ์เอง/Web/Bulk Import) จะเป็น NULL เสมอ
--
-- ⚠️ เก็บ "path" ไม่ใช่ "URL" โดยเจตนา — Bucket transaction-slips เป็น Private
--   (ต่างจาก payment-slips ที่เป็น Public) เพราะสลิปจากแอปโบรกเกอร์มักแสดงเลขที่
--   บัญชี/ยอดคงเหลือ/ชื่อเต็มของผู้ใช้ ซึ่งละเอียดอ่อนกว่าสลิปโอนเงินมาก การเข้าถึง
--   จึงต้องผ่าน Signed URL อายุสั้นที่ Backend สร้างให้ตอนผู้ใช้กดดูเท่านั้น
--   (Pattern เดียวกับ Bucket reports ใน Round 8) — Signed URL หมดอายุ จึงเก็บลง DB
--   ไม่ได้ ต้องเก็บ path แล้ว Sign สดทุกครั้งที่ขอ
--
-- ต้องเพิ่ม 2 ที่ (Pattern เดียวกับ migration 009/010/012):
--   1) transactions.slip_image_path      — path จริงที่ผูกกับธุรกรรมถาวร
--   2) pending_transactions.slip_token   — พก token ข้ามขั้น Preview→Confirm
--
-- ⚠️ ทำไมต้องมีที่ pending ด้วย: Flow OCR ผ่าน "สองจังหวะ Postback" —
--   [1] ocr_confirm  → สร้าง pending row + แสดง Preview (ยังไม่มี transaction)
--   [2] confirm&pendingId=… → เพิ่งสร้าง transaction จริง
--   จังหวะ [2] พกมาแค่ pendingId เท่านั้น (Postback ของ Preview การ์ดมาตรฐาน) จึง
--   ต้อง Snapshot token ไว้ที่ pending row เพื่อให้ข้ามไปถึงจังหวะสร้างธุรกรรมได้
--   (เหมือน currency ใน migration 012 ที่ต้องพกผ่าน pending ด้วยเหตุผลเดียวกัน)
-- ═══════════════════════════════════════════════════════════════════════

-- 1) transactions.slip_image_path ────────────────────────────────────────
ALTER TABLE transactions
  ADD COLUMN slip_image_path TEXT;

-- ไม่สร้าง Index: ไม่มี Query ไหนกรอง/เรียงด้วยคอลัมน์นี้ (อ่านแบบ Per-row ผ่าน
-- transaction id ที่มี PK อยู่แล้ว) — เพิ่ม Index จะเปลืองพื้นที่เปล่าๆ
COMMENT ON COLUMN transactions.slip_image_path IS
  'Storage path ใน Bucket transaction-slips (Private) ของรูปสลิปต้นฉบับที่ AI OCR อ่าน — NULL ถ้าไม่ได้มาจากสลิป';

-- 2) pending_transactions.slip_token ─────────────────────────────────────
-- เก็บแค่ token ("{timestamp}.{ext}") ไม่ใช่ path เต็ม — path ถูกประกอบจาก user_id
-- ที่ Authenticate แล้วตอน Commit เสมอ (storage.service.buildTransactionSlipPath)
ALTER TABLE pending_transactions
  ADD COLUMN slip_token TEXT;

COMMENT ON COLUMN pending_transactions.slip_token IS
  'Token ของรูปสลิปที่อัปโหลดไว้ตอน OCR ("{timestamp}.{ext}") พกข้ามขั้น Preview→Confirm — NULL ถ้าไม่ได้มาจากสลิป';
