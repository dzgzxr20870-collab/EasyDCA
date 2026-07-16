-- ═══════════════════════════════════════════════════════════════════════
-- Migration 013 — line_webhook_events (Webhook Event Idempotency)
-- ═══════════════════════════════════════════════════════════════════════
-- LINE Messaging API ต้องได้ 200 OK เสมอ ไม่เช่นนั้นจะ Retry ส่ง Event เดิมซ้ำ
-- (webhook.routes.js) — ถ้า Server ช้า/Timeout/Crash หลังประมวลผล Event บางส่วน
-- ไปแล้วแต่ยังตอบ 200 ไม่ทัน LINE จะส่ง Event เดิมมาอีกครั้ง ซึ่งอาจสร้าง
-- Transaction ซ้ำถ้าไม่มีกลไกกันซ้ำระดับ Event
--
-- ตารางนี้เป็น "Claim ก่อนประมวลผล" (Pattern เดียวกับ pending_transactions
-- claimForConfirm — migration 001): พยายาม INSERT event_id ก่อนเริ่ม Logic ใดๆ
-- ถ้า INSERT สำเร็จ = Event นี้ยังไม่เคยถูกประมวลผล ถ้าชน UNIQUE (event_id ซ้ำ)
-- = เคยประมวลผลไปแล้ว ให้ข้ามทันที — event.webhookEventId เป็น Field ที่ LINE
-- แนบมากับทุก Event (message/postback/follow ฯลฯ) ต่างจาก event.message.id ที่มี
-- เฉพาะ Event ประเภทข้อความ
--
-- ไม่มี user_id/FK เพราะตารางนี้ตอบคำถามเดียว: "เคยเห็น event_id นี้มาก่อนไหม"
-- ไม่ต้องรู้ว่าเป็นของ User คนไหน — Retention 7 วัน (webhookEventCleanup.job.js)
-- เพียงพอมาก เพราะ Retry Window ของ LINE วัดเป็นนาที/ชั่วโมง ไม่ใช่วัน การเก็บ
-- 7 วันให้ Margin ปลอดภัยโดยไม่ให้ตารางบวมไม่จำกัด (Pattern เดียวกับ
-- bulk_import_sessions/pending_transactions ที่เป็น Working State ชั่วคราว
-- ไม่ใช่ Ledger จึงลบทิ้งได้อิสระตาม DATABASE.md § 8 ข้อยกเว้น)
--
-- อ้างอิงหลักการ: DATABASE.md § 10 (Index) — ไม่มี § 3 RLS/§ 4 updated_at
-- Trigger เพราะตารางนี้ไม่มีการ UPDATE เลย (Insert-then-purge เท่านั้น) และเข้าถึง
-- ผ่าน supabaseAdmin (service role) เท่านั้นเช่นเดียวกับตารางอื่นทั้งหมด
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE line_webhook_events (
  -- event.webhookEventId จาก LINE ตรงๆ — เป็นทั้ง Primary Key และตัว Claim
  -- (INSERT ... ON CONFLICT (event_id) DO NOTHING แล้วเช็คว่า INSERT ได้จริงไหม)
  event_id     TEXT        PRIMARY KEY,

  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Index (§ 10) — Purge Job กวาดหา Event เก่ากว่า Retention Cutoff ────────
-- (PRIMARY KEY อยู่ที่ event_id ไม่ใช่ received_at จึงไม่มี Index นี้ให้อัตโนมัติ)
CREATE INDEX idx_line_webhook_events_received_at ON line_webhook_events(received_at);

ALTER TABLE line_webhook_events ENABLE ROW LEVEL SECURITY;
-- ไม่มี Policy สำหรับ authenticated/anon — เข้าถึงได้เฉพาะ service_role เท่านั้น
-- (Pattern เดียวกับ audit_logs/system_logs — ดู DATABASE.md § 3)