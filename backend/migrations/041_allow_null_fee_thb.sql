-- ═══════════════════════════════════════════════════════════════════════
-- Migration 041 — fee_thb: NOT NULL DEFAULT 0 → NULLABLE ("ไม่รู้" ≠ "ไม่มี")
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ อ่านก่อน: คอลัมน์ fee_thb "มีอยู่แล้ว" ตั้งแต่ migration 001 — Migration นี้
-- ไม่ได้เพิ่มคอลัมน์ใหม่ แต่แก้ Nullability + ทางที่ค่าไหลผ่าน RPC
--
-- ── ปัญหาที่แก้ ────────────────────────────────────────────────────────────
-- ทุกวันนี้ fee_thb เป็น NOT NULL DEFAULT 0 และไม่เคยมีใครใส่ค่าจริงลงไปเลย
-- (transaction.service ส่ง `params.feeThb ?? 0` เสมอ) ทุกแถวจึงเป็น 0 ทั้งหมด
-- ซึ่ง "อ่านไม่ออกว่า" หมายถึงอะไรระหว่าง:
--     0    = โบรกไม่คิดค่าธรรมเนียมจริงๆ (เช่นโปรฟรีค่าคอม)
--     0    = ระบบไม่เคยเก็บข้อมูลนี้ (ความจริงของทุกแถวในวันนี้)
-- ความหมายสองอันนี้ต่างกันมากเมื่อเอาไปคำนวณต้นทุนจริง/รายงานภาษีในอนาคต
--
-- หลัง Migration นี้:
--     NULL   = ไม่รู้ค่าธรรมเนียม (สลิปไม่ระบุ / ผู้ใช้กรอกเอง / รายการที่มาจาก LINE
--              แบบพิมพ์คำสั่ง) — ค่าเริ่มต้นของทุกเส้นทางที่ไม่มีข้อมูลจริง
--     0      = ยืนยันแล้วว่าไม่มีค่าธรรมเนียม (ผู้ใช้กรอก 0 เองในฟอร์มเว็บ)
--     > 0    = ค่าธรรมเนียมจริงจากสลิป
--
-- ⚠️ แถวเดิมทั้งหมดยังเป็น 0 เหมือนเดิม — Migration นี้ "ไม่แตะข้อมูลเดิมแม้แถวเดียว"
-- (ห้ามลบ/แก้ข้อมูลผู้ใช้ ตาม AI_CONTEXT.md กฎเหล็กข้อ 2 + DATABASE.md § 4)
-- แปลว่ารายการก่อนหน้านี้จะยังกำกวมอยู่ตลอดไป ซึ่งยอมรับได้เพราะแก้ย้อนหลังไม่ได้จริงๆ
-- (จะไป UPDATE เป็น NULL ก็เท่ากับแก้ Ledger ซึ่งห้ามเด็ดขาด)
--
-- ── ทำไม "ช่องเดียว" ไม่แยกค่าคอม/VAT (ตัดสินใจแล้ว — ดูรายงาน) ────────────
-- 1) โบรกจำนวนมากไม่แยกให้เลย (Exchange คริปโตส่วนใหญ่คิดเป็น % ก้อนเดียว) ถ้าบังคับ
--    แยก 2 ช่องจะมีช่องที่เป็น NULL ตลอดกาลสำหรับโบรกกลุ่มนั้น = Schema ที่โกหก
-- 2) สำหรับนักลงทุนบุคคลธรรมดา VAT ที่โบรกเรียกเก็บบนค่าคอม "ไม่ได้ขอคืนได้" จึงเป็น
--    ส่วนหนึ่งของต้นทุนการซื้อขายเหมือนค่าคอม ไม่ต้องแยกรายงาน
-- 3) EasyTax ในอนาคตต้องการ "ต้นทุนรวมที่จ่ายจริง" เป็นหลัก — ยอดรวมตอบโจทย์นั้นแล้ว
--    ถ้าวันหนึ่งต้องแยกจริง ค่อยเพิ่มคอลัมน์ fee_breakdown JSONB ทีหลังได้แบบ Additive
--    โดยไม่ต้องย้ายข้อมูลเดิม (ตรงข้ามกับการยุบ 2 ช่องเป็น 1 ซึ่งย้อนยากกว่ามาก)
--
-- ── หน่วยของ fee_thb ────────────────────────────────────────────────────────
-- ⚠️ ชื่อคอลัมน์ลงท้าย _thb แต่ค่าที่เก็บคือ "สกุลเดียวกับ currency ของแถวนั้น"
-- (USD ก็เก็บเป็น USD) — Semantics เดียวกับ amount_thb/price_per_unit ที่คงชื่อเดิม
-- ไว้เพื่อ Backward Compat ตั้งแต่ migration 012 (Multi-Currency) ห้ามแปลงเป็นบาท
-- ตอนบันทึกเด็ดขาด
--
-- ── ผลต่อ P&L ───────────────────────────────────────────────────────────────
-- ⚠️ ไม่มีผลเลยแม้แต่บาทเดียว: ตรวจแล้วว่า fee_thb ไม่เคยถูกใช้ในสูตรคำนวณเงินใดๆ
-- ทั้งระบบ (portfolio.service / profit.service / dcaStats.service /
-- portfolioSummary.service / dashboardOverview.service ไม่มีตัวไหนอ่านค่านี้เลย)
-- Migration นี้จึงเปลี่ยนแค่ "สิ่งที่เก็บได้" ไม่เปลี่ยน "สิ่งที่คำนวณ"
--
-- อ้างอิงหลักการ: DATABASE.md § 4 (ห้ามลบข้อมูล), § 9 (ALTER TABLE Additive)
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1) transactions.fee_thb → NULLABLE ────────────────────────────────────
-- ไม่แตะ DEFAULT 0 ที่มีอยู่: การ INSERT ที่ "ไม่ระบุคอลัมน์นี้เลย" จะยังได้ 0
-- เหมือนเดิม (Backward Compat กับ Path ใดก็ตามที่ยังไม่ได้อัปเดต) ส่วน Path ที่
-- ตั้งใจบอกว่า "ไม่รู้" ต้องส่ง NULL มาตรงๆ ซึ่งทำได้แล้วหลัง DROP NOT NULL
ALTER TABLE transactions
  ALTER COLUMN fee_thb DROP NOT NULL;

COMMENT ON COLUMN transactions.fee_thb IS
  'ค่าธรรมเนียมรวม (ค่าคอม + VAT) ในสกุลเดียวกับ currency ของแถวนั้น — NULL = ไม่รู้ (สลิปไม่ระบุ/กรอกเอง) · 0 = ยืนยันว่าไม่มี · ไม่ถูกใช้ในสูตร P&L ใดๆ (ดู migration 041)';

-- ── 2) pending_transactions.fee_thb → NULLABLE ────────────────────────────
-- ต้องแก้ด้วย ไม่งั้นค่าธรรมเนียมจากสลิปจะถูกบีบเป็น 0 ตั้งแต่ขั้น Preview ของ LINE
-- (Flow: createPending → การ์ด Preview → confirmPending → transactions)
ALTER TABLE pending_transactions
  ALTER COLUMN fee_thb DROP NOT NULL;

COMMENT ON COLUMN pending_transactions.fee_thb IS
  'ค่าธรรมเนียมที่อ่านได้จากสลิป (สกุลเดียวกับ currency) — NULL = ไม่รู้ ส่งต่อเข้า transactions.fee_thb ตอน confirmPending';

-- ── 3) RPC create_transaction_locked — เลิกบีบ NULL ให้เป็น 0 ──────────────
-- ⚠️ จุดนี้คือหัวใจ: ต่อให้คอลัมน์ Nullable แล้ว ถ้า RPC ยัง COALESCE(p_fee_thb, 0)
-- ค่า NULL ที่ส่งมาจะกลายเป็น 0 อยู่ดี (ความหมาย "ไม่รู้" หายไปเงียบๆ)
--
-- CREATE OR REPLACE ได้เพราะ "ชนิดพารามิเตอร์ไม่เปลี่ยน" (NUMERIC เหมือนเดิม) —
-- ค่า DEFAULT ไม่ใช่ส่วนหนึ่งของ Signature จึงไม่เกิด Overload ซ้อน
--
-- Body ด้านล่าง Copy จาก migration 036 ทุกบรรทัด เปลี่ยนเฉพาะ 2 จุดที่ทำเครื่องหมาย
-- ⬅️ ไว้ (Default ของพารามิเตอร์ + การ COALESCE ตอน INSERT) — ห้ามแก้ Logic
-- Lock/Ownership/Oversell ใดๆ เพราะเป็นส่วนที่ migration 034/035/036 แก้บั๊กไว้แล้ว
CREATE OR REPLACE FUNCTION public.create_transaction_locked(
  p_user_id        UUID,
  p_asset_id       UUID,
  p_type           TEXT,
  p_amount_thb     NUMERIC,
  p_price_per_unit NUMERIC,
  p_quantity       NUMERIC,
  p_currency       TEXT DEFAULT 'THB',
  p_fee_thb        NUMERIC DEFAULT NULL,   -- ⬅️ เดิม DEFAULT 0
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
  v_held NUMERIC;
  v_new  public.transactions%ROWTYPE;
BEGIN
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
  SELECT COALESCE(SUM(CASE WHEN t.type = 'buy' THEN t.quantity ELSE -t.quantity END), 0)
    INTO v_held
    FROM public.transactions t
   WHERE t.asset_id = p_asset_id;

  -- ── 3) Guard ฝั่งขาย ──────────────────────────────────────────────────────
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
    p_fee_thb,                              -- ⬅️ เดิม COALESCE(p_fee_thb, 0)
    COALESCE(p_date, (now() AT TIME ZONE 'Asia/Bangkok')::date),
    p_note,
    COALESCE(p_source, 'line')
  )
  RETURNING * INTO v_new;

  RETURN QUERY SELECT
    v_new.id, v_new.user_id, v_new.asset_id, v_new.type,
    v_new.amount_thb, v_new.price_per_unit, v_new.quantity,
    v_new.currency, v_new.fee_thb, v_new.date, v_new.note, v_new.source,
    v_new.slip_image_path, v_new.created_at,
    ROUND(
      CASE WHEN p_type = 'buy' THEN v_held + p_quantity ELSE v_held - p_quantity END,
      8
    );
END;
$$;

-- ── สิทธิ์การเรียก (ประกาศซ้ำให้ Idempotent — เหตุผลเดียวกับ 034/036) ───────
REVOKE ALL ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (รันหลัง Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) คอลัมน์ Nullable แล้วทั้ง 2 ตาราง (คาดหวัง is_nullable = YES ทั้งคู่)
--   SELECT table_name, column_name, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE column_name = 'fee_thb'
--      AND table_name IN ('transactions', 'pending_transactions');
--
-- 2) ข้อมูลเดิมไม่ถูกแตะ — ทุกแถวเดิมต้องยังเป็น 0 และไม่มี NULL เลย ณ ตอนนี้
--    (NULL จะเริ่มมีก็ต่อเมื่อ Deploy โค้ดใหม่แล้วมีการบันทึกรายการใหม่เท่านั้น)
--   SELECT count(*) FILTER (WHERE fee_thb IS NULL)  AS เป็น_null,
--          count(*) FILTER (WHERE fee_thb = 0)      AS เป็น_ศูนย์,
--          count(*) FILTER (WHERE fee_thb > 0)      AS มีค่าจริง,
--          count(*)                                  AS ทั้งหมด
--     FROM transactions;
--   คาดหวังทันทีหลัง Apply: เป็น_null = 0 · เป็น_ศูนย์ = ทั้งหมด · มีค่าจริง = 0
--
-- 3) RPC รับ NULL แล้วเก็บเป็น NULL จริง (ไม่ถูกบีบเป็น 0)
--   SELECT pg_get_function_arguments(p.oid) AS args
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'create_transaction_locked';
--   คาดหวัง: เห็น "p_fee_thb numeric DEFAULT NULL::numeric"
--
-- 4) สิทธิ์ยังถูกต้อง (คาดหวัง service_role = true, ที่เหลือ false)
--   SELECT has_function_privilege('service_role',  p.oid, 'EXECUTE') AS has_service_role,
--          has_function_privilege('public',        p.oid, 'EXECUTE') AS has_public,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS has_anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS has_authenticated
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'create_transaction_locked';
--
-- 5) Smoke Test หลัง Deploy โค้ด — บันทึกรายการจากสลิปที่มีค่าธรรมเนียม 1 ใบ
--   SELECT a.symbol, t.amount_thb, t.fee_thb, t.currency, t.date
--     FROM transactions t JOIN assets a ON a.id = t.asset_id
--    ORDER BY t.created_at DESC LIMIT 1;
--   คาดหวัง: fee_thb มีค่าจริงตรงกับสลิป (ไม่ใช่ 0 และไม่ใช่ NULL)

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับ: Revert โค้ดก่อน แล้วค่อยแตะ DB เสมอ
--
-- ขั้น 1 — Revert โค้ด (Railway Redeploy ตัวก่อนหน้า ทั้ง EasyDCA + easydca-worker)
--
-- ขั้น 2 — คืน RPC ให้บีบ NULL เป็น 0 เหมือนเดิม (รันไฟล์ 036 ซ้ำทั้งไฟล์ได้เลย
--          เพราะเป็น CREATE OR REPLACE ที่ Idempotent)
--
-- ขั้น 3 — คืน NOT NULL (ทำได้ก็ต่อเมื่อ "ไม่มีแถวไหนเป็น NULL แล้ว" เท่านั้น):
--   -- 3.1 เช็คก่อนว่ามีแถว NULL ไหม
--   SELECT count(*) FROM transactions WHERE fee_thb IS NULL;
--   SELECT count(*) FROM pending_transactions WHERE fee_thb IS NULL;
--
--   -- 3.2 ⚠️ ถ้ามีแถว NULL อยู่ = มีรายการที่บันทึกหลัง Deploy แล้ว
--   --     "ห้าม UPDATE ให้เป็น 0" เพราะเท่ากับแก้ Ledger (ห้ามเด็ดขาด) —
--   --     ให้คง Nullable ไว้ตามเดิม แล้ว Rollback แค่ขั้น 1-2 พอ
--   --     (โค้ดเก่าส่ง 0 มาเสมออยู่แล้ว จึงทำงานกับคอลัมน์ Nullable ได้ปกติ)
--
--   -- 3.3 เฉพาะกรณีไม่มีแถว NULL เลย (Rollback ทันทีก่อนมีใครบันทึกใหม่):
--   ALTER TABLE transactions         ALTER COLUMN fee_thb SET NOT NULL;
--   ALTER TABLE pending_transactions ALTER COLUMN fee_thb SET NOT NULL;
--
-- ⚠️ สิ่งที่จะเสียไปถ้า Rollback: ความสามารถในการแยก "ไม่รู้" ออกจาก "ไม่มี" เท่านั้น
-- ไม่กระทบ Ledger · ไม่กระทบ P&L (fee ไม่เคยอยู่ในสูตร) · ไม่กระทบสิทธิ์ Premium
