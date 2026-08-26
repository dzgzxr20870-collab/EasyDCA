-- ═══════════════════════════════════════════════════════════════════════
-- Migration 048 — เพดานจำนวนพอร์ตต้อง Atomic + สลับพอร์ตหลักได้ (Stage 8-fix)
-- ═══════════════════════════════════════════════════════════════════════
-- Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
-- เกิดจากรีวิวโค้ด Stage 8 (24 ส.ค. 2569) — ดู docs/DECISIONS_LOG.md
--
-- ── ทำอะไร 2 อย่าง ───────────────────────────────────────────────────────
--   1) create_portfolio_locked()      — เพดานพอร์ตเป็น Atomic (ตาม Pattern 035)
--   2) set_default_portfolio_locked() — สลับ "พอร์ตหลัก" โดยไม่ชน Partial Unique
--
-- ── ความเสี่ยง: 🟡 กลาง ───────────────────────────────────────────────────
-- ไม่แตะข้อมูลเดิมแม้แถวเดียว (เพิ่ม Function ล้วน ไม่มี ALTER TABLE/UPDATE)
-- แต่แตะ Choke Point ของการสร้างพอร์ต + แตะ Invariant ของ 044/045 จึงต้อง
-- Verify ครบทุกข้อท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- [บั๊กที่ข้อ 1 แก้] — เพดานพอร์ตเป็น check-then-insert ที่ไม่ Atomic
-- ═══════════════════════════════════════════════════════════════════════
-- โค้ดเดิมใน portfolios.service.createPortfolio:
--
--   const limit   = entitlement.getActivePortfolioLimit(userRecord);
--   const current = await portfolioRepository.countByUser(userId);  -- อ่าน
--   if (current >= limit) throw ...                                 -- ตรวจ
--   return await portfolioRepository.create(...);                   -- เขียน ← ช่องว่าง
--
-- ผู้ใช้ Free กดสร้างพอร์ตสองแท็บพร้อมกัน → ทั้งคู่อ่านได้ current = 1 →
-- ผ่านการตรวจทั้งคู่ → **ได้ 2 พอร์ต ทะลุเพดาน Free** และไม่มีอะไรใน DB กันไว้เลย
--
-- นี่คือเคสเดียวกับที่ migration 035 (create_asset_locked) ถูกสร้างขึ้นมาแก้เป๊ะ
-- ในโปรเจกต์นี้มีทั้ง Pattern สำเร็จรูปและเทสต์ตัวอย่าง (tests/assetLimitRace.test.js)
-- อยู่แล้ว การปล่อยให้เพดานพอร์ตเป็น Pre-check ล้วนคือการถอยหลังจากมาตรฐานที่
-- ทีมตั้งไว้เอง (และ Entitlement คือหมวดเสี่ยงสูงตาม AI_WORK_POLICY § 4.2)
--
-- ⚠️ Pre-check ฝั่ง JS **ยังคงอยู่** และควรอยู่ต่อไป — มันตอบผู้ใช้ได้เร็วและ
-- ให้ข้อความที่อ่านรู้เรื่อง (แยก Free/Premium ได้) ส่วนที่นี่คือ **ด่านจริงที่
-- Race Condition ข้ามไม่ได้** เหมือนความสัมพันธ์ระหว่าง validateBuy กับ
-- create_asset_locked ทุกประการ

-- ═══════════════════════════════════════════════════════════════════════
-- 1) create_portfolio_locked() — Lock → นับ → Validate → INSERT ในธุรกรรมเดียว
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ p_portfolio_limit รับมาจาก Caller **ห้าม Hardcode เลข 1/50 ใน SQL** —
-- Single Source of Truth ของตัวเลขอยู่ที่ entitlement.service.js เหมือนที่
-- migration 035 ทำกับ p_asset_limit (ถ้า Hardcode ที่นี่ด้วย วันที่ Founder
-- เปลี่ยนเพดานจะต้องแก้ 2 ที่แล้วเพี้ยนไม่ตรงกันในที่สุด)
--
-- ⚠️ is_default = FALSE เสมอ **ห้ามเปิดให้ Caller ส่งมา** — พอร์ต Default เกิดได้
-- ทางเดียวคือ Backfill ของ migration 044 (หนึ่งอันต่อ user ตลอดไป) การสร้าง
-- Default ใหม่จะชน idx_portfolios_one_default_per_user ทันที และเปิดช่องให้
-- ผู้ใช้มีพอร์ต Default 0 อันได้ถ้าลบตัวเดิมทิ้ง = Invariant ของ 044/045 พัง
-- (การ "เปลี่ยน" พอร์ตหลักทำผ่าน set_default_portfolio_locked ข้อ 2 แทน)
CREATE OR REPLACE FUNCTION public.create_portfolio_locked(
  p_user_id         UUID,
  p_name            TEXT,
  p_type            TEXT,
  p_portfolio_limit INTEGER DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  user_id     UUID,
  name        TEXT,
  type        TEXT,
  is_default  BOOLEAN,
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
-- SECURITY DEFINER + REVOKE/GRANT ท้ายไฟล์ — เหตุผลเดียวกับ migration 034/035/046
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_new   public.portfolios%ROWTYPE;
BEGIN
  -- ── 1) Lock แถว users (Scope ของ Invariant นี้คือทั้ง User) ────────────────
  -- Lock ที่ users ไม่ใช่ที่ portfolios เพราะสิ่งที่ต้องกันคือ "จำนวนรวมของ user"
  -- ซึ่งเป็นคุณสมบัติของ user ไม่ใช่ของแถวพอร์ตใดแถวหนึ่ง (เหตุผลเดียวกับ 035)
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('user_id=%s', p_user_id);
  END IF;

  -- ── 2) นับพอร์ตจริง ณ จุดที่ Lock แล้ว ────────────────────────────────────
  SELECT count(*) INTO v_count
    FROM public.portfolios p
   WHERE p.user_id = p_user_id;

  -- ── 3) Guard เพดาน (NULL = ไม่จำกัด — ไม่ควรเกิดกับพอร์ตแต่รองรับไว้) ─────
  IF p_portfolio_limit IS NOT NULL AND v_count >= p_portfolio_limit THEN
    RAISE EXCEPTION 'PORTFOLIO_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL  = format('limit=%s;current=%s', p_portfolio_limit, v_count);
  END IF;

  -- ── 4) INSERT ในธุรกรรมเดียวกัน ──────────────────────────────────────────
  BEGIN
    INSERT INTO public.portfolios (user_id, name, type, is_default)
    VALUES (p_user_id, p_name, p_type, FALSE)
    RETURNING * INTO v_new;
  EXCEPTION
    -- ชนได้ทางเดียวคือ idx_portfolios_one_default_per_user ซึ่ง "ไม่ควรเกิด"
    -- เพราะเราใส่ FALSE ตายตัว — ถ้าเกิดแปลว่ามีคนแก้ Function นี้ผิด ต้องดังทันที
    WHEN unique_violation THEN
      RAISE EXCEPTION 'DEFAULT_PORTFOLIO_CONFLICT'
        USING ERRCODE = 'P0001',
              DETAIL  = format('user_id=%s', p_user_id);
  END;

  RETURN QUERY SELECT
    v_new.id, v_new.user_id, v_new.name, v_new.type,
    v_new.is_default, v_new.created_at, v_new.updated_at;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2) set_default_portfolio_locked() — สลับ "พอร์ตหลัก" ของผู้ใช้
-- ═══════════════════════════════════════════════════════════════════════
-- ⭐ มติ Founder 24 ส.ค. 2569: "พอร์ตที่ยังเขียนได้" ตัดสินด้วย is_default
-- (ไม่ใช่ created_at เก่าสุด) เพราะพอร์ตเก่าสุดคือตัวที่ Backfill สร้างให้ ซึ่ง
-- มักไม่ใช่พอร์ตที่ผู้ใช้ใช้จริง → ผู้ใช้ต้องเปลี่ยนพอร์ตหลักเองได้ ไม่งั้นจะถูก
-- ขังอยู่กับพอร์ตที่ระบบเลือกให้
--
-- ── ทำไมต้องเป็น RPC ไม่ใช่ UPDATE ธรรมดา 2 ครั้งจากฝั่ง JS ────────────────
-- idx_portfolios_one_default_per_user เป็น Partial UNIQUE Index บน (user_id)
-- WHERE is_default = TRUE → ถ้าตั้งตัวใหม่เป็น TRUE ก่อนปลดตัวเก่า จะมี 2 แถว
-- ที่ is_default = TRUE ชั่วขณะ = **ชน Index ทันที** (Postgres ตรวจ UNIQUE
-- ทันทีไม่ได้เลื่อนไปท้าย Transaction เว้นแต่ประกาศ DEFERRABLE)
--
-- ถ้าแยกเป็น 2 คำสั่งจากฝั่ง JS จะมีช่วงเวลาที่ **ผู้ใช้ไม่มีพอร์ต Default เลย**
-- (หลังปลดตัวเก่า ก่อนตั้งตัวใหม่) ถ้าคำสั่งที่ 2 พังกลางทาง Invariant ของ
-- migration 044/045 จะพังค้างถาวร และ getWritablePortfolioIds จะตกไปใช้ Fallback
-- แบบเงียบๆ — รวมไว้ใน Function เดียวจึงอยู่ใน Transaction เดียว ปลอดภัยทั้งคู่
CREATE OR REPLACE FUNCTION public.set_default_portfolio_locked(
  p_user_id      UUID,
  p_portfolio_id UUID
)
RETURNS TABLE (
  id          UUID,
  user_id     UUID,
  name        TEXT,
  type        TEXT,
  is_default  BOOLEAN,
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.portfolios%ROWTYPE;
BEGIN
  -- ── 1) Lock แถว users — กันสองแท็บสลับพอร์ตหลักพร้อมกันจนได้ 2 Default ────
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('user_id=%s', p_user_id);
  END IF;

  -- ── 2) ⚠️ Cross-User: ยืนยันว่าพอร์ตนี้เป็นของ user คนนี้จริง ─────────────
  -- FK ไม่ได้ช่วยตรงนี้เลย (portfolios.id ไม่ได้ผูกกับ users ในเงื่อนไขที่ตรวจ
  -- ให้ได้ว่า "ของใคร") ถ้าข้ามขั้นนี้ ผู้ใช้ A จะตั้งพอร์ตของผู้ใช้ B เป็น
  -- Default ได้ = แก้ข้อมูลข้ามบัญชี (Design Doc § 6.3)
  PERFORM 1
     FROM public.portfolios p
    WHERE p.id = p_portfolio_id
      AND p.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PORTFOLIO_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('portfolio_id=%s', p_portfolio_id);
  END IF;

  -- ── 3) ปลดตัวเก่าก่อน แล้วค่อยตั้งตัวใหม่ (ลำดับนี้ห้ามสลับ) ──────────────
  -- ระหว่างสองคำสั่งนี้ผู้ใช้มี Default 0 อันชั่วขณะ ซึ่ง "ปลอดภัยกว่า" การมี
  -- 2 อัน (ชน Index ทันที) — และเพราะอยู่ใน Transaction เดียวกัน จึงไม่มีใคร
  -- นอก Transaction นี้มองเห็นสถานะกลางทางนั้นเลย
  UPDATE public.portfolios
     SET is_default = FALSE, updated_at = now()
   WHERE user_id = p_user_id
     AND is_default = TRUE;

  UPDATE public.portfolios
     SET is_default = TRUE, updated_at = now()
   WHERE id = p_portfolio_id
     AND user_id = p_user_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.user_id, v_row.name, v_row.type,
    v_row.is_default, v_row.created_at, v_row.updated_at;
END;
$$;

-- ── สิทธิ์การเรียก (บังคับ — เหตุผลเดียวกับ migration 034/035/046) ──────────
REVOKE ALL ON FUNCTION public.create_portfolio_locked(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_portfolio_locked(UUID, TEXT, TEXT, INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.set_default_portfolio_locked(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_portfolio_locked(UUID, UUID)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply — คาดหวังผลตามที่เขียนกำกับไว้ทุกข้อ)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) Function มีจริงและเหลือ Signature ละตัวเท่านั้น
--   SELECT p.oid::regprocedure AS signature
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('create_portfolio_locked', 'set_default_portfolio_locked');
--   คาดหวัง: 2 แถวเท่านั้น
--   ⚠️ ถ้าได้มากกว่า 2 = มี Overload ซ้อน (ชนิดพารามิเตอร์เพี้ยน) → PostgREST
--      จะเลือก Function ไม่ถูก ต้อง DROP ตัวที่ไม่ใช่ทิ้งก่อน Deploy Code
--
-- 2) จำนวนแถว portfolios ต้องเท่าเดิมเป๊ะ (Migration นี้ไม่แตะข้อมูล)
--   SELECT count(*) FROM portfolios;      -- จดเลขไว้ "ก่อน" Apply แล้วเทียบ
--
-- 3) Invariant ของ 044/045 ยังจริง — ทุก user มีพอร์ต Default หนึ่งอันเป๊ะ
--   SELECT count(*) AS user_ที่ผิด FROM (
--     SELECT u.id FROM users u
--       LEFT JOIN portfolios p ON p.user_id = u.id AND p.is_default = TRUE
--      GROUP BY u.id HAVING count(p.id) <> 1
--   ) x;
--   คาดหวัง: 0
--
-- 4) สิทธิ์ Execute ถูกจำกัดเฉพาะ service_role
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_name IN ('create_portfolio_locked', 'set_default_portfolio_locked');
--   คาดหวัง: มีเฉพาะ service_role (และ owner) — ห้ามมี anon/authenticated/PUBLIC
--
-- 5) search_path ถูกล็อกไว้ (Pattern 028)
--   SELECT proname, proconfig FROM pg_proc
--    WHERE proname IN ('create_portfolio_locked', 'set_default_portfolio_locked');
--   คาดหวัง: proconfig = {"search_path=public, pg_temp"} ทั้งสองแถว

-- ═══════════════════════════════════════════════════════════════════════
-- RED-GREEN ระดับ SQL (รันบน Staging/Branch ก่อน — ห้ามรันบน Production)
-- ═══════════════════════════════════════════════════════════════════════
-- ทุกบล็อกจบด้วย ROLLBACK จึงไม่มีข้อมูลใดถูกเขียนจริง
-- แทนที่ <UID> ด้วย user ทดสอบที่มีพอร์ตอยู่แล้ว 1 อัน (พอร์ต Default)
--
--   -- (RED) เพดาน Free = 1 → สร้างพอร์ตที่ 2 ต้องถูกปฏิเสธ
--   BEGIN;
--     SELECT * FROM create_portfolio_locked('<UID>', 'ZZTEST', 'custom', 1);
--   ROLLBACK;
--   คาดหวัง: ERROR PORTFOLIO_LIMIT_REACHED  DETAIL limit=1;current=1  ✅
--   ถ้า "ผ่าน" = Guard ไม่ทำงาน → Rollback migration ทันที
--
--   -- (GREEN) เพดาน Premium = 50 → สร้างได้
--   BEGIN;
--     SELECT * FROM create_portfolio_locked('<UID>', 'ZZTEST', 'custom', 50);
--   ROLLBACK;
--   คาดหวัง: 1 แถว is_default = false  ✅
--   ⚠️ ต้องเป็น false เสมอ ถ้าได้ true = Invariant ของ 044/045 จะพัง
--
--   -- (RED) Race จริง — ต้องเปิด 2 Session พร้อมกัน
--   Session A: BEGIN; SELECT * FROM create_portfolio_locked('<UID>','ZZ_A','custom',1);
--   Session B: BEGIN; SELECT * FROM create_portfolio_locked('<UID>','ZZ_B','custom',1);
--   คาดหวัง: B **บล็อกรอ** ที่ FOR UPDATE จนกว่า A จะจบ แล้วได้
--            PORTFOLIO_LIMIT_REACHED (ไม่ใช่ผ่านทั้งคู่)  ✅
--   ทั้งสอง Session จบด้วย ROLLBACK
--   ⚠️ ถ้า B ผ่านด้วย = FOR UPDATE ไม่ได้ทำงาน (นี่คือบั๊กที่ migration นี้แก้)
--
--   -- (GREEN) สลับพอร์ตหลักได้จริง และเหลือ Default อันเดียวเสมอ
--   BEGIN;
--     SELECT * FROM create_portfolio_locked('<UID>', 'ZZTEST2', 'custom', 50);
--     SELECT * FROM set_default_portfolio_locked('<UID>',
--       (SELECT id FROM portfolios WHERE user_id='<UID>' AND name='ZZTEST2'));
--     SELECT count(*) FROM portfolios WHERE user_id='<UID>' AND is_default = TRUE;
--   ROLLBACK;
--   คาดหวัง: count = 1 เป๊ะ (ไม่ใช่ 0 และไม่ใช่ 2)  ✅
--
--   -- (RED) Cross-User — ตั้งพอร์ตของคนอื่นเป็น Default ต้องถูกปฏิเสธ
--   BEGIN;
--     SELECT * FROM set_default_portfolio_locked('<UID_A>', '<PORTFOLIO_ของ_UID_B>');
--   ROLLBACK;
--   คาดหวัง: ERROR PORTFOLIO_NOT_FOUND  ✅ (ไม่ใช่แก้ข้อมูลของ B สำเร็จ)

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับ: Revert โค้ดก่อน แล้วค่อยแตะ DB เสมอ
--
-- ขั้น 1 — Revert โค้ด (Railway Redeploy ตัวก่อนหน้า ทั้ง EasyDCA + easydca-worker)
--          โค้ดรุ่นก่อนหน้าใช้ Pre-check ฝั่ง JS ล้วน ซึ่งยังสร้างพอร์ตได้ปกติ
--          (แค่ไม่ Atomic) จึงไม่มีอะไรพังระหว่างรอถอน Function
--
-- ขั้น 2 — ถอน Function (ปลอดภัยเสมอ ไม่มีข้อมูลผูกอยู่):
--   DROP FUNCTION IF EXISTS public.create_portfolio_locked(UUID, TEXT, TEXT, INTEGER);
--   DROP FUNCTION IF EXISTS public.set_default_portfolio_locked(UUID, UUID);
--
-- ⚠️ สิ่งที่จะเสียไป: (1) เพดานพอร์ตกลับไปเป็น check-then-insert ที่ Race ได้
-- (2) ผู้ใช้เปลี่ยนพอร์ตหลักเองไม่ได้ → กลับไปถูกล็อกอยู่กับพอร์ตที่ Backfill
-- เลือกให้ (ดู DECISIONS_LOG 24 ส.ค. 2569)
-- **ไม่กระทบข้อมูลเดิมเลย** — migration นี้ไม่เคยแตะแถวใดในตารางใดทั้งสิ้น
--
-- ⚠️ ถ้ามีผู้ใช้เปลี่ยนพอร์ตหลักไปแล้วก่อน Rollback: พอร์ตหลักจะ "ค้างอยู่ที่ตัว
-- ที่เขาเลือก" ซึ่งถูกต้องและไม่เป็นอันตราย (Invariant ยังจริง — มี Default
-- หนึ่งอันเป๊ะ) แค่เปลี่ยนต่อไม่ได้จนกว่าจะ Apply ใหม่
