-- ═══════════════════════════════════════════════════════════════════════
-- Migration 042 — brokers (ต่อ User) + assets.broker_id
-- ═══════════════════════════════════════════════════════════════════════
-- Stage 1 ของ Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
-- (ออกแบบไว้ที่ docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 3.1)
--
-- ── ทำอะไร ────────────────────────────────────────────────────────────────
-- เพิ่มแนวคิด "โบรกเกอร์/Exchange ที่ถือสินทรัพย์ตัวนี้อยู่" ซึ่งวันนี้ระบบ
-- ไม่มีที่เก็บเลยแม้แต่คอลัมน์เดียว — หน้า Portfolio ฝั่งเว็บต้องใช้ทำ
-- "Broker Allocation" (สัดส่วนมูลค่าพอร์ตแยกตามโบรก)
--
-- ── ความเสี่ยง: 🟢 ต่ำ (Additive ล้วน) ────────────────────────────────────
-- ไม่มีโค้ดเดิมบรรทัดใดอ่าน/เขียนคอลัมน์นี้ · ไม่แตะข้อมูลเดิมแม้แถวเดียว ·
-- ไม่แตะสูตรคำนวณเงินใดๆ (broker เป็น Metadata สำหรับจัดกลุ่มแสดงผลเท่านั้น
-- ไม่เข้าไปอยู่ในสูตร P&L / heldQty / costBasis จุดใดทั้งสิ้น)
--
-- Dependency: ฟังก์ชัน update_updated_at() จาก DATABASE.md § 4 (มีอยู่แล้ว —
-- migration 028 ล็อก search_path ให้เรียบร้อยแล้ว)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 4 (Trigger), § 9 (FK/ALTER Additive),
-- § 10 (Index) · AI_WORK_POLICY.md § 4.5 (Migration ต้องมี Rollback Plan)
-- ═══════════════════════════════════════════════════════════════════════

-- ── ทำไม brokers เป็นตาราง "ต่อ User" ไม่ใช่ Master List กลาง ─────────────────
--   โบรก/Exchange ที่คนไทยใช้จริงมีทั้ง Bitkub / Binance / InnovestX / Dime /
--   Webull / ธนาคาร / โบรกต่างประเทศอีกนับไม่ถ้วน — ถ้าทำ Master List กลาง
--   จะกลายเป็นงานดูแล Catalog ตลอดไป และผู้ใช้ที่ใช้โบรกนอกลิสต์จะกรอกไม่ได้เลย
--
--   ตัดสินใจแล้ว (Founder, 23 ส.ค. 2569): ให้ผู้ใช้พิมพ์ชื่อเอง + Normalize
--   ก่อนเก็บ/จัดกลุ่ม · ยังไม่ทำ Autocomplete List ในรอบนี้ (เก็บเป็นงานรอบหน้า)
CREATE TABLE brokers (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 (users Row ไม่เคยถูก DELETE จริง Anonymize
  -- เท่านั้น FK จึงอ้างอิงได้เสมอไม่มี Orphan — Pattern เดียวกับ
  -- premium_grant_logs / facebook_like_grant_requests)
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- ชื่อโบรกตามที่ผู้ใช้พิมพ์ (เก็บรูปแบบตัวพิมพ์ตามที่ผู้ใช้ตั้งใจ — "InnovestX"
  -- ต้องแสดงเป็น "InnovestX" ไม่ใช่ "innovestx") ชั้น Service เป็นคน trim ให้ก่อน
  -- ส่วน CHECK ด้านล่างเป็นตาข่ายรองกันค่าว่าง/ยาวเกินหลุดถึง DB
  --
  -- ⚠️ ความยาว 60 ตัวอักษรต้องตรงกับ BROKER_NAME_MAX_LENGTH ใน broker.service.js
  -- (เลขนี้อยู่ 2 ที่โดยเจตนา: App บอกผู้ใช้เป็นภาษาไทยได้ / DB เป็นด่านสุดท้าย
  -- ที่ Path อื่นในอนาคตข้ามไม่ได้) — ถ้าจะแก้ต้องแก้พร้อมกันทั้งคู่
  name        TEXT          NOT NULL
              CHECK (btrim(name) <> '' AND char_length(name) <= 60),

  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── หัวใจของการกันชื่อโบรกซ้ำ: UNIQUE แบบ Case-insensitive ────────────────────
-- ⚠️ จงใจใช้ Functional Index บน lower(name) แทน UNIQUE (user_id, name) ธรรมดา
--
-- เหตุผล: UNIQUE ธรรมดาของ Postgres เทียบแบบ Case-sensitive ผู้ใช้คนเดียวกันจึง
-- สร้าง "Bitkub" / "bitkub" / "BITKUB" ได้ครบ 3 แถว แล้วกราฟโดนัท Broker
-- Allocation จะแตกเป็น 3 กลุ่มทั้งที่เป็นโบรกเดียวกัน — ซึ่งเป็นข้อเสียที่
-- Design Doc § 8.2 ระบุไว้ตรงๆ และ Founder ตัดสินให้ Normalize ก่อนเก็บ
--
-- การบังคับที่ระดับ DB จำเป็น (ไม่ใช่แค่เช็คในโค้ด) เพราะการเช็คในชั้น Service
-- เป็น check-then-insert ที่ไม่ Atomic — สอง Request ที่ส่ง "bitkub"/"Bitkub"
-- พร้อมกันจะอ่านผลว่า "ยังไม่มี" ทั้งคู่แล้ว INSERT ผ่านทั้งคู่
-- (บทเรียนเดียวกับ assetLimitRace / migration 035)
--
-- ไม่ต้องกังวลเรื่องภาษาไทย: lower() กับอักษรไทยคืนค่าเดิม (ไทยไม่มี Case)
-- จึงไม่เปลี่ยนพฤติกรรมของชื่อโบรกภาษาไทยเลย
CREATE UNIQUE INDEX uniq_brokers_user_name_ci
  ON brokers (user_id, lower(name));

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query หลัก: "โบรกทั้งหมดของผู้ใช้รายนี้ เรียงตามชื่อ" (Dropdown ตอนแก้สินทรัพย์)
CREATE INDEX idx_brokers_user_id ON brokers (user_id);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับทุกตารางในระบบ: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin เท่านั้น และ Backend
-- คือ Security Boundary เดียว (PROJECT_STATUS.md กฎยืนข้อ 3)
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;

-- ── Trigger update_updated_at (§ 4) ────────────────────────────────────
-- ตารางนี้มี UPDATE จริง (PATCH เปลี่ยนชื่อโบรก) จึงต้องมี Trigger
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON brokers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE brokers IS
  'โบรกเกอร์/Exchange ที่ผู้ใช้สร้างเอง (ต่อ User ไม่ใช่ Master List กลาง) — ใช้จัดกลุ่ม Broker Allocation เท่านั้น ไม่เข้าสูตรคำนวณเงินใดๆ (migration 042)';

-- ═══════════════════════════════════════════════════════════════════════
-- assets.broker_id — ผูกโบรกที่ระดับ "สินทรัพย์" ไม่ใช่ "ธุรกรรม"
-- ═══════════════════════════════════════════════════════════════════════
-- เหตุผล: Broker Allocation = สัดส่วนมูลค่าพอร์ตแยกตามโบรก ซึ่งคำนวณจาก
-- "สินทรัพย์ที่ถืออยู่" ไม่ใช่ประวัติธุรกรรม — ถ้าผูกที่ transactions
-- สินทรัพย์ก้อนเดียวจะกระจายข้ามโบรกแล้วรวมยอดมูลค่าปัจจุบันไม่ได้
--
-- ⚠️ ข้อจำกัดที่ยอมรับแล้วในรอบนี้ (Known Limitation — Founder ตัดสิน 23 ส.ค. 2569):
-- ถือสินทรัพย์ตัวเดียวกันที่ 2 โบรกพร้อมกัน (เช่น BTC ทั้ง Bitkub และ Binance)
-- ยัง "ทำไม่ได้" เพราะ UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id)
-- จาก migration 014 ไม่อนุญาตให้มี BTC 2 แถวในพอร์ตเดียว — การเพิ่ม broker_id
-- เข้า UNIQUE Key จะไปแตะ Constraint ที่ migration 014 เพิ่งแก้เพราะเคยเป็นบั๊ก
-- Duplicate มาก่อน จึงเลื่อนไปรอบหน้าโดยเจตนา ไม่รวมมาในรอบเดียวกับงานอื่น
--
-- ON DELETE SET NULL (ไม่ใช่ CASCADE): ลบโบรกไม่ควรลบสินทรัพย์ทิ้ง — กฎเหล็ก
-- AI_CONTEXT.md ข้อ 2 "ห้ามลบข้อมูลผู้ใช้" · Pattern เดียวกับ assets.portfolio_id
--
-- ⚠️ FK ระดับ DB ตรวจได้แค่ "broker แถวนี้มีอยู่จริง" ไม่ได้ตรวจ "เป็นของใคร" —
-- การกันผู้ใช้ A ยัดสินทรัพย์ตัวเองไปผูกกับ broker ของผู้ใช้ B ต้องทำในชั้น
-- Service ด้วย queryForUser เสมอ (Design Doc § 6.3 + broker.service.assertOwned)
ALTER TABLE assets
  ADD COLUMN broker_id UUID REFERENCES brokers(id) ON DELETE SET NULL;

-- Partial Index: แถวส่วนใหญ่ในระบบวันนี้ broker_id เป็น NULL (ของเดิมทั้งหมด)
-- การ Index เฉพาะแถวที่มีค่าจริงจึงเล็กกว่ามากและตรงกับ Query ที่ใช้จริง
-- ("สินทรัพย์ที่ผูกกับโบรกนี้" ตอนจัดกลุ่ม/ตอนลบโบรก)
CREATE INDEX idx_assets_broker_id ON assets (broker_id) WHERE broker_id IS NOT NULL;

COMMENT ON COLUMN assets.broker_id IS
  'โบรก/Exchange ที่ถือสินทรัพย์นี้อยู่ — NULL = ไม่ระบุ (แถวเดิมทั้งหมดก่อน migration 042 และรายการที่ผู้ใช้ยังไม่ได้กรอก) UI ต้องแสดงเป็นกลุ่ม "ไม่ระบุ" ไม่ใช่ซ่อนแถว มิฉะนั้นยอดรวมโดนัทจะไม่เท่ามูลค่าพอร์ตจริง';

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply — คาดหวังผลตามที่เขียนกำกับไว้ทุกข้อ)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) ตาราง brokers เกิดจริง พร้อมคอลัมน์ครบ 5
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'brokers' ORDER BY ordinal_position;
--   คาดหวัง: id(uuid,NO) · user_id(uuid,NO) · name(text,NO) ·
--            created_at(timestamptz,NO) · updated_at(timestamptz,NO)
--
-- 2) UNIQUE แบบ Case-insensitive ทำงานจริง (นี่คือข้อที่ต้องดูที่สุด)
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'brokers' ORDER BY indexname;
--   คาดหวัง: เห็น uniq_brokers_user_name_ci ที่มี "lower(name)" อยู่ใน indexdef
--
-- 3) RLS เปิดแล้ว และไม่มี Policy ให้ anon/authenticated (service_role เท่านั้น)
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'brokers';   -- คาดหวัง: true
--   SELECT count(*) FROM pg_policies WHERE tablename = 'brokers';    -- คาดหวัง: 0
--
-- 4) Trigger updated_at ผูกแล้ว
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'brokers'::regclass AND NOT tgisinternal;
--   คาดหวัง: set_updated_at
--
-- 5) assets.broker_id เพิ่มแล้ว เป็น NULL ทุกแถว และ "จำนวนแถวไม่เปลี่ยน"
--   SELECT count(*) AS ทั้งหมด,
--          count(*) FILTER (WHERE broker_id IS NULL)     AS ไม่ระบุโบรก,
--          count(*) FILTER (WHERE broker_id IS NOT NULL) AS ผูกโบรกแล้ว
--     FROM assets;
--   คาดหวังทันทีหลัง Apply: ไม่ระบุโบรก = ทั้งหมด · ผูกโบรกแล้ว = 0
--   (ค่าจะเริ่มไม่เป็น NULL ก็ต่อเมื่อ Deploy โค้ดใหม่แล้วผู้ใช้กรอกเองเท่านั้น)
--
-- 6) FK ของ assets.broker_id เป็น SET NULL จริง (ไม่ใช่ CASCADE — ข้อนี้สำคัญ
--    เพราะ CASCADE จะแปลว่า "ลบโบรก = ลบสินทรัพย์ทิ้ง" ซึ่งผิดกฎเหล็กข้อ 2)
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'assets'::regclass AND contype = 'f'
--      AND conname LIKE '%broker%';
--   คาดหวัง: confdeltype = 'n'  ('n' = SET NULL, 'c' = CASCADE, 'r' = RESTRICT)

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับ: Revert โค้ดก่อน แล้วค่อยแตะ DB เสมอ
--
-- ขั้น 1 — Revert โค้ด (Railway Redeploy ตัวก่อนหน้า ทั้ง EasyDCA + easydca-worker)
--          โค้ดเก่าไม่รู้จักคอลัมน์ broker_id เลย จึงทำงานต่อได้ทันทีแม้คอลัมน์
--          ยังอยู่ (Additive Migration ย้อนกลับได้โดยไม่ต้องรีบแตะ DB)
--
-- ขั้น 2 — ถ้าจำเป็นต้องถอน Schema จริง ให้ Export ก่อนเสมอ (ห้ามลบข้อมูลผู้ใช้
--          โดยไม่มีสำเนา — กฎเหล็ก AI_CONTEXT.md ข้อ 2):
--   SELECT a.id AS asset_id, a.symbol, b.name AS broker_name
--     FROM assets a JOIN brokers b ON b.id = a.broker_id
--    WHERE a.broker_id IS NOT NULL;
--   SELECT * FROM brokers ORDER BY user_id, name;
--
-- ขั้น 3 — ถอน (ต้องถอนคอลัมน์ก่อน เพราะ FK ชี้ไปที่ brokers อยู่):
--   ALTER TABLE assets DROP COLUMN IF EXISTS broker_id;   -- Index ถูก Drop ตามเอง
--   DROP TABLE IF EXISTS brokers;                          -- Trigger/Index ตามเอง
--
-- ⚠️ สิ่งที่จะเสียไปถ้า Rollback: การผูกสินทรัพย์กับโบรกทั้งหมดที่ผู้ใช้กรอกไว้
-- ไม่กระทบ Ledger (transactions ไม่ถูกแตะเลย) · ไม่กระทบ P&L (broker ไม่อยู่ใน
-- สูตรใดๆ) · ไม่กระทบสิทธิ์ Premium
