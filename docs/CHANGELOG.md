# Changelog

ทุก Entry ใหม่ให้เพิ่มต่อจาก Unreleased ด้านบนสุดเสมอ (ใหม่สุดอยู่บนสุด)

## [Unreleased]
### Added
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
