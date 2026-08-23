-- ═══════════════════════════════════════════════════════════════════════
-- Migration 043 — assets.sector (หมวดธุรกิจ/กลุ่มสินทรัพย์)
-- ═══════════════════════════════════════════════════════════════════════
-- Stage 2 ของ Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
-- (ออกแบบไว้ที่ docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 3.2)
--
-- ── ทำอะไร ────────────────────────────────────────────────────────────────
-- เพิ่มที่เก็บ "หมวด/Sector ของสินทรัพย์" ซึ่งวันนี้ระบบไม่มีเลยแม้แต่คอลัมน์เดียว
-- หน้า Portfolio ฝั่งเว็บต้องใช้ทำ "Sector Allocation" (สัดส่วนมูลค่าพอร์ตแยกตามหมวด)
--
-- ── ความเสี่ยง: 🟢 ต่ำ (Additive ล้วน) ────────────────────────────────────
-- ไม่มีโค้ดเดิมบรรทัดใดอ่าน/เขียนคอลัมน์นี้ · ไม่แตะข้อมูลเดิมแม้แถวเดียว ·
-- ไม่แตะสูตรคำนวณเงินใดๆ — sector เป็น Metadata สำหรับจัดกลุ่มแสดงผลเท่านั้น
-- ไม่เข้าไปอยู่ในสูตร P&L / heldQty / costBasis จุดใดทั้งสิ้น (เหมือน broker_id)
--
-- Dependency: ไม่มี (ALTER TABLE ... ADD COLUMN ล้วน ไม่สร้าง Function ใหม่
-- จึงไม่มี search_path ให้ต้องล็อกแบบ migration 028)
--
-- อ้างอิงหลักการ: DATABASE.md § 9 (ALTER Additive), § 10 (Index)
-- AI_WORK_POLICY.md § 4.5 (Migration ต้องมี Rollback Plan เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════

-- ── ทำไมเป็น "คอลัมน์ธรรมดา" ไม่ใช่ตาราง sectors แยก (ต่างจาก brokers) ───────────
--   ต่างจาก broker ตรงที่ sector เป็น "แอตทริบิวต์ของสินทรัพย์" ไม่ใช่ Entity ที่
--   ผู้ใช้เป็นเจ้าของ — ไม่มีข้อมูลอื่นห้อยอยู่กับมันเลย (ไม่มี created_at/settings
--   ของ sector, ผู้ใช้ไม่เคย "จัดการรายการ sector" แบบที่จัดการรายชื่อโบรก)
--   ทำตารางแยกจะได้แค่ JOIN เพิ่มโดยไม่ได้อะไรกลับมา
--
-- ── ทำไมไม่ใส่ CHECK จำกัด "ค่าที่อนุญาต" (Enum/Whitelist) ────────────────────
--   Taxonomy ของ Sector ต่างกันตามประเภทสินทรัพย์อย่างสิ้นเชิง:
--     หุ้นไทย  → SET Industry Group (เทคโนโลยี/ธนาคาร/พลังงาน...)
--     คริปโต   → DeFi / Layer 1 / Meme / RWA ...
--     กองทุนรวม → ประเภทตาม AIMC
--   การล็อกค่าเร็วเกินไปจะบล็อกตัวเองทันทีที่มีสินทรัพย์ประเภทใหม่ — ปล่อยเป็น
--   Free Text ก่อน แล้วค่อยดู Analytics ทีหลังว่าค่าไหนซ้ำบ่อยจน "ควร" ทำ Whitelist
--
--   CHECK ด้านล่างจึงคุมแค่ "รูปร่าง" (ไม่ว่าง/ไม่ยาวเกิน) ไม่คุม "ค่า"
--
-- ⚠️ NULL = "ไม่ระบุ" ไม่ใช่ "ไม่มี" — แถวเดิมทั้งหมดก่อน migration นี้เป็น NULL
--   UI ต้องแสดงเป็นกลุ่ม "ไม่ระบุ" ไม่ใช่ซ่อนแถวทิ้ง มิฉะนั้นยอดรวมบนกราฟโดนัท
--   จะไม่เท่ามูลค่าพอร์ตจริง (Design Doc § 7 Backward Compatibility)
--
-- ⚠️ ความยาว 60 ตัวอักษรต้องตรงกับ SECTOR_MAX_LENGTH ในชั้น Service
--   (เลขนี้อยู่ 2 ที่โดยเจตนา: App บอกผู้ใช้เป็นภาษาไทยได้ / DB เป็นด่านสุดท้าย
--   ที่ Path อื่นในอนาคตข้ามไม่ได้) — ถ้าจะแก้ต้องแก้พร้อมกันทั้งคู่
--   Pattern เดียวกับ brokers.name (migration 042)
ALTER TABLE assets
  ADD COLUMN sector TEXT
    CONSTRAINT assets_sector_shape_check
    CHECK (sector IS NULL OR (btrim(sector) <> '' AND char_length(sector) <= 60));

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- ⚠️ จงใจ Index บน lower(sector) ไม่ใช่ sector ดิบ
--
-- เหตุผลเดียวกับ uniq_brokers_user_name_ci ใน migration 042 เป๊ะ: การจัดกลุ่ม
-- Sector Allocation ต้องมองว่า "Technology" กับ "technology" เป็นหมวดเดียวกัน
-- ไม่งั้นกราฟโดนัทจะแตกเป็น 2 กลุ่มทั้งที่เป็นหมวดเดียวกัน — Query ที่ใช้จริง
-- ในชั้น Allocation จึงจัดกลุ่มด้วย lower(sector) และ Index ต้องตรงกับ Query นั้น
--
-- ⚠️ ต่างจาก brokers ตรงที่ "ไม่ UNIQUE" — สินทรัพย์หลายตัวอยู่หมวดเดียวกันได้
-- เป็นเรื่องปกติ (นั่นคือทั้งหมดของการทำ Allocation) ที่นี่ต้องการแค่ความเร็ว
--
-- Partial Index: แถวส่วนใหญ่ในระบบวันนี้ sector เป็น NULL (ของเดิมทั้งหมด)
-- การ Index เฉพาะแถวที่มีค่าจริงจึงเล็กกว่ามากและตรงกับ Query ที่ใช้จริง
CREATE INDEX idx_assets_sector_lower
  ON assets (lower(sector))
  WHERE sector IS NOT NULL;

COMMENT ON COLUMN assets.sector IS
  'หมวดธุรกิจ/กลุ่มของสินทรัพย์ที่ผู้ใช้ระบุเอง (Free Text — Taxonomy ต่างกันตามประเภทสินทรัพย์ จึงไม่ล็อกค่า) เก็บรูปแบบตัวพิมพ์ตามที่ผู้ใช้พิมพ์ แต่จัดกลุ่มแบบ Case-insensitive ด้วย lower(sector) · NULL = ไม่ระบุ (แถวเดิมทั้งหมดก่อน migration 043) UI ต้องแสดงเป็นกลุ่ม "ไม่ระบุ" ไม่ใช่ซ่อนแถว มิฉะนั้นยอดรวมโดนัทจะไม่เท่ามูลค่าพอร์ตจริง · ไม่เข้าสูตรคำนวณเงินใดๆ (migration 043)';

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply — คาดหวังผลตามที่เขียนกำกับไว้ทุกข้อ)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) คอลัมน์ sector เกิดจริง เป็น text และ Nullable
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'assets' AND column_name = 'sector';
--   คาดหวัง: sector | text | YES
--
-- 2) จำนวนแถว assets "ไม่เปลี่ยน" และทุกแถวเป็น NULL ทันทีหลัง Apply
--   SELECT count(*) AS ทั้งหมด,
--          count(*) FILTER (WHERE sector IS NULL)     AS ไม่ระบุหมวด,
--          count(*) FILTER (WHERE sector IS NOT NULL) AS ระบุหมวดแล้ว
--     FROM assets;
--   คาดหวังทันทีหลัง Apply: ไม่ระบุหมวด = ทั้งหมด · ระบุหมวดแล้ว = 0
--   (ค่าจะเริ่มไม่เป็น NULL ก็ต่อเมื่อ Deploy โค้ดใหม่แล้วผู้ใช้กรอกเองเท่านั้น)
--
-- 3) Index บน lower(sector) เกิดจริง (ต้องเห็นคำว่า lower อยู่ใน indexdef)
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'assets' AND indexname = 'idx_assets_sector_lower';
--   คาดหวัง: indexdef มี "lower(sector)" และมี "WHERE (sector IS NOT NULL)"
--
-- 4) CHECK กันค่าว่าง/ยาวเกินทำงานจริง — ทั้ง 3 ข้อนี้ต้อง ERROR ทั้งหมด
--    (รันในบล็อกที่ ROLLBACK ทิ้ง จะได้ไม่เหลือขยะในตาราง)
--   BEGIN;
--     -- 4a) ค่าว่างล้วน ต้องถูกปฏิเสธ
--     UPDATE assets SET sector = '   ' WHERE id = (SELECT id FROM assets LIMIT 1);
--     --   คาดหวัง: ERROR ... violates check constraint "assets_sector_shape_check"
--   ROLLBACK;
--   BEGIN;
--     -- 4b) ยาวเกิน 60 ตัวอักษร ต้องถูกปฏิเสธ
--     UPDATE assets SET sector = repeat('ก', 61) WHERE id = (SELECT id FROM assets LIMIT 1);
--     --   คาดหวัง: ERROR ... violates check constraint "assets_sector_shape_check"
--   ROLLBACK;
--   BEGIN;
--     -- 4c) ค่าปกติต้อง "ผ่าน" (Control Case — ถ้าข้อนี้ ERROR แปลว่า CHECK เข้มเกินไป)
--     UPDATE assets SET sector = 'เทคโนโลยี' WHERE id = (SELECT id FROM assets LIMIT 1);
--     --   คาดหวัง: UPDATE 1 (ไม่มี ERROR)
--   ROLLBACK;
--
-- 5) NULL ยังใส่ได้ (ต้องไม่ถูก CHECK บล็อก — นี่คือค่าของแถวเดิมทั้งหมด)
--   BEGIN;
--     UPDATE assets SET sector = NULL WHERE id = (SELECT id FROM assets LIMIT 1);
--     --   คาดหวัง: UPDATE 1 (ไม่มี ERROR)
--   ROLLBACK;

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับ: Revert โค้ดก่อน แล้วค่อยแตะ DB เสมอ
--
-- ขั้น 1 — Revert โค้ด (Railway Redeploy ตัวก่อนหน้า ทั้ง EasyDCA + easydca-worker)
--          โค้ดเก่าไม่รู้จักคอลัมน์ sector เลย จึงทำงานต่อได้ทันทีแม้คอลัมน์ยังอยู่
--          (Additive Migration ย้อนกลับได้โดยไม่ต้องรีบแตะ DB)
--
-- ขั้น 2 — ถ้าจำเป็นต้องถอน Schema จริง ให้ Export ก่อนเสมอ (ห้ามลบข้อมูลผู้ใช้
--          โดยไม่มีสำเนา — กฎเหล็ก AI_CONTEXT.md ข้อ 2):
--   SELECT id AS asset_id, user_id, symbol, sector
--     FROM assets WHERE sector IS NOT NULL ORDER BY user_id, symbol;
--
-- ขั้น 3 — ถอน:
--   ALTER TABLE assets DROP COLUMN IF EXISTS sector;   -- Index + CHECK ถูก Drop ตามเอง
--
-- ⚠️ สิ่งที่จะเสียไปถ้า Rollback: หมวดของสินทรัพย์ทั้งหมดที่ผู้ใช้กรอกไว้
-- ไม่กระทบ Ledger (transactions ไม่ถูกแตะเลย) · ไม่กระทบ P&L (sector ไม่อยู่ใน
-- สูตรใดๆ) · ไม่กระทบสิทธิ์ Premium · ไม่กระทบ broker_id (migration 042)
