-- ═══════════════════════════════════════════════════════════════════════
-- Migration 040 — transaction_slip_sessions (ถามหาสลิปหลังบันทึกด้วยการพิมพ์)
-- ═══════════════════════════════════════════════════════════════════════
-- ปัญหาที่แก้: ระบบแนบสลิปอัตโนมัติเฉพาะกรณีผู้ใช้ส่งรูปให้ AI อ่าน
-- (uploadOcrSlipBestEffort → slipToken → attachSlipBestEffort) แต่ถ้าผู้ใช้ "พิมพ์เอง"
-- เช่น "ซื้อ ASTS 5000" แล้วกดยืนยัน จะไม่มีสลิปแนบเลย — ตารางนี้เก็บสถานะสั้นๆ ว่า
-- "เพิ่งบันทึกรายการ X เสร็จ และกำลังรอรูปสลิปของรายการนั้นอยู่"
--
-- เป็น Ephemeral Working State เหมือน guided_buy_sessions (022) /
-- dca_reminder_setup_sessions (003) / bulk_import_sessions (007) จึงเป็นข้อยกเว้น
-- ของกฎห้ามลบข้อมูล (DATABASE.md § 8): ลบ/เขียนทับได้อิสระ ไม่ใช่ Ledger
--
-- ⚠️ ตารางนี้ "ไม่สร้าง Transaction เอง" และ "ไม่คำนวณเงินเอง" — เก็บแค่ตัวชี้ไปยัง
-- transaction ที่ถูกบันทึก (Commit) ไปแล้วเรียบร้อย การแนบรูปเป็นการ UPDATE คอลัมน์
-- transactions.slip_image_path ผ่าน attachSlipImagePath เดิม (migration 021) เท่านั้น
-- ไม่แตะตัวเลขเงินใดๆ ทั้งสิ้น
--
-- ── ทำไมต้องมีตารางใหม่ (Reuse ของเดิมไม่ได้) ───────────────────────────────
-- guided_buy_sessions มี CHECK constraint ผูกกับขั้นตอนของ Flow ซื้อ
-- (AWAITING_SYMBOL/AWAITING_AMOUNT) และ dca_reminder_setup_sessions ผูกกับ Flow
-- ตั้งเตือน — การยัด State นี้ลงตารางใดตารางหนึ่งจะทำให้ 2 Flow เขียนทับกันเงียบๆ
-- (บั๊กประเภทเดียวกับที่ migration 022 อธิบายไว้ตอนแยกตัวเองออกมาจาก 003)
--
-- ── ทำไม TTL สั้น (10 นาที) ────────────────────────────────────────────────
-- Session นี้ "เปลี่ยนความหมายของรูปที่ผู้ใช้ส่งเข้ามา" (จากเข้า AI OCR → กลายเป็น
-- แนบเข้ารายการที่ระบุ) ถ้าค้างนานจะเกิดเคสร้าย: ผู้ใช้บันทึกรายการเมื่อ 2 ชั่วโมงก่อน
-- แล้วส่งสลิป "ของอีกรายการหนึ่ง" มาให้ AI อ่าน กลับถูกแนบเข้ารายการเก่าแทน
-- 10 นาทีคือช่วงที่ยาวพอให้ผู้ใช้เปิดแอปธนาคาร/แคปหน้าจอมาส่งทัน แต่สั้นพอที่รูป
-- "รอบถัดไป" จะไม่โดนดูดเข้ารายการเดิม (ยาวกว่า TTL 5 นาทีของ Session อื่นเล็กน้อย
-- โดยเจตนา เพราะ Flow นี้ผู้ใช้ต้องออกไปหารูปจากแอปอื่นก่อน ไม่ใช่พิมพ์ตอบทันที)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (updated_at trigger), § 9 (FK), § 10 (Index)
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE transaction_slip_sessions (
  -- user_id เป็น PRIMARY KEY: 1 User รอสลิปได้ทีละ 1 รายการเท่านั้น (บันทึกรายการ
  -- ใหม่ระหว่างที่ยังรออยู่ = เขียนทับด้วย UPSERT ให้ชี้ไปรายการล่าสุดเสมอ ซึ่งตรงกับ
  -- สิ่งที่ผู้ใช้คาดหวัง: รูปที่ส่งหลังสุดควรเข้ารายการที่เพิ่งทำล่าสุด)
  -- FK → users: RESTRICT ตาม § 9 (Pattern เดียวกับ guided_buy_sessions.user_id)
  user_id        UUID        PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,

  -- รายการที่รอรับสลิป — FK → transactions พร้อม CASCADE
  --
  -- ⚠️ ใช้ ON DELETE CASCADE ต่างจาก RESTRICT ของ user_id โดยเจตนา: transactions เป็น
  -- Immutable Ledger ที่ "ไม่มีการลบอยู่แล้ว" (DATABASE.md § 8 — แก้ด้วย Reversal
  -- เท่านั้น) CASCADE จึงไม่มีวันทำงานในทางปฏิบัติ แต่ถ้าวันหนึ่งมีการลบจริงในงาน
  -- Maintenance/Erasure การมี CASCADE ทำให้แถว Session ที่ชี้ไปยังรายการที่หายไปแล้ว
  -- ถูกเก็บกวาดตาม ไม่ค้างเป็น Dangling Pointer ที่ทำให้การแนบรูปครั้งถัดไปพัง
  transaction_id UUID        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ใช้เป็นฐานคำนวณ TTL (ดู transactionSlipSession.service.SESSION_TTL_MS)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Cron Purge สแกนหา Session ที่ updated_at เก่ากว่า cutoff และ getActiveSession
-- กรอง Session ที่ยังไม่หมดอายุด้วย updated_at เช่นกัน (Pattern เดียวกับ 022)
CREATE INDEX idx_transaction_slip_sessions_updated_at
  ON transaction_slip_sessions(updated_at);

-- ── updated_at Trigger (§ 4) ───────────────────────────────────────────
CREATE TRIGGER trg_transaction_slip_sessions_updated_at
  BEFORE UPDATE ON transaction_slip_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ guided_buy_sessions: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon เลย — LINE Bot Flow เข้าถึงผ่าน supabaseAdmin (service role)
ALTER TABLE transaction_slip_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE transaction_slip_sessions IS
  'สถานะชั่วคราว "กำลังรอรูปสลิปของรายการที่เพิ่งบันทึก" (TTL 10 นาที) — Ephemeral Working State ลบ/เขียนทับได้ ไม่ใช่ Ledger ดู transactionSlipSession.service';

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) ตารางมีจริง + คอลัมน์ครบ 4
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'transaction_slip_sessions'
--    ORDER BY ordinal_position;
--   คาดหวัง: user_id(uuid,NO) / transaction_id(uuid,NO) / created_at / updated_at
--
-- 2) RLS เปิดจริง และไม่มี Policy ให้ anon/authenticated (ต้องได้ rowsecurity=true, 0 policy)
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'transaction_slip_sessions';
--   SELECT count(*) FROM pg_policies WHERE tablename = 'transaction_slip_sessions';
--
-- 3) FK + ON DELETE ถูกต้อง (คาดหวัง user_id=RESTRICT 'r', transaction_id=CASCADE 'c')
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'transaction_slip_sessions'::regclass AND contype = 'f';
--
-- 4) Trigger updated_at ติดจริง
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'transaction_slip_sessions'::regclass AND NOT tgisinternal;
--
-- 5) Smoke Test — พิมพ์ "ซื้อ BTC 100" ใน LINE ด้วยบัญชี Premium แล้วกดยืนยัน
--    คาดหวัง: มี 1 แถวชี้ไป transaction ที่เพิ่งสร้าง
--   SELECT s.user_id, s.transaction_id, t.symbol, s.updated_at
--     FROM transaction_slip_sessions s JOIN transactions t ON t.id = s.transaction_id;
--    จากนั้นส่งรูปสลิปเข้าไป → แถวต้องหายไป และ transactions.slip_image_path ต้องมีค่า
--   SELECT id, symbol, slip_image_path FROM transactions WHERE id = '<transaction_id>';

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5)
-- ═══════════════════════════════════════════════════════════════════════
--   DROP TABLE IF EXISTS transaction_slip_sessions;
--   (Trigger/Index ถูกลบไปพร้อมตารางเองอัตโนมัติ)
--
-- ⚠️ ต้อง Rollback "โค้ดก่อน แล้วค่อย DB" ตามลำดับนี้เท่านั้น — ถ้า DROP ตารางทิ้ง
-- ขณะที่โค้ดใหม่ยังรันอยู่ การกดยืนยันรายการใน LINE จะพยายามเขียน Session ลงตารางที่
-- ไม่มีแล้ว (ถูก Swallow เป็น Best-effort ไม่ทำให้ธุรกรรมพัง — ดู
-- transactionSlipSession.service — แต่จะมี Error Log รัวทุกครั้งที่บันทึก)
--
-- ⚠️ สิ่งที่จะเสียไป: เฉพาะ "คำขอแนบสลิปที่ค้างอยู่ ณ ขณะนั้น" (อายุไม่เกิน 10 นาที)
-- ผู้ใช้แค่ต้องแนบสลิปใหม่ผ่านหน้าเว็บแทน — ไม่กระทบ Ledger ไม่กระทบสลิปที่แนบไป
-- แล้ว (อยู่ที่ transactions.slip_image_path คนละที่กัน) ไม่กระทบสิทธิ์ Premium
