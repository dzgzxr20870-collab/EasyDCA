-- ═══════════════════════════════════════════════════════════════════════
-- Migration 020 — เพิ่มคอลัมน์ currency ให้ dca_reminders (DCA Planner — S8 R3)
-- ═══════════════════════════════════════════════════════════════════════
-- S8 Round 3 — เปิดให้ "แผน DCA" (dca_reminders) รองรับสกุลเงิน USD ตามจริง
-- แบบเดียวกับ transactions (migration 012) เพื่อให้แผนที่ตั้งไว้ตรงกับสกุลของ
-- ธุรกรรมที่จะสร้างจริงตอนกด "บันทึกเลย" (เช่นแผนหุ้นสหรัฐเป็น USD / คริปโตเป็น USD)
--
-- ⚠️ Semantics สำคัญ (อ่านก่อนใช้):
--   คอลัมน์ amount_thb เดิม "ถูกใช้ซ้ำ" เก็บค่าเป็นหน่วยของ currency ในแถวนั้น
--   (THB สำหรับแถวเดิมทั้งหมด / USD สำหรับแถว currency='USD') ไม่เปลี่ยนชื่อคอลัมน์
--   เพื่อเลี่ยง Breaking Change กับ dcaReminder.repository/service และ Cron เตือน
--   ที่อ้างชื่อ amount_thb อยู่ — currency คือ "ป้ายบอกหน่วย" ของ amount_thb
--   (Pattern เดียวกับ transactions.currency ใน migration 012)
--
-- ปลอดภัยแบบ Additive: DEFAULT 'THB' + NOT NULL ทำให้แถวเดิมทุกแถว (รวม reminder
-- ที่ผู้ใช้ LINE ตั้งไว้ก่อนหน้า) กลายเป็น 'THB' อัตโนมัติ = พฤติกรรมเดิมทุกประการ
-- LINE Flow เดิม (createReminder ที่ไม่ส่ง currency) ยังทำงานต่อโดยไม่ต้องแก้
--
-- ตารางนี้เป็น "Config ของผู้ใช้" (จะ DCA อะไรเมื่อไหร่) ไม่ใช่ Immutable Ledger
-- เหมือน transactions — UPDATE/DELETE ได้ปกติ (ดู docs/DATABASE.md § dca_reminders)
-- RLS เปิดไว้แล้วตั้งแต่ migration 002 (service_role เท่านั้น) — ไม่ต้องแตะ
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE dca_reminders
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'THB'
  CHECK (currency IN ('THB', 'USD'));
