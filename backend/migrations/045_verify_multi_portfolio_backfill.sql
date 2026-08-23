-- ═══════════════════════════════════════════════════════════════════════
-- Migration 045 — Guard ตรวจผลลัพธ์ของ Backfill 044 (ไม่แก้ข้อมูลใดๆ)
-- ═══════════════════════════════════════════════════════════════════════
-- Stage 4 ของ Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
-- (ออกแบบไว้ที่ docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 3.4)
--
-- ── ทำไมต้องแยกไฟล์จาก 044 (ไม่รวมเป็นไฟล์เดียว) ──────────────────────────────
-- ถ้ารวมกันแล้วพัง จะแยกไม่ออกว่าพังที่ "ขั้นย้ายข้อมูล" หรือ "ขั้นตรวจ" —
-- แยกไฟล์แล้วอ่าน Error ปุ๊บรู้ทันทีว่าอยู่ขั้นไหน (Design Doc § 3.4)
--
-- ── ไฟล์นี้ทำอะไร ────────────────────────────────────────────────────────────
-- SELECT อย่างเดียวล้วนๆ — ไม่มี INSERT/UPDATE/DELETE/ALTER แม้แต่บรรทัดเดียว
-- ถ้าเจอข้อมูลที่ละเมิด Invariant ให้ RAISE EXCEPTION เพื่อ "บล็อกไม่ให้ Deploy
-- โค้ดที่สมมติว่า Invariant เป็นจริงต่อไป"
--
-- ── ความเสี่ยง: 🟢 ต่ำที่สุดในชุด (Read-only) ────────────────────────────────
-- รันซ้ำกี่รอบก็ได้ ไม่มีผลข้างเคียง — ใช้เป็น Health Check ประจำได้ด้วย
--
-- ⚠️ ถ้าไฟล์นี้ ERROR: ห้าม Deploy โค้ด Stage ถัดไป ให้กลับไปดู Rollback Plan
--    ของ 044 แล้วแก้ต้นเหตุก่อน — อย่า "ข้ามไปก่อนแล้วค่อยแก้ทีหลัง"
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_users_no_default     INT;
  v_users_many_default   INT;
  v_assets_no_portfolio  INT;
  v_assets_cross_user    INT;
  v_index_exists         BOOLEAN;
  v_sample               TEXT;
BEGIN
  -- ═════════════════════════════════════════════════════════════════════
  -- CHECK 1 — ผู้ใช้ทุกคนต้องมีพอร์ต Default อย่างน้อย 1 อัน
  -- ═════════════════════════════════════════════════════════════════════
  SELECT count(*) INTO v_users_no_default
    FROM users u
   WHERE NOT EXISTS (
           SELECT 1 FROM portfolios p
            WHERE p.user_id = u.id AND p.is_default
         );

  IF v_users_no_default > 0 THEN
    RAISE EXCEPTION
      'Migration 045 CHECK 1 ล้มเหลว: มีผู้ใช้ % คนที่ไม่มีพอร์ต Default — Backfill ของ 044 ไม่ครบ (STEP 5 อาจไม่ได้รัน) ห้าม Deploy ต่อ',
      v_users_no_default;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════
  -- CHECK 2 — ผู้ใช้แต่ละคนต้องมีพอร์ต Default ไม่เกิน 1 อัน
  -- ═════════════════════════════════════════════════════════════════════
  -- ปกติ idx_portfolios_one_default_per_user (044 STEP 3) กันไว้ที่ระดับ DB แล้ว
  -- ตรวจซ้ำที่นี่เผื่อกรณี Index ไม่ได้ถูกสร้างจริง (เช่นมีคนรัน 044 แค่บางส่วน)
  SELECT count(*) INTO v_users_many_default
    FROM (
      SELECT user_id FROM portfolios WHERE is_default
       GROUP BY user_id HAVING count(*) > 1
    ) x;

  IF v_users_many_default > 0 THEN
    RAISE EXCEPTION
      'Migration 045 CHECK 2 ล้มเหลว: มีผู้ใช้ % คนที่มีพอร์ต Default มากกว่า 1 อัน — Unique Index ไม่ทำงาน ห้าม Deploy ต่อ',
      v_users_many_default;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════
  -- CHECK 3 — สินทรัพย์ทุกแถวต้องสังกัดพอร์ตแล้ว (ไม่เหลือ NULL)
  -- ═════════════════════════════════════════════════════════════════════
  SELECT count(*) INTO v_assets_no_portfolio
    FROM assets WHERE portfolio_id IS NULL;

  IF v_assets_no_portfolio > 0 THEN
    RAISE EXCEPTION
      'Migration 045 CHECK 3 ล้มเหลว: ยังมีสินทรัพย์ % แถวที่ portfolio_id IS NULL — 044 STEP 7 ไม่ครบ ห้าม Deploy ต่อ',
      v_assets_no_portfolio;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════
  -- ⭐ CHECK 4 — สินทรัพย์ต้องไม่สังกัดพอร์ตของ "ผู้ใช้คนอื่น" (Cross-User)
  -- ═════════════════════════════════════════════════════════════════════
  -- ข้อนี้สำคัญที่สุดในไฟล์นี้ และเป็นข้อที่ Design Doc ไม่ได้ระบุไว้
  --
  -- เหตุผล: EasyDCA ใช้ service_role key และไม่ได้เปิด RLS จริง — Database
  -- ไม่ตรวจสิทธิ์ให้เลย (Design Doc § 6 / PROJECT_STATUS กฎยืนข้อ 3) FK ของ
  -- assets.portfolio_id ตรวจได้แค่ "พอร์ตนี้มีอยู่จริง" ไม่ได้ตรวจ "เป็นของใคร"
  -- ถ้า Backfill เขียนผิดแม้แต่บรรทัดเดียว สินทรัพย์ของ A จะไปโผล่ในพอร์ตของ B
  -- แล้วรั่วเข้าหน้า Dashboard/รายงานของ B ทันทีโดยไม่มี Error ใดๆ
  --
  -- Audit 9 ส.ค. เคยเจอช่องโหว่ Cross-User จริง 6 จุดบนเส้นทางเงินมาแล้ว —
  -- ข้อนี้คือด่านที่บังคับว่ามันจะไม่เกิดซ้ำจาก Migration ชุดนี้
  SELECT count(*),
         string_agg(DISTINCT format('asset=%s เจ้าของ=%s แต่พอร์ตเป็นของ=%s',
                                    a.id, a.user_id, p.user_id), ' | ')
    INTO v_assets_cross_user, v_sample
    FROM assets a
    JOIN portfolios p ON p.id = a.portfolio_id
   WHERE p.user_id <> a.user_id;

  IF v_assets_cross_user > 0 THEN
    RAISE EXCEPTION
      'Migration 045 CHECK 4 ล้มเหลว (ร้ายแรงที่สุด): มีสินทรัพย์ % แถวสังกัดพอร์ตของผู้ใช้คนอื่น = ข้อมูลข้ามบัญชี ให้ Rollback 044 ทันทีตาม Rollback Plan ขั้น 2 · ตัวอย่าง: %',
      v_assets_cross_user, v_sample;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════
  -- CHECK 5 — Unique Index ของ 044 STEP 3 ต้องมีอยู่จริง
  -- ═════════════════════════════════════════════════════════════════════
  -- ถ้า Index หายไป CHECK 2 จะผ่านได้ "ตอนนี้" แต่ข้อมูลจะเริ่มละเมิดในอนาคต
  -- ทันทีที่มีคนสร้างพอร์ตใหม่ — ตรวจการมีอยู่ของโครงสร้าง ไม่ใช่แค่สภาพข้อมูล
  SELECT EXISTS (
           SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename  = 'portfolios'
              AND indexname  = 'idx_portfolios_one_default_per_user'
         ) INTO v_index_exists;

  IF NOT v_index_exists THEN
    RAISE EXCEPTION
      'Migration 045 CHECK 5 ล้มเหลว: ไม่พบ idx_portfolios_one_default_per_user — 044 STEP 3 ไม่ได้รัน ห้าม Deploy ต่อ';
  END IF;

  -- ═════════════════════════════════════════════════════════════════════
  -- ผ่านครบทุกข้อ
  -- ═════════════════════════════════════════════════════════════════════
  RAISE NOTICE 'Migration 045: ผ่านครบ 5 ข้อ — Invariant "ทุก user มีพอร์ต Default 1 อัน + สินทรัพย์ทุกแถวสังกัดพอร์ตของเจ้าของตัวเอง" เป็นจริงแล้ว';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (ถ้าอยากเห็นตัวเลขจริงแทนที่จะดูแค่ผ่าน/ไม่ผ่าน ให้รันชุดนี้)
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT
--   (SELECT count(*) FROM users u
--     WHERE NOT EXISTS (SELECT 1 FROM portfolios p
--                        WHERE p.user_id = u.id AND p.is_default))     AS "1_user_ไม่มี_default",
--   (SELECT count(*) FROM (SELECT user_id FROM portfolios WHERE is_default
--                           GROUP BY user_id HAVING count(*) > 1) x)   AS "2_user_default_เกิน1",
--   (SELECT count(*) FROM assets WHERE portfolio_id IS NULL)           AS "3_assets_ไม่มีพอร์ต",
--   (SELECT count(*) FROM assets a JOIN portfolios p ON p.id = a.portfolio_id
--     WHERE p.user_id <> a.user_id)                                    AS "4_assets_ข้ามเจ้าของ",
--   (SELECT count(*) FROM pg_indexes WHERE tablename = 'portfolios'
--     AND indexname = 'idx_portfolios_one_default_per_user')           AS "5_index_มีไหม";
--
-- คาดหวัง: 0 · 0 · 0 · 0 · 1

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN
-- ═══════════════════════════════════════════════════════════════════════
-- ไฟล์นี้ไม่เปลี่ยนแปลงอะไรใน Database เลย (SELECT + RAISE เท่านั้น)
-- จึง "ไม่มีอะไรต้อง Rollback" — ถ้ามันล้ม สิ่งที่ต้อง Rollback คือ 044
-- ให้ทำตาม ROLLBACK PLAN ท้ายไฟล์ 044_enable_multi_portfolio.sql
