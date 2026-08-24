# DECISIONS_LOG.md — บันทึกการตัดสินใจสำคัญ (ย้ายมาจาก CHANGELOG.md เดิม)

> ไฟล์นี้แยกออกมาจาก `CHANGELOG.md` เดิม (วันที่ 9 กรกฎาคม 2569) เพื่อให้
> `CHANGELOG.md` ใช้รูปแบบ [Keep a Changelog](https://keepachangelog.com/)
> แบบมาตรฐาน (เรียงตาม Version v0.1.0, v0.2.0, ...) ควบคู่กับการเริ่ม
> Git Tag Versioning จริงจังตั้งแต่ Phase 3 เป็นต้นไป
>
> ไฟล์นี้เก็บ "บันทึกรายวัน" (Day-by-day Log) และ "การตัดสินใจสำคัญ"
> (Decided) ของช่วง Phase 0 ไว้ตามเดิมทุกตัวอักษร — ไม่มีอะไรถูกลบทิ้ง

---

## [Decided] - 24 สิงหาคม 2569 — `quantity` ของแถว `dividend` เป็นค่า "บังคับกรอก"

**คำถามนี้ไม่มีอยู่ใน Design Doc § 8** — เพิ่งโผล่ตอน Implement Stage 6b เมื่อพบว่า
`transactions` มี CHECK บังคับ `quantity > 0` และ `price_per_unit > 0` กับ**ทุกแถว**
ขณะที่ Design Doc § 4.5 ระบุ Body ของ Endpoint ว่า `quantity?` เป็น optional และไม่มี
`pricePerUnit` เลย — สองอย่างนี้ขัดกันตรงๆ จนแถวปันผลจะถูก DB ปฏิเสธทุกแถว

| # | คำถาม | มติ |
|---|---|---|
| — | แถว `dividend` เก็บ `quantity`/`price_per_unit` ยังไง (Schema บังคับ > 0 แต่ Doc บอก optional) | **บังคับผู้ใช้กรอกจำนวนหน่วยที่ได้ปันผล** แล้วคำนวณ `price_per_unit = amount_thb / quantity` (= **บาทต่อหุ้น / DPS**) · **ไม่ผ่อน CHECK ของตารางเงิน** ด้วยเหตุผลเดียวกับที่ Design Doc § 5.3 ให้ไว้เองตอนอธิบายว่าทำไมไม่ใช้ `amount` ติดลบ (ผ่อนเกราะเพื่อ type เดียว = เปิดช่องให้บั๊กของ `buy`/`sell` ทะลุถึง DB ด้วย) · ค่าที่ได้ไม่ใช่ค่าขยะเพื่อให้ผ่าน Constraint แต่ตรงกับหน้าตาสลิปปันผลไทยจริง ("0.50 บาท/หุ้น × 1,000 หุ้น = 500 บาท") |

**เหตุผลที่ "ไม่เติมยอดถือให้เอง" ทั้งที่ระบบคำนวณได้:**

`heldQuantityAsOf()` คำนวณยอดถือ ณ วันที่ได้ปันผลได้อยู่แล้ว การเอามาเติมให้เมื่อ
ผู้ใช้ไม่กรอกจึงดู "สะดวกกว่า" — แต่ขัด **กฎยืนข้อ 11** ("Silent Default เป็น
Anti-pattern เสมอ — พาร์สข้อมูลไม่ชัดเจนต้องถามผู้ใช้หรือ Reject ไม่ใช่เดาค่า Default")

จำนวนหน่วยที่ *ระบบรู้* กับที่ *ได้ปันผลจริง* **ไม่จำเป็นต้องเท่ากันเลย**:
- ปันผลจ่ายตามยอด ณ **วัน XD** ซึ่งมักเป็นคนละวันกับวันที่เงินเข้าบัญชี
- ผู้ใช้จำนวนมากเพิ่งเริ่มบันทึกกลางทาง ระบบจึงเห็นประวัติไม่ครบตั้งแต่ต้น

และค่านี้ไม่ได้จบในตัวเอง — มันไหลต่อไปเป็น `price_per_unit` (DPS) ที่ผู้ใช้เอาไป
**เทียบข้ามงวดจริง** การเดาแทนผู้ใช้จึงเท่ากับเขียนตัวเลขที่ไม่มีใครยืนยันลง
Immutable Ledger ถาวร แล้วผิดแบบเงียบสนิท

> ⚠️ **`heldQuantityAsOf` ห้ามถูกลบทิ้ง** — ยังทำหน้าที่เป็นด่าน
> `NOTHING_TO_RECEIVE_DIVIDEND` ซึ่งตรวจจาก **ยอดถือจริง ณ `date` เสมอ ไม่ใช่จาก
> `quantity` ที่ผู้ใช้กรอก** (ไม่งั้นผู้ใช้กรอกตัวเลขอะไรก็ได้ก็ข้ามด่านได้ =
> บันทึกปันผลของหุ้นที่ไม่เคยถือ) · `quantity` = "สิ่งที่ผู้ใช้อ้าง" ·
> `heldQuantityAsOf` = "ของจริงที่ระบบยืนยันได้" — คนละบทบาท ต้องมีทั้งคู่

**หมายเหตุลำดับเวลา:** commit `a9f8f3d` (Stage 6b) ทำเป็น optional ไว้ก่อน เพราะเขียน
ขึ้น *ก่อน* มติข้อนี้จะมาถึง ไม่ใช่การจงใจขัดมติ — แก้ตามในคอมมิตถัดมา

---

## [Decided] - 23 สิงหาคม 2569 — Open Questions ของ Multi-Portfolio / Broker / Sector / Dividend

คำตอบของ **Open Questions § 8** ใน
[`DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md`](./DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md)
— ตัดสินโดย Founder ครบทุกข้อ **ห้ามเปลี่ยนเองโดยไม่ถาม**

| # | คำถาม | มติ |
|---|---|---|
| § 8.1 | Free-tier limit เมื่อมีหลายพอร์ต | **ตัวเลือก C — Free ล็อกพอร์ตเดียว** · Multi-portfolio เป็นฟีเจอร์ Premium ล้วน · เพดานเดิม `FREE_TIER_ASSET_LIMIT = 2` / `FREE_TIER_DCA_PLAN_LIMIT = 2` **ไม่ต้องแก้เลย** · ตรงกับ `AI_CONTEXT.md` บรรทัด 95 ที่ระบุไว้ตั้งแต่แรก (`Multiple Portfolio: Free ❌ / Premium ✅`) |
| § 8.1 (ก) | Premium หมดอายุแต่มี 3 พอร์ต | **"อ่านได้ แต่เขียนไม่ได้"** — พอร์ตที่เกินโควตาเปิดดูข้อมูลย้อนหลังได้ปกติ แต่เพิ่มสินทรัพย์/บันทึกรายการใหม่เข้าไปไม่ได้ · ต่ออายุแล้วกลับมาใช้ได้ทันที · **ห้ามลบข้อมูลเด็ดขาด** (กฎเหล็ก `AI_CONTEXT.md` ข้อ 2) · การตัดสินว่า "พอร์ตไหนคือส่วนเกิน" ต้อง **Deterministic**: เรียงตาม `created_at` — **พอร์ตแรกสุด = พอร์ตที่ยังเขียนได้** (migration 044 STEP 4 ใช้กฎเดียวกันนี้เลือกพอร์ต Default) |
| § 8.1 (ข) | Premium มีเพดานจำนวนพอร์ตไหม | **มี — Sanity Cap 50 พอร์ต** (กัน abuse ไม่ใช่ Monetization Cap) |
| § 8.2 | `brokers` per-user หรือ Master List กลาง | **per-user — ผู้ใช้พิมพ์ชื่อเอง + ระบบรวมชื่อคล้ายกันอัตโนมัติ** · Normalize ก่อนเทียบ/จัดกลุ่ม (trim หัวท้าย + ช่องว่างซ้ำ + เทียบแบบ case-insensitive) เพื่อไม่ให้ `Bitkub`/`bitkub`/`Bitkub ` กลายเป็น 3 กลุ่มบนกราฟโดนัท · **แต่ต้องเก็บรูปแบบที่ผู้ใช้พิมพ์ครั้งแรกไว้แสดงผล** (ไม่บังคับเป็นตัวพิมพ์เล็กหมด) · **ไม่ทำ Autocomplete รายชื่อโบรกในรอบนี้** |
| § 8.3 | ถือสินทรัพย์เดียวกันที่ 2 โบรก | **รองรับ** — แต่ดู "สถานะ" ด้านล่าง (งานนี้ยังไม่จบ ติดคำถามที่ต้องตัดสินเพิ่ม) |
| § 8.4 | Stock Dividend (ปันผลเป็นหุ้น) | **เลื่อนไปรอบหน้า** — ไม่ทำในรอบนี้ เพื่อไม่ให้ Migration ที่เสี่ยงที่สุดบวมเกินจำเป็น · จะเป็น type ที่ 5 (`stock_dividend`) ที่เพิ่ม `heldQty` แต่ไม่เพิ่ม `costBasis` |
| § 8.5 | Dividend เป็น Free หรือ Premium | **Free** — ไม่ Gate ด้วย Premium (เป็นการบันทึกธุรกรรมพื้นฐาน) |

**หมายเหตุการตัดสินใจเชิงเทคนิคที่ตามมา (AI ตัดสินเองได้เพราะมี Pattern เดิมรองรับ):**

- **Sector ไม่ใช้ "Title Case" ตามที่ Design Doc § 3.2 เสนอ** — Title Case จะทำ
  `SET50` → `Set50` และ `REIT` → `Reit` ซึ่งผิดรูปคำย่อ · ยึด Pattern เดียวกับ
  มติ § 8.2 เรื่องโบรกแทน: เก็บรูปแบบที่ผู้ใช้พิมพ์ + จัดกลุ่มแบบ case-insensitive
  ด้วย `lower(sector)`
- **พอร์ตที่ Backfill สร้างให้ใช้ `type = 'custom'` ไม่ใช่ `'mixed'`** — `'mixed'`
  ที่ Design Doc § 3.3 เขียนไว้ **ไม่อยู่ใน CHECK ของ `portfolios.type`** จะทำให้
  Backfill ERROR ทั้งก้อน (ดู CHANGELOG Stage 3)

---

## [Day 1] - 1 กรกฎาคม 2569

### Added

**เอกสาร `docs/` เขียนเสร็จ 15/16 ไฟล์** (เหลือ API.md ตั้งใจปล่อยว่าง
รอ Phase 0):

| ไฟล์ | สรุปเนื้อหา |
|---|---|
| [README.md](./README.md) | ภาพรวมโปรเจค เป้าหมาย กลุ่มเป้าหมาย และ Tech Stack |
| [AI_CONTEXT.md](./AI_CONTEXT.md) | บริบทสำคัญที่สุดสำหรับ AI ทุกตัวที่ร่วมพัฒนา รวมกฎเหล็กที่ห้ามละเมิด |
| [PRD.md](./PRD.md) | ฟีเจอร์ทั้งหมดแยกตาม Package (Free/Premium/Premium+) และ Phase |
| [ENV_VARIABLES.md](./ENV_VARIABLES.md) | รายการ Environment Variables ทั้งหมดที่ระบบต้องใช้ พร้อมข้อควรระวัง |
| [ROADMAP.md](./ROADMAP.md) | แผนพัฒนา Phase 0–4 พร้อมเกณฑ์ผ่านแต่ละ Phase และงบประมาณโดยประมาณ |
| [DATABASE.md](./DATABASE.md) | Database Schema เต็มรูปแบบ 12 Table พร้อม RLS Policy ทุกตาราง |
| [SRS.md](./SRS.md) | Flow การทำงานทางเทคนิคของทุกระบบหลัก (LINE Bot, Web, Payment, Cron, Error Handling) |
| [SECURITY.md](./SECURITY.md) | นโยบายความปลอดภัยภาพรวม: Auth, RLS, Rate Limiting, Webhook Validation, Encryption, PDPA, Monitoring |
| [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md) | คู่มือปฏิบัติการจริง: Backup Schedule, Restore Procedure, Migration Plan, Disaster Recovery, RTO/RPO |
| [UI_UX.md](./UI_UX.md) | Design System, Wireframe หน้าหลัก, Flex Message Templates, Responsive/Accessibility |
| [CODING_STANDARD.md](./CODING_STANDARD.md) | Naming Convention, Folder Structure, Git Commit/Branch, Code Review Checklist, Comment Style |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | ขั้นตอน Deploy Local → Staging → Production บน Railway, Migration/Rollback/Domain+SSL |
| [TEST_PLAN.md](./TEST_PLAN.md) | Test Strategy และ Test Case หลักของทุกฟีเจอร์ รวม Security Testing |
| [MARKETING.md](./MARKETING.md) | กลยุทธ์หา Beta User, Positioning, Conversion Funnel, Referral, Success Metrics |
| CHANGELOG.md | ไฟล์นี้เอง — บันทึกความเปลี่ยนแปลงของโปรเจค |

**อื่นๆ**

- เชื่อมต่อและ Push GitHub Repository สำเร็จ
- สร้างโครงสร้างโฟลเดอร์โปรเจค (`admin`, `assets`, `backend`, `docs`,
  `frontend`, `line-bot`) เตรียมไว้รอเริ่มเขียนโค้ดจริงใน Phase 0
- กำหนด Project Positioning, Development Philosophy และ Team Structure
  ใน [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)

### Decided

- **เปิดตัวด้วย 2 แพ็กเกจ (Free + Premium) ก่อน** — Premium+ จะตามมา
  ทีหลังใน Phase 4 หลังจากทดสอบ AI Features อย่างรอบคอบแล้วเท่านั้น
- **Hero Features ของ Premium+** ที่ตกลงไว้ล่วงหน้า 3 อย่าง: Goal-Based
  DCA Planner หลายเป้าหมาย, AI Financial Journal, Annual Investment
  Report (สไตล์ Spotify Wrapped)
- **นโยบาย Premium หมดอายุ:** Grace Period 7 วัน (ดูข้อมูลได้ปกติ
  บันทึกเพิ่มไม่ได้ ระหว่างนั้น) ก่อนล็อคข้อมูลทั้งหมด (ไม่ใช่ลบ) —
  ต่ออายุแล้ว Unlock ทันที
- **กฎเหล็ก: AI ห้ามแนะนำซื้อขายสินทรัพย์หรือชี้นำการตัดสินใจลงทุนใดๆ
  ทั้งสิ้น** ใช้ภาษาเชิงข้อเท็จจริงเท่านั้น (เช่น "BTC มีสัดส่วน 75%
  ของพอร์ต" ไม่ใช่ "พอร์ตคุณเสี่ยงเกินไป") — กฎนี้ขยายผลไปถึงการ
  สื่อสารการตลาดทั้งหมดด้วย ไม่ใช่แค่ Feature ของ AI
  (ดู MARKETING.md § 7)
- **ห้ามลบข้อมูลผู้ใช้เด็ดขาด** ไม่ว่าจะยกเลิก Premium หรือ Grace
  Period หมดอายุ ยกเว้นกรณีผู้ใช้ร้องขอลบข้อมูลของตนเองอย่างชัดแจ้ง
  ตาม PDPA เท่านั้น (สองกฎนี้ไม่ขัดแย้งกัน — ดู SECURITY.md § 8)
- **เพิ่ม ENV_VARIABLES.md เข้ามานอกแผนเดิม** ตามข้อเสนอแนะจาก GPT
  Review (30 มิถุนายน 2569) เพื่อให้ระบบมีรายการ Environment Variables
  ที่ชัดเจนตั้งแต่ต้น ไม่ต้องรอถึง Phase 0
- **ย้าย BACKUP_AND_RECOVERY.md มาเขียนคู่กับ SECURITY.md** ในสัปดาห์
  เดียวกัน แทนที่จะแยกห่างกันตามแผนเดิม เพราะเป็นเรื่องเกี่ยวข้องกัน
  โดยตรงและควรรู้แผนรับมือก่อนเริ่ม Phase 1 ที่จะมีข้อมูลผู้ใช้จริง
- **ใช้ Conventional Commits + Git Branch Strategy** (`main` /
  `develop` / `feature` / `hotfix`) เป็นมาตรฐานของทีมตั้งแต่ต้น
- **RLS ทุกตาราง, Rate Limiting และ LINE Webhook Signature Validation
  เป็นข้อกำหนดบังคับตั้งแต่ Phase 0.5** ก่อนเริ่มมี User จริงเข้าระบบ
  ไม่ใช่ค่อยเพิ่มทีหลัง

### สถานะปัจจุบัน (ณ วันที่บันทึกนี้เขียน — 1 กรกฎาคม 2569)

- **Phase 0 (เอกสาร docs/):** เสร็จสมบูรณ์ 15/16 ไฟล์ (รวม CHANGELOG.md
  ไฟล์นี้)
- เหลือ **API.md** ที่ตั้งใจปล่อยว่างไว้ก่อนตามแผนเดิม — จะเขียนตอน
  ขั้นตอน API Design จริงใน Phase 0 (ตาม
  [ROADMAP.md § Phase 0](./ROADMAP.md))

### สิ่งที่ต้องทำต่อไป (ณ วันที่บันทึกนี้เขียน)

ตาม [ROADMAP.md § Phase 0](./ROADMAP.md):

- [ ] Database ER Diagram — ทำให้ Schema และ Relationship ใน
      DATABASE.md เป็นทางการ (Diagram จริง ไม่ใช่แค่คำอธิบาย)
- [ ] API Design — ออกแบบ REST API Spec, Versioning `/api/v1`, Request/
      Response Format แล้วเขียนลง API.md
- [ ] Folder Structure — จัดวางโครงสร้างไฟล์จริงใน `backend/`,
      `frontend/`, `line-bot/`, `admin/` ตาม
      [CODING_STANDARD.md § 2](./CODING_STANDARD.md)
- [ ] Review เอกสารทั้งหมดร่วมกับ GPT อีกรอบก่อนเริ่มเขียนโค้ดจริง
      (ตามลำดับที่วางไว้ใน PROJECT_BRIEF.md § 13 สัปดาห์ที่ 4)

---

**หมายเหตุ:** งานทั้งหมดในรายการ "สิ่งที่ต้องทำต่อไป" ข้างต้นเสร็จแล้ว
จริงตั้งแต่ Phase 0 ปิดรอบ — รายการนี้เป็นบันทึกประวัติ ณ เวลานั้น
ไม่ใช่สถานะปัจจุบันของโปรเจค (ดูสถานะปัจจุบันจริงได้ที่
`claude/project-summary.md` ใน Claude Project)

**Version เดิมของไฟล์นี้ก่อนแยก:** 1.0.0 | **บันทึกล่าสุดก่อนแยก:** 1 กรกฎาคม 2569
