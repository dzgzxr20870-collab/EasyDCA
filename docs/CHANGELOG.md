# Changelog

ทุก Entry ใหม่ให้เพิ่มต่อจาก Unreleased ด้านบนสุดเสมอ (ใหม่สุดอยู่บนสุด)

## [Unreleased]
### Added
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
