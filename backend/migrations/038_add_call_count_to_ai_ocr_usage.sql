-- ═══════════════════════════════════════════════════════════════════════
-- Migration 038 — ai_ocr_usage.call_count (Offensive Review R2 — F2)
-- ═══════════════════════════════════════════════════════════════════════
-- ปิดช่องเผาเงินค่า Claude Vision: โควตาเดิม (ai_ocr_usage.count = 50/เดือน) นับ
-- เฉพาะ "อ่านสลิปสำเร็จ" เท่านั้น (slipOcr.service.js — incrementUsage ถูกเรียก
-- หลัง Validate ผ่านครบ) ซึ่งเป็นเจตนาที่ถูกต้องในเชิง UX แต่ทำให้เกิดผลข้างเคียงว่า
-- "การเรียก Claude ที่ล้มเหลว ไม่ถูกนับอะไรเลย" ทั้งที่จ่ายเงินไปแล้วจริง
--
-- ผลคือ: ส่งรูปที่ไม่ใช่สลิป (รูปวิว/รูปดำ) เข้าไปเรื่อยๆ → Claude ถูกเรียกและถูกเก็บเงิน
-- ทุกครั้ง → is_slip=false → throw ออกก่อนถึงบรรทัดที่นับโควตา → count ไม่ขยับเลย
-- เพดาน 50/เดือนจึงไม่มีวันเต็ม ยิงได้ 6 ครั้ง/นาที (ตาม Rate Limit 10 วิ) ไม่จำกัดวัน
--
-- คอลัมน์นี้คือ "เพดานที่สอง" ที่นับ **ทุกครั้งที่กำลังจะเรียก Claude** ไม่ว่าผลจะเป็น
-- อย่างไร — แยกความหมายกันชัดเจนกับ count เดิม:
--   count      = จำนวนสลิปที่ "อ่านสำเร็จ" (โควตาที่สัญญากับผู้ใช้ = 50/เดือน)
--   call_count = จำนวนครั้งที่ "เรียก Claude จริง" (เพดานคุมต้นทุน = 200/เดือน)
--
-- ── ทำไมเพิ่มคอลัมน์ในตารางเดิม ไม่สร้างตารางใหม่ ────────────────────────────
-- ทั้งสองค่าถูกนับด้วย Key เดียวกันเป๊ะ (user_id, year_month) รอบ Reset เดียวกัน
-- (เดือนปฏิทิน Asia/Bangkok) และถูกอ่าน "พร้อมกันเสมอ" ใน Request เดียวกัน —
-- ตารางใหม่จะกลายเป็น JOIN/Query ที่สองโดยไม่ได้อะไรกลับมาเลย
--
-- ── ทำไม NOT NULL DEFAULT 0 (ต่างจาก Pattern คอลัมน์ TIMESTAMPTZ Nullable เดิม) ──
-- นี่เป็น "ตัวนับ" ไม่ใช่ "เวลาที่เกิดเหตุการณ์" — NULL ไม่มีความหมายที่ถูกต้องเลย
-- (แถวเดิมที่มีอยู่แล้วแปลว่า "เคยเรียก Claude ไปแล้วอย่างน้อย count ครั้ง" แต่เรา
-- ไม่รู้จำนวนจริงย้อนหลัง) การ Backfill เป็น 0 จึงเป็นการ "ให้เครดิตย้อนหลัง" กับ
-- ผู้ใช้เดิมโดยตั้งใจ — ปลอดภัยกว่าการเดาตัวเลขที่ไม่มีข้อมูลรองรับ และมีผลแค่เดือน
-- ปัจจุบันเดือนเดียวเท่านั้น (เดือนหน้าเริ่มนับใหม่จาก 0 อยู่แล้วตามการออกแบบเดิม)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 9 (ALTER TABLE Additive)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE ai_ocr_usage
  ADD COLUMN call_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN ai_ocr_usage.call_count IS
  'จำนวนครั้งที่เรียก Claude Vision API จริงในเดือนนั้น (นับทุกครั้งที่กำลังจะยิง ไม่ว่าจะอ่านสลิปสำเร็จหรือไม่) — เพดานคุมต้นทุน แยกจาก count ที่นับเฉพาะ "อ่านสำเร็จ" ตามโควตาที่สัญญากับผู้ใช้ ดู slipOcr.service.MONTHLY_CALL_LIMIT';

-- ── RPC: เพิ่มตัวนับแล้วคืนค่าใหม่ (Atomic) ────────────────────────────────
-- ⚠️ ต้องเป็น "Increment แล้วค่อยตัดสินจากค่าที่คืนมา" ไม่ใช่ "อ่านก่อนแล้วค่อยเพิ่ม" —
-- แบบหลังเป็น check-then-act ที่ผู้ใช้ยิงขนานทะลุได้ (บทเรียนเดียวกับ Oversell Race
-- ที่ migration 034 แก้) ฝั่ง Service จึงเรียกตัวนี้ "ก่อน" ยิง Claude แล้วดูค่าที่คืนมา
--
-- โครงสร้าง UPSERT ลอกมาจาก increment_ai_ocr_usage (migration 011) ทุกบรรทัด
-- เปลี่ยนแค่คอลัมน์ที่เพิ่ม — จงใจไม่รวมสองตัวนับไว้ใน Function เดียว เพราะถูกเรียก
-- คนละจังหวะกันโดยเจตนา (call_count = ก่อนยิง / count = หลังอ่านสำเร็จ)
CREATE OR REPLACE FUNCTION public.increment_ai_ocr_call_count(
  p_user_id UUID,
  p_year_month TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
-- SECURITY INVOKER (Default) เหมือน increment_ai_ocr_usage — Backend เรียกด้วย
-- service_role ซึ่ง Bypass RLS อยู่แล้ว ไม่มีเหตุผลต้องยกสิทธิ์เป็น DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO ai_ocr_usage (user_id, year_month, count, call_count)
  VALUES (p_user_id, p_year_month, 0, 1)
  ON CONFLICT (user_id, year_month)
  DO UPDATE SET call_count = ai_ocr_usage.call_count + 1, updated_at = now()
  RETURNING call_count INTO new_count;

  RETURN new_count;
END;
$$;

-- สิทธิ์ — Pattern เดียวกับ migration 037/034/035/036 (ไม่ปล่อยให้ PUBLIC ติดมา
-- โดยปริยายเหมือนที่ increment_ai_ocr_usage เคยเป็นมาตั้งแต่ migration 011)
REVOKE ALL ON FUNCTION public.increment_ai_ocr_call_count(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_ai_ocr_call_count(UUID, TEXT)
  TO service_role;

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- ไม่ต้องมี: อ่าน/เขียนผ่าน (user_id, year_month) ซึ่งเป็น Unique Constraint เดิม
-- ของตารางอยู่แล้ว (migration 011) — คอลัมน์นี้ไม่เคยถูกใช้เป็นเงื่อนไข WHERE เดี่ยวๆ

-- ── Row Level Security (§ 3) ────────────────────────────────────────────
-- ai_ocr_usage เปิด RLS อยู่แล้วและไม่มี Policy ให้ anon/authenticated
-- (migration 011) — การเพิ่มคอลัมน์/Function ไม่กระทบ RLS เดิม

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) คอลัมน์มีจริง + NOT NULL + DEFAULT 0
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'ai_ocr_usage' AND column_name = 'call_count';
--   คาดหวัง: integer | NO | 0
--
-- 2) แถวเดิมถูก Backfill เป็น 0 ครบ (ต้องได้ 0 แถว)
--   SELECT count(*) FROM ai_ocr_usage WHERE call_count IS NULL;
--
-- 3) สิทธิ์ของ Function ใหม่ (คาดหวัง service_role=true, ที่เหลือ false)
--   SELECT has_function_privilege('service_role',  p.oid, 'EXECUTE') AS has_service_role,
--          has_function_privilege('public',        p.oid, 'EXECUTE') AS has_public,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS has_anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS has_authenticated
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='increment_ai_ocr_call_count';
--
-- 4) Smoke Test — ส่งรูป "ที่ไม่ใช่สลิป" ผ่าน LINE ด้วยบัญชี Premium 1 ครั้ง
--    คาดหวัง: call_count = +1 แต่ count เท่าเดิม (นี่คือหัวใจของ Migration นี้)
--   SELECT user_id, year_month, count, call_count FROM ai_ocr_usage
--    WHERE year_month = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM');

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5)
-- ═══════════════════════════════════════════════════════════════════════
--   DROP FUNCTION IF EXISTS public.increment_ai_ocr_call_count(UUID, TEXT);
--   ALTER TABLE ai_ocr_usage DROP COLUMN IF EXISTS call_count;
--
-- ⚠️ ต้อง Rollback "โค้ดก่อน แล้วค่อย DB" ตามลำดับนี้เท่านั้น — ถ้า DROP คอลัมน์ทิ้ง
-- ขณะที่โค้ดใหม่ยังรันอยู่ ทุกการอ่านสลิปจะพังทันที (Service เรียก RPC ที่ไม่มีแล้ว)
-- ⚠️ สิ่งที่จะเสียไป: ตัวเลขการใช้งานของ "เดือนปัจจุบัน" เท่านั้น — ไม่กระทบ Ledger
-- ไม่กระทบสิทธิ์ Premium ไม่กระทบ count เดิมที่เป็นโควตาจริงของผู้ใช้แม้แต่นิดเดียว
