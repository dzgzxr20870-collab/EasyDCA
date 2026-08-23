# DESIGN — Multi-Portfolio · Broker · Sector · Dividend

> **สถานะ: DRAFT — รออนุมัติจาก Founder ยังไม่ Implement**
> เอกสารนี้เขียนตามกฎเหล็ก `AI_CONTEXT.md` ข้อ 3 ("ห้ามเขียนโค้ดที่ยังไม่ได้
> ออกแบบ Architecture") — ต้องผ่านการ Review และตอบ **Open Questions § 8**
> ให้ครบก่อน จึงจะเขียน Migration/Endpoint จริงได้
>
> Branch: `feat/dashboard-production-wire` · วันที่: 23 ส.ค. 2569
> Model: Opus (ตาม `AI_WORK_POLICY.md` § 1 — งานแตะ Ledger การเงิน)

---

## 0. ที่มาของงาน

หน้า Portfolio ในดีไซน์ Demo (`demo/multipage-ux-redesign` →
`frontend/src/pages/demo/DemoPortfolio.jsx`, `frontend/src/lib/demo/mockData.js`)
ใช้ 4 ฟีเจอร์ที่ **Backend ไม่มีจริงเลยแม้แต่ตัวเดียว**:

| ฟีเจอร์ | สถานะ Backend วันนี้ |
|---|---|
| Broker Allocation | ❌ ไม่มี column/table ใดๆ เก็บโบรกเกอร์ |
| Sector Allocation | ❌ ไม่มี column/table ใดๆ เก็บ Sector |
| Multi-portfolio (สลับพอร์ต) | ⚠️ มี `portfolio_id` ใน DB แต่ **ไม่มี Endpoint** (ดู § 1) |
| Transaction type `dividend` | ❌ DB CHECK บังคับแค่ `('buy','sell')` |

Founder ตัดสินใจ: **เอาครบทั้ง 4 ไม่ตัดออก** → งานขยายจาก "ต่อ UI"
เป็น "ออกแบบ + สร้าง Backend Schema ใหม่"

> ⚠️ **ห้าม merge `demo/multipage-ux-redesign` เข้า `main` ตรงๆ เด็ดขาด** —
> branch นั้นแยกจาก main ไปนาน (main เดินหน้าไป 24 commits รวม Slip OCR /
> มาสคอต) การ merge ตรงๆ จะลบงาน Production ทิ้ง ต้องยกเฉพาะ Component
> ที่ต้องการมาทีละชิ้นบน branch ใหม่เท่านั้น

---

## 1. ผลการสืบ Migration History เรื่อง `portfolio_id`

**สรุป: `portfolio_id` ไม่เคยถูกเพิ่มด้วย Migration ใดๆ เลย — มันมาพร้อม
Base Schema ตั้งแต่วันแรก และถูก "ออกแบบเผื่อไว้" แต่ไม่เคยถูกเปิดใช้**

หลักฐานจาก `grep -rn portfolio_id backend/migrations/`:

| Migration | สิ่งที่พบ | ความหมาย |
|---|---|---|
| `001_create_pending_transactions.sql:27` | `portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL` | Migration **แรกสุด** อ้าง FK ไป `portfolios` ได้เลย → แปลว่าตาราง `portfolios` **มีอยู่ก่อน** migration 001 แล้ว |
| `001:24-25` | Comment: *"FK → portfolios: SET NULL ตาม § 9 (ผู้ใช้ลบพอร์ตได้ ไม่ควรถูกบล็อคเพราะมี Pending ค้าง — เหตุผลเดียวกับ `assets.portfolio_id`)"* | ยืนยันว่า `assets.portfolio_id` มีอยู่แล้วตอนนั้น |
| `001:98-101` | `CREATE INDEX ... WHERE portfolio_id IS NOT NULL` + Comment *"Free Plan portfolio_id = NULL เป็นส่วนใหญ่"* | **นี่คือคำตอบว่าทำไมมี column แต่ไม่มี endpoint** — ออกแบบไว้ว่า Multiple Portfolio เป็นฟีเจอร์ **Premium** ส่วน Free ปล่อย NULL ทิ้งไว้ แล้ว Phase 1 ทำแค่ Free-path จนจบ ฟีเจอร์ Premium เลยค้างเป็น dead column |
| `014_fix_assets_null_unique_constraint.sql` | เปลี่ยนเป็น `UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id)` | Comment ระบุตรงๆ: *"กรณีส่วนใหญ่ในระบบวันนี้ — Free-tier ไม่มี portfolio"* → **ยืนยันว่า production วันนี้ `portfolio_id` เป็น NULL แทบ 100%** |
| `035_create_asset_locked_rpc.sql:54,111` | RPC รับ `p_portfolio_id` และ INSERT ลง column จริง | ทาง Write **รองรับอยู่แล้ว** แค่ไม่มีใครส่งค่าที่ไม่ใช่ NULL เข้ามา |

**สิ่งที่ตามมาเป็นหนี้เทคนิค 2 ข้อ:**

1. **ตาราง `portfolios` ไม่มีไฟล์ Migration** — มันถูกสร้างจาก DDL ใน
   `docs/DATABASE.md § 127-156` โดยตรงบน Supabase ตอนตั้งโปรเจกต์
   (ก่อนเริ่มระบบ migration ที่ไฟล์ 001) → **Action ก่อนเริ่มงานจริง:
   ต้องเข้า Supabase ยืนยันด้วยตาว่าตาราง `portfolios` มีอยู่จริงและ
   โครงสร้างตรงกับ `DATABASE.md` หรือไม่ ห้ามสมมติเอาจากเอกสาร**
   (ตามคำเตือนใน `CLAUDE.md`: อย่าเชื่อคำว่า "ปิดแล้ว" ในเอกสาร 100%)
2. **`docs/API.md § 14.2` มี Spec ของ 5 Endpoint `/api/v1/portfolios`
   เขียนไว้ครบแล้ว** (GET list / POST / GET id / PATCH / DELETE)
   แต่ **ไม่มีโค้ดจริง** — Spec กับ Reality ไม่ตรงกันมาตั้งแต่ Phase 1
   → งานนี้คือ "ทำให้ § 14.2 เป็นจริง" ไม่ใช่ "ออกแบบใหม่จากศูนย์"

**เลข Migration ล่าสุดจริงในโฟลเดอร์ = `041_allow_null_fee_thb.sql`
→ Migration ถัดไปเริ่มที่ `042`**

---

## 2. ⚠️ ความเสี่ยงสูงสุดของงานนี้: `dividend` ทำ Ledger เพี้ยนเงียบๆ

**นี่คือหัวข้อที่ต้องอ่านก่อนหัวข้ออื่นทั้งหมด**

โค้ดคำนวณเงินทั้งระบบวันนี้ตั้งอยู่บนสมมติฐานว่า **transaction type
มีแค่ 2 ค่า** จึงเขียนแบบ binary (`buy` หรือ *"ไม่ใช่ buy"*) ไม่ใช่
enumerate ครบทุกค่า — วินาทีที่ `dividend` เข้า DB ได้ ทุกจุดข้างล่างนี้
จะ **ตีความ `dividend` เป็น `sell` ทันทีโดยไม่มี Error ใดๆ**:

| ไฟล์:บรรทัด | โค้ด | ผลถ้ามี dividend |
|---|---|---|
| `backend/src/services/transaction.service.js:392` | `return tx.type === 'buy' ? sum + qty : sum - qty;` | **จำนวนที่ถือหายไป** เท่ากับ quantity ของ dividend |
| `backend/src/services/portfolio.service.js:46-72` | `if (t.type === 'buy') {...} else { /* คำนวณ realizedPnL, ตัด costBasis */ }` | **ต้นทุนถูกตัดทิ้ง + กำไรที่รับรู้แล้วเพี้ยน** |
| `migrations/041_allow_null_fee_thb.sql:130` (และ 034, 036 — RPC เวอร์ชันก่อนหน้า) | `SUM(CASE WHEN t.type = 'buy' THEN t.quantity ELSE -t.quantity END)` | **ระดับ DB** — Guard `INSUFFICIENT_QUANTITY` คำนวณผิด |
| `backend/src/utils/flexMessage.util.js:726` | `const isBuy = tx.type === 'buy';` | LINE แสดง dividend ว่า **"ขาย"** |
| `backend/src/services/reportExport.service.js:529,698-699` | `tx.type === 'buy' ? 'ซื้อ' : 'ขาย'` | Excel/PDF Export ผิด |
| `backend/src/controllers/transactions.controller.js:613` | `result.originalType === 'buy' ? 'ซื้อ' : 'ขาย'` | ข้อความ Undo ผิด |
| `backend/src/services/dcaStats.service.js:47` | `tx.type === 'buy' && ...` | ✅ ปลอดภัย (filter เฉพาะ buy อยู่แล้ว) |

**กฎบังคับของงานนี้ (ห้ามต่อรอง):**

> **Migration ที่ผ่อน CHECK constraint ให้รับ `dividend` ต้องเป็น Migration
> สุดท้ายของทั้ง Feature Set นี้ และต้องอยู่ใน commit เดียวกับที่แก้ทุกจุด
> ในตารางข้างบนให้ enumerate type ครบทุกค่าแล้ว**

วิธีบังคับให้ "ลืมไม่ได้" — เปลี่ยนจาก binary เป็น exhaustive switch ที่
`default: throw` ตั้งแต่ก่อนเปิด constraint จะทำให้ type ใหม่ที่หลุดมา
**พังดังทันที** แทนที่จะคำนวณเงินผิดเงียบๆ (สอดคล้องกฎ "ห้าม Silent
Default" ใน `utils/ownership.util.js`)

**Regression Test ที่ต้องพิสูจน์ Red-Green จริง** (`AI_WORK_POLICY.md` § 3):
สร้าง fixture `buy 10 หุ้น → dividend → sell 10 หุ้น` แล้วยืนยันว่า
`heldQty = 0` และ `costBasis` ไม่ติดลบ — **ต้องถอด fix ออกแล้วเห็นแดงจริง
ก่อน** ถึงจะนับว่าผ่าน

---

## 3. Schema ใหม่ (Migration 042 → 046)

### 3.1 Migration 042 — `brokers` + `assets.broker_id`

```sql
-- 042_create_brokers.sql
CREATE TABLE brokers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX idx_brokers_user_id ON brokers(user_id);

ALTER TABLE assets
  ADD COLUMN broker_id UUID REFERENCES brokers(id) ON DELETE SET NULL;
CREATE INDEX idx_assets_broker_id ON assets(broker_id) WHERE broker_id IS NOT NULL;
```

**เหตุผลเชิงออกแบบ:**
- **`brokers` เป็นตาราง per-user ไม่ใช่ Master List กลาง** — โบรกที่คนไทย
  ใช้มีทั้ง Bitkub / Binance / InnovestX / Dime / Webull / ธนาคาร ฯลฯ
  ถ้าทำ Master List กลาง จะกลายเป็นงานดูแล catalog ตลอดไป และผู้ใช้ที่ใช้
  โบรกนอกลิสต์จะกรอกไม่ได้เลย → ให้ user สร้างเองแล้วค่อยดู Analytics
  ทีหลังว่าชื่อไหนซ้ำบ่อยจน "ควร" ทำ Master List (**ดู Open Question § 8.2**)
- **`ON DELETE SET NULL` ไม่ใช่ CASCADE** — ลบโบรกไม่ควรลบสินทรัพย์ทิ้ง
  (กฎเหล็ก "ห้ามลบข้อมูลผู้ใช้") ตรงกับ Pattern เดียวกับ
  `assets.portfolio_id` ใน `DATABASE.md § 9`
- **ผูก broker ที่ระดับ `assets` ไม่ใช่ `transactions`** — Demo UI ทำ
  "Broker Allocation" = สัดส่วนมูลค่าพอร์ตแยกตามโบรก ซึ่งคำนวณจาก
  *สินทรัพย์ที่ถืออยู่* ไม่ใช่ประวัติธุรกรรม การผูกที่ transaction
  จะทำให้สินทรัพย์ก้อนเดียวกระจายข้ามโบรกแล้วรวมยอดไม่ได้
  (**ข้อจำกัดที่ยอมรับ**: ถือ BTC ที่ Bitkub และ Binance พร้อมกัน
  จะต้องเป็น asset 2 แถว — ซึ่ง `UNIQUE (user_id, symbol, portfolio_id)`
  ปัจจุบัน **ไม่อนุญาต** → **ดู Open Question § 8.3**)

### 3.2 Migration 043 — `assets.sector`

```sql
-- 043_add_sector_to_assets.sql
ALTER TABLE assets ADD COLUMN sector TEXT;
CREATE INDEX idx_assets_sector ON assets(sector) WHERE sector IS NOT NULL;
```

**เหตุผล: เลือก column ธรรมดา ไม่ทำตาราง `sectors`**
- Sector เป็น **แอตทริบิวต์ของสินทรัพย์** ไม่ใช่ entity ที่ user เป็นเจ้าของ
  และไม่มีข้อมูลอื่นห้อยอยู่ (ไม่มี created_at/settings ของ sector)
  → ทำตารางแยกจะได้แค่ JOIN เพิ่มโดยไม่ได้อะไรกลับมา
- **ไม่ใส่ CHECK constraint จำกัดค่า** ในรอบแรก เพราะ taxonomy ของ Sector
  ต่างกันตามประเภทสินทรัพย์ (หุ้นไทยใช้ SET Industry Group / คริปโตใช้
  DeFi-L1-Meme / กองทุนใช้ประเภท AIMC) การล็อกค่าเร็วเกินไปจะบล็อกตัวเอง
- Normalize ที่ Application Layer (trim + Title Case) พอ

### 3.3 Migration 044 — เปิดใช้ Multi-portfolio

```sql
-- 044_enable_multi_portfolio.sql
-- ⚠️ Pre-condition: ยืนยันบน Supabase ก่อนว่าตาราง portfolios มีจริงและตรง DATABASE.md § 3.2
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- พอร์ต Default ได้ 1 อันต่อ user เท่านั้น
CREATE UNIQUE INDEX idx_portfolios_one_default_per_user
  ON portfolios(user_id) WHERE is_default = TRUE;

-- Backfill: ทุก user ที่มีสินทรัพย์อยู่แล้วต้องได้พอร์ต Default อัตโนมัติ
INSERT INTO portfolios (user_id, name, type, is_default)
SELECT DISTINCT a.user_id, 'พอร์ตหลัก', 'mixed', TRUE
FROM assets a
WHERE NOT EXISTS (SELECT 1 FROM portfolios p WHERE p.user_id = a.user_id AND p.is_default);

-- ย้ายสินทรัพย์ที่ยังไม่มีพอร์ต เข้าพอร์ต Default ของเจ้าของ
UPDATE assets a SET portfolio_id = p.id
FROM portfolios p
WHERE a.portfolio_id IS NULL AND p.user_id = a.user_id AND p.is_default = TRUE;
```

**⚠️ จุดที่ต้องระวังที่สุดใน migration นี้:** `assets` มี
`UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id)` จาก Migration
014 — การ UPDATE `portfolio_id` จาก NULL → uuid **ไม่ทำให้ชนกันเพิ่ม**
(เพราะ NULLS NOT DISTINCT ถือว่า NULL ชนกันอยู่แล้ว การย้ายไป uuid เดียวกัน
ทั้งหมดจึงให้ผลเท่าเดิมพอดี) — **แต่ต้องรัน SELECT COUNT ยืนยันจำนวนแถวก่อน
และหลังให้เท่ากันจริงบน Staging ก่อนแตะ Production**

### 3.4 Migration 045 — Backfill Guard (แยกไฟล์โดยตั้งใจ)

Migration ตรวจสอบผลลัพธ์ 044 อย่างเดียว ไม่แก้ข้อมูล — ถ้าพบ
`assets.portfolio_id IS NULL` เหลืออยู่ ให้ `RAISE EXCEPTION` เพื่อ
**บล็อกไม่ให้ deploy ต่อ** แยกไฟล์เพราะถ้ารวมกับ 044 แล้วพัง จะไม่รู้ว่าพัง
ที่ขั้นย้ายข้อมูลหรือขั้นตรวจ

### 3.5 Migration 046 — เปิด `dividend` (ทำเป็นลำดับสุดท้าย)

```sql
-- 046_add_dividend_transaction_type.sql
-- ⚠️ ห้ามรัน migration นี้ก่อนที่ทุกจุดใน § 2 จะถูกแก้และ merge แล้ว
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('buy', 'sell', 'dividend', 'dividend_reversal'));

-- + DROP/CREATE RPC create_transaction_locked ใหม่ (ต่อจากเวอร์ชัน 041)
--   เปลี่ยน CASE WHEN t.type='buy' THEN q ELSE -q END
--   → CASE t.type WHEN 'buy' THEN q WHEN 'sell' THEN -q ELSE 0 END
--   (dividend/dividend_reversal ไม่กระทบจำนวนที่ถือ)
```

---

## 4. Endpoint ใหม่ (ตาม Pattern `docs/API.md`)

### 4.1 Portfolios — ทำ `API.md § 14.2` ที่มี Spec อยู่แล้วให้เป็นจริง

| Method | Path | Auth | Plan | หมายเหตุ |
|---|---|---|---|---|
| GET | `/api/v1/portfolios` | ✅ | Free | Free เห็นได้ 1 พอร์ต (Default) เสมอ ไม่ควร 403 เพราะ UI ต้องใช้ render |
| POST | `/api/v1/portfolios` | ✅ | Premium | Body `{ name, type }` |
| GET | `/api/v1/portfolios/{id}` | ✅ | Free | |
| PATCH | `/api/v1/portfolios/{id}` | ✅ | Premium | แก้ `name` / `type` |
| DELETE | `/api/v1/portfolios/{id}` | ✅ | Premium | ห้ามลบพอร์ต `is_default = TRUE` → `409 CANNOT_DELETE_DEFAULT_PORTFOLIO` |

**เปลี่ยนจาก Spec เดิมของ § 14.2 หนึ่งจุด:** เดิมเขียนว่า GET เป็น Premium
— ควรเป็น **Free** เพราะหลัง Migration 044 ผู้ใช้ Free ทุกคนจะมีพอร์ต
Default 1 อัน ถ้า GET คืน 403 หน้า Dashboard ของ Free จะพังทันที
(ตัวคุมสิทธิ์ที่แท้จริงคือ POST ที่สร้างพอร์ตที่ 2 ไม่ได้)

**Response (GET list):**
```json
{ "success": true, "data": { "portfolios": [
  { "id": "uuid", "name": "พอร์ตหลัก", "type": "mixed",
    "isDefault": true, "assetCount": 5, "totalValueThb": 152340.50 }
] } }
```

**Error:** `403 PREMIUM_REQUIRED` · `404 PORTFOLIO_NOT_FOUND` ·
`409 PORTFOLIO_NAME_EXISTS` · `409 CANNOT_DELETE_DEFAULT_PORTFOLIO` ·
`403 PORTFOLIO_LIMIT_REACHED` (ขึ้นกับคำตอบ § 8.1)

### 4.2 Brokers

| Method | Path | Auth | Plan | หมายเหตุ |
|---|---|---|---|---|
| GET | `/api/v1/brokers` | ✅ | Free | List โบรกของ user |
| POST | `/api/v1/brokers` | ✅ | Free | Body `{ name }` |
| PATCH | `/api/v1/brokers/{id}` | ✅ | Free | เปลี่ยนชื่อ |
| DELETE | `/api/v1/brokers/{id}` | ✅ | Free | Asset ที่ผูกอยู่ → `broker_id = NULL` |

**Error:** `409 BROKER_NAME_EXISTS` · `404 BROKER_NOT_FOUND` ·
`400 VALIDATION_ERROR` (ชื่อว่าง / ยาวเกิน 60 ตัวอักษร)

### 4.3 Allocation (ข้อมูลที่หน้า Demo Portfolio ต้องใช้จริง)

| Method | Path | Auth | Plan | หมายเหตุ |
|---|---|---|---|---|
| GET | `/api/v1/portfolio/allocation?groupBy=broker\|sector\|assetType&portfolioId=` | ✅ | Free | คืนสัดส่วนพร้อมใช้กับกราฟโดนัท |

```json
{ "success": true, "data": { "groupBy": "broker", "totalValueThb": 152340.50,
  "groups": [
    { "key": "uuid-หรือ-null", "label": "Bitkub", "valueThb": 91404.30, "percent": 60.0, "assetCount": 3 },
    { "key": null, "label": "ไม่ระบุ", "valueThb": 60936.20, "percent": 40.0, "assetCount": 2 }
  ] } }
```

**กฎบังคับของ Endpoint นี้ (Single Source of Truth ต่อ 1 สูตรเงิน —
กฎยืนข้อ 1):** `totalValueThb` **ต้องเรียกใช้ `portfolio.service.js` ตัวเดิม
ที่ `/portfolio/summary` ใช้อยู่** ห้ามเขียนสูตรรวมมูลค่าใหม่ในไฟล์
allocation เด็ดขาด — ไม่งั้นวันหนึ่งเลขบนการ์ดสรุปกับเลขบนโดนัทจะไม่ตรงกัน
แล้วหาสาเหตุไม่เจอ

### 4.4 Assets — ขยายของเดิม (ไม่ใช่ Endpoint ใหม่)

`PATCH /api/v1/assets/{id}` เพิ่มรับ `brokerId`, `sector`, `portfolioId`
`GET /api/v1/assets` เพิ่ม filter `brokerId`, `sector`

### 4.5 Dividend

| Method | Path | Auth | Plan | หมายเหตุ |
|---|---|---|---|---|
| POST | `/api/v1/transactions/dividend` | ✅ | Free | Body `{ assetId, amountThb, date, quantity?, note? }` |

**Error:** `404 ASSET_NOT_FOUND` · `400 VALIDATION_ERROR` ·
`403 NOTHING_TO_RECEIVE_DIVIDEND` (ไม่ถือสินทรัพย์นี้ ณ วันที่ระบุ)

**แยก Endpoint ออกจาก `POST /transactions` โดยตั้งใจ** — Payload ของ
dividend ต่างกันเชิงความหมาย (ไม่มีราคาต่อหน่วย, `quantity` เป็น optional)
การยัดเข้า endpoint เดิมจะทำให้ validation กลายเป็น if-else ตาม type
ซึ่งเป็นจุดที่พลาดง่ายที่สุดบนเส้นทางเงิน

---

## 5. Immutable Ledger — `dividend` เข้ากับกฎ "ห้าม DELETE/UPDATE" ยังไง

### 5.1 Pattern ที่ระบบใช้อยู่วันนี้

`backend/src/services/undoTransaction.service.js` **ไม่เคยลบหรือแก้แถวเดิม**
— มันสร้างแถวใหม่ที่หักล้างกัน แล้วเก็บร่องรอยไว้ใน `note`:

- `UNDO_MARKER = 'UNDO_OF'` → note ของแถวหักล้าง = `UNDO_OF:<id ต้นฉบับ>`
- `reversalType = latest.type === 'buy' ? 'sell' : 'buy'` (บรรทัด 121)
- `isReversal()` / `parseReversedId()` ใช้กัน Double-Undo และตัดคู่หักล้าง
  ออกจาก **สถิติ** (`excludeUndoneTransactions`)
- **สำคัญ**: `portfolio.service` / `profit.service` ยัง Replay **ทุกแถวรวม
  Reversal** ตามเดิม — Reversal คือแถวจริงใน Ledger ที่ต้องนับ ไม่ใช่แถวผี

### 5.2 Flow เต็มของ Undo Dividend (ใช้ Pattern เดียวกันเป๊ะ)

```
[1] ผู้ใช้กด "ยกเลิกล่าสุด" ขณะที่แถวล่าสุดคือ type='dividend'

[2] undoTransaction.service ตรวจ isReversal(latest)
    → ถ้า note ขึ้นต้น 'UNDO_OF:' แล้ว = 409 ALREADY_REVERSED (กัน Double-Undo)

[3] หาชนิดแถวหักล้างจาก REVERSAL_TYPE_MAP (แทนที่ ternary บรรทัด 121):
      buy               → sell
      sell              → buy
      dividend          → dividend_reversal
      dividend_reversal → *** ห้ามเกิด *** (ถูกดักที่ [2] แล้ว)
      default           → throw UNSUPPORTED_REVERSAL_TYPE   ← ห้าม Silent Default

[4] INSERT แถวใหม่ (ไม่แตะแถวเดิมแม้แต่ field เดียว):
      { type: 'dividend_reversal', asset_id: <เดิม>, user_id: <เดิม>,
        amount_thb: <เท่าเดิม>, quantity: <เท่าเดิม>,
        date: todayInBangkok(),            ← วันที่วันนี้ ไม่ใช่วันของแถวเดิม
        note: 'UNDO_OF:<id ต้นฉบับ>' }

[5] ไม่ต้องแตะ assets.held_quantity เลย — ต่างจาก undo buy/sell
    เพราะ dividend ไม่เคยเปลี่ยนจำนวนที่ถือตั้งแต่แรก (ดู § 5.3)

[6] เงินปันผลสะสม = SUM(amount_thb WHERE type='dividend')
                   − SUM(amount_thb WHERE type='dividend_reversal')
```

### 5.3 กฎการคำนวณของ `dividend` (ต้องเขียนลง `DATABASE.md` ด้วย)

| ผลกระทบต่อ | dividend | เหตุผล |
|---|---|---|
| `heldQty` (จำนวนที่ถือ) | **0 — ไม่เปลี่ยน** | ปันผลเงินสดไม่ได้ทำให้ถือหุ้นเพิ่ม (ปันผลเป็นหุ้น → **ดู § 8.4**) |
| `costBasis` (ต้นทุน) | **0 — ไม่เปลี่ยน** | ตัดต้นทุนจะทำให้ ROI ของสินทรัพย์เพี้ยน |
| `realizedPnL` | **ไม่รวม** | ปันผลเป็น **รายได้** คนละก้อนกับกำไรจากส่วนต่างราคา |
| ยอดใหม่ `totalDividendThb` | **+amount** | แสดงแยกใน Dashboard เป็นบรรทัดของตัวเอง |

**ทำไมต้องมี `dividend_reversal` เป็น type แยก แทนที่จะใส่ amount ติดลบ:**
`transactions.amount_thb` มี CHECK ว่าต้อง > 0 อยู่แล้ว การเปิดให้ติดลบ
เพื่อ dividend อย่างเดียว = ปิดเกราะที่ป้องกันทั้งตารางอยู่ ทำให้บั๊ก
"เงินติดลบ" ในอนาคตทะลุถึง DB ได้ทุกชนิดธุรกรรม — แลกไม่คุ้ม

---

## 6. Cross-User Isolation

**บริบทที่ห้ามลืม** (จาก header ของ `backend/src/utils/ownership.util.js`):
EasyDCA ใช้ `service_role` key และ **ไม่ได้เปิด RLS จริง** — Database
ไม่ตรวจสิทธิ์ให้เลยแม้แต่นิดเดียว **Backend คือ Security Boundary เดียว**
(กฎยืน `PROJECT_STATUS.md` ข้อ 3) และ Audit เคยเจอช่องโหว่ Cross-User
จริง 6 จุดบนเส้นทางเงินมาแล้ว

### 6.1 ต้องลงทะเบียนตารางใหม่ใน `TABLE_REGISTRY` ก่อนเขียน Query แม้แต่บรรทัดเดียว

`ownership.util.js` มี `assertKnownTable()` ที่ throw `UNKNOWN_TABLE`
ถ้าตารางไม่อยู่ใน registry — **นี่เป็นฟีเจอร์ ไม่ใช่อุปสรรค** จงใจให้
ตารางใหม่ "พังก่อน" จนกว่าจะประกาศ ownership ชัดเจน

```js
brokers:    { ownedColumn: 'user_id' },
portfolios: { ownedColumn: 'user_id' },
```

### 6.2 ตารางบังคับ: Query ไหนต้องผ่าน Helper ตัวไหน

| Query | Helper | หมายเหตุ |
|---|---|---|
| List/Get/Create/Update/Delete `brokers` | `queryForUser('brokers', userId, ...)` | ทุกกรณีไม่มีข้อยกเว้น |
| List/Get/Update/Delete `portfolios` | `queryForUser('portfolios', userId, ...)` | รวม GET by id — **ห้าม `.eq('id', id)` เดี่ยวๆ เด็ดขาด** นี่คือรูปแบบช่องโหว่ที่ `pending_transactions` เคยโดนมาแล้ว |
| Allocation aggregate ทุก groupBy | `queryForUser('assets', userId, ...)` | |
| Insert dividend / dividend_reversal | `queryForUser('transactions', userId, ...)` | |
| หา broker/portfolio Default ของ user | `queryForUser(...)` + `.eq('is_default', true)` | |
| Job ใดๆ ที่วนทุก user | `queryAcrossUsers(table, reason)` | ต้องเพิ่ม reason ใหม่ใน `VALID_CROSS_USER_REASONS` ก่อน |

### 6.3 กับดักเฉพาะของงานนี้ — Validate FK ที่รับมาจาก Client

`brokerId` / `portfolioId` ที่มาจาก Request Body **เป็น Input ที่ผู้ใช้
กำหนดเองได้ 100%** — ถ้าเขียน `UPDATE assets SET portfolio_id = <body>`
โดยไม่ตรวจก่อน ผู้ใช้ A จะ **ยัดสินทรัพย์ตัวเองเข้าพอร์ตของผู้ใช้ B ได้**
(FK ระดับ DB ตรวจแค่ว่า "พอร์ตนี้มีอยู่จริง" ไม่ได้ตรวจว่า "เป็นของใคร")

> **กฎ: ก่อน Assign `brokerId`/`portfolioId` ใดๆ ต้อง SELECT ยืนยันก่อนเสมอว่า
> row นั้นเป็นของ `userId` เดียวกัน ผ่าน `queryForUser` — ถ้าไม่เจอให้ตอบ
> `404 NOT_FOUND` (ไม่ใช่ 403) เพื่อไม่ยืนยันการมีอยู่ของ resource คนอื่น**

**Test บังคับ** (`AI_WORK_POLICY.md` § 3 ชั้น Regression): เขียนเคส
user A พยายามอ้าง `portfolioId` ของ user B **ก่อนเขียน Fix** ให้เห็นแดงจริง

---

## 7. Backward Compatibility

| ประเด็น | วิธีจัดการ |
|---|---|
| ผู้ใช้เดิมไม่มีแถวใน `portfolios` เลย | Migration 044 Backfill สร้าง "พอร์ตหลัก" (`is_default=TRUE`) ให้อัตโนมัติ |
| ผู้ใช้ใหม่ที่สมัครหลังจากนี้ | สร้างพอร์ต Default ใน flow สมัคร (`liffAuth.service` / webhook follow) — **ต้องอยู่ transaction เดียวกับการสร้าง user ไม่งั้นจะมี user ที่ไม่มีพอร์ต** |
| Request เก่าที่ไม่ส่ง `portfolioId` | Default เข้าพอร์ต `is_default = TRUE` เสมอ — **ห้ามใส่ NULL** |
| คำสั่งผ่าน LINE (ซื้อ/ขาย) | ไม่เปลี่ยน UX เลย — ลงพอร์ต Default อัตโนมัติ (LINE ไม่ควรต้องระบุพอร์ต) |
| `assets.broker_id` / `sector` เป็น NULL ของเดิมทั้งหมด | UI แสดงกลุ่ม **"ไม่ระบุ"** ไม่ใช่ซ่อนแถว — ไม่งั้นยอดรวมโดนัทจะไม่เท่ามูลค่าพอร์ตจริง |
| Snapshot เก่าใน `portfolio_snapshots` | `portfolio_id` เดิมเป็น NULL = "รวมทุกพอร์ต" ตาม `DATABASE.md § 488` — **ห้าม backfill ย้อนหลัง** เพราะจะกลายเป็นการแก้ประวัติศาสตร์ |
| Client เก่าที่ยังไม่รู้จัก `dividend` | Frontend ต้อง handle type ที่ไม่รู้จักเป็น label กลาง ไม่ใช่ fallback เป็น "ขาย" |

---

## 8. ⚠️ Open Questions — ต้องให้ Founder ตัดสิน (AI ห้ามเดาเอง)

### 8.1 Free-tier Limit จะนับยังไงเมื่อมี Multi-portfolio [สำคัญที่สุด]

**สถานะปัจจุบัน** (`backend/src/services/entitlement.service.js:16,22`):
```js
const FREE_TIER_ASSET_LIMIT = 2;      // Free ถือได้ 2 สินทรัพย์
const FREE_TIER_DCA_PLAN_LIMIT = 2;   // Free ตั้งได้ 2 แผน DCA
```
เพดานนี้เขียนไว้ตอนที่ **โลกมีพอร์ตเดียว** พอมีหลายพอร์ตแล้วคำว่า
"2 สินทรัพย์" กำกวมทันที

| ตัวเลือก | ความหมาย | ผลที่ตามมา |
|---|---|---|
| **A. นับรวมทุกพอร์ต** | Free ถือได้ 2 สินทรัพย์ **ทั้งบัญชี** ไม่ว่ากี่พอร์ต | รักษามูลค่า Premium ไว้เต็ม / แต่ Free ที่มี 2 พอร์ตจะใส่ได้พอร์ตละ 1 ตัว = ใช้งานจริงไม่ได้ |
| **B. นับต่อพอร์ต** | Free ถือได้พอร์ตละ 2 สินทรัพย์ | **เปิดช่องเลี่ยงเพดานทันที** — สร้าง 10 พอร์ตได้ 20 สินทรัพย์ฟรี ทำลาย Monetization |
| **C. Free ล็อกพอร์ตเดียว** *(เอนเอียงไปทางนี้)* | Free มีได้แค่พอร์ต Default 1 อัน เพดาน 2 สินทรัพย์คงเดิมไม่ต้องแก้โค้ด · Multi-portfolio = ฟีเจอร์ Premium ล้วน | ตรงกับตาราง `AI_CONTEXT.md` บรรทัด 95 ("Multiple Portfolio: Free ❌ / Premium ✅") และ Comment ใน Migration 001 ("Free Plan portfolio_id = NULL เป็นส่วนใหญ่") |

**คำถามที่ต้องตอบ:**
1. เลือก A / B / C?
2. **ถ้าเลือก C: Premium ที่หมดอายุแล้วมี 3 พอร์ตจะเกิดอะไร?** กฎเหล็ก
   ข้อ 2 ห้ามลบข้อมูล และนโยบายคือ *"ล็อคไม่ใช่ลบ"* → เสนอ: พอร์ตที่เกิน
   ถูก **ซ่อนจากการเขียน (อ่านได้)** ไม่ใช่ลบ และ unlock ทันทีที่ต่ออายุ
   — แต่ต้องยืนยันว่าถูกต้องตามที่ Founder ต้องการ
3. **Premium มีเพดานจำนวนพอร์ตไหม?** ถ้าไม่มีเลย ผู้ใช้สร้าง 500 พอร์ต
   จะทำให้ Dashboard/Query ช้าและเป็นช่อง abuse — เสนอ **50 พอร์ต** เป็น
   Sanity Cap (ไม่ใช่ Monetization Cap) ยืนยันตัวเลขด้วย

### 8.2 `brokers` เป็นตาราง per-user (user พิมพ์ชื่อเอง) หรือ Master List กลาง?
ข้อเสนอในเอกสารนี้คือ per-user (§ 3.1) — ข้อเสีย: "Bitkub" / "bitkub" /
"บิทคับ" จะกลายเป็น 3 โบรก คนละกลุ่มบนโดนัท
**ทางเลือกกลาง**: per-user + Autocomplete จากรายชื่อยอดนิยม ~15 ราย
(เพิ่ม Effort ~1 วัน) — เอาไหม?

### 8.3 ถือสินทรัพย์ตัวเดียวกันที่ 2 โบรก ต้องรองรับไหม?
วันนี้ `UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id)`
(Migration 014) **ไม่อนุญาต**ให้มี BTC 2 แถวในพอร์ตเดียว
- **ไม่รองรับ** = 1 สินทรัพย์ = 1 โบรก จบ ง่าย ไม่ต้องแตะ constraint
- **รองรับ** = ต้องเพิ่ม `broker_id` เข้า UNIQUE key → **แตะ constraint ที่
  Migration 014 เพิ่งแก้เพราะเคยเป็นบั๊ก Duplicate มาก่อน** เสี่ยงกว่ามาก
  และ Free-tier ที่นับ "2 สินทรัพย์" จะกลายเป็นนับ 2 แถวหรือ 2 symbol อีก

### 8.4 `dividend` รองรับ "ปันผลเป็นหุ้น" (Stock Dividend) ด้วยไหม?
เอกสารนี้ออกแบบไว้ว่า dividend **ไม่เปลี่ยน heldQty** (§ 5.3) ซึ่งถูกต้อง
สำหรับปันผลเงินสด แต่หุ้นไทยจ่ายปันผลเป็นหุ้นบ่อยมาก
- ถ้าต้องรองรับ ต้องมี type ที่ 5 (`stock_dividend`) ที่ **เพิ่ม heldQty
  แต่ไม่เพิ่ม costBasis** ซึ่งทำให้ต้นทุนเฉลี่ยต่อหน่วยลดลงเอง (ถูกต้อง
  ตามหลักบัญชี) — **แต่ขอเสนอให้เลื่อนไปรอบถัดไป** เพื่อไม่ให้ Migration
  046 ซึ่งเสี่ยงที่สุดบวมเกินจำเป็น ยืนยันได้ไหม?

### 8.5 Dividend เป็นฟีเจอร์ Free หรือ Premium?
เอกสารนี้ตั้งไว้เป็น **Free** (บันทึกธุรกรรมพื้นฐาน) — แต่ถ้าจะให้เป็น
Premium ต้องรู้ก่อนเขียน middleware ไม่ใช่มาแก้ทีหลัง

---

## 9. Rollout ทีละขั้น (Deploy ได้เป็นขั้นๆ ไม่ต้องรอครบ)

จัดลำดับตาม **ความเสี่ยงจากน้อยไปมาก** — ของที่แตะสูตรเงินอยู่ท้ายสุดเสมอ

| Stage | เนื้อหา | Migration | ความเสี่ยง | Deploy อิสระได้? |
|---|---|---|---|---|
| **1** | Broker: table + `assets.broker_id` + 4 endpoints + ช่องเลือกโบรกใน UI | 042 | 🟢 ต่ำ — Additive ล้วน ไม่มีโค้ดเดิมอ่าน column นี้ | ✅ |
| **2** | Sector: column + PATCH/filter + Sector Allocation UI | 043 | 🟢 ต่ำ | ✅ |
| **3** | Allocation Endpoint (`groupBy=broker\|sector\|assetType`) | — | 🟢 ต่ำ — Read-only แต่**ต้องใช้ `portfolio.service` ตัวเดิม** | ✅ |
| **4** | Multi-portfolio **ฝั่ง Read เท่านั้น**: Migration 044+045 (backfill) + `GET /portfolios` + Portfolio Switcher UI (ยังสร้างพอร์ตใหม่ไม่ได้) | 044, 045 | 🟡 กลาง — แตะข้อมูลเดิมจริง ต้อง Verify บน Staging + นับแถวก่อน/หลัง | ✅ |
| **5** | Multi-portfolio **ฝั่ง Write**: POST/PATCH/DELETE + ย้าย asset ข้ามพอร์ต + Entitlement ตามคำตอบ § 8.1 | — | 🟡 กลาง — Cross-User FK validation (§ 6.3) คือจุดตาย | ✅ (ต้องได้คำตอบ § 8.1 ก่อน) |
| **6a** | **Refactor เตรียมรับ type ใหม่**: แก้ทุกจุดใน § 2 เป็น exhaustive switch + `default: throw` **โดยยังไม่เปิด CHECK constraint** | — | 🟡 กลาง — พฤติกรรมต้องเหมือนเดิม 100% ทดสอบด้วย type เดิม 2 ค่า | ✅ |
| **6b** | เปิด `dividend`: Migration 046 + RPC ใหม่ + `POST /transactions/dividend` + Undo mapping + UI | 046 | 🔴 **สูงสุด** — แตะ Immutable Ledger + สูตรเงิน | ❌ ต้องหลัง 6a เท่านั้น |

**เหตุผลที่แยก 6a ออกจาก 6b:** ถ้ารวมกันแล้วมีบั๊ก จะแยกไม่ออกว่ามาจาก
"refactor พลาด" หรือ "type ใหม่พลาด" — แยกแล้ว 6a คือ pure refactor ที่
พิสูจน์ได้ว่าไม่เปลี่ยนพฤติกรรมด้วย test ชุดเดิมทั้งหมด

**Definition of Done ของทุก Stage** (`AI_WORK_POLICY.md` § 3 — 4 ชั้น):
1. Unit → 2. Integration → 3. **Regression (ถอด fix ออกต้องเห็นแดงจริง
ก่อน)** → 4. **Production Verification บน Container ที่ deploy จริง
ไม่ใช่แค่ "build ผ่าน"**
ทุก Migration ต้อง **Apply + Verify บน Supabase ก่อน Deploy Code เสมอ**

---

## 10. เอกสารที่ต้องอัปเดตตามเมื่อ Implement จริง

| ไฟล์ | สิ่งที่ต้องแก้ |
|---|---|
| `docs/DATABASE.md` | `brokers` / `assets.broker_id` / `assets.sector` / `portfolios.is_default` / CHECK ของ `transactions.type` / กฎการคำนวณ dividend (§ 5.3) |
| `docs/API.md` | § 14.2 (แก้ Plan ของ GET เป็น Free) · เพิ่ม § 14.9 Brokers · Allocation · Dividend · Rate Limit ของ path ใหม่ |
| `docs/DECISIONS_LOG.md` | บันทึกคำตอบของ Open Questions § 8 ทั้งหมด |
| `docs/PROJECT_STATUS.md` | สถานะจริงของแต่ละ Stage (**ห้ามเขียน "ปิดสมบูรณ์" ถ้ายังไม่ผ่าน DoD ครบ 4 ชั้น**) |
| `docs/TEST_PLAN.md` | เคส Cross-User FK (§ 6.3) + เคส dividend ไม่กระทบ heldQty/costBasis (§ 2) |
