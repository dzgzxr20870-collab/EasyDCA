# Changelog

ทุก Entry ใหม่ให้เพิ่มต่อจาก Unreleased ด้านบนสุดเสมอ (ใหม่สุดอยู่บนสุด)

## [Unreleased]
### Added
- **🚀 Deploy + Apply migration `042`–`048` บน Production (27–28 ส.ค. 2569)**
  (บันทึกเต็ม: [`HANDOFF § 8`](./HANDOFF_DASHBOARD_MULTIPORTFOLIO.md))
  - Deploy `a05206d` (merge `feat/dashboard-production-wire` → `main`) ทั้ง `backend`
    และ `easydca-worker` · **ผู้ใช้จริง 20 คน ไม่ใช่ Staging**
  - `assets` 26 → **27** · `portfolios` **0 → 20** (Backfill) · `transactions` 71 → **74**
  - Verify ผ่านครบ: `045` 5 CHECK · `046` UNIQUE + 1 Signature · `047` CHECK 4 ค่า +
    `v_held_sign` · `048` 2 ฟังก์ชัน สิทธิ์เฉพาะ `service_role`
    · ⭐ ข้อกังวลเรื่อง **RPC Overload ค้าง** ที่ Audit รอบก่อนตรวจด้วยการ *อ่านโค้ด*
    **ยืนยันด้วยของจริงบน Postgres แล้วว่าถูกต้อง**

- **⭐ DoD ชั้นที่ 4 (Production Verification) ผ่านจริงครั้งแรกของโปรเจกต์**
  - **ผ่านแล้ว (มีหลักฐาน):** ซื้อ/ขาย/ดูกำไร/พอร์ต ผ่าน **LINE บนบัญชีจริง** ·
    Migration `042`–`048` ทั้งชุด · Backfill `044`/`045`
    · ซื้อ BTC 2 ครั้งติด → `assets` 26→**27** (แถวเดียว ไม่ใช่ 2) · แถวซ้ำ **0 แถว**
    · ขาย → ยอดถือ `0.00007572 − 0.00001894 = 0.00005678` ตรงเป๊ะ
    · ดูกำไร → ต้นทุนเฉลี่ย 2,641,246.91 · เงินลงทุน 149.97 (= 200 − 50.03)
    · **ชุดตัวเลขที่สอดคล้องกันนี้คือหลักฐานว่าหางทั้ง 5 ของบั๊ก Asset Resolution
      ปิดจริง** — ถ้ายังมีบั๊ก การซื้อครั้งที่ 2 จะแตกไปอีกแถวแล้วต้นทุนเฉลี่ยเพี้ยนทันที
  - **⏳ ยังไม่ได้ Verify:** หน้าเว็บ Stage 9 (`/app/*` — ยังไม่เคยเปิดในเบราว์เซอร์
    และ Flag ยังปิด) · ปุ่มเลือกพอร์ตบน LINE (ทุกคนมีพอร์ตเดียว ยังไม่มีใครเห็น) ·
    `POST /transactions/dividend` (ยังไม่มี UI เรียก) · Endpoint ชุด Stage 8
    (`/portfolios` · `/allocation` · `/assets` · `/brokers`) · PDPA ล้างชื่อพอร์ต/โบรก
    (ยังไม่มีคำขอลบจริง) · `portfolioSnapshot.job` รอบ Cron แรกหลัง `044`
  - ⚠️ **ยังห้ามเขียน "ปิดสมบูรณ์" กับ Stage 8/9** — สิ่งที่พูดได้คือ "เส้นทาง
    ซื้อ/ขาย/ดูกำไร/พอร์ต ผ่าน LINE ผ่าน DoD ชั้น 4 แล้ว" เท่านั้น

### Fixed
- **🔴 ลำดับ Migration/Deploy ที่สร้างช่องพังขึ้นมาเอง — LINE ล่มชั่วคราวบน Production**
  (Post-mortem: [`POSTMORTEM_MIGRATION_ORDER.md`](./POSTMORTEM_MIGRATION_ORDER.md))
  - **อาการ:** หลัง Deploy + Apply `042`→`045` **ทุกคำสั่งซื้อผ่าน LINE พังทันที**
    `Could not find the 'broker_id' column of 'pending_transactions' in the schema cache`
  - **สาเหตุ:** `pending_transactions.broker_id` ถูกเพิ่มโดย **`046`** แต่โค้ด Stage 5
    ที่เพิ่ง Deploy **เขียนคอลัมน์นี้ทุกครั้งที่สร้าง Pending** → **LINE พังตั้งแต่
    วินาทีที่ Deploy เสร็จ ไม่เกี่ยวกับ `044` เลย** · ช่วงพัง = "หลัง Deploy จนถึง
    ก่อน Apply `046`" ซึ่งลำดับที่วางไว้ทำให้กินเวลาตั้งแต่ขั้น 3 ถึงขั้น 8
  - **ความเสียหาย:** พังแบบ **ดัง** · **ไม่แตะ Ledger** · **ไม่มีข้อมูลเสียหาย**
    (พังที่ขั้นสร้าง Pending ซึ่งอยู่ก่อนการเขียน `transactions`)
  - **แก้:** Apply `046` แล้ว `NOTIFY pgrst, 'reload schema';` → กลับมาปกติทันที
  - **⭐ กฎที่ได้ — ต้องไล่ดูสองทิศก่อนวางลำดับเสมอ:** (1) migration ตัวไหนทำให้
    **โค้ดเดิม** พัง → Deploy ก่อน · (2) **โค้ดใหม่** ต้องการคอลัมน์/ฟังก์ชันจาก
    migration ตัวไหน → Apply ก่อน · รอบนี้ตอบทิศที่ 1 ไว้ละเอียดมากแต่
    **ไม่มีใครถามทิศที่ 2 เลย** ทั้งที่คำตอบอยู่ในโค้ดชัดๆ
    · ถ้าสองทิศชนกัน = **มีช่วงพังแน่นอน** ต้องยอมรับตั้งแต่วางแผนแล้วบีบให้สั้นที่สุด
    ไม่ใช่ปล่อยไปเจอหน้างาน
  - ⚠️ **เทสต์ 137 suites จับเคสนี้ไม่ได้เลยโดยธรรมชาติ** — ทุกตัว Mock Repository
    จึงไม่มีทางเห็น Schema จริง · นี่คือประเภทที่ต้องกันด้วย **Checklist ตอนวางแผน
    Deploy** ไม่ใช่ด้วยเทสต์ (ดู Post-mortem § 4)
  - แก้คำกล่าวอ้างใน `HANDOFF` ที่ถูกพิสูจน์แล้วว่าผิด: *"เป็นลำดับเดียวที่ไม่มี
    ช่วงเวลาที่ระบบพัง"*

### Added
- **🔒 PDPA: ล้างชื่อ `portfolios` / `brokers` ตอน Erasure (มติ Founder 27 ส.ค. 2569)**
  (มติเต็ม: [`DECISIONS_LOG.md`](./DECISIONS_LOG.md) · ตารางขอบเขต: [`SECURITY.md § 8.1`](./SECURITY.md))
  - ชื่อทั้งสองตารางเป็นข้อความที่ผู้ใช้พิมพ์เอง อาจมี PII จริง (เช่น *"พอร์ตของสมชาย"*)
    และเป็น **ป้ายกำกับล้วน ไม่เข้าสูตรคำนวณเงินสักสูตร** → **เกราะ Immutable Ledger
    ที่ปกป้อง `transactions` ไม่ครอบสองตัวนี้** (ลบชื่อทิ้งแล้วตัวเลขทุกตัวยังเท่าเดิม)
  - ⚠️ **Anonymize ไม่ใช่ DELETE** — ลบแถวจะทำให้ `assets.portfolio_id`/`broker_id`
    เป็น `NULL` (FK `ON DELETE SET NULL`) = แก้ข้อมูลการลงทุนของผู้ใช้ และในกรณีพอร์ต
    ยัง **ละเมิด Invariant ของ migration 044/045** โดยตรง
  - 🔴 **กับดัก `uniq_brokers_user_name_ci ON (user_id, lower(name))`** (migration 042):
    ถ้าตั้งชื่อโบรกซ้ำกันทุกแถว ผู้ใช้ที่มีหลายโบรกจะ **ชน UNIQUE → Erasure ล้มทั้งก้อน**
    แล้วคนที่ยื่นคำขอลบข้อมูลจะลบไม่ได้เลย → ต่อท้ายด้วย 8 ตัวแรกของ `id`
    · มีเทสต์จำลอง **ผู้ใช้ที่มี 3 พอร์ต + 3 โบรก** โดยเฉพาะ (ผู้ใช้ที่มีอันเดียวจับไม่ได้)
    · ตรวจ Schema จริงแล้ว: `portfolios` **ไม่มี** UNIQUE บนชื่อ แต่ใส่ตัวแยกไว้เหมือนกัน
  - ⚠️ **ไม่ Error-Isolated โดยเจตนา** — ถ้าล้างชื่อไม่สำเร็จแล้วเดินหน้า Anonymize ต่อ
    ผู้ใช้จะถูกบอกว่า "ลบข้อมูลแล้ว" ทั้งที่ชื่อยังอยู่ครบ = คำตอบที่ผิดต่อคำขอตามกฎหมาย
  - 📌 **Open Question บันทึกไว้แล้ว (ยังไม่แก้)** — `transactions.note` ก็เป็นข้อความ
    อิสระที่ผู้ใช้พิมพ์เองเหมือนกัน และการอ้าง Immutable Ledger เพื่อเก็บไว้หลังคำขอลบ
    เป็นฐานที่อ่อนกว่าที่คิด · **ต้องมีคนตัดสินก่อนมีผู้ใช้จริงยื่นคำขอลบ**
  - Test **BE 136 / 2,715 → 137 / 2,728** เขียวทั้งหมด (+13) · ESLint 0 error
- **⭐ กติกาพอร์ตบน LINE ตามมติ Founder ใหม่ (27 ส.ค. 2569 รอบ 2)**
  (มติเต็ม: [`DECISIONS_LOG.md`](./DECISIONS_LOG.md))
  - **เกณฑ์ฝั่ง "ซื้อ" เปลี่ยนจาก "Symbol กำกวม" เป็น "ผู้ใช้มีกี่พอร์ต"** — มี > 1 พอร์ต
    เมื่อไหร่ **ถามเสมอ** แม้ Symbol นั้นยังไม่เคยถือที่ไหนเลย · ปิด **Silent Default
    ตัวสุดท้าย** ของเรื่องนี้ (เดิมซื้อ Symbol ใหม่ขณะมีหลายพอร์ต → ลงพอร์ต Default เงียบๆ)
  - **ฝั่ง "ขาย" คงเกณฑ์เดิม** (ถามเฉพาะเมื่อ Symbol อยู่หลายพอร์ต) — ⚠️ **ความไม่สมมาตร
    นี้ตั้งใจ ห้ามแก้ให้เหมือนกัน**: ปลายทางของการซื้อเป็น *ทางเลือก* ส่วนของการขายเป็น
    *ข้อเท็จจริง* · ถามตอนขายทั้งที่ถือพอร์ตเดียว = คำถามที่มีคำตอบเดียวให้กด (กฎยืนข้อ 10)
  - **⭐ ผู้ใช้พอร์ตเดียว (Free แทบทั้งหมดของระบบ) ไม่ถูกกระทบเลยแม้แต่ขั้นตอนเดียว**
    — มีเทสต์ยืนยันตรงๆ 3 เคส ไม่ใช่แค่เชื่อว่าตรรกะถูก
  - **ข้อความแยกตามเหตุผลที่ถาม** — เคส "ทางเลือก" ห้ามเขียนว่า *"คุณถือ XXX อยู่มากกว่า
    1 พอร์ต"* เพราะผู้ใช้อาจยังไม่เคยถือเลย (คอมเมนต์/ข้อความต้องไม่โกหก)
  - **สร้างพอร์ตใหม่ทำได้บน Dashboard เท่านั้น** — ไม่มีปุ่มสร้างใน Quick Reply ·
    ชี้ทางเป็น **ข้อความ** ที่ประกอบจาก `FRONTEND_URL` (ไม่ตั้ง = ไม่ใส่ URL เลย
    เพราะปุ่ม `uri` ว่างทำให้ LINE ปฏิเสธทั้งข้อความด้วย 400)
  - ต้นทุน: **Query เพิ่ม 1 ครั้งเฉพาะเส้นทาง "ซื้อทาง LINE ที่ยังไม่ระบุพอร์ต"**
    — เลี่ยงไม่ได้เพราะไม่มี Flow ไหนบนเส้นทางนั้นดึงรายการพอร์ตมาก่อน และการเดาจาก
    `user.plan` ผิดจริงกับผู้ใช้ที่ Premium หมดอายุ (กฎยืนข้อ 10 vs 11 ตีกัน → เลือกไม่เดา)
  - Test **BE 136 / 2,704 → 136 / 2,715** เขียวทั้งหมด (+11) · ESLint 0 error
- **🔍 Audit ทั้งระบบก่อน Apply migration (27 ส.ค. 2569) — เจอหางที่ 4**
  (Post-mortem § 12: [`POSTMORTEM_PORTFOLIO_RESOLUTION.md`](./POSTMORTEM_PORTFOLIO_RESOLUTION.md))
  - **🔴 `portfolioSnapshot.job` ส่ง `portfolioId = null` แบบ Hardcode** → หลัง `044`
    ทุก Holding โยน `ASSET_NOT_FOUND` แล้วถูก `catch` นับเป็น `excludedCount` →
    **`totalCurrentValue = null` ทุกคืน ทุกคน โดยไม่มี Error ที่ไหนเลย**
    (กราฟมูลค่าย้อนหลังว่างเปล่า) · แก้เป็น `holding.portfolioId ?? null`
    — **ไม่ใช่ `undefined`** เพราะถือ Symbol เดียวกัน 2 พอร์ตจะตกหล่นทั้งคู่
  - **🟠 `dashboard.controller.getProfit` ส่ง `null` เช่นกัน** → `GET /dashboard/profit/:symbol`
    ตอบ 404 ทุกครั้งหลัง `044` · แก้เป็นรับ `?portfolioId` (กติกา 3 ทางเดียวกับ
    `?brokerId`) ผ่าน `assertOwnedPortfolioId` + Map `AMBIGUOUS_ASSET_PORTFOLIO` เป็น 409
  - **⭐ บทเรียน: "แก้ที่ Resolver ไม่ได้แปลว่าแก้ครบ"** — กติกา 3 ทางเป็นสัญญาที่
    ผูกกับ **ทุก Call Site** จำนวนจุดที่ต้องแก้ = จำนวน Call Site ไม่ใช่จำนวน
    ฟังก์ชันต้นตอ · เมื่อเปลี่ยนความหมายของ Argument ต้อง `grep` Call Site
    ทุกจุดแล้วไล่ทีละอันในรอบเดียวกัน
  - **🔒 Cross-User Audit ของ Endpoint ใหม่ — ไม่พบช่องโหว่** แต่ขยาย
    `idorEndToEnd.regression.test.js` จาก **14 → 24 เคส** เพราะ Endpoint ชุด
    Stage 1/8 (`/portfolios/*` · `/assets` · `/brokers/*` · `/transactions/dividend` ·
    `/portfolio/allocation`) **ไม่เคยถูกครอบด้วยเทสต์ IDOR ระดับ HTTP เลยสักตัว**
    · ⭐ เพิ่มเวกเตอร์ **"id ที่มาทาง Body"** ซึ่งการ Grep `:id` ใน `routes/` มองไม่เห็น
  - **🧪 กวาด Mock ที่หลวมกว่าของจริง** — `portfolioWriteGate.regression.test.js`
    (ด่าน Entitlement) พิสูจน์แล้วว่า **ถอด Fix ออกแล้วยังเขียว 12/12** = เทสต์
    พิสูจน์อะไรไม่ได้เลย · แก้เป็น `mockImplementation` ที่กรองจริง → ถอดแล้วแดงทันที
  - **📋 อ่านทวน migration 042–048 เทียบ Schema จริง — ไม่พบปัญหา**
    RPC ทุกตัวเหลือ Signature เดียวหลัง Apply ครบ (`046` DROP ตรงกับนิยาม `035` เป๊ะ ·
    `047` พารามิเตอร์ 11 ตัวเท่า `041` ทุกตัวจึง `CREATE OR REPLACE` ได้ · `048` ชื่อใหม่)
    · ชื่อ Argument ของ RPC ตรงกับที่โค้ดส่งจริงครบทั้ง 4 ตัว · ลำดับ 042→048
    ไม่มีตัวไหนพึ่งของที่ตัวถัดไปเพิ่งสร้าง · `GRANT EXECUTE` ให้ `service_role` เท่านั้น
  - **📝 Audit คอมเมนต์เชิงโครงสร้าง 45 ไฟล์** — แก้ 1 จุดที่ล้าสมัย
    (`broker.service` เขียนว่า `assertOwnedBrokerId` ใช้แค่ "assets PATCH"
    ทั้งที่มี 4 จุดแล้ว) · เพิ่มเอกสาร RLS ของ `brokers` ลง `DATABASE.md § 3`
    (เปิด RLS โดย **ไม่มี Policy โดยเจตนา** = service_role เท่านั้น — เข้มกว่าตารางอื่น
    ไม่ใช่หลวมกว่า แต่ไม่เคยถูกเขียนไว้ที่ไหนเลย)
- **Stage 9 (3/3) — ปิดงานที่เหลือทั้งหมดของ Dashboard แยกหน้า**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**)
  - **Modal สร้างพอร์ตใหม่** (`CreatePortfolioModal`) — `POST /api/v1/portfolios`
    ผ่าน `lib/portfolioApi.js` → `lib/api.js` เดิม (**ไม่มี API Client ใหม่**)
    · เปิดผ่าน Query Param `?new=1` เพราะปุ่มอยู่บน Topbar ของ `AppShell` ซึ่งเป็น
    **คนละ Component** กับหน้าพอร์ต (State ภายในจะต้องยกขึ้นไปที่ Shell โดยไม่จำเป็น)
    · ⚠️ **`PORTFOLIO_LIMIT_REACHED` กับ `PORTFOLIO_CAP_REACHED` ใช้ข้อความคนละอัน** —
    คนที่ชน Sanity Cap 50 คือผู้ใช้ Premium ที่จ่ายเงินอยู่แล้ว การชวน "อัปเกรด"
    กับเขาคือข้อความที่ผิด · ทางออกจริงของเขาคือลบพอร์ตที่ไม่ได้ใช้
    · ⚠️ ตัวเลือกประเภทไม่มี `'mixed'` (ไม่มีจริงใน CHECK — `044` แก้เป็น `'custom'`)
  - **กราฟโดนัทสัดส่วนพอร์ต** (`AllocationDonut`) — วาดจาก `groups` + `percent` ที่
    Backend คำนวณมาแล้ว **ไม่มีสูตรเงินอยู่ในไฟล์นี้เลยแม้แต่บรรทัดเดียว** (กฎยืนข้อ 1)
    · Legend เขียนเองแทนของ Chart.js เพราะ Legend ในตัวคำนวณ % เองจาก data ซึ่งอาจ
    ไม่ตรงกับ Backend เมื่อมีการปัดเศษ = เลขสองที่ไม่ตรงกันบนหน้าจอเดียวกัน
    · ⭐ **ทุกกลุ่มมูลค่า 0 (ราคาดึงไม่ได้) → ขึ้น "ราคาไม่พร้อมใช้งาน" ไม่ใช่วงกลมว่าง**
    และแยกจากกรณี "ยังไม่มีข้อมูล" ซึ่งเป็นคนละเรื่อง
  - **กราฟเส้นเงินลงทุนสะสม** บนหน้าแดชบอร์ด — **Reuse `InvestedChart` ตัวเดิมของ
    `DashboardHome` ไม่ได้เขียนกราฟใหม่** (รับ `overview.monthlyInvested` Shape
    เดียวกันเป๊ะ และทำเรื่องที่เขียนใหม่แล้วมักพลาดไว้ถูกแล้ว: แยกเส้น THB/USD ·
    ขึ้นข้อความแทนเส้นแบนที่ 0 · Footnote ว่านี่คือ "เงินที่ลงไปสะสม" ไม่ใช่มูลค่า
    พอร์ตย้อนหลัง) · ⚠️ Render เฉพาะเมื่อเป็น Array จริง **ห้ามใส่ `?? []`** เพราะ
    Array ว่างวาดกราฟเปล่าที่อ่านได้ว่า "ผู้ใช้ไม่เคยลงทุน" ทั้งที่ความจริงคือ
    "ระบบไม่มีข้อมูลส่วนนี้"
  - **ผูก Action ปุ่มบันทึกซื้อ/ขายในหน้าพอร์ต** — เปิด `RecordTransactionModal`
    ตัวเดิมโดยเพิ่ม prop `defaultType` (เป็นแค่ค่าเริ่มต้น **ไม่ใช่การล็อกโหมด**
    ผู้ใช้ยังสลับแท็บได้) · ⭐ ปุ่ม "บันทึกการขาย" **ไม่ถูก disabled ไม่ว่ากรณีใด**
    แม้พอร์ตถูกล็อก (มติ Founder 24 ส.ค. 2569 — ถ้าปิดด้วย ผู้ใช้จะคิดว่าติดกับ
    แล้วไม่บันทึกการขายจริง → ยอดในพอร์ตผิดถาวร)
  - **🎨 เติม CSS ที่ค้างมาตั้งแต่ `b530d2c`** — Class ชุดใหญ่ของ Stage 9
    (`.demo-page` `.demo-field` `.demo-btn` `.demo-modal-*` `.demo-alloc-*` ...)
    ถูกใช้ในทุกหน้าแต่ **ไม่เคยถูกนิยามที่ใดเลย** หน้าจึงเรนเดอร์ด้วย Default ของ
    เบราว์เซอร์ล้วน · สาเหตุ: Design Token ประกาศไว้ที่ `.demo-app` แต่ Shell ของ
    Stage 9 ใช้ `.demo-shell` เป็นราก → `var(--…)` ไม่ Resolve เลยสักตัว
    · ⚠️ ประกาศ Token ซ้ำที่ `.demo-shell` **ไม่ย้ายไป `:root`** เพราะจะรั่วไปทับ
    Dashboard เดิม / Login / Premium ที่มี Palette ของตัวเอง
  - ข้อบังคับเดิมยังครบทุกข้อ (ตรวจด้วย `grep` จริง): Feature Flag + Route คู่ขนาน
    · ไม่แตะ `/dashboard` เดิม · `<Link>`/`navigate()` ไม่มี `<a href>` เลย
    · ไม่มี `localStorage`/`sessionStorage` · ไม่มี `fetch()` ตรง (ใช้ `lib/api.js`
    ทั้งหมด) · `lib/demo/*` ไม่ถูก Import เข้าเส้นทาง Production แม้แต่ไฟล์เดียว
  - Test **FE 17 files / 298 → 18 files / 310** เขียวทั้งหมด · `vite build` ผ่าน
- **🔴 ปิดหางของบั๊ก Asset Resolution อีก 2 เส้น (พบตอนรีวิว `6cf6aa1`)**
  (Post-mortem § 10 + § 11: [`POSTMORTEM_PORTFOLIO_RESOLUTION.md`](./POSTMORTEM_PORTFOLIO_RESOLUTION.md))
  - **หางเส้นที่ 2 — ระบุโบรกแล้วข้ามด่านพอร์ตทั้งหมด:** `resolveOwnedAsset` ให้
    branch ของโบรก `return` ออกไป**ก่อน**ถึงด่านพอร์ต → ผู้ใช้ที่ตอบโบรกมาแล้วและ
    ถือ Symbol นั้นที่โบรกเดียวกันใน 2 พอร์ต จะถูก `.find()` **หยิบแถวแรกตาม
    `created_at` เงียบๆ** → เขียนธุรกรรมเข้าพอร์ตผิด → **ต้นทุนเฉลี่ยของทั้งสอง
    พอร์ตเพี้ยนพร้อมกัน** · แก้โดยย้ายด่านพอร์ตขึ้นไปก่อนจุด `return` ทุกจุด และ
    ตัดสินจาก "ปลายทางที่ยังเป็นไปได้" แทน `candidates` ดิบ
  - **หางเส้นที่ 3 — รอยต่อ Preview→Confirm ไม่เคยพก `portfolioId`:**
    `pendingTransaction.service` **ไม่ถูกแตะเลยในการแก้รอบที่ 1** ทั้งที่เอกสารเขียน
    ว่า "ลบ `?? null` ทุกจุด" → LINE (ซึ่งไม่เคยส่ง `portfolioId` มา) เก็บ `NULL`
    ลง `pending_transactions` ตอน Preview แล้วตอน Confirm ค้นด้วย
    `portfolio_id IS NULL` → หลัง Apply `044` **หาสินทรัพย์เดิมไม่เจอ → สร้างแถวซ้ำ**
    (และแถวใหม่ยังละเมิด Invariant ของ `045`) · **นี่คือเส้นทางที่ผู้ใช้ใช้บ่อยที่สุด
    ของทั้งผลิตภัณฑ์** · แก้โดยให้ `validateBuy`/`validateSell` คืน `portfolioId`
    ที่ Resolve ได้จริง แล้ว `createPending`/`createBatch` เก็บค่านั้น (Pattern เดียว
    กับ `brokerId` ของ Stage 5 เป๊ะ) · `bulkImport` พก `portfolioId` + `brokerId`
    ต่อรายการด้วย (`createBatch` ไม่เคยเก็บ `broker_id` เลย = บั๊กคลาสเดียวกันที่รออยู่)
  - ✅ **ไม่ต้องทำ migration 049** — `pending_transactions.portfolio_id` มีอยู่แล้ว
    ตั้งแต่ `migration 001` พร้อม `ON DELETE SET NULL` ตรง Pattern ที่ต้องการเป๊ะ
  - **⭐ บทเรียนข้อ 1 เกิดซ้ำในไฟล์เดียวกันเป็นครั้งที่ 2:** คอมเมนต์เขียนว่า
    *"ตรวจพอร์ตก่อนโบรกเสมอ"* ทั้งที่โครงสร้างจริงไม่ได้ตรวจก่อน · และเอกสาร
    Post-mortem เองก็เขียนประโยคเดียวกันซ้ำ → **กฎใหม่: คำว่า "เสมอ/ทุกจุด/ที่เดียว"
    ในคอมเมนต์คือข้อผูกพันที่ต้องพิสูจน์ด้วย `grep` จริงก่อน Commit ทุกครั้ง**
  - **⭐ บทเรียนข้อ 3 เกิดซ้ำคนละรูป:** รอบแรกคือ *Mock ทั้ง Repository จนของจริง
    ไม่เคยถูกรัน* · รอบนี้คือ ***Mock ที่หลวมกว่าของจริง*** —
    `findAllByUserAndSymbol.mockResolvedValue([...])` ไม่สนใจ Argument `portfolioId`
    เลย จึงเขียวสนิทตลอดเวลาที่บั๊กมีอยู่ → **Mock ของ Repository ที่มี Argument
    ควบคุมการกรอง ต้องจำลองการกรองนั้นจริง (`mockImplementation`)**
  - **⭐ เทสต์ที่ครอบแต่ละมิติครบ ≠ ครอบจุดตัดของทั้งสองมิติ** — 18 เคสของรอบที่ 1
    ไม่มีเคสไหนผสม "ระบุโบรก + Symbol อยู่ 2 พอร์ต" เลย · จำนวนเคสที่ต้องครอบคือ
    **ผลคูณ** ไม่ใช่ผลบวก
  - **Red-Green จริง 5 ชุด** (ดู Post-mortem § 7 + § 11.4)
  - Test **133 suites / 2,645 → 134 suites / 2,667** · ESLint 0 error

- **⭐ ปุ่มเลือกพอร์ตบน LINE (`pick_portfolio`) — Reuse Pattern ของ Broker Picker 100%**
  - เดิมกำกวมมิติพอร์ตแล้ว LINE ตอบแค่ "กรุณาใช้เว็บ" = **ผู้ใช้ Premium ที่แยกพอร์ต
    บันทึกหุ้นที่ถือข้ามพอร์ตผ่าน LINE ไม่ได้เลย** ซึ่งขัดกับจุดขายหลักของผลิตภัณฑ์
  - Quick Reply + Postback ที่พกพารามิเตอร์คำสั่งเดิม → **ไม่มีตาราง Session ใหม่
    ไม่มี State ค้างให้หมดอายุ** (ผู้ใช้ทิ้ง Flow ไว้เฉยๆ ก็จบไปเอง)
  - ⭐ **มิติที่ตอบไปแล้วถูกพกต่อในปุ่มรอบถัดไป** (`broker` + `pf` อยู่ด้วยกันได้)
    — ถ้าไม่พก ระบบจะลืมคำตอบรอบแรกแล้ววนถามซ้ำเป็น Loop ที่ผู้ใช้ออกไม่ได้
  - `portfolioId` จาก Postback ผ่าน **`assertOwnedPortfolioId`** ก่อนใช้เสมอ
    (กฎยืนข้อ 4 · คู่แฝดของ `assertOwnedBrokerId` · ตอบ 404 ไม่ใช่ 403)
  - `label` ตัดที่ **20 Unicode Code Point** ด้วย `truncateCodePoints` ไม่ใช่ `slice()`
  - 🔒 พอร์ตที่เพิ่มรายการใหม่ไม่ได้ **ยังโชว์เป็นตัวเลือก** (ซ่อน = ผู้ใช้คิดว่าของหาย)
    · ติดแม่กุญแจเฉพาะคำสั่ง **ซื้อ** เท่านั้น — คำสั่ง **ขาย** ต้องไม่มีแม่กุญแจเลย
    · ⚠️ เป็น **UX ล้วน ไม่ใช่ Gate** — ด่านจริงอยู่ที่ `validateBuy` เสมอ
  - แก้บั๊กพ่วง: `pick_broker` + `cmd=profit` เคยส่ง `portfolioId = null` แบบ Hardcode
    (= "เจาะจงว่าไม่มีพอร์ต") ซึ่งหลัง Apply `044` จะหาสินทรัพย์ไม่เจอเลยสักตัว
  - Test **134 suites / 2,667 → 135 suites / 2,684** · ESLint 0 error
- **🔴 แก้บั๊ก Asset Resolution ที่บล็อกการ Apply migration 044**
  (Post-mortem เต็ม: [`POSTMORTEM_PORTFOLIO_RESOLUTION.md`](./POSTMORTEM_PORTFOLIO_RESOLUTION.md))
  - **อาการ:** `044` Backfill ให้สินทรัพย์ทุกแถวมี `portfolio_id` → ไม่เหลือแถวที่
    `portfolio_id IS NULL` แต่โค้ดค้นหาด้วย `.is('portfolio_id', null)` เสมอ
    (`resolveOwnedAsset` มี Default `portfolioId = null` + Caller ทุกตัวเขียน
    `?? null` ตามกันหมด) → **หาสินทรัพย์เดิมไม่เจอทุกครั้ง** พังพร้อมกัน 4 จุด:
    🔴 **ซื้อ → สร้างแถวซ้ำ → ประวัติแตกคนละ `asset_id` → ต้นทุนเฉลี่ย/P&L ผิด
    แบบเงียบสนิท (แตะเงินจริง)** · 🟠 ขาย/ดูกำไร/LINE หาไม่เจอ (พังดัง)
  - **จับได้ก่อน Apply — ไม่มีข้อมูลผู้ใช้เสียหายจริง**
  - **แก้:** ทำให้ `portfolioId` ใช้กติกาเดียวกับ `brokerId` ของ Stage 5 เป๊ะ
    (`undefined` = ไม่ระบุ/ไม่กรอง · `null` = เจาะจงว่าไม่มีพอร์ต · `uuid` = พอร์ตนั้น)
    · ลบ Default `= null` · ลบ `?? null` ทุกจุด · Repository แยก 3 ทาง
    · เพิ่ม `AMBIGUOUS_ASSET_PORTFOLIO` (409) — ถือหลายพอร์ตแล้วไม่ระบุ = **ถาม/Reject
    ห้ามเดา** (กฎยืนข้อ 11) ตรวจมิติพอร์ต**ก่อน**มิติโบรกเสมอ
    · สินทรัพย์ **ใหม่** ที่ไม่ระบุพอร์ต → ลงพอร์ต `is_default` (Invariant 044/045)
  - **⭐ บทเรียนที่มีค่ากว่าตัวบั๊ก:** ไฟล์ที่เกิดบั๊ก **มีคำเตือนเรื่องนี้เขียนไว้เอง
    อยู่แล้ว แต่ครอบแค่ `brokerId` ไม่ครอบ `portfolioId`** →
    **คำเตือนที่ครอบไม่ครบ อันตรายกว่าไม่มีคำเตือน** เพราะคนอ่านเห็นว่ามีคำเตือน
    แล้วสรุปว่า "ตรวจแล้ว" · ขยายคำเตือนให้ครอบทุกมิติ + กำกับว่าถ้าเพิ่มมิติที่ 3
    ในอนาคตต้องมาขยายด้วยเสมอ
  - **⭐ ทำไมเทสต์ 2,624 ตัวจับไม่ได้เลย:** ทุก Fixture จำลอง "โลกก่อน 044"
    (สินทรัพย์ไม่มี `portfolioId` หรือเป็น null ซึ่งตรงกับที่โค้ดค้นหาพอดี) →
    **กฎใหม่: Migration ที่เปลี่ยนรูปร่างข้อมูลเดิม ต้องมาพร้อม Fixture ของ
    "โลกหลัง Migration" เสมอ**
  - **บทเรียนซ้อน (ซ้ำรอย POSTMORTEM_AMOUNT_CONSISTENCY):** เทสต์ Regression ชุดแรก
    `jest.mock` ทั้ง Repository ทิ้ง → ย้อนโค้ด Repository กลับเป็นต้นตอแล้ว
    **ยังเขียว 15/15** · แก้ด้วยการเพิ่ม `assetRepositoryPortfolioFilter.test.js`
    ที่ใช้ **Repository ตัวจริง** Mock แค่ Query Builder → ย้อนกลับแล้วแดง 3/6
  - **Red-Green จริง 3 ชุด + Baseline:** Baseline ก่อนแก้ **แดง 9/15** ·
    ใส่ `?? null` กลับที่ `validateBuy` **แดง 3/15** · ยุบ Repository เหลือ ternary
    2 ทาง **แดง 3/6** · ใส่ Default `= null` กลับ **แดง 9/15**
  - Test **131 suites / 2,624 → 133 suites / 2,645 เขียวทั้งหมด** · ESLint 0 error
  - ⛔ **แปะคำเตือนห้าม Apply 044 ไว้ 2 ที่แล้ว** (HANDOFF § 8 + หัวไฟล์ migration)
    พร้อมลำดับที่ถูกต้อง: **แก้โค้ด → Deploy → Verify → ค่อย Apply 044**
    (สลับจากกฎปกติโดยตั้งใจ เพราะ 044 คือตัวที่ทำให้โค้ดเดิมพัง ไม่ใช่โค้ดใหม่ที่รอ Schema)

- **Stage 9 (2/2) — ปิดหน้าที่เหลือ + ผูก Action ปุ่มบันทึกรายการ**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**)
  - Port หน้าที่เหลือครบ: **Dashboard · Transactions · DCA · Profile**
    (ทีละไฟล์ **ไม่ได้ merge branch `demo/multipage-ux-redesign`**)
  - **`RecordTransactionModal` ต่อ API จริง** (Demo เป็น Session-only ไม่ยิง API เลย)
    · ซื้อ/ขาย → `POST /transactions` · ปันผล → `POST /transactions/dividend`
    · ⭐ **ช่อง `quantity` ของปันผลเป็นค่าบังคับ** พร้อมคำอธิบายว่าทำไมระบบไม่เติมให้
    (จำนวนหน่วย ณ วัน XD อาจไม่เท่ากับที่ถืออยู่ตอนนี้) — ตรงกับมติ Founder 24 ส.ค.
  - **⭐ กติกาพอร์ตถูกล็อกสะท้อนครบทุกหน้าจอ:**
    ปุ่ม "ซื้อ"/"ปันผล" ปิดเมื่อ `canWrite = false` · **ปุ่ม "ขาย" และ "ย้อนรายการ"
    เปิดเสมอไม่มีเงื่อนไข** · ปุ่ม "＋ บันทึกรายการ" บนแถบบนก็เปิดเสมอ (ถ้าปิดทั้งปุ่ม
    ผู้ใช้จะบันทึกการขายไม่ได้เลย = ยอดผิดถาวร) · ทุกที่ที่ล็อกมีข้อความบอก
    **ทางออกที่ยังทำได้จริง** กำกับ
  - **หน้า Profile = ที่ที่ผู้ใช้เลือก "พอร์ตหลัก" ได้** — สำคัญมากสำหรับผู้ใช้ที่
    Premium หมดอายุ เพราะพอร์ตหลักคือพอร์ตเดียวที่ยังเพิ่มรายการใหม่ได้
  - Loading / Error / Empty state ครบทุกหน้า · Empty แยกจาก Error ชัดเจน
  - ⚠️ `type` ของธุรกรรมที่ระบบยังไม่รู้จัก **แสดงเป็นค่าดิบ ห้าม Fallback เป็น "ขาย"**
    (API.md ระบุไว้ชัด — บั๊กเดียวกับที่ Stage 6a ไล่แก้ทั้ง 8 จุด)
  - ⚠️ **ไม่คำนวณตัวเลขเงินเองใน Frontend เลยแม้แต่ค่าเดียว** (กฎยืนข้อ 1)
  - ⚠️ **ไม่มีภาษาชี้นำการลงทุนทุกหน้าจอ** (กฎเหล็กข้อ 1) — รายงานข้อเท็จจริงเท่านั้น
  - ตรวจแล้วด้วย `grep`: ไม่มี `<a href>` · ไม่มี `import` จาก `demo/*` ·
    ไม่มี `localStorage`/`sessionStorage` · ไฟล์ Demo เดิมและ Dashboard เดิมอยู่ครบ
  - Frontend **298 tests เขียว** · `npm run build` ผ่าน
  - **ยังไม่ได้ทำ:** Modal สร้างพอร์ตใหม่ (ตอนนี้ปุ่มพาไป `/premium` หรือหน้าพอร์ต) ·
    กราฟ Donut/เส้น (ตอนนี้เป็นรายการตัวเลข) · Production Verification ทั้งหมด

- **Stage 9 (1/n) — ฐานของ Dashboard แยกหน้า + หน้าพอร์ตต่อ API จริง**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**)
  - **Route คู่ขนานที่ `/app/*` หลัง Feature Flag `VITE_ENABLE_MULTIPAGE_APP`**
    · **ไม่แตะ `/dashboard` เดิมเลยแม้แต่บรรทัดเดียว** · ไฟล์ Demo เดิมอยู่ครบ
    (Port มาทีละไฟล์ **ไม่ได้ merge branch `demo/multipage-ux-redesign`** ซึ่งมี
    6,872 deletions จะลบงาน Slip OCR + มาสคอต + Premium fixes ที่ Deploy แล้วทิ้ง)
    · Rollback = ปิด Flag ตัวเดียว ไม่ต้อง Revert โค้ด
  - **`lib/entitlements.js` มาแทน `lib/demo/planEntitlements.js` (ของปลอม)**
    · สิทธิ์มาจาก `GET /dashboard/me` จริง **ห้าม Hardcode เพดานใน Frontend**
    (Demo เดิม Hardcode `FREE_ASSET_CAP = 2` พร้อมคอมเมนต์ "Grep แล้ว 22 ส.ค."
    ซึ่งจะเพี้ยนแน่นอนวันที่ Founder เปลี่ยนเพดาน)
    · เพิ่ม `portfolioLimit` เข้า `/dashboard/me` เพื่อไม่ให้ UI ต้องเดา
    · **Fail-closed**: โหลด `/me` ไม่เสร็จ → ถือเป็น Free + Disable ปุ่ม ไม่เดาว่า
    เป็น Premium (เดาสูงเกินจริง = ผู้ใช้กดแล้วเจอ Error ซึ่ง UX แย่กว่า)
  - **`lib/portfolioApi.js`** — ห่อ Endpoint ของ Stage 8 · **ไม่ใช่ API Client ใหม่**
    ทุกฟังก์ชันเรียกผ่าน `lib/api.js` ตัวเดิม (Token/401/returnTo จัดการที่เดียว)
  - **⭐ UI สะท้อนกติกา "พอร์ตถูกล็อก" ให้ตรงกับ Backend** (มติ 24 ส.ค. 2569):
    `portfolioWriteState()` คืน `canAdd` (ตาม `canWrite` จาก Backend) และ
    **`canReduce` ที่เป็น `true` เสมอไม่มีเงื่อนไข** — ถ้า UI ซ่อนปุ่มขายตอนพอร์ต
    ถูกล็อก ผู้ใช้จะคิดว่า "ติดกับ" แล้ว**ไม่บันทึกการขายที่เกิดขึ้นจริง** →
    ยอดในพอร์ตผิดถาวร ซึ่งเป็นสิ่งที่มติข้อนี้ตั้งใจกันตั้งแต่แรก
    · แถบแจ้งเตือนบอก "ทางออกที่ยังทำได้จริง" ครบ (ขาย/ย้อนรายการ/ย้ายออก)
    · **Frontend ซ่อนปุ่มคือ UX ไม่ใช่ Gate** — ด่านจริงอยู่ Backend เสมอ
  - **`AppShell`** — พอร์ต + สิทธิ์จริงยิงขนานกันครั้งเดียวตอน mount แล้วส่งลง
    หน้าลูกผ่าน Outlet Context (หน้าลูกไม่ยิงซ้ำ) · **ตัด Toggle "ดูแบบ Free /
    ดูแบบ Premium" ของ Demo ออกทั้งหมด** เพราะเป็นของปลอมที่ไม่ผูกกับ Auth
    · Switcher บอกตั้งแต่ในรายการว่าพอร์ตไหนถูกล็อก (ไม่ให้สลับเข้าไปแล้วค่อยงง)
  - **`AppPortfolio`** — ต่อ `GET /portfolio/allocation` จริง · **ไม่คำนวณสัดส่วน/
    ยอดรวมเองใน Frontend** (กฎยืนข้อ 1) · รองรับธงที่ Demo ไม่มีครบทุกตัว:
    `fxUnavailableForUsd` (**เตือนก่อน ห้ามรวมยอดข้ามสกุลเงิน**) · `fxStale` ·
    `priceUnavailableCount` (บอกว่ากลุ่มนั้นคิดที่ราคาทุน) · `isEmpty`
  - **Loading / Error / Empty state ครบทุกหน้า** — Demo ไม่มีเลยเพราะใช้ Mock ที่
    พร้อมใช้ทันที · Empty แยกจาก Error ชัดเจน (ผู้ใช้ใหม่ต้องไม่คิดว่าระบบพัง)
  - Internal Navigation ใช้ `<NavLink>` ทั้งหมด **ไม่มี `<a href>` สักจุด**
    (JWT เก็บใน Memory — full reload จะทำให้ Token หาย)
  - Test Frontend **284 → 298 เขียวทั้งหมด** · `npm run build` ผ่าน
  - **ยังไม่ได้ทำ:** Port หน้า Dashboard / Transactions / DCA / Profile ·
    Modal สร้างพอร์ต/บันทึกรายการ (ตอนนี้ปุ่มยังไม่ผูก Action) ·
    Production Verification ทั้งหมด

- **Stage 8-fix — ปิดช่องโหว่ที่พบตอนรีวิวโค้ด (24 ส.ค. 2569)**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**
  · Migration **ยังไม่ได้ Apply บน Supabase**)

  **(A) `assertCanWriteToPortfolio` ไม่เคยถูกเรียกจากเส้นทางบันทึกธุรกรรมเลย**
  - `grep` ยืนยันว่าถูกเรียกจาก `assets.service` (แก้ป้ายกำกับ) เท่านั้น —
    **ไม่ถูกเรียกจาก** ซื้อ/ขายเว็บ · ซื้อ/ขาย LINE · ปันผล · Bulk Import · Undo
    → มติ § 8.1(ก) บังคับได้แค่ส่วนที่สำคัญน้อยที่สุด
  - ⚠️ **คอมเมนต์เหนือฟังก์ชันเขียนว่า "ใช้จากทุกจุด" ซึ่งไม่จริง** — คอมเมนต์ที่
    โกหกอันตรายกว่าตัวบั๊ก เพราะคนอ่านรอบหน้าจะเชื่อแล้วไม่ตรวจซ้ำ (รูปแบบเดียวกับ
    เคส 9 ส.ค. ที่ `CLAUDE.md` เตือนไว้) → แก้คอมเมนต์ + ใส่ลิสต์ผู้เรียกจริงที่
    **ตรวจซ้ำได้ด้วย `grep`**
  - ⭐ **มติ Founder ใหม่ — แยก "เขียน" เป็น 2 ชนิด** (ดู `DECISIONS_LOG.md`):
    ❌ บล็อก "เพิ่มของใหม่" (ซื้อ · ปันผล · Bulk Import · ย้ายสินทรัพย์**เข้า**) ·
    ✅ อนุญาตเสมอ "ลดของเดิม/แก้ให้ตรงความจริง" (**ขาย · Undo · ย้ายออก**ไปพอร์ตหลัก)
    · เหตุผล: ถ้าบล็อกการขายด้วย ผู้ใช้ที่ขายจริงไปแล้วจะบันทึกไม่ได้ →
    **พอร์ตโชว์ตัวเลขผิดถาวร** และออกจากพอร์ตที่ถูกล็อกไม่ได้เลย =
    เอาข้อมูลผู้ใช้เป็นตัวประกัน · **การล็อกต้องหมายถึง "โตต่อไม่ได้" ไม่ใช่ "ออกไม่ได้"**
  - `assertCanWriteToPortfolio` → **`assertCanAddToPortfolio`** (ชื่อบอกความหมายจริง)
  - วางด่านที่ **`transaction.service.validateBuy` = คอขวดร่วมของการซื้อทุกช่องทาง**
    (เว็บ/LINE/Bulk ผ่านฟังก์ชันนี้หมด) แทนการแปะทีละ Controller ซึ่งเป็นสาเหตุที่
    ด่านตกหล่นมาตั้งแต่แรก · + `dividend.service` (แยก Endpoint ตาม Design Doc § 4.5)
  - **ตรวจ "ปลายทางของของใหม่" ไม่ใช่ต้นทาง** — กฎข้อเดียวให้ผลถูกทุกเคส
    (เดิม `assets.service` ตรวจต้นทาง ทำให้**ย้ายสินทรัพย์ออกจากพอร์ตที่ถูกล็อก
    ไม่ได้เลย**) · `deletePortfolio` เลิกผ่านด่านด้วยเหตุผลเดียวกัน (การลบพอร์ต
    ส่วนเกิน = รวมเข้าพอร์ตหลัก = ทางออก)
  - **`getWritablePortfolioIds` ยึด `is_default` แทน `created_at` เก่าสุด** —
    พอร์ตเก่าสุดคือตัวที่ 044 Backfill สร้างให้ (มักแทบว่างเปล่า) ส่วนพอร์ตที่ใช้จริง
    สร้างทีหลัง → ยึด `created_at` จะ**ล็อกผิดตัว** · คง `created_at` + tie-break `id`
    เป็น **Fallback เมื่อ `is_default` หายไป ห้ามลบ** (ไม่งั้นคืน Set ว่าง = ล็อกออก
    ทุกพอร์ตพร้อมกัน)
  - ข้อความ `PORTFOLIO_READ_ONLY` บอก**ทางออกที่ยังทำได้จริง**ครบทั้งเว็บและ LINE —
    ถ้าเขียนแค่ "อ่านอย่างเดียว" ผู้ใช้จะไม่บันทึกการขายจริง → ยอดผิดถาวร ·
    ห้ามใช้ภาษาชี้นำการลงทุน (กฎเหล็กข้อ 1)

  **(B) เพดานจำนวนพอร์ตเป็น check-then-insert ที่ไม่ Atomic → migration 048**
  - ผู้ใช้ Free กดสร้างพอร์ตสองแท็บพร้อมกัน → อ่านได้ `current = 1` ทั้งคู่ →
    ผ่านทั้งคู่ → **ได้ 2 พอร์ตทะลุเพดาน** และไม่มีอะไรใน DB กันไว้เลย
    (เคสเดียวกับที่ migration 035 ถูกสร้างมาแก้เป๊ะ — การปล่อยไว้คือถอยหลังจาก
    มาตรฐานที่ทีมตั้งเอง และ Entitlement คือหมวดเสี่ยงสูงตาม § 4.2)
  - **`create_portfolio_locked()`** — Lock แถว `users` → นับ → Validate → INSERT
    ในธุรกรรมเดียว ตาม Pattern `035` เป๊ะ · `p_portfolio_limit` **รับจาก Caller
    ไม่ Hardcode ใน SQL** (Single Source of Truth อยู่ที่ `entitlement.service`)
    · `is_default = FALSE` ตายตัว (กัน Invariant 044/045 พัง)
  - **`set_default_portfolio_locked()`** — สลับพอร์ตหลักแบบ Atomic ·
    ต้องเป็น RPC เพราะ `idx_portfolios_one_default_per_user` เป็น Partial UNIQUE
    → ตั้งตัวใหม่ก่อนปลดตัวเก่าชน Index ทันที และถ้าแยก 2 คำสั่งแล้วพังกลางทาง
    ผู้ใช้จะ**ไม่มีพอร์ตหลักเลย** = Invariant พังค้างถาวร
    · ⚠️ ตรวจ Cross-User ใน RPC ด้วย (FK ไม่ได้ช่วยตรงนี้เลย)
  - **`PATCH /portfolios/{id}` รองรับ `isDefault: true`** — ผู้ใช้เลือกพอร์ตหลัก
    เองได้ · **ไม่ Gate ด้วย "Premium ที่ยัง Active" โดยเจตนา** เพราะจะทำให้ผู้ใช้
    Premium ที่หมดอายุถูกขังอยู่กับพอร์ตเดิม (กับดักแบบเดียวกับที่มติ 24 ส.ค.
    ตั้งใจกำจัด) · ตัวคุมสิทธิ์จริงคือ "ต้องมีพอร์ตมากกว่า 1 อัน" ซึ่งมีได้เฉพาะ
    คนที่เคยเป็น Premium อยู่แล้ว
  - Pre-check ฝั่ง JS **ยังอยู่** (ตอบเร็ว + แยกข้อความ Free/Premium ได้) แต่
    **ด่านจริงคือ RPC** · การแยก `PORTFOLIO_LIMIT_REACHED` / `PORTFOLIO_CAP_REACHED`
    ทำงานบนเส้นทาง RPC ด้วย (Premium ที่จ่ายเงินอยู่แล้วห้ามโดนชวนอัปเกรด)

  **(C) `deletePortfolio` ไม่ Atomic — ยอมรับโดยตั้งใจ พร้อมเหตุผลกำกับในโค้ด**
  (Failure mode ไม่อันตราย: Invariant ยังจริง · กดลบซ้ำได้ผลเดิม = Idempotent)

  - **Red-Green จริง 6 ชุด** (ถอด Fix → แดง → ใส่กลับ → เขียว):
    Baseline ก่อนแก้ (A) **แดง 5/12** · ถอดด่านจากคอขวดการซื้อ **แดง 3/12** ·
    ถอดด่านจากปันผล **แดง 1/12** · กลับไปยึด `created_at` **แดง 8/29** ·
    เผลอเอาด่านไปใส่ฝั่งขาย (ละเมิดมติ) **แดง 2/12** ← กันพลาดย้อนทางด้วย ·
    ไม่ส่ง limit ลง RPC **แดง 4/12**
  - Test ทั้งชุด **129 suites / 2,596 → 131 suites / 2,624 เขียวทั้งหมด**
  - **ยังไม่ได้ทำ:** Red-Green ระดับ SQL ของ migration 048 (เครื่องนี้ไม่มี
    Docker/psql — Script อยู่ท้ายไฟล์) · Production Verification ทั้งหมด

- **Multi-Portfolio / Broker / Sector / Dividend — Stage 8 (3/3): Assets**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**)
  - **`GET /api/v1/assets`** (Free) — List สินทรัพย์ที่ถืออยู่ + Filter
    `brokerId` / `sector` / `portfolioId` (ค่า `none` = แถวที่ไม่ได้ระบุมิตินั้น)
  - **`PATCH /api/v1/assets/{id}`** (Free) — แก้ **`brokerId` / `sector` /
    `portfolioId`** · ไฟล์ใหม่ `services/assets.service.js` + repository
    `updateMetaByIdForUser` / `findByIdForUser`
    > Design Doc § 4.4 เขียนว่า "ขยายของเดิม" แต่ **ของเดิมไม่มีอยู่จริง** —
    > `assets.routes` มีแค่ `GET /symbols` เท่านั้น จึงต้องสร้างทั้ง 2 Endpoint ใหม่
  - **⚠️ แก้ Spec เดิมของ `API.md § 14.4`: ถอด `isActive` ออกจาก PATCH**
    Spec เดิมเขียนว่าแก้ `isActive` ได้ — **ไม่เปิดให้แก้แล้ว** เพราะ `is_active`
    คือตัวนับเพดาน Free Plan ซึ่งต้องผ่าน RPC `create_asset_locked` ที่ Lock แถว
    `users` ไว้เท่านั้น (migration 035/046) การแก้ตรงๆ ผ่าน HTTP จะข้ามด่าน
    Race Condition ที่ RPC นั้นมีไว้ทั้งหมด
  - **⚠️ ไม่เปิดให้แก้ `symbol` / `type` เด็ดขาด** — สองค่านี้คือ *ตัวตน* ของ
    สินทรัพย์ที่ธุรกรรมทั้งกองผูกอยู่ ถ้าเปลี่ยนได้ ต้นทุนเฉลี่ยและ P&L ที่คำนวณ
    จากประวัติเดิมจะกลายเป็น "ของผิดตัว" ทันทีแบบเงียบๆ
    · Field ที่ไม่รองรับซึ่งส่งมาใน Body ได้ `400 VALIDATION_ERROR` พร้อม
    `details.unsupportedFields` — **ไม่ใช่ถูกเพิกเฉยเงียบๆ** (Silent Ignore เป็น
    Anti-pattern แบบเดียวกับ Silent Default — กฎยืนข้อ 11)
  - **⚠️ `portfolioId` ล้างเป็น `null` ไม่ได้** — Invariant ของ migration 044/045
    บังคับว่า "สินทรัพย์ทุกแถวสังกัดพอร์ตเสมอ" ถ้าปล่อยให้ตั้ง NULL ได้
    migration 045 ที่ใช้เป็น Health Check จะ RAISE EXCEPTION (ย้ายพอร์ตได้ ล้างไม่ได้)
  - Cross-User: `brokerId` → `assertOwnedBrokerId` · `portfolioId` →
    `assertCanWriteToPortfolio` (ยืนยันเจ้าของ **และ** เช็คสิทธิ์เขียน) ·
    `assetId` → `findByIdForUser` ที่ผ่าน `queryForUser` · ทั้งหมดตอบ 404 ไม่ใช่ 403
    · **เช็คสิทธิ์เขียนของพอร์ตที่สินทรัพย์สังกัดอยู่ก่อนแตะอะไรทั้งสิ้น** ไม่งั้น
    ผู้ใช้ที่ Premium หมดอายุจะยังแก้ป้ายกำกับในพอร์ตส่วนเกินได้
  - ย้ายแล้วชน `UNIQUE (user_id, symbol, portfolio_id, broker_id)` ของ migration 046
    → `409 ASSET_ALREADY_EXISTS` (**ห้ามรวมสองแถวให้อัตโนมัติ** = แตะเงินจริง)
  - `sector` Normalize ตอนเขียน (trim + ยุบช่องว่างซ้ำ) **แต่คงตัวพิมพ์ตามที่
    ผู้ใช้พิมพ์** — `SET50` ไม่กลายเป็น `Set50` (บทเรียนจาก Stage 2) ·
    การกรองด้วย `?sector=` เทียบแบบไม่สนตัวพิมพ์ให้**ตรงกับวิธีจัดกลุ่มของ
    `/portfolio/allocation` เป๊ะ** ไม่งั้นผู้ใช้กดกลุ่มบนกราฟแล้วเห็นรายการไม่ครบ
  - **Red-Green จริง 3 ชุด** (ถอด Fix → แดง → ใส่กลับ → เขียว):
    ถอด `assertOwnedBrokerId` **แดง 3/32** · ยอมให้ล้าง `portfolioId` เป็น null
    **แดง 3/32** · เพิกเฉย Field ที่ไม่รองรับเงียบๆ **แดง 4/32**
  - Test ทั้งชุด **128 suites / 2,564 → 129 suites / 2,596 เขียวทั้งหมด**
  - **ยังไม่ได้ทำ:** `GET /assets/{id}` (รายละเอียดรายตัว — ยังไม่มีใครเรียกใช้) ·
    Stage 9 ต่อ Frontend · Production Verification ทั้งหมด

- **Multi-Portfolio / Broker / Sector / Dividend — Stage 8 (2/3): Allocation**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**)
  - **`GET /api/v1/portfolio/allocation?groupBy=broker|sector|assetType&portfolioId=`**
    (Free) — ข้อมูลที่หน้า Demo Portfolio ต้องใช้จริงสำหรับกราฟโดนัท
    · ไฟล์ใหม่: `services/allocation.service.js` · `routes/portfolio.routes.js`
    (เอกพจน์ แยกจาก `/portfolios` พหูพจน์ ตามที่ API.md § 14.2 วางไว้ตั้งแต่ Phase 0:
    `/portfolio` = อ่านภาพรวม Free · `/portfolios` = CRUD ที่ POST/PATCH/DELETE เป็น Premium)
  - **⭐ Reuse สูตรเดิมทั้งหมด ไม่มีสูตรเงินใหม่แม้สูตรเดียว** (Design Doc § 4.3 +
    กฎยืนข้อ 1): `portfolio.service.getPortfolioSummary` (ต้นทุน Moving Average) +
    `portfolioSummary.priceHoldings` (ราคาตลาด) + `fxRate.service` — ตัวเดียวกับที่
    `/portfolio/summary` และหน้า Dashboard ใช้อยู่ · ถ้าเขียนสูตรใหม่ วันหนึ่งเลข
    บนการ์ดสรุปกับเลขบนกราฟโดนัทจะไม่ตรงกันแล้วหาสาเหตุไม่เจอ
  - **⚠️ ไม่มีราคาสด → ตีมูลค่า "ที่ต้นทุน" ไม่ใช่ข้ามทิ้ง** (คัดกติกามาจาก
    `dashboardOverview.buildAllocation` เป๊ะ) — ต่างจากการ์ดกำไร/ขาดทุนที่ต้องข้าม
    แล้วนับ `excludedCount` โดยเจตนา: ถ้าข้ามที่นี่ด้วย **หุ้นไทยจะหายจากกราฟโดนัท
    ทั้งที่ผู้ใช้ถืออยู่จริง** และผลรวมสัดส่วนจะไม่เท่ามูลค่าพอร์ตบนการ์ด ·
    ส่ง `priceUnavailableCount` รายกลุ่มขึ้นไปให้ Frontend ติดหมายเหตุได้
  - **⚠️ กลุ่ม "ไม่ระบุ" (`key: null`) ต้องแสดงเสมอ ห้ามซ่อน** — ข้อมูลเดิม 100%
    มี `broker_id`/`sector` เป็น NULL ถ้าซ่อน ยอดรวมกราฟจะไม่เท่ามูลค่าพอร์ตจริง
    (ระบุไว้ใน `DATABASE.md` ของทั้ง 2 คอลัมน์อยู่แล้ว)
  - **`sector` จัดกลุ่มแบบ case-insensitive** (trim + ยุบช่องว่างซ้ำ + ตัวพิมพ์เล็ก)
    กัน `Tech`/`tech`/`Tech ` เป็น 3 กลุ่ม · **แต่ `label` คงรูปแบบที่ผู้ใช้พิมพ์**
    (`SET50` ไม่กลายเป็น `Set50` — บทเรียนตรงจาก Stage 2 ที่ตัด Title Case ออก)
    · `broker` ไม่ต้อง Normalize เพราะ `brokers` มี UNIQUE case-insensitive ตั้งแต่
    migration 042 แล้ว จัดกลุ่มด้วย `broker_id` ตรงๆ ถูกต้องอยู่แล้ว
  - `percent` รวมกันได้ 100 เสมอ · ยอดรวม 0 → คืน 0 ไม่ใช่ `NaN` ที่ทำกราฟพัง
  - `fxUnavailableForUsd` ส่งขึ้นไปด้วย (**ห้ามรวมยอดข้ามสกุลเมื่อดึงเรตไม่ได้**)
    · พอร์ต THB ล้วน**ไม่ยิง FX เลย** · ไม่จัดกลุ่มตามโบรก**ไม่ยิง Query หาชื่อโบรก**
  - Cross-User: `portfolioId` ของผู้ใช้คนอื่นได้ผลลัพธ์ **ว่าง** ไม่ใช่ข้อมูลของเขา
    (กรองจาก holdings ที่ `getPortfolioSummary` Scope ด้วย `userId` มาแล้ว)
  - เพิ่ม `sector` + `portfolioId` เข้า `holding` ของ `portfolio.service` (Additive ล้วน
    Consumer เดิมที่ไม่ได้อ่าน 2 Field นี้ไม่กระทบเลย)
  - **Red-Green จริง 3 ชุด** (ถอด Fix → แดง → ใส่กลับ → เขียว):
    ถอดการตีมูลค่าที่ต้นทุน (ข้ามทิ้งแทน) **แดง 1/25** · ถอด Normalize ของ sector
    **แดง 3/25** · ซ่อนกลุ่ม "ไม่ระบุ" **แดง 2/25**
  - Test ทั้งชุด **127 suites / 2,539 → 128 suites / 2,564 เขียวทั้งหมด**
  - **ยังไม่ได้ทำ:** Assets ขยาย (§ 4.4) · Production Verification ทั้งหมด

- **Multi-Portfolio / Broker / Sector / Dividend — Stage 8 (1/3): Endpoint พอร์ต**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**
  · Migration **ยังไม่ได้ Apply บน Supabase**)
  - **`/api/v1/portfolios` ครบ 5 Endpoint** — ทำ `API.md § 14.2` ที่มี Spec ค้าง
    ไว้ตั้งแต่ Phase 0 ให้เป็นจริง (`portfolios` มีตารางมาตั้งแต่ Base Schema แต่
    **ไม่เคยมี Repository/Endpoint จริง** จนถึงตอนนี้)
    · ไฟล์ใหม่: `repositories/portfolio.repository.js` · `services/portfolios.service.js`
    · `controllers/portfolios.controller.js` · `routes/portfolios.routes.js`
  - **⚠️ แก้ Spec เดิมของ `API.md § 14.2` สองจุด (ของเดิมผิด ไม่ใช่เปลี่ยนใจ):**
    **(1) `GET` Premium → Free** — หลัง migration 044 ผู้ใช้ทุกคนรวม Free มีพอร์ต
    Default แล้ว และ Invariant บังคับว่าสินทรัพย์ทุกแถวสังกัดพอร์ต → หน้า Dashboard
    ต้องอ่านพอร์ตมา render ตั้งแต่โหลดหน้าแรก ถ้าคืน 403 **หน้า Dashboard ของ Free
    พังทันที** · ตัวคุมสิทธิ์จริงคือ `POST` ซึ่งตรงกับ `AI_CONTEXT.md` บรรทัด 95 ที่
    พูดถึง "การมีหลายพอร์ต" ไม่ได้พูดถึง "การเห็นพอร์ตของตัวเอง"
    **(2) `DELETE` ห้ามพึ่ง FK `ON DELETE SET NULL`** — Spec เดิมเขียนว่าสินทรัพย์
    จะกลายเป็น `portfolio_id = NULL` ซึ่ง**ทำ Invariant ของ migration 044/045 พัง
    ทันที** แล้ว migration 045 ที่ใช้เป็น Health Check จะ RAISE EXCEPTION ·
    เปลี่ยนเป็น **ย้ายสินทรัพย์เข้าพอร์ต Default ก่อน แล้วค่อยลบแถวพอร์ต**
    (ประวัติ/ต้นทุนไม่เปลี่ยนเลย เพราะ `transactions` ผูกกับ `asset_id`)
  - **⚠️ กันเคสที่ migration 044 STEP 6 ดักไว้ ซ้ำอีกชั้นที่ Application:** ถ้าย้าย
    สินทรัพย์เข้าพอร์ต Default แล้วจะชน `UNIQUE NULLS NOT DISTINCT (user_id,
    symbol, portfolio_id, broker_id)` (migration 046) → ปฏิเสธด้วย
    `409 PORTFOLIO_HAS_CONFLICTING_ASSETS` **พร้อมรายการที่ชน และไม่ลบอะไรเลย**
    เพราะการรวมสองแถวเข้าด้วยกันกระทบต้นทุนเฉลี่ย = **แตะเงินจริง ห้ามทำอัตโนมัติ**
    · เทียบ `broker_id` ที่เป็น NULL ว่า "เท่ากัน" ให้ตรงกับ NULLS NOT DISTINCT
  - **Entitlement ใหม่ 2 ตัวใน `entitlement.service`** (แหล่งตัดสินสิทธิ์เดียวเหมือนเดิม)
    · `getActivePortfolioLimit()` — Free 1 / Premium 50 (Sanity Cap กัน abuse
    ไม่ใช่ Monetization Cap) · **ไม่มีวันคืน `null`** ต่างจาก `getActiveAssetLimit`
    เพราะแม้แต่ Premium ก็มีเพดาน → Caller ไม่ต้องมี Branch "null = ไม่จำกัด"
    · `getWritablePortfolioIds()` — กติกา **"อ่านได้ เขียนไม่ได้"** ตอน Premium
    หมดอายุ (มติ Founder § 8.1 ก) · **ห้ามลบข้อมูลเด็ดขาด** พอร์ตส่วนเกินยังเปิดดู
    ย้อนหลังได้ครบ · คำนวณสดทุกครั้ง ไม่เก็บลง DB → ต่ออายุแล้วเขียนได้ทันที
  - **⚠️ Tie-break ด้วย `id` เมื่อ `created_at` เท่ากัน — จำเป็นจริง ไม่ใช่กันเหนียว:**
    migration 044 Backfill สร้างพอร์ตให้ผู้ใช้ทุกคนใน Transaction เดียว ซึ่ง `now()`
    ของ Postgres **คงที่ทั้ง Transaction** → พอร์ตที่เกิดพร้อมกันมี `created_at`
    เท่ากันทุกตัวอักษร ถ้าไม่ Tie-break ลำดับจะขึ้นกับ Physical Row Order ที่เปลี่ยน
    ได้หลัง VACUUM/UPDATE = ผู้ใช้เจอ "บางครั้งบันทึกได้ บางครั้งไม่ได้" กับพอร์ตเดิม
  - แยก Error Code ของ Free (`PORTFOLIO_LIMIT_REACHED` 403) ออกจาก Premium ที่ชน
    Cap (`PORTFOLIO_CAP_REACHED` 409) — ถ้าใช้ Code เดียวกัน Premium ที่จ่ายเงิน
    อยู่แล้วจะโดนชวนอัปเกรด
  - Cross-User: ทุก Query ผ่าน `queryForUser('portfolios', ...)` · พอร์ตของคนอื่น
    ตอบ **404 ไม่ใช่ 403** (ห้ามยืนยันการมีอยู่ของ resource ผู้ใช้รายอื่น) ·
    `id` ผิดรูปตอบ 404 ไม่ใช่ 500 (กัน Postgres 22P02)
  - **Red-Green จริง 4 ชุด** (ถอด Fix → แดง → ใส่กลับ → เขียว):
    ถอด Tie-break ด้วย id **แดง 2/46** · ให้ `deletePortfolio` พึ่ง FK SET NULL
    **แดง 3/33** · Gate `GET` ด้วย Premium ตาม Spec เดิม **แดง 6/33** ·
    ถอดการตรวจชน UNIQUE ก่อนย้าย **แดง 2/33**
  - Test ทั้งชุด **125 suites / 2,493 → 127 suites / 2,539 เขียวทั้งหมด**
  - เก็บกวาดระหว่างทาง: แก้ `eqeqeq` ที่ค้างใน `entitlement.service.js`
    (`!= null` → `!== null && !== undefined` พฤติกรรมเหมือนเดิมเป๊ะ) →
    **ESLint ทั้ง Repo เหลือ 0 error** (จากเดิม 1)
  - **ยังไม่ได้ทำ:** Allocation Endpoint (§ 4.3) · Assets ขยาย (§ 4.4) ·
    Production Verification ทั้งหมด

- **Multi-Portfolio / Broker / Sector / Dividend — Stage 6b: เปิด `dividend` จริง**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**
  · Migration **ยังไม่ได้ Apply บน Supabase**)
  - **migration 047 — CHECK ของ `transactions.type` รับ 4 ค่าแล้ว**
    (`buy`/`sell`/`dividend`/`dividend_reversal`) · ไม่แตะข้อมูลเดิมแม้แถวเดียว
    "ผ่อน" ข้อจำกัดอย่างเดียว → แถวเดิมผ่าน CHECK ใหม่ครบ 100% โดยอัตโนมัติ
    · **และแก้ `create_transaction_locked()` ซึ่งเป็น "Stage 6a ฉบับ SQL ที่ยังค้างอยู่"**:
    RPC ยังนับยอดคงเหลือแบบ Binary (`CASE WHEN type='buy' THEN q ELSE -q END`)
    มาตั้งแต่ migration 034 → ถ้าเปิด CHECK โดยไม่แก้จุดนี้ ยอดคงเหลือที่ DB ใช้ตัดสิน
    "ขายเกินไหม" จะน้อยกว่าความจริงเท่ากับ quantity ของทุกแถวปันผลรวมกัน (ผู้ใช้จะขาย
    หุ้นที่ถืออยู่จริงไม่ได้ ได้ INSUFFICIENT_QUANTITY ทั้งที่ยอดยังเหลือ) และเพราะ RPC
    เป็นทางเข้า Ledger ทางเดียวของทั้งระบบ ความผิดนี้จะกระทบทุกช่องทางพร้อมกัน
    · เพิ่ม Guard `UNKNOWN_TRANSACTION_TYPE` เป็นคู่ขนานของ `default: throw` ฝั่ง JS
  - **`POST /api/v1/transactions/dividend`** (Free ทุกแพ็กเกจ ตามมติ Founder Q4.5)
    + `services/dividend.service.js` ใหม่ · แยก Endpoint ออกจาก `POST /transactions`
    ตาม Design Doc § 4.5 (Payload ต่างกันเชิงความหมายทั้งชุด)
  - **⚠️ จุดที่ Design Doc § 4.5 เขียนไว้ไม่ครบ (เจอตอน Implement):** Schema บังคับ
    `quantity > 0` **และ** `price_per_unit > 0` กับทุกแถว แต่ Design Doc ระบุ Body ว่า
    `quantity?` optional และไม่มี `pricePerUnit` เลย → แปลตรงตัวแล้วแถวปันผลจะถูก DB
    ปฏิเสธทุกแถว · **เลือกไม่ผ่อน CHECK** (เหตุผลเดียวกับที่ Design Doc § 5.3 ให้ไว้เอง
    ตอนอธิบายว่าทำไมไม่ใช้ amount ติดลบ — ผ่อนเกราะเพื่อ type เดียว = เปิดช่องให้บั๊ก
    ของ buy/sell ทะลุถึง DB ด้วย) แต่เก็บค่าที่ **มีความหมายจริง** แทน: `quantity` =
    จำนวนหน่วยที่ได้ปันผล · `price_per_unit` = **เงินปันผลต่อหน่วย (DPS)**
    ซึ่งเป็นตัวเลขที่นักลงทุนใช้จริง ไม่ใช่ค่าขยะเพื่อให้ผ่าน Constraint
  - **⭐ แก้ตามมติ Founder (24 ส.ค. 2569): `quantity` เป็นค่า "บังคับกรอก" ไม่ใช่ optional**
    รอบแรกทำเป็น optional ไว้ (ไม่ส่ง = เติมยอดถือ ณ วันนั้นให้เอง) เพราะเขียนขึ้น
    **ก่อน**มติข้อนี้จะมาถึง · การเติมให้เองคือ **Silent Default ซึ่งขัดกฎยืนข้อ 11**
    ("พาร์สข้อมูลไม่ชัดเจนต้องถามผู้ใช้หรือ Reject ไม่ใช่เดาค่า Default") — จำนวนหน่วย
    ที่ *ระบบรู้* กับที่ *ได้ปันผลจริง* ไม่จำเป็นต้องเท่ากันเลย เพราะปันผลจ่ายตามยอด ณ
    **วัน XD** ซึ่งมักคนละวันกับวันเงินเข้า และผู้ใช้จำนวนมากเพิ่งเริ่มบันทึกกลางทาง
    ระบบจึงเห็นประวัติไม่ครบ · ที่สำคัญคือค่านี้ไหลต่อไปเป็น `price_per_unit` (DPS)
    ที่ผู้ใช้เอาไปเทียบข้ามงวดจริง = เขียนตัวเลขที่ผู้ใช้ไม่เคยยืนยันลง Ledger ถาวร
    · ไม่ส่ง/ส่งค่าใช้ไม่ได้ → `400 VALIDATION_ERROR { field: 'quantity' }` ทั้งชั้น
    Controller และ Service **และไม่แตะ Ledger เลย**
    · ⚠️ **`heldQuantityAsOf` ยังอยู่ครบ** ในฐานะด่าน `NOTHING_TO_RECEIVE_DIVIDEND`
    ซึ่งยังตรวจจาก **ยอดถือจริง ณ `date`** ไม่ใช่จาก `quantity` ที่ผู้ใช้กรอก (ไม่งั้น
    กรอกตัวเลขอะไรก็ได้ก็ข้ามด่านได้ = บันทึกปันผลของหุ้นที่ไม่เคยถือ)
    · Red-Green จริง: ถอด `throw` ที่บังคับ `quantity` ออกทั้ง 2 ชั้น (กลับไป Fallback
    เป็น `heldAtDate`) → **แดง 6 / ผ่าน 44** (แดงเฉพาะ 6 เคสใหม่พอดี ไม่กระทบเคสอื่นเลย)
    ใส่กลับ → **เขียว 50/50**
    · Test ทั้งชุด **125 suites / 2,484 → 125 suites / 2,493 เขียวทั้งหมด**
  - **ยอดถือคิด ณ "วันที่ได้ปันผล" ไม่ใช่วันนี้** — ถ้าใช้ยอดวันนี้ ผู้ใช้ที่ได้ปันผล
    วันที่ 10 แล้วขายหมดวันที่ 20 จะบันทึกย้อนหลังวันที่ 25 ไม่ได้เลย ทั้งที่การบันทึก
    ย้อนหลังคือ Use Case ปกติ (ปันผลเข้าบัญชีก่อนคนจะมานั่งบันทึกเสมอ)
  - **⭐ เจอ "จุดที่ 8" ที่ทั้ง Design Doc และ Stage 6a มองข้าม:**
    `flexMessage.util.buildUndoMessage` เขียน `result.originalType === 'buy'` แล้ว
    `wasBuy ? 'ซื้อ' : 'ขาย'` — กด "ย้อนล่าสุด" บนรายการปันผลจะได้การ์ดที่เขียนว่า
    "ก่อนบันทึกรายการ**ขาย**นี้" · และข้อความยังผิดข้อเท็จจริงซ้ำอีกชั้นเพราะบอกว่า
    "ยอดในพอร์ตกลับไปเป็นเหมือนเดิม" ทั้งที่ปันผลไม่เคยทำให้ยอดขยับเลย (ชวนให้เข้าใจ
    ว่าเมื่อกี้ยอดเคยหาย) · แก้เป็นถาม `thaiLabel()` + แยกข้อความของปันผลออกมาว่าสิ่งที่
    กลับไปเป็นเหมือนเดิมคือ **ยอดเงินปันผลสะสม** และซ่อนบรรทัด "จำนวน:" (quantity ของ
    แถวปันผลคือบริบท ไม่ใช่จำนวนที่ถูกหักออกจากพอร์ต)
  - Cross-User: `assetId` จาก Body ผ่าน `assetRepository.findByIds` ที่บังคับ
    `queryForUser` เสมอ + RPC ตรวจซ้ำใต้ Lock (migration 036) — สองชั้นโดยตั้งใจ
  - `note` ของ Endpoint ใหม่กัน Prefix `UNDO_OF:` เหมือน `POST /transactions` เป๊ะ
    (ไม่งั้นช่องโหว่ "ปลอมรายการเป็น Reversal" ที่ปิดไปแล้วจะเปิดกลับมาทางนี้แทน)
  - **ต่างจาก Design Doc § 4.5 อีกจุดโดยตั้งใจ:** `ASSET_NOT_FOUND` ตอบ **400**
    ไม่ใช่ 404 — `ERROR_STATUS` เป็นตารางกลางที่ใช้ร่วมกับฝั่งขายซึ่งเป็น 400 มาแต่ต้น
    ความสม่ำเสมอของ API สำคัญกว่าตัวเลขที่ร่างไว้ก่อนเห็นโค้ดจริง
  - **Red-Green จริง 5 ชุด** (ถอด Fix → แดง → ใส่กลับ → เขียว):
    `reversalTypeFor('dividend')` → `'buy'` แดง 2/16 · ถอด fix จุดที่ 8 ของ
    `buildUndoMessage` แดง 5/16 · ถอดการกรองวันที่ของ `heldQuantityAsOf` แดง 2/22 ·
    ถอด `NOTHING_TO_RECEIVE_DIVIDEND` แดง 4/41 · ถอด `NOTE_RESERVED_PREFIX` แดง 3/19
  - Test ทั้งชุด **122 suites / 2,427 → 125 suites / 2,484 เขียวทั้งหมด**
    (ส่วนต่าง = ไฟล์เทสต์ใหม่ 3 ไฟล์พอดี **ไม่มีเทสต์เดิมตัวใดเปลี่ยนผล** → ยืนยันว่า
    การแก้ `buildUndoMessage` ไม่กระทบการ์ดของ buy/sell แม้แต่ตัวอักษรเดียว)
  - **ยังไม่ได้ทำ:** Red-Green ระดับ SQL ของ CHECK/RPC (เครื่องนี้ไม่มี Docker/psql —
    Script อยู่ท้าย migration 047 รอ Founder รันบน Supabase Branch) · Production
    Verification ทั้งหมด · UI ฝั่ง Frontend (อยู่ใน Stage 9)
  - **TODO รอบหน้า:** ปันผลเป็น **หุ้น** (Stock Dividend) — เลื่อนตามมติ Founder Q4.4
    จะเป็น type ที่ 5 แยกต่างหาก (`heldQuantitySign` ต้องเป็น +qty ไม่ใช่ 0)

- **Multi-Portfolio / Broker / Sector / Dividend — Stage 5: ถือ Symbol เดียวกันได้หลายโบรก**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**
  รออนุมัติ · Migration **ยังไม่ได้ Apply บน Supabase**)
  - **migration 046** — `assets` UNIQUE `(user_id, symbol, portfolio_id)` →
    **`UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id)`**
    · ยังกันบั๊กเดิมของ migration 014 ได้ครบ (asset ซ้ำทำให้ประวัติธุรกรรม
    แตกคนละ `asset_id` → Moving Average Cost Basis เห็นแค่ครึ่งเดียว → P&L ผิด)
    เพราะ `NULLS NOT DISTINCT` ถือว่า NULL เท่ากัน — ข้อมูลเดิม 100% มี `broker_id` NULL
    · **ไม่ต้องใช้ COALESCE/Partial Index** · เพิ่ม `pending_transactions.broker_id`
    · `create_asset_locked()` รับ `p_broker_id` (ต่อท้าย + DEFAULT NULL เพื่อให้โค้ดรุ่น
    เก่าที่ยังรันอยู่ตอน Apply ไม่พัง) + **DROP Signature 8 Argument ทิ้ง** กัน
    PostgREST ตอบ "Could not choose the best candidate function"
  - **`assetResolution.service.js` (ไฟล์ใหม่)** — แหล่งตัดสิน "Symbol นี้หมายถึง
    สินทรัพย์แถวไหน" **ที่เดียวของทั้งระบบ** · กำกวมเมื่อไหร่ → **throw
    `AMBIGUOUS_ASSET_BROKER`** ไม่ใช่หยิบแถวแรก (กฎยืนข้อ 11: Silent Default
    เป็น Anti-pattern เสมอ) · กติกา `brokerId`: `undefined` = ยังไม่ได้ถาม /
    `null` = ตอบแล้วว่า "ไม่ระบุโบรก" / `uuid` = โบรกนั้น — **ห้ามเขียน `?? null`
    ก่อนส่งเข้า** (จะเปลี่ยน "ยังไม่ได้ถาม" เป็น "ตอบแล้ว" เงียบๆ)
  - **`asset.repository`** — `findByUserAndSymbol()` (`.maybeSingle()`) →
    **`findAllByUserAndSymbol()`** · `.maybeSingle()` จะ Error ทันที (PGRST116) เมื่อ
    symbol มี 2 แถว = **ทั้งคำสั่งซื้อ/ขาย/ดูกำไรของ Symbol นั้นพังทั้งหมด** — ไล่แก้
    ครบทั้ง 5 จุดบนเส้นทางเงิน (`transaction.validateBuy` / `validateSell` /
    `webhook.controller` / `bulkImport.service` / `profit.service`)
  - **เพดาน Free นับ "Symbol ที่ต่างกัน" ไม่ใช่จำนวนแถว** (มติ Founder
    23 ส.ค. 2569: ถือ BTC ที่ 2 โบรก = **1** สินทรัพย์) · `countActiveByUser()` →
    `findActiveSymbolsByUser()` · บังคับซ้ำที่ระดับ DB ด้วย `count(DISTINCT symbol)`
    ใต้ Lock ของ RPC · แก้ `bulkImport.checkAggregateAssetLimit` ให้นับหน่วยเดียวกัน
  - **Flow ถามโบรกทาง LINE** — `buildBrokerPickerMessage()` (Quick Reply + Postback)
    · **ถือโบรกเดียว = ห้ามถาม** บันทึกตรงเหมือนเดิม (กฎยืนข้อ 10 — ห้ามเพิ่ม
    Latency บน Live Path โดยไม่จำเป็น) · Reuse Pattern เดิมของ Fund Class Picker
    ทั้งชุด — **ไม่มีตาราง Session ใหม่ให้ค้าง/หมดอายุ** · label ตัดที่ 20 **Unicode
    Code Point** ด้วย `[...str]` ไม่ใช่ `slice()` (กัน Surrogate Pair ของ Emoji ขาดกลางตัว)
  - **Cross-User Isolation** — `brokerId` ทุกทางเข้า (Request Body / Query String /
    LINE Postback) ต้องผ่าน `brokerService.assertOwnedBrokerId()` ก่อนเสมอ — FK
    ระดับ DB ตรวจได้แค่ "โบรกนี้มีอยู่จริง" ไม่ได้ตรวจ "เป็นของใคร"
  - **`AMBIGUOUS_ASSET_BROKER` → HTTP 409** พร้อม `candidates` (`assetId` + `brokerId`)
    ให้ Frontend ถามผู้ใช้ต่อได้ทันที (ไม่ใช่ 404 — เป็น "คำขอยังไม่ครบพอจะตอบได้")
  - **จุดที่เกือบหลุด — `portfolioSnapshot.job`**: ถ้าไม่ส่ง `holding.brokerId` ต่อ
    ผู้ใช้ที่ถือ Symbol เดียวกัน 2 โบรกจะได้ `AMBIGUOUS_ASSET_BROKER` ทั้งสองแถว → ถูก
    catch นับเป็น `excludedAssetCount` → **มูลค่าพอร์ตรายคืนขาด Symbol นั้นไปทั้งก้อน
    โดยไม่มี Error ให้เห็นเลย** · เพิ่ม `assetId`/`brokerId` เข้า `holding` ของ
    `portfolio.service` เพื่ออุดจุดนี้
  - **Red-Green จริง 6 ชุด** (ถอด Fix ออก → แดง → ใส่กลับ → เขียว):
    (1) ถอด throw กำกวม → **แดง 4/37** (2) ถอดการยกเว้น Symbol เดิมจากเพดาน →
    **แดง 2/15** (3) ถอด `brokerId` จาก `toCommitParams` → **แดง 2/4** (4) ถอด
    `holding.brokerId` จาก Snapshot Job → **แดง 2/10** (5) ถอด `assertOwnedBrokerId`
    ฝั่ง HTTP → **แดง 2/9** (6) ถอด `assertOwnedBrokerId` ฝั่ง LINE Postback → **แดง 1/13**
  - Test ทั้งชุด **118 suites / 2,381 tests → 122 suites / 2,427 tests** เขียวทั้งหมด
  - ⚠️ **Red-Green ระดับ SQL ของ Constraint เองยังไม่ได้รัน** (เครื่องนี้ไม่มี
    Docker/psql) — Script เขียนไว้ท้าย migration 046 แล้ว รอ Founder รันบน
    Supabase Branch · **ยังไม่ได้ Production Verification ทั้งหมด** (ห้าม Deploy)

- **Multi-Portfolio / Broker / Sector / Dividend — Stage 1–4 + 6a**
  (Branch `feat/dashboard-production-wire` — ยัง**ไม่ได้ Push/Merge/Deploy**
  รออนุมัติ · Migration **ยังไม่ได้ Apply บน Supabase**)
  ออกแบบไว้ที่ [`DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md`](./DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md)
  - **Stage 1 (`a3bc2e5`) — migration 042 `brokers` + `assets.broker_id`**
    ตาราง `brokers` ต่อ User (ไม่ใช่ Master List กลาง) + 4 Endpoint (Free ทั้งหมด)
    · UNIQUE แบบ Case-insensitive `uniq_brokers_user_name_ci ON (user_id, lower(name))`
    กัน "Bitkub"/"bitkub"/"BITKUB" แตกเป็น 3 กลุ่มบนกราฟโดนัท
    · `ON DELETE SET NULL` ไม่ใช่ CASCADE (ลบโบรกต้องไม่ลบสินทรัพย์ทิ้ง)
  - **Stage 2 (`2cee72f`) — migration 043 `assets.sector`**
    คอลัมน์ธรรมดา ไม่ทำตาราง `sectors` แยก · ไม่ล็อกค่า (Taxonomy ต่างกันตาม
    ประเภทสินทรัพย์) · Index บน `lower(sector)` เพื่อจัดกลุ่ม Case-insensitive
    · **ต่างจาก Design Doc § 3.2 หนึ่งจุดโดยตั้งใจ**: ไม่ใช้ "Title Case" เพราะจะ
    ทำ `SET50` → `Set50` และ `REIT` → `Reit` — ยึด Pattern เดียวกับโบรกแทน
    (เก็บรูปแบบที่ผู้ใช้พิมพ์ + เทียบแบบ Case-insensitive)
  - **Stage 3 (`2038a5d`) — migration 044 เปิด Multi-portfolio + Backfill**
    Invariant ใหม่: **ทุก user มีพอร์ต Default 1 อันเป๊ะ + สินทรัพย์ทุกแถวสังกัดพอร์ต**
    · **เจอบั๊กใน Design Doc 2 จุดแล้วแก้:**
      **(1)** Design Doc เขียน Backfill เป็น `type = 'mixed'` ซึ่ง **ไม่อยู่ใน CHECK
      ของ `portfolios.type`** (`crypto/stock_th/stock_us/etf/fund/custom`) และคำว่า
      `'mixed'` ไม่ปรากฏที่ไหนเลยในโค้ดทั้งโปรเจกต์ → รันตาม Design Doc ตรงๆ
      Backfill จะ ERROR ทั้งก้อน · แก้เป็น `'custom'` + เพิ่ม Pre-flight อ่าน
      `pg_get_constraintdef` ของจริงมาตรวจ ไม่เชื่อเอกสาร
      **(2)** Design Doc สรุปว่าการย้าย `portfolio_id` จาก NULL → uuid ไม่ทำให้ชน
      UNIQUE ของ migration 014 เพิ่ม — **ถูกเฉพาะกรณี user ที่ไม่เคยมีพอร์ตมาก่อน**
      ตกเคส user ที่มีพอร์ตอยู่แล้วและถือ symbol เดียวกัน 2 แถว (แถวหนึ่ง
      `portfolio_id = NULL` อีกแถว `= P1`) ซึ่งพอย้ายเข้า P1 จะกลายเป็น
      `(U,BTC,P1)` ทั้งคู่ = ชน UNIQUE กลางทาง · เพิ่ม STEP 6 ตรวจก่อนแล้วล้ม
      พร้อมข้อความที่บอกวิธีแก้ แทน Error Constraint ดิบๆ
    · **ต่างจาก Design Doc อีกจุด**: Backfill ให้ user **ทุกคน** ไม่ใช่เฉพาะคนที่มี
    สินทรัพย์ (ไม่งั้นวันที่เขาซื้อตัวแรกโค้ดจะต้องมี Branch "ยังไม่มีพอร์ต" อีก)
  - **Stage 4 (`caa68cf`) — migration 045 Guard ตรวจผล Backfill**
    SELECT + RAISE ล้วน ไม่แก้ข้อมูล · 5 ข้อ รวม **CHECK 4 ที่ Design Doc ไม่ได้ระบุ**:
    สินทรัพย์ต้องไม่สังกัดพอร์ตของผู้ใช้คนอื่น (FK ตรวจได้แค่ "พอร์ตมีอยู่จริง"
    ไม่ได้ตรวจ "เป็นของใคร" — บทเรียนจาก Cross-User Audit 9 ส.ค.)
  - **Stage 6a (`38aa28a`) — enumerate `transaction.type` ครบทุกค่า (ยังไม่เปิด dividend)**
    เพิ่ม `src/utils/transactionType.util.js` เป็นแหล่งตัดสินความหมายของ type
    ที่เดียวของทั้งระบบ ทุกฟังก์ชันเป็น exhaustive switch ที่ `default: throw`
    · แก้ 6 จุดตามตารางใน Design Doc § 2 (`transaction.service` /
    `portfolio.service` / `flexMessage.util` / `reportExport.service` ×3 /
    `transactions.controller`)
    · **เจอจุดที่ 7 ที่ Design Doc ไม่ได้อยู่ในตาราง 6 จุด และร้ายแรงที่สุด:**
    `undoTransaction.service.js:121` `latest.type === 'buy' ? 'sell' : 'buy'`
    — ถ้า `dividend` เข้ามาได้ การกด "ย้อนล่าสุด" บนรายการปันผลจะสร้างแถว
    **`buy`** = เพิ่มทั้งจำนวนที่ถือและต้นทุนให้ผู้ใช้จากอากาศโดยไม่มี Error
    · Regression Red-Green จริง (`dividendLedger.regression.test.js`): ถอด fix
    ออก = **แดง 13 / เขียว 104 จาก 117** — 104 เคสของ buy/sell ยังเขียวตลอด
    ยืนยันว่าเทสต์เจาะจงพอ ไม่ใช่แดงมั่ว · ใส่กลับ = เขียว 117/117
    · Test ทั้งชุด **116 suites / 2264 tests → 118 suites / 2381 tests** เขียวทั้งหมด
    (ส่วนต่าง = ไฟล์เทสต์ใหม่ 2 ไฟล์พอดี ไม่มีเทสต์เดิมตัวใดเปลี่ยนผล →
    ยืนยันว่าเป็น Pure Refactor จริง)

- **มาสคอต "อีซี่" ท่าคิด/ประมวลผล ระหว่างรอ AI อ่านสลิปบนเว็บ**
  (Branch `feat/undo-command-aliases` เดียวกับงานคำสั่งพ้อง — ยัง**ไม่ได้
  Push/Merge** รออนุมัติ) · ไม่มี Migration · ไม่แตะ Logic การอ่านสลิป/โควตา/
  Ledger — งานนี้แค่ใส่รูประหว่างรอ
  - **ปิดช่องว่างจาก feature/mascot-flex-redesign (c93e83a)**: ตอน Wire รูป
    มาสคอตรอบแรก Wire ไป 8 จาก 9 รูป เหลือ `02-processing-thinking.png`
    ที่ยังไม่ได้ใช้ เพราะตอนนั้นไม่มีการ์ด Flex ที่ตรงกับสถานะ "กำลังประมวลผล"
  - **มติ Founder: ใช้เฉพาะฝั่งเว็บเท่านั้น** — ตัดฝั่ง LINE ออกโดยตั้งใจ เพราะ
    LINE ตอบกลับได้ครั้งเดียวต่อ 1 Event ถ้าจะโชว์ "กำลังอ่าน…" ต้องเปลี่ยนไปใช้
    `pushMessage` ที่มีโควตาจำกัดตามแพ็กเกจ LINE ถ้าโควตาหมดผู้ใช้จะไม่ได้รับ
    ผลอ่านสลิปเลย — แย่กว่าการไม่มีรูปมาก
  - **ยืนยันไฟล์อยู่บน Supabase Storage แล้วจริง** — `curl -I` ที่
    `.../flex-assets/02-processing-thinking.png` คืน `200` `Content-Length:
    1382062` ตรงกับไฟล์ในโปรเจกต์เป๊ะ (`Last-Modified` ตรงกับวันที่ Commit
    c93e83a) — **ไม่ต้องอัปโหลดใหม่** (ค้นแล้วพบว่าอัปไว้แล้วตั้งแต่รอบแรก
    พร้อมอีก 8 รูป เพียงแต่ยังไม่ได้ Wire เข้าโค้ด)
  - `frontend/src/components/dashboard/DcaForm.jsx`: แยก `ScanningMascot`
    เป็น Sub-component รับ Prop ตรงๆ (`scanning`/`failed`/`onImgError`) วางไว้
    ข้างปุ่ม "📷 อัปโหลดสลิปให้ AI อ่าน" ภายใน `.dh-entry-choice` เดิม
    - **กัน Layout กระโดด**: `<span>` ขนาดคงที่ 29×44px (สัดส่วนจริงของรูป
      1024×1536) **Render อยู่เสมอ**ไม่ว่า `ocrScanning` จะเป็น `true`/`false`
      สลับแค่ Class ผ่าน `opacity` (ไม่ Mount/Unmount) จึง "จอง" พื้นที่ไว้ตลอด
      ไม่มี Element ถูกเพิ่ม/ลดออกจาก Flow เลย
    - `alt="กำลังอ่านสลิป"` (ไม่ใช่ `alt=""`) ตามที่กำหนด
    - `onError` set `ocrMascotFailed` → ซ่อนรูปเงียบๆ ไม่ให้ไอคอนรูปแตกค้าง
      (Reset กลับ `false` ทุกครั้งที่เริ่มสแกนใหม่) ปุ่มข้างๆ ยังโชว์ "🤖
      กำลังอ่านสลิป…" ตามปกติเสมอไม่ว่ากรณีนี้
    - Animation ลอยเบาๆ (`translateY` ±4px, 2.6s) เคารพ
      `prefers-reduced-motion: reduce`
  - Test: `dashboardComponents.render.test.js` — เพิ่ม 4 เคสยืนยัน
    `scanning=true` → มี Class `visible` + `alt` สื่อความหมาย,
    `scanning=false` → ไม่มี Class `visible` แต่ `<span>`/`<img>` ยัง Render
    อยู่ (พิสูจน์ว่าไม่ได้ Unmount), `failed=true` → ไม่มี Class `visible`
    แม้ `scanning=true`, และนับจำนวน Element เท่ากันทุก State (ยืนยันว่าไม่มี
    อะไรถูกเพิ่ม/ลดออกจาก Flow) · Red-Green: ถอด Logic Toggle ออก → 1 เคสแดง
    ตรงจุด เทสต์ที่เหลือเขียวตลอด — Frontend 280 → 284 (+4) เขียวทั้งหมด ·
    `vite build` ผ่าน · ESLint: Frontend ไม่มี `eslint.config.*`/`.eslintrc.*`
    ในโปรเจกต์เลย (ปัญหาเดิมของ Repo ไม่เกี่ยวกับงานนี้) รันไม่ได้จริง —
    ตรวจ Diff ด้วยมือแทน (ไม่มี Import ค้าง/ตัวแปรไม่ใช้)
- **Link Facebook Page จริงบนหน้า `/support`** — เดิมเป็น Placeholder `📘 Facebook`
  พร้อมป้าย "เร็วๆ นี้" ที่กดไม่ได้
  - ไอคอนโลโก้ Facebook จริง (Inline SVG วงกลมน้ำเงิน `#1877F2` + ตัว "f") แทน Emoji
    — ใช้ Inline SVG แทนการเพิ่ม Icon Library ใหม่ทั้งก้อน (โปรเจกต์นี้ไม่มี
    `lucide-react`/`react-icons` ติดตั้งอยู่เลย และใช้ไอคอนนี้ตัวเดียว)
  - เปิดแท็บใหม่เสมอ (`target="_blank"` + `rel="noopener noreferrer"`) — ผู้ใช้กลับมา
    หน้า `/support` ได้โดยไม่ต้อง Reload/Login ใหม่ (`noopener` กัน Tab ใหม่แตะ
    `window.opener` ของหน้าเดิม)
  - Instagram/TikTok **ยังเป็น Placeholder เดิม** (ยังไม่มี Account จริง) ไม่แตะ
- **Push LINE แจ้งเมื่อกดรับ Premium ฟรีสำเร็จ** — เดิมกดรับแล้วรู้ผลแค่บนหน้าเว็บ
  ไม่มีอะไรยืนยันในแชท
  - แจ้งวันเริ่ม + วันหมดอายุจริงตรงกับที่เขียนลง DB พร้อมปุ่มไปหน้า `/premium`
    (ผ่าน `externalUrl.util` — External Browser เหมือนลิงก์อื่นในแชท)
  - Reuse Flex Pattern เดียวกับ `buildPaymentApprovedMessage` ของ Payment จริง
    (มี Push ยืนยันอยู่แล้ว) — ไม่สร้าง Builder หน้าตาใหม่ที่ไม่เข้าชุดกัน
  - **Best-effort**: Push ล้มเหลว (LINE API ล่ม/ผู้ใช้บล็อกบอท) **ไม่ Rollback การ
    Claim** — สิทธิ์ถูกเขียนลง DB แบบ Atomic ไปแล้ว (Source of Truth) การตอบ Error
    จะหลอกผู้ใช้ว่ากดรับไม่สำเร็จทั้งที่ได้สิทธิ์แล้ว
  - Copy Banner หน้า `/premium`: ตัดคำอธิบายเงื่อนไข 3 ข้อใต้หัวข้อออก เหลือหัวข้อ +
    ปุ่มกดรับ (ไม่แตะ Logic การ Claim/Guard ใดๆ)
- **Cron เตือนก่อน Premium หมดอายุ 3 วัน** (`premiumExpiryReminder.job`, ทุกวันตี 2)
  — เดิมระบบมีแต่ Push *หลัง* หมดอายุแล้ว (`planDowngrade.job` — สายเกินจะต่อทัน)
  · **Migration 030** (`users.expiry_reminder_sent_at`)
  - ใช้กับ Premium **ทุกคนเท่ากัน** ไม่ว่าได้มาจากทางไหน (จ่ายเงินจริง / Admin Grant /
    Free Trial) เพราะกรองจาก `plan` + `plan_expires_at` ซึ่งเป็นคอลัมน์เดียวที่ทุก Path
    เขียนลงไป — ไม่มี Path ไหนถูกลืม
  - กันส่งซ้ำ: `expiry_reminder_sent_at` ปั๊ม**หลัง** Push สำเร็จเท่านั้น และถูก Reset
    เป็น NULL ที่ `updatePlan()`/`claimFreeTrial()` เพื่อให้รอบบิลถัดไปเตือนได้อีก
  - รันตี 2 (หลัง `planDowngrade` ตี 1) + Error Isolation รายคน (1 คนพังไม่หยุด Batch)
- **รับ Premium ฟรี 1 เดือนได้เอง (แคมเปญชั่วคราว)** — ผู้ใช้กดรับเองที่หน้า `/premium`
  ไม่ต้องรอ Admin กดให้ทีละคน · **Migration 029** (`users.free_trial_claimed_at`)
  - **สิทธิ์ครั้งเดียวตลอดชีพต่อบัญชี** กันด้วย Atomic Claim
    (`UPDATE ... WHERE free_trial_claimed_at IS NULL` — Statement เดียวกับตอนให้สิทธิ์
    จึงกันกดรัวพร้อมกันได้จริง Pattern เดียวกับ `claimForApproval` ของ Payment)
  - ได้ **1 เดือนเป๊ะ ไม่ Stack** (ส่ง `null` เข้า `computeRenewalExpiry` โดยเจตนา)
    หมดอายุแล้ว `planDowngrade.job` ลดกลับเป็น Free อัตโนมัติด้วย Path เดียวกับ
    Premium ที่จ่ายเงินจริง — ไม่ต่ออายุให้เอง
  - Guard 6 ชั้น: Flag ปิด / บัญชี locked-anonymized / เคยกดรับ / เป็น Premium อยู่ /
    เคยจ่ายเงินสำเร็จ / เคยได้ Admin Grant
  - ปิดแคมเปญได้ด้วย Env Var `PREMIUM_FREE_TRIAL_ENABLED=false` (Restart ~1-2 นาที
    **ไม่ต้อง git push / ไม่ต้อง Build**) — Fail-closed: ต้องเป็น `true` เป๊ะถึงจะเปิด
  - ⚠️ ผลต่อ `/admin/stats`: **ไม่กระทบรายได้** (ไม่แตะตาราง `payments` เลย) แต่
    `premiumUsers` เพิ่มตามจริง — ระหว่างแคมเปญ Premium ≠ คนจ่ายเงิน
- **โลโก้สินทรัพย์บน Dashboard เว็บ** — ดึงอัตโนมัติแทนตัวอักษรย่อ+สีเดิม (Crypto ผ่าน
  CoinGecko API + Cache localStorage 30 วัน / หุ้นผ่าน `cdn.tickerlogos.com` ตาม Domain
  บริษัทที่ Curate ไว้ ~55 ตัวหลัก) Fallback กลับตัวอักษรย่อเดิมเสมอเมื่อหาโลโก้ไม่ได้
  หรือโหลดรูปไม่สำเร็จ (ไม่ใช่ Broken Image Icon) — UI-only ไม่แตะ Logic การเงิน
- **บันทึกการขายบน Dashboard เว็บ** — Toggle 🟢 ซื้อ / 🔴 ขาย ในกล่องบันทึกรายการเดียวกัน
  (เดิมเว็บบันทึกได้แค่ซื้อ ต้องไปพิมพ์คำสั่งใน LINE ถ้าจะขาย)
  - `POST /api/v1/transactions` รับ `side` เพิ่ม (ไม่ส่ง = `"buy"` เหมือนเดิมทุกประการ)
    รองรับ `quantity + pricePerUnit` และ `sellAll: true` — เรียก
    `transaction.service.processSellCommand` ตัวเดียวกับคำสั่งพิมพ์ใน LINE
    (ไม่มี Logic คำนวณเงินใหม่ / ไม่แตะ `transaction.service` / **ไม่มี Migration**)
  - โหมดขายเลือกได้เฉพาะสินทรัพย์ที่ถืออยู่จริง + แสดงยอดคงเหลือ + ปุ่ม "ขายทั้งหมด"
    (ส่ง `sellAll` ให้ Backend หายอด+ราคาตลาดเอง จึงไม่เหลือเศษค้างในพอร์ต)
### Fixed
- **คำสั่ง "ย้อนล่าสุด" พิมพ์ไม่ได้ ทั้งที่การ์ด/ปุ่มสอนคำนี้เอง**
  (feat/undo-command-aliases — ยัง**ไม่ได้ Push/Merge** รออนุมัติ) · ไม่มี
  Migration · ไม่แตะ Logic — เพิ่ม Regex Alias อย่างเดียว ไม่ลบของเดิม
  - **ช่องว่างที่เกิดจาก fix/misleading-messages**: งานรอบก่อนเปลี่ยนคำที่ระบบ
    "พูด" จาก "ยกเลิกรายการ" เป็น "ย้อนรายการ" ทุกจุด (การ์ด LINE/ปุ่มเว็บ/ป้าย
    ในประวัติ) แต่คำสั่งที่ผู้ใช้ต้อง "พิมพ์" ยัง ไม่ได้ อัปเดตตาม —
    `commandParser.service.js` `UNDO_LAST` ยังรับแค่ `ยกเลิกล่าสุด`/
    `ยกเลิกรายการล่าสุด`/`undo` ผลคือผู้ใช้เห็นการ์ดเขียนว่า "↩️ ย้อนรายการ
    ล่าสุดแล้ว" แล้วพิมพ์ตามคำที่ระบบสอนเอง ("ย้อนล่าสุด") ระบบกลับไม่รู้จัก
    (Founder เป็นคนสังเกตเจอ)
  - Fix: เพิ่ม `ย้อนล่าสุด`/`ย้อนรายการล่าสุด` เข้า `UNDO_LAST` **คู่กับ** ของเดิม
    (ไม่ลบ — คำเดิมยังต้องใช้ได้กับผู้ใช้ที่คุ้นอยู่แล้ว) พร้อม Comment อธิบาย
    ว่าทำไมต้องมีทั้ง 2 ชุดคำ กันคนรุ่นหลังเห็นแล้วคิดว่าซ้ำซ้อนแล้วลบทิ้ง
  - **อัปเดตที่แสดง "คำสั่งที่ใช้ได้" ให้ผู้ใช้เห็น** (ค้นหาทั้งระบบ พบ 2 จุดที่
    ยังสอนแค่คำเดิม): การ์ด "❓ วิธีใช้งาน" ทาง LINE
    (`flexMessage.buildHelpMessage`) และแท็บ "วิธีใช้งาน" บนเว็บ
    (`PortfolioDetailSection.jsx`) — เปลี่ยนให้สอน `ย้อนล่าสุด` เป็นหลัก (ตรงกับ
    ที่การ์ดยืนยันพูดเอง) พร้อมระบุว่า `ยกเลิกล่าสุด` ยังใช้ได้เหมือนกัน · Tooltip
    ปุ่ม Undo ใน `RecentList.jsx` (ไม่ใช่ Regex — แค่ข้อความอธิบาย) อัปเดตให้บอก
    ครบทั้ง 2 คำด้วย · `pages/Dashboard.jsx` (Legacy) มีบล็อกเดียวกัน แต่ตรวจแล้ว
    **ไม่มี Route ไหน Import มา Render** (`App.jsx` Redirect `/dashboard/classic`
    ไป `/dashboard` ทั้งหมด) จึงไม่แตะ — ไม่มีผู้ใช้เห็นข้อความนี้จริง
  - **ผลตรวจคำสั่งอื่นทั้งหมด** (ไล่ Regex ทุกตัวใน `commandParser.service.js`
    เทียบกับคำที่ระบบสอนในการ์ด/ปุ่ม/เมนูทุกจุด): **ไม่พบจุดอื่นที่ "ระบบพูดคำหนึ่ง
    รับอีกคำหนึ่ง" อีก** — `พอต`/`ประวัติ`/`กำไร <สินทรัพย์>`/`นำเข้าพอร์ต`/
    `ดูเตือน`/`ลบเตือน <สินทรัพย์>`/`ลบข้อมูล`/`ส่งออกรายงาน [ช่วงเวลา]`/ตัวอย่าง
    คำสั่งซื้อ-ขาย ทุกจุดที่สอนไว้ตรงกับ Alias ที่ Regex รับจริงเป๊ะ
  - Test: `commandParser.test.js` — ทั้ง 5 คำ (`ยกเลิกล่าสุด`/`ยกเลิกรายการล่าสุด`/
    `ย้อนล่าสุด`/`ย้อนรายการล่าสุด`/`undo`) Parse เป็น `UNDO_LAST` เดียวกัน + คำ
    ใกล้เคียงที่ไม่ควรเข้าเป้า (`ยกเลิก`/`ย้อน`/`ล่าสุด`/`ย้อนกลับ`/`ยกเลิกรายการ`
    เฉยๆ) ยืนยันว่าไม่เข้า UNDO_LAST (กัน Regex กว้างเกิน) · Red-Green: ถอด Alias
    ใหม่ออก → 2 เคสแดงตรงจุด เทสต์ที่เหลือ 107 เคสเขียวตลอด · เพิ่มเทสต์ยืนยัน
    ข้อความช่วยเหลือ LINE + เว็บ สอนคำใหม่ถูกต้อง — Backend 2,206 → 2,214 (+8) ·
    Frontend 278 → 280 (+2) เขียวทั้งหมด · `vite build` ผ่าน · ESLint สะอาด
- **ข้อความในระบบผิดข้อเท็จจริง/กำกวม 6 จุด** (fix/misleading-messages — Deploy
  `d89c2b6` 23 ส.ค. 2569 · ตรวจ Commit Hash ทั้ง 3 Service + jobCount + Health +
  Error Log แล้ว) · ไม่มี Migration · ไม่แตะ Logic การเงิน/Ledger เลย
  ยกเว้นข้อ 3 (แค่อ่าน `status` ที่มีอยู่แล้วมาเลือกข้อความ ไม่มี Query/เงื่อนไข
  ทางธุรกิจใหม่) — หลักที่ยึด: บอก **ผลลัพธ์ที่เกิดกับผู้ใช้ก่อน** แล้วค่อยอธิบาย
  กลไก, ห้ามอ้างสิ่งที่ระบบทำไม่ได้จริง, เรื่องเงินต้องไม่กำกวม
  1. **`OCR_TRIAL_EXHAUSTED` อ้างว่า Premium อ่านสลิปได้ "ไม่จำกัด"** — ผิด จริง
     คือจำกัด `MONTHLY_QUOTA` = 50 ครั้ง/เดือน คนจ่ายเงินแล้วเจอเพดานจะรู้สึกถูก
     หลอก แก้ให้อ้างอิงตัวเลขจริงแทน (Backend: `slipOcrService.MONTHLY_QUOTA`
     ตรงๆ · Frontend: ค่าคงที่ `PREMIUM_OCR_MONTHLY_QUOTA` คู่กันเพราะ Import
     ข้าม Deploy ไม่ได้) ตรวจครบทั้งระบบแล้วว่า "สินทรัพย์/แผน DCA ไม่จำกัด"
     (Premium) เป็นความจริง ไม่ต้องแก้ (`entitlement.getActiveAssetLimit`/
     `getActiveDcaPlanLimit` คืน `null` จริงเมื่อ Premium Active)
  2. **คำว่า "ยกเลิก" ใช้กับ 2 เหตุการณ์ที่ผลต่างกันสิ้นเชิง** — Pending ที่ยังไม่
     เคยบันทึก (`buildCancelledMessage`) กับรายการที่บันทึกลง Ledger ไปแล้วจริง
     แล้วถูกย้อน (`buildUndoMessage`/`NO_TRANSACTION_TO_UNDO`/`ALREADY_UNDONE`/
     `CANNOT_UNDO_QUANTITY_MISMATCH`/`CANNOT_ATTACH_TO_REVERSAL`) ใช้คำเดียวกัน
     ผู้ใช้แยกไม่ออกว่าข้อมูลตัวเองอยู่สถานะไหน — เปลี่ยนกลุ่มหลังทั้งหมดเป็น
     "ย้อน" (LINE + เว็บ Backend + Frontend คู่กันครบ) `buildCancelledMessage`
     ไม่ถูกแตะ (ใช้ "ยกเลิก" ถูกอยู่แล้ว)
     - รอบตรวจก่อน Deploy พบเพิ่มอีก 2 จุดที่ขัดกับคำที่เพิ่งแก้ (Founder อนุมัติ
       ให้รวมเข้ารอบนี้): `transactionNote.js` Label รายการ Reversal ใน
       ประวัติถาวร (`'↩︎ ยกเลิกรายการ'` → `'↩︎ ย้อนรายการ'` — จุดที่ผู้ใช้เห็น
       บ่อยสุดเพราะติดอยู่กับทุกแถวรายการ Reversal ตลอดไป) และปุ่มที่เปิด
       `UndoConfirmModal` ใน `RecentList.jsx` (`'↩︎ ยกเลิก'` → `'↩︎ ย้อน'`) กับ
       `DcaForm.jsx` การ์ดยืนยันหลังบันทึกสำเร็จ (`'↩︎ ยกเลิกรายการนี้'` →
       `'↩︎ ย้อนรายการนี้'`) — เดิมปุ่มเขียน "ยกเลิก" แต่เปิด Modal ที่เขียน
       "ย้อน" ขัดกันเองบนหน้าจอเดียว
  3. **"ถูกดำเนินการไปแล้ว" ไม่บอกว่าสำเร็จหรือถูกยกเลิก** (`PENDING_ALREADY_
     RESOLVED` กดยืนยันซ้ำ · `PAYMENT_NOT_PENDING` แจ้งชำระซ้ำ) — ระบบรู้คำตอบ
     อยู่แล้วจาก `status` ที่ Error แนบมาด้วยเสมอ (`pendingTransaction.service`/
     `payment.service`) แค่ไม่เคยส่งต่อมาถึงชั้นสร้างข้อความ — เดินสาย
     `err.details` ผ่านทุกชั้น: `webhook.controller.replyWithError` →
     `flexMessage.buildErrorMessage(code, details)` (LINE) และ
     `payment.controller.handlePaymentError` → `frontend/src/lib/api.js`
     (`apiPost`/`apiUpload` แนบ `.details` ให้ Error ที่ throw) → `Premium.jsx`
     (เว็บ) แยกข้อความตาม `confirmed`/`cancelled`/`expired` และ
     `approved`/`rejected`/`reviewing`/`expired` ตามลำดับ — ไม่มี `status` แนบมา
     (Error เก่า/ไม่คาดคิด) Fallback ข้อความเดิมเป๊ะ ไม่ throw
  4. **ปุ่ม "ไม่ยกเลิก" ในหน้าต่าง "ยืนยันยกเลิกรายการ"** (`UndoConfirmModal.jsx`)
     — ปฏิเสธซ้อนปฏิเสธ ตีความได้ 2 ทาง (ไม่ย้อนรายการ? ไม่ปิดหน้าต่าง?) และเป็น
     ปุ่มฝั่งปลอดภัยที่กดผิดแล้วข้อมูลเปลี่ยน เปลี่ยนเป็น "ปิด" (ไม่กำกวม) พร้อม
     หัวข้อ/ปุ่มยืนยันใช้คำว่า "ย้อน" สอดคล้องกับข้อ 2
  5. **การ์ดย้อนรายการอธิบายกลไกก่อนบอกผลลัพธ์** — เดิมขึ้นต้นด้วย "สร้างรายการ
     ตรงข้ามเพื่อชดเชย" (ภาษาบัญชี Founder เองยังสะดุด) ย้ายผลลัพธ์ขึ้นก่อน
     ("ยอด {symbol} ในพอร์ตกลับไปเป็นเหมือนก่อนบันทึกรายการนี้แล้ว") คำอธิบาย
     กลไกยังอยู่ครบแต่ย้ายไปเป็นหมายเหตุตัวเล็กท้ายการ์ด
  6. **`PRICE_FEED_NOT_IMPLEMENTED` อ้างว่า "รองรับเฉพาะ Crypto"** — ผิด: ไล่โค้ด
     ยืนยันแล้วว่า `priceFeed.service.getCurrentPrice` Route ผ่าน Twelve Data
     สำหรับ `stock_us` ด้วย (ทั้งเส้นทาง LINE และเว็บ — `symbolRegistry.lookupType`
     เติม `type` ก่อนถึง Service เสมอทั้งสองทาง) ต่างกันแค่ THB ต้องยิง 2 Request
     (ราคาหุ้น + เรต FX) ส่วน USD ยิงแค่ 1 Request จึงเสถียรกว่าเมื่อโดน Rate
     Limit 8 Credit/นาที — Error นี้ส่วนใหญ่คือ "ดึงราคาไม่สำเร็จชั่วคราว" ไม่ใช่
     "ไม่รองรับสินทรัพย์นี้" (ยกเว้นหุ้นไทย/กองทุนที่ไม่มี Price Feed จริง) แก้
     ข้อความให้ตรงตามนี้ + แนะนำ "usd" เป็นทางที่เสถียรกว่า
  - Test: Backend **2,206 tests / 113 suites เขียว** (2,175 → 2,206 = +31 เคสใหม่
    ใน 5 ไฟล์ทั้งใหม่และเดิม) · Frontend **278 tests / 16 files เขียว** (259 → 278
    = +19 เคสใหม่ รวม `Premium.errorText.test.js` ไฟล์ใหม่ — `errorText` Export
    เพิ่มจาก `Premium.jsx` เพื่อ Unit Test ได้ตรงๆ โดยไม่ต้องเพิ่ม Dependency
    Render Test ใหม่) · Red-Green พิสูจน์จริงสำหรับ Logic ข้อ 3 ทั้งสองฝั่ง (LINE:
    `buildErrorMessage` ถอด Branch ออก → 9 เคสแดงตรงจุด, เว็บ: `payment.controller`
    ถอด Passthrough ออก → 1 เคสแดงตรงจุด, ทั้งสองครั้งเทสต์ที่เหลือเขียวตลอด) ·
    `vite build` ผ่าน · ESLint 0 error บนไฟล์ที่แตะทั้งหมด (1 error เดิมที่
    `entitlement.service.js` เป็นของก่อนหน้า ไม่เกี่ยวกับงานนี้)
  - แก้เทสต์เดิม 1 จุด: `webhook.controller.test.js` เคส "หุ้นไทยที่ยังไม่มี Price
    Feed" เดิม Assert คำว่า `'เฉพาะบางสินทรัพย์'` ซึ่งเป็นข้อความที่เพิ่งพิสูจน์ว่า
    ผิดข้อเท็จจริง (ข้อ 6) เปลี่ยนไป Assert `'ดึงราคาตลาด'` แทน (ยืนยันแค่ว่าแปล
    เป็นไทยแล้วไม่โชว์ Error Code ดิบ ไม่ตรึงคำที่ตอนนี้เป็นเท็จ)
- **ยอดเงินที่แสดง ≠ ยอดเงินที่บันทึกลง Ledger (2 บั๊คแยกกัน · บั๊ค A พบ 3 ทางเข้า)** — Deploy `2c75941`
  (23 ส.ค. 2569) · **ไม่มี Migration** · Post-mortem เต็ม:
  [`POSTMORTEM_AMOUNT_CONSISTENCY.md`](./POSTMORTEM_AMOUNT_CONSISTENCY.md)
  - **บั๊ค A — Preview 100 บาท แต่บันทึก 100.01 บาท** (เคสจริง `ซื้อ BTC 100`,
    `quantity=0.00003979` × `pricePerUnit=2,513,380`)
    - Root Cause: `pendingTransaction.toCommitParams` ส่งต่อแค่ `quantity` +
      `pricePerUnit` ไม่ส่ง `amountThb` ที่ Snapshot ไว้ →
      `transaction.service.resolveQuantityAndPrice` เข้า Branch แรกแล้ว **คำนวณยอด
      ขึ้นใหม่** เศษที่ถูกปัดทิ้งตอนหาร `quantity` เหลือ 8 ตำแหน่ง
      (`NUMERIC(20,8)`) จึงถูกคูณราคากลับขึ้นมาเป็น 1 สตางค์
      (ขอบเขตความคลาดเคลื่อน = `0.5e-8 × pricePerUnit` — ยิ่งราคาสูงยิ่งชัด)
    - พบ **3 ทางเข้าที่มีกลไกเดียวกันเป๊ะ**: LINE Preview→Confirm ·
      Postback สลิป (`ocr_confirm`) · ฟอร์มเว็บ Branch `hasPrice`
      (`transactions.controller`) — ทางเข้าที่ 3 มี Comment ในโค้ดยอมรับความ
      คลาดเคลื่อนไว้เองแล้วสรุปว่ารับได้เพราะ "หุ้นไทยราคาหลักพัน" ซึ่งผิด เพราะ
      Branch นั้นเปิดให้กรอกราคาเองได้ทุกสินทรัพย์
    - Fix: พก `amountThb` ที่ตกลงไว้ข้าม Preview→Confirm ทุกทาง + `resolveAgreedAmount`
      Guard 2% (ค่าเดียวกับ `SANITY_RATIO` ของ `slipOcr`) กันยอดที่ไม่เข้าคู่กับ
      `quantity × price` ลง Ledger พร้อม Log ทุกครั้งที่ปฏิเสธ · **ยังคำนวณจาก
      `quantity × pricePerUnit` เหมือนเดิมทุกประการเมื่อไม่มียอดที่ตกลงไว้ก่อน**
      (เส้นทางพิมพ์จำนวนหน่วย+ราคาเอง) · `sellAll` ตัด `amountThb` ที่อาจติดมาทิ้งเสมอ
    - Commit `1d2bf50` (LINE + Postback) · `cbb375a` (ฟอร์มเว็บ)
  - **บั๊ค B — การ์ด/ฟอร์มสลิปแสดง "รวมจ่ายจริง" ผิดข้อเท็จจริง** (สลิป Dime! EOSE:
    ระบบแสดง 106.59 ทั้งที่ผู้ใช้จ่ายจริง 106.72 · มูลค่าหุ้น 106.32 ทั้งที่สลิประบุ 106.44)
    - Root Cause: AI อ่าน **มูลค่าหุ้นและค่าธรรมเนียมถูกต้องทั้งคู่ แต่ตอบ
      `net_amount = null`** ทุกใบ (ยืนยันจาก Railway Log จริง 22 ส.ค. 2569 —
      `reason="no_fee_or_net_to_verify" aiAmount=106.44 netAmount=null feeTotal=0.27`)
      → `slipOcr.resolveGrossAmount` หลุด Guard บรรทัดแรกทันที Rule 2 ที่ควรจับเคสนี้
      **ไม่เคยมีโอกาสทำงานเลย** · สาเหตุที่อ่านไม่ได้: Prompt ยกตัวอย่างป้ายกำกับแบบ
      Settrade แต่สลิป Dime! แสดงยอดรวมเป็นตัวเลขใหญ่บนสุด **ไม่มีป้ายกำกับ**
    - Root Cause ชั้นที่ 2: `DcaForm.jsx` คำนวณ `quantity × price` เองในเบราว์เซอร์
      **ไม่เคยอ่านค่าที่ Backend ส่งมาเลย** (บังเอิญได้เลขเดียวกันจึงแยกไม่ออกจากหน้าจอ)
      — แก้แต่ Backend อาการจะไม่หายเลย
    - Fix 1 (Prompt): อธิบายว่ายอดรวมของแอปหุ้นต่างประเทศอยู่ตรงไหนบนสลิป
      **คงโมเดล `claude-sonnet-5` เดิม** · ย้ำกฎ "ห้ามบวก/ลบ `amount` กับค่าธรรมเนียมเอง"
      ให้เข้มขึ้น — ถ้า AI คำนวณ `net` เอง สมการตรวจสอบจะกลายเป็นวงกลมและ**ช่องโหว่
      BCPG จะเปิดกลับทันที**
    - Fix 2 (ทางสำรอง Deterministic เมื่อไม่มี `net`): แยก "AI หยิบยอดสุทธิมาผิดช่อง"
      (`ai ≈ computed ∓ fee` พอดี → VETO) ออกจาก "ai คือมูลค่าหุ้นจริง" (ต่างจาก
      `computed` เท่าที่การปัดราคาต่อหน่วยอธิบายได้ → ยอมรับ) ด้วย
      `priceRoundingDrift` + เพดาน `SANITY_RATIO` 2% ซ้อนอีกชั้น — ตรวจกับเคสจริงครบ
      ทั้ง EOSE · ASTS · BCPG (ช่องโหว่ BCPG ยังปิดอยู่แม้ไม่มี `net`)
    - Fix 3 (ห้ามโกหก): สลิประบุยอดสุทธิ → แสดงตามสลิป ป้าย "รวมจ่ายจริง/รับจริง" ·
      สลิปไม่ระบุ → เปลี่ยนป้ายเป็น **"รวมโดยประมาณ"** + กำกับว่าระบบคำนวณเอง
      (มติ Founder: แสดงเลขผิดโดยไม่บอกว่าไม่แน่ใจ แย่กว่าไม่แสดงเลย)
    - Fix 4 (เลขที่แสดง = เลขที่บันทึก): Postback ปุ่มยืนยันพก `gross` เมื่อ
      `amountSource='slip_gross'` · ฟอร์มเว็บส่ง `amountTotal` คู่กับ
      `quantity + pricePerUnit` ตราบใดที่ผู้ใช้ยังไม่แก้ช่อง — ทั้งสองทางผ่าน
      `resolveAgreedAmount` Guard 2% เสมอ
    - Log `slip ocr gross amount resolved` เปลี่ยนเป็นยิง**ทุกครั้ง**ที่อ่านสลิป
      (เดิมยิงเฉพาะตอนคำนวณเอง จึงยืนยันผลหลังแก้ไม่ได้) — ไม่มี PII/เลขบัญชี
    - Commit `a42c4a4`
  - **Evidence (Production Verification 23 ส.ค. 2569):** Railway Log 03:38:29 —
    `source="slip_gross" reason="verified_against_net_minus_fee" aiAmount=106.44
    netAmount=106.72 feeTotal=0.27 resolvedAmount=106.44` (**`netAmount` เปลี่ยนจาก
    `null` เป็น `106.72` = Prompt ใหม่ได้ผลจริง**) · Founder ทดสอบเองครบ: LINE
    `ซื้อ BTC 100` → 100 บาท · ฟอร์มเว็บกรอกเอง → 100.00 · สลิป EOSE → มูลค่าหุ้น
    106.44 / รวมจ่ายจริง 106.72 ตรงสลิป · `grep "agreed amount rejected"` ไม่พบเลย ·
    Commit ตรงกันทั้ง 3 Service (Web/Worker/Frontend ซึ่งอยู่คนละ Railway Project) ·
    `jobCount=16` · `/health` 200 · ไม่มี Error Log
  - ⚠️ **ที่ยังยืนยันด้วย Test เท่านั้น (ไม่ได้ยิง Production):** ทางสำรอง
    `verified_against_price_rounding` **ไม่เคยทำงานบน Production เลยแม้แต่ครั้งเดียว**
    — Prompt ใหม่ทำให้ Rule 2 เดิมทำงานแทน · การเขียน Ledger ด้วยยอด 106.44 จากสลิป
    (Founder ตรวจถึงหน้าจอแล้วหยุด ไม่ได้กดบันทึก — Log ยืนยันว่าไม่มี
    `POST /api/v1/transactions` หลัง 03:38:29) · Postback `gross` ทาง LINE · `sellAll`
  - Test: Backend **2,175 tests / 111 suites เขียว** (+32 เคสใหม่) · Frontend
    **259 tests / 15 files เขียว** (+4 เคสใหม่) · **Red-Green พิสูจน์จริงทั้ง 3 ก้อน**
    (ถอด Fix ออกแล้วแดงด้วยเลขจริงจาก Production: 100.01 · 106.32 · 1497.58 โดยเทสต์
    เดิมทั้งหมดเขียวตลอดช่วงที่ใส่บั๊คกลับ)
- **ซื้อหุ้นสหรัฐฯ ที่ไม่อยู่ใน Whitelist (เช่น SPCX) ขึ้น Error กองทุนรวมผิดฝาผิดตัว**
  — ผู้ใช้อัปโหลดสลิปซื้อ SPCX (NASDAQ, ผ่านโบรกเกอร์ Dime!) จริงบน Production, OCR
  อ่านตัวเลขถูกครบ แต่กด "ยืนยันบันทึก" แล้วได้ข้อความ "ระบบข้อมูลกองทุนรวมยังไม่พร้อม
  ใช้งาน" (ยืนยันจาก Railway Log จริง 2026-08-09 07:30 — `webhookEventId=
  01KZJPX5RAA9PCHF5TDMR37DAB`, `code=SEC_NOT_CONFIGURED`)
  - Root Cause: `symbolRegistry.service.js` เป็น Whitelist Hardcode — SPCX ยังไม่อยู่
    ในนั้น `lookupType` จึงคืน `null` แล้ว `routeCommand` (`webhook.controller.js`)
    Fallback ไป `tryResolveFundBuy` **กับ Symbol ที่ไม่รู้ type ทุกตัวโดยไม่แยกแยะ** —
    ยิง SEC Open Data API ที่ไม่เคยถูกสมัคร/ตั้งค่าบน Production เลย
    (`SEC_API_SUBSCRIPTION_KEY`/`SEC_FUND_MASTER_LIST_PATH` ว่าง) แล้ว Re-throw
    `SEC_NOT_CONFIGURED` กลายเป็นข้อความกองทุนรวมที่ผู้ใช้เห็น — ไม่ใช่ SPCX ถูกเข้าใจ
    ผิดว่าเป็นกองทุน แต่เป็น **Ticker ไหนก็ตามที่ไม่อยู่ใน Whitelist โดนเหมือนกันหมด**
  - แก้เร่งด่วน: เพิ่ม `SPCX: 'stock_us'` เข้า `SYMBOL_TYPES` (ตรวจ Railway Log ย้อนหลัง
    ทุก Deployment ที่ยังดึงได้ — เจอเคสเดียวคือ SPCX)
  - แก้ระยะยาว (กันปัญหาซ้ำกับ Ticker ในอนาคตที่ไม่มีทางใส่ Whitelist ได้ครบ): เพิ่ม
    `symbolRegistry.looksLikeThaiFundSymbol()` เช็ค "รูปร่าง" Symbol ก่อนเรียก
    `tryResolveFundBuy` — Ticker ต่างประเทศล้วนตัวอักษร 1-4 ตัว (เช่น SPCX, AAPL) **ไม่
    เรียก SEC เลย** ปล่อยผ่านไปตอบ `VALIDATION_ERROR` "ไม่รู้จักสินทรัพย์นี้" ที่ถูกต้อง
    กว่าแทน ส่วน Symbol ที่มีขีด/ยาวตั้งแต่ 5 ตัวอักษรขึ้นไป (หน้าตากองทุนไทยจริง เช่น
    K-SELECT, SCBRM) ยังค้น SEC ตามปกติ — ไม่มี Silent Default: กรณีไม่มั่นใจ (ยาว ≥5
    ตัวอักษรแต่ไม่ใช่กองทุนจริง) ยังปล่อยให้ลองค้น SEC ก่อนเสมอ ไม่เดาตัดสินใจแทน
  - ⚠️ **Production Verification ค้างอยู่**: ยังไม่ได้ทดสอบซื้อ SPCX จริงผ่าน LINE ซ้ำ
    หลัง Deploy (ตาม AI_WORK_POLICY.md § 3 ข้อ 4) — ต้องเห็นบันทึกสำเร็จจริงก่อนถือว่า
    ปิดงาน ไม่ใช่แค่ Log ไม่มี Error
  - Known Limitation ที่ยังไม่แก้ (แยก Scope): SEC Open Data API ยังไม่เคยถูก Config
    บน Production เลย — กองทุนรวมไทยที่ Symbol หน้าตาเข้าเกณฑ์ (ผ่าน Heuristic ข้างต้น)
    จะยังเจอข้อความ "ระบบข้อมูลกองทุนรวมยังไม่พร้อมใช้งาน" (`SEC_NOT_CONFIGURED`) ต่อไป
    จนกว่าจะสมัคร/ตั้งค่า Credentials จริง
- **แถบไฮไลต์เมนู Sidebar/Bottom-nav บน Dashboard ไม่เคยขยับตาม Section เลย** — กดเมนู
  "พอร์ตของฉัน"/"ประวัติรายการ" แล้วหน้าเลื่อนไปถูกที่ แต่ไฮไลต์ค้างที่ "แดชบอร์ด"
  - Root Cause: **ไม่มี Scroll-Spy อยู่จริงตั้งแต่แรก** — `dh-nav-active`/`dh-bn-active`
    ถูก Hardcode ไว้ที่ "แดชบอร์ด"/"หน้าหลัก" ตายตัวใน JSX และไม่มี
    `IntersectionObserver`/Scroll Listener อยู่ที่ไหนเลยทั้ง Frontend (ไม่ใช่ Observer
    ตามไม่ทัน — ไม่มีตัวที่จะตามตั้งแต่ต้น)
  - เพิ่ม State `activeSection` + `IntersectionObserver` ที่หด Viewport เหลือแถบแคบ
    ใกล้ขอบบนจอ (`rootMargin`) แทนเกณฑ์ % ของทั้ง Section — เพราะบาง Section สูงกว่า
    จอมากจนเกณฑ์ % ไม่มีทาง Trigger ถูกจังหวะ
  - **คลิกเมนูอัปเดตไฮไลต์ทันที (Optimistic)** ไม่รอ Observer ตามทัน (Smooth Scroll
    ใช้เวลา) — Observer ทำหน้าที่ Sync ตอนผู้ใช้ Scroll เองเท่านั้น
  - "พอร์ตของฉัน"/"ประวัติรายการ" ชี้ Anchor **เดียวกัน** (`#dh-legacy-tabs`) —
    Observer แยกไม่ได้เองเพราะเป็น Section เดียวกันจริง จึงเช็ค `legacyActiveTab` ร่วม
  - กด "แดชบอร์ด" ตอน Scroll ลงไปแล้ว เดิมไม่ทำอะไรเลย (Same-route `<Link>`) →
    ตอนนี้ Scroll กลับบนสุด + คืนไฮไลต์
- **Twelve Data ตอบ 429 "out of API credits" ทุกคืน** ตอน Cron `portfolioSnapshot.job`
  รันเที่ยงคืน — ยืนยันจาก Railway Log จริง **4 คืนติดกัน** (30 ก.ค. – 2 ส.ค.) และเกิด
  เฉพาะช่วง `00:00` เวลาไทยเท่านั้น ไม่ใช่ตอนผู้ใช้เปิด Dashboard
  - Root Cause: Cron วนทุก User × ทุก Holding ยิง `/quote` 1 ครั้งต่อ 1 Symbol
    **ไม่มี Throttle / Retry / Coalescing เลย** → พุ่งเกินเพดาน 8 credit/นาที ของ
    Free Tier (Log เห็น Credit ไต่ 9→13 ในนาทีเดียว)
  - ผลกระทบเดิม: Asset ที่โดน 429 ถูกนับเป็น `excludedAssetCount` **เงียบๆ** →
    กราฟมูลค่าพอร์ต/กำไรของคืนนั้นขาดมูลค่าบาง Asset ไปโดยผู้ใช้ไม่เห็น Error อะไรเลย
  - **Throttle**: Sliding Window 8 req/60s คุม `/quote` + `/exchange_rate` ด้วย Budget
    เดียวกัน (Twelve Data นับ Credit รวมทุก Endpoint ต่อ API Key)
  - **Retry with Backoff** (15s→30s→45s, สูงสุด 3 ครั้ง) เฉพาะเมื่อเจอ 429 **และเฉพาะ
    Cron/Background** เท่านั้น — Live Path (Dashboard/ซื้อขาย/คำสั่ง LINE) ยัง Fail
    Fast เหมือนเดิมทุกประการ ไม่ทำให้ผู้ใช้รอนานขึ้นแม้แต่วินาทีเดียว
  - **Request Coalescing** สำหรับหุ้นสหรัฐ + FX Rate (ปิด Gap ที่ฝั่ง Crypto มีอยู่แล้ว
    แต่ฝั่งหุ้นไม่มี) — Request พร้อมกันของ Symbol เดียวกันยุบเหลือครั้งเดียว
  - ไม่แตะ Logic คำนวณ Ledger/มูลค่าพอร์ต · ไม่เปลี่ยน Provider ราคา · **ไม่มี Migration**
- Error Code ฝั่งขาย (`ASSET_NOT_FOUND` / `NOTHING_TO_SELL` / `INSUFFICIENT_QUANTITY`)
  ที่ `validateSell` โยนมา ไม่เคยถูก Map ใน `transactions.controller` เลย — เดิมจะตกไป
  **500 "เกิดข้อผิดพลาดภายในระบบ"** ทั้งที่เป็น Business Rule ที่ผู้ใช้แก้เองได้
  ตอนนี้ตอบ 400 พร้อมข้อความไทย (และ `details: { requested, held }` สำหรับขายเกินยอด)
- ปุ่ม "แดชบอร์ดเว็บ" บน Rich Menu (และลิงก์ Dashboard/Support อื่นในแชท LINE) เปิดไม่ขึ้น
  ในบาง Case เพราะชี้ `https://liff.line.me/{liffId}` ซึ่งเปิดผ่าน LIFF In-App Browser
  ที่ไม่เสถียร — เปลี่ยนทุกจุดให้ชี้ Domain ของเว็บเราตรงๆ พร้อม `?openExternalBrowser=1`
  บังคับเปิดผ่าน Browser ภายนอกของเครื่องเสมอ (ยืนยันจาก LINE Docs ว่าพารามิเตอร์นี้
  ใช้ไม่ได้กับ `liff.line.me` จึงต้องเลิกใช้ Domain นั้นด้วย — ดู
  `backend/src/utils/externalUrl.util.js`) Login/JWT ยังทำงานถูกต้องเหมือนเดิม
  (`Login.jsx` เรียก `liff.init()`+`liff.login()` เอง ไม่ได้พึ่งการเปิดผ่าน LIFF)
### Security
- **Offensive Security Review Round 2 (11 ส.ค. 2569)** — สำรวจ 6 หมวด พบ 1 จุดแดง
  (F1 Satang Pool Exhaustion) + 8 จุดส้ม แก้ครบทุกจุด + Production Verification
  ด้วยหลักฐานจริง (ยิง Endpoint จริง/อ่าน DB จริง ไม่ใช่แค่อ่านโค้ด) — รายละเอียด
  ครบทุกจุดพร้อม Evidence ใน `docs/PROJECT_STATUS.md` § Offensive Security Review
  Round 2
  - Migration ที่ Apply แล้ว: `037` (REVOKE `increment_ai_ocr_usage` จาก
    PUBLIC/anon/authenticated), `038` (`ai_ocr_usage.call_count` + RPC เพดานคุม
    ต้นทุน OCR), `039` (`users.locked_by`/`lock_reason` — Audit Trail ของ Account
    Lock)
  - Deploy: `main` `8b36fb4` → `d2120a0` (12 commits, Fast-forward, ไม่มี Merge
    Commit)

## [0.3.0] - 2026-07-04
### Added
- Payment/Premium Subscription เต็มระบบ (PromptPay QR + Admin Manual Approval)
- Dashboard Redesign Round 4-5 (Endpoint /me, Banner Free/Premium, 4 แท็บ, ธีมมืด/สว่าง, กราฟ/Donut)
- แก้เมนู ADD ให้สอนวิธีพิมพ์คำสั่งซื้อ/ขาย
- Publish LINE Login Channel (privacy.html/terms.html)
- ลบไฟล์ขยะ (backend/npm, root package-lock.json)

## [0.2.0] - 2026-07-03
### Added
- LIFF Login (Foundation)
- Web Dashboard (React) — Portfolio/History/Profit Endpoints + หน้า Dashboard พื้นฐาน

## [0.1.0] - 2026-07-03
### Added
- LINE Bot Core MVP: Webhook, Command Parser, Freemium Limit, Postback Confirm/แก้ไข/ยกเลิก, Rich Menu, Price Feed (Crypto)
- Deploy Railway Production สำเร็จ + ทดสอบผ่าน LINE จริงครบทุกฟีเจอร์หลัก
