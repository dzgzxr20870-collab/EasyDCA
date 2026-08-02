-- ═══════════════════════════════════════════════════════════════════════
-- Migration 032 — facebook_like_grant_requests
-- ═══════════════════════════════════════════════════════════════════════
-- คำขอรับ Premium ฟรี 1 เดือน จากแคมเปญ "กด Like Facebook Page" — ผู้ใช้ส่ง
-- Screenshot เป็นหลักฐานผ่านหน้า /support แล้ว Admin ตรวจด้วยตาแล้วกด Approve/Reject
-- (Facebook ไม่มี API เช็ค Like ได้ → ตรวจมือ 100% ตามที่ตกลง ไม่มีการเชื่อม FB API ใดๆ)
--
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4 (มีอยู่แล้ว —
-- migration 028 ล็อก search_path ให้เรียบร้อยแล้ว)
--
-- Migration นี้ทำแค่ "Schema" — Repository/Service ที่ใช้ตารางนี้อยู่คนละไฟล์
-- (facebookLikeGrant.repository.js / .service.js รอบเดียวกัน)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (Trigger), § 9 (FK RESTRICT), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ── ทำไมต้องแยกตาราง ไม่ Reuse support_requests (migration 025/026) ──────────────
--   support_requests ถูกออกแบบเป็น "Append-only Log ของการแจ้งเตือน Admin" ล้วนๆ:
--   ไม่มีคอลัมน์ status (ไม่มีอะไรให้ Approve), ไม่มีที่เก็บรูป, และมี Rate Limit
--   1 ครั้ง/ชม./User ผูกกับความหมาย "กันสแปมข้อความหา Support"
--
--   คำขอแคมเปญนี้มี Life Cycle จริง (pending → approved/rejected) ต้องแนบรูป และ
--   ต้อง "ส่งใหม่ได้ทันทีถ้าถูก Reject เพราะรูปไม่ชัด" ซึ่งขัดกับ Rate Limit รายชั่วโมง
--   ของ support_requests โดยตรง — ยัดรวมกันจะทำให้ Query/Filter ฝั่ง Admin ยากขึ้น
--   (ต้องกรอง category ทุก Query) และทำให้ Flow Support เดิมที่ใช้งานได้ดีอยู่แล้ว
--   ต้องแบกเงื่อนไขของแคมเปญชั่วคราวไปด้วย
--
--   ⚠️ ผลพลอยได้ที่ตั้งใจ: support_requests.category ยังคง CHECK constraint เดิม
--   4 ค่า (payment_premium/ocr/portfolio_ledger/other) ไม่ต้องแก้เลย — แคมเปญนี้
--   ไม่เคยเขียนแถวลงตารางนั้น

CREATE TABLE facebook_like_grant_requests (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 (users Row ไม่เคยถูก DELETE จริง Anonymize เท่านั้น
  -- FK จึงอ้างอิงได้เสมอไม่มี Orphan — Pattern เดียวกับ premium_grant_logs)
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Path ของรูป Screenshot ใน Supabase Storage (Private Bucket 'facebook-like-proofs')
  -- เก็บ "path" ไม่ใช่ URL เต็ม เพราะ Bucket เป็น Private — ต้องสร้าง Signed URL อายุ
  -- สั้นตอน Admin กดดูทุกครั้ง (Pattern เดียวกับ transactions.slip_image_path / S8)
  --
  -- ⚠️ Private โดยเจตนา (ต่างจาก payment-slips ที่ Public): Screenshot หน้า Facebook
  -- มักติดชื่อจริง/รูปโปรไฟล์/รายชื่อเพื่อนของผู้ใช้ ซึ่งเป็น PII ที่ไม่ควรเปิดสาธารณะ
  -- ถาวร (§ 4.3 PDPA — เหตุผลเดียวกับ Bucket transaction-slips)
  screenshot_path   TEXT          NOT NULL,

  -- ข้อความเพิ่มเติมจากผู้ใช้ (ไม่บังคับ — เผื่ออธิบายว่า Like ด้วยบัญชีชื่ออะไร
  -- กรณีชื่อ Facebook ไม่ตรงกับชื่อ LINE) เพดานความยาวบังคับที่ชั้น Service
  message           TEXT,

  -- สถานะคำขอ:
  --   pending  = รอ Admin ตรวจ Screenshot
  --   approved = Admin ตรวจแล้วผ่าน (ให้ Premium 1 เดือนแล้ว)
  --   rejected = Admin ตรวจแล้วไม่ผ่าน (รูปไม่ชัด/ไม่ได้ Like จริง) — ส่งใหม่ได้
  status            TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),

  -- LINE User ID ของ Admin ที่กดตรวจ (Audit — ไม่ FK เพราะ Admin อาจไม่ใช่ Row ใน
  -- users; Pattern เดียวกับ payments.confirmed_by / premium_grant_logs.granted_by)
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,

  -- เหตุผลที่ปฏิเสธ (ไม่บังคับ) — ใช้แจ้งผู้ใช้ว่าต้องแก้อะไรถึงจะส่งใหม่ผ่าน
  reject_reason     TEXT,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── หัวใจของการกันส่งคำขอซ้ำซ้อน (Partial Unique Index) ─────────────────────────
-- บังคับที่ระดับ DB ว่า "1 User มีคำขอ pending ค้างได้ไม่เกิน 1 ใบ" — กันผู้ใช้กดส่ง
-- รัวจนคิวรอตรวจของ Admin เต็มไปด้วยใบซ้ำของคนเดียว (Pattern เดียวกับ Partial Unique
-- Index ของ payments ที่กันยอด pending ซ้ำ — migration 004)
--
-- ⚠️ จงใจ Partial (WHERE status = 'pending') ไม่ใช่ UNIQUE ทั้งคอลัมน์: คำขอที่ถูก
-- rejected ไปแล้วต้อง "ส่งใหม่ได้ทันที" (รูปไม่ชัด/ถ่ายผิดหน้า เป็นเรื่องปกติที่ต้อง
-- แก้แล้วส่งซ้ำ) ถ้า UNIQUE ทั้งคอลัมน์จะส่งใหม่ไม่ได้ตลอดกาล — และการกัน "ได้สิทธิ์
-- ซ้ำ" เป็นหน้าที่ของ users.facebook_like_granted_at (migration 031) ไม่ใช่ของ Index นี้
CREATE UNIQUE INDEX uniq_facebook_like_pending_per_user
  ON facebook_like_grant_requests (user_id)
  WHERE status = 'pending';

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query หลักฝั่ง Admin: "คำขอที่รอตรวจ เรียงเก่า→ใหม่" (เข้าคิวก่อนได้ตรวจก่อน)
-- และ "ประวัติคำขอทั้งหมดตามสถานะ"
CREATE INDEX idx_facebook_like_requests_status_created_at
  ON facebook_like_grant_requests (status, created_at);

-- Query รอง: "คำขอทั้งหมดของผู้ใช้รายนี้" (FK Column + ใช้ตรวจว่าเคยขอ/เคยถูกปฏิเสธไหม)
CREATE INDEX idx_facebook_like_requests_user_id
  ON facebook_like_grant_requests (user_id, created_at DESC);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ payments/premium_grant_logs/support_requests: เปิด RLS แต่ไม่มี
-- Policy สำหรับ authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin เท่านั้น
ALTER TABLE facebook_like_grant_requests ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
-- ตารางนี้ "มี UPDATE จริง" (pending → approved/rejected) ต่างจาก premium_grant_logs
-- ที่เป็น Append-only ล้วน จึงต้องมี updated_at + Trigger (Pattern เดียวกับ payments)
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON facebook_like_grant_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
--   DROP TABLE IF EXISTS facebook_like_grant_requests;
--   (Trigger/Index ถูก Drop ตามไปเองพร้อมตาราง ไม่ต้องสั่งแยก)
--
-- ⚠️ ตารางนี้เป็น "ตารางใหม่ล้วน" ไม่มีข้อมูลเดิมของระบบอื่นอยู่ในนั้นเลย การ Drop จึง
-- ไม่กระทบ Ledger/Payment/Support ใดๆ — แต่จะเสียประวัติคำขอ + หลักฐาน Screenshot
-- (path) ทั้งหมด ถ้าเคยใช้จริงบน Production แล้วต้อง Rollback ให้ Export ก่อน:
--   SELECT * FROM facebook_like_grant_requests ORDER BY created_at;
--
-- ⚠️ ไฟล์รูปใน Storage Bucket 'facebook-like-proofs' "ไม่ถูกลบ" ตามการ Drop ตาราง
-- (คนละระบบกัน) ต้องลบเองแยกถ้าต้องการล้างจริง — และการ Drop ตารางนี้ไม่กระทบสิทธิ์
-- Premium ที่ให้ไปแล้ว (อยู่ที่ users.plan/plan_expires_at + facebook_like_granted_at)
