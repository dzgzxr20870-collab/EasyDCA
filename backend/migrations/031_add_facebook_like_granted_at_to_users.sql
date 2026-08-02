-- ═══════════════════════════════════════════════════════════════════════
-- Migration 031 — users.facebook_like_granted_at
-- ═══════════════════════════════════════════════════════════════════════
-- Guard "ได้ Premium ฟรีจากแคมเปญ Like Facebook ได้ครั้งเดียวตลอดชีพ"
--
-- ⚠️ Additive ล้วน: NULLABLE ไม่มี DEFAULT ไม่มี Backfill → ทุกแถวเดิมเป็น NULL ซึ่งเป็น
-- ค่าที่ถูกต้องอยู่แล้วตามความหมาย (ยังไม่เคยได้สิทธิ์จากแคมเปญนี้) โค้ดเดิมทั้งหมดไม่ได้
-- อ่านคอลัมน์นี้ จึงไม่กระทบอะไรเลยแม้จะ Apply Migration ก่อน Deploy Code ใหม่
-- (ลำดับที่บังคับใช้ในโปรเจกต์นี้)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 9 (ALTER TABLE Additive), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ── ทำไมต้องเป็นคอลัมน์ "ใหม่" ไม่ใช้ free_trial_claimed_at เดิมร่วมกัน ──────────
--   เป็นคนละแคมเปญกัน (Self-service Free Trial vs Like Facebook) — ถ้าผูก Guard
--   รวมเป็นคอลัมน์เดียว คนที่เคยกด Free Trial ไปแล้วจะถูกตัดสิทธิ์แคมเปญนี้ทันที
--   ทั้งที่ยังไม่เคยได้อะไรจากแคมเปญ Facebook เลย (ไม่ตรงเจตนาและไม่แฟร์กับผู้ใช้)
--
--   ⚠️ แต่ "ได้ทั้งสองแคมเปญ" ก็ต้องไม่เกิดโดยไม่ตั้งใจเช่นกัน — การกันข้ามแคมเปญ
--   ทำที่ชั้น Service (เงื่อนไขการตรวจสิทธิ์) ไม่ใช่ที่ชั้น DB Column:
--     - ฝั่ง Free Trial: freeTrial.service Guard ข้อ 6 เช็ค premium_grant_logs อยู่แล้ว
--       และแคมเปญนี้เขียน Log ลงตารางเดียวกัน → คนที่ได้ Facebook Grant ไปแล้วจะกด
--       Free Trial ไม่ได้เองอัตโนมัติ "โดยไม่ต้องแก้ freeTrial.service เลย"
--     - ฝั่งแคมเปญนี้: ตรวจ free_trial_claimed_at + payments + premium_grant_logs
--       ใน Service ของตัวเอง (ดู facebookLikeGrant.service รอบเดียวกัน)
--   แยก Column จึงให้ทั้งความยืดหยุ่นเชิงนโยบาย (เปลี่ยนกฎข้ามแคมเปญได้ที่ Service
--   โดยไม่ต้อง Migrate ข้อมูล) และคงความ Atomic ของการกันกดซ้ำไว้ครบ

-- ── ทำไมต้องเป็นคอลัมน์บน users (ไม่ใช่อ่านจากตาราง Request/premium_grant_logs) ──
--   ข้อกำหนดคือ "1 User ได้สิทธิ์ครั้งเดียวตลอดชีพ" ซึ่งต้องกัน Race ให้ได้จริง
--   (Admin เผลอกด Approve รัวสองครั้ง / เปิดสองแท็บ) — Supabase JS Client ไม่รองรับ
--   Multi-statement Transaction วิธีเดียวที่ Atomic ได้จริงคือทำให้ "การให้สิทธิ์" กับ
--   "การปั๊มว่าใช้สิทธิ์แล้ว" เกิดใน UPDATE Statement เดียวกัน:
--
--     UPDATE users SET plan='premium', plan_expires_at=...,
--                      facebook_like_granted_at=now()
--      WHERE id=? AND facebook_like_granted_at IS NULL
--
--   ถ้าคืน 0 แถว = มีคนชิงไปแล้ว (Pattern เดียวกับ users.free_trial_claimed_at ใน
--   migration 029 และ payment.repository.claimForApproval)
--
--   ⚠️ ใช้ premium_grant_logs (migration 023) เป็น Guard แทนไม่ได้ ด้วยเหตุผลเดียวกับ
--   ที่ migration 029 อธิบายไว้: ตารางนั้นไม่มี UNIQUE constraint และถูกเขียนแบบ
--   best-effort ใน try/catch (Log พังแต่ Grant สำเร็จ) จึงเชื่อถือเป็นแหล่งตัดสินสิทธิ์
--   ไม่ได้ตามการออกแบบเดิมของมันเอง
--
--   ⚠️ ใช้ facebook_like_grant_requests.status='approved' เป็น Guard แทนก็ไม่ได้
--   เช่นกัน — เป็นคนละตารางกับที่เขียน plan จึงไม่อยู่ใน UPDATE Statement เดียวกัน
--   (ไม่ Atomic ข้ามตารางได้ถ้าไม่มี Transaction)

-- NULL = ยังไม่เคยได้สิทธิ์จากแคมเปญนี้ (ค่าเริ่มต้นของทุกคน) / มีค่า = ได้ไปแล้ว
-- ห้ามได้อีกตลอดไป (ค่านี้ "ห้ามถูก Reset" ไม่ว่ากรณีใด — แม้ Premium หมดอายุไปแล้ว)
ALTER TABLE users ADD COLUMN facebook_like_granted_at TIMESTAMPTZ;

COMMENT ON COLUMN users.facebook_like_granted_at IS
  'เวลาที่ผู้ใช้ได้รับ Premium ฟรี 1 เดือนจากแคมเปญ Like Facebook (Admin ตรวจ Screenshot แล้วกด Approve) — NULL = ยังไม่เคยได้. ใช้เป็น Atomic Claim Guard ใน WHERE ... IS NULL ห้าม Reset เด็ดขาด (สิทธิ์ครั้งเดียวตลอดชีพ) แยกจาก free_trial_claimed_at เพราะเป็นคนละแคมเปญ';

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- ไม่ต้องมี Index: ถูกอ่าน/เขียนผ่าน WHERE id = ? (Primary Key) เสมอ ไม่เคยมี Query
-- ที่กรองด้วยคอลัมน์นี้เพียงลำพัง (เหตุผลเดียวกับ free_trial_claimed_at — migration 029)

-- ── Row Level Security (§ 3) ────────────────────────────────────────────
-- ตาราง users เปิด RLS อยู่แล้ว และไม่มี Policy สำหรับ authenticated/anon (เข้าถึงผ่าน
-- supabaseAdmin / service_role เท่านั้น) การเพิ่มคอลัมน์ไม่กระทบ RLS เดิม

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- Migration นี้ Additive ล้วน (ไม่แก้/ไม่ลบข้อมูลเดิมแม้แต่แถวเดียว):
--
--   ALTER TABLE users DROP COLUMN IF EXISTS facebook_like_granted_at;
--
-- ⚠️ สิ่งที่จะเสียไปถ้า Rollback: ประวัติว่า "ใครได้สิทธิ์แคมเปญนี้ไปแล้วบ้าง" —
-- ถ้าเคยเปิดใช้งานจริงบน Production แล้วต้อง Rollback ให้ Export ค่าไว้ก่อนเสมอ:
--   SELECT id, line_user_id, facebook_like_granted_at FROM users
--    WHERE facebook_like_granted_at IS NOT NULL;
-- (มิฉะนั้นคนที่เคยได้แล้วจะขอซ้ำได้อีกครั้งหลัง Re-apply — เสียรายได้)
-- หมายเหตุ: premium_grant_logs + facebook_like_grant_requests (migration 032) ยังเก็บ
-- ร่องรอยไว้เป็น Backup อีก 2 ชั้น (granted_by='facebook_like_campaign')
