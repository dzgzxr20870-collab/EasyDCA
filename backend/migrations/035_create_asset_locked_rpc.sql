-- ═══════════════════════════════════════════════════════════════════════
-- Migration 035 — RPC create_asset_locked() (แก้ Free-tier Asset Limit Race)
-- ═══════════════════════════════════════════════════════════════════════
-- ปิดช่องโหว่ที่ transaction.service.js:validateBuy (บรรทัด ~373-383) เป็น
-- check-then-insert ที่ไม่ Atomic เหมือนกับ Oversell Race (migration 034) แต่คนละ
-- Invariant: อ่านนับ Asset Active ของ User → เทียบเพดาน Free Plan (2) → คืนผลผ่าน
-- ไปให้ processBuyCommand ค่อย assetRepository.create() จริง — ถ้ามีสองคำสั่งซื้อ
-- Symbol ใหม่คนละตัว (ทั้งคู่ยังไม่มีใน Portfolio) เข้ามาพร้อมกัน ทั้งคู่จะอ่านจำนวน
-- ชุดเดียวกัน (Stale Read) แล้วผ่านการตรวจทั้งคู่ → ได้ Asset เกินเพดาน Free Plan
--
-- ⚠️ เส้นทางเว็บ POST /api/v1/transactions Reproduce ได้ง่ายเหมือน Oversell:
-- ไม่มีขั้น Preview/Confirm คั่น ยิงขนานด้วย Promise.all ได้ทันที
--
-- ── ต่างจาก migration 034 ตรงไหน (เหตุผลที่แยก RPC ไม่รวมกัน) ────────────────
-- Oversell ล็อกที่ระดับ "Asset เดียว" (asset_id) เพราะยอดคงเหลือเป็นสมบัติของ Asset
-- ตัวนั้น ส่วน Asset Limit ล็อกที่ระดับ "User ทั้งคน" (user_id) เพราะเพดานนับรวม
-- ทุก Asset ของ User — เป็นคนละ Invariant คนละ Scope Lock และเกิดคนละจังหวะเวลา
-- (Asset Limit ตัดสิน "ก่อน" Asset จะมีอยู่จริง ส่วน create_transaction_locked
-- ทำงาน "หลัง" Asset มีอยู่แล้วเสมอ ต้องมี asset_id ส่งเข้าไปก่อน) — Sell/Undo ไม่
-- เกี่ยวกับ Asset Limit เลย จึงไม่ควรมี Argument ที่ไม่มีความหมายกับ Flow นั้น
--
-- Implement ตามหลักการเดียวกับ DATABASE.md § 12 (Lock → คำนวณ → Validate → INSERT
-- ในธุรกรรมเดียว) แค่เปลี่ยนแถวที่ Lock จาก assets เป็น users:
--   1. Lock แถว users (แทน assets) ด้วย SELECT ... FOR UPDATE ก่อนนับ
--   2. นับ Asset Active ของ User "หลัง" Lock (ข้อมูลนิ่งจริง)
--   3. ถ้าเกินเพดาน → RAISE (ทั้ง Transaction Rollback ไม่มีแถวตกค้าง)
--   4. INSERT ในธุรกรรมเดียวกัน
-- Isolation READ COMMITTED (Default) + Row Lock เพียงพอ (เหตุผลเดียวกับ § 12 ข้อ 3)
-- Lock ระดับ user_id เดียวเท่านั้น — คนละ User ซื้อพร้อมกันไม่ต้องรอกัน
--
-- ── เพดานเท่าไหร่ยังเป็นหน้าที่ของ JS ─────────────────────────────────────
-- p_asset_limit รับมาเป็น Argument (NULL = ไม่จำกัด สำหรับ Premium ที่ยัง Active)
-- ไม่ Hardcode ตัวเลข "2" ซ้ำใน SQL — entitlement.service.js (FREE_TIER_ASSET_LIMIT)
-- ยังเป็น Single Source of Truth ของค่านี้เหมือนเดิมทุกประการ Function นี้แค่ "บังคับ
-- ใช้" เพดานที่ Caller คำนวณมาให้แล้วอย่าง Atomic เท่านั้น
--
-- ── ครอบทุก Path ที่สร้าง Asset ใหม่ ────────────────────────────────────────
-- ทั้งระบบมีจุด INSERT เข้า assets แค่ 1 จุด (assetRepository.create() — Caller
-- เดียวคือ transaction.service.js:411 processBuyCommand) จึงเปลี่ยนที่ฟังก์ชันนี้
-- จุดเดียวพอ (Choke Point เดียวกับที่ migration 034 ใช้กับ transactionRepository)
--
-- ── Bonus: Map Error ซ้ำ Symbol ให้อ่านง่ายขึ้น (Security Audit ตามมา) ────────
-- ก่อนหน้านี้ถ้าสองคำสั่งซื้อ Symbol ใหม่ "ตัวเดียวกัน" ชนกันพอดี (กดซ้ำ/สองแท็บ)
-- จะไปชน UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id) ที่ระดับ DB
-- ซึ่งกันข้อมูลซ้ำได้ถูกต้องอยู่แล้ว แต่ Error 23505 ดิบไม่เคยถูก Map เป็นข้อความ
-- ที่เข้าใจง่าย (โผล่เป็น INTERNAL_ERROR 500) — จับด้วย EXCEPTION WHEN
-- unique_violation แล้วแปลงเป็น RAISE Message เดียวกับ Error อื่นในไฟล์นี้ ให้ชั้น
-- App Handle ด้วยกลไกเดียวกันหมด (เทียบ err.message ตรงๆ) ไม่ต้องแยกไปเช็ค
-- err.code ทีละที่
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_asset_locked(
  p_user_id         UUID,
  p_portfolio_id    UUID,
  p_symbol          TEXT,
  p_name            TEXT,
  p_type            TEXT,
  p_asset_limit     INTEGER DEFAULT NULL,
  p_proj_id         TEXT DEFAULT NULL,
  p_fund_class_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  portfolio_id    UUID,
  symbol          TEXT,
  name            TEXT,
  type            TEXT,
  proj_id         TEXT,
  fund_class_name TEXT,
  is_active       BOOLEAN,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
-- SECURITY DEFINER + REVOKE/GRANT ท้ายไฟล์ — เหตุผลเดียวกับ migration 034 เป๊ะ:
-- Postgres GRANT EXECUTE ให้ PUBLIC โดยปริยายตอน CREATE FUNCTION ถ้าไม่ Revoke
-- anon/authenticated จะเรียก Function ที่รันด้วยสิทธิ์สูงผ่าน PostgREST ได้
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_count INTEGER;
  v_new          public.assets%ROWTYPE;
BEGIN
  -- ── 1) Lock แถว users (ไม่ใช่ assets — Scope ของ Invariant นี้คือทั้ง User) ──
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('user_id=%s', p_user_id);
  END IF;

  -- ── 2) นับ Asset Active ของ User ณ จุดที่ Lock แล้ว ─────────────────────
  -- นับตาม Row (ไม่ใช่ Distinct Symbol) ให้ตรงกับ assetRepository.countActiveByUser
  -- เดิมเป๊ะ (Semantics เท่าเดิมทุกประการ — แค่ย้ายมาทำใต้ Lock)
  SELECT count(*) INTO v_active_count
    FROM public.assets a
   WHERE a.user_id = p_user_id
     AND a.is_active = true;

  -- ── 3) Guard เพดาน Free Plan (NULL = ไม่จำกัด สำหรับ Premium) ────────────
  IF p_asset_limit IS NOT NULL AND v_active_count >= p_asset_limit THEN
    RAISE EXCEPTION 'ASSET_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL  = format('limit=%s;current=%s', p_asset_limit, v_active_count);
  END IF;

  -- ── 4) INSERT ในธุรกรรมเดียวกัน ──────────────────────────────────────────
  BEGIN
    INSERT INTO public.assets (
      user_id, portfolio_id, symbol, name, type, proj_id, fund_class_name
    ) VALUES (
      p_user_id, p_portfolio_id, p_symbol, p_name, p_type, p_proj_id, p_fund_class_name
    )
    RETURNING * INTO v_new;
  EXCEPTION
    -- Symbol เดียวกันชนกันพอดี (Double-submit/สองแท็บ) — UNIQUE NULLS NOT DISTINCT
    -- (user_id, symbol, portfolio_id) กันซ้ำถูกต้องอยู่แล้วที่ระดับ DB แค่แปลง Error
    -- ดิบให้เป็น Message ชุดเดียวกับ Error อื่นของ Function นี้ (ดู Comment หัวไฟล์)
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ASSET_ALREADY_EXISTS'
        USING ERRCODE = 'P0001',
              DETAIL  = format('user_id=%s;symbol=%s', p_user_id, p_symbol);
  END;

  RETURN QUERY SELECT
    v_new.id, v_new.user_id, v_new.portfolio_id, v_new.symbol, v_new.name, v_new.type,
    v_new.proj_id, v_new.fund_class_name, v_new.is_active, v_new.created_at, v_new.updated_at;
END;
$$;

-- ── สิทธิ์การเรียก (บังคับ — เหตุผลเดียวกับ migration 034) ──────────────────
REVOKE ALL ON FUNCTION public.create_asset_locked(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_asset_locked(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับสำคัญเหมือน migration 034 — ห้าม DROP Function ก่อน Revert Code เด็ดขาด:
-- โค้ดรุ่นใหม่เขียน Asset ใหม่ผ่าน RPC นี้ทางเดียว ถ้า Drop ทิ้งขณะที่โค้ดใหม่ยังรันอยู่
-- "ผู้ใช้จะซื้อสินทรัพย์ใหม่ (Symbol ที่ยังไม่เคยมีในพอร์ต) ไม่ได้เลยทั้งระบบ" — ซื้อ
-- Symbol ที่มีอยู่แล้วยังทำได้ปกติ (Path นั้นไม่แตะ RPC นี้เลย)
--
--   ขั้นที่ 1: git revert commit ที่แก้ asset.repository.js แล้ว Push
--   ขั้นที่ 2: รอ Railway Deploy เสร็จ + ยืนยัน commitHash จริงว่ากลับไปรุ่นเก่าแล้ว
--   ขั้นที่ 3: ค่อย DROP Function:
--
--     DROP FUNCTION IF EXISTS public.create_asset_locked(
--       UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
--     );
--
-- ⚠️ สิ่งที่จะเสียไปเมื่อ Rollback: กลับไปมีช่องโหว่ Asset Limit Race เหมือนเดิม
-- **ไม่มีข้อมูลใดสูญหาย** — Migration นี้ไม่ได้แก้ Schema/ข้อมูลเลยแม้แต่แถวเดียว
-- (เพิ่ม Function อย่างเดียว) Asset ที่สร้างผ่าน RPC ไปแล้วเป็นแถวปกติใน assets
-- ทุกประการ แยกไม่ออกจากแถวที่สร้างด้วยวิธีเดิม
--
-- Migration นี้ Idempotent (CREATE OR REPLACE) — รันซ้ำได้ปลอดภัย
