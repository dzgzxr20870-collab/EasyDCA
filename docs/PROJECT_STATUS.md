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

### Offensive Security Review Round 2 (11 ส.ค. 2569)

Survey ครบ 6 หมวด พบ **1 จุดแดง** (F1) + **8 จุดส้ม** — Phase 3 แก้ครบทุกจุดตาม
ขอบเขตที่ Founder อนุมัติ (กลุ่ม A-G) รวม 12 Commits, Deploy `main` `8b36fb4` →
`d2120a0` (Fast-forward, ไม่มี Merge Commit)

⚠️ **อ่านก่อนเชื่อคำว่า "ปิดแล้ว" ด้านล่าง**: ทุกจุดมี Evidence กำกับแยกชัดเจน
2 ระดับ — **"Production Verification"** = ยิง Endpoint จริง/อ่าน DB จริงบน Railway
Production หลัง Deploy (หลักฐานแน่นที่สุด) กับ **"ยืนยันด้วย Test เท่านั้น"** =
ผ่านแค่ Unit/Integration Test ไม่ได้ยิง Production จริง (เพราะไม่คุ้ม/ทำไม่ได้โดย
ไม่กระทบผู้ใช้จริง เช่น Rate Limit หน้าต่าง 1 ชม.) — ห้ามอ่านสองระดับนี้ปนกันว่า
แน่นเท่ากัน

**F1 — Satang Pool Exhaustion (🔴)**
- สถานะ: ปิดแล้ว
- Fix: จำกัด 1 Pending Payment ค้างต่อ user (`payment.service.requestPayment`
  เช็ค `findPendingByUserId` ก่อน `allocateSatangTag` เสมอ) — Error Code ใหม่
  `PENDING_PAYMENT_EXISTS` ทั้งฝั่ง Web (409 + คำขอเดิม) และ LINE (`request_payment`
  Postback ตอบ QR เดิมแทนขึ้น Error)
- Commit: `c349485`
- Evidence: **Production Verification 11 ส.ค. 2569** — ยิงจริง 3 ครั้งติดกันด้วย
  บัญชีทดสอบ (`monthly` → `monthly` → `yearly`) เกิดแถวเดียวเท่านั้น
  (`rows_created=1`, `tags_held=1`) ครั้งที่ 2/3 ได้ 409 คืน `paymentId` เดิมเป๊ะ
  ทุกครั้ง — Cleanup แล้วคืนเลขสตางค์เข้า Pool (ยืนยันซ้ำด้วยการขอใหม่สำเร็จ 200
  หลัง Resolve คำขอเดิม) Red-Green: ถอด Guard ออก → Test แดง 4/5 เคส

**F2 — OCR Quota Abuse**
- สถานะ: ปิดแล้ว
- Fix: เพดานที่สอง `call_count` (migration 038) นับ "ทุกครั้งที่เรียก Claude จริง"
  แยกจาก `count` เดิมที่นับเฉพาะ "อ่านสำเร็จ" — `MONTHLY_CALL_LIMIT = 200`
  (`slipOcr.service.js`)
- Commit: `4717e5d`
- Evidence: **Production Verification 11 ส.ค. 2569** — ส่งรูปผ่าน LINE ด้วยบัญชี
  Premium จริง 6 ภาพ (5 ครั้งเรียก Claude จริง: 4 รูปไม่ใช่สลิป + 1 รูปสลิปสำเร็จ,
  2 ครั้งโดน Rate Limit ตัดก่อนถึง Claude) ยืนยันคู่กับ Railway Log จริง
  (Timestamp + `webhookEventId` ตรงกันทุกรายการ): `call_count` 2→7 (+5 ตรง
  จำนวนครั้งที่เรียก Claude จริงเป๊ะ), `count` 4→5 (+1 ตรงจำนวนที่อ่านสำเร็จเป๊ะ —
  รูปที่ไม่ใช่สลิปไม่กินโควตาผู้ใช้แต่ยังถูกนับต้นทุน)

**F3 — Payment Slip Re-upload Abuse**
- สถานะ: ปิดแล้ว
- Fix: `slipUploadLimiter` (1 ครั้ง/ชม./user, Key = `user.id` ไม่ใช่ IP) วางก่อน
  `rawSlipBody` บน `POST /payment/:id/slip` — Reuse โครง `screenshotUploadLimiter`
- Commit: `faabc45`
- Evidence: **ยืนยันด้วย Test เท่านั้น ไม่ได้ยิง Production จริง** (หน้าต่างเพดาน
  1 ชม./ครั้ง ทำให้ยิงจริงไม่คุ้ม) — `tests/securityHardening.test.js` ยก Express
  App จริง + Limiter ตัวที่ Mount อยู่จริงมาทดสอบ (ไม่ Mock Config): ครั้งแรก 200,
  ครั้งที่ 2 ขึ้นไป 429 ทุกครั้ง, นับแยกรายบัญชีถูกต้อง (Key = `user.id`)

**F4 — payment-slips Bucket Public → Private**
- สถานะ: ปิดแล้ว
- Fix: `uploadPaymentSlip` คืน Storage Path แทน Public URL,
  `createPaymentSlipSignedUrl` (TTL 5 นาที), `paymentSlipPathFrom` แปลง URL เก่า
  ที่เคยเป็น Public กลับเป็น Path ให้เซ็นใหม่ได้ (กัน Admin เปิดสลิปคำขอเก่าไม่ได้
  ทันทีที่สลับ Bucket)
- Commit: `8e0fb26`
- Evidence: **Production Verification 11 ส.ค. 2569** — หลัง Founder ปิด Public
  บน Supabase Dashboard แล้ว ยิง Public Storage Endpoint ของ `payment-slips`
  ตรงๆ ได้ `{"error":"Bucket not found","code":"NoSuchBucket"}` **เหมือนกับ**
  `transaction-slips` (Bucket Private เดิม) เป๊ะ — ยืนยันว่า URL สาธารณะเก่าใช้
  ไม่ได้แล้วจริง
  ⚠️ Known Limitation ที่ยอมรับแล้ว: รูปที่เคยหลุด URL ไปก่อนสลับ ยังเปิดได้ถ้ามี
  URL อยู่ในมือ (การสลับ Bucket บล็อก Access ใหม่ แต่ไม่ลบ URL เก่าที่เคยรั่ว)

**F5 — ลบ backend/public/liff/**
- สถานะ: ปิดแล้ว
- Fix: ลบไฟล์ `backend/public/liff/index.html` ทั้งไฟล์ + ถอด `express.static`
  ออกจาก `index.js` (หน้านี้เขียนกำกับตัวเองว่า Deprecated แต่ยัง Live จริงบน
  Production และเก็บ JWT ใน localStorage ขัด `docs/SECURITY.md` § 1.1)
- Commit: `efe4290`
- Evidence: **Production Verification 11 ส.ค. 2569** — `GET /liff/index.html`,
  `/liff/`, `/liff` ได้ **404 ทั้ง 3 Path** (เดิม 200)

**F6 — Webhook Rate Limit Bypass**
- สถานะ: ปิดแล้ว
- Fix: เปลี่ยนจาก `req.path.startsWith('/api/v1/webhook')` (Skip กว้างเกินจำเป็น)
  เป็นเทียบ Path ตรงๆ + เพิ่ม `webhookLimiter` เพดาน 6,000/15 นาที/IP วางก่อน
  `express.json()` เสมอ
- Commit: `efe4290`
- Evidence: **Production Verification 11 ส.ค. 2569** — `GET /api/v1/webhookZZZ`
  (Path ที่ไม่มี Route รองรับ, เดิมหลุด Limit ไปด้วย) ตอนนี้มี Header
  `ratelimit: limit=300` แล้ว, `POST /api/v1/webhook` จริงมี
  `ratelimit: limit=6000` + ตอบ 401 (HMAC เช็คหลัง Rate Limit ตามลำดับที่ออกแบบ),
  `/health` ยัง Skip ปกติ (ไม่มี Header ratelimit)

**F7 — Account Lock/Ban Mechanism**
- สถานะ: ปิดแล้ว
- Fix: Migration 039 (`locked_by`/`lock_reason`), `userRepository.setLock`
  (ทางเข้าเดียวของการเขียน `is_locked` — เดิมเป็น Dead Column ไม่เคยมีทางเขียนได้
  เลยตั้งแต่ Schema แรก), Endpoint `POST /admin/users/:id/lock|unlock`, บังคับใช้
  ที่ `auth.middleware` (403 `ACCOUNT_LOCKED` คู่กับ `anonymizedAt`) + Parity
  ฝั่ง LINE (`webhook.controller` — การ์ด "บัญชีถูกระงับ")
- Commit: `7820aea`
- Evidence: **Production Verification 11 ส.ค. 2569** — ทดสอบเต็มเส้นด้วยบัญชี
  ทดสอบจริง (ยืนยัน LINE ID ต่างจาก Admin ID ก่อนล็อกทุกครั้ง): Guard ครบ (400
  ไม่ส่ง reason, 400 reason ยาวเกิน 500, 403 ไม่ใช่ Admin), ล็อกจริง 200 + DB มี
  ครบ 4 คอลัมน์ (`locked_by` = LINE ID ของ Admin จาก JWT จริง ปลอมไม่ได้), บัญชี
  ที่ถูกล็อกยิง 4 Endpoint ได้ 403 `ACCOUNT_LOCKED` ทุกตัว (รวมเส้นทางเงิน), ปลด
  ล็อก 200 → ใช้งานได้ปกติทันที, Audit Trail (`locked_by`/`lock_reason`/
  `locked_at`) ยังอยู่ครบหลังปลดล็อกตามดีไซน์ (ล้างเป็น NULL ทีหลังตามคำขอ
  Founder เพราะเป็นข้อมูลทดสอบ ไม่ใช่ของจริง)

**F9 — LINE Content API Timeout**
- สถานะ: ปิดแล้ว (Code Fix) — ⚠️ **ยืนยันด้วย Test พื้นฐานเท่านั้น ไม่มี Test
  เฉพาะครอบ Timeout Behavior และไม่ได้ยิง Production จริง** (จำลอง LINE API ค้าง
  บน Production ทำไม่ได้โดยไม่กระทบผู้ใช้จริง)
- Fix: เพิ่ม `AbortController` + Timeout 20 วินาที ใน `line.service.getMessageContent`
  (Pattern เดียวกับ `slipOcr.service`/`priceFeed.service`) — เดิมไม่มี Timeout
  เลย ต่างจาก External Call อื่นทุกตัวในโปรเจกต์
- Commit: `e70268e`
- Evidence: Test เดิมของ `getMessageContent` (Success/Error Path,
  `tests/line.service.test.js`) ยังผ่านทั้งหมดหลังแก้ — พิสูจน์แค่ "ไม่
  Regression" ไม่ได้พิสูจน์ว่า Timeout ทำงานจริงเมื่อ LINE ค้าง — **TODO**: เพิ่ม
  Test จำลอง Timeout ด้วย Fake Timer ในรอบถัดไป

**G1 — helmet Security Headers**
- สถานะ: ปิดแล้ว
- Fix: เพิ่ม `helmet()` middleware พร้อม `crossOriginResourcePolicy: 'cross-origin'`
  (Default ของ helmet คือ `same-origin` ซึ่งจะบล็อก LINE Fetch รูป QR) +
  `app.disable('x-powered-by')`
- Commit: `efe4290` (Dependency เพิ่มใน `575e1fd`)
- Evidence: **Production Verification 11 ส.ค. 2569** — `curl -I /health` ได้
  Security Header ครบ 9 ตัว (CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy ฯลฯ) จากเดิมไม่มีสักตัว, `x-powered-by` หายไปแล้ว (count=0),
  ยืนยันเพิ่มว่า `GET /api/v1/payment/:id/qr.png` ยังตอบ
  `cross-origin-resource-policy: cross-origin` — ปุ่ม Premium ไม่พัง

**G2 — REVOKE increment_ai_ocr_usage**
- สถานะ: ปิดแล้ว
- Fix: Migration 037 — `REVOKE ALL ... FROM PUBLIC, anon, authenticated` +
  `GRANT EXECUTE ... TO service_role` (Function นี้ไม่เคยถูก REVOKE มาตั้งแต่
  Migration 011 ก่อนโปรเจกต์จะมี Pattern สิทธิ์ Function)
- Commit: `abae487`
- Evidence: SQL VERIFY ที่ Founder รันหลัง Apply ยืนยัน `service_role=true`,
  `public`/`anon`/`authenticated`=`false` ทั้งหมด ตรง Pattern — **Production
  Verification 11 ส.ค. 2569**: หลังส่งรูปสลิปจริงผ่าน LINE, `ai_ocr_usage.count`
  ยังขยับ 4→5 ปกติ (พิสูจน์ว่า Backend เรียก RPC ผ่าน `service_role` ได้จริงหลัง
  REVOKE ไม่มี Path ไหนพังหรือเรียกด้วย Key อื่น)

**G3 — UUID Validate ใน dcaPlans.controller**
- สถานะ: ปิดแล้ว
- Fix: เพิ่ม UUID Regex Validate ก่อน Query ใน `updatePlan`/`deletePlan` (เดิม id
  ผิดรูปทำ Postgres throw 22P02 กลายเป็น 500 ทั้งที่ควรเป็น 404) — Pattern
  เดียวกับ `transactions.controller`
- Commit: `26fadd9`
- Evidence: **ยืนยันด้วย Test เท่านั้น ไม่ได้ยิง Production จริง** —
  `tests/dcaPlans.controller.test.js` § "id ที่ไม่ใช่ UUID → 404 ก่อนถึง Service
  (G3)" ครอบ 10 เคส (รวม SQLi-style, UUID ขาด 1 ตัว) ยืนยันทั้ง Status 404 และ
  "ไม่เรียก Service เลย"

**G4 — npm audit fix**
- สถานะ: ปิดแล้ว (บางส่วนโดยเจตนา)
- Fix: `npm audit fix` (ไม่ใช้ `--force`) ปิด Advisory ที่แก้ได้โดยไม่ Breaking —
  helmet เพิ่มเป็น Dependency ใหม่
- Commit: `575e1fd`
- Evidence: **ตรวจด้วย `npm audit` เท่านั้น (ไม่ใช่ Endpoint ที่ Verify ผ่าน HTTP
  ได้)** — เหลือ 2 moderate ที่จงใจไม่แก้: `exceljs → uuid <11.1.1`
  (GHSA-w5hq-g745-h8pq) เพราะ `--force` จะ Downgrade `exceljs` 4.4→3.4.0
  (Export Excel พังทั้งเส้น) ทั้งที่โปรเจกต์ไม่เคยใช้ `uuid` v3/v5/v6 พร้อม `buf`
  Param เลย — ความเสี่ยงจริงเป็นศูนย์ ยืนยันด้วย Production ยัง Build/Deploy
  สำเร็จปกติ (Commit `d2120a0` RUNNING ทั้ง 2 Service)

**Q1 — IDOR End-to-End Regression Test**
- สถานะ: ปิดแล้ว
- Fix: `tests/idorEndToEnd.regression.test.js` — ยก Express App จริงทั้งก้อน
  (Middleware Stack ครบ) + เซ็น JWT ด้วย Secret ทดสอบ + `fakeSupabase` (บังคับ
  `.eq()` จริง) ยิง 14 Endpoint ที่รับ `:id`/`:symbol` ด้วย Token ของผู้โจมตี A
  พร้อม id ของเหยื่อ B
- Commit: `058cfe5`
- Evidence: **ยืนยันด้วย Test เท่านั้น ไม่ได้ยิง Production จริง** (Integration
  Test ระดับ HTTP เต็มรูปแบบ ใช้แทนการยิงมือทีละ Endpoint บน Production) —
  Red-Green พิสูจน์แล้ว: ถอด `.eq('user_id', userId)` ออกจาก
  `transaction.repository.findByIdForUser` 1 บรรทัด → A ได้ 200 พร้อม Path สลิป
  ของ B กลับมาเต็มๆ (แดง 2/19) ใส่กลับ → เขียวครบ 19/19 (รวม Control Group 4
  ตัวที่พิสูจน์ว่า App ไม่ได้พังทั้งก้อน)

**Q2 — Feature Flags บน Railway Production**
- สถานะ: ตรวจแล้ว (Read-only)
- Evidence: **Production Verification 11 ส.ค. 2569** — `railway variables --kv`:
  `PREMIUM_FREE_TRIAL_ENABLED=true`, `FACEBOOK_LIKE_GRANT_ENABLED=false`

**Q3 — ความยาว JWT_SECRET บน Railway Production**
- สถานะ: ตรวจแล้ว (Read-only, ไม่ Print ค่าจริง)
- Evidence: **Production Verification 11 ส.ค. 2569** — คำนวณความยาวผ่าน `awk`
  (ไม่เคย Log ค่าจริง) ได้ **47 ตัวอักษร** (> 32) — ไม่ต้อง Rotate

**สรุป**
- Production: `d2120a0` (ทั้ง `EasyDCA` + `easydca-worker`, Deploy 11 ส.ค. 2569
  06:07 UTC)
- Test Suite: 2,059 ตัว เขียวหมด (`exit 0`, 103 Suites)
- TODO ที่เหลือ: Jest "worker process failed to exit gracefully" Warning หลังรัน
  ทั้งชุด (ไม่กระทบผล Test — Exit Code ยังเป็น 0 — ยังไม่สืบสาเหตุแน่ชัด) + RLS
  Stage 1 (เขียน Policy รอเริ่ม — ดูหัวข้อ Cross-User Isolation Audit ด้านบน) + F9
  ยังไม่มี Test เฉพาะครอบ Timeout Behavior (ดูรายละเอียดในหัวข้อ F9 ด้านบน)

### Amount Consistency Fix (23 ส.ค. 2569) — ยอดที่แสดง ≠ ยอดที่บันทึก

Deploy `main` `2c75941` (Merge Commit) · **ไม่มี Migration** · Post-mortem เต็ม:
[`POSTMORTEM_AMOUNT_CONSISTENCY.md`](./POSTMORTEM_AMOUNT_CONSISTENCY.md)

⚠️ **อ่านตามระดับหลักฐาน** เหมือน Offensive Review Round 2 ด้านบน — "Production
Verification" ≠ "ยืนยันด้วย Test เท่านั้น" ห้ามอ่านปนกันว่าแน่นเท่ากัน

**บั๊ค A — Preview 100 บาท แต่บันทึก 100.01 บาท (พบ 3 ทางเข้า)**
- สถานะ: ปิดแล้ว
- Fix: `pendingTransaction.toCommitParams` พก `amountThb` ที่ Snapshot ไว้ข้ามไปถึง
  ตอนบันทึกจริง แทนการปล่อยให้ `resolveQuantityAndPrice` คูณ `quantity × pricePerUnit`
  ขึ้นใหม่ (เศษที่ปัดทิ้งตอนหาร `quantity` เหลือ 8 ตำแหน่ง ถูกคูณราคากลับขึ้นมา) +
  `resolveAgreedAmount` Guard 2% กันยอดที่ไม่เข้าคู่ลง Ledger — ครอบทั้ง LINE
  Preview→Confirm, Postback สลิป และฟอร์มเว็บ Branch `hasPrice`
- Commit: `1d2bf50` (LINE + Postback) · `cbb375a` (ฟอร์มเว็บ)
- Evidence: **Production Verification 23 ส.ค. 2569** — Founder ทดสอบเอง 2 ทาง:
  LINE `ซื้อ BTC 100` → บันทึก **100 บาท** (Railway Log `POST /api/v1/webhook`
  03:36:30 Preview + 03:36:44 Confirm) · ฟอร์มเว็บกรอกจำนวนเงิน+ราคาเอง → **100.00**
  (Log `POST /api/v1/transactions` 03:38:04) · `grep "agreed amount rejected"`
  **ไม่พบเลย** ในหน้าต่าง Log 03:28:59–03:39:59 · Red-Green: ถอด Fix ออก → Test แดง
  ด้วยเลขจริง (`Expected 100 / Received 100.01`) โดยเทสต์เดิมทั้งหมดเขียวตลอด
- ⚠️ **ยังยืนยันด้วย Test เท่านั้น:** เส้นทาง Postback `gross` ทาง LINE และ `sellAll`
  (ไม่มี `ocr_confirm` ในหน้าต่าง Log — สลิปถูกสแกนผ่านเว็บ)

**บั๊ค B — การ์ด/ฟอร์มสลิปแสดง "รวมจ่ายจริง" ผิดข้อเท็จจริง**
- สถานะ: ปิดแล้ว
- Root Cause: AI อ่านมูลค่าหุ้น + ค่าธรรมเนียมถูกต้องทั้งคู่ แต่ตอบ `net_amount = null`
  ทุกใบ (สลิป Dime! แสดงยอดรวมเป็นตัวเลขใหญ่บนสุด ไม่มีป้ายกำกับ) →
  `resolveGrossAmount` หลุด Guard บรรทัดแรก Rule 2 ไม่เคยได้ทำงานเลย ·
  ชั้นที่ 2: `DcaForm.jsx` คำนวณ `quantity × price` เองในเบราว์เซอร์ ไม่เคยอ่านค่าที่
  Backend ส่งมา (แก้แต่ Backend อาการจะไม่หาย)
- Fix: แก้ Prompt (คงโมเดล `claude-sonnet-5`) + ทางสำรอง Deterministic เมื่อไม่มี `net`
  (VETO ลายเซ็น `ai ≈ computed ∓ fee` / ยอมรับเท่าที่ `priceRoundingDrift` อธิบายได้) +
  บรรทัดยอดรวมเปลี่ยนเป็น "รวมโดยประมาณ" เมื่อสลิปไม่ระบุยอดสุทธิ + พา
  มูลค่าหุ้นที่พิสูจน์แล้วไปถึง Ledger ทั้ง LINE (`gross` ใน Postback) และเว็บ
- Commit: `a42c4a4`
- Evidence: **Production Verification 23 ส.ค. 2569** — Railway Log 03:38:29:
  `source="slip_gross" reason="verified_against_net_minus_fee" aiAmount=106.44`
  **`netAmount=106.72`** `feeTotal=0.27 resolvedAmount=106.44` — เทียบกับก่อนแก้
  (22 ส.ค. 14:22:01) ที่เป็น `source="computed" reason="no_fee_or_net_to_verify"`
  **`netAmount=null`** `resolvedAmount=106.32` → **Prompt ใหม่ทำให้ AI อ่านยอดสุทธิได้
  จริง** · Founder ยืนยันฟอร์มแสดงมูลค่าหุ้น **106.44** / รวมจ่ายจริง **106.72** ตรงสลิป
- ⚠️ **ยังยืนยันด้วย Test เท่านั้น (สำคัญ — อย่าอ่านข้ามข้อนี้):** ทางสำรอง
  `verified_against_price_rounding` **ไม่เคยทำงานบน Production เลยแม้แต่ครั้งเดียว**
  เพราะ Prompt ใหม่ทำให้ Rule 2 เดิมทำงานแทน — Branch นี้จะได้ใช้ก็ต่อเมื่อเจอสลิปที่
  AI อ่านยอดสุทธิไม่ได้อีกในอนาคต (ครอบด้วย Unit Test 8 เคส: EOSE/ASTS/BCPG ซื้อ+ขาย/
  ขอบเขต/ไม่มีค่าธรรมเนียม/Amount-only) · การเขียน Ledger ด้วยยอด 106.44 จากสลิปก็ยัง
  ไม่ได้ทดสอบจริง (Founder ตรวจถึงหน้าจอแล้วหยุด — Log ยืนยันว่าไม่มี
  `POST /api/v1/transactions` หลัง 03:38:29)

**Deploy Verification (ทั้ง 3 Service)**
- `EasyDCA` (Web, Project `backend`) — Deployment `e7c1d6de` · SUCCESS
- `easydca-worker` (Project `backend`) — Deployment `9f3fd1a0` · SUCCESS · `jobCount=16`
- `frontend service` (**คนละ Railway Project**) — Deployment `156c9005` · SUCCESS
- ทั้ง 3 ตัว `commitHash = 2c759419d5144c6774af4740321344512099d8b5` ตรงกัน
- Evidence: `railway api` อ่าน `meta.commitHash` จริง · `railway ssh` ยืนยันโค้ดใหม่
  อยู่บน Container จริงทั้ง Web และ Worker · ดาวน์โหลด Frontend Bundle จริงจาก
  Production มาค้นข้อความใหม่ครบ 3 ตัว (Hash ต่างจาก Build ในเครื่องเพราะ Env Var
  ถูก Bake ตอน Build — CSS Hash ตรงกันเป๊ะ) · `/health` 200 · ไม่มี Error Log

**Test Coverage:** Backend 2,175 tests / 111 suites เขียว (+34) · Frontend 259 tests /
15 files เขียว (+4) · Red-Green พิสูจน์จริงครบทั้ง 3 ก้อน

---

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
7. **กดบันทึกจริงจากสลิปสักใบ** เพื่อปิดช่องหลักฐานที่เหลือของ Amount Consistency Fix
   (Ledger ต้องได้ 106.44 เท่ากับที่ฟอร์มแสดง) ตาม
   [`RUNBOOK_SLIP_EVERYWHERE.md § 3.7 B5`](./RUNBOOK_SLIP_EVERYWHERE.md)
8. **เฝ้า Log หา `verified_against_price_rounding`** — ทางสำรองของบั๊ค B ยังไม่เคย
   ทำงานบน Production เจอเมื่อไหร่ให้บันทึกไว้ว่าสลิปแบบไหนทำให้ AI อ่าน `net_amount`
   ไม่ได้ (`railway logs --service EasyDCA | grep "slip ocr gross amount resolved"`)
9. **Audit หาจุดอื่นที่ "แสดงเลขหนึ่ง บันทึกอีกเลขหนึ่ง"** — รอบ 23 ส.ค. เจอ 3 ทางเข้า
   จากการไล่โค้ดด้วยมือ ไม่ใช่จากเครื่องมือ จึงไม่มีหลักฐานว่าครบแล้ว
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
