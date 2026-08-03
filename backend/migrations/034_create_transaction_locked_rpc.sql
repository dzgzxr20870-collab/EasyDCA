-- ═══════════════════════════════════════════════════════════════════════
-- Migration 034 — RPC create_transaction_locked() (แก้ Oversell Race)
-- ═══════════════════════════════════════════════════════════════════════
-- ปิดช่องโหว่ "ขายเกินยอดคงเหลือ" ที่ transaction.service.js:522-548 เขียน TODO
-- ค้างไว้ตั้งแต่ Phase 1 — การตรวจ INSUFFICIENT_QUANTITY เดิมเป็น check-then-insert
-- ที่ไม่ Atomic: อ่านประวัติด้วย findAllByAsset → คำนวณยอดคงเหลือในชั้น App → INSERT
-- ถ้ามีสองคำสั่งขาย Asset เดียวกันเข้ามาพร้อมกัน ทั้งคู่จะอ่านประวัติชุดเดียวกัน
-- (Stale Read) แล้วผ่านการตรวจทั้งคู่ → ยอดคงเหลือติดลบ
--
-- ⚠️ เส้นทางเว็บทำให้ Reproduce ได้ง่ายมาก: POST /api/v1/transactions ฝั่งขายเรียก
-- processSellCommand ตรงๆ ไม่มีขั้น Preview/Confirm คั่น จึงยิงขนานด้วย Promise.all
-- ได้ทันที (ต่างจาก LINE ที่ต้องกดปุ่มยืนยันทีละใบ)
--
-- Implement ตาม DATABASE.md § 12 ทุกข้อ (เอกสารออกแบบไว้ตั้งแต่แรกแต่ยังไม่เคยทำ):
--   1. Lock แถว assets ด้วย SELECT ... FOR UPDATE ก่อนคำนวณ
--   2. คำนวณยอดคงเหลือจาก transactions "หลัง" Lock (ข้อมูลนิ่งจริง)
--   3. ถ้าเป็น sell + เกินยอด → RAISE (ทั้ง Transaction Rollback ไม่มีแถวตกค้าง)
--   4. INSERT ในธุรกรรมเดียวกัน
-- Isolation READ COMMITTED (Default) + Row Lock เพียงพอ ไม่ต้อง SERIALIZABLE (§ 12 ข้อ 3)
-- Lock ระดับ asset_id เดียวเท่านั้น — คนละ Asset ขายพร้อมกันไม่ต้องรอกัน (§ 12 ข้อ 4)
--
-- ── ทำไมต้องเป็น RPC ─────────────────────────────────────────────────────
-- Supabase JS Client (PostgREST) ไม่รองรับ Multi-statement Transaction / Row Lock
-- จาก Client เลย — Lock + Validate + Insert ต้องอยู่ใน Statement เดียวที่ฝั่ง DB
-- เท่านั้นถึงจะ Atomic จริง (นี่คือเหตุผลที่ TODO เดิมระบุว่าต้องย้ายมาเป็น RPC)
--
-- ── ครอบทุก Path ที่เขียน Ledger ─────────────────────────────────────────
-- ทั้งระบบมีจุด INSERT เข้า transactions แค่ 3 จุด และทุกจุดเรียกผ่าน
-- transactionRepository.create() ตัวเดียวกันหมด:
--   1. transaction.service.js:423  processBuyCommand   (type='buy')
--   2. transaction.service.js:558  processSellCommand  (type='sell')  ← เสี่ยง
--   3. undoTransaction.service.js:142 Reversal (type ตรงข้ามรายการล่าสุด) ← เสี่ยง
-- จึงเปลี่ยน "ตัว create() ในชั้น Repository" ให้เรียก RPC นี้แทน INSERT ตรงๆ
-- = ทั้ง 3 จุดได้ Lock อัตโนมัติโดยไม่ต้องแก้ Call Site และ "ไม่มีทางลืม Path ใหม่
-- ในอนาคต" เพราะโค้ดทั้ง Repo เหลือทางเข้า Ledger ทางเดียว
--
-- Function รับ type ทั้ง buy/sell โดยเจตนา (ไม่ทำเฉพาะ sell) เพื่อให้ทุกการเขียน
-- Ledger ของ Asset เดียวกัน Serialize ตามกันจริงตาม § 12 ("การเขียน transactions
-- ทุกครั้งต้องอยู่ใน Database Transaction เดียวที่ Lock แถวที่เกี่ยวข้องก่อนคำนวณ")
-- — ฝั่ง buy ไม่มีเงื่อนไขให้ปฏิเสธ แค่ต้องเข้าคิว Lock เดียวกันเท่านั้น
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_transaction_locked(
  p_user_id        UUID,
  p_asset_id       UUID,
  p_type           TEXT,
  p_amount_thb     NUMERIC,
  p_price_per_unit NUMERIC,
  p_quantity       NUMERIC,
  p_currency       TEXT DEFAULT 'THB',
  p_fee_thb        NUMERIC DEFAULT 0,
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
  -- ยอดคงเหลือ "หลัง" บันทึกรายการนี้ คำนวณจากยอดที่ Lock ไว้แล้วจริง — ฝั่ง App
  -- ใช้ค่านี้ตอบ remainingQuantity แทนการคำนวณเองจาก Snapshot ก่อน Insert (ซึ่ง
  -- ภายใต้ Concurrency อาจไม่ตรงกับความจริง ณ วินาทีที่บันทึกสำเร็จ)
  held_after      NUMERIC
)
LANGUAGE plpgsql
-- SECURITY DEFINER: รันด้วยสิทธิ์เจ้าของ Function ไม่ใช่สิทธิ์ผู้เรียก
-- ⚠️ ต้องคู่กับ REVOKE ท้ายไฟล์เสมอ — Postgres GRANT EXECUTE ให้ PUBLIC โดยปริยาย
-- ถ้าไม่ Revoke จะกลายเป็นว่า anon/authenticated เรียก Function ที่รันด้วยสิทธิ์สูง
-- ผ่าน PostgREST ได้ (สร้างธุรกรรมให้ user_id ใครก็ได้) = เปิดช่องโหว่ใหม่ที่ร้ายกว่าเดิม
SECURITY DEFINER
-- ล็อก search_path ตาม Convention migration 028 (Supabase Security Advisor)
SET search_path = public, pg_temp
AS $$
DECLARE
  v_held NUMERIC;
  v_new  public.transactions%ROWTYPE;
BEGIN
  -- ── 1) Lock แถว asset (§ 12 ข้อ 1) ────────────────────────────────────
  -- Request อื่นที่แตะ Asset เดียวกันจะรอตรงนี้จนกว่าเราจะ COMMIT/ROLLBACK
  -- (PostgREST ครอบ 1 Request = 1 Transaction ให้อยู่แล้ว Lock จึงคงอยู่ทั้งฟังก์ชัน)
  PERFORM 1 FROM public.assets a WHERE a.id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSET_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('asset_id=%s', p_asset_id);
  END IF;

  -- ── 2) ยอดคงเหลือจริง ณ จุดที่ Lock แล้ว (§ 12 ข้อ 2) ──────────────────
  -- สูตรตรงกับ transaction.service.calculateHeldQuantity เป๊ะ (buy บวก / sell ลบ)
  -- ต่างกันแค่ที่นี่บวกลบด้วย NUMERIC ซึ่งแม่นกว่า Float ของ JS (ไม่มี 0.1+0.2 noise)
  SELECT COALESCE(SUM(CASE WHEN t.type = 'buy' THEN t.quantity ELSE -t.quantity END), 0)
    INTO v_held
    FROM public.transactions t
   WHERE t.asset_id = p_asset_id;

  -- ── 3) Guard ฝั่งขาย (§ 12 ข้อ 3) ──────────────────────────────────────
  -- ใช้ '>' ไม่ใช่ '>=' — ขายพอดีหมดทั้งจำนวนที่ถืออยู่ต้องทำได้ (ตรงกับเงื่อนไข
  -- เดิมใน validateSell: amounts.quantity > heldQuantity)
  IF p_type = 'sell' AND p_quantity > v_held THEN
    RAISE EXCEPTION 'INSUFFICIENT_QUANTITY'
      USING ERRCODE = 'P0001',
            DETAIL  = format('requested=%s;held=%s', p_quantity, v_held);
  END IF;

  -- ── 4) INSERT ในธุรกรรมเดียวกัน (§ 12 ข้อ 4) ───────────────────────────
  INSERT INTO public.transactions (
    user_id, asset_id, type, amount_thb, price_per_unit, quantity,
    currency, fee_thb, date, note, source
  ) VALUES (
    p_user_id, p_asset_id, p_type, p_amount_thb, p_price_per_unit, p_quantity,
    COALESCE(p_currency, 'THB'),
    COALESCE(p_fee_thb, 0),
    -- date NOT NULL — App ส่งวันตาม Asia/Bangkok มาเสมอ (todayInBangkok) ค่า
    -- Fallback นี้กันพลาดเฉยๆ ไม่ใช่เส้นทางปกติ
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

-- ── สิทธิ์การเรียก (บังคับ — ดูเหตุผลที่ SECURITY DEFINER ด้านบน) ──────────
-- Backend เข้าถึง Supabase ด้วย service_role key เท่านั้น (config/supabase.js
-- supabaseAdmin) จึงให้เฉพาะ role นั้น role เดียว
REVOKE ALL ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ลำดับสำคัญมาก — ห้าม DROP Function ก่อน Revert Code เด็ดขาด:
-- โค้ดรุ่นใหม่เขียน Ledger ผ่าน RPC นี้ทางเดียว ถ้า Drop ทิ้งขณะที่โค้ดใหม่ยังรันอยู่
-- "ผู้ใช้จะบันทึกซื้อ/ขายไม่ได้เลยทั้งระบบ" (ทุก INSERT พังหมด ไม่ใช่แค่ฝั่งขาย)
--
--   ขั้นที่ 1: git revert commit ที่แก้ transaction.repository.js แล้ว Push
--             (โค้ดกลับไป INSERT ตรงเหมือนเดิม — ทำงานได้ทันทีแม้ Function ยังอยู่)
--   ขั้นที่ 2: รอ Railway Deploy เสร็จ + ยืนยัน commitHash จริงว่ากลับไปรุ่นเก่าแล้ว
--   ขั้นที่ 3: ค่อย DROP Function:
--
--     DROP FUNCTION IF EXISTS public.create_transaction_locked(
--       UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
--     );
--
-- ⚠️ สิ่งที่จะเสียไปเมื่อ Rollback: กลับไปมีช่องโหว่ Oversell Race เหมือนเดิม
-- **ไม่มีข้อมูลใดสูญหาย** — Migration นี้ไม่ได้แก้ Schema/ข้อมูลเลยแม้แต่แถวเดียว
-- (เพิ่ม Function อย่างเดียว) ธุรกรรมที่บันทึกผ่าน RPC ไปแล้วเป็นแถวปกติใน
-- transactions ทุกประการ แยกไม่ออกจากแถวที่บันทึกด้วยวิธีเดิม
--
-- Migration นี้ Idempotent (CREATE OR REPLACE) — รันซ้ำได้ปลอดภัย
