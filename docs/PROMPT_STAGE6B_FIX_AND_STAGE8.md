# Prompt สำหรับ Claude Code — แก้ Stage 6b (quantity บังคับ) แล้วทำ Stage 8 ต่อ

> คัดลอกทั้งไฟล์นี้วางเป็น Prompt ได้เลย

---

## 🧠 Model ที่ต้องใช้ (บังคับ — ระบุก่อนเริ่มงาน ตาม `AI_WORK_POLICY.md` § 1)

| งาน | Model | เหตุผล |
|---|---|---|
| **งานที่ 1 — แก้ `quantity` ของ dividend** | **Opus** | แตะ Validation บนเส้นทางเงินที่เขียนลง Immutable Ledger + ต้องไม่พังด่าน `NOTHING_TO_RECEIVE_DIVIDEND` ไปพร้อมกัน |
| **งานที่ 2 — Stage 8 (Endpoint ใหม่)** | **Opus** | แตะ **Entitlement** (Free/Premium, พอร์ตส่วนเกิน) + **Cross-User Isolation** ซึ่งเป็น 2 ใน 5 หมวดไฟล์เสี่ยงสูงของ § 4 · Allocation ยังอ่านสูตรเงินจาก `portfolio.service` ด้วย |
| อัปเดตเอกสารล้วน (CHANGELOG/API/DATABASE) หลังโค้ดเสร็จแล้ว | Sonnet ได้ | ไม่มี Logic การเงิน — แต่ถ้าอยู่ในรอบเดียวกับโค้ด ใช้ Opus ต่อเนื่องไปเลยง่ายกว่า |

> **กฎ § 1 ที่ต้องทำจริง:** ระบุ Model + เหตุผล **ก่อน** เริ่มลงมือ ไม่ใช่มาเขียน
> ทีหลังตอนรายงาน · § 5 บอกว่าไฟล์ที่คาบเกี่ยวหลายหมวดให้ยึด Policy ที่เข้มที่สุด
> — ทั้ง 2 งานนี้คาบเกี่ยวหลายหมวด จึงเป็น **Opus ทั้งคู่ ไม่มีข้อยกเว้น**

---

## คำตอบของ Founder ต่อคำถามที่คุณถามมา 2 ข้อ

**ข้อ 1 — ให้คุณทำต่อคนเดียว** Session อื่นหยุดแล้ว ไม่มีใครเขียน branch
`feat/dashboard-production-wire` อีกนอกจากคุณ ทำต่อได้เต็มที่ไม่ต้องกลัวชนงาน

> เพื่อความชัดเจน: commit `a9f8f3d` (Stage 6b) เป็นงานของ Session นั้น ไม่ใช่ของ
> คนอื่นที่ไม่รู้จัก — งานผ่านการตรวจแล้วและคุณเองก็ยืนยันว่าเขียวจริง 125 suites /
> 2,484 tests ให้ **ต่อยอดจากมัน ห้าม revert ทิ้ง**

**ข้อ 2 — ใช่ แก้ให้ `quantity` เป็นค่าบังคับ** ตามที่ Founder เลือกไว้
(บังคับกรอกจำนวนหุ้น + บาท/หุ้น) เหตุผลคือกฎยืนข้อ 11: การเติมยอดถือให้เองเมื่อ
ผู้ใช้ไม่กรอก = Silent Default ซึ่งเป็น Anti-pattern เสมอ

> ⚠️ **หมายเหตุสำคัญ**: `a9f8f3d` เขียนขึ้น *ก่อน* คำตอบข้อนี้จะมาถึง จึงทำเป็น
> optional ไว้ — ไม่ใช่การจงใจขัดคำสั่ง แค่ลำดับเวลาเหลื่อมกัน

---

## งานที่ 1 (ทำก่อน) — แก้ `quantity` ของ dividend ให้เป็นค่าบังคับ

### 1.1 `backend/src/services/dividend.service.js`

บรรทัด ~127–136 ตอนนี้เป็นแบบนี้:

```js
let quantity;
if (params.quantity === undefined || params.quantity === null || params.quantity === '') {
  quantity = heldAtDate;              // ⬅️ Silent Default — ต้องเอาออก
} else {
  quantity = Number(params.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new DividendServiceError('VALIDATION_ERROR', '...', { field: 'quantity' });
  }
}
```

เปลี่ยนให้ **ไม่ส่งมา = `VALIDATION_ERROR`** ทันที ไม่เติมให้เอง

พร้อมแก้ Comment เหนือบล็อกนั้นให้ตรงกับพฤติกรรมใหม่ และเขียนเหตุผลกำกับไว้ว่า
*ทำไมถึงไม่เติมให้เอง* (อ้างกฎยืนข้อ 11 + มติ Founder) เพื่อไม่ให้คนอ่านในอนาคต
"ปรับปรุง" กลับไปเป็น optional อีกเพราะคิดว่าสะดวกกว่า

### 1.2 ⚠️ ห้ามลบ `heldQuantityAsOf` เด็ดขาด

ฟังก์ชันนี้ยังจำเป็นอยู่ **ในฐานะด่าน `NOTHING_TO_RECEIVE_DIVIDEND`**

กติกาที่ต้องคงไว้เป๊ะ: **ตรวจจากยอดถือจริง ณ `date` เสมอ ไม่ใช่จาก `quantity`
ที่ผู้ใช้กรอกมา** — ถ้าเผลอเปลี่ยนไปเช็คจากค่าที่กรอก ผู้ใช้จะบันทึกปันผลของหุ้นที่
ไม่เคยถือได้ทุกครั้งแค่กรอกตัวเลขอะไรก็ได้มา (ด่านนี้มีเทสต์ครอบอยู่แล้ว ชื่อ
`'กรอก quantity เองก็ยังข้ามด่านไม่ได้ (เช็คจากยอดถือจริงเสมอ)'` — ห้ามลบเทสต์นั้น)

และยังต้องคิด ณ **วันที่ได้ปันผล** ไม่ใช่วันนี้ เพราะการบันทึกย้อนหลังคือ Use Case
ปกติ (ได้ปันผล 10 มี.ค. → ขายหมด 20 มี.ค. → มาบันทึก 25 มี.ค. ต้องทำได้)

### 1.3 `backend/src/controllers/transactions.controller.js` → `createDividend`

ส่วน `// ── 3) จำนวนหน่วยที่ได้ปันผล (Optional ...)` ตอนนี้เป็น:

```js
const hasQuantity = body.quantity !== undefined && body.quantity !== null && body.quantity !== '';
const quantity = hasQuantity ? toPositiveNumber(body.quantity) : null;
if (hasQuantity && quantity === null) { return fail(res, 'VALIDATION_ERROR', { field: 'quantity' }); }
```

เปลี่ยนเป็นบังคับ: ไม่ส่งมา / ส่งค่าไม่ถูกต้อง → `400 VALIDATION_ERROR { field: 'quantity' }`
(ใช้ `toPositiveNumber` เดิมได้เลย — มันปฏิเสธ `0`/`''`/`null`/Array/NaN ให้อยู่แล้ว)

แก้ Comment หัวบล็อกให้เลิกเขียนว่า Optional ด้วย

### 1.4 เทสต์ที่ผูกกับพฤติกรรมเดิม (ต้องกลับด้าน ไม่ใช่ลบทิ้ง)

| ไฟล์ | เคส | ต้องเปลี่ยนเป็น |
|---|---|---|
| `tests/dividendService.test.js:116` | `'เขียนแถว type=dividend พร้อม quantity = ยอดถือ ณ วันนั้น และ DPS ที่คำนวณได้'` | ส่ง `quantity` มาด้วยเสมอ + แก้ชื่อเทสต์ให้ตรงพฤติกรรมใหม่ |
| `tests/dividendService.test.js` | `'ไม่ระบุวันที่ → ใช้วันนี้ตาม Asia/Bangkok'` | ยังคงไว้ แต่ต้องส่ง `quantity` มาด้วย |
| `tests/dividendService.test.js` | เคส DPS ไม่ถูกปัดเป็น 0 (หน่วยเยอะมาก) | ส่ง `quantity` ตรงๆ แทนการพึ่ง auto-fill |
| `tests/dividendService.test.js` | Cross-User 2 เคส + `'สินทรัพย์สกุล USD'` | ส่ง `quantity` เพิ่ม |
| `tests/dividendEndpoint.integration.test.js` | ทุกเคสที่ยิง Request สำเร็จ | ใส่ `quantity` ใน Body |
| **เพิ่มใหม่** | ทั้ง 2 ไฟล์ | **ไม่ส่ง `quantity` → `VALIDATION_ERROR` / HTTP 400 และ `transactionRepository.create` ต้องไม่ถูกเรียกเลย** |

### 1.5 เอกสารที่ต้องแก้ให้ตรงของจริง

- `docs/API.md` § 15.10 — ตาราง Field: `quantity` เปลี่ยนจาก "—" เป็น "✅ บังคับ"
  และลบข้อความ *"ไม่ส่ง = ยอดถือ ณ `date`"* ออก แทนด้วยคำอธิบายว่าทำไมถึงบังคับ
- `docs/DATABASE.md` — หัวข้อ *"`quantity` และ `price_per_unit` ของแถว `dividend`
  เก็บอะไร"* บรรทัดที่เขียนว่า "ผู้ใช้กรอกทับเองได้" ต้องเปลี่ยนเป็น "ผู้ใช้กรอกเสมอ"
- `docs/CHANGELOG.md` — เพิ่มบรรทัดใต้ Entry Stage 6b ว่าแก้เป็นบังคับตามมติ Founder
  (**อย่าเขียน Entry ใหม่แยก** — ต่อท้าย Entry เดิมเพราะเป็น Feature เดียวกัน)
- `docs/DECISIONS_LOG.md` — บันทึกมติข้อนี้ (Design Doc § 8 ไม่มีคำถามข้อนี้ เพิ่งเกิด
  ตอน Implement) ระบุเหตุผล: Silent Default ขัดกฎยืนข้อ 11

### 1.6 Definition of Done ของงานที่ 1

1. เทสต์ทั้งชุดเขียว — **รายงานตัวเลขก่อน/หลัง** (ฐานปัจจุบันคือ 125 suites / 2,484)
2. **Red-Green จริง**: ถอด `throw` ที่บังคับ `quantity` ออก → ต้องเห็นเทสต์ใหม่แดง
   → ใส่กลับ → เขียว (รายงานจำนวนแดง/เขียวจริง อย่าเขียนว่า "น่าจะแดง")
3. `npx eslint` สะอาดบนไฟล์ที่แตะ
4. Commit แยกของตัวเอง (ห้าม amend `a9f8f3d`) ข้อความประมาณ
   `fix(stage6b): บังคับกรอก quantity ของปันผล (เลิก Silent Default ตามมติ Founder)`

---

## งานที่ 2 — Stage 8: Endpoint ใหม่ทั้งหมด

ทำต่อได้เลยหลังงานที่ 1 จบ ตาม `docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md`
§ 4.1–4.4 · **Commit แยกทีละกลุ่ม Endpoint** ไม่รวมเป็นก้อนเดียว

| กลุ่ม | Endpoint | อ้างอิง |
|---|---|---|
| Portfolios | ทำ `docs/API.md § 14.2` ที่มี Spec อยู่แล้วให้เป็นจริง | Design Doc § 4.1 |
| Brokers | 4 endpoint (Free ทั้งหมด) — **ตรวจก่อนว่ามีอยู่แล้วหรือยัง** เพราะ Stage 1 สร้าง `brokers.routes.js` + `broker.service.js` ไปแล้ว | Design Doc § 4.2 |
| Allocation | `groupBy=broker\|sector\|assetType` | Design Doc § 4.3 |
| Assets | ขยายของเดิม (ไม่ใช่ Endpoint ใหม่) | Design Doc § 4.4 |

### กับดักที่ต้องระวังเป็นพิเศษ

1. **⚠️ `GET /portfolios` ต้องเป็น Free ไม่ใช่ Premium** — `API.md § 14.2` เขียนไว้
   เป็น Premium ซึ่ง **ผิด** หลัง Backfill (migration 044) ทุกคนมีพอร์ต Default
   ถ้าคืน 403 หน้า Dashboard ของผู้ใช้ Free พังทันที **ตัวคุมสิทธิ์จริงคือ `POST`**
   → ต้องแก้ Spec ใน API.md ด้วย ไม่ใช่แค่เขียนโค้ดให้ต่าง

2. **Cross-User Isolation (กฎเหล็กข้อ 3)** — `portfolioId`/`brokerId` ที่มาจาก
   Request Body/Query **ต้อง SELECT ยืนยันเจ้าของก่อนใช้เสมอ** FK ตรวจแค่ว่า
   "มีอยู่จริง" ไม่ได้ตรวจ "ของใคร" · ตารางใหม่ทุกตัวต้องลงทะเบียนใน
   `TABLE_REGISTRY` + ผ่าน `queryForUser` (`utils/ownership.util.js`)
   → มี `assertOwnedBrokerId` ใน `broker.service.js` เป็นแบบอย่างอยู่แล้ว **Reuse**

3. **Entitlement ของ Multi-portfolio** (มติ Founder ที่ตัดสินแล้ว ห้ามถามซ้ำ):
   - Free = **1 พอร์ตเท่านั้น** (`AI_CONTEXT.md` บรรทัด 95) เพดานเดิม
     `FREE_TIER_ASSET_LIMIT = 2` ไม่ต้องแก้
   - Premium หมดอายุแต่มี 3 พอร์ต = **"อ่านได้ เขียนไม่ได้"** ห้ามลบข้อมูล
     "พอร์ตไหนคือส่วนเกิน" ต้อง Deterministic — เรียงตาม `created_at`
     **พอร์ตแรกสุด = พอร์ตที่ยังเขียนได้**
   - **Sanity Cap 50 พอร์ตต่อ user**

4. **ห้ามสร้าง Logic คู่ขนาน** — Allocation ต้องใช้ `portfolio.service` ตัวเดิม
   (Design Doc § 4.3 ระบุไว้ตรงๆ) ห้ามเขียนสูตรคำนวณมูลค่าขึ้นมาใหม่

---

## กฎที่ห้ามละเมิด (ย้ำ — ใช้กับทุกงานในไฟล์นี้)

1. **ห้าม Push / Merge / Deploy** จนกว่า Founder อนุมัติเป็นลายลักษณ์อักษร
   — commit local เท่านั้น
2. **Immutable Ledger** — ห้าม `DELETE`/`UPDATE` transaction
3. **Migration ต้อง Apply + Verify บน Supabase ก่อน Deploy Code เสมอ**
   (042–047 **ยังไม่ได้ Apply สักตัว** Founder จะรันเอง — เขียน Verify Query
   ท้ายไฟล์ให้ครบทุกตัวที่สร้างใหม่)
4. **ห้ามลบ Dashboard เดิม / ไฟล์ Demo เดิม**
5. Migration ต้องล็อก `search_path` ตาม Pattern `028`
6. **DoD 4 ชั้น** ทุก Stage: Unit → Integration → **Regression (Red-Green จริง
   ถอด Fix ออกต้องเห็นแดงก่อน)** → Production Verification
   — รอบนี้ชั้นที่ 4 ทำไม่ได้เพราะห้าม Deploy **ต้องระบุชัดในรายงานว่ายังไม่ได้ Verify**
7. **ห้ามเขียนว่า "ปิดสมบูรณ์" ถ้ายังไม่ผ่าน DoD ครบ 4 ชั้น**

---

## สิ่งที่ยังค้างอยู่ทั้งโปรเจกต์ (ให้รู้ไว้ อย่าเพิ่งทำ)

- **Red-Green ระดับ SQL** ของ constraint ทั้ง `046` และ `047` — Script เขียนไว้ท้าย
  ไฟล์ migration แล้ว แต่รันไม่ได้เพราะเครื่องไม่มี Docker/psql **รอ Founder รันบน
  Supabase Branch** อย่าเขียนว่าผ่านแล้ว
- **Stage 9** (ต่อ Frontend) — ยังไม่เริ่ม · ตอนทำ: Port UI จาก `demo/*` มาใส่บน
  `main` **ทีละไฟล์ ห้าม merge branch `demo/multipage-ux-redesign`**
  (`git diff main..demo` มี 6,872 deletions จะลบงาน Slip OCR + มาสคอต + Premium
  fixes ที่ Deploy ไปแล้วทิ้งหมด) · ทำเป็น Route คู่ขนาน/Feature Flag ก่อน ·
  แทน `frontend/src/lib/demo/planEntitlements.js` (ของปลอม) ด้วย Entitlement จริง
  จาก `/dashboard/me` · Reuse `frontend/src/lib/api.js` **ห้ามเขียน API Client ใหม่**
- **Stock Dividend** (ปันผลเป็นหุ้น) — เลื่อนไปรอบหน้าตามมติ Founder Q4.4
  จะเป็น type ที่ 5 แยกต่างหาก (`heldQuantitySign` ต้องเป็น `+qty` ไม่ใช่ `0`)

---

## หมายเหตุเรื่อง `.git/index.lock`

Session ก่อนหน้าโดนตัดกลางคันตอนตี 4 แล้วทิ้ง `index.lock` (0 byte) ค้างไว้ — ถูกลบไปแล้ว
**ถ้าเจอ lock อีกครั้ง อย่าเพิ่งลบทันที** ให้เช็ค `pgrep -a git` และ timestamp ของไฟล์ก่อน
ว่ามี git process รันอยู่จริงไหม

---

## รายงานที่อยากได้ตอนจบ

0. **Model ที่ใช้จริงในแต่ละงาน** (ถ้าไม่ได้ใช้ Opus ตามตารางด้านบน ต้องบอกตรงๆ
   ว่างานไหนใช้อะไร — ห้ามเงียบ)
1. ตัวเลขเทสต์ **ก่อน/หลัง** ของแต่ละ Commit
2. ตาราง Red-Green ที่ **รันจริง** (ถอดอะไร → แดงกี่ตัว → ใส่กลับเขียวกี่ตัว)
3. รายการสิ่งที่ **ยังไม่ได้ Verify** อย่างตรงไปตรงมา
4. จุดที่ **ต่างจาก Design Doc โดยตั้งใจ** พร้อมเหตุผล (ถ้ามี)
5. คำถามที่ต้องให้ Founder ตัดสิน **ถ้ามีจริงเท่านั้น** — คำตอบเชิงธุรกิจทั้งหมด
   อยู่ใน `docs/HANDOFF_DASHBOARD_MULTIPORTFOLIO.md` § 3 แล้ว อย่าถามซ้ำ
