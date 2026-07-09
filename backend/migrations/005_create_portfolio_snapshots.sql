-- ═══════════════════════════════════════════════════════════════════════
-- Migration 005 — portfolio_snapshots
-- ═══════════════════════════════════════════════════════════════════════
-- Phase 2 (Round 6): เก็บ Snapshot มูลค่าพอร์ตของทุก User ทุกวันผ่าน Scheduled
-- Job (PROJECT_BRIEF § 7 Phase 2 — "Portfolio Snapshot") เพื่อรองรับกราฟ "มูลค่า
-- พอตตามราคาตลาด" ในอนาคต โดยไม่ต้องคำนวณย้อนหลัง (Dashboard ยังติดป้าย "เร็วๆ นี้"
-- ต่อไปจนกว่าจะสะสมข้อมูลได้พอ)
--
-- Migration นี้ทำแค่ "Schema" — Repository/Cron ที่เขียนตารางนี้อยู่ในไฟล์แยก
-- (portfolioSnapshot.repository.js / portfolioSnapshot.job.js) รอบเดียวกัน
--
-- portfolio_snapshots — 1 แถวต่อ (user, วัน) เก็บมูลค่าพอต ณ วันนั้นแบบ Immutable
-- ต่อวัน (UNIQUE กัน Cron รันซ้ำในวันเดียวกันสร้างข้อมูลซ้ำ — Job ใช้ upsert)
--
-- อ้างอิงหลักการ: DATABASE.md § 3 (RLS), § 9 (FK RESTRICT), § 10 (Index)
-- ═══════════════════════════════════════════════════════════════════════

-- ── portfolio_snapshots ────────────────────────────────────────────────
CREATE TABLE portfolio_snapshots (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK → users: RESTRICT ตาม § 9 (ห้ามลบ user ที่ยังมีข้อมูลผูกอยู่)
  user_id               UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- วันของ Snapshot (ชนิด DATE — อิงวันตามเขตเวลา Asia/Bangkok ที่ Cron ส่งมา)
  snapshot_date         DATE          NOT NULL,

  -- เงินต้นสุทธิรวมทั้งพอต ณ วันนั้น (Σ buy − Σ sell) — คำนวณได้เสมอจากธุรกรรม
  -- จึง NOT NULL (ตรงกับ portfolio.service.getPortfolioSummary().totalInvested)
  total_invested        NUMERIC       NOT NULL,

  -- มูลค่าตลาดรวม / กำไร-ขาดทุนรวม ของเฉพาะ Holding ที่ "มีข้อมูล Profit จริง"
  -- (มี Price Feed) — NULL ได้ กรณีไม่มี Holding ไหนมีข้อมูล Profit เลย (เช่น
  -- พอตหุ้นไทยล้วนที่ยังไม่มี Price Feed) ตาม Pattern aggregatedProfit ฝั่ง Dashboard
  total_current_value   NUMERIC,
  total_profit_loss     NUMERIC,

  -- จำนวน Holding ที่ไม่มีข้อมูล Profit (ถูกข้ามตอนรวมยอด) — เก็บไว้เผื่อ Debug/
  -- แสดงผลอนาคตว่าตัวเลขนี้ไม่ครบทุก Asset
  excluded_asset_count  INTEGER       NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- กัน Cron รันซ้ำในวันเดียวกัน (เช่น Restart ระหว่างวัน) สร้างแถวซ้ำ — Job ใช้
  -- upsert (ON CONFLICT DO UPDATE) เขียนทับค่าเดิมของวันนั้นแทนการ Insert ซ้ำ
  UNIQUE (user_id, snapshot_date)
);

-- ── Index (§ 10) ───────────────────────────────────────────────────────
-- Query หลัก: "Snapshot ของ user นี้ เรียงตามวัน" (ดึงมาเสียบกราฟ Portfolio Replay)
CREATE INDEX idx_portfolio_snapshots_user_date
  ON portfolio_snapshots (user_id, snapshot_date);

-- ── Row Level Security (§ 3) — service_role เท่านั้น ────────────────────
-- Pattern เดียวกับ payments/pending_transactions: เปิด RLS แต่ไม่มี Policy สำหรับ
-- authenticated/anon — Backend เข้าถึงผ่าน supabaseAdmin (service role) เท่านั้น
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
