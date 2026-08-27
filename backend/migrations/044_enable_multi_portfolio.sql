-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️⚠️  ปลดบล็อกแล้ว — แต่มีเงื่อนไข อ่านให้จบก่อน Apply  ⚠️⚠️
-- ═══════════════════════════════════════════════════════════════════════
-- สถานะ (27 ส.ค. 2569): บั๊ก Asset Resolution **แก้เสร็จแล้วในโค้ด**
--
-- ⛔ เงื่อนไข: Container ที่รันอยู่จริงต้องเป็นโค้ดที่แก้แล้ว **ครบทั้ง 5 หาง**
--    บั๊กตัวนี้อยู่คนละ Commit กัน และถูกจับได้คนละรอบ:
--      6cf6aa1  หางที่ 1 — `?? null` + Default Parameter + Repository ternary 2 ทาง
--      965dcdb  หางที่ 2 — branch โบรก return ก่อนถึงด่านพอร์ต
--      035c221  หางที่ 3 — รอยต่อ Preview→Confirm ไม่พก portfolioId  ← ใช้บ่อยที่สุด
--      48970c1  หางที่ 4/5 — portfolioSnapshot.job + dashboard.controller.getProfit
--               ยังส่ง portfolioId = null แบบ Hardcode นอกเส้นทาง Resolution
--               (พบตอน Audit ทั้งระบบก่อน Apply — ไม่มีตัวนี้มูลค่าพอร์ตรายคืนของ
--               ทุกคนจะเป็น null ทุกคืนแบบไม่มี Error ให้เห็นเลย)
--      6e88b5c  ปุ่มเลือกพอร์ตบน LINE (ไม่มีตัวนี้ ผู้ใช้ที่ถือ Symbol ข้ามพอร์ต
--               จะบันทึกผ่าน LINE ไม่ได้เลยหลัง Backfill)
--
-- ⚠️ **`6cf6aa1` อย่างเดียวไม่พอ** — หางที่ 3 อยู่ใน pendingTransaction.service.js
-- ซึ่งไม่ถูกแตะเลยใน 6cf6aa1 ทั้งที่เอกสารรอบนั้นเขียนว่า "ลบ ?? null ทุกจุด" ·
-- หางที่ 4/5 ก็ตกหล่นแบบเดียวกัน (48970c1 มาทีหลัง 6e88b5c จาก Audit อีกรอบ)
--
-- ⚠️⚠️ **ห้ามยึด SHA ตัวใดตัวหนึ่งด้านบนเป็นเป้าหมายสุดท้ายตายตัว** — รายการนี้
-- อาจล้าสมัยได้ทันทีที่มี Commit ใหม่เข้ามา (เกิดขึ้นจริงแล้ว — ตารางนี้เคยจบแค่
-- 4 Commit แล้วไม่มีใครกลับมาเพิ่ม 48970c1) เกณฑ์ที่ถูกต้องเสมอคือ **"Deploy ให้
-- ถึง HEAD ของ branch feat/dashboard-production-wire"** วิธีตรวจเต็ม: HANDOFF § 8
--
-- ⚠️ ต้องยืนยัน Commit SHA ของ Deployment ที่ Active จริงบน Railway **ทั้ง Service
-- "backend" และ "easydca-worker"** — ห้ามเชื่อว่า "Deploy แล้ว"
-- (worker ที่ค้างโค้ดเก่าจะเขียนข้อมูลผิดผ่าน Cron โดยไม่มีใครเห็นหน้าจอ)
--
-- 📄 ลำดับ Apply + สคริปต์ Verify ที่ต้องทำตาม: HANDOFF § 8 และ § 8.1
--    (สองที่นี้ต้องตรงกันเสมอ — ถ้าแก้ที่หนึ่งต้องแก้อีกที่ด้วย)
--
-- ── อาการเดิมถ้า Apply ทั้งที่ Container ยังเป็นโค้ดเก่า (ไว้เตือนความจำ) ──
--
-- Migration นี้ Backfill ให้สินทรัพย์ทุกแถวมี portfolio_id (ดู STEP 7 ด้านล่าง)
-- → หลังรันจะ **ไม่เหลือแถวที่ portfolio_id IS NULL อีกเลย**
--
-- แต่โค้ดเก่าค้นหาสินทรัพย์ด้วย
--     .is('portfolio_id', null)      ← asset.repository.findAllByUserAndSymbol
-- เสมอ เพราะทุก Caller เขียน `params.portfolioId ?? null` ตามกันหมด
-- → **ค้นหาสินทรัพย์เดิมไม่เจอทุกครั้ง** ทันทีที่ Backfill จบ
--
-- ── พังพร้อมกัน 4 จุด ───────────────────────────────────────────────────
--   🔴 ซื้อ     หาแถวเดิมไม่เจอ → สร้างสินทรัพย์ซ้ำแถวใหม่ (ไม่ชน UNIQUE เพราะ
--              แถวใหม่ portfolio_id = NULL vs แถวเดิม = P1 คนละค่า) → ประวัติ
--              ธุรกรรมแตกไปคนละ asset_id → Moving Average Cost Basis เห็นแค่
--              ครึ่งเดียว → **ต้นทุนเฉลี่ย/P&L ผิดทันทีแบบเงียบสนิท**
--              ผู้ใช้ไม่มีทางรู้ตัว และแถวซ้ำจะเกิดเพิ่มเรื่อยๆ ทุกคำสั่งซื้อ
--   🟠 ขาย      ASSET_NOT_FOUND ทุกครั้ง → ขายไม่ได้ทั้งระบบ
--   🟠 ดูกำไร   หาสินทรัพย์ไม่เจอ
--   🟠 LINE     Resolve สินทรัพย์ไม่เจอ
--
-- ⚠️ **migration 045 จับบั๊กนี้ไม่ได้** — 045 ตรวจ Invariant ของ *ข้อมูล* หลัง
-- Backfill (ทุก user มีพอร์ต Default · สินทรัพย์ทุกแถวสังกัดพอร์ต) ไม่ได้ตรวจ
-- *พฤติกรรมของแอป* · แถวซ้ำที่เกิดหลังจากนั้นจะผ่าน 045 ได้สบายเพราะมันก็สังกัด
-- พอร์ตครบเหมือนกัน → อย่าใช้ 045 เป็นเครื่องยืนยันว่าปลอดภัย
--
-- ⚠️ **การรวมแถวซ้ำกลับคืนกระทบต้นทุนเฉลี่ย = แตะเงินจริง ห้ามทำอัตโนมัติ**
-- (เคสเดียวกับที่ STEP 6 ของไฟล์นี้เองดักไว้) ยิ่ง Apply ทิ้งไว้นาน ยิ่งกู้ยาก
--
-- ── ✅ ลำดับที่ถูกต้อง (ต้องตรงกับ HANDOFF § 8 เสมอ) ─────────────────────
--   1) Apply 042 → 043                        (ปลอดภัย ไม่แตะข้อมูลเดิม)
--   2) ✅ บั๊กแก้เสร็จแล้วครบ 5 หาง (6cf6aa1 · 965dcdb · 035c221 · 48970c1 · 6e88b5c)
--      ⚠️ เกณฑ์จริงคือ "Deploy ถึง HEAD ของ branch" ไม่ใช่ SHA เหล่านี้ตรงๆ
--      (รายการอาจล้าสมัยถ้ามี Commit ใหม่ — ดูวิธีตรวจที่ HANDOFF § 8)
--   3) Merge + Deploy โค้ดที่แก้แล้ว (ทั้ง EasyDCA และ easydca-worker)
--      ⚠️ ยืนยัน Commit SHA ของ Deployment ที่ Active จริงทั้งสอง Service
--      เทียบกับ `git rev-parse --short HEAD` (ห้ามเทียบกับเลขที่จำมา)
--   4) Verify ตามสคริปต์ HANDOFF § 8.1 (ก่อน 044)
--   5) จดเลขแถว + สร้าง _backup_044_assets_portfolio
--   6) Apply 044 → 045
--   7) Verify ตามสคริปต์ HANDOFF § 8.1 ซ้ำ + Query (ค) (หลัง 044)
--   8) Apply 046 → 047 → 048
--
-- ⚠️ **Verify ที่ยอมรับได้ไม่ใช่ "ลองซื้อดูแล้วไม่ Error"** — บั๊กตัวนี้ไม่เคยขึ้น
-- Error เลย มันสร้างแถวใหม่แล้วตอบว่าสำเร็จ · ต้อง **นับแถว assets ก่อน/หลัง**
-- แล้วต้องได้เลขเท่ากันเป๊ะ หลังจากซื้อ Symbol ที่ "ถืออยู่แล้ว" ผ่าน LINE
-- (รายละเอียดครบใน HANDOFF § 8.1)
--
-- ⚠️ ข้อ 3 **สลับจากกฎปกติ "Migration ก่อน Deploy Code" โดยตั้งใจ** —
-- ปกติโค้ดใหม่คือฝ่ายที่ต้องการ Schema ใหม่ จึงต้อง Apply ก่อน แต่เคสนี้กลับด้าน
-- เพราะ 044 ไม่ได้เพิ่มของให้โค้ดใหม่ใช้ มันคือตัวที่ **ทำให้โค้ดเดิมพัง**
-- โค้ดที่แก้แล้วทำงานถูกทั้ง *ก่อน* และ *หลัง* 044 (ไม่กรอง portfolio_id เลยเมื่อ
-- ผู้ใช้ไม่ได้ระบุพอร์ต) จึง Deploy ก่อนได้ปลอดภัย และเป็นลำดับเดียวที่ไม่มี
-- ช่วงเวลาที่ระบบพัง
--
-- 📄 รายละเอียดเต็ม: docs/POSTMORTEM_PORTFOLIO_RESOLUTION.md
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- Migration 044 — เปิดใช้ Multi-portfolio (is_default + Backfill)
-- ═══════════════════════════════════════════════════════════════════════
-- Stage 3 ของ Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
-- (ออกแบบไว้ที่ docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 3.3)
--
-- ── ทำอะไร ────────────────────────────────────────────────────────────────
-- `portfolios.portfolio_id` มีอยู่ใน Schema ตั้งแต่วันแรกแต่ "ไม่เคยถูกเปิดใช้"
-- (Design Doc § 1) — Migration นี้ทำให้ Invariant ต่อไปนี้เป็นจริงทั้งระบบ:
--
--     ⭐ ผู้ใช้ทุกคนมีพอร์ต Default "หนึ่งอันเป๊ะ" และสินทรัพย์ทุกแถวสังกัดพอร์ตเสมอ
--
-- Invariant นี้คือสิ่งที่ทำให้โค้ดฝั่ง Application ไม่ต้องมี Branch "ถ้าไม่มีพอร์ต
-- แล้วจะทำยังไง" กระจายอยู่ทุกที่ (ซึ่งเป็นแหล่งบั๊ก NULL-handling ชั้นดี)
--
-- ── ความเสี่ยง: 🟡 กลาง — Migration แรกของชุดนี้ที่ "แตะข้อมูลเดิมจริง" ──────────
-- 042/043 เป็น Additive ล้วน (เพิ่มคอลัมน์ว่าง) แต่ตัวนี้ INSERT แถวใหม่และ
-- UPDATE แถวเดิมของผู้ใช้จริง — ต้อง Apply บน Staging + นับแถวก่อน/หลังให้ตรง
-- ก่อนแตะ Production เสมอ (AI_WORK_POLICY.md § 4.5)
--
-- ⚠️ ไม่มีการ DELETE แม้แต่แถวเดียวใน Migration นี้ (กฎเหล็ก AI_CONTEXT.md ข้อ 2)
--
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ 2 จุดที่ "ต่างจาก Design Doc § 3.3" โดยตั้งใจ — อ่านก่อนรัน ⚠️⚠️
-- ═══════════════════════════════════════════════════════════════════════
--
-- (1) Design Doc เขียน Backfill ว่า INSERT ... type = 'mixed'
--     แต่ 'mixed' ไม่ใช่ค่าที่ถูกต้อง! CHECK ของ portfolios.type ตาม
--     DATABASE.md § 3.2 บรรทัด 137 คือ
--         CHECK (type IN ('crypto','stock_th','stock_us','etf','fund','custom'))
--     ไม่มี 'mixed' อยู่ในลิสต์ และคำว่า 'mixed' ไม่ปรากฏที่ไหนเลยในโค้ดทั้งโปรเจกต์
--     → ถ้ารันตาม Design Doc ตรงๆ Backfill จะ ERROR ทั้งก้อนทันที
--     → Migration นี้ใช้ 'custom' ซึ่งอยู่ใน CHECK อยู่แล้ว และมีความหมายตรงที่สุด
--       สำหรับ "พอร์ตรวมทุกประเภทสินทรัพย์" + มี Pre-flight ตรวจซ้ำใน STEP 1
--
-- (2) Design Doc Backfill เฉพาะ user ที่ "มี assets" เท่านั้น
--     → Migration นี้สร้างให้ผู้ใช้ "ทุกคน" เพื่อให้ Invariant ดาวข้างบนเป็นจริง
--       จริงๆ ไม่มีข้อยกเว้น ถ้าเว้น user ที่ยังไม่มีสินทรัพย์ไว้ วันที่เขาซื้อ
--       ตัวแรกโค้ดจะต้องมี Branch "ยังไม่มีพอร์ต" อีก ซึ่งคือสิ่งที่พยายามกำจัด
--     รวม user ที่ถูก Anonymize (PDPA) ด้วยโดยตั้งใจ — ชื่อ 'พอร์ตหลัก' ไม่ใช่ PII
--     จึงไม่ขัดกฎ Erasure และการเว้นไว้จะทำให้ Guard ของ 045 ต้องมีข้อยกเว้นพิเศษ
--
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 0 — Pre-flight: ยืนยันว่าตาราง portfolios มีจริง
-- ═══════════════════════════════════════════════════════════════════════
-- ทำไมต้องตรวจ: ตาราง portfolios ไม่มีไฟล์ Migration ของตัวเองเลย มันถูกสร้าง
-- ด้วยมือจาก DDL ใน DATABASE.md § 3.2 ตอนตั้งโปรเจกต์ (ก่อนระบบ migration ที่
-- ไฟล์ 001) — เราจึง "ไม่มีหลักฐานในรีโปว่ามันหน้าตาตรงเอกสารจริง"
-- (CLAUDE.md: อย่าเชื่อคำว่า "ปิดแล้ว" ในเอกสาร 100%)
DO $$
BEGIN
  IF to_regclass('public.portfolios') IS NULL THEN
    RAISE EXCEPTION
      'Migration 044 หยุด: ไม่พบตาราง portfolios — ต้องสร้างจาก DDL ใน DATABASE.md § 3.2 ก่อน';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 1 — Pre-flight: ยืนยันว่า CHECK ของ portfolios.type รับค่า 'custom' จริง
-- ═══════════════════════════════════════════════════════════════════════
-- นี่คือด่านที่ดักปัญหา 'mixed' ข้างบน — ตรวจ "ของจริงใน DB" ไม่ใช่เชื่อเอกสาร
-- ถ้า CHECK จริงบน Supabase ต่างจากที่ DATABASE.md เขียนไว้ ต้องรู้ "ก่อน" ที่จะ
-- ไป INSERT แล้วพังกลางทาง
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.portfolios'::regclass
     AND c.contype  = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%type%'
   LIMIT 1;

  IF v_def IS NULL THEN
    -- ไม่มี CHECK เลย = ใส่ค่าอะไรก็ได้ ไม่ต้องหยุด แต่ต้องบันทึกไว้ให้เห็น
    RAISE NOTICE 'Migration 044: ไม่พบ CHECK บน portfolios.type (ข้ามการตรวจค่า custom)';
  ELSIF v_def NOT ILIKE '%''custom''%' THEN
    RAISE EXCEPTION
      'Migration 044 หยุด: CHECK ของ portfolios.type ไม่รับค่า ''custom'' — ของจริงคือ % (แก้ค่า Backfill ให้ตรงก่อนรันใหม่)',
      v_def;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 2 — คอลัมน์ is_default
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ใช้ IF NOT EXISTS เพราะ DATABASE.md § 3.2 บรรทัด 138 ระบุ is_default ไว้ใน
-- CREATE TABLE ตั้งแต่ต้น — แปลว่าคอลัมน์นี้ "น่าจะมีอยู่แล้ว" บน Supabase
-- แต่ไม่มีโค้ด JS บรรทัดใดในระบบเคยอ่าน/เขียนมันเลย (grep แล้ว 0 จุด) จึงยืนยัน
-- ด้วยตาไม่ได้ว่ามีจริง → เขียนให้ Idempotent ปลอดภัยทั้งสองกรณี
--
-- DEFAULT FALSE + NOT NULL: ถ้าคอลัมน์เพิ่งถูกเพิ่ม ทุกแถวเดิมจะเป็น FALSE
-- ทั้งหมด ทำให้ STEP 3 (CREATE UNIQUE INDEX) ผ่านแน่นอน แล้ว STEP 4 ค่อยเลือก
-- ว่าแถวไหนควรเป็น Default
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 3 — บังคับ "Default ได้ 1 อันต่อ user" ที่ระดับ DB
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ จงใจสร้าง Index นี้ "ก่อน" Backfill ไม่ใช่หลัง — 2 เหตุผล:
--   1. ถ้าข้อมูลเดิมละเมิดอยู่แล้ว (user มี 2 พอร์ตที่ is_default = TRUE ทั้งคู่
--      จากยุคที่ยังไม่มีกฎนี้) Migration จะหยุด "ก่อน" ที่จะไปแก้ข้อมูลใดๆ
--      = ล้มแบบไม่ทิ้งร่องรอยครึ่งๆ กลางๆ ให้ต้องตามเก็บ
--   2. STEP 4/5 ที่ตามมาจะถูก DB คุมให้ทำผิดไม่ได้เลย (โครงสร้างบังคับ
--      ไม่ใช่วินัยของคนเขียน SQL) — Pattern เดียวกับ uniq_brokers_user_name_ci
--
-- Partial Index (WHERE is_default = TRUE): พอร์ตที่ไม่ใช่ Default มีกี่อันก็ได้
-- ต่อ user จึงต้อง Index เฉพาะแถวที่ TRUE เท่านั้น
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolios_one_default_per_user
  ON portfolios (user_id)
  WHERE is_default = TRUE;

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 4 — Backfill (ก): user ที่ "มีพอร์ตอยู่แล้ว แต่ไม่มีอันไหนเป็น Default"
-- ═══════════════════════════════════════════════════════════════════════
-- เลื่อนขั้นพอร์ตที่เก่าที่สุดของเขาให้เป็น Default แทนการสร้างพอร์ตใหม่ทับ
-- (ถ้าสร้างใหม่ ผู้ใช้จะงงว่าพอร์ตที่ไม่รู้จักโผล่มาจากไหน และพอร์ตเดิมที่เขา
--  ตั้งใจสร้างจะกลายเป็น "พอร์ตรอง" โดยไม่มีใครสั่ง)
--
-- ⚠️ ต้อง Deterministic 100% — DISTINCT ON + ORDER BY created_at ASC, id ASC
-- (id เป็น Tiebreak กันกรณี created_at เท่ากันเป๊ะ ซึ่งเกิดได้จริงถ้า INSERT
--  หลายแถวใน Statement เดียว) รันซ้ำกี่รอบก็ได้ผลเดิมเสมอ
--
-- กฎนี้ต้องตรงกับ Q4.1(ก) ที่ Founder ตัดสิน: "พอร์ตแรกสุด (created_at เก่าสุด)
-- = พอร์ตที่ยังเขียนได้เมื่อ Premium หมดอายุ" — Default จึงต้องเป็นพอร์ตเก่าสุด
UPDATE portfolios
   SET is_default = TRUE
 WHERE id IN (
   SELECT DISTINCT ON (p.user_id) p.id
     FROM portfolios p
    WHERE p.user_id IN (
            SELECT user_id
              FROM portfolios
             GROUP BY user_id
            HAVING bool_or(is_default) = FALSE   -- ยังไม่มี Default เลยสักอัน
          )
    ORDER BY p.user_id, p.created_at ASC, p.id ASC
 );

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 5 — Backfill (ข): user ที่ "ไม่มีพอร์ตเลยแม้แต่อันเดียว" (กรณีส่วนใหญ่)
-- ═══════════════════════════════════════════════════════════════════════
-- ตาม Migration 014 + Comment ใน 001 ระบบวันนี้ portfolio_id เป็น NULL แทบ 100%
-- แปลว่าผู้ใช้เกือบทั้งหมดจะเข้าเงื่อนไขข้อนี้
--
-- type = 'custom' (ไม่ใช่ 'mixed' ตาม Design Doc — ดูหัวข้อ (1) ข้างบน)
INSERT INTO portfolios (user_id, name, type, is_default)
SELECT u.id, 'พอร์ตหลัก', 'custom', TRUE
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM portfolios p WHERE p.user_id = u.id);

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 6 — Pre-flight ของ STEP 7: ตรวจการชนกับ UNIQUE ของ Migration 014
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ จุดนี้ Design Doc § 3.3 วิเคราะห์ไว้ "ไม่ครบ" ⚠️⚠️
--
-- Design Doc บอกว่าการย้าย portfolio_id จาก NULL → uuid ไม่ทำให้ชนกันเพิ่ม
-- เพราะ UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id) ถือว่า NULL
-- ชนกันอยู่แล้ว — "ถูกเฉพาะกรณีที่ผู้ใช้ไม่เคยมีพอร์ตมาก่อน" (STEP 5)
--
-- แต่มีเคสที่ตกสำรวจ: ผู้ใช้ที่ "มีพอร์ตอยู่แล้ว" (STEP 4) และบังเอิญถือ symbol
-- เดียวกัน 2 แถว — แถวหนึ่ง portfolio_id = NULL อีกแถว portfolio_id = พอร์ตที่
-- เพิ่งถูกตั้งเป็น Default:
--
--     assets: (user=U, symbol=BTC, portfolio_id=NULL)   ← ไม่ชนกัน เพราะ
--     assets: (user=U, symbol=BTC, portfolio_id=P1)     ← NULL <> P1
--
-- พอ STEP 7 ย้ายแถวแรกเข้า P1 → กลายเป็น (U,BTC,P1) ทั้งคู่ = ชน UNIQUE ทันที
-- Migration จะ ERROR กลางทางด้วยข้อความ Constraint ดิบๆ ที่อ่านไม่รู้เรื่อง
--
-- ตรวจก่อนที่นี่เพื่อให้ล้มพร้อม "ข้อความที่บอกวิธีแก้" แทน (และล้มก่อนแตะข้อมูล)
-- การแก้ต้อง Merge asset 2 แถวเข้าด้วยกันด้วยมือ ซึ่งเป็นงานที่แตะ Ledger
-- (ย้าย transactions ข้าม asset_id) → ห้าม AI ทำอัตโนมัติในสคริปต์ Migration
DO $$
DECLARE
  v_conflicts INT;
  v_sample    TEXT;
BEGIN
  SELECT count(*),
         string_agg(DISTINCT format('user=%s symbol=%s', a.user_id, a.symbol), ' | ')
    INTO v_conflicts, v_sample
    FROM assets a
    JOIN portfolios p
      ON p.user_id = a.user_id
     AND p.is_default = TRUE
   WHERE a.portfolio_id IS NULL
     AND EXISTS (
           SELECT 1 FROM assets a2
            WHERE a2.user_id      = a.user_id
              AND a2.symbol       = a.symbol
              AND a2.portfolio_id = p.id
         );

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION
      'Migration 044 หยุดก่อนแตะข้อมูล: มี % แถวที่ย้ายเข้าพอร์ต Default แล้วจะชน UNIQUE ของ migration 014 (user_id,symbol,portfolio_id) — ต้อง Merge asset ซ้ำด้วยมือก่อน (งานนี้แตะ Ledger ห้ามทำอัตโนมัติ) · ตัวอย่าง: %',
      v_conflicts, v_sample;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 7 — ย้ายสินทรัพย์ที่ยังไม่สังกัดพอร์ต เข้าพอร์ต Default ของเจ้าของ
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ นี่คือ Statement เดียวใน Migration ที่แก้ข้อมูลเดิมของผู้ใช้จริง
--
-- ปลอดภัยเพราะ:
--   · จับคู่ด้วย p.user_id = a.user_id เสมอ — เป็นไปไม่ได้ที่สินทรัพย์ของ A
--     จะถูกย้ายเข้าพอร์ตของ B (นี่คือ Cross-User Isolation ระดับ SQL)
--   · STEP 3 การันตีว่า p ที่ Match ได้มีไม่เกิน 1 แถวต่อ user
--   · STEP 6 การันตีแล้วว่าไม่มีการชน UNIQUE
--   · จำนวนแถวใน assets "ไม่เปลี่ยน" (UPDATE ไม่ใช่ INSERT/DELETE)
UPDATE assets a
   SET portfolio_id = p.id
  FROM portfolios p
 WHERE a.portfolio_id IS NULL
   AND p.user_id     = a.user_id
   AND p.is_default  = TRUE;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply — Migration 045 จะบังคับซ้ำอีกชั้นแบบอัตโนมัติ)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ข้อ 0 ต้องรัน "ก่อน" Apply แล้วจดเลขไว้เทียบกับข้อ 4 หลัง Apply
--
-- 0) [ก่อน Apply] นับจำนวนแถวตั้งต้น — จดไว้เทียบทีหลัง
--   SELECT (SELECT count(*) FROM assets)     AS assets_ก่อน,
--          (SELECT count(*) FROM portfolios) AS portfolios_ก่อน,
--          (SELECT count(*) FROM users)      AS users_ก่อน,
--          (SELECT count(*) FROM assets WHERE portfolio_id IS NULL) AS assets_ไม่มีพอร์ต_ก่อน;
--
-- 1) ผู้ใช้ทุกคนมีพอร์ต Default "หนึ่งอันเป๊ะ" (หัวใจของ Migration นี้)
--   SELECT count(*) AS user_ที่ไม่มี_default
--     FROM users u
--    WHERE NOT EXISTS (SELECT 1 FROM portfolios p
--                       WHERE p.user_id = u.id AND p.is_default);
--   คาดหวัง: 0
--
--   SELECT count(*) AS user_ที่มี_default_เกิน_1 FROM (
--     SELECT user_id FROM portfolios WHERE is_default
--      GROUP BY user_id HAVING count(*) > 1) x;
--   คาดหวัง: 0   (ถ้าไม่ใช่ 0 แปลว่า idx_portfolios_one_default_per_user ไม่ถูกสร้าง)
--
-- 2) สินทรัพย์ทุกแถวสังกัดพอร์ตแล้ว
--   SELECT count(*) AS assets_ไม่มีพอร์ต FROM assets WHERE portfolio_id IS NULL;
--   คาดหวัง: 0
--
-- 3) ⭐ ไม่มีสินทรัพย์แถวใดถูกย้ายไปพอร์ตของ "คนอื่น" (Cross-User — ข้อที่สำคัญที่สุด)
--   SELECT count(*) AS ข้ามเจ้าของ
--     FROM assets a JOIN portfolios p ON p.id = a.portfolio_id
--    WHERE p.user_id <> a.user_id;
--   คาดหวัง: 0  (ถ้าไม่ใช่ 0 = หยุดทุกอย่างแล้ว Rollback ทันที)
--
-- 4) [หลัง Apply] จำนวนแถวเทียบกับข้อ 0
--   SELECT (SELECT count(*) FROM assets)     AS assets_หลัง,
--          (SELECT count(*) FROM portfolios) AS portfolios_หลัง;
--   คาดหวัง: assets_หลัง = assets_ก่อน  (เป๊ะ — Migration นี้ไม่ INSERT/DELETE assets)
--            portfolios_หลัง = portfolios_ก่อน + จำนวน user ที่ยังไม่มีพอร์ต
--
-- 5) ดูผลการ Backfill ว่าสมเหตุสมผล (Sanity ด้วยตา)
--   SELECT name, type, is_default, count(*)
--     FROM portfolios GROUP BY name, type, is_default ORDER BY count(*) DESC;
--   คาดหวัง: แถว 'พอร์ตหลัก' / 'custom' / true จำนวนมาก (= user ที่เพิ่ง Backfill)
--
-- 6) UNIQUE ของ migration 014 ยังทำงานอยู่ (ไม่ได้ถูกแตะใน Migration นี้)
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'assets'::regclass AND contype = 'u';
--   คาดหวัง: assets_user_id_symbol_portfolio_id_key
--            UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id)

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ Migration นี้ Rollback "ยากกว่า" 042/043 มาก เพราะแตะข้อมูลเดิมจริง
--    → ต้องมี Backup ของ assets.portfolio_id ก่อน Apply เสมอ ไม่มีข้อยกเว้น
--
-- ขั้น 0 — [บังคับ ก่อน Apply] สำรองการจับคู่เดิมไว้ในตารางถาวร
--   CREATE TABLE _backup_044_assets_portfolio AS
--     SELECT id AS asset_id, user_id, symbol, portfolio_id, now() AS backed_up_at
--       FROM assets;
--   -- ห้ามใช้ TEMP TABLE (หายเมื่อปิด Session) และห้าม DROP ตารางนี้จนกว่าจะ
--   -- ยืนยันว่า Stage ถัดไปทำงานถูกต้องบน Production แล้วอย่างน้อย 1 สัปดาห์
--
-- ขั้น 1 — Revert โค้ด (Railway Redeploy ตัวก่อนหน้า ทั้ง EasyDCA + easydca-worker)
--          โค้ดเก่าไม่เคยอ่าน is_default และมองว่า portfolio_id เป็น Optional
--          อยู่แล้ว จึงทำงานต่อได้แม้ข้อมูลถูก Backfill ไปแล้ว
--          → ในหลายกรณี "หยุดแค่ขั้นนี้พอ" ไม่ต้องถอนข้อมูล
--
-- ขั้น 2 — ถ้าต้องถอนข้อมูลจริง (คืน portfolio_id เดิมทุกแถว):
--   UPDATE assets a
--      SET portfolio_id = b.portfolio_id
--     FROM _backup_044_assets_portfolio b
--    WHERE b.asset_id = a.id
--      AND a.portfolio_id IS DISTINCT FROM b.portfolio_id;
--
-- ขั้น 3 — ถอนพอร์ตที่ Migration นี้สร้างขึ้นเอง (⚠️ อ่านเงื่อนไขให้ดี)
--   -- ลบเฉพาะพอร์ตที่ "ระบบสร้างให้" และ "ไม่มีสินทรัพย์สังกัดอยู่แล้ว" เท่านั้น
--   -- ห้ามลบพอร์ตที่ผู้ใช้สร้างเอง (กฎเหล็ก AI_CONTEXT.md ข้อ 2)
--   DELETE FROM portfolios p
--    WHERE p.name = 'พอร์ตหลัก' AND p.type = 'custom' AND p.is_default
--      AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.portfolio_id = p.id)
--      AND NOT EXISTS (SELECT 1 FROM portfolio_snapshots s WHERE s.portfolio_id = p.id);
--
-- ขั้น 4 — ถอนโครงสร้าง (ทำก็ต่อเมื่อจะเลิกฟีเจอร์นี้ถาวรเท่านั้น)
--   DROP INDEX IF EXISTS idx_portfolios_one_default_per_user;
--   -- ⚠️ ห้าม DROP COLUMN is_default: DATABASE.md § 3.2 ระบุว่ามันเป็นส่วนหนึ่ง
--   --    ของ CREATE TABLE ดั้งเดิม การ DROP จะทำให้ Schema ต่างจากเอกสารถาวร
--
-- ⚠️ สิ่งที่ "ไม่" ถูกแตะเลยใน Migration นี้ (ยืนยันได้จากตัวไฟล์):
--    transactions (Ledger) · portfolio_snapshots · payments · users
--    → Rollback ไม่มีทางกระทบ Ledger หรือ P&L ย้อนหลัง
