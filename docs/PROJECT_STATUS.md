# EasyDCA — Blueprint รวม + สถานะปัจจุบัน (ฉบับรวม 25 ก.ค. 2026)

> ไฟล์นี้รวม 2 เอกสารเดิม (`JaydeX_Master_Plan_v2.md` + `PROJECT-HANDOFF-updated.md`)
> ไว้ในที่เดียว เพื่อให้ Paste เป็นข้อความตรงในแชทใหม่ได้เลย (ไม่ต้องแนบไฟล์ —
> เผื่อแชทติด Limit จำนวนไฟล์แนบ) ยังคง 2 ไฟล์เดิมไว้ใน Project Knowledge ตามปกติ
> ไฟล์นี้เป็นแค่ Snapshot สรุปรวมสำหรับ Handoff ด่วน
>
> **หมายเหตุ**: ไฟล์นี้ Sync มาจากไฟล์ Working Copy ที่ใช้อัปเดตระหว่าง Session
> วางแผน (Cowork) — เก็บไว้ใน Repo เพื่อ Backup ประวัติการตัดสินใจทั้งหมดไว้ใน
> GitHub ด้วย ไม่ให้ขึ้นอยู่กับที่เดียว

---

## ส่วนที่ 1: Blueprint (กลยุทธ์ — จาก Master Plan v2, ไม่เปลี่ยนแปลง)

### วิสัยทัศน์
**JaydeX** = แพลตฟอร์มผู้ช่วยการเงินส่วนตัวสำหรับคนไทย พัฒนาเป็น 3 ระยะ:
1. **EasyDCA** (ปัจจุบัน) — บันทึก/ติดตามการลงทุนแบบ DCA ผ่าน LINE + เว็บ
2. **EasyTax** (ระยะถัดไป) — ผู้ช่วยคำนวณภาษีจากข้อมูลการลงทุน
3. **JaydeX App** (ระยะสุดท้าย) — แพลตฟอร์มการเงินส่วนตัวแบบเต็มรูปแบบ

**Gate A** (เงื่อนไขก่อนไประยะถัดไป): Retention ≥50% ของ Activated Users +
≥10 User Interviews เชิงลึก — **ยังไม่ผ่าน Gate นี้** (อยู่ระหว่าง Closed
Beta Wave 1)

### หลักการทางธุรกิจที่ตั้งไว้แต่ต้น
- แบรนด์ "EasyDCA by JaydeX" เท่านั้น — ห้ามสร้างแบรนด์ JaydeX แยก (ต้นทุนศูนย์)
- **ไม่มี Level/XP/Mascot/ตัวละคร** — ใช้ Streak สื่อวินัยเพียงอย่างเดียว
  (⚠️ Rich Menu/หน้า Premium ปัจจุบันมี Mascot เป็นข้อยกเว้นที่ตกลงไว้แล้ว)
- เขตกฎหมาย: ห้ามแนะนำซื้อ/ขาย/ถือรายตัว, ไม่มี Trade Execution, ไม่การันตี
  ผลตอบแทน — ทุก Copy ต้องระวังจุดนี้เสมอ
- Business Model: Freemium — Free จำกัด Asset/DCA Plan, Premium ปลดล็อกไม่จำกัด
  + Export รายงาน + AI OCR อ่านสลิป

---

## ส่วนที่ 2: สถานะปัจจุบัน

### Stack
Node.js/Express + React/Vite + Supabase (Postgres 17.6) + Railway (2 Services:
`EasyDCA` + `easydca-worker`) + LINE Messaging API + LIFF + Cloudflare R2
(Nightly Backup, พิสูจน์ Restore แล้ว) — Migration ล่าสุดที่ Apply บน
Production: **035**

### ✅ ปิดสมบูรณ์แล้วทั้งหมด (ห้ามทำซ้ำ)

**Core Correctness**: P&L Engine (Moving Average), Webhook Idempotency,
Unique Constraint, PDPA (Consent+Erasure)

⚠️ **แก้ข้อความที่เคยเคลมเกิน**: บรรทัดนี้เคยเขียนว่า "Ownership Filter ทุก Query"
ปิดสมบูรณ์แล้ว — **ไม่จริง** Cross-User Isolation Audit (9 ส.ค. 2026) พบว่าตาราง
`pending_transactions` ถูกแตะด้วย `id`/`batch_id` จาก LINE Postback โดยไม่เทียบ
`user_id` เลย 6 จุด และ RPC `create_transaction_locked` รับ `p_user_id` แต่ไม่เคย
ใช้ตรวจสิทธิ์เจ้าของ asset — ดูสถานะจริงในหัวข้อ Cross-User Isolation Audit ด้านล่าง

**S8 ทั้งชุด**: Dashboard เว็บใหม่ (`/dashboard`), DCA Planner (CRUD ผ่านเว็บ),
Guided Buy Flow (บันทึก DCA แบบกดปุ่มใน LINE, รองรับ USD สำหรับ crypto/stock_us)

**Infra**: `/health` เช็ค Supabase จริง + Admin Alert Push, Nightly Backup
เข้ารหัส AES-256-GCM ไป Cloudflare R2 (Cron จริงยืนยันแล้ว + Restore Test
เต็มรูปแบบผ่านจริง 23/23 Table), `railpack.json` Vendor `pg_dump`/`psql` 17
เอง (Supabase รัน PG17 แต่ Debian Default ให้แค่ PG15)

**Business Model (Beta)**: Export Gate, DCA Planner Gate (Free จำกัด 2 แผน),
QR จ่ายเงินในเว็บ (`/premium`), Admin Grant Premium ฟรี, **Self-service Free
Trial** (User กดรับเอง 1 เดือน ครั้งเดียวตลอดชีพ), **Facebook Like Campaign**
(พร้อมใช้แต่ปิด Flag ไว้ก่อน)

**หน้า Premium** — Redesign เต็มรูปแบบ + Hero Banner + Mascot (ข้อยกเว้น) +
การ์ดเทียบแผน 3 คอลัมน์

**Rich Menu** — Redesign เต็มรูปแบบ, Activate บน LINE จริง, ปุ่มเปิด External
Browser แทน LIFF In-App Browser (แก้ปัญหาเปิดไม่ขึ้น)

**บั๊ก AI OCR อ่านสลิป "ขาย" เป็น "ซื้อ"** — แก้ 2 ชั้น (Normalize/Parsing +
เปลี่ยน Model เป็น Sonnet 5 พร้อม Evidence-based Extraction + Numeric
Cross-check) รวม Bug วันที่ พ.ศ./ค.ศ. สลับกัน

**บั๊ก Limit Order "รอจับคู่" ถูกบันทึกเป็นธุรกรรมทันที** — เพิ่ม
`order_status`/`order_status_evidence` + Deterministic Parser

**Policy การ Push ครอบ 5 หมวด** — สร้าง `docs/AI_WORK_POLICY.md`
(Model Selection, Git Hygiene, DoD 4 ชั้น, 5 หมวดไฟล์ตาม Risk)

**SEC Fund Master List** — แก้ Error Message ทางง่าย (ทางยาว/สมัคร SEC API
จริง ยังเป็น TODO)

**ช่องทางติดต่อ Admin/Support** — หน้าเว็บ `/support` (Dropdown หมวดปัญหา +
ฟอร์ม + Social Link) แทน LINE Chat Flow เดิม (ขัดกับ OA Manager Chat Mode)

**บั๊ก "รวมเงินลงทุนทั้งพอร์ต" ขึ้น 0 บาท** — แก้ 3 จุดที่ยังอ่าน
`summary.totalInvested` (Legacy THB-only) แทน `investedByCurrency`

**Supabase Security Advisor Warning** — ล็อก `search_path` ของ Function
สำคัญ (Migration 028)

**Backup Job** — ปิดสมบูรณ์ 100% ทั้ง Dump→Encrypt→Upload→Cron อัตโนมัติ
และ Restore→Verify เต็มวงจร (5 Root Cause สะสม: R2 Credentials, pg_dump
ENOENT, DATABASE_URL Placeholder, IPv6/IPv4, Version Mismatch — แก้ครบ
พร้อม Race Condition Bug ที่ทำให้ Backup รายงานสำเร็จทั้งที่ไฟล์ว่างเปล่า)

**Dashboard เว็บ — Feature ชุดใหญ่ (1 ส.ค.)**: ปุ่มขาย (Toggle ซื้อ/ขาย),
โลโก้สินทรัพย์อัตโนมัติ (CoinGecko/tickerlogos), เลิกใช้ LIFF In-App Browser,
Self-service Free Trial + Expiry Reminder Cron + LINE Push แจ้งผล, Twelve
Data 429 Rate Limit Fix, Sidebar Scroll-Spy (สร้างใหม่ทั้งหมด — เดิมไม่มีเลย),
Facebook Link จริงบน `/support`

**Premium ฟรี 1 เดือนเงื่อนไข Like Facebook** — Guard แยกคอลัมน์
`facebook_like_granted_at`, Table แยก `facebook_like_grant_requests`,
Bucket Private, Admin ตรวจ Screenshot มือ — พร้อมใช้ทันที (ปิด Flag ไว้ก่อน)

**LINE Follow Event** — ข้อความต้อนรับใหม่ 3 ใบ (แนะนำตัว → วิธีใช้งาน →
ปุ่ม Premium ฟรี)

**Full System Security Audit (Opus, 2 ส.ค.)** — ตรวจครบ 5 หมวดตาม
`AI_WORK_POLICY.md`, ปิดครบทุกจุดรวมถึง:
- **HIGH-1 Oversell Race**: Migration 034 `create_transaction_locked` RPC
  (`SELECT ... FOR UPDATE` + Atomic Insert) ครอบ Buy/Sell/Undo ทุก Path —
  พิสูจน์ด้วย 20 Request ขนานจริงบน Production (ปฏิเสธครบ 20/20)
- **Free-tier Asset Limit Race**: Migration 035 `create_asset_locked` RPC
  (Lock ที่ User) — พิสูจน์ด้วย 20 Request ขนานจริงเช่นกัน
- Path Traversal (`screenshotPath`), Rate Limiting ทั้งระบบ, CORS Fail-fast,
  Twelve Data Quota Split ระหว่าง 2 Service (`TWELVE_DATA_RATE_LIMIT`)

**สถานะ Audit รอบ 2 ส.ค.: ปิดครบตามขอบเขตที่ตรวจรอบนั้น** (เดิมเขียนว่า
"Security Audit ทั้งชุดปิดสมบูรณ์ 100%" — ปรับถ้อยคำเพราะรอบนั้น**ไม่ได้ตรวจ
Cross-User Isolation รายจุด Query** จึงไม่ครอบคลุมช่องที่เจอวันที่ 9 ส.ค.)

**Cross-User Isolation Audit (Opus, 9 ส.ค. 2026)** — ตรวจจุดเข้าถึง DB ครบ
**91 จุด** (+ Storage 15 op + Postgres Function 3 ตัว ตรวจข้างในทุกตัว):
- **🔴 6 จุด (แก้แล้ว)** — `pending_transactions` ถูกยืนยัน/ยกเลิก/expire/ผูก
  `transaction_id` ด้วย `id`/`batch_id` จาก LINE Postback **โดยไม่เทียบ `user_id`**
  → ผู้ใช้ A ที่ถือ `pendingId` ของ B สั่งยืนยันธุรกรรมของ B ได้ (เขียนเข้า Ledger
  ของ B ด้วย `claimed.userId`) และรายละเอียดของ B (symbol/จำนวน/ยอดเงิน/ยอดคงเหลือ)
  ถูกตอบกลับไปในแชทของ A — แก้โดยกรอง `user_id` ที่ชั้น Query ทุกจุด + `userId`
  เป็นพารามิเตอร์บังคับที่ throw `MISSING_USER_ID` ถ้าว่าง (`utils/ownership.util.js`)
- **🟠 1 จุดใน RPC (แก้แล้ว — migration 036)** — `create_transaction_locked` รับ
  `p_user_id` แต่ Lock asset ด้วย `WHERE a.id = p_asset_id` เฉยๆ ไม่เทียบเจ้าของ
- **🟠 8 จุด (แก้แล้ว — Data Access Helper กลาง)** — เดิมไม่มี user filter ในตัว
  Query แต่ปลอดภัยอยู่เพราะ Caller มีวินัย (ไม่ใช่เพราะโครงสร้างบังคับ) ย้ายผ่าน
  `queryForUser(table, userId, buildQuery)` / `queryAcrossUsers(table, reason)`
  ใน `utils/ownership.util.js` (Registry รายชื่อตารางที่เดียวครอบทุกตารางที่มี
  อยู่จริง + Enum เหตุผล 5 ค่า: `admin`/`cron`/`system-table`/`fraud-check`/
  `public-endpoint`):
  - `transaction.findAllByAsset`, `attachSlipImagePath` → `queryForUser`
  - `asset.findByIds` → `queryForUser`
  - `payment.findById` แยกเป็น `findByIdForUser` (`queryForUser`) กับ
    `findByIdPublic` (`queryAcrossUsers('public-endpoint')` — เฉพาะ Endpoint QR
    ที่เปิด Public ตามดีไซน์), `updateSlipImageUrl` → `queryForUser`
  - `payment.findConfirmedBySlipHash` → `queryAcrossUsers('fraud-check')` (ข้าม
    User โดยเจตนา — ตรวจจับสลิปซ้ำ) + แก้ไม่ให้ยัด `existingPaymentId` ของ
    ผู้ใช้คนอื่นลง Error Details อีกต่อไป (เสี่ยงรั่ว UUID ถ้า Controller ในอนาคต
    เปลี่ยนมา Include Details กลับ Client)
  - `facebookLikeGrantRequest.findById`, `claimForReview` →
    `queryAcrossUsers('admin')` (Admin ดู/เปลี่ยนสถานะคำขอของผู้ใช้คนอื่น)
- **🟢 77 จุด** — 52 จุดมี `.eq('user_id', …)` ตรงๆ + 25 จุดข้ามผู้ใช้โดยเจตนา
  (Admin หลัง `requireAdmin` / Cron บน worker / ตารางระบบ `line_webhook_events`,
  `broadcast_logs` / คืนค่าที่ไม่ใช่ข้อมูลผู้ใช้) — ยังเป็น `supabaseAdmin` ตรงๆ
  ไม่ได้ Migrate ผ่าน Helper ในรอบนี้ (นอกขอบเขตที่ตกลงไว้)
- **ผลดี**: ไม่พบจุดใดเลยที่รับ `userId` จาก request body/query/param — `userId`
  มาจาก JWT `sub` หรือ `event.source.userId` หลัง LINE Signature verify เท่านั้น
- **Regression**: `tests/crossUserIsolation.regression.test.js` (19 tests, รอบ
  pending_transactions) + `tests/crossUserIsolationOrangePoints.regression.test.js`
  (15 tests, รอบ 8 จุดสีส้ม) รัน Repository ตัวจริงทับ Fake Supabase ที่บังคับ
  `.eq()` จริง — พิสูจน์ Red-Green แล้วทั้งคู่ (รอบแรก: ถอด `.eq('user_id')` ออก
  → แดง 16/19 โดย Positive Control ยังเขียว 3; รอบสอง: ปิด `queryForUser` ไม่ให้
  ต่อ Filter → แดงตรง 5/5 Adversarial Test โดย Positive Control + Guard Test
  10 จุดยังเขียวครบ)
- **Production Verification (9 ส.ค. 2026, รอบ pending_transactions)**: Push
  `1eba7df` ขึ้น `main` แล้ว, Apply Migration 036 บน Supabase จริง (Verify Query
  `has_owner_check = true` ผ่าน), ทดสอบซื้อ/ยกเลิกจริงผ่าน LINE ปกติ, ยืนยัน
  Railway Deploy ทั้ง 2 Service (`EasyDCA` + `easydca-worker`) เป็น Commit นี้
  จริงผ่านแท็บ Details (ไม่ใช่แค่ `/health`) — 6 จุดแดง + RPC ปิดสมบูรณ์จริงครบ
  DoD 4 ชั้น
- **Production Verification (รอบ Data Access Helper/8 จุดสีส้ม): ยังไม่ทำ** —
  รอ Push + Deploy ก่อน (Commit อยู่ใน Local เท่านั้น ณ ตอนที่เขียนบรรทัดนี้)

### ⏳ ยังไม่ปิด (TODO ที่เหลือ)

1. **จดโดเมน** — กำลังดำเนินการ (`easydca.co` ผ่าน Z.com, ~1,177 บาท/ปี
   รวม VAT) ไม่ซื้อ Web Hosting เพิ่ม (ใช้ Railway เดิม) รอ Setup DNS ชี้มา
   Railway
2. **สร้าง Landing Page แนะนำระบบ** — รอหลังจดโดเมนเสร็จ (แยกจาก Dashboard)
3. **Closed Beta Wave 1** — เปิดให้ Tester กดรับ Free Trial เองผ่าน
   Dashboard แล้ว (`PREMIUM_FREE_TRIAL_ENABLED=true`)
4. SEC Fund Master List ทางยาว (สมัคร SEC API จริง) — External Dependency —
   ผลคือ Symbol ที่หน้าตาเข้าเกณฑ์กองทุนไทย (มีขีด/ยาว ≥5 ตัวอักษร) ยังเจอ
   "ระบบข้อมูลกองทุนรวมยังไม่พร้อมใช้งาน" (`SEC_NOT_CONFIGURED`) จนกว่าจะสมัครจริง
5. Social Link IG/TikTok — ยังเป็น Placeholder รอ Link จริง
6. Real-time Chat Widget — ตกลงว่าทำหลัง Beta
7. Known Limitation (ไม่บล็อก): `portfolioSummary.service.js`'s
   `byCurrency` นับเฉพาะ Asset ที่ดึงราคาสำเร็จ
8. **Cross-User Isolation — ปิดครบแล้ว (9 ส.ค. 2026), เหลือ RLS เป็นหนี้เชิง
   โครงสร้างที่ตัดสินใจเลื่อนไปหลัง Beta**:
   - ✅ **Data Access Helper กลาง** สร้างเสร็จแล้ว — `utils/ownership.util.js`
     มี `TABLE_REGISTRY` (ครอบทุกตารางที่มีอยู่จริงตาม `docs/DATABASE.md` § 2
     รวมตารางที่ยังไม่มี Repository Code ด้วย กันของใหม่ในอนาคตหลุด Pattern) +
     `queryForUser(table, userId, buildQuery)` (throw `MISSING_USER_ID` ถ้า
     userId ว่าง) + `queryAcrossUsers(table, reason)` (`reason` ต้องอยู่ใน Enum
     5 ค่า throw `INVALID_CROSS_USER_REASON` ถ้าไม่ตรง)
   - ✅ **🟠 8 จุดที่เคยเหลือ ปิดครบทั้งหมดแล้ว** ผ่าน Helper ด้านบน (รายละเอียด
     ในหัวข้อ Audit ด้านบน) — ไม่ต้องพึ่งวินัยของ Caller อีกต่อไป
   - ⏳ **25 จุด Admin/Cron ที่ข้าม User โดยเจตนา ยังไม่ Migrate ผ่าน
     `queryAcrossUsers`** — Registry รองรับแล้ว แต่ตัว Query ยังเป็น
     `supabaseAdmin` ตรงๆ เหมือนเดิม (นอกขอบเขตรอบนี้ — ทำได้ทีละจุดในอนาคต
     โดยไม่กระทบ Behavior เพราะ `queryAcrossUsers` ไม่กรองอะไรเพิ่ม)
   - **ยังไม่เปิด RLS** — `service_role` bypass RLS ทั้งหมด แปลว่า **โค้ดเป็นกำแพง
     ชั้นเดียว** ตัดสินใจแล้วว่ายังไม่ทำในรอบนี้ เพราะการเปิด RLS จะไม่ช่วยอะไรเลย
     จนกว่าจะเปลี่ยนวิธีเชื่อมต่อ (ต้องเลิกใช้ service_role สำหรับ Query ของผู้ใช้
     แล้วส่ง JWT ของผู้ใช้ให้ Postgres ตรวจ `auth.uid()` เอง) ซึ่งเป็นงานใหญ่แยก
     ต่างหาก — ควรทำเป็นกำแพงชั้น 2 หลัง Beta
9. **`symbolRegistry.service.js` ยังเป็น Whitelist Hardcode** (227 Symbol) —
   Bug Fix 9 ส.ค. เพิ่ม SPCX + กัน Ticker ที่ไม่อยู่ใน Whitelist หลุดไปโดน
   Error กองทุนรวมผิดฝาผิดตัว (`looksLikeThaiFundSymbol` เช็คก่อนเรียก SEC) แต่
   Ticker ใหม่ที่ไม่อยู่ใน Whitelist ยังต้องเพิ่มเข้า `SYMBOL_TYPES` มือทีละตัวอยู่ดี
   (จะได้ `VALIDATION_ERROR` "ไม่รู้จักสินทรัพย์นี้" ที่ถูกต้อง แทน Error กองทุนผิดๆ
   แต่ยังบันทึกไม่ได้จนกว่าจะเพิ่ม) — Dynamic Symbol Resolution ทางยาวยังไม่ทำ

---

## ส่วนที่ 3: กฎยืนสำคัญที่สุด

1. Single Source of Truth ต่อ 1 สูตรเงิน — ห้าม Copy Logic
2. Immutable Ledger — ห้าม `DELETE`/`UPDATE` Transaction, ห้าม `DELETE` User
   ตรงๆ (ใช้ Erasure/Anonymize เท่านั้น) — เขียน Ledger ทุกจุดต้องผ่าน RPC
   ที่ Lock ถูกต้อง (`create_transaction_locked`, `create_asset_locked`)
3. Backend คือ Security Boundary เดียว — ทุก Query กรอง `userId` **ที่ชั้น Query
   เอง** (ใส่ `.eq('user_id', …)` ไปในคำสั่งเดียวกัน) ห้ามดึงมาแล้วค่อย `if` เทียบ
   เจ้าของทีหลัง และ `userId` ต้องมาจาก JWT `sub` / `event.source.userId` ที่ผ่าน
   LINE Signature verify เท่านั้น — **ห้ามรับจาก request body/param/postback**
   ⚠️ บทเรียน 9 ส.ค. 2026: `id` ที่มาจาก Postback คือค่าฝั่ง Client ไม่ใช่หลักฐาน
   ความเป็นเจ้าของ — การรับ `userId` เข้ามาใน Signature แล้วไม่ได้ใช้ตรวจสิทธิ์จริง
   (เช่น RPC `create_transaction_locked` เดิม) อันตรายเท่ากับไม่มี `userId` เลย
   แต่ตรวจจับยากกว่าเพราะ "อ่านผ่านๆ เหมือนปลอดภัยแล้ว"
4. Migration ใหม่ต้อง Apply+Verify บน Supabase ก่อน Deploy Code เสมอ
5. Label ปุ่ม LINE Quick Reply ≤20 ตัวอักษร (Unicode Code Point)
6. Internal Navigation ต้องใช้ React Router (`<Link>`/`navigate()`) ห้าม
   `<a href>` — ทำ JWT (Memory-only) หาย
7. ทุกงาน Claude Code ต้องระบุ Sonnet/Opus + เหตุผล, ก่อน Push เช็ค
   `git status` เสมอ, งานเงินใช้ DoD 4 ชั้น (Unit→Integration→Regression→
   Production Verification)
8. Railway/Cloudflare/Supabase Dashboard ไม่ Sync กับ Git — ยืนยันสถานะ
   Production แยกจาก Code เสมอ (ใช้ `railway api`/`railway ssh` เช็ค
   commitHash จริง ไม่ใช่แค่ `/health`)
9. Railway มี 2 Services แยกกัน (`EasyDCA` + `easydca-worker`) — Env Var
   ต้องเช็ค/ตั้งแยกทีละ Service เสมอ
10. Live Path (Dashboard/LINE ที่ User รอสด) ห้ามเพิ่ม Latency โดยไม่จำเป็น
    (Retry/Backoff ใช้ได้เฉพาะ Cron ที่ไม่ Sensitive เวลา)
11. Silent Default เป็น Anti-pattern เสมอ — พาร์สข้อมูลไม่ชัดเจนต้องถามผู้ใช้
    หรือ Reject ไม่ใช่เดาค่า Default

---

## หมายเหตุสำหรับแชทใหม่

ไฟล์นี้เป็น Snapshot สรุปสำหรับ Handoff ด่วน หากต้องการรายละเอียดเชิงลึกกว่านี้
(Diff เต็มของแต่ละ Bug Fix, เหตุผลละเอียดของแต่ละการตัดสินใจ) ดูจาก
`docs/CHANGELOG.md`, `docs/AI_WORK_POLICY.md`, และ Git Commit History โดยตรง
