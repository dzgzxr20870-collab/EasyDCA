-- ═══════════════════════════════════════════════════════════════════════
-- Migration 030 — users.expiry_reminder_sent_at
-- ═══════════════════════════════════════════════════════════════════════
-- กัน Push เตือน "Premium ใกล้หมดอายุ" ซ้ำทุกวัน (premiumExpiryReminder.job)
--
-- ⚠️ Additive ล้วน: NULLABLE ไม่มี DEFAULT ไม่มี Backfill → ทุกแถวเดิมเป็น NULL ซึ่งเป็น
-- ค่าที่ถูกต้องอยู่แล้วตามความหมาย (ยังไม่เคยถูกเตือน) โค้ดเดิมทั้งหมดไม่ได้อ่านคอลัมน์นี้
-- จึงไม่กระทบอะไรเลยแม้จะ Apply Migration ก่อน Deploy Code ใหม่
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- Cron เตือนก่อนหมดอายุรันทุกวัน และเงื่อนไข "เหลือ ≤ 3 วัน" จะเป็นจริงติดกัน 3 วันรวด
-- ถ้าไม่มีตัวจำว่าเคยส่งแล้ว ผู้ใช้จะโดน Push ซ้ำ 3 วันติด (สแปม) — คอลัมน์นี้ถูกปั๊ม
-- ตอนส่งสำเร็จ แล้ว Job จะข้ามคนที่ปั๊มแล้วในรอบถัดไป
--
-- ⚠️ ต่างจาก free_trial_claimed_at (migration 029) ตรงที่ตัวนี้ "ต้องถูก Reset" ทุกครั้ง
-- ที่มีการต่ออายุ/เปลี่ยนแผน (ไม่งั้นรอบบิลถัดไปจะไม่มีการเตือนอีกเลยตลอดชีพ) — Reset ทำที่
-- userRepository.updatePlan() ซึ่งเป็น "ทางเข้าเดียว" ของการเขียน plan/plan_expires_at
-- ทั้งระบบ (payment อนุมัติ / admin grant / downgrade ใช้ตัวนี้ทั้งหมด) และที่
-- userRepository.claimFreeTrial() ซึ่งเขียน plan ตรงๆ แบบ Atomic ไม่ผ่าน updatePlan
--
-- NULL = ยังไม่เคยเตือนในรอบบิลปัจจุบัน (ค่าเริ่มต้น + หลัง Reset ทุกครั้ง)
ALTER TABLE users ADD COLUMN expiry_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN users.expiry_reminder_sent_at IS
  'เวลาที่ระบบ Push เตือน "Premium ใกล้หมดอายุ" ให้ผู้ใช้ในรอบบิลปัจจุบัน — NULL = ยังไม่เคยเตือนรอบนี้. ถูก Reset เป็น NULL ทุกครั้งที่ updatePlan()/claimFreeTrial() (ต่ออายุ/เปลี่ยนแผน) เพื่อให้เตือนได้อีกในรอบบิลถัดไป';

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query ของ Cron เตือนก่อนหมดอายุ (รันทุกวัน):
--   WHERE plan='premium' AND plan_expires_at BETWEEN now() AND now()+3d
--         AND expiry_reminder_sent_at IS NULL
--
-- Partial Index เฉพาะแถวที่ Job สนใจจริง (premium + ยังไม่เคยเตือน) — เล็กกว่า Index
-- เต็มตารางมาก เพราะผู้ใช้ส่วนใหญ่เป็น Free และคนที่เตือนไปแล้วจะหลุดออกจาก Index เอง
-- ไม่ใส่ plan_expires_at ใน WHERE ของ Index (ค่า now() ไม่ IMMUTABLE ใช้ใน Partial
-- Index ไม่ได้) แต่ใส่เป็น Index Column เพื่อให้ Range Scan ได้
CREATE INDEX idx_users_expiry_reminder_due
  ON users (plan_expires_at)
  WHERE plan = 'premium' AND expiry_reminder_sent_at IS NULL;

-- ── Row Level Security (§ 3) ────────────────────────────────────────────
-- ตาราง users เปิด RLS อยู่แล้วและไม่มี Policy สำหรับ authenticated/anon (เข้าถึงผ่าน
-- supabaseAdmin / service_role เท่านั้น) การเพิ่มคอลัมน์ไม่กระทบ RLS เดิม

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- Migration นี้ Additive ล้วน (ไม่แก้/ไม่ลบข้อมูลเดิมแม้แต่แถวเดียว) Rollback ปลอดภัย
-- และไม่มีข้อมูลเดิมสูญหาย:
--
--   DROP INDEX IF EXISTS idx_users_expiry_reminder_due;
--   ALTER TABLE users DROP COLUMN IF EXISTS expiry_reminder_sent_at;
--
-- สิ่งที่จะเสียไปถ้า Rollback: ความจำว่า "เตือนใครไปแล้วบ้างในรอบบิลนี้" — ผลกระทบแค่
-- ผู้ใช้อาจได้รับการเตือนซ้ำอีกใบเดียวหลัง Re-apply ไม่กระทบสิทธิ์/รายได้
