-- ═══════════════════════════════════════════════════════════════════════
-- Migration 015 — payments.slip_hash (Duplicate Slip Detection, Payment Beta)
-- ═══════════════════════════════════════════════════════════════════════
-- เพิ่ม slip_hash (SHA-256 Hex ของรูปสลิปที่ผู้ใช้ส่งมา — คำนวณที่ webhook.controller
-- ก่อนอัปโหลดขึ้น Storage ดู payment.service.hashSlipImage) ใช้ตรวจจับ Fraud Vector:
-- ส่งสลิปโอนเงินจริงใบเดียวมาขอ Premium ซ้ำสองรอบ
--
-- Nullable โดยตั้งใจ — payments Row ถูกสร้างตอนกด "Premium" (payment.service.
-- requestPayment) ก่อนที่ผู้ใช้จะส่งสลิปเสมอ จึงมีช่วงเวลาที่ยังไม่มี slip_hash เป็น
-- State ปกติ ไม่ใช่ข้อผิดพลาด (Pattern เดียวกับ slip_image_url ที่ nullable อยู่แล้ว)
--
-- ⚠️ ไม่ทำ UNIQUE ที่ระดับ Column โดยตั้งใจ — Unique Violation (23505) ดิบๆ ไม่มีช่อง
-- ให้ตอบผู้ใช้ด้วยข้อความไทยที่เข้าใจง่าย และไม่มีช่องแยกแยะ Edge Case สำคัญ: ผู้ใช้ที่
-- ถูก Admin Reject คำขอเดิม (เช่นยอด/รูปไม่ชัด) ต้องส่งสลิปใบเดิมซ้ำได้ตามปกติตอนกด
-- "Premium" ขอคำขอใหม่ (payments แต่ละครั้งเป็น Row ใหม่เสมอ — ไม่มี Flow "เปิดคำขอเดิม
-- ซ้ำ") การตรวจซ้ำจึงเป็น App-level Check ที่ payment.service.assertSlipNotReused:
-- Reject เฉพาะเมื่อ slip_hash ซ้ำกับคำขอที่ status='confirmed' (อนุมัติแล้วจริง) เท่านั้น
-- ปล่อยผ่านตามปกติถ้าซ้ำกับคำขอที่ rejected/expired/pending
ALTER TABLE payments ADD COLUMN slip_hash TEXT;

-- ── Index (§ 10) — payment.service.assertSlipNotReused ค้นหาด้วย slip_hash ──────
CREATE INDEX idx_payments_slip_hash ON payments(slip_hash) WHERE slip_hash IS NOT NULL;
