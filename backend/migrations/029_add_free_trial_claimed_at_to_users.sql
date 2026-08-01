-- ═══════════════════════════════════════════════════════════════════════
-- Migration 029 — users.free_trial_claimed_at
-- ═══════════════════════════════════════════════════════════════════════
-- Guard "กดรับ Premium ฟรีได้ครั้งเดียวตลอดชีพ" ของแคมเปญ Self-service Free Trial
--
-- ⚠️ Additive ล้วน: NULLABLE ไม่มี DEFAULT ไม่มี Backfill → ทุกแถวเดิมเป็น NULL ซึ่งเป็น
-- ค่าที่ถูกต้องอยู่แล้วตามความหมาย (ยังไม่เคยกดรับ) โค้ดเดิมทั้งหมดไม่ได้อ่านคอลัมน์นี้
-- จึงไม่กระทบอะไรเลยแม้จะ Apply Migration ก่อน Deploy Code ใหม่ (ลำดับที่บังคับใช้ในโปรเจกต์นี้)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ทำไมต้องเป็นคอลัมน์บน users (ไม่ใช่ตารางแยก / ไม่ใช้ premium_grant_logs เดิม):
--   ข้อกำหนดคือ "1 User ได้สิทธิ์ครั้งเดียวตลอดชีพ" ซึ่งต้องกัน Race ให้ได้จริง
--   (กดรัวสองครั้งพร้อมกัน / เปิดสองแท็บ) — Supabase JS Client ไม่รองรับ
--   Multi-statement Transaction (ทั้งโปรเจกต์ไม่มี RPC/Transaction เลย) วิธีเดียวที่
--   Atomic ได้จริงคือทำให้ "การให้สิทธิ์" กับ "การปั๊มว่าใช้สิทธิ์แล้ว" เกิดใน
--   UPDATE Statement เดียวกัน:
--
--     UPDATE users SET plan='premium', plan_expires_at=..., free_trial_claimed_at=now()
--     WHERE id=? AND free_trial_claimed_at IS NULL
--
--   ถ้าคืน 0 แถว = มีคนชิงไปแล้ว (Pattern เดียวกับ payment.repository.claimForApproval
--   ที่ใช้ WHERE status IN (...) เป็น Atomic Claim อยู่แล้ว)
--
--   ⚠️ ใช้ premium_grant_logs (migration 023) เป็น Guard แทนไม่ได้ เพราะ (ก) ตารางนั้น
--   ไม่มี UNIQUE constraint → INSERT พร้อมกันสองครั้งผ่านทั้งคู่ (ข) adminGrant.service
--   เขียน Log แบบ best-effort ใน try/catch (Log พังแต่ Grant สำเร็จ) → เชื่อถือเป็น
--   แหล่งตัดสินสิทธิ์ไม่ได้ตามการออกแบบเดิมของมันเอง
--
-- NULL = ยังไม่เคยกดรับ (ค่าเริ่มต้นของทุกคน) / มีค่า = เคยกดรับแล้ว ห้ามกดอีกตลอดไป
-- (ค่านี้ "ห้ามถูก Reset" ไม่ว่ากรณีใด — แม้ Premium หมดอายุไปแล้วก็ตาม)
ALTER TABLE users ADD COLUMN free_trial_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.free_trial_claimed_at IS
  'เวลาที่ผู้ใช้กดรับ Premium ฟรี 1 เดือนด้วยตัวเอง (Self-service Free Trial) — NULL = ยังไม่เคยรับ. ใช้เป็น Atomic Claim Guard ใน WHERE ... IS NULL ห้าม Reset เด็ดขาด (สิทธิ์ครั้งเดียวตลอดชีพ)';

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- ไม่ต้องมี Index: ถูกอ่าน/เขียนผ่าน WHERE id = ? (Primary Key) เสมอ ไม่เคยมี Query
-- ที่กรองด้วยคอลัมน์นี้เพียงลำพัง

-- ── Row Level Security (§ 3) ────────────────────────────────────────────
-- ตาราง users เปิด RLS อยู่แล้วตั้งแต่ก่อนมี Migration Folder นี้ และไม่มี Policy
-- สำหรับ authenticated/anon (เข้าถึงผ่าน supabaseAdmin / service_role เท่านั้น)
-- การเพิ่มคอลัมน์ไม่กระทบ RLS เดิม จึงไม่ต้องทำอะไรเพิ่ม

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- Migration นี้ Additive ล้วน (ไม่แก้/ไม่ลบข้อมูลเดิมแม้แต่แถวเดียว) การ Rollback จึง
-- ปลอดภัยและไม่มีข้อมูลเดิมสูญหาย:
--
--   ALTER TABLE users DROP COLUMN IF EXISTS free_trial_claimed_at;
--
-- ⚠️ สิ่งที่จะเสียไปถ้า Rollback: ประวัติว่า "ใครกดรับ Free Trial ไปแล้วบ้าง" —
-- ถ้าเคยเปิดใช้งานจริงบน Production แล้วต้อง Rollback ให้ Export ค่าไว้ก่อนเสมอ:
--   SELECT id, line_user_id, free_trial_claimed_at FROM users
--    WHERE free_trial_claimed_at IS NOT NULL;
-- (มิฉะนั้นคนที่เคยกดรับแล้วจะกดรับซ้ำได้อีกครั้งหลัง Re-apply — เสียรายได้)
-- หมายเหตุ: premium_grant_logs ยังเก็บร่องรอยการ Grant ไว้เป็น Backup อีกชั้น
-- (freeTrial.service เขียน Log ไว้ด้วย granted_by='self_service_free_trial')
