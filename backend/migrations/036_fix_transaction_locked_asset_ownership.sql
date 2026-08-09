-- ═══════════════════════════════════════════════════════════════════════
-- Migration 036 — create_transaction_locked() ต้องเทียบ "เจ้าของ asset" จริง
-- ═══════════════════════════════════════════════════════════════════════
-- ที่มา: Security Audit — Cross-User Isolation (Opus, 9 ส.ค. 2026)
--
-- migration 034 สร้าง create_transaction_locked() ให้รับ p_user_id เข้ามา แต่
-- **ใช้ p_user_id แค่ประทับตอน INSERT เท่านั้น ไม่เคยใช้ตรวจสิทธิ์เลย**:
--
--   -- 034 บรรทัด 92 (เดิม)
--   PERFORM 1 FROM public.assets a WHERE a.id = p_asset_id FOR UPDATE;
--
-- แปลว่า Function ยอมเขียนธุรกรรมที่อ้าง asset_id ของ "ผู้ใช้คนอื่น" ได้ ถ้ามีจุดใด
-- ส่ง assetId ที่ไม่ใช่ของ p_user_id เข้ามา และยังคืน held_after (ยอดคงเหลือที่
-- คำนวณจากธุรกรรมของ asset นั้น) กลับออกไปด้วย = ข้อมูลการถือครองของคนอื่นรั่ว
--
-- ⚠️ นี่คือรูปแบบที่อันตรายเป็นพิเศษเพราะ "ดูเหมือนปลอดภัย": Signature มี
-- p_user_id ครบ อ่าน Call Site ก็เห็นส่งมาถูก แต่ข้างในไม่ได้บังคับอะไรเลย
--
-- ตอนนี้ยัง Exploit ไม่ได้จริงเพราะทุก Caller resolve asset แบบ user-scoped อยู่แล้ว
-- (assetRepository.findByUserAndSymbol / findActiveByUser) และไม่มี Endpoint ไหน
-- รับ assetId จาก Request เลย — Migration นี้จึงเป็นการปิดที่ "ชั้นในสุด" เพื่อให้
-- ความปลอดภัยไม่ขึ้นกับวินัยของ Caller ในอนาคตอีกต่อไป (Defense in Depth ชั้นที่
-- DB เป็นคนบังคับ ซึ่งเป็นชั้นเดียวที่ลืมไม่ได้)
--
-- เทียบกับ migration 035 (create_asset_locked) ที่ทำถูกอยู่แล้ว — Lock ด้วย
-- `WHERE u.id = p_user_id` และนับ asset ด้วย `WHERE a.user_id = p_user_id`
--
-- ── สิ่งที่เปลี่ยนจาก 034 มีจุดเดียว ────────────────────────────────────────
--   เพิ่ม `AND a.user_id = p_user_id` เข้าไปในเงื่อนไข Lock แถว assets
--   ที่เหลือ (สูตรยอดคงเหลือ / Guard ฝั่งขาย / INSERT / RETURN) เหมือน 034 เป๊ะ
--
-- ตั้งใจ "คง" RAISE เป็น 'ASSET_NOT_FOUND' เดิม ไม่เพิ่ม Error Code ใหม่:
--   1. ไม่บอกใบ้ว่า asset_id นั้นมีอยู่จริงแต่เป็นของคนอื่น (แยกไม่ออกจาก "ไม่มีจริง"
--      โดยเจตนา — Pattern เดียวกับ transaction.repository.findByIdForUser)
--   2. ชั้น App (transaction.repository.js:105) Handle Code นี้อยู่แล้ว → ไม่ต้อง
--      แก้โค้ดฝั่ง Node เลย Migration นี้ Deploy ได้อิสระจาก Code
--
-- ตั้งใจ "ไม่" เพิ่ม `AND t.user_id = p_user_id` ในสูตรรวมยอดคงเหลือ (บรรทัด
-- SELECT COALESCE(SUM(...))) แม้จะดูรัดกุมกว่า เพราะเมื่อยืนยันแล้วว่า asset เป็น
-- ของ p_user_id การรวมด้วย asset_id ก็ครอบเฉพาะของ User คนนั้นอยู่แล้ว และถ้า
-- เผลอมีแถวเก่าที่ transactions.user_id ไม่ตรงกับ assets.user_id (ข้อมูลเพี้ยนจาก
-- อดีต) การเพิ่มเงื่อนไขจะ "ลดยอดคงเหลือที่นับได้" → เปิดช่องขายเกินทันที
-- การรวมด้วย asset_id เพียงอย่างเดียวจึงเป็นทางที่รักษาพฤติกรรมเดิมไว้ครบ
-- (ถ้าต้องการรัดกุมกว่านี้ ต้องตรวจ/ล้างข้อมูลที่ไม่ตรงกันก่อน แล้วค่อยเพิ่ม
-- FK ผสม (asset_id, user_id) เป็นงานแยก)
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
  held_after      NUMERIC
)
LANGUAGE plpgsql
-- SECURITY DEFINER + REVOKE/GRANT ท้ายไฟล์ — เหตุผลเดียวกับ migration 034/035
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_held NUMERIC;
  v_new  public.transactions%ROWTYPE;
BEGIN
  -- ── 1) Lock แถว asset + ตรวจความเป็นเจ้าของในเงื่อนไขเดียวกัน ──────────────
  -- ⚠️ หัวใจของ Migration 036: `AND a.user_id = p_user_id` คือส่วนที่ 034 ขาดไป
  -- ตรวจเจ้าของ "ที่ชั้น Query เดียวกับที่ Lock" ไม่ใช่ SELECT มาแล้วค่อย IF เทียบ
  -- ทีหลัง (แบบหลังเปิดช่อง TOCTOU และลืมง่ายเวลาแก้โค้ดในอนาคต)
  PERFORM 1
     FROM public.assets a
    WHERE a.id = p_asset_id
      AND a.user_id = p_user_id
      FOR UPDATE;

  IF NOT FOUND THEN
    -- ครอบทั้ง "ไม่มี asset นี้จริง" และ "มีจริงแต่เป็นของคนอื่น" — แยกไม่ออกโดยเจตนา
    RAISE EXCEPTION 'ASSET_NOT_FOUND'
      USING ERRCODE = 'P0001', DETAIL = format('asset_id=%s', p_asset_id);
  END IF;

  -- ── 2) ยอดคงเหลือจริง ณ จุดที่ Lock แล้ว (เหมือน 034 ทุกตัวอักษร) ──────────
  SELECT COALESCE(SUM(CASE WHEN t.type = 'buy' THEN t.quantity ELSE -t.quantity END), 0)
    INTO v_held
    FROM public.transactions t
   WHERE t.asset_id = p_asset_id;

  -- ── 3) Guard ฝั่งขาย (เหมือน 034) ──────────────────────────────────────────
  IF p_type = 'sell' AND p_quantity > v_held THEN
    RAISE EXCEPTION 'INSUFFICIENT_QUANTITY'
      USING ERRCODE = 'P0001',
            DETAIL  = format('requested=%s;held=%s', p_quantity, v_held);
  END IF;

  -- ── 4) INSERT ในธุรกรรมเดียวกัน (เหมือน 034) ───────────────────────────────
  INSERT INTO public.transactions (
    user_id, asset_id, type, amount_thb, price_per_unit, quantity,
    currency, fee_thb, date, note, source
  ) VALUES (
    p_user_id, p_asset_id, p_type, p_amount_thb, p_price_per_unit, p_quantity,
    COALESCE(p_currency, 'THB'),
    COALESCE(p_fee_thb, 0),
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

-- ── สิทธิ์การเรียก ────────────────────────────────────────────────────────
-- CREATE OR REPLACE รักษา GRANT เดิมไว้อยู่แล้ว แต่ประกาศซ้ำให้ชัดและ Idempotent
-- (กันเคสที่ Function ถูก DROP+CREATE ใหม่ที่ไหนก็ตาม แล้ว PUBLIC ได้ EXECUTE
-- โดยปริยายกลับมา — ดูเหตุผลเต็มใน migration 034)
REVOKE ALL ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_transaction_locked(
  UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT
) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY หลัง Apply (รันก่อนถือว่าเสร็จ)
-- ═══════════════════════════════════════════════════════════════════════
-- ยืนยันว่า Definition ที่ Deploy จริงมีเงื่อนไขเจ้าของอยู่ (ไม่เชื่อว่า Apply แล้ว
-- = มีผลจริง ตาม AI_WORK_POLICY § 3 ข้อ 4):
--
--   SELECT pg_get_functiondef(oid) LIKE '%a.user_id = p_user_id%' AS has_owner_check
--     FROM pg_proc
--    WHERE proname = 'create_transaction_locked';
--   -- ต้องได้ has_owner_check = true
--
-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (บังคับตาม AI_WORK_POLICY § 4.5 — เขียนไว้ก่อน Apply)
-- ═══════════════════════════════════════════════════════════════════════
-- Migration นี้ **ไม่แก้ Schema และไม่แตะข้อมูลแม้แถวเดียว** (แทนที่ Function
-- อย่างเดียว) — Rollback = Apply ตัวเดิมจาก migration 034 ทับกลับ:
--
--   ขั้นที่ 1: รัน migrations/034_create_transaction_locked_rpc.sql ซ้ำทั้งไฟล์
--             (Idempotent — CREATE OR REPLACE) Function กลับไปเป็นรุ่นไม่ตรวจเจ้าของ
--   ขั้นที่ 2: Verify ด้วย Query VERIFY ด้านบน — ต้องได้ has_owner_check = false
--
-- ⚠️ ไม่ต้อง Revert Code ฝั่ง Node ทั้งขา Apply และขา Rollback:
-- transaction.repository.create() ส่ง p_user_id มาถูกอยู่แล้วตั้งแต่ 034 และ
-- Handle 'ASSET_NOT_FOUND' อยู่แล้ว — Function ทั้งสองรุ่นใช้ Signature และ
-- Error Code ชุดเดียวกันเป๊ะ จึงสลับไปมาได้โดยไม่มีช่วง Incompatible
--
-- ⚠️ สิ่งที่จะเสียไปเมื่อ Rollback: กลับไปไม่มีการตรวจเจ้าของ asset ที่ชั้น DB
-- (ความปลอดภัยกลับไปขึ้นกับวินัยของ Caller เหมือนเดิม) — ไม่มีข้อมูลสูญหาย
--
-- Migration นี้ Idempotent (CREATE OR REPLACE) — รันซ้ำได้ปลอดภัย
