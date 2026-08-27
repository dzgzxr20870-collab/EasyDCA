# AI_WORK_POLICY.md — นโยบายการทำงานของ AI บนโปรเจกต์ EasyDCA

> เอกสารนี้กำหนดว่า AI (Claude หรือตัวอื่นใดก็ตาม) ต้องทำงานอย่างไรก่อน/ระหว่าง/
> หลัง Push โค้ดขึ้น `main` ของโปรเจกต์นี้ ใช้คู่กับ
> [CODING_STANDARD.md § 6 (Definition of Done ทั่วไป)](./CODING_STANDARD.md)
> — เอกสารนั้นคือเกณฑ์ภาพรวมของงานทุกชิ้น (Code Complete/ESLint/Test/Docs/
> Review/Merge) ส่วนเอกสารนี้ลงรายละเอียดเฉพาะสำหรับ **AI ที่ทำงานแทนคน** และ
> **ระดับความเข้มของ DoD ที่ต้องต่างกันตามความเสี่ยงของไฟล์ที่แตะ**

## ที่มาของเอกสารนี้

ก่อนหน้านี้ Policy การทำงานกับ AI บนโปรเจกต์นี้ — ระบุ Model (Sonnet/Opus) +
เหตุผลก่อนเริ่มงาน, เช็ค `git status` ก่อนลงมือเสมอ, และ Definition of Done
4 ชั้น (Unit → Integration → Regression → Production Verification) สำหรับงาน
ที่กระทบเงิน — **มีอยู่จริงในทางปฏิบัติแต่ไม่เคยถูกบันทึกไว้ที่ไหนเลย** เป็นแค่
Convention ที่ตกลงกันในบทสนทนากับ AI แต่ละครั้ง ซึ่งหมายความว่า Session ใหม่หรือ
คนอื่นที่มาช่วยงานจะไม่รู้กฎเหล่านี้เลยถ้าไม่มีใครบอกซ้ำ

วันที่ 2026-07-26 มีการ Audit สำรวจทั้ง Codebase (โดยเฉพาะ `backend/src/jobs/*`)
เพื่อตอบคำถามว่า "มีไฟล์/งานประเภทไหนอีกบ้างที่ควรถูกบังคับด้วย Policy ระดับ
เข้มกว่าปกติ" พบว่ามี **5 หมวดที่ทับซ้อนกันบางส่วน** จึงรวบรวมเป็นเอกสารนี้
พร้อมกฎการเลือก Policy เมื่อไฟล์หนึ่งอยู่มากกว่า 1 หมวด

ตัวอย่างเคสจริงที่เป็นเหตุผลของแต่ละกฎในเอกสารนี้ อ้างอิงไว้ท้ายไฟล์ (§ 6)

---

## 1. Model Selection

ทุกงานที่จะแก้โค้ดแล้ว Push ขึ้น `main` ต้องระบุ **Model ที่ใช้ (Sonnet/Opus) +
เหตุผลสั้นๆ** ก่อนเริ่มลงมือ (ไม่ใช่หลังทำเสร็จ) เพื่อให้ตัดสินใจเรื่องความเสี่ยง
ก่อนแก้ ไม่ใช่มาให้เหตุผลย้อนหลัง

| สถานการณ์ | Model แนะนำ |
|---|---|
| งานแตะ § 3.1 (เงิน/Ledger) หรือ § 3.2 (Entitlement/รายได้) โดยตรง | **Opus** เป็น Default — เว้นแต่เป็นงานเล็กชัดเจน (Typo/Comment) ที่ระบุเหตุผลได้ว่าทำไมถึงไม่เสี่ยง |
| งานแตะ § 3.3 (PII/PDPA) ที่มีผลต่อ Third-party Data Transfer หรือ Erasure Flow | **Opus** |
| งาน Infra/Config (§ 3.5) ที่กระทบทั้ง Service เมื่อพลาด | **Opus** |
| งานทั่วไปอื่น (UI, Copy, Refactor ไม่กระทบ Logic การเงิน) | ใช้ดุลพินิจ — Sonnet ใช้ได้ |

## 2. Git Hygiene ก่อนลงมือทุกครั้ง

- รัน `git status` ก่อนเริ่มงานเสมอ — กันเผลอทับงานค้างของคนอื่น/Session อื่น
  ที่ยังไม่ Commit
- ตรวจ `git diff --stat` / review ไฟล์ที่ `git add` ก่อน Commit เสมอ — กัน Stage
  ไฟล์หลุด (เช่น Scratch File, `.env`) หรือ Secret หลุดไปโดยไม่ตั้งใจ
- ห้าม `git push --force`, `git reset --hard`, หรือ Destructive Command อื่นๆ
  โดยไม่ถามผู้ใช้ก่อนเสมอ ไม่ว่าจะดูเหมือน "ปลอดภัย" แค่ไหนก็ตาม

## 3. Definition of Done — 4 ชั้น

ใช้คู่กับ [CODING_STANDARD.md § 6](./CODING_STANDARD.md) — เอกสารนั้นคือเกณฑ์
ระดับภาพรวม ส่วน 4 ชั้นนี้คือรายละเอียดของขั้น **"Test ผ่าน"** เจาะจงสำหรับงาน
ที่ความเสียหายจากบั๊กแก้คืนยาก (เงิน/PII/Infra) — ระดับความเข้มที่ต้องทำครบกี่ชั้น
ขึ้นกับหมวดของไฟล์ที่แตะ (ดู § 4)

1. **Unit** — Test Logic ล้วน (Pure Function เช่น `resolveSide`/`statusFromEvidence`
   สไตล์เดียวกับที่ `slipOcr.service.js` ใช้) แยกจากการยิง API/DB จริง
2. **Integration** — Test ทั้ง Flow ผ่าน Mock ภายนอก (Claude API, LINE API,
   Supabase) ยืนยันว่าส่วนต่างๆ ต่อกันถูก
3. **Regression** — ต้องพิสูจน์ **Red-Green จริง**: ถอด Fix ออกชั่วคราวแล้วรัน
   Test ต้องแดงจริงก่อน ใส่กลับแล้วต้องเขียว — Test ที่ไม่เคยแดงไม่ได้พิสูจน์อะไร
   (ดูเคสจริงใน § 6 ที่เจอ Assertion หลอกเพราะ `JSON.stringify` escape `"`)
4. **Production Verification** — ต้อง Verify **บน Container ที่ Deploy จริง**
   ไม่ใช่แค่ "Build สำเร็จ" หรือ "Log ไม่มี Error" เท่านั้น:
   - งาน Infra/Config: ยิงคำสั่งจริงผ่าน `railway ssh` หรือเทียบเท่า (เช่น
     `pg_dump --version`) ยืนยันผลจริงในสภาพแวดล้อมที่รันจริง
   - งาน Cron/Background (§ 4.4) ที่แยก Service (`easydca-worker`) ต้อง Verify
     บน **Service นั้นโดยตรง** ไม่ใช่แค่เช็ค `/health` ของ Web Service (`EasyDCA`)
     ที่เป็นคนละ Container กัน
   - งานที่พึ่งความแม่นของ AI (เช่น OCR อ่านรูป) ควรมี Production Verification
     ด้วยข้อมูลจริงจากผู้ใช้ ไม่ใช่แค่ Mock Response ที่คาดเดาเอง

### 3.1 ⭐ กฎเรื่อง Mock — "Mock ที่หลวมกว่าของจริง" คือจุดตายที่เจอซ้ำ 3 ครั้ง

> บั๊ก Asset Resolution ทั้ง **3 หาง** รอดจากเทสต์ 2,600+ ตัวมาได้ด้วยกลไกเดียวกัน:
> **Mock ที่ยอมรับ Argument ทุกแบบเหมือนกันหมด ทั้งที่ของจริงแยกพฤติกรรม 3 ทาง**
> (Post-mortem: [`POSTMORTEM_PORTFOLIO_RESOLUTION.md`](./POSTMORTEM_PORTFOLIO_RESOLUTION.md)
> § 5.1 · § 10.4 · § 11.2 — เกิดคนละรูปทั้ง 3 ครั้ง แต่ต้นตอเดียวกัน)
>
> `mockResolvedValue([row])` **ไม่สนใจเลยว่าถูกเรียกด้วยอะไร** — มันตอบ `[row]`
> เท่ากันหมดไม่ว่าจะส่ง `undefined`, `null`, หรือ uuid ผิดตัวเข้าไป
> เทสต์จึงเขียวสนิทตลอดเวลาที่ค่าถูกส่งผิด **หรือไม่ถูกส่งไปเลย**

**นิยาม Seam** — จุดที่ค่าหนึ่งต้อง "รอด" ข้ามขอบเขต ถ้าตกหล่นระบบจะไม่ Error
แต่จะทำงานผิดเงียบๆ:

| Seam | ตัวอย่างค่าที่ต้องรอด |
|---|---|
| Service → Repository | `portfolioId` / `brokerId` (แยก 3 ทาง: `undefined` / `null` / uuid) |
| Preview → Confirm | `amountThb` · `brokerId` · `portfolioId` · `currency` · `slipToken` |
| Controller → Service | `plan` / `planExpiresAt` (Fail-closed ถ้าหาย) |
| Postback → Command | มิติที่ผู้ใช้ตอบไปแล้ว (`broker` / `pf`) |

**กฎบังคับ:**

1. **เทสต์ที่ครอบ Seam ห้ามใช้ `mockResolvedValue`** — ต้องใช้ `mockImplementation`
   ที่อ่าน Argument จริงและจำลองพฤติกรรมของจริง **หรือ** assert
   `toHaveBeenCalledWith(...)` ให้ครบทุกค่าที่ต้องรอด (เอาอย่างใดอย่างหนึ่งไม่พอ
   ถ้าค่านั้นแตะเงิน — ทำทั้งคู่)
2. **Mock ต้องบังคับกติกาเดียวกับของจริง** — ถ้า Repository จริงแยก `undefined`
   กับ `null` ออกจากกัน Mock ก็ต้องแยก · Mock ที่ยอมรับทุกอย่างเหมือนกันคือ
   Fixture ที่ตอบ "เจอ" เสมอ ซึ่งผ่านทุก Assertion ที่ถามว่า "เจอไหม"
3. ⭐ **Red-Green ที่ถอด Fix ออกแล้ว "ยังเขียว" = เทสต์ใช้ไม่ได้ ไม่ใช่ Fix ไม่จำเป็น**
   **ห้ามสรุปว่า "แสดงว่าไม่ต้องแก้" เด็ดขาด** — ต้องหาสาเหตุว่าทำไมเทสต์ไม่แดง
   ก่อนเดินต่อเสมอ (สาเหตุที่พบจริง: `jest.mock` ทิ้งทั้ง Repository จนฟังก์ชัน
   ที่กำลังทดสอบไม่เคยถูกรันเลยแม้แต่ครั้งเดียว)
4. **Logic ที่แตะเงินต้องมีเทสต์ที่ใช้ "ของจริงอย่างน้อยหนึ่งชั้น" เสมอ** —
   Mock ได้เฉพาะขอบนอกสุด (Query Builder / External API) · ถ้า Mock ทั้ง
   Repository และ Service เทสต์จะพิสูจน์ได้แค่ว่า "เราเรียกฟังก์ชันชื่อนี้"
   ไม่ได้พิสูจน์ว่ามันทำงานถูก
5. **งานที่แตะ 2 Service ต่อกันบนเส้นทางเงิน ต้องมีเทสต์รอยต่ออย่างน้อย 1 ตัว
   ที่ใช้ของจริงทั้งสองฝั่ง** (Mock เฉพาะ Repository/External) — ดูตัวอย่างที่
   `tests/multiBrokerPendingSeam.test.js` และ `tests/pendingPortfolioSeam.test.js`

---

## 4. 5 หมวดไฟล์ + Policy เฉพาะ

### 4.1 แตะเงิน/Ledger โดยตรง (ต้อง DoD 4 ชั้นเต็ม)

| ไฟล์ | เหตุผล |
|---|---|
| `services/transaction.service.js`, `repositories/transaction.repository.js` | เขียน Ledger จริง (validateBuy/validateSell) |
| `services/pendingTransaction.service.js` + repository | Staging ก่อนเข้า Ledger — Confirm แล้วเป็นรายการจริงทันที |
| `services/undoTransaction.service.js` | อ่อนไหวสุดในหมวดนี้ — สร้าง Reversal Entry เข้า Immutable Ledger |
| `services/slipOcr.service.js` | ตัดสิน side/amount/order_status ที่จะกลายเป็น Ledger |
| `services/bulkImport.service.js`, `bulkImportSession.service.js` + repository | เขียน Ledger เป็น Batch |
| `services/guidedBuyFlow.service.js` + repository | ปลายทางคือ Ledger เดียวกัน |
| `services/profit.service.js`, `portfolio.service.js`, `dcaStats.service.js` | ไม่เขียน Ledger แต่คำนวณ P&L จาก Ledger — ผิด = ตัวเลขที่ผู้ใช้เห็นผิด |
| `services/fxRate.service.js`, `priceFeed.service.js` | Input ของการคำนวณเงิน — อัตราแลกเปลี่ยน/ราคาผิด = P&L ผิดทั้งระบบ |
| `jobs/portfolioSnapshot.job.js` | เขียน Snapshot มูลค่ารวมลง DB ทุกคืน |
| `controllers/transactions.controller.js` | ทางเข้า HTTP ของทั้งหมดนี้ |

**Policy:**
- DoD 4 ชั้นเต็ม (§ 3) ไม่มีข้อยกเว้น
- ห้าม `UPDATE`/`DELETE` แถว Ledger เดิมเด็ดขาด — แก้ด้วย Reversal Pattern
  (สร้างรายการตรงข้าม) เท่านั้น ตาม [DATABASE.md § 8](./DATABASE.md)
- PR/รายงานต้องมีตัวอย่างตัวเลข Before/After จริง ไม่ใช่แค่คำอธิบาย Logic ลอยๆ
- Model = Opus โดย Default (ดู § 1)

### 4.2 แตะ Entitlement/Premium Status (กระทบรายได้)

| ไฟล์ | เหตุผล |
|---|---|
| `services/entitlement.service.js` | Single Source of Truth ของสิทธิ์ทั้งระบบ |
| `services/payment.service.js` + repository + `controllers/payment.controller.js` | เงินจริงเข้าผ่าน PromptPay QR |
| `services/adminGrant.service.js`, `repositories/premiumGrantLog.repository.js` | ให้ Premium ฟรี — ห้ามสร้างแถว `payments` ปลอม เพราะ `/admin/stats` นับรายได้จาก `payments.status='confirmed'` ตรงๆ |
| `jobs/planDowngrade.job.js` | Auto-downgrade ผู้ใช้ที่หมดอายุกลับเป็น Free ทุกคืน |
| `jobs/paymentExpiry.job.js` | Expire คำขอชำระเงิน + Auto-release ยอดที่ Lock ค้าง (คาบเกี่ยว § 4.1 ด้วย) |
| `services/promptpayQr.service.js`, `qrImage.service.js` | เข้ารหัสยอดเงินลง QR — ผิด = เรียกเก็บเงินผิดจำนวน |

**Policy:**
- ทุกงานในหมวดนี้ต้องระบุผลกระทบต่อตัวเลขใน `/admin/stats` ไว้ในรายงาน/PR
  อย่างชัดเจน (กระทบ/ไม่กระทบ และทำไม)
- งาน Downgrade/Auto-release/Expire ที่ทำงานเป็น Batch ต้อง Dry-run นับจำนวนที่
  จะถูกเปลี่ยนสถานะก่อนรันจริงในรอบแรกเสมอ
- Production Verification ต้องเช็คหน้า Admin Stats ก่อน/หลัง Deploy

### 4.3 แตะ PII/ข้อมูลส่วนบุคคล (ต้องระวัง PDPA)

| ไฟล์ | เหตุผล |
|---|---|
| `services/userErasure.service.js`, `repositories/erasureLog.repository.js` | Right to Erasure (PDPA Self-service) |
| `repositories/user.repository.js` | เก็บ `line_user_id`/`display_name`/`picture_url`/`pdpa_consented_at`/`anonymized_at` |
| `services/authToken.service.js`, `liffAuth.service.js` | Identity Token |
| `services/broadcast.service.js`, `repositories/broadcastLog.repository.js` | ส่งข้อความหา User List ทั้งหมด |
| `services/reportExport.service.js` | Export รายงานการเงินส่วนบุคคลเป็นไฟล์ |
| `services/slipOcr.service.js` | ส่งรูปสลิปของผู้ใช้ออกไปยัง Claude API ภายนอก — เป็น Third-party Data Transfer ตาม PDPA |
| `jobs/dbBackup.job.js` | Backup ข้อมูล PII + เงินทั้งฐานออกนอกระบบ (Cloudflare R2) |
| `controllers/admin.controller.js` | Admin เห็นข้อมูล User ตรงๆ |

**Policy:**
- ก่อนเพิ่ม Field/Log ใหม่ที่มีข้อมูลผู้ใช้ ต้องเช็ค 2 ข้อเสมอ: (1) รอดจาก
  Erasure Request ไหม (2) หลุดไปอยู่ใน Log แบบไม่จำเป็นไหม
- Third-party ใดก็ตามที่รับข้อมูลผู้ใช้ (ปัจจุบันคือ Claude Vision ผ่าน
  `slipOcr.service.js`) ต้องมีระบุไว้ใน PDPA Notice ที่ผู้ใช้เห็น — ถ้ายังไม่มี
  ต้องแจ้ง Product Owner ก่อน ไม่ใช่ตัดสินใจเอง
- Backup ต้องเข้ารหัส Client-side เสมอ (`backupEncryption.util.js`) — ห้าม Rotate
  Encryption Key โดยไม่แจ้งผู้ใช้/สำรอง Key เดิมไว้ก่อน

### 4.4 Cron/Background Job ที่รันเอง (ต้องมี Log ชัดเจนกันหา Root Cause ยาก)

รายการทางการคือทุก Job ที่ `backend/src/worker.js` เรียก `schedule*()` — ปัจจุบัน
14 Jobs จาก 11 ไฟล์ (`richMenuImage.js` และ `setupRichMenu.js` **ไม่ใช่** Cron —
เป็น Script รันมือครั้งเดียว อยู่ใน § 4.5 แทน):

`pendingCleanup` (×2) · `dcaReminder` · `reminderSetupCleanup` ·
`bulkImportCleanup` · `guidedBuyCleanup` · `portfolioSummary` (×2) ·
`paymentExpiry` (×2) · `planDowngrade` · `portfolioSnapshot` ·
`webhookEventCleanup` · `dbBackup`

**Policy:**
- ห้าม Hardcode ตัวเลขที่ควรนับได้จากโค้ดจริง (เช่น จำนวน Job ที่ Schedule) —
  ต้อง Derive จาก `Object.keys(...).length` หรือเทียบเท่าเสมอ (ดูเคสจริง § 6:
  `worker.js` เคย Hardcode `jobCount: 12` ทั้งที่ของจริงคือ 14)
- ทุก Job ต้อง Log ผ่าน `logger.util` แบบ Structured ให้ครบ ไม่ใช้ `console.log`
  ดิบๆ ปนกัน (ตรวจสอบเป็นระยะ เพราะไฟล์เก่าบางไฟล์ยังไม่ทำ)
- ทุก Job ที่ Loop ต่อ Record ต้องมี Error Isolation ต่อ Record (1 Record พังไม่
  ทำให้ทั้ง Batch หยุด) — Pattern ที่ใช้อยู่แล้วในเกือบทุกไฟล์ปัจจุบัน ต้องคงไว้
  เมื่อเพิ่ม Job ใหม่
- Job ในหมวดนี้ที่ทับซ้อนกับ § 4.1/4.2 (เช่น `planDowngrade`, `paymentExpiry`,
  `portfolioSnapshot`) ต้อง Production Verification บน **`easydca-worker`
  Service โดยตรง** เสมอ — ไม่ใช่แค่เช็ค `/health` ของ `EasyDCA` (Web Service)
  ที่เป็นคนละ Container/Build กัน (ดูเคสจริง § 6)

### 4.5 Infra/Config (Deploy พลาดกระทบระบบทั้งหมด)

| ไฟล์ | เหตุผล |
|---|---|
| `backend/nixpacks.toml`, `backend/railpack.json` | Build Config — ไฟล์ที่ "ดูถูกต้อง" ไม่ได้แปลว่า Deploy จริงถูก (ดูเคสจริง § 6) |
| `src/config/env.js`, `config/supabase.js` | Boot-time Validation |
| `utils/backupEncryption.util.js`, `services/backupStorage.service.js` | Key หาย = กู้ Backup เก่าไม่ได้เลย |
| `migrations/*.sql` | Schema Change บน Production — Apply แล้วย้อนกลับยาก |
| `src/worker.js`, `src/index.js` | Entrypoint — ลืม Deploy Service ใดไป Cron/Web จะไม่ทำงานแบบ Silent ไม่มี Error ให้เห็น |
| `jobs/setupRichMenu.js`, `jobs/richMenuImage.js` | Script รันมือครั้งเดียว กระทบ LINE Config จริงตอนรัน |

**Policy:**
- ห้ามถือว่า Config ถูกต้องจาก "อ่าน Diff แล้วดูสมเหตุสมผล" อย่างเดียว — ทุกงาน
  Infra ต้อง Verify ในสภาพแวดล้อมที่ Deploy จริง (เช่น `railway ssh -- <command>`)
  ก่อนปิดงานเสมอ (ดู § 3 ข้อ 4)
- Migration ต้องมี Rollback Plan เขียนไว้ก่อน Apply บน Production
- Config ที่มี Syntax แบบ "Override ทับทั้งหมด vs Extend ของเดิม" (เช่น Nixpacks
  `nixPkgs = ['...', pkg]`, Railpack `deploy.aptPackages: ['...', pkg]`) ต้อง
  ตรวจสอบ Semantics จาก Official Docs ทุกครั้งที่ Builder/Platform เปลี่ยน —
  ห้ามจำจาก Config เดิมเพราะ Syntax เปลี่ยนไปตาม Tool ที่ใช้จริง ณ ตอนนั้น

---

## 5. กฎไฟล์ที่คาบเกี่ยวหลายหมวด

ไฟล์ที่อยู่ **มากกว่า 1 หมวด** ต้องยึด **Policy ที่เข้มที่สุด**ในบรรดาหมวดที่มัน
อยู่เสมอ — ห้ามเฉลี่ยหรือเลือกหมวดที่สะดวกที่สุด

ตัวอย่าง:

| ไฟล์ | อยู่หมวด | Policy ที่ต้องทำครบ |
|---|---|---|
| `services/slipOcr.service.js` | 4.1 (เงิน) + 4.3 (PII) | DoD 4 ชั้นเต็ม **และ** เช็ค Third-party Data Transfer/PDPA Notice |
| `jobs/paymentExpiry.job.js` | 4.1 (เงิน) + 4.2 (รายได้) + 4.4 (Cron) | DoD 4 ชั้นเต็ม **และ** ระบุผลกระทบ Admin Stats **และ** Verify บน `easydca-worker` โดยตรง |
| `jobs/portfolioSnapshot.job.js` | 4.1 (เงิน) + 4.4 (Cron) | DoD 4 ชั้นเต็ม **และ** Log Structured + Verify บน `easydca-worker` |
| `jobs/dbBackup.job.js` | 4.3 (PII) + 4.4 (Cron) + 4.5 (Infra) | เช็ค PDPA/Encryption **และ** Log ชัดเจน **และ** Verify Container จริง |

---

## 6. บทเรียนอ้างอิง (เคสจริงที่ทำให้เกิดเอกสารนี้)

- **pg_dump ENOENT (2026-07-26)** — `nixpacks.toml` แก้ถูกต้องสมบูรณ์ทุกอย่าง
  แต่ไม่มีผลจริง เพราะ Railway เปลี่ยน Builder ของ Project ไปเป็น Railpack
  เงียบๆ ซึ่งไม่อ่าน `nixpacks.toml` เลย — ตรวจพบได้เพราะ Verify ผ่าน Build Log
  จริงแทนที่จะเชื่อว่า Diff ที่ดูถูกต้อง = ใช้งานได้จริง (ที่มาของ § 3 ข้อ 4
  และ § 4.5)
- **Slip OCR order_status bug (2026-07-26)** — สลิป Limit Order ที่ยัง
  "รอจับคู่" ถูกเสนอให้บันทึกเป็นธุรกรรมสำเร็จทันที เพราะระบบไม่มีแนวคิดเรื่อง
  สถานะคำสั่งเลย ตรวจพบระหว่าง Audit นี้เอง แก้ด้วย Evidence-based Pattern
  เดียวกับที่เคยแก้บั๊ก Buy/Sell Misclassification (ที่มาของ § 4.1)
- **`worker.js` jobCount Drift** — Log Startup Hardcode `jobCount: 12` ไว้ตรงๆ
  ตั้งแต่แรก แต่มีคนเพิ่ม Job ใหม่ทีหลัง (`scheduleAutoReleaseStaleAmounts`,
  `schedulePurgeOld`) โดยไม่มาแก้เลขนี้ตาม ทำให้ Log ไม่ตรงกับจำนวน Job จริง
  (14 ไม่ใช่ 12) เจอระหว่าง Audit นี้เอง แก้แล้วโดย Derive จาก
  `Object.keys(...).length` (ที่มาของ § 4.4)
- **Asset Resolution 3 หาง (2026-08-24 → 27)** — บั๊กเดียวกันรอดจากเทสต์
  2,600+ ตัวมาได้ **3 รอบติด** เพราะ Mock ที่หลวมกว่าของจริง (รอบแรก `jest.mock`
  ทิ้งทั้ง Repository จนฟังก์ชันที่ทดสอบไม่เคยถูกรัน · รอบสองไม่มีเคสที่ผสม
  สองมิติพร้อมกัน · รอบสาม `mockResolvedValue` ไม่สนใจ Argument ที่ควบคุมการกรอง)
  ทั้ง 3 หางถูกจับได้ด้วย "คนไปมองตรงนั้นพอดี" ไม่ใช่ด้วยเทสต์ — **จับได้ก่อน
  Apply migration ไม่มีข้อมูลผู้ใช้เสียหายจริง** (ที่มาของ § 3.1 ทั้งหมด ·
  Post-mortem เต็ม: [`POSTMORTEM_PORTFOLIO_RESOLUTION.md`](./POSTMORTEM_PORTFOLIO_RESOLUTION.md))
- **Test หลอกที่เขียวตลอดแม้บั๊กยังอยู่** — ระหว่างแก้บั๊ก Slip OCR Assertion
  `not.toContain('หากกด "ยืนยันบันทึก"')` ผ่านตลอดทุกครั้งแม้ยังไม่ได้แก้ เพราะ
  `JSON.stringify` Escape `"` เป็น `\"` ทำให้ไม่มีวัน Match พบได้เพราะทำ
  Red-Green จริงจัง (ถอด Fix ออกแล้วต้องเห็นแดงก่อน) (ที่มาของ § 3 ข้อ 3)
- **pg_dump Version Mismatch (2026-07-27)** — Nightly Backup ใช้งานไม่ได้เลย
  แม้แต่คืนเดียวตั้งแต่เริ่มมีฟีเจอร์ เพราะ `postgresql-client` ที่ apt ของ
  Debian bookworm ติดตั้งให้เป็น Default คือเวอร์ชัน **15** แต่ Supabase จริง
  รัน PostgreSQL **17.6** — `pg_dump` ปฏิเสธ Dump จาก Server ที่ Major Version
  สูงกว่าตัวเองเสมอ (`aborting because of server version mismatch`) **ห้าม
  เชื่อว่า Package Version ที่ Distro ให้มาเป็น Default จะตรงกับ Server
  Version จริงเสมอ** ต้องเช็ค Server Version จริงก่อน (`SELECT version()` หรือ
  เทียบจาก Error ตรงๆ) แล้ว Vendor Binary เวอร์ชันที่ตรงกันเองถ้าจำเป็น —
  ระหว่างแก้ยังเจอ Trap ซ้อน: ตั้ง `deploy.inputs` เองใน `railpack.json` เพื่อ
  ดึงไฟล์จาก Step ที่เพิ่มใหม่ ทำให้ Node/npm Runtime (Mise) หายไปจาก Deploy
  Image ทั้งคู่แบบไม่มี Error เตือน (Deploy สำเร็จ แต่ App รันไม่ได้เลย) เพราะ
  Railpack รวม Runtime เข้า Deploy Image "โดยปริยาย" ก็ต่อเมื่อไม่มี
  `deploy.inputs` Override เท่านั้น — ถ้าจำเป็นต้องเพิ่มไฟล์เข้า Deploy Image
  ให้ขยาย Step ที่มีอยู่แล้วด้วย `"..."` แทนการตั้ง `deploy.inputs` เองใหม่
  ทั้งหมด และต้องทดสอบใน Environment แยกก่อน Apply เข้า Production เสมอเมื่อ
  แก้ Build Config ระดับนี้ (ที่มาของ § 3 ข้อ 4 และ § 4.5)
- **Race Condition จาก Stream Event ตัดสิน Success ก่อน Process จบจริง
  (2026-07-27)** — `pgDump.util.js` เดิม Resolve ว่า Backup "สำเร็จ" ทันทีที่
  Stream `stdout` ของ Child Process ส่ง Event `'end'` โดยไม่รอเช็ค Exit Code
  จาก Event `'close'` ก่อน — Node รับประกันว่า `stdout 'end'` มาก่อน Process
  `'close'` เสมอ ถ้า Process ที่ถูก Pipe ข้อมูลออกมา (เช่น `pg_dump`) ล้มเหลว
  "เร็ว" (Exit ทันทีโดยไม่ทันเขียน stdout เลย เช่นต่อ Database ไม่ได้) Job จะ
  เข้าใจผิดว่าสำเร็จ (Log ขึ้น "อัปโหลดสำเร็จ" จริง) ทั้งที่ได้ผลลัพธ์ว่างเปล่า
  — เป็น Bug แบบ **Deterministic ไม่ใช่ Flaky** (Reproduce ได้ 20/20 รอบด้วย
  Script จำลอง Process ที่ Fail เร็ว) **กฎ: เมื่อ Pipe ข้อมูลจาก Child Process
  ผ่าน Stream (เช่น `pgDump.stdout.pipe(gzip)`) ห้ามตัดสิน Resolve/Reject จาก
  Stream Event (`'end'`) เพียงอย่างเดียวเด็ดขาด ต้องรอทั้ง Stream จบจริงและรู้
  Exit Code จริงจาก Process Event (`'close'`) ก่อนตัดสินใจเสมอ ไม่ว่า Event
  ไหนจะมาก่อนกัน** (ที่มาของ § 3 ข้อ 3-4)
- **ยอดที่แสดง ≠ ยอดที่บันทึก — Mock ที่รอยต่อทำให้เทสต์เขียวสนิททั้งที่บั๊คมีอยู่จริง
  (2026-08-23)** — ผู้ใช้พิมพ์ `ซื้อ BTC 100` การ์ด Preview แสดง 100 บาท แต่รายการที่
  ลง Ledger จริงเป็น 100.01 บาท เพราะ `pendingTransaction.toCommitParams` ส่งต่อแค่
  `quantity` + `pricePerUnit` ไม่ส่ง `amountThb` ที่ Snapshot ไว้ ทำให้
  `resolveQuantityAndPrice` คำนวณยอดขึ้นใหม่ (เศษที่ถูกปัดทิ้งตอนหาร `quantity` เหลือ
  8 ตำแหน่ง ถูกคูณราคากลับขึ้นมาเป็นสตางค์ — ขอบเขต `0.5e-8 × pricePerUnit`)
  **เทสต์ทั้งสองฝั่งเขียวสนิทตลอดเวลาที่บั๊คมีอยู่** เพราะ
  `pendingTransaction.service.test.js` Mock `transaction.service` ทั้งก้อน ส่วน
  `transaction.service.test.js` ไม่รู้จัก `pending` เลย — บั๊คอยู่ที่ "รอยต่อ" พอดี ซึ่ง
  เป็นจุดบอดของ Mock ทั้งคู่ **กฎ: งานที่แตะ 2 Service ต่อกันบนเส้นทางเงิน ต้องมีเทสต์
  ที่ใช้ของจริงทั้งสองฝั่งอย่างน้อย 1 ตัว (Mock เฉพาะ Repository/External API)** —
  ดู `tests/amountConsistency.regression.test.js` เป็นแบบ · บทเรียนซ้อนอีก 3 ข้อจาก
  รอบเดียวกัน: (1) **Comment ที่ยอมรับข้อจำกัดไว้เองโดยไม่มี Guard/Test บังคับ = บั๊คที่
  รอเวลา** — `transactions.controller` เคยเขียนไว้ว่า "อาจต่างได้ระดับเศษสตางค์ถ้าราคา
  ต่อหน่วยสูงมาก แต่หุ้นไทยราคาหลักพันจึงไม่เกิด" ทั้งที่ Branch นั้นเปิดให้กรอกราคาเอง
  ได้ทุกสินทรัพย์ (2) **ห้ามแก้ Prompt ให้ตัวตรวจสอบกลายเป็นวงกลม** — การใบ้ AI ว่า
  "ยอดสุทธิมักมากกว่ามูลค่าหุ้นเท่ากับค่าธรรมเนียม" ทำให้ AI เดา `net` จาก `amount + fee`
  แล้วสมการ `net − fee` ที่เราใช้ตรวจก็จะผ่านเสมอโดยไม่ได้ตรวจอะไรเลย (ช่องโหว่ BCPG
  เปิดกลับทันที) (3) **Log ที่ยิงเฉพาะตอนผิด ตอบไม่ได้ว่าตอนถูกมันถูกจริงไหม** —
  `slip ocr gross amount resolved` เดิมยิงเฉพาะ `source !== 'slip_gross'` วินิจฉัยบั๊คได้ดี
  แต่พอแก้เสร็จกลับไม่มีร่องรอยยืนยันผล ต้องกลับมาแก้ Log เพิ่มอีกรอบ
  (Post-mortem เต็ม: [`POSTMORTEM_AMOUNT_CONSISTENCY.md`](./POSTMORTEM_AMOUNT_CONSISTENCY.md)
  — ที่มาของ § 3 ข้อ 1-3 และ § 4.1)
