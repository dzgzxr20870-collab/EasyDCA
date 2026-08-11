-- ═══════════════════════════════════════════════════════════════════════
-- Migration 037 — REVOKE/GRANT ให้ increment_ai_ocr_usage() (Offensive Review R2 — G2)
-- ═══════════════════════════════════════════════════════════════════════
-- increment_ai_ocr_usage() ถูกสร้างใน migration 011 ก่อนที่โปรเจกต์จะมี Pattern
-- เรื่องสิทธิ์ของ Function (ซึ่งมาทีหลังตอน 034/035/036) จึงยังไม่เคยถูก REVOKE เลย
--
-- ⚠️ Postgres GRANT EXECUTE ให้ PUBLIC "โดยปริยาย" ทุกครั้งที่ CREATE FUNCTION
-- ถ้าไม่ REVOKE เอง — แปลว่า role `anon` (Key ที่ออกแบบมาให้เปิดเผยได้) และ
-- `authenticated` มีสิทธิ์เรียก RPC ตัวนี้ผ่าน PostgREST ได้ตั้งแต่ migration 011
--
-- ── ระดับความเสี่ยงจริง (ไม่พูดเกินจริง) ────────────────────────────────────
-- "เรียกได้" ไม่เท่ากับ "ทำอะไรได้" — Function นี้เป็น SECURITY INVOKER (ไม่ใช่
-- DEFINER) จึงรันด้วยสิทธิ์ของผู้เรียก และตาราง ai_ocr_usage เปิด RLS ไว้โดยไม่มี
-- Policy ให้ anon/authenticated เลย (migration 011 บรรทัด 61-64) → INSERT/UPDATE
-- ข้างในจะถูก RLS ปฏิเสธอยู่ดี ประกอบกับ SUPABASE_ANON_KEY ของโปรเจกต์นี้ไม่เคยถูก
-- เผยแพร่ที่ไหนเลย (Frontend ใช้แค่ VITE_API_BASE_URL — ยืนยันจากการ Grep ทั้ง Repo)
--
-- Migration นี้จึงเป็น "Defense in Depth + ความสม่ำเสมอ" ไม่ใช่การปิดช่องโหว่ที่ยิงได้
-- จริงวันนี้ — แต่ควรทำเพราะ (1) ถ้าวันหนึ่งมีคนเพิ่ม RLS Policy ให้ตารางนี้ หรือ
-- (2) เปลี่ยน Function เป็น SECURITY DEFINER สิทธิ์ที่ค้างอยู่จะกลายเป็นช่องจริงทันที
-- โดยไม่มีใครทันสังเกต
--
-- ── ทำไมไม่เปลี่ยนเป็น SECURITY DEFINER ให้เหมือน 034/035/036 ────────────────
-- 034/035/036 ต้องเป็น DEFINER เพราะต้อง Lock แถว + เขียนข้ามตารางในธุรกรรมเดียว
-- ส่วนตัวนี้แค่ UPSERT แถวเดียวในตารางของตัวเอง และ Backend เรียกด้วย service_role
-- (Bypass RLS อยู่แล้ว) — การคง INVOKER ไว้ให้สิทธิ์ "น้อยที่สุดเท่าที่ยังทำงานได้"
-- ซึ่งปลอดภัยกว่า ไม่ใช่แย่กว่า จึงแก้เฉพาะเรื่องสิทธิ์ ไม่แตะ Logic ภายในแม้แต่บรรทัดเดียว
-- ═══════════════════════════════════════════════════════════════════════

-- ⚠️ ต้องระบุ Signature เต็ม (Argument Types) เสมอ — Postgres แยก Function ด้วย
-- ชื่อ+Argument ถ้าเขียนแค่ชื่อจะ Error ทันทีถ้ามี Overload (Pattern เดียวกับ 034/036)
REVOKE ALL ON FUNCTION public.increment_ai_ocr_usage(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_ai_ocr_usage(UUID, TEXT)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply — ต้องได้ผลตามที่ระบุ ก่อนถือว่า Migration สำเร็จ)
-- ═══════════════════════════════════════════════════════════════════════
-- คาดหวัง: คืน "แถวเดียว" ที่ has_service_role = true และ has_public/has_anon/
-- has_authenticated = false ทั้งหมด
--
--   SELECT p.proname,
--          has_function_privilege('service_role',   p.oid, 'EXECUTE') AS has_service_role,
--          has_function_privilege('public',         p.oid, 'EXECUTE') AS has_public,
--          has_function_privilege('anon',           p.oid, 'EXECUTE') AS has_anon,
--          has_function_privilege('authenticated',  p.oid, 'EXECUTE') AS has_authenticated
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'increment_ai_ocr_usage';
--
-- Smoke Test (ต้องยังทำงานปกติหลัง REVOKE — Backend ใช้ service_role):
--   ส่งรูปสลิปผ่าน LINE ด้วยบัญชี Premium 1 ครั้ง แล้วเช็คว่า count ขยับจริง
--   SELECT user_id, year_month, count FROM ai_ocr_usage
--    WHERE year_month = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM');

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- Migration นี้แก้เฉพาะ "สิทธิ์" ไม่แตะ Schema/ข้อมูล/Logic เลย — Rollback คืนค่า
-- เดิม (PUBLIC มี EXECUTE) ได้ด้วย:
--
--   GRANT EXECUTE ON FUNCTION public.increment_ai_ocr_usage(UUID, TEXT) TO PUBLIC;
--
-- ⚠️ ไม่มีข้อมูลใดสูญหายจากทั้งการ Apply และการ Rollback (ไม่มี DML เลย)
-- ⚠️ ถ้า Apply แล้ว OCR พัง (ไม่ควรเกิด — Backend ใช้ service_role) ให้ Rollback
--    ทันทีแล้วรายงาน เพราะแปลว่ามี Path ไหนสักที่เรียก RPC นี้ด้วย Key อื่นอยู่จริง
--    ซึ่งเป็นข้อมูลสำคัญที่ต้องสืบต่อ (ไม่ใช่แค่ GRANT กลับแล้วจบ)
