-- ═══════════════════════════════════════════════════════════════════════
-- สำรวจผลกระทบ: รายการที่บันทึกจำนวนหุ้นจาก "ราคาตลาด" แทน "ราคาในสลิป"
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT ล้วน ไม่มีคำสั่งเขียน/ลบใดๆ — ปลอดภัยที่จะรันบน Production
--
-- ⚠️ รวมเป็น Query เดียวโดยเจตนา: Supabase SQL Editor แสดงผลของคำสั่งสุดท้าย
-- คำสั่งเดียว ถ้าแยกหลาย Statement จะเห็นแค่อันท้ายสุด
--
-- ⚠️ ผลที่คาดไว้ล่วงหน้า (จากการตรวจโค้ด):
--   • LINE (slip_ai) = ไม่ควรมีปัญหา (ocrPostback ส่ง qty+price อยู่แล้ว)
--   • เว็บที่มีสลิปแนบ = กลุ่มเสี่ยงจริง (เพิ่งขึ้น Production พร้อม 1b610cd)
--   ถ้าผลต่างจากนี้ ให้แจ้งกลับทันที = การวิเคราะห์โค้ดพลาดบางจุด
-- ═══════════════════════════════════════════════════════════════════════

WITH slip_tx AS (
  SELECT
    t.*,
    a.symbol,
    CASE
      WHEN t.source = 'slip_ai' THEN 'LINE (slip_ai)'
      WHEN t.source = 'web' AND t.slip_image_path IS NOT NULL THEN 'เว็บ (มีสลิปแนบ)'
      ELSE 'อื่นๆ'
    END AS ch,
    abs(t.created_at::date - t.date) AS gap
  FROM transactions t
  JOIN assets a ON a.id = t.asset_id
  WHERE t.note IS NULL OR t.note NOT LIKE 'UNDO_OF:%'
)

-- ── 1) ภาพรวมแยกตามช่องทาง ──────────────────────────────────────────────
SELECT
  '1. ภาพรวม'                                        AS หมวด,
  ch                                                 AS รายละเอียด,
  count(*)::text                                     AS จำนวน,
  count(DISTINCT user_id)::text || ' คน'             AS ผู้ใช้,
  min(created_at)::date::text || ' → ' || max(created_at)::date::text AS ช่วงเวลา
FROM slip_tx
WHERE ch <> 'อื่นๆ'
GROUP BY ch

UNION ALL

-- ── 2) กลุ่มเสี่ยง: วันที่ในรายการห่างจากวันที่บันทึกเกิน 1 วัน ──────────────
SELECT
  '2. กลุ่มเสี่ยง (ห่าง > 1 วัน)',
  ch,
  count(*)::text,
  count(DISTINCT user_id)::text || ' คน',
  'ห่างสูงสุด ' || max(gap)::text || ' วัน · เฉลี่ย ' || round(avg(gap), 1)::text || ' วัน'
FROM slip_tx
WHERE ch <> 'อื่นๆ' AND gap > 1
GROUP BY ch

UNION ALL

-- ── 3) รายการเสี่ยงรายใบ (เห็นตัวเลขจริงเพื่อตัดสินใจ) ─────────────────────
SELECT
  '3. รายใบ',
  ch || ' · ' || symbol,
  quantity::text || ' หน่วย',
  '@ ' || price_per_unit::text || ' ' || currency,
  'สลิป ' || date::text || ' · บันทึก ' || created_at::date::text
    || ' (ห่าง ' || gap::text || ' วัน) · ผู้ใช้ ' || left(user_id::text, 8)
FROM slip_tx
WHERE ch <> 'อื่นๆ' AND gap > 1

UNION ALL

-- ── 4) รายการหลัง Deploy 1b610cd (หาใบทดสอบของ Founder) ─────────────────
SELECT
  '4. หลัง Deploy 22 ส.ค.',
  coalesce(ch, '?') || ' · ' || symbol,
  quantity::text || ' หน่วย',
  '@ ' || price_per_unit::text || ' ' || currency,
  'สลิป ' || date::text || ' · บันทึก ' || to_char(created_at, 'DD/MM HH24:MI')
    || ' · ผู้ใช้ ' || left(user_id::text, 8)
FROM slip_tx
WHERE created_at >= '2026-08-22 12:34:00+00'

ORDER BY 1, 2;
