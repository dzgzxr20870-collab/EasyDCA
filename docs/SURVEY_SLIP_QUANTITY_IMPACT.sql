-- ═══════════════════════════════════════════════════════════════════════
-- สำรวจผลกระทบ: รายการที่บันทึกจากสลิปแล้วจำนวนหน่วยอาจคลาดเคลื่อน
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ ทุก Query ในไฟล์นี้เป็น SELECT ล้วน — ไม่มี INSERT/UPDATE/DELETE ใดๆ
-- ปลอดภัยที่จะรันบน Production (อ่านอย่างเดียว ไม่แตะข้อมูล)
--
-- บริบท: transactions เป็น Immutable Ledger — ห้ามแก้/ลบเด็ดขาด ถ้าต้องแก้ต้องใช้
-- Reversal เท่านั้น (DATABASE.md § 8) ไฟล์นี้ใช้ "ประเมินขนาดปัญหา" ก่อนตัดสินใจ
--
-- นิยามที่ใช้:
--   source='slip_ai'                    = บันทึกผ่าน LINE จากสลิป (AI อ่าน)
--   source='web' AND slip_image_path IS NOT NULL = บันทึกผ่านเว็บโดยมีสลิปแนบ
--   รายการ Reversal (note ขึ้นต้น 'UNDO_OF:') ถูกกรองออกทุก Query
--
-- ⚠️ ผลสำรวจที่คาดไว้ล่วงหน้า (จากการตรวจโค้ด — ดูรายงาน):
--   • กลุ่ม LINE (slip_ai) "ไม่ควรมีปัญหา" เพราะ ocrPostback ส่ง qty+price อยู่แล้ว
--   • กลุ่มเว็บที่มีสลิป "คือกลุ่มเสี่ยงจริง" (เพิ่งขึ้น Production พร้อม 1b610cd)
--   ถ้าผลออกมาต่างจากนี้ ให้แจ้งกลับทันที แปลว่าการวิเคราะห์โค้ดพลาดบางจุด
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1) ภาพรวม: มีรายการจากสลิปกี่รายการ ของผู้ใช้กี่ราย ────────────────────
SELECT
  CASE
    WHEN source = 'slip_ai' THEN 'LINE (slip_ai)'
    WHEN source = 'web' AND slip_image_path IS NOT NULL THEN 'เว็บ (มีสลิปแนบ)'
    ELSE 'อื่นๆ (ไม่ได้มาจากสลิป)'
  END AS ช่องทาง,
  count(*)                  AS จำนวนรายการ,
  count(DISTINCT user_id)   AS จำนวนผู้ใช้,
  min(created_at)::date     AS บันทึกครั้งแรก,
  max(created_at)::date     AS บันทึกล่าสุด
FROM transactions
WHERE note IS NULL OR note NOT LIKE 'UNDO_OF:%'
GROUP BY 1
ORDER BY 2 DESC;


-- ── 2) กลุ่มเสี่ยงสูงสุด: วันที่ในรายการห่างจากวันที่บันทึกจริงเกิน 1 วัน ──────
-- ยิ่งห่างมาก = ราคาตลาดตอนกดบันทึกยิ่งต่างจากราคาในสลิป = ยิ่งคลาดเคลื่อนมาก
SELECT
  CASE
    WHEN source = 'slip_ai' THEN 'LINE (slip_ai)'
    ELSE 'เว็บ (มีสลิปแนบ)'
  END                                              AS ช่องทาง,
  symbol,
  type                                             AS ประเภท,
  date                                             AS วันที่ในรายการ,
  created_at::date                                 AS วันที่บันทึกจริง,
  (created_at::date - date)                        AS ห่างกี่วัน,
  quantity                                         AS จำนวนหน่วยที่บันทึก,
  price_per_unit                                   AS ราคาต่อหน่วยที่บันทึก,
  amount_thb                                       AS ยอดรวม,
  currency                                         AS สกุล,
  left(user_id::text, 8)                           AS ผู้ใช้
FROM transactions
WHERE (note IS NULL OR note NOT LIKE 'UNDO_OF:%')
  AND (source = 'slip_ai' OR (source = 'web' AND slip_image_path IS NOT NULL))
  AND abs(created_at::date - date) > 1
ORDER BY abs(created_at::date - date) DESC, created_at DESC;


-- ── 3) รายการทั้งหมดที่เกิดหลัง Deploy 1b610cd (2026-08-22 12:34 UTC) ────────
-- ใช้ดูว่ามี "รายการทดสอบของ Founder" ติดอยู่กี่ใบ จะได้ตัดสินใจว่าจะย้อนหรือปล่อย
SELECT
  symbol,
  type                                   AS ประเภท,
  source                                 AS ช่องทาง,
  CASE WHEN slip_image_path IS NOT NULL THEN 'มี' ELSE 'ไม่มี' END AS มีสลิป,
  date                                   AS วันที่ในรายการ,
  created_at                             AS เวลาบันทึก,
  (created_at::date - date)              AS ห่างกี่วัน,
  quantity                               AS จำนวนหน่วย,
  price_per_unit                         AS ราคาต่อหน่วย,
  amount_thb                             AS ยอดรวม,
  currency                               AS สกุล,
  left(user_id::text, 8)                 AS ผู้ใช้
FROM transactions
WHERE created_at >= '2026-08-22 12:34:00+00'
  AND (note IS NULL OR note NOT LIKE 'UNDO_OF:%')
ORDER BY created_at DESC;


-- ── 4) ประเมินขนาดความคลาดเคลื่อน (เฉพาะกลุ่มเสี่ยง) ────────────────────────
-- ⚠️ ประเมินได้เฉพาะ "ช่วงเวลาที่ห่าง" เท่านั้น — ระบบไม่ได้เก็บ "ราคาที่สลิประบุ"
-- ไว้ที่ไหนเลยเมื่อเส้นทางนั้นทิ้งค่าไป จึงเทียบตรงๆ ไม่ได้ว่าคลาดเคลื่อนกี่ %
-- ต้องเปิดรูปสลิปต้นฉบับ (slip_image_path) มาเทียบด้วยตาเท่านั้น
SELECT
  count(*)                                  AS รายการเสี่ยงทั้งหมด,
  count(DISTINCT user_id)                   AS ผู้ใช้ที่ได้รับผลกระทบ,
  max(abs(created_at::date - date))          AS ห่างมากสุด_วัน,
  round(avg(abs(created_at::date - date)),1) AS ห่างเฉลี่ย_วัน,
  count(*) FILTER (WHERE slip_image_path IS NOT NULL) AS มีรูปสลิปให้เทียบย้อนหลังได้
FROM transactions
WHERE (note IS NULL OR note NOT LIKE 'UNDO_OF:%')
  AND (source = 'slip_ai' OR (source = 'web' AND slip_image_path IS NOT NULL))
  AND abs(created_at::date - date) > 1;


-- ── 5) เช็คว่ามี Reversal ที่ทำไปแล้วไหม (ผู้ใช้แก้เองไปแล้วหรือยัง) ─────────
SELECT count(*) AS จำนวน_reversal_ทั้งหมด
FROM transactions
WHERE note LIKE 'UNDO_OF:%';
