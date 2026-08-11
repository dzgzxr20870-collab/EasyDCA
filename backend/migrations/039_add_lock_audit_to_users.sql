-- ═══════════════════════════════════════════════════════════════════════
-- Migration 039 — Audit Trail ของการล็อกบัญชี (Offensive Review R2 — F7)
-- ═══════════════════════════════════════════════════════════════════════
-- users.is_locked + users.locked_at มีอยู่แล้วตั้งแต่ Schema แรก (DATABASE.md § 89)
-- แต่ "ไม่มีทางตั้งค่าได้เลย" ในโค้ดทั้งโปรเจกต์ — Grep แล้วพบว่ามีแค่ 2 จุดที่ "อ่าน"
-- (freeTrial.service:68, facebookLikeGrant.service:83) และ 0 จุดที่ "เขียน"
--
-- แปลว่า Flag นี้เป็น Dead Column มาตลอด: ต่อให้เจอบัญชีที่ Abuse ระบบจริงๆ
-- (ยิง OCR รัว/ส่งสลิปปลอมซ้ำ/สร้างคำขอชำระเงินถี่ผิดปกติ) ก็ไม่มีเครื่องมือหยุดเลย
-- นอกจากเข้าไปแก้ Row ใน Supabase Dashboard ด้วยมือ ซึ่งไม่เหลือร่องรอยว่าใครทำ
-- ตอนไหน เพราะอะไร
--
-- ── ทำไมต้องมี 2 คอลัมน์นี้ ────────────────────────────────────────────────
-- การล็อกบัญชีคือการตัดสิทธิ์เข้าถึงข้อมูลของผู้ใช้จริง ซึ่งเป็นการกระทำที่ต้องตอบได้
-- เสมอว่า "ใครสั่ง เมื่อไหร่ ด้วยเหตุผลอะไร" — ถ้าผู้ใช้ทักมาถามว่าทำไมใช้งานไม่ได้
-- แล้วเราตอบไม่ได้ นั่นคือปัญหาทั้งเชิงบริการและเชิง PDPA (สิทธิ์ได้รับคำอธิบาย)
--
-- Pattern ลอกมาจาก premium_grant_logs (migration 025) ที่เก็บ granted_by/reason
-- ด้วยเหตุผลเดียวกันเป๊ะ — ต่างกันแค่ตรงนั้นเป็นตารางแยก ส่วนนี้เป็นคอลัมน์บน users
-- เพราะสถานะล็อกเป็น "สถานะปัจจุบัน 1 ค่าต่อ user" ไม่ใช่ "ประวัติหลายรายการ"
-- (ถ้าวันหนึ่งต้องการประวัติล็อก/ปลดล็อกย้อนหลังทั้งหมด ค่อยเพิ่มตาราง Log แยกทีหลัง
-- ได้โดยไม่ต้องแก้คอลัมน์ชุดนี้)
--
-- ── ทำไม Nullable (ไม่มี DEFAULT) ─────────────────────────────────────────
-- ตรงกับ Pattern คอลัมน์ TIMESTAMPTZ/audit เดิมทั้งหมดของโปรเจกต์ (locked_at,
-- anonymized_at, free_trial_claimed_at): NULL = "ไม่เคยเกิดเหตุการณ์นี้"
-- บัญชีที่ไม่เคยถูกล็อกจึงมีค่าเป็น NULL ทั้งคู่ ซึ่งเป็นความหมายที่ถูกต้องอยู่แล้ว
-- ไม่ต้อง Backfill อะไรเลย (ไม่มีบัญชีไหนถูกล็อกอยู่ ณ ตอนนี้ เพราะเขียนไม่ได้มาตลอด)
--
-- อ้างอิงหลักการ: DATABASE.md § 8 (Soft Delete Policy), § 9 (ALTER TABLE Additive)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_by  TEXT,
  ADD COLUMN IF NOT EXISTS lock_reason TEXT;

COMMENT ON COLUMN users.locked_by IS
  'LINE User ID ของ Admin ที่สั่งล็อกบัญชีนี้ (Pattern เดียวกับ premium_grant_logs.granted_by) — NULL = ไม่เคยถูกล็อก';

COMMENT ON COLUMN users.lock_reason IS
  'เหตุผลที่ล็อกบัญชี (บังคับกรอกตอนล็อก ดู admin.controller.lockUser) — เก็บไว้ตอบผู้ใช้ได้ว่าทำไมใช้งานไม่ได้ และให้ Admin คนอื่นเข้าใจบริบท NULL = ไม่เคยถูกล็อก';

-- ⚠️ จงใจ "ไม่" ล้าง locked_by/lock_reason ตอนปลดล็อก (ดู user.repository.setLock)
-- — ค่าที่ค้างอยู่คือประวัติว่า "เคยถูกล็อกด้วยเหตุผลนี้" ซึ่งมีประโยชน์ตอนเจอเคสซ้ำ
-- ตัวชี้ขาดว่าบัญชีถูกล็อกอยู่หรือไม่คือ is_locked เท่านั้น ไม่ใช่คอลัมน์สองตัวนี้

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- ไม่ต้องมี: สองคอลัมน์นี้ไม่เคยถูกใช้เป็นเงื่อนไข WHERE (อ่านคู่กับ Row ที่ดึงด้วย
-- id/line_user_id อยู่แล้วเสมอ) การเพิ่ม Index จะเป็นต้นทุนเขียนเปล่าๆ

-- ── Row Level Security (§ 3) ────────────────────────────────────────────
-- users เปิด RLS อยู่แล้วและไม่มี Policy ให้ anon/authenticated — Backend เข้าถึง
-- ด้วย service_role เท่านั้น การเพิ่มคอลัมน์ไม่กระทบ RLS เดิม

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) คอลัมน์มีจริงทั้ง 2 ตัว + Nullable
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'users' AND column_name IN ('locked_by', 'lock_reason')
--    ORDER BY column_name;
--   คาดหวัง: 2 แถว — lock_reason | text | YES , locked_by | text | YES
--
-- 2) ไม่มีบัญชีไหนถูกล็อกค้างอยู่ (ต้องได้ 0 — Flag นี้ไม่เคยถูกเขียนมาก่อนเลย)
--   SELECT count(*) FROM users WHERE is_locked = true;
--
-- 3) Smoke Test (หลัง Deploy Code) — ล็อกบัญชีทดสอบผ่าน Endpoint ใหม่แล้วเช็คว่า
--    ครบทั้ง 4 คอลัมน์ จากนั้นปลดล็อกแล้วเช็คว่า is_locked กลับเป็น false
--   POST /api/v1/admin/users/{id}/lock   Body: { "reason": "ทดสอบระบบ" }
--   SELECT id, is_locked, locked_at, locked_by, lock_reason FROM users WHERE id = '...';
--   คาดหวัง: true | เวลาปัจจุบัน | LINE User ID ของ Admin | 'ทดสอบระบบ'
--   POST /api/v1/admin/users/{id}/unlock
--   คาดหวัง: is_locked = false (locked_by/lock_reason ยังค้างไว้เป็นประวัติ โดยตั้งใจ)

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5)
-- ═══════════════════════════════════════════════════════════════════════
--   ALTER TABLE users DROP COLUMN IF EXISTS lock_reason;
--   ALTER TABLE users DROP COLUMN IF EXISTS locked_by;
--
-- ⚠️ ต้อง Rollback "โค้ดก่อน แล้วค่อย DB" ตามลำดับนี้เท่านั้น — ถ้า DROP คอลัมน์ทิ้ง
-- ขณะที่โค้ดใหม่ยังรันอยู่ Endpoint lock/unlock จะพังทันที
-- ⚠️ สิ่งที่จะเสียไป: เหตุผล/ผู้สั่งล็อกของบัญชีที่ถูกล็อกอยู่ (is_locked เองไม่หาย
-- บัญชีที่ถูกล็อกจะยังถูกล็อกต่อไป แต่ไม่มีใครรู้แล้วว่าทำไม) — ถ้าจะ Rollback จริง
-- ควร SELECT เก็บค่าไว้ก่อน:
--   SELECT id, locked_at, locked_by, lock_reason FROM users WHERE is_locked = true;
