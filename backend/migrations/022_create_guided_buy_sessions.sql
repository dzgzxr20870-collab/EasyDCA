-- ═══════════════════════════════════════════════════════════════════════
-- Migration 022 — guided_buy_sessions (S8 R2 รอบ 2 — Guided ซื้อแบบกดปุ่ม)
-- ═══════════════════════════════════════════════════════════════════════
-- เก็บ "สถานะการบันทึก DCA แบบสนทนาหลายขั้นตอน" (Quick Reply Flow) ที่ผู้ใช้กำลัง
-- ทำอยู่ ณ ขณะหนึ่ง — เป็น Ephemeral Working State เหมือน dca_reminder_setup_sessions
-- (migration 003) / bulk_import_sessions (007) / pending_transactions (001) จึงเป็น
-- ข้อยกเว้นของกฎห้ามลบข้อมูล (DATABASE.md § 8): ลบ/เขียนทับได้อิสระ ไม่ใช่ Ledger
--
-- Flow: กดปุ่ม "📈 บันทึก DCA" → เลือก/พิมพ์ Symbol → เลือก/พิมพ์จำนวนเงิน →
-- จบด้วยการ Route เข้า routeCommand(BUY) ของเดิม → pendingTransaction.createPending()
-- → การ์ด Preview พร้อมปุ่มยืนยัน/ยกเลิกเดิม แล้วลบ Session ทิ้ง
--
-- ⚠️ ตารางนี้ "ไม่สร้าง Transaction เอง" และ "ไม่คำนวณเงินเอง" — เก็บแค่ State
-- ระหว่างทาง (Symbol ที่เลือกไว้) เท่านั้น การคำนวณ/บันทึกยังเป็นหน้าที่ของ
-- transaction.service ผ่าน createPending → confirmPending เส้นเดียวกับ Expert Path
--
-- ⚠️ ทำไมต้องมีตารางใหม่ (Reuse 003 ไม่ได้): dca_reminder_setup_sessions มี user_id
-- เป็น PK และ CHECK constraint ผูกกับขั้นตอนของ Flow ตั้งเตือน (AWAITING_FREQUENCY /
-- AWAITING_DAY) การยัด Guided Buy ลงตารางเดียวกันจะทำให้ 2 Flow เขียนทับกันเงียบๆ
-- (ผู้ใช้ที่กำลังตั้งเตือนค้างอยู่แล้วกด "บันทึก DCA" จะทำให้ Session ตั้งเตือนหายไป)
-- ซึ่งเป็นบั๊กประเภทเดียวกับที่ S8 R2 รอบ 1 เจอกับปุ่มยกเลิกข้าม Flow
--
-- ไม่แตะตาราง transactions / assets / pending_transactions เลย
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (updated_at trigger), § 9 (FK), § 10 (Index)
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE guided_buy_sessions (
  -- user_id เป็น PRIMARY KEY: 1 User มีได้แค่ 1 Session ที่กำลังบันทึกอยู่ ณ ขณะหนึ่ง
  -- (เริ่ม Flow ใหม่ = เขียนทับของเก่าด้วย UPSERT ไม่ให้ 2 Session ปนกัน)
  -- FK → users: RESTRICT ตาม § 9 (Pattern เดียวกับ dca_reminder_setup_sessions.user_id)
  user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,

  -- ขั้นตอนปัจจุบันของ State Machine (guidedBuyFlow.service)
  -- มีแค่ 2 ขั้น: ขั้นจำนวนเงินจบแล้วส่งต่อ routeCommand ทันที ไม่มีขั้น "ยืนยัน"
  -- ของตัวเอง — ใช้การ์ด Preview + ปุ่ม confirm/cancel เดิมของ Expert Path แทน
  step        TEXT        NOT NULL CHECK (step IN ('AWAITING_SYMBOL', 'AWAITING_AMOUNT')),

  -- Symbol ที่เลือก/พิมพ์ไว้ในขั้นแรก (NULL ตอนอยู่ขั้น AWAITING_SYMBOL)
  -- ไม่เก็บจำนวนเงิน: ขั้นจำนวนเงินคือขั้นสุดท้าย ได้ค่ามาแล้วใช้ต่อทันทีในคำขอเดียว
  symbol      TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- updated_at ถูก Bump ทุกครั้งที่เดินขั้นถัดไป (Trigger ด้านล่าง) — ใช้เป็นฐาน
  -- คำนวณ TTL แบบ Sliding 5 นาที (ค่าเดียวกับ dca_reminder_setup_sessions /
  -- bulk_import_sessions / pending_transactions — คงความสม่ำเสมอทั้งระบบ)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Cron Purge สแกนหา Session ที่ updated_at เก่ากว่า cutoff (เลย TTL ไปนานแล้ว)
-- และ getCurrentSession กรอง Session ที่ยังไม่หมดอายุด้วย updated_at เช่นกัน
CREATE INDEX idx_guided_buy_sessions_updated_at
  ON guided_buy_sessions(updated_at);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ dca_reminder_setup_sessions: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon เลย — LINE Bot Flow เข้าถึงผ่าน supabaseAdmin (service role)
ALTER TABLE guided_buy_sessions ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON guided_buy_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
