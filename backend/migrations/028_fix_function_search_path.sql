-- ═══════════════════════════════════════════════════════════════════════
-- Migration 028 — Fix Function Search Path Mutable (Supabase Security Advisor)
-- ═══════════════════════════════════════════════════════════════════════
-- Supabase Security Advisor แจ้ง Warning (ไม่ใช่ Error) สำหรับ 2 Function นี้ว่า
-- ไม่ได้ล็อกค่า search_path ไว้ตายตัว — ช่องโหว่ทางทฤษฎีคือถ้ามีใคร Create Schema/
-- Function ชื่อชนกับที่ Function อ้างถึงแบบไม่ Qualify Schema (เช่น "ai_ocr_usage"
-- เฉยๆ ไม่ใช่ "public.ai_ocr_usage") ใน Schema ที่มาก่อน public ใน search_path
-- ของ Session ที่เรียก Function นั้น อาจทำให้ Query ไปโดน Object ปลอมแทน Object
-- จริงใน public โดยไม่รู้ตัว (Search Path Injection) — ล็อกค่าให้ Function เห็น
-- เฉพาะ public + pg_temp เสมอไม่ว่า Session ที่เรียกจะตั้ง search_path เป็นอะไร
--
-- ตรวจสอบแล้ว (อ่านนิยาม Function จริงบน Production ผ่าน pg_get_functiondef ก่อน
-- แก้ — ตรงกับที่นิยามไว้ใน DATABASE.md § 4 และ migrations/011 ทุกประการ):
--   - update_updated_at(): อ้างถึงแค่ NEW.updated_at + now() (Built-in ใน
--     pg_catalog ซึ่ง Postgres ค้นหาก่อน search_path เสมอไม่ว่าตั้งอย่างไร) ไม่มี
--     Table/Function อื่นที่ต้อง Qualify Schema เพิ่ม
--   - increment_ai_ocr_usage(): อ้างถึง Table "ai_ocr_usage" (ไม่ Qualify Schema)
--     ซึ่งอยู่ใน public เท่านั้น (migrations/011) + now() (Built-in เช่นกัน)
-- ทั้งคู่ไม่ต้องเข้าถึง Schema อื่นนอกจาก public เลย → SET search_path = public,
-- pg_temp ครอบคลุมพอ (pg_temp ต้องมีไว้เสมอสำหรับ Temp Table/Object ตาม Postgres
-- Best Practice ไม่เกี่ยวกับ Schema Data ของแอป)
--
-- แก้แค่ search_path เท่านั้น — ไม่แตะ Logic ภายใน Function, ไม่ Drop+Recreate
-- (ALTER FUNCTION ไม่กระทบ Trigger ที่ผูกอยู่ ตัว Function เดิมยังเป็น Object
-- เดียวกัน แค่เพิ่ม Config proconfig เข้าไป)
-- ═══════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.update_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.increment_ai_ocr_usage(p_user_id UUID, p_year_month TEXT)
  SET search_path = public, pg_temp;
