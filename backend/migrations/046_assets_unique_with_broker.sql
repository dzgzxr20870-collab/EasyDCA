-- ═══════════════════════════════════════════════════════════════════════
-- Migration 046 — ถือ Symbol เดียวกันได้หลายโบรก (Stage 5)
-- ═══════════════════════════════════════════════════════════════════════
-- Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
-- (docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 8.3 — Founder ตัดสินให้ "รองรับ")
--
-- ⚠️ Migration นี้แตะ Constraint ที่ migration 014 เพิ่งแก้เพราะ "เคยเป็นบั๊กจริง"
-- อ่านหัวข้อ [บั๊กเดิมที่ 014 กันไว้] ให้จบก่อนแตะไฟล์นี้
--
-- ── ทำอะไร 3 อย่าง ────────────────────────────────────────────────────────
--   1) assets: UNIQUE (user_id, symbol, portfolio_id) → เพิ่ม broker_id เข้า Key
--   2) pending_transactions: เพิ่ม broker_id (พกโบรกที่ผู้ใช้เลือก ข้าม Preview→Confirm)
--   3) create_asset_locked(): รับ p_broker_id + เปลี่ยนวิธีนับเพดาน Free เป็น
--      "จำนวน Symbol ที่ต่างกัน" ไม่ใช่ "จำนวนแถว"
--
-- ── ความเสี่ยง: 🟡 กลาง ───────────────────────────────────────────────────
-- ไม่แตะข้อมูลเดิมแม้แถวเดียว (ไม่มี UPDATE/DELETE) และ "ผ่อน" ข้อจำกัดอย่างเดียว
-- ไม่เพิ่มข้อจำกัดใหม่ → แถวที่มีอยู่วันนี้ผ่าน Constraint ใหม่ได้ทั้งหมดโดยอัตโนมัติ
-- แต่แตะ Choke Point ของการสร้าง Asset ทั้งระบบ จึงต้อง Verify ครบทุกข้อท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- [บั๊กเดิมที่ 014 กันไว้] — และทำไมของใหม่ยังกันได้ครบ
-- ═══════════════════════════════════════════════════════════════════════
-- บั๊กเดิม: UNIQUE (user_id, symbol, portfolio_id) แบบมาตรฐานไม่กันซ้ำเมื่อ
-- portfolio_id IS NULL (Postgres ถือว่า NULL <> NULL) → INSERT BTC สองครั้งผ่าน
-- ทั้งคู่ ได้ asset_id คนละตัว → ประวัติธุรกรรมของ BTC แตกไปคนละ asset_id →
-- Moving Average Cost Basis (portfolio.service.calculateTotalInvested) เห็นแค่
-- ครึ่งเดียวของประวัติ → ต้นทุนเฉลี่ย/P&L ผิดทันทีแบบเงียบๆ
-- 014 แก้ด้วย NULLS NOT DISTINCT (Postgres 15+, Production เป็น 17.6)
--
-- ⚠️ ของใหม่ยัง "กันบั๊กเดิมได้ครบ 100%" เพราะยังคง NULLS NOT DISTINCT ไว้:
--   - INSERT BTC 2 ครั้งโดยไม่ระบุโบรกเลย → (uid, 'BTC', NULL, NULL) ทั้งคู่
--     NULL ถูกมองว่า "เท่ากัน" ทั้ง portfolio_id และ broker_id → ครั้งที่ 2 ถูกปฏิเสธ
--     ✅ เหมือน 014 ทุกประการ (นี่คือกรณีของ Production วันนี้แทบ 100%)
--   - INSERT BTC 2 ครั้งในพอร์ตเดียวกัน โบรกเดียวกัน → ถูกปฏิเสธ ✅
--   - INSERT BTC ที่ Bitkub + BTC ที่ Binance → ผ่านทั้งคู่ ✅ (นี่คือฟีเจอร์ใหม่)
--
-- ── ทำไมไม่ใช้ COALESCE(broker_id, '00000000-...')/Partial Index ───────────
-- ไม่จำเป็นเลย: NULLS NOT DISTINCT ทำหน้าที่ "ถือว่า NULL เท่ากัน" อยู่แล้ว
-- ตรงตามที่ต้องการเป๊ะ การใส่ COALESCE เพิ่มจะได้แค่ Expression Index ที่อ่านยากกว่า
-- และต้องเลือก Sentinel UUID มั่วๆ ที่วันหนึ่งอาจชนกับ id จริง
--
-- ── ผลข้างเคียงที่ "ยอมรับแล้ว" ───────────────────────────────────────────
-- BTC (broker_id = NULL, "ไม่ระบุ") + BTC (broker_id = Bitkub) อยู่ร่วมกันได้
-- = คนละก้อนต้นทุน คนละแถว ซึ่งถูกต้องตามดีไซน์ (โบรกคือมิติของ "ที่เก็บสินทรัพย์")
-- โค้ดชั้น App ต้องไม่เดาเองว่าอ้างถึงแถวไหนเมื่อ Symbol ซ้ำ — ต้องถามผู้ใช้เสมอ
-- (Founder ตัดสิน 23 ส.ค. 2569 + กฎยืน "Silent Default เป็น Anti-pattern เสมอ")

-- ── 1) assets: เพิ่ม broker_id เข้า UNIQUE Key ─────────────────────────────
-- ชื่อ Constraint เดิมจาก 014 คือ assets_user_id_symbol_portfolio_id_key
-- (ยืนยันจาก information_schema ตอน 014) — ตั้งชื่อใหม่ให้ตรงกับคอลัมน์จริง
-- ตาม Pattern Auto-generate ของ Postgres เพื่อไม่ให้ชื่อโกหกเนื้อหาในอนาคต
--
-- ทำเป็น ALTER เดียว (DROP + ADD ในคำสั่งเดียวกัน) โดยเจตนา — Postgres ทำทั้งคู่
-- ใน Transaction เดียว จึง "ไม่มีวินาทีใดเลย" ที่ตารางไม่มี Constraint กันซ้ำ
-- (ถ้าแยกเป็น 2 คำสั่ง จะมีช่องว่างที่ INSERT ซ้ำหลุดเข้ามาได้จริง)
ALTER TABLE assets
  DROP CONSTRAINT assets_user_id_symbol_portfolio_id_key,
  ADD CONSTRAINT assets_user_id_symbol_portfolio_id_broker_id_key
    UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id);

COMMENT ON CONSTRAINT assets_user_id_symbol_portfolio_id_broker_id_key ON assets IS
  'กันสินทรัพย์ซ้ำ = ประวัติธุรกรรมแตกคนละ asset_id ทำให้ต้นทุนเฉลี่ย/P&L ผิด (บั๊กเดิม migration 014) — NULLS NOT DISTINCT บังคับให้ NULL ถือว่าเท่ากัน จึงยังกันเคส portfolio_id/broker_id เป็น NULL ได้ครบ ส่วน broker_id ใน Key เปิดให้ถือ Symbol เดียวกันได้หลายโบรก (migration 046)';

-- ── 2) pending_transactions.broker_id ─────────────────────────────────────
-- ทำไมต้องมี: Flow LINE คือ [พิมพ์คำสั่ง → ถามโบรก → Preview → กดยืนยัน] โบรกที่
-- ผู้ใช้เลือกต้องรอดข้ามขั้น Preview→Confirm ไปถึงตอนเขียน Ledger จริง ถ้าไม่พก
-- มาด้วย ตอน Confirm จะกลับไปเจอ "Symbol นี้มีหลายโบรก" ซ้ำอีกรอบแล้วเขียนไม่ได้
--
-- ⚠️ นี่คือบทเรียนตรงจาก POSTMORTEM_AMOUNT_CONSISTENCY.md — บั๊ก "ยอดที่แสดง ≠
-- ยอดที่บันทึก" เกิดเพราะ toCommitParams ไม่พก amountThb ข้ามมา ปล่อยให้ปลายทาง
-- คำนวณใหม่เอง ครั้งนี้จึงพก "ตัวตนของสินทรัพย์" ข้ามมาให้ครบตั้งแต่แรก
--
-- ON DELETE SET NULL: ถ้าผู้ใช้ลบโบรกทิ้งระหว่างที่ Pending ยังค้าง แถว Pending
-- ต้องไม่ถูกลบตาม (Pattern เดียวกับ assets.broker_id / portfolio_id) — ผลคือ
-- ตอนกดยืนยันจะกลายเป็น "ไม่ระบุโบรก" แล้วชนกรณีกำกวมอีกครั้ง = ได้ Error ให้
-- ผู้ใช้เห็น ไม่ใช่เขียนเข้าโบรกผิดเงียบๆ (Fail loud ตามที่ต้องการ)
ALTER TABLE pending_transactions
  ADD COLUMN broker_id UUID REFERENCES brokers(id) ON DELETE SET NULL;

COMMENT ON COLUMN pending_transactions.broker_id IS
  'โบรกที่ผู้ใช้เลือกตอนคำสั่งกำกวม (ถือ Symbol เดียวกันหลายโบรก) — พกข้าม Preview→Confirm เพื่อให้ตอนเขียน Ledger รู้ว่าหมายถึงสินทรัพย์แถวไหน NULL = ไม่ระบุ/ไม่กำกวม (migration 046)';

-- ═══════════════════════════════════════════════════════════════════════
-- 3) create_asset_locked() — รับ broker + นับเพดาน Free เป็น "Distinct Symbol"
-- ═══════════════════════════════════════════════════════════════════════
-- ต่อจาก migration 035 (Lock แถว users → นับ → Validate → INSERT ในธุรกรรมเดียว)
-- โครงเดิมทั้งหมดคงไว้เป๊ะ เปลี่ยน 2 จุดเท่านั้น:
--
--   [A] เพิ่ม p_broker_id (ต่อท้าย + DEFAULT NULL)
--       ⚠️ ต้องต่อท้ายและมี DEFAULT เสมอ — โค้ดรุ่นเก่าที่ยังรันอยู่บน Railway
--       ตอน Apply Migration เรียกด้วย 8 Argument (ไม่มี p_broker_id) ถ้าไม่มี
--       DEFAULT โค้ดเก่าจะสร้างสินทรัพย์ใหม่ไม่ได้เลยทั้งระบบทันทีที่ Apply
--       (Migration ถูก Apply "ก่อน" Deploy Code เสมอตามกฎของโปรเจกต์)
--
--       และต้อง DROP Signature เดิม 8 ตัวทิ้งด้วย ไม่ใช่ปล่อยไว้เป็น Overload —
--       ถ้าเหลือทั้งสองตัว PostgREST จะเจอ Function ที่รับ 8 Argument ชุดเดียวกัน
--       ได้ 2 ตัว แล้วตอบ "Could not choose the best candidate function"
--       (พังทั้ง Path สร้างสินทรัพย์ใหม่ ทั้งที่ SQL ดูถูกต้องทุกบรรทัด)
--
--   [B] เพดาน Free นับ "จำนวน Symbol ที่ต่างกัน" ไม่ใช่ "จำนวนแถว"
--       Founder ตัดสิน (23 ส.ค. 2569): ถือ BTC ที่ 2 โบรก = 1 สินทรัพย์
--       ถ้ายังนับแถวเหมือนเดิม ผู้ใช้ Free ที่ถือ BTC 1 ตัวแล้วอยากเพิ่มโบรกที่ 2
--       ให้ BTC จะโดนบล็อกว่า "ครบ 2 สินทรัพย์แล้ว" ทั้งที่ยังมีสินทรัพย์เดียว
--
--       และต้องยกเว้น Symbol ที่ถืออยู่แล้วออกจากการเทียบเพดานด้วย (v_symbol_exists)
--       — การเพิ่มโบรกให้ Symbol เดิม "ไม่ได้เพิ่มจำนวนสินทรัพย์" จึงต้องผ่านเสมอ
--       แม้จะเต็มเพดานอยู่ก็ตาม (เทียบเพดานเฉพาะตอนที่ Symbol นั้นเป็นของใหม่จริง)
--
-- Single Source of Truth ของ "เลข 2" ยังอยู่ที่ entitlement.service.js เหมือนเดิม
-- (p_asset_limit ยังรับมาจาก Caller · SQL ไม่ Hardcode ตัวเลข)

DROP FUNCTION IF EXISTS public.create_asset_locked(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.create_asset_locked(
  p_user_id         UUID,
  p_portfolio_id    UUID,
  p_symbol          TEXT,
  p_name            TEXT,
  p_type            TEXT,
  p_asset_limit     INTEGER DEFAULT NULL,
  p_proj_id         TEXT DEFAULT NULL,
  p_fund_class_name TEXT DEFAULT NULL,
  p_broker_id       UUID DEFAULT NULL
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
  broker_id       UUID,
  is_active       BOOLEAN,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
-- SECURITY DEFINER + REVOKE/GRANT ท้ายไฟล์ — เหตุผลเดียวกับ migration 034/035
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_count  INTEGER;
  v_symbol_exists BOOLEAN;
  v_new           public.assets%ROWTYPE;
BEGIN
  -- ── 1) Lock แถว users (Scope ของ Invariant นี้คือทั้ง User) ────────────────
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('user_id=%s', p_user_id);
  END IF;

  -- ── 2) นับ "Symbol ที่ต่างกัน" ของ Asset Active ณ จุดที่ Lock แล้ว ─────────
  -- ต้องตรงกับ assetRepository.findActiveSymbolsByUser() ฝั่ง JS เป๊ะ (ทั้งคู่
  -- Dedupe ราย symbol เหมือนกัน) — Pre-check ฝั่ง JS ตอบผู้ใช้ได้เร็ว ส่วนที่นี่
  -- คือด่านจริงที่ Race Condition ข้ามไม่ได้
  SELECT count(DISTINCT a.symbol) INTO v_active_count
    FROM public.assets a
   WHERE a.user_id = p_user_id
     AND a.is_active = true;

  SELECT EXISTS (
    SELECT 1 FROM public.assets a
     WHERE a.user_id = p_user_id
       AND a.is_active = true
       AND a.symbol = p_symbol
  ) INTO v_symbol_exists;

  -- ── 3) Guard เพดาน Free Plan (NULL = ไม่จำกัด สำหรับ Premium) ────────────
  -- ข้ามการเทียบเพดานเมื่อ Symbol นี้ถืออยู่แล้ว = กำลังเพิ่ม "โบรกที่ N" ให้
  -- สินทรัพย์เดิม ซึ่งไม่ได้ทำให้จำนวนสินทรัพย์เพิ่มขึ้นเลยแม้แต่ตัวเดียว
  IF p_asset_limit IS NOT NULL
     AND NOT v_symbol_exists
     AND v_active_count >= p_asset_limit THEN
    RAISE EXCEPTION 'ASSET_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL  = format('limit=%s;current=%s', p_asset_limit, v_active_count);
  END IF;

  -- ── 4) INSERT ในธุรกรรมเดียวกัน ──────────────────────────────────────────
  BEGIN
    INSERT INTO public.assets (
      user_id, portfolio_id, symbol, name, type, proj_id, fund_class_name, broker_id
    ) VALUES (
      p_user_id, p_portfolio_id, p_symbol, p_name, p_type,
      p_proj_id, p_fund_class_name, p_broker_id
    )
    RETURNING * INTO v_new;
  EXCEPTION
    -- ชนกันพอดี (Double-submit/สองแท็บ) กับ Symbol+พอร์ต+โบรก ชุดเดียวกัน —
    -- UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id) กัน
    -- ถูกต้องอยู่แล้วที่ระดับ DB แค่แปลง Error ดิบให้เป็น Message ชุดเดียวกับ
    -- Error อื่นของ Function นี้ (ดู Comment หัวไฟล์ migration 035)
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ASSET_ALREADY_EXISTS'
        USING ERRCODE = 'P0001',
              DETAIL  = format('user_id=%s;symbol=%s', p_user_id, p_symbol);
  END;

  RETURN QUERY SELECT
    v_new.id, v_new.user_id, v_new.portfolio_id, v_new.symbol, v_new.name, v_new.type,
    v_new.proj_id, v_new.fund_class_name, v_new.broker_id,
    v_new.is_active, v_new.created_at, v_new.updated_at;
END;
$$;

-- ── สิทธิ์การเรียก (บังคับ — เหตุผลเดียวกับ migration 034/035) ──────────────
REVOKE ALL ON FUNCTION public.create_asset_locked(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_asset_locked(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, UUID
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply — คาดหวังผลตามที่เขียนกำกับไว้ทุกข้อ)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) Constraint ใหม่มีจริง + เก่าหายไปแล้ว + ยังเป็น NULLS NOT DISTINCT
--   SELECT conname, pg_get_constraintdef(oid) AS def
--     FROM pg_constraint
--    WHERE conrelid = 'assets'::regclass AND contype = 'u';
--   คาดหวัง: 1 แถว ชื่อ assets_user_id_symbol_portfolio_id_broker_id_key
--            def = 'UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id)'
--   ⚠️ ถ้าเห็นคำว่า NULLS NOT DISTINCT หายไป = ผิด ต้อง Rollback ทันที
--      (จะกลายเป็นเปิดบั๊ก Duplicate ของ migration 014 กลับมาทั้งดุ้น)
--
-- 2) จำนวนแถว assets ต้องเท่าเดิมเป๊ะ (Migration นี้ไม่แตะข้อมูล)
--   SELECT count(*) FROM assets;         -- จดเลขไว้ "ก่อน" Apply แล้วเทียบ
--
-- 3) ไม่มีข้อมูลละเมิด Constraint ใหม่ (ต้องเป็น 0 แถวเสมอ ถ้าข้อ 1 ผ่าน)
--   SELECT user_id, symbol, portfolio_id, broker_id, count(*)
--     FROM assets GROUP BY 1,2,3,4 HAVING count(*) > 1;
--   คาดหวัง: 0 แถว
--
-- 4) pending_transactions.broker_id เพิ่มแล้ว เป็น NULL ทุกแถว
--   SELECT count(*) AS ทั้งหมด, count(broker_id) AS ระบุโบรกแล้ว
--     FROM pending_transactions;
--   คาดหวังทันทีหลัง Apply: ระบุโบรกแล้ว = 0
--
-- 5) create_asset_locked เหลือ Signature เดียว (9 Argument) — ข้อนี้สำคัญมาก
--   SELECT p.oid::regprocedure AS signature
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'create_asset_locked';
--   คาดหวัง: 1 แถวเท่านั้น และลงท้ายด้วย ", uuid)"
--   ⚠️ ถ้าได้ 2 แถว = DROP ไม่สำเร็จ → PostgREST จะเลือก Function ไม่ถูก
--      ต้อง DROP ตัว 8 Argument ทิ้งเองก่อน Deploy Code
--
-- 6) สิทธิ์ Execute ถูกจำกัดเฉพาะ service_role
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'create_asset_locked';
--   คาดหวัง: มีเฉพาะ service_role (และ owner) — ห้ามมี anon/authenticated/PUBLIC

-- ═══════════════════════════════════════════════════════════════════════
-- RED-GREEN ระดับ SQL (รันบน Staging/Branch ก่อน — ห้ามรันบน Production)
-- ═══════════════════════════════════════════════════════════════════════
-- พิสูจน์ว่า "บั๊กเดิมที่ 014 กันไว้ ยังถูกกันอยู่" ไม่ใช่แค่เชื่อว่าน่าจะกัน
-- ทุกบล็อกจบด้วย ROLLBACK จึงไม่มีข้อมูลใดถูกเขียนจริง
--
--   -- (RED) เคสบั๊กเดิมของ 014: BTC ซ้ำ ไม่ระบุพอร์ต ไม่ระบุโบรก → ต้องพัง
--   BEGIN;
--     INSERT INTO assets (user_id, symbol, name, type)
--     SELECT id, 'ZZTEST', 'ZZTEST', 'crypto' FROM users LIMIT 1;
--     INSERT INTO assets (user_id, symbol, name, type)
--     SELECT id, 'ZZTEST', 'ZZTEST', 'crypto' FROM users LIMIT 1;
--   ROLLBACK;
--   คาดหวัง: คำสั่งที่ 2 ERROR duplicate key ... _broker_id_key  ✅ ยังกันได้
--   ถ้า "ผ่านทั้งคู่" = NULLS NOT DISTINCT หลุด → Rollback migration ทันที
--
--   -- (GREEN) ฟีเจอร์ใหม่: BTC คนละโบรก → ต้องผ่านทั้งคู่
--   BEGIN;
--     INSERT INTO brokers (user_id, name)
--     SELECT id, 'ZZBROKER_A' FROM users LIMIT 1;
--     INSERT INTO brokers (user_id, name)
--     SELECT id, 'ZZBROKER_B' FROM users LIMIT 1;
--     INSERT INTO assets (user_id, symbol, name, type, broker_id)
--     SELECT u.id, 'ZZTEST', 'ZZTEST', 'crypto', b.id
--       FROM users u JOIN brokers b ON b.user_id = u.id AND b.name = 'ZZBROKER_A' LIMIT 1;
--     INSERT INTO assets (user_id, symbol, name, type, broker_id)
--     SELECT u.id, 'ZZTEST', 'ZZTEST', 'crypto', b.id
--       FROM users u JOIN brokers b ON b.user_id = u.id AND b.name = 'ZZBROKER_B' LIMIT 1;
--   ROLLBACK;
--   คาดหวัง: ผ่านทั้งคู่ (2 แถว)  ✅ ฟีเจอร์ใหม่ทำงาน
--
--   -- (RED) โบรกเดียวกันซ้ำ → ต้องพัง (กันซ้ำในโบรกเดิมยังทำงาน)
--   ทำซ้ำบล็อก GREEN แต่ใช้ ZZBROKER_A ทั้งสองครั้ง
--   คาดหวัง: คำสั่งที่ 2 ERROR duplicate key  ✅

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับ: Revert โค้ดก่อน แล้วค่อยแตะ DB เสมอ
--
-- ขั้น 1 — Revert โค้ด (Railway Redeploy ตัวก่อนหน้า ทั้ง EasyDCA + easydca-worker)
--
-- ขั้น 2 — ⚠️ ตรวจก่อนถอน Constraint: ถ้ามีผู้ใช้สร้าง "Symbol เดียวกันหลายโบรก"
--          ไปแล้ว การถอนกลับเป็น Key 3 คอลัมน์จะ ERROR (ข้อมูลละเมิด) — ต้องดูก่อน:
--            SELECT user_id, symbol, portfolio_id, count(*)
--              FROM assets GROUP BY 1,2,3 HAVING count(*) > 1;
--          ถ้าไม่ว่าง: ห้ามลบแถวทิ้งเด็ดขาด (กฎเหล็กข้อ 2) ต้อง Export เก็บก่อน
--          แล้วตัดสินใจร่วมกับ Founder ว่าจะรวมประวัติ 2 แถวเข้าด้วยกันอย่างไร
--          (การรวมกระทบต้นทุนเฉลี่ย = แตะเงินจริง ห้าม AI ตัดสินเอง)
--
-- ขั้น 3 — ถอน (เรียงตามนี้):
--   ALTER TABLE assets
--     DROP CONSTRAINT assets_user_id_symbol_portfolio_id_broker_id_key,
--     ADD CONSTRAINT assets_user_id_symbol_portfolio_id_key
--       UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id);
--   ALTER TABLE pending_transactions DROP COLUMN IF EXISTS broker_id;
--   DROP FUNCTION IF EXISTS public.create_asset_locked(
--     UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, UUID);
--   -- แล้วรัน migration 035 ซ้ำเพื่อเอา Function เวอร์ชัน 8 Argument กลับมา
--
-- ⚠️ สิ่งที่จะเสียไป: ความสามารถถือ Symbol เดียวกันหลายโบรก + โบรกที่ผูกไว้กับ
-- แถวที่ต้อง Merge (ถ้ามี) — **ไม่กระทบ Ledger** (transactions ไม่ถูกแตะเลย)
