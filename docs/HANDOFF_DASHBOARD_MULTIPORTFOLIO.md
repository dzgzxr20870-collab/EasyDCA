# Handoff — Dashboard ใหม่ + Multi-Portfolio/Broker/Sector/Dividend

> เอกสารนี้สำหรับ **ส่งต่อให้แชทใหม่** ที่ไม่มีบริบทเดิม อ่านไฟล์นี้จบแล้วต้องทำงานต่อได้ทันที
> อัปเดตล่าสุด: 24 ส.ค. 2569 (รอบที่ 3 — ปิด Stage 5 + 6b + **Stage 8 ครบทั้ง 3 กลุ่ม**)

---

## 0. อ่านก่อนเริ่ม (บังคับ ห้ามข้าม)

1. `CLAUDE.md` — Pointer หลักของโปรเจกต์
2. `docs/AI_CONTEXT.md` — กฎเหล็ก + Tech Stack + ตารางสิทธิ์ Free/Premium
3. `docs/AI_WORK_POLICY.md` — Model Selection, Git Hygiene, **DoD 4 ชั้น**
4. `docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md` — **Design Doc หลักของงานนี้ (505 บรรทัด)**
5. `docs/PROJECT_STATUS.md` — สถานะโปรเจกต์ภาพรวม

**Model ที่ต้องใช้: Opus** — งานนี้แตะ Schema/Ledger การเงินจริง ตาม `AI_WORK_POLICY.md` § 1

---

## 1. งานนี้คืออะไร (บริบทที่มา)

Task #18: **เปลี่ยน Dashboard จริงเป็นแบบแยกหน้า (ยก Demo ขึ้น Production)**

เดิมตั้งใจแค่ "เอา Demo ที่ Founder อนุมัติแล้วมาต่อ API จริง" แต่พอสำรวจพบว่า
หน้า Portfolio ในดีไซน์ Demo ใช้ **4 ฟีเจอร์ที่ Backend ไม่มีอยู่จริงเลย**:

| ฟีเจอร์ | สถานะเดิมใน Backend |
|---|---|
| Broker Allocation | ไม่มี column/ตาราง/endpoint เลย |
| Sector Allocation | ไม่มี column/ตาราง/endpoint เลย |
| สลับหลายพอร์ต (Multi-portfolio) | มี column `portfolio_id` ตั้งแต่ Base Schema แต่**ไม่เคยมี endpoint** |
| ธุรกรรมประเภท `dividend` | DB CHECK constraint บังคับแค่ `('buy','sell')` |

**Founder ตัดสินใจว่าอยากได้ครบทุกฟีเจอร์ ไม่ตัดออก** → งานจึงขยายเป็น
"สร้าง Backend ใหม่ทั้งชุดก่อน แล้วค่อยต่อ UI"

### ที่มาของ Demo
Branch `demo/multipage-ux-redesign` (3 commits: `d503467`, `b5c4640`, `65dfb44`)
เป็น Mock Data ล้วน ผ่านการรีวิวกับ Founder 3 รอบแล้ว ไฟล์อยู่ที่:
- `frontend/src/pages/demo/Demo{Dashboard,Portfolio,Transactions,Dca,Profile}.jsx`
- `frontend/src/components/demo/*`
- `frontend/src/lib/demo/*`

> ⚠️ **ห้าม Merge branch `demo/multipage-ux-redesign` เข้า `main` เด็ดขาด**
> มันแยกจาก `main` ไปนานแล้ว (`main` ไปข้างหน้า 24 commits) `git diff main..demo`
> มี **6,872 deletions** — จะลบงาน Slip OCR + มาสคอต + Premium fixes ที่ Deploy
> ไปแล้วทิ้งทั้งหมด **ต้อง Port โค้ด UI มาใส่บน `main` ทีละไฟล์เท่านั้น**

---

## 2. สถานะปัจจุบัน

**Branch ที่ทำงาน: `feat/dashboard-production-wire`** (แตกจาก `main`)

### Commit ที่เสร็จแล้ว

| Commit | Stage | เนื้อหา |
|---|---|---|
| `dc86b55` | — | Design Doc 505 บรรทัด |
| `a3bc2e5` | 1 | migration 042 — ตาราง `brokers` + `assets.broker_id` |
| `2cee72f` | 2 | migration 043 — `assets.sector` |
| `2038a5d` | 3 | migration 044 — เปิด Multi-portfolio + `is_default` + Backfill |
| `caa68cf` | 4 | migration 045 — Guard ตรวจผล Backfill |
| `38aa28a` | 6a | refactor สูตรเงินเป็น exhaustive switch (ยังไม่เปิด dividend) |
| `cd6bcf0` | — | อัปเดต DATABASE/CHANGELOG/DECISIONS_LOG |
| `f2b2dbf` | 5 | migration 046 — ถือ Symbol เดียวกันได้หลายโบรก + `assetResolution.service` |
| `a9f8f3d` | 6b | migration 047 — เปิด `dividend` + `POST /transactions/dividend` |
| `9190b4b` | 6b-fix | บังคับกรอก `quantity` ของปันผล (มติ Founder 24 ส.ค.) |
| `2e9123c` | 8 (1/3) | `/api/v1/portfolios` ครบ 5 Endpoint + Entitlement ของพอร์ต |
| `7b26712` | 8 (2/3) | `GET /portfolio/allocation` สัดส่วนพอร์ตสำหรับกราฟโดนัท |
| `75b8fc5` | 8 (3/3) | `GET /assets` + `PATCH /assets/{id}` ป้ายกำกับสินทรัพย์ |

**Test:** ก่อนเริ่มทั้งหมด 116 suites / 2,264 → **ตอนนี้ 129 suites / 2,596 เขียวทั้งหมด**
**ESLint:** 0 error (14 warnings ที่ค้างมาแต่เดิม) · `npm run build` ฝั่ง Frontend ผ่าน

### ✅ Stage 5 ปิดแล้ว (commit `f2b2dbf`) — ไม่มีงานค้างในเครื่องอีก

migration 046 + `assetResolution.service.js` + แก้ 5 จุดบนเส้นทางเงินที่เคยใช้
`.maybeSingle()` (จะ error ทันทีเมื่อ symbol มี 2 แถว) · เพดาน Free นับ distinct symbol แล้ว

### ✅ Stage 8 ปิดแล้วครบทั้ง 3 กลุ่ม (รอบที่ 3)

| กลุ่ม | Endpoint | Commit |
|---|---|---|
| Portfolios | `GET/POST /portfolios` · `GET/PATCH/DELETE /portfolios/{id}` | `2e9123c` |
| Allocation | `GET /portfolio/allocation?groupBy=broker\|sector\|assetType` | `7b26712` |
| Assets | `GET /assets` · `PATCH /assets/{id}` | `75b8fc5` |
| Brokers | มีอยู่แล้วตั้งแต่ Stage 1 — **ไม่ต้องทำซ้ำ** | `a3bc2e5` |

**⚠️ แก้ Spec ที่ผิดใน `API.md` รวม 4 จุด (ของเดิมผิด ไม่ใช่เปลี่ยนใจ):**
1. `GET /portfolios` Premium → **Free** (ถ้าคืน 403 หน้า Dashboard ของ Free พังทันที
   เพราะหลัง migration 044 ทุกคนมีพอร์ต Default ที่ UI ต้องใช้ render)
2. `DELETE /portfolios/{id}` **ห้ามพึ่ง FK `ON DELETE SET NULL`** — จะทำ Invariant
   ของ migration 044/045 พัง ต้องย้ายสินทรัพย์เข้าพอร์ต Default ก่อนแล้วค่อยลบ
3. `PATCH /assets/{id}` **ถอด `isActive` ออก** — เป็นตัวนับเพดาน Free Plan ที่ต้อง
   ผ่าน RPC ที่ Lock ไว้เท่านั้น
4. § 14.4 เขียนว่า Assets เป็นการ "ขยายของเดิม" แต่ **ของเดิมไม่มีอยู่จริง**
   (`assets.routes` มีแค่ `GET /symbols`) ต้องสร้างทั้ง 2 Endpoint ใหม่

### ✅ Stage 6b ปิดแล้ว (รอบที่ 2) — เปิด `dividend` จริง

- `migrations/047_add_dividend_transaction_type.sql` — CHECK รับ 4 ค่า **และ**
  แก้ `create_transaction_locked()` ที่ยังนับยอดคงเหลือแบบ Binary อยู่ (จุดนี้ Stage 6a
  แก้แต่ฝั่ง JS ไม่ได้แก้ฝั่ง SQL — ถ้าลืมจะทำให้ "ขายหุ้นที่ถืออยู่จริงไม่ได้")
- `services/dividend.service.js` + `POST /api/v1/transactions/dividend` (Free)
- **เจอจุดที่ 8 ของ Design Doc § 2**: `flexMessage.util.buildUndoMessage` ยังเป็น Binary
  → ย้อนปันผลแล้วการ์ดเขียนว่า "รายการขาย" (แก้แล้ว)
- ⚠️ **Design Doc § 4.5 ไม่ครบ**: `quantity`/`price_per_unit` มี CHECK > 0 อยู่ ทั้งที่
  Doc ระบุ `quantity?` optional — เลือกเก็บจำนวนหน่วยที่ได้ปันผล + DPS
  แทนการผ่อน CHECK (เหตุผลเต็มอยู่หัวไฟล์ migration 047 + DATABASE.md)
- ⚠️ **`quantity` เป็นค่า "บังคับกรอก" (มติ Founder 24 ส.ค. — commit `9190b4b`)**
  รอบแรกทำเป็น optional (ไม่ส่ง = เติมยอดถือ ณ วันนั้นให้เอง) เพราะเขียนก่อนมติมาถึง
  · การเติมให้เอง = **Silent Default ขัดกฎยืนข้อ 11** — จำนวนหน่วยที่ระบบรู้กับที่
  ได้ปันผลจริงไม่จำเป็นต้องเท่ากัน (ปันผลจ่ายตามยอด ณ วัน XD ซึ่งมักคนละวันกับ
  วันเงินเข้า และผู้ใช้จำนวนมากเพิ่งเริ่มบันทึกกลางทาง) และค่านี้ไหลต่อไปเป็น DPS
  ที่ผู้ใช้เอาไปเทียบข้ามงวดจริง
  · ⚠️ **`heldQuantityAsOf` ยังอยู่ครบ** ในฐานะด่าน `NOTHING_TO_RECEIVE_DIVIDEND`
  ซึ่งตรวจจาก **ยอดถือจริง ณ `date`** ไม่ใช่จาก `quantity` ที่ผู้ใช้กรอก
- Test: 122 suites / 2,427 → **125 suites / 2,484 เขียวทั้งหมด** · Red-Green 5 ชุด

### Migration ยังไม่ได้ Apply บน Supabase เลยแม้แต่ตัวเดียว
Founder จะเป็นคน Apply เอง — ต้องเตรียม Verify Query ให้

---

## 3. คำตอบที่ Founder ตัดสินแล้ว (ห้ามถามซ้ำ ห้ามเปลี่ยนเอง)

### Q4.1 — Free-tier เมื่อมีหลายพอร์ต → **Free ล็อกพอร์ตเดียว**
ยืนยันจาก `docs/AI_CONTEXT.md` บรรทัด 95: `| Multiple Portfolio | ❌ | ✅ | ✅ |`
เพดานเดิม `FREE_TIER_ASSET_LIMIT = 2` / `FREE_TIER_DCA_PLAN_LIMIT = 2` **ไม่ต้องแก้**

### Q4.1(ก) — Premium หมดอายุแต่มี 3 พอร์ต → **"อ่านได้ แต่เขียนไม่ได้"**
- พอร์ตส่วนเกินเปิดดูข้อมูลย้อนหลังได้ปกติ แต่เพิ่มสินทรัพย์/บันทึกรายการใหม่ไม่ได้
- ต่ออายุเมื่อไหร่กลับมาใช้ได้ทันที
- **ห้ามลบข้อมูลผู้ใช้เด็ดขาด** (กฎเหล็กข้อ 2 CLAUDE.md)
- "พอร์ตไหนคือส่วนเกิน" ต้อง Deterministic — เรียงตาม `created_at`, พอร์ตแรกสุด = พอร์ตที่ยังเขียนได้

### Q4.1(ข) — **Sanity Cap 50 พอร์ตต่อ user** (กัน abuse)

### Q4.2 — Broker input → **พิมพ์เอง + รวมชื่อคล้ายกันอัตโนมัติ**
- Normalize ก่อนเทียบ/จัดกลุ่ม: trim ช่องว่างหัวท้าย + ยุบช่องว่างซ้ำ + เทียบ case-insensitive
- กัน `Bitkub` / `bitkub` / `Bitkub ` กลายเป็น 3 กลุ่มบนกราฟโดนัท
- **แต่ต้องเก็บรูปแบบที่ผู้ใช้พิมพ์ครั้งแรกไว้แสดงผล** (ไม่บังคับเป็นตัวพิมพ์เล็กหมด)
- **ไม่ต้องทำ Autocomplete รายชื่อโบรกในรอบนี้**

### Q4.3 — ถือสินทรัพย์เดียวกันที่ 2 โบรก → **รองรับเลยในรอบนี้**

**ข้อ 1 — LINE `ซื้อ BTC 100` ขณะถือ BTC หลายโบรก → ถามกลับก่อนว่าโบรกไหน**
- ตอบกลับเป็นปุ่มให้เลือกโบรกก่อนบันทึก **ห้ามเดาเอง**
- ตรงกับกฎยืนข้อ 11 CLAUDE.md ("Silent Default เป็น Anti-pattern เสมอ")
- ใช้ Pattern Quick Reply/Postback ที่มีอยู่แล้ว (`webhook.controller.js` + `flexMessage.util.js`) — **Reuse ของเดิม ห้ามสร้าง Flow ใหม่ซ้ำซ้อน**
- ⚠️ **Label ปุ่ม LINE Quick Reply ≤20 ตัวอักษร (Unicode Code Point)** ตามกฎยืนข้อ 5 — ชื่อโบรกยาวต้องตัด
- **ถ้าถือ symbol นั้นโบรกเดียว → ห้ามถาม** บันทึกตรงเลย (กฎยืนข้อ 10: ห้ามเพิ่ม Latency บน Live Path โดยไม่จำเป็น)
- ต้องกันกรณีผู้ใช้ทิ้ง Flow ค้าง (Pending expire) ตาม Pattern เดิม

**ข้อ 2 — Free-tier นับสินทรัพย์เป็น distinct symbol**
- ถือ BTC ที่ 2 โบรก = นับเป็น **1** สินทรัพย์
- ใช้ `countActiveSymbolsGroupedByUser` (ไม่ใช่ `countActiveByUser` ที่นับแถว)
- ต้องไล่ดูว่าจุดไหนยังใช้ตัวนับแถวอยู่แล้วแก้ให้สอดคล้อง
- **Test ที่ต้องมี:** Free ถือ BTC 2 โบรก + ETH 1 โบรก → เพิ่มสินทรัพย์ตัวที่ 3 ไม่ได้ แต่เพิ่มโบรกที่ 3 ให้ BTC ได้

### Q4.4 — Stock Dividend (ปันผลเป็นหุ้น) → **เลื่อนไปรอบหน้า** (บันทึกใน CHANGELOG/TODO)

### Q4.5 — **Dividend เป็น Free** ไม่ Gate ด้วย Premium

---

## 4. บั๊ก/ความเสี่ยงที่ค้นพบระหว่างทาง (แก้แล้ว — อย่าทำพลาดซ้ำ)

### 4.1 `dividend` จะถูกตีความเป็น `sell` เงียบๆ ที่ 7 จุด
โค้ดคำนวณเงินเขียนแบบ binary (`buy` หรือ "ไม่ใช่ buy") ไม่ได้ enumerate ครบ:

| ไฟล์:บรรทัด | อาการถ้าไม่แก้ |
|---|---|
| `services/transaction.service.js:392` | จำนวนที่ถือหายไป |
| `services/portfolio.service.js:46-72` | ต้นทุนถูกตัดทิ้ง + กำไรเพี้ยน |
| `migrations/041:130` (และ 034, 036) | ผิดถึงระดับ DB |
| `utils/flexMessage.util.js:726` | แสดงปันผลว่า "ขาย" |
| `reportExport.service.js:529,698` | แสดงปันผลว่า "ขาย" |
| `transactions.controller.js:613` | แสดงปันผลว่า "ขาย" |
| **`undoTransaction.service.js:121`** ⚠️ | **จุดที่ Design Doc ตกไป และร้ายแรงที่สุด** — `latest.type === 'buy' ? 'sell' : 'buy'` ทำให้กด "ย้อนล่าสุด" บนรายการปันผลจะสร้างแถว **`buy`** เพิ่มจำนวนที่ถือ+ต้นทุนจากอากาศ |

**วิธีจัดการ:** แยก Stage 6a (refactor เป็น exhaustive switch + `default: throw`
โดยยังไม่เปิด constraint) ออกจาก 6b (เปิดจริง) เพื่อแยกให้ออกว่าบั๊กมาจาก
refactor หรือจาก type ใหม่ — **Migration ที่เปิด `dividend` ต้องเป็นตัวสุดท้ายเสมอ**

### 4.2 Design Doc เขียน Backfill ใช้ `type = 'mixed'` ซึ่งไม่มีจริง
`'mixed'` ไม่อยู่ใน CHECK ของ `portfolios.type` และไม่ปรากฏที่ไหนเลยในโค้ด
→ จะ ERROR ทั้งก้อน **แก้เป็น `'custom'` แล้ว** + เพิ่ม Pre-flight อ่าน constraint จริงมาตรวจ

### 4.3 Design Doc สรุปเรื่อง UNIQUE ไม่ครบ
ที่ว่าย้าย `portfolio_id` จาก NULL → uuid ไม่ชนเพิ่มนั้น **ถูกเฉพาะ user ที่ไม่เคยมีพอร์ต**
ตกเคส user ที่มีพอร์ตอยู่แล้วและถือ symbol เดียวกัน 2 แถว → เพิ่ม STEP 6 ดักไว้แล้วใน 044

### 4.4 `portfolio_id` มีมาตั้งแต่ Base Schema (ไม่ได้มาจาก Migration ใด)
- `001_create_pending_transactions.sql:27` เขียน `REFERENCES portfolios(id)` ได้เลย
  → ตาราง `portfolios` มีอยู่**ก่อน** migration 001 (สร้างจาก DDL ใน `docs/DATABASE.md` โดยตรง)
- Comment ที่ `001:98-101` อธิบายว่าทำไมมี column แต่ไม่มี endpoint:
  `-- Rule 1 + 3: FK Index แบบ Partial (Free Plan portfolio_id = NULL เป็นส่วนใหญ่)`
  → ออกแบบไว้ตั้งแต่แรกว่า Multiple Portfolio = ฟีเจอร์ **Premium** แต่ Phase 1 ทำแค่ Free-path
- `014_fix_assets_null_unique_constraint.sql:5` ยืนยัน: *"Free-tier ไม่มี portfolio"*
  → **production วันนี้ `portfolio_id` เป็น NULL แทบ 100%**
- `035_create_asset_locked_rpc.sql:54,111` — **ทาง Write รองรับอยู่แล้ว** (RPC รับ `p_portfolio_id`)
- `docs/API.md § 14.2` มี Spec ครบ 5 endpoint แต่ไม่มีโค้ด
  → งานนี้คือ "ทำ § 14.2 ที่เขียนไว้แล้วให้เป็นจริง" ไม่ใช่ออกแบบใหม่จากศูนย์

---

## 5. งานที่เหลือ (ทำตามลำดับนี้ Commit แยกทีละ Stage)

### ~~Stage 5~~ ✅ ปิดแล้ว (`f2b2dbf`) — Migration 046 UNIQUE constraint
**Constraint ใหม่ที่วิเคราะห์ไว้แล้ว (ยืนยันแล้วว่าถูก ใช้ได้เลย):**
```sql
UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id)
```
- ยังกันบั๊กเดิมของ Migration 014 ได้ครบ **บั๊กเดิมคือ:** asset ซ้ำ 2 แถวทำให้ประวัติธุรกรรม
  ของ symbol เดียวกันแตกไปคนละ `asset_id` แล้ว Moving Average Cost Basis เห็นแค่ครึ่งเดียว → P&L ผิดทันที
- `NULLS NOT DISTINCT` ทำให้ `broker_id` ที่เป็น NULL (ข้อมูลเดิมทั้งหมด) ถือว่าเท่ากัน
  สองแถว `(U, BTC, P1, NULL)` จึงยังชนกันเหมือนเดิม
- เปิดให้ `(U, BTC, P1, Bitkub)` กับ `(U, BTC, P1, Binance)` อยู่ร่วมกันได้
- **ไม่ต้องใช้ COALESCE/Partial Index เลย**

**สิ่งที่ต้องแก้คู่กัน:** `asset.repository.findByUserAndSymbol()` ใช้ `.maybeSingle()`
ซึ่งจะ **error ทันที**เมื่อ symbol มี 2 แถว — ถูกเรียกจาก **5 จุดบนเส้นทางเงิน**:
`transaction.service` (validateBuy/validateSell) · `webhook.controller` ฝั่ง LINE ·
`bulkImport.service` · `profit.service`

### ~~Stage 6b~~ ✅ ปิดแล้ว (รอบที่ 2) — Migration 047 เปิด `dividend` CHECK constraint
### ~~Stage 8~~ ✅ ปิดแล้วครบทั้ง 3 กลุ่ม (รอบที่ 3) — `2e9123c` · `7b26712` · `75b8fc5`
แก้ Spec ที่ผิดใน `API.md` ไปแล้ว 4 จุด (ดูรายละเอียดที่ § 2)

**สิ่งที่ Stage 9 ต้องรู้ก่อนต่อ UI — Endpoint ที่พร้อมใช้แล้ว:**

| Endpoint | Plan | คืนอะไรที่ UI ต้องใช้ |
|---|---|---|
| `GET /api/v1/portfolios` | Free | `portfolios[].canWrite` ← **ใช้ธงนี้ Disable ปุ่มบันทึก ห้ามเดาเองจาก plan** |
| `POST /api/v1/portfolios` | Premium | `403 PORTFOLIO_LIMIT_REACHED` (Free) / `409 PORTFOLIO_CAP_REACHED` (ชน 50) |
| `DELETE /api/v1/portfolios/{id}` | Premium | `movedAssetCount` — บอกผู้ใช้ว่าสินทรัพย์ถูกย้ายไปพอร์ต Default กี่รายการ |
| `GET /api/v1/portfolio/allocation` | Free | `groups[]` พร้อม `percent` (รวม 100 เสมอ) + `priceUnavailableCount` + `fxUnavailableForUsd` |
| `GET /api/v1/assets` | Free | Filter `brokerId` / `sector` / `portfolioId` (`none` = ไม่ระบุ) |
| `PATCH /api/v1/assets/{id}` | Free | แก้ `brokerId` / `sector` / `portfolioId` เท่านั้น |
| `POST /api/v1/transactions/dividend` | Free | `quantity` **บังคับกรอก** — ฟอร์มต้องมีช่องนี้และห้ามปล่อยว่าง |

**ธงที่ UI ต้องมีที่รองรับ (Demo ไม่มี — ห้ามตกหล่น):**
`canWrite` · `priceUnavailableCount` · `fxStale` · `fxUnavailableForUsd` ·
`excludedCount` · `isEmpty` · `movedAssetCount`
> `API.md` ระบุชัดว่า **ห้ามรวมยอดข้ามสกุลเงินเมื่อ `fxUnavailableForUsd = true`**

### Stage 9 (ยังไม่เริ่ม) — ต่อ Frontend เข้ากับ API จริง
- Port UI จาก `demo/*` มาใส่บน `main` ทีละไฟล์ (ห้าม merge branch)
- ทำเป็น Route คู่ขนาน/Feature Flag ก่อน **ห้ามลบ Dashboard เดิม** เพื่อให้ Rollback ง่าย
- แทน `frontend/src/lib/demo/planEntitlements.js` (ของปลอม) ด้วย Entitlement จริงจาก `/dashboard/me`
- Reuse `frontend/src/lib/api.js` เดิม **ห้ามเขียน API Client ใหม่**

### เลข Migration ที่ถูกต้อง
**046 = UNIQUE constraint (Stage 5) · 047 = dividend (Stage 6b)**
(migration ที่เปิด dividend ต้องเป็นตัวสุดท้ายเสมอ)

---

## 6. กฎเหล็กที่ห้ามละเมิด (ย้ำ)

1. **ห้าม Push/Merge/Deploy** จนกว่า Founder อนุมัติเป็นลายลักษณ์อักษร — commit local เท่านั้น
2. **Immutable Ledger** — ห้าม `DELETE`/`UPDATE` transaction
   Undo dividend ต้องสร้างรายการหักล้าง (`dividend_reversal`) ตาม Pattern `undoTransaction.service.js`
   (ไม่ลบ ไม่แก้แถวเดิม แต่ INSERT แถวใหม่ที่ `note = 'UNDO_OF:<id ต้นฉบับ>'`)
   **dividend ไม่กระทบ heldQty/costBasis/realizedPnL เลย** (เป็นรายได้ คนละก้อนกับกำไรส่วนต่างราคา)
3. **Cross-User Isolation** — `brokerId`/`portfolioId` ที่มาจาก Request Body
   **ต้อง SELECT ยืนยันเจ้าของก่อนใช้เสมอ** (FK ตรวจแค่ว่า "มีอยู่จริง" ไม่ได้ตรวจว่า "ของใคร")
   ถ้าพลาด → ผู้ใช้ A ยัดสินทรัพย์เข้าพอร์ตของผู้ใช้ B ได้
   ทุก Query ใหม่ต้องลงทะเบียนใน `TABLE_REGISTRY` + ผ่าน `queryForUser` ใน `utils/ownership.util.js`
   (บทเรียนตรงจาก Cross-User Isolation Audit 9 ส.ค. ใน `PROJECT_STATUS.md`)
4. **ห้ามลบ Dashboard เดิม / ไฟล์ Demo เดิม**
5. Migration ต้องล็อก `search_path` ตาม Pattern `028`
6. **Migration ต้อง Apply+Verify บน Supabase ก่อน Deploy Code เสมอ**
7. Internal Navigation ใช้ React Router (`<Link>`/`navigate()`) **ห้าม `<a href>`** (JWT เก็บใน Memory จะหาย)
8. ห้ามใช้ localStorage/sessionStorage สำหรับข้อมูล Sensitive

---

## 7. DoD ทุก Stage (ตาม `AI_WORK_POLICY.md` § 3)

1. **Unit** + **Integration** Test ครอบ Logic ใหม่
2. **Regression พิสูจน์ Red-Green จริง** — ถอด Fix ออกต้องเห็นแดงก่อน
   โดยเฉพาะ UNIQUE constraint 046 และ Cross-User Isolation ของ `brokerId`/`portfolioId`
3. Test เดิมทั้งหมดเขียว (รายงานตัวเลขก่อน/หลัง)
4. **Production Verification** — รอบนี้ทำไม่ได้เพราะห้าม Deploy **ต้องระบุชัดในรายงานว่ายังไม่ได้ Verify**
5. `npm run build` ผ่านทั้ง Backend/Frontend · ESLint สะอาดบนไฟล์ที่แตะ
6. อัปเดต `docs/CHANGELOG.md`, `docs/API.md`, `docs/DATABASE.md` ให้ตรงของจริง

---

## 8. ลำดับ Apply Migration บน Supabase (Founder รันเอง — ยังไม่ได้ทำ)

# ⛔⛔ ห้าม Apply `044` ตอนนี้เด็ดขาด ⛔⛔

> **สถานะ: บล็อกอยู่** — พบบั๊ก Asset Resolution ตอนรีวิวโค้ด 24 ส.ค. 2569
> วินาทีที่ Apply `044` ระบบที่รันอยู่บน Production จะพังทันที 4 จุดพร้อมกัน
>
> **อาการ:** `044` Backfill ให้สินทรัพย์ทุกแถวมี `portfolio_id` → ไม่เหลือแถวที่
> `portfolio_id IS NULL` อีกเลย แต่โค้ดที่รันอยู่ค้นสินทรัพย์ด้วย
> `.is('portfolio_id', null)` เสมอ (ทุก Caller เขียน `?? null` ตามกันหมด)
> → **ค้นหาสินทรัพย์เดิมไม่เจอทุกครั้ง**
>
> | จุด | อาการ | ความรุนแรง |
> |---|---|---|
> | **ซื้อ** | หาแถวเดิมไม่เจอ → **สร้างสินทรัพย์ซ้ำแถวใหม่** (ไม่ชน UNIQUE เพราะ `NULL ≠ P1`) → ประวัติแตกคนละ `asset_id` → Moving Average Cost Basis เห็นครึ่งเดียว → **ต้นทุนเฉลี่ย/P&L ผิดแบบเงียบสนิท** | 🔴 **สูงสุด — แตะเงินจริง ผู้ใช้ไม่มีทางรู้ตัว** |
> | **ขาย** | `ASSET_NOT_FOUND` ทุกครั้ง → ขายไม่ได้ทั้งระบบ | 🟠 พังดัง |
> | **ดูกำไร** | หาสินทรัพย์ไม่เจอ | 🟠 พังดัง |
> | **LINE** | Resolve สินทรัพย์ไม่เจอ | 🟠 พังดัง |
>
> ⚠️ **`migration 045` จับบั๊กนี้ไม่ได้** — มันตรวจ Invariant ของ *ข้อมูล* หลัง
> Backfill (ทุก user มีพอร์ต Default · สินทรัพย์ทุกแถวสังกัดพอร์ต) ไม่ได้ตรวจ
> *พฤติกรรมของแอป* · แถวซ้ำที่เกิดขึ้นหลังจากนั้นจะผ่าน 045 ได้สบาย เพราะมันก็
> สังกัดพอร์ตครบเหมือนกัน
>
> ⚠️ **การรวมแถวซ้ำกลับคืนกระทบต้นทุนเฉลี่ย = แตะเงินจริง ห้ามทำอัตโนมัติ**
> ยิ่ง Apply ทิ้งไว้นาน แถวซ้ำยิ่งเกิดเพิ่ม และยิ่งกู้คืนยาก

### ✅ ลำดับที่ถูกต้อง (ทำตามนี้เท่านั้น)

```
ขั้น 1   Apply  042 → 043           (ปลอดภัย ไม่แตะข้อมูลเดิม)
ขั้น 2   ⛔ หยุด — แก้บั๊ก Asset Resolution ให้เสร็จก่อน
ขั้น 3   Merge + Deploy โค้ดที่แก้แล้ว ทั้ง EasyDCA และ easydca-worker
ขั้น 4   ยืนยันบน Production ว่าซื้อ/ขาย/ดูกำไร/LINE ยังทำงานปกติ (ก่อน 044)
ขั้น 5   จดเลขแถว assets/portfolios/users + สร้าง _backup_044_assets_portfolio
ขั้น 6   Apply  044 → 045           (044 = ตัวแรกที่แตะข้อมูลเดิมจริง)
ขั้น 7   ยืนยันบน Production อีกรอบว่าทั้ง 4 จุดยังทำงานปกติ (หลัง 044)
ขั้น 8   Apply  046 → 047 → 048
```

> ### ⚠️ ทำไมรอบนี้ "Deploy โค้ดก่อน Migration" — สลับจากกฎปกติโดยตั้งใจ
>
> กฎปกติของโปรเจกต์คือ **"Apply Migration ก่อน Deploy Code เสมอ"** เพราะโดยทั่วไป
> โค้ดใหม่คือฝ่ายที่ *ต้องการ* Schema ใหม่ ถ้า Deploy ก่อนจะพังเพราะคอลัมน์ยังไม่มี
>
> **เคสนี้กลับด้าน** เพราะ `044` ไม่ได้เพิ่มของให้โค้ดใหม่ใช้ — มันคือตัวที่
> **ทำให้โค้ดเดิมพัง** โดยการเปลี่ยนข้อมูลที่โค้ดเดิมพึ่งอยู่ (`portfolio_id IS NULL`)
>
> โค้ดที่แก้แล้วถูกออกแบบให้ทำงานถูกต้อง **ทั้งก่อนและหลัง 044** (ไม่กรอง
> `portfolio_id` เลยเมื่อผู้ใช้ไม่ได้ระบุพอร์ต) จึง Deploy ก่อนได้อย่างปลอดภัย
> และเป็นลำดับเดียวที่ไม่มีช่วงเวลาที่ระบบพัง

รันทีละไฟล์ **ห้ามข้ามลำดับ** Verify Query เขียนไว้ท้ายไฟล์ทุกตัวแล้ว

---

## 9. คำสั่งที่ใช้บ่อย

```bash
# ดูงานทั้งหมดของ branch นี้
git -C C:\Project_EasyDCA\EasyDCA log --oneline dc86b55..HEAD
git -C C:\Project_EasyDCA\EasyDCA diff dc86b55..HEAD --stat
git -C C:\Project_EasyDCA\EasyDCA diff dc86b55..HEAD -- backend/migrations/

# Test / Lint / Build
cd backend && npm test
cd backend && npm run lint
cd frontend && npm run dev
```

---

## 10. สิ่งที่ต้องทำเป็นอย่างแรกในแชทใหม่

1. อ่านเอกสารในข้อ 0 ให้ครบ
2. `git status` — ควรสะอาด (Stage 5 + 6b commit แล้วทั้งคู่)
3. **เริ่มที่ Stage 8** (Endpoint ใหม่ทั้งหมด: Portfolios / Brokers / Allocation)
4. แล้วค่อย Stage 9 (ต่อ Frontend)
5. **หยุดก่อน Push เสมอ รอ Founder ตรวจ**
