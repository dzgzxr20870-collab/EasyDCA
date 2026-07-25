-- ═══════════════════════════════════════════════════════════════════════
-- Migration 024 — support_request_sessions
-- ═══════════════════════════════════════════════════════════════════════
-- เก็บสถานะ "กำลังรอข้อความแจ้งปัญหา" ของ Flow ติดต่อ Admin/Support ผ่าน LINE
-- Chat (ก่อนเปิด Closed Beta Wave 1) — เป็น Ephemeral Working State เหมือน
-- guided_buy_sessions (022) / dca_reminder_setup_sessions (003) / bulk_import_sessions
-- (007) จึงเป็นข้อยกเว้นของกฎห้ามลบข้อมูล (DATABASE.md § 8): ลบ/เขียนทับได้อิสระ
--
-- Flow: พิมพ์ Trigger ("ติดต่อแอดมิน" ฯลฯ) → สร้าง Session แถวนี้ → พิมพ์ข้อความถัดไป
-- → Push หา Admin (ADMIN_LINE_USER_IDS) + บันทึกลง support_requests (migration 025)
-- → ลบ Session ทิ้ง (จบ Flow)
--
-- ⚠️ ต่างจาก Session ของ Flow อื่นทุกตัวในระบบ: ตารางนี้ "ไม่มี step column และไม่มี
-- updated_at/Trigger" โดยตั้งใจ — Flow นี้มีขั้นตอนเดียวจริงๆ (รอข้อความ) ไม่มีการ
-- เดินขั้นหลายรอบแบบ Guided Buy/Reminder Setup ที่ต้อง Sliding TTL จาก updated_at
-- (กิจกรรมล่าสุด) การมี step column ที่ CHECK ให้เป็นค่าเดียวเสมอ หรือ Trigger ที่ไม่
-- เคยถูก UPDATE เรียกใช้จริง จะเป็น Boilerplate ที่ไม่มีมูลค่า — created_at เพียงพอ
-- สำหรับคำนวณ TTL แบบ Fixed Window (ไม่ต้อง Sliding เพราะไม่มีขั้นให้เดินต่อ)
--
-- ไม่แตะตาราง transactions / assets / pending_transactions / payments เลย
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 9 (FK RESTRICT), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE support_request_sessions (
  -- user_id เป็น PRIMARY KEY: 1 User มีได้แค่ 1 Session ที่กำลังรอข้อความอยู่
  -- ณ ขณะหนึ่ง (พิมพ์ Trigger ซ้ำ = เขียนทับด้วย UPSERT รีเซ็ต created_at ใหม่ —
  -- การทับ Session ของ Flow ตัวเอง ไม่ใช่การชนข้าม Flow จึงไม่ต้องเตือน)
  -- FK → users: RESTRICT ตาม § 9 (Pattern เดียวกับ guided_buy_sessions.user_id)
  user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Cron Purge สแกนหา Session ที่ created_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว)
CREATE INDEX idx_support_request_sessions_created_at
  ON support_request_sessions(created_at);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ guided_buy_sessions: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon เลย — LINE Bot Flow เข้าถึงผ่าน supabaseAdmin (service role)
ALTER TABLE support_request_sessions ENABLE ROW LEVEL SECURITY;
