-- ═══════════════════════════════════════════════════════════════════════
-- Migration 047 — เปิด transaction type 'dividend' / 'dividend_reversal' (Stage 6b)
-- ═══════════════════════════════════════════════════════════════════════
-- Feature Set "Multi-Portfolio / Broker / Sector / Dividend"
-- (docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 3.5 + § 5)
--
-- ⚠️⚠️ นี่คือ Migration ที่เสี่ยงที่สุดของทั้ง Feature Set — มันแตะ Immutable Ledger
-- และ "สูตรเงิน" โดยตรง ห้าม Apply ก่อนอ่านหัวข้อ [ลำดับบังคับ] ให้จบ
--
-- ── ลำดับบังคับ (ห้ามสลับเด็ดขาด) ─────────────────────────────────────────
--   [1] Stage 6a (commit 38aa28a) ต้อง Merge + Deploy อยู่บน Production แล้ว
--       Stage 6a เปลี่ยนโค้ดคำนวณเงินทุกจุดจาก Binary (`buy` / "ไม่ใช่ buy")
--       เป็น Exhaustive switch ที่ `default: throw` — ถ้ายังไม่ได้ Deploy แล้ว
--       Apply Migration นี้ก่อน วินาทีที่แถว dividend แถวแรกเกิดขึ้น โค้ดเก่าจะ
--       **ตีความเป็น 'sell' เงียบๆ** ที่ 7 จุดพร้อมกัน (จำนวนที่ถือหาย ต้นทุนถูกตัด
--       กำไรเพี้ยน) โดยไม่มี Error ใดๆ ให้เห็น
--   [2] Migration 042→046 ต้อง Apply ครบแล้ว (ตัวนี้เป็นตัวสุดท้ายของชุด)
--   [3] Apply Migration นี้
--   [4] แล้วค่อย Deploy โค้ด Stage 6b (endpoint POST /transactions/dividend)
--
-- ── ทำอะไร 2 อย่าง ────────────────────────────────────────────────────────
--   1) transactions.type CHECK: ('buy','sell') → เพิ่ม 'dividend','dividend_reversal'
--   2) create_transaction_locked(): เปลี่ยนการนับ "ยอดคงเหลือ" จาก Binary เป็น
--      Enumerate ครบทุก type (จุดนี้คือ "Stage 6a ฉบับ SQL" ที่ยังค้างอยู่)
--
-- ── ความเสี่ยง: 🔴 สูงสุด แต่ "ย้อนกลับได้สะอาด" ─────────────────────────────
-- ไม่แตะข้อมูลเดิมแม้แถวเดียว (ไม่มี UPDATE/DELETE) และ "ผ่อน" CHECK อย่างเดียว
-- ไม่เพิ่มข้อจำกัดใหม่ → แถวที่มีอยู่วันนี้ (buy/sell ล้วน) ผ่าน CHECK ใหม่ได้ครบ
-- 100% โดยอัตโนมัติ · ตราบใดที่ยังไม่มีใครสร้างแถว dividend แถวแรก การ Rollback
-- คือการเอา CHECK เดิมกลับมาเฉยๆ ไม่มีข้อมูลติดค้าง
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- [ทำไม dividend ยังต้องมี quantity > 0 และ price_per_unit > 0]
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ หัวข้อนี้เป็นจุดที่ Design Doc § 4.5 เขียนไว้ไม่ครบ — ต้องอ่านก่อนเขียนโค้ด
-- ที่ INSERT แถว dividend ไม่งั้นจะเจอ CHECK พังตอน Runtime แล้วงงว่าทำไม
--
-- Schema เดิมของ transactions (migration 001 / docs/DATABASE.md) บังคับไว้ว่า:
--     amount_thb     NUMERIC(15,2) NOT NULL CHECK (amount_thb > 0)
--     price_per_unit NUMERIC(20,8) NOT NULL CHECK (price_per_unit > 0)
--     quantity       NUMERIC(20,8) NOT NULL CHECK (quantity > 0)
--
-- Design Doc § 4.5 ระบุ Body ของ Endpoint ว่า `quantity?` เป็น optional และ
-- ไม่มี pricePerUnit เลย — ซึ่ง "ขัดกับ CHECK ข้างบนตรงๆ" ถ้าแปลตรงตัวว่าให้
-- ใส่ 0 หรือ NULL ลงไป แถว dividend จะถูก DB ปฏิเสธทุกแถว
--
-- ── ทางเลือกที่ **ไม่เลือก**: ผ่อน CHECK ให้ quantity/price เป็น 0 หรือ NULL ได้ ──
-- Design Doc § 5.3 วางหลักการไว้เองแล้วตอนอธิบายว่าทำไมไม่ใช้ amount ติดลบ:
--   "การเปิดให้ติดลบเพื่อ dividend อย่างเดียว = ปิดเกราะที่ป้องกันทั้งตารางอยู่
--    ทำให้บั๊ก 'เงินติดลบ' ในอนาคตทะลุถึง DB ได้ทุกชนิดธุรกรรม — แลกไม่คุ้ม"
-- เหตุผลเดียวกันเป๊ะใช้กับ quantity/price_per_unit: ถ้าผ่อนให้เป็น 0/NULL ได้
-- เพื่อ dividend อย่างเดียว บั๊ก "จำนวนหุ้นเป็น 0" หรือ "ราคาเป็น NULL" ของ
-- **คำสั่งซื้อ/ขาย** ในอนาคตจะทะลุถึง DB ได้ด้วย ทั้งที่วันนี้ถูกกันไว้แน่นหนา
--
-- ── ทางที่เลือก: เก็บค่าที่ "มีความหมายจริง" ไม่ใช่ค่าหลอก ────────────────────
--   quantity       = จำนวนหน่วยที่ถืออยู่ ณ วันที่ได้ปันผล ("หุ้นกี่หน่วยที่ได้ปันผลนี้")
--   price_per_unit = amount_thb / quantity = **เงินปันผลต่อหน่วย** (DPS)
--   amount_thb     = เงินปันผลรวมที่ได้รับจริง (ค่าที่ผู้ใช้กรอก)
--
-- ทั้งสามค่า > 0 เสมอโดยธรรมชาติ ไม่ต้องผ่อน CHECK ใดๆ เลย และ price_per_unit
-- ที่ได้ไม่ใช่ "ค่าขยะเพื่อให้ผ่าน Constraint" แต่เป็นตัวเลขที่นักลงทุนใช้จริง
-- (เทียบ DPS ข้ามงวดได้ทันทีโดยไม่ต้องคำนวณใหม่)
--
-- ⚠️ quantity ของแถว dividend **ไม่มีผลต่อยอดคงเหลือแม้แต่หน่วยเดียว** เพราะ
-- heldQuantitySign('dividend') = 0 ทั้งฝั่ง JS (utils/transactionType.util.js)
-- และฝั่ง SQL (CASE ใน RPC ด้านล่าง) — เก็บไว้เป็น "บริบทของรายการ" เท่านั้น
-- ห้ามมีโค้ดที่ไหนเอา quantity ของ dividend ไปบวก/ลบยอดถือโดยไม่ผ่าน
-- heldQuantitySign เด็ดขาด (นี่คือเหตุผลที่ Stage 6a รวมสูตรมาไว้ที่เดียว)
--
-- ── ผู้ใช้ไม่ได้ถือหุ้นตัวนั้นอยู่เลย → ห้ามบันทึก ────────────────────────────
-- quantity = 0 แปลว่า "ไม่ได้ถือ" ซึ่งเป็นไปไม่ได้ที่จะได้ปันผล — ชั้น Service
-- ต้องตอบ 403 NOTHING_TO_RECEIVE_DIVIDEND ก่อนถึง DB (Design Doc § 4.5)
-- CHECK quantity > 0 ที่นี่จึงเป็น "ด่านสุดท้าย" ที่กันไว้อีกชั้น ไม่ใช่ด่านแรก

-- ── 1) transactions.type — ผ่อน CHECK ให้รับ 2 ค่าใหม่ ─────────────────────
-- ทำเป็น ALTER เดียว (DROP + ADD ในคำสั่งเดียวกัน) โดยเจตนา — Postgres ทำทั้งคู่
-- ใน Transaction เดียว จึง "ไม่มีวินาทีใดเลย" ที่ตารางไม่มี CHECK คุม type
-- (ถ้าแยกเป็น 2 คำสั่ง จะมีช่องว่างที่ INSERT type มั่วๆ หลุดเข้ามาได้จริง)
--
-- ⚠️ ชื่อ Constraint 'transactions_type_check' เป็นชื่อ Auto-generate ของ Postgres
-- จาก migration 001 — ยืนยันชื่อจริงก่อน Apply ด้วย Query นี้ ถ้าไม่ตรงต้องแก้ชื่อ
-- ในบรรทัด DROP ให้ตรงก่อน (อย่าเดา):
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'transactions'::regclass AND contype = 'c'
--      AND pg_get_constraintdef(oid) ILIKE '%type%';
ALTER TABLE transactions
  DROP CONSTRAINT transactions_type_check,
  ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('buy', 'sell', 'dividend', 'dividend_reversal'));

COMMENT ON COLUMN transactions.type IS
  'ประเภทธุรกรรม — buy/sell กระทบยอดถือและต้นทุน · dividend = เงินปันผลรับ (ไม่กระทบยอดถือ/ต้นทุน/realizedPnL เลย เป็นรายได้คนละก้อน) · dividend_reversal = แถวหักล้างปันผลตอนกด Undo (Immutable Ledger ไม่ลบ/ไม่แก้แถวเดิม) — ความหมายของแต่ละค่าตัดสินที่ backend/src/utils/transactionType.util.js ที่เดียว ห้ามเขียน if/else ตาม type กระจายในโค้ด (migration 047)';

-- ⚠️ จงใจ "ไม่" แตะ CHECK ของ pending_transactions.command_type
-- Flow Preview→Confirm ของ LINE ใช้กับคำสั่งซื้อ/ขายเท่านั้น — dividend มี
-- Endpoint แยกของตัวเอง (Design Doc § 4.5: แยกออกจาก POST /transactions โดย
-- ตั้งใจ เพราะ Payload ต่างกันเชิงความหมาย) ถ้าวันหนึ่งจะรับปันผลผ่าน LINE
-- ค่อยเปิด CHECK นั้นใน Migration แยกพร้อม Flow ที่ออกแบบมาเฉพาะ

-- ═══════════════════════════════════════════════════════════════════════
-- 2) create_transaction_locked() — นับยอดคงเหลือแบบ Enumerate ครบทุก type
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ นี่คือจุดที่อันตรายที่สุดของ Migration นี้ และเป็นจุดที่ Design Doc § 2 ระบุว่า
-- "ผิดถึงระดับ DB" — Stage 6a แก้ฝั่ง JS ครบแล้ว 7 จุด แต่ **ฝั่ง SQL ยังเป็น
-- Binary อยู่** ใน 2 บรรทัดของ Function นี้ (มาตั้งแต่ migration 034):
--
--     [ก] SUM(CASE WHEN t.type = 'buy' THEN t.quantity ELSE -t.quantity END)
--     [ข] CASE WHEN p_type = 'buy' THEN v_held + p_quantity ELSE v_held - p_quantity END
--
-- ทั้งสองบรรทัดแปลว่า "ทุก type ที่ไม่ใช่ buy = หักจำนวนออก" ถ้าปล่อยไว้แล้วเปิด
-- CHECK ด้านบน จะเกิดสิ่งนี้ทันทีที่มีแถว dividend แถวแรก:
--   - [ก] ยอดคงเหลือที่ RPC ใช้ตัดสิน "ขายเกินไหม" จะ **น้อยกว่าความจริง**
--         เท่ากับ quantity ของทุกแถวปันผลรวมกัน → ผู้ใช้ขายหุ้นที่ตัวเองถืออยู่จริง
--         ไม่ได้ ได้ INSUFFICIENT_QUANTITY ทั้งที่ยอดในพอร์ตยังเหลือ
--   - [ข] held_after ที่ส่งกลับไปขึ้นการ์ด LINE จะโชว์ยอดผิด
--   - และเพราะ RPC เป็น **ทางเข้า Ledger ทางเดียวของทั้งระบบ** ความผิดนี้จะกระทบ
--     ทุกช่องทางพร้อมกัน (LINE / เว็บ / Bulk Import / Undo)
--
-- ── ทำไมใช้ CREATE OR REPLACE ได้ (ไม่เกิด Overload ซ้อน) ────────────────────
-- ชนิดและจำนวนพารามิเตอร์ไม่เปลี่ยนจาก migration 041 เลยแม้แต่ตัวเดียว
-- (11 ตัว ชนิดเดิมทั้งหมด) — Signature จึงเหมือนเดิม Postgres แทนที่ Body ให้ตรงๆ
-- ต่างจาก migration 046 ที่ต้อง DROP ก่อนเพราะ **เพิ่ม** พารามิเตอร์
--
-- Body ด้านล่าง Copy จาก migration 041 ทุกบรรทัด เปลี่ยนเฉพาะ 2 จุดที่ทำเครื่องหมาย
-- ⬅️ ไว้ — ห้ามแก้ Logic Lock/Ownership/Oversell/fee ใดๆ เพราะเป็นส่วนที่
-- migration 034/035/036/041 แก้บั๊กไว้แล้วทีละตัว
CREATE OR REPLACE FUNCTION public.create_transaction_locked(
  p_user_id        UUID,
  p_asset_id       UUID,
  p_type           TEXT,
  p_amount_thb     NUMERIC,
  p_price_per_unit NUMERIC,
  p_quantity       NUMERIC,
  p_currency       TEXT DEFAULT 'THB',
  p_fee_thb        NUMERIC DEFAULT NULL,
  p_date           DATE DEFAULT NULL,
  p_note           TEXT DEFAULT NULL,
  p_source         TEXT DEFAULT 'line'
)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  asset_id        UUID,
  type            TEXT,
  amount_thb      NUMERIC,
  price_per_unit  NUMERIC,
  quantity        NUMERIC,
  currency        TEXT,
  fee_thb         NUMERIC,
  date            DATE,
  note            TEXT,
  source          TEXT,
  slip_image_path TEXT,
  created_at      TIMESTAMPTZ,
  held_after      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_held      NUMERIC;
  v_held_sign NUMERIC;
  v_new       public.transactions%ROWTYPE;
BEGIN
  -- ── 0) Guard: type ที่ระบบยังไม่รู้จัก ต้องพังทันที ห้ามเดา ⬅️ [เพิ่มใหม่ 047]
  -- คู่ขนานกับ `default: throw` ของ utils/transactionType.util.js ฝั่ง JS —
  -- ถ้าวันหนึ่งมีคนเพิ่มค่าใน CHECK ของ type แต่ลืมมาเพิ่ม CASE ในฟังก์ชันนี้
  -- ค่าใหม่นั้นจะตกไปที่ ELSE ของ CASE แล้วถูกนับเป็น 0 เงียบๆ (ยอดคงเหลือผิด
  -- โดยไม่มีใครรู้) — Guard นี้บังคับให้เจอตั้งแต่แถวแรกแทนที่จะเจอตอนตัวเลขเพี้ยน
  IF p_type NOT IN ('buy', 'sell', 'dividend', 'dividend_reversal') THEN
    RAISE EXCEPTION 'UNKNOWN_TRANSACTION_TYPE'
      USING ERRCODE = 'P0001', DETAIL = format('type=%s', p_type);
  END IF;

  -- ── 1) Lock แถว asset + ตรวจความเป็นเจ้าของในเงื่อนไขเดียวกัน (จาก 036) ────
  PERFORM 1
     FROM public.assets a
    WHERE a.id = p_asset_id
      AND a.user_id = p_user_id
      FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSET_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('asset_id=%s', p_asset_id);
  END IF;

  -- ── 2) ยอดคงเหลือจริง ณ จุดที่ Lock แล้ว ──────────────────────────────────
  -- ⬅️ [แก้ 047] เดิม: CASE WHEN t.type = 'buy' THEN t.quantity ELSE -t.quantity END
  -- ต้องตรงกับ heldQuantitySign() ใน utils/transactionType.util.js เป๊ะทุกค่า:
  --   buy +q · sell -q · dividend 0 · dividend_reversal 0
  -- (ปันผล "เงินสด" ไม่ทำให้ถือหุ้นเพิ่ม/ลด — ปันผลเป็น "หุ้น" เป็นคนละเรื่อง
  --  เลื่อนไปรอบหน้าตามมติ Founder Q4.4 และจะเป็น type ที่ 5 แยกต่างหาก)
  SELECT COALESCE(SUM(
           CASE t.type
             WHEN 'buy'  THEN  t.quantity
             WHEN 'sell' THEN -t.quantity
             ELSE 0
           END
         ), 0)
    INTO v_held
    FROM public.transactions t
   WHERE t.asset_id = p_asset_id;

  -- ── 3) Guard ฝั่งขาย ──────────────────────────────────────────────────────
  -- ไม่ต้องแก้: เงื่อนไขผูกกับ p_type = 'sell' อยู่แล้ว dividend จึงไม่เข้าเงื่อนไขนี้
  -- ซึ่งถูกต้อง — การรับปันผลไม่ได้ลดยอดถือ จึงไม่มีอะไรให้ตรวจว่า "เกิน" หรือไม่
  IF p_type = 'sell' AND p_quantity > v_held THEN
    RAISE EXCEPTION 'INSUFFICIENT_QUANTITY'
      USING ERRCODE = 'P0001',
            DETAIL  = format('requested=%s;held=%s', p_quantity, v_held);
  END IF;

  -- ── 4) INSERT ในธุรกรรมเดียวกัน ───────────────────────────────────────────
  INSERT INTO public.transactions (
    user_id, asset_id, type, amount_thb, price_per_unit, quantity,
    currency, fee_thb, date, note, source
  ) VALUES (
    p_user_id, p_asset_id, p_type, p_amount_thb, p_price_per_unit, p_quantity,
    COALESCE(p_currency, 'THB'),
    p_fee_thb,
    COALESCE(p_date, (now() AT TIME ZONE 'Asia/Bangkok')::date),
    p_note,
    COALESCE(p_source, 'line')
  )
  RETURNING * INTO v_new;

  -- ⬅️ [แก้ 047] เดิม: CASE WHEN p_type = 'buy' THEN v_held + p_quantity ELSE v_held - p_quantity END
  -- แยกเป็นตัวแปร v_held_sign เพื่อให้ "กฎเดียวกับข้อ 2" อ่านออกว่าตรงกันจริง
  v_held_sign := CASE p_type
                   WHEN 'buy'  THEN  1
                   WHEN 'sell' THEN -1
                   ELSE 0
                 END;

  RETURN QUERY SELECT
    v_new.id, v_new.user_id, v_new.asset_id, v_new.type,
    v_new.amount_thb, v_new.price_per_unit, v_new.quantity,
    v_new.currency, v_new.fee_thb, v_new.date, v_new.note, v_new.source,
    v_new.slip_image_path, v_new.created_at,
    ROUND(v_held + v_held_sign * p_quantity, 8);
END;
$$;

-- ── สิทธิ์การเรียก (ประกาศซ้ำให้ Idempotent — เหตุผลเดียวกับ 034/036/041) ───
REVOKE ALL ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply — คาดหวังผลตามที่เขียนกำกับไว้ทุกข้อ)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) CHECK ใหม่มีจริง + รับครบ 4 ค่า
--   SELECT conname, pg_get_constraintdef(oid) AS def
--     FROM pg_constraint
--    WHERE conrelid = 'transactions'::regclass AND contype = 'c'
--      AND conname = 'transactions_type_check';
--   คาดหวัง: 1 แถว def มีทั้ง 'buy','sell','dividend','dividend_reversal'
--
-- 2) จำนวนแถว transactions ต้องเท่าเดิมเป๊ะ (Migration นี้ไม่แตะข้อมูล)
--   SELECT count(*) FROM transactions;      -- จดเลขไว้ "ก่อน" Apply แล้วเทียบ
--
-- 3) ยังไม่มีแถว dividend ใดๆ ทันทีหลัง Apply (โค้ดยังไม่ Deploy)
--   SELECT type, count(*) FROM transactions GROUP BY type ORDER BY type;
--   คาดหวัง: เห็นแค่ buy / sell เท่านั้น
--
-- 4) create_transaction_locked เหลือ Signature เดียว (11 Argument)
--   SELECT p.oid::regprocedure AS signature
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'create_transaction_locked';
--   ⚠️ คาดหวัง: 1 แถวเท่านั้น — ถ้าได้ 2 แถว = CREATE OR REPLACE ไม่ได้แทนที่ตัวเดิม
--      (แปลว่า Signature เพี้ยนไปจาก 041) PostgREST จะเลือก Function ไม่ถูกแล้วตอบ
--      "Could not choose the best candidate function" = พังทั้งทางเข้า Ledger
--
-- 5) Body ใหม่ถูกใช้จริง (ไม่ใช่ยังเป็นของ 041)
--   SELECT prosrc LIKE '%v_held_sign%' AS is_047
--     FROM pg_proc WHERE proname = 'create_transaction_locked';
--   คาดหวัง: true
--
-- 6) สิทธิ์ Execute ถูกจำกัดเฉพาะ service_role
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'create_transaction_locked';
--   คาดหวัง: มีเฉพาะ service_role (และ owner) — ห้ามมี anon/authenticated/PUBLIC

-- ═══════════════════════════════════════════════════════════════════════
-- RED-GREEN ระดับ SQL (รันบน Staging/Supabase Branch ก่อน — ห้ามรันบน Production)
-- ═══════════════════════════════════════════════════════════════════════
-- พิสูจน์ "ด้วยของจริง" ว่า dividend ไม่กินยอดคงเหลือ ไม่ใช่แค่เชื่อว่าน่าจะไม่กิน
-- ทุกบล็อกจบด้วย ROLLBACK จึงไม่มีข้อมูลใดถูกเขียนจริง
--
--   -- (GREEN) หัวใจของ Stage 6b: บันทึกปันผลแล้วยอดถือต้อง "ไม่ขยับ"
--   BEGIN;
--     -- ใช้ asset จริงตัวใดก็ได้ที่มียอดถือ > 0
--     WITH a AS (
--       SELECT t.asset_id, t.user_id,
--              SUM(CASE t.type WHEN 'buy' THEN t.quantity WHEN 'sell' THEN -t.quantity ELSE 0 END) AS held
--         FROM transactions t GROUP BY 1,2 HAVING SUM(CASE t.type WHEN 'buy' THEN t.quantity WHEN 'sell' THEN -t.quantity ELSE 0 END) > 0 LIMIT 1
--     )
--     SELECT held_after FROM a, LATERAL create_transaction_locked(
--       a.user_id, a.asset_id, 'dividend', 100, 1, a.held, 'THB', NULL, NULL, 'ZZTEST', 'web'
--     );
--     คาดหวัง: held_after = a.held **เท่าเดิมเป๊ะ** (ไม่ใช่ a.held - a.held = 0)
--     ⚠️ ถ้าได้ 0 หรือค่าติดลบ = Body ของ 041 ยังถูกใช้อยู่ → Rollback ทันที
--   ROLLBACK;
--
--   -- (GREEN) ขายได้ตามปกติหลังมีแถวปันผลแล้ว (พิสูจน์ข้อ [ก] ในหัวข้อด้านบน)
--   ทำซ้ำบล็อกข้างบนแต่ INSERT dividend ก่อน แล้วตามด้วย
--     create_transaction_locked(..., 'sell', <เงิน>, <ราคา>, a.held, ...)
--   คาดหวัง: ผ่าน ได้ held_after = 0 — ไม่ใช่ INSUFFICIENT_QUANTITY
--   ⚠️ ถ้าได้ INSUFFICIENT_QUANTITY = ยอดคงเหลือถูกปันผลกินไป → Rollback ทันที
--
--   -- (RED) type ที่ไม่รู้จักต้องพัง ไม่ใช่ผ่านแล้วนับเป็น 0
--   BEGIN;
--     SELECT create_transaction_locked(
--       <uid>, <aid>, 'stock_dividend', 100, 1, 1, 'THB', NULL, NULL, NULL, 'web');
--   ROLLBACK;
--   คาดหวัง: ERROR UNKNOWN_TRANSACTION_TYPE (จาก Guard ข้อ 0)
--   ⚠️ ถ้าได้ ERROR ของ CHECK constraint แทน ก็ยังถือว่ากันได้ แต่ Guard ข้อ 0
--      ไม่ทำงาน ต้องตรวจว่าทำไม (ปกติ Guard ต้องดังก่อนเสมอเพราะอยู่บรรทัดแรก)
--
--   -- (RED) ขายเกินยอด ยังต้องถูกกันเหมือนเดิม (ไม่ได้เผลอปิดเกราะเดิม)
--   คาดหวัง: ERROR INSUFFICIENT_QUANTITY ✅

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับ: Revert โค้ดก่อน แล้วค่อยแตะ DB เสมอ
--
-- ขั้น 1 — Revert โค้ด (Railway Redeploy ตัวก่อนหน้า ทั้ง EasyDCA + easydca-worker)
--          ต้องทำก่อน ไม่งั้น Endpoint dividend ที่ยังเปิดอยู่จะเขียนแถวใหม่เข้ามา
--          ระหว่างที่เรากำลังถอน CHECK
--
-- ขั้น 2 — ⚠️ ตรวจก่อนถอน CHECK: ถ้ามีแถว dividend เกิดขึ้นแล้ว การถอนกลับเป็น
--          CHECK เดิม 2 ค่าจะ ERROR ทันที (ข้อมูลละเมิด) — ต้องดูก่อนเสมอ:
--            SELECT type, count(*) FROM transactions
--             WHERE type IN ('dividend','dividend_reversal') GROUP BY type;
--          ถ้าไม่ว่าง: **ห้ามลบแถวทิ้งเด็ดขาด** (กฎเหล็กข้อ 2 — Immutable Ledger
--          ห้าม DELETE/UPDATE transaction) ต้อง Export เก็บก่อนแล้วตัดสินใจร่วมกับ
--          Founder ว่าจะทำอย่างไร ทางที่ปลอดภัยที่สุดคือ **ไม่ Rollback CHECK**
--          (ปล่อยให้รับ 4 ค่าต่อไป ซึ่งไม่เป็นอันตรายในตัวมันเอง) แล้ว Revert
--          เฉพาะโค้ด — ผู้ใช้จะบันทึกปันผลใหม่ไม่ได้ แต่ของเดิมยังอยู่ครบและอ่านได้
--
-- ขั้น 3 — ถอน (ทำเฉพาะเมื่อยังไม่มีแถว dividend เท่านั้น):
--   ALTER TABLE transactions
--     DROP CONSTRAINT transactions_type_check,
--     ADD CONSTRAINT transactions_type_check CHECK (type IN ('buy', 'sell'));
--   -- แล้วรัน migration 041 ซ้ำเพื่อเอา Body เวอร์ชันเดิมของ RPC กลับมา
--   -- (ไม่จำเป็นต่อความถูกต้อง: Body ใหม่ให้ผลเท่าเดิมเป๊ะเมื่อมีแต่ buy/sell
--   --  แต่ทำเพื่อให้สถานะ DB ตรงกับ Migration ล่าสุดที่ Apply จริง)
--
-- ⚠️ สิ่งที่จะเสียไป: ความสามารถบันทึกเงินปันผล — **ไม่กระทบ buy/sell แม้แต่บาทเดียว**
-- (Body ใหม่ของ RPC ให้ผลเหมือน 041 ทุกประการสำหรับ buy/sell: buy +q, sell -q)
