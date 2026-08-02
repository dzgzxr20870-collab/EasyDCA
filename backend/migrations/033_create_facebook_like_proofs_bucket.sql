-- ═══════════════════════════════════════════════════════════════════════
-- Migration 033 — Storage Bucket 'facebook-like-proofs' (Private)
-- ═══════════════════════════════════════════════════════════════════════
-- ถังเก็บ Screenshot หลักฐานการกด Like Facebook Page (แคมเปญ Premium ฟรี 1 เดือน
-- — ดู migration 031/032 + storage.service.uploadFacebookLikeProof)
--
-- ⚠️ หมายเหตุสำคัญเรื่อง "Bucket สร้างผ่าน SQL ได้": Comment ในไฟล์เก่าของโปรเจกต์
-- (storage.service.js — payment-slips/reports/transaction-slips) เขียนไว้ว่า Bucket
-- "สร้างผ่าน Migration SQL ไม่ได้ตามปกติ ต้องสร้างผ่าน Dashboard" ซึ่ง **ไม่ถูกต้อง**
-- — Supabase Storage เก็บรายการถังไว้ในตาราง `storage.buckets` ธรรมดา จึง INSERT ผ่าน
-- SQL Editor ได้ตรงๆ (ยืนยันจริงในรอบนี้) ถังเก่า 3 ใบถูกสร้างผ่าน Dashboard UI ไปแล้ว
-- จึงไม่มี Migration ย้อนหลังให้ — ถังใหม่ตั้งแต่นี้ไปให้บันทึกเป็น Migration แบบไฟล์นี้
-- เพื่อให้ตั้งสภาพแวดล้อมใหม่ได้ครบโดยไม่ต้องจำขั้นตอนกดมือ
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS)
-- ═══════════════════════════════════════════════════════════════════════

-- public = false → Private Bucket โดยเจตนา (ต่างจาก payment-slips ที่ Public)
--   Screenshot หน้า Facebook มักติดชื่อจริง/รูปโปรไฟล์/รายชื่อเพื่อนของผู้ใช้ ซึ่งเป็น
--   PII ที่ถ้าเป็น Public URL หลุดออกไปครั้งเดียวจะเปิดดูได้ตลอดกาลโดยไม่ต้อง Login
--   (§ 4.3 PDPA — เหตุผลเดียวกับถัง transaction-slips) Admin เข้าถึงผ่าน Signed URL
--   อายุ 5 นาทีที่ Backend สร้างให้เท่านั้น (storage.createFacebookLikeProofSignedUrl)
--
-- file_size_limit = 10485760 (10 MB) → ตรงกับ storage.service.MAX_SLIP_SIZE_BYTES
--   เป็นด่านที่ 3 ต่อจาก express.raw limit (support.routes) และ Guard ใน Service
--   (บังคับที่ระดับ Storage เองด้วย เผื่อมีทางเข้าใหม่ในอนาคตที่ลืมตรวจ)
--
-- allowed_mime_types → ตรงกับ storage.service.ALLOWED_SLIP_CONTENT_TYPES เป๊ะ
--   (กันไฟล์ที่ไม่ใช่รูปถูกอัปโหลดขึ้นถังจริง แม้ Layer บนจะพลาด)
--
-- ON CONFLICT DO NOTHING → รันซ้ำได้ปลอดภัย (Idempotent) ถ้าถังถูกสร้างไว้ก่อนแล้ว
-- ผ่าน Dashboard จะไม่ Error และไม่ทับค่าเดิม
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'facebook-like-proofs',
  'facebook-like-proofs',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ── Row Level Security (§ 3) ────────────────────────────────────────────
-- ไม่ต้องสร้าง Policy ใดๆ: storage.objects เปิด RLS อยู่แล้วโดย Supabase และเราไม่
-- สร้าง Policy สำหรับ authenticated/anon เลย → เข้าถึงได้ผ่าน service_role เท่านั้น
-- (Pattern เดียวกับถัง reports/transaction-slips ที่ใช้อยู่) Backend ทุกจุดเข้าถึงผ่าน
-- supabaseAdmin อยู่แล้ว ส่วนผู้ใช้/Admin เห็นรูปผ่าน Signed URL ที่ Backend สร้างให้

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ต้องลบไฟล์ในถังให้หมดก่อน มิฉะนั้น DELETE จะติด FK ของ storage.objects:
--
--   DELETE FROM storage.objects WHERE bucket_id = 'facebook-like-proofs';
--   DELETE FROM storage.buckets WHERE id = 'facebook-like-proofs';
--
-- ⚠️ สิ่งที่จะเสียไป: Screenshot หลักฐานทั้งหมดที่ผู้ใช้เคยส่งมา (ลบแล้วกู้ไม่ได้) —
-- แถวใน facebook_like_grant_requests ยังอยู่ครบ แต่ screenshot_path จะชี้ไปไฟล์ที่ไม่มี
-- แล้ว (createFacebookLikeProofSignedUrl คืน null เอง หน้า Admin แสดง "เปิดรูปไม่ได้"
-- โดยไม่พัง) และ **ไม่กระทบสิทธิ์ Premium ที่อนุมัติไปแล้ว** (อยู่ที่ users.plan/
-- plan_expires_at + facebook_like_granted_at คนละที่กับถังนี้)
