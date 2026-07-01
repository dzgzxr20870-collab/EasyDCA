# CODING_STANDARD.md — มาตรฐานโค้ด

> เอกสารนี้กำหนดมาตรฐานการเขียนโค้ด โครงสร้างโฟลเดอร์ และ Git Workflow
> ของ EasyDCA ให้ทุกคน (และ AI ทุกตัวที่ช่วยเขียนโค้ด) เขียนโค้ดไปในทาง
> เดียวกัน อ้างอิง Tech Stack จาก [PROJECT_BRIEF.md § 4](../PROJECT_BRIEF.md)
> และ Schema จาก [DATABASE.md](./DATABASE.md)

---

## 1. Naming Convention

### 1.1 Database (Supabase / PostgreSQL)

ยึดตามที่ใช้จริงใน [DATABASE.md](./DATABASE.md) ทุกประการ — ห้ามตั้งชื่อ
Table/Column ใหม่ที่ขัดกับรูปแบบนี้:

| ประเภท | Convention | ตัวอย่างจาก DATABASE.md |
|---|---|---|
| ชื่อ Table | `snake_case`, พหูพจน์ | `users`, `portfolios`, `transactions`, `portfolio_snapshots` |
| ชื่อ Column | `snake_case` | `line_user_id`, `display_name`, `plan_expires_at` |
| Primary Key | ชื่อ `id` เสมอ, type `UUID` | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| Foreign Key | `<table_ชื่อเอกพจน์>_id` | `user_id`, `asset_id`, `portfolio_id` |
| Boolean Column | ขึ้นต้นด้วย `is_` | `is_locked`, `is_active`, `is_default`, `is_achieved` |
| Timestamp Column | ลงท้ายด้วย `_at` | `created_at`, `updated_at`, `sent_at`, `approved_at` |
| Enum-like Column (CHECK constraint) | ค่าเป็น `snake_case` ตัวพิมพ์เล็ก | `'free' / 'premium' / 'premium_plus'`, `'buy' / 'sell'` |
| Index | `idx_<table>_<column>` | `idx_transactions_user_id` |

### 1.2 Backend Code (Node.js / JavaScript)

| ประเภท | Convention | ตัวอย่าง |
|---|---|---|
| ตัวแปร / ฟังก์ชัน | `camelCase` | `calculatePortfolioValue()`, `userId`, `currentPrice` |
| ฟังก์ชันที่ Return Boolean | ขึ้นต้น `is` / `has` / `should` | `isPremiumActive()`, `hasReachedAssetLimit()` |
| Class (เช่น Custom Error) | `PascalCase` | `class PaymentValidationError extends Error` |
| Constant ที่ตายตัว (ไม่เปลี่ยนตลอด Runtime) | `UPPER_SNAKE_CASE` | `const MAX_FREE_ASSETS = 2;` |
| Error Code (ตรงกับ SRS.md § 6.3) | `UPPER_SNAKE_CASE` | `PREMIUM_REQUIRED`, `INVALID_SIGNATURE`, `ASSET_LIMIT_REACHED` |
| ชื่อไฟล์ Backend ทั่วไป | `kebab-case` + Suffix ตามหน้าที่ | `portfolio.service.js`, `transactions.controller.js`, `line-webhook.middleware.js` |
| ชื่อไฟล์ React Component | `PascalCase` | `Dashboard.jsx`, `AssetDetailCard.jsx` |
| ชื่อไฟล์ React Hook | `camelCase` ขึ้นต้น `use` | `usePortfolio.js`, `useAuth.js` |

### 1.3 API Request/Response (JSON)

**Key ใน JSON Body ทุก Endpoint ใช้ `camelCase` เสมอ** แม้ Database จะ
เป็น `snake_case` — การแปลงระหว่างสองรูปแบบนี้เกิดขึ้นที่ชั้น
Service/Repository เท่านั้น (จุดเดียว) ไม่ปล่อยให้ `snake_case` หลุดออก
ไปถึง Response หรือ `camelCase` หลุดเข้าไปใน Query ตรงๆ

```js
// ตัวอย่างจุดแปลงข้อมูล (Repository Layer)
function toApiTransaction(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    amountThb: row.amount_thb,
    pricePerUnit: row.price_per_unit,
    createdAt: row.created_at,
  };
}
```

### 1.4 Environment Variables

`UPPER_SNAKE_CASE` เสมอ ตามที่กำหนดไว้แล้วใน
[ENV_VARIABLES.md](./ENV_VARIABLES.md) เช่น `LINE_CHANNEL_SECRET`,
`JWT_SECRET`

---

## 2. Folder Structure (Monorepo)

โครงสร้างโฟลเดอร์หลักที่สร้างไว้แล้วในเครื่อง (`admin`, `assets`,
`backend`, `docs`, `frontend`, `line-bot`) แต่ละโฟลเดอร์คือหนึ่ง
Package/App ที่แยก `package.json` ของตัวเอง

```
EasyDCA/
├── backend/                 ← API Server (Node.js + Express) — Deploy บน Railway
│   ├── src/
│   │   ├── routes/          ← กำหนด Endpoint ต่อ Resource: auth.routes.js, portfolio.routes.js, ...
│   │   ├── controllers/     ← รับ Request, เรียก Service, ส่ง Response
│   │   ├── services/        ← Business Logic (คำนวณพอร์ต, ตรวจ Freemium Limit ฯลฯ)
│   │   ├── repositories/    ← Query เข้า Supabase ต่อ Table + แปลง snake_case ↔ camelCase
│   │   ├── middleware/      ← auth (JWT), rateLimit, validateLineSignature, errorHandler
│   │   ├── jobs/            ← Cron Jobs: dailySnapshot, dcaReminder, expiryCheck, weeklySummary
│   │   ├── utils/           ← Helper ทั่วไป: formatCurrency, dateUtils
│   │   └── config/          ← โหลดและ Validate Environment Variables
│   └── tests/
│
├── line-bot/                 ← Package เฉพาะ Logic ของ LINE — Backend import ไปใช้ที่ Webhook Route
│   ├── commands/             ← Command Parser: ซื้อ/ขาย/พอต/กำไร/ประวัติ/ยกเลิก
│   ├── flex/                 ← Flex Message Templates (ดู UI_UX.md § 3)
│   ├── richmenu/             ← Rich Menu Config
│   └── client.js             ← Wrapper เรียก LINE Messaging API
│
├── frontend/                  ← Web Dashboard (React + Chart.js) — Landing Page, Dashboard,
│   │                             Asset Detail, Payment, Demo Dashboard
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/          ← เรียก Backend API (Axios/Fetch wrapper)
│   │   └── styles/
│   └── public/
│
├── admin/                       ← Admin Dashboard (Phase 3) — แยก App จาก frontend
│   └── src/                      ← โครงสร้างเดียวกับ frontend (pages/components/hooks/services)
│
├── assets/                       ← Asset กลางที่ใช้ร่วมกันหลาย App (Logo, Icon, ภาพตัวอย่าง)
│
└── docs/                          ← เอกสารทั้งหมด (ไฟล์นี้อยู่ที่นี่)
```

**หมายเหตุ:** ตาม Architecture ใน [SRS.md § 1](./SRS.md) มี API Server
ตัวเดียวที่รับ Request ทั้งหมดรวมถึง Webhook — `line-bot/` จึงเป็น
Package Logic ที่ `backend/` Import มาใช้ ไม่ใช่ Service ที่ Deploy แยก
ต่างหาก หากในอนาคตจำเป็นต้องแชร์โค้ด (เช่น Error Code, Type/Constant)
ระหว่าง `backend`/`frontend`/`admin` มากขึ้น ให้พิจารณาเพิ่มโฟลเดอร์
`packages/shared` และแจ้ง Project Owner ก่อนปรับโครงสร้าง

---

## 3. Git Commit Message Format

ใช้รูปแบบ [Conventional Commits](https://www.conventionalcommits.org/)
เพื่อให้ประวัติ Commit อ่านง่ายและ Generate Changelog ได้ในอนาคต:

```
<type>(<scope>): <คำอธิบายสั้นๆ>

[รายละเอียดเพิ่มเติม (ถ้าจำเป็น)]
```

### Type ที่ใช้

| Type | ใช้เมื่อ |
|---|---|
| `feat` | เพิ่มฟีเจอร์ใหม่ |
| `fix` | แก้ Bug |
| `docs` | แก้ไขเอกสารใน `docs/` เท่านั้น |
| `refactor` | ปรับโครงสร้างโค้ดโดยไม่เปลี่ยน Behavior |
| `test` | เพิ่ม/แก้ Test |
| `chore` | งานเบื้องหลังที่ไม่กระทบ Feature (อัพเดท Dependency, ปรับ Config) |
| `perf` | ปรับปรุงประสิทธิภาพ |
| `style` | ปรับ Format โค้ด (ไม่กระทบ Logic เช่น Lint/Prettier) |

### Scope

ระบุ Package ที่แก้ไข: `backend`, `frontend`, `admin`, `line-bot`, `docs`

### ตัวอย่าง

```
feat(line-bot): เพิ่ม Command Parser สำหรับคำสั่ง "ซื้อ" และ "ขาย"

fix(backend): แก้ไขการคำนวณ ROI ผิดพลาดกรณีมีแต่ Sell Transaction

docs(docs): เพิ่ม SECURITY.md และ BACKUP_AND_RECOVERY.md

refactor(frontend): แยก Dashboard Chart ออกเป็น Component ย่อย
```

**หมายเหตุ:** เขียนคำอธิบายเป็นภาษาไทยหรืออังกฤษก็ได้ แต่ `type` ต้อง
เป็นคำมาตรฐานภาษาอังกฤษตามตารางข้างบนเท่านั้น เพื่อให้ Grep/Filter
ประวัติ Commit ได้ง่าย

---

## 4. Git Branch Strategy

```
main       ← Production จริง (Protected — ห้าม Push ตรง ต้องผ่าน PR)
develop    ← Integration Branch สำหรับรวมงานก่อนขึ้น Production
feature/*  ← Branch ฟีเจอร์ใหม่ แตกจาก develop
fix/*      ← Branch แก้ Bug ที่ไม่เร่งด่วน แตกจาก develop
hotfix/*   ← Branch แก้ Bug ด่วนบน Production แตกจาก main โดยตรง
```

### หลักการ

| Branch | แตกจาก | Merge กลับไปที่ | ใช้เมื่อ |
|---|---|---|---|
| `feature/<ชื่องาน>` | `develop` | `develop` | พัฒนาฟีเจอร์ใหม่ตาม Phase ใน ROADMAP.md |
| `fix/<ชื่องาน>` | `develop` | `develop` | แก้ Bug ที่พบระหว่างพัฒนา ยังไม่ขึ้น Production |
| `hotfix/<ชื่องาน>` | `main` | `main` **และ** `develop` | Bug วิกฤตบน Production ที่รอ Release รอบถัดไปไม่ได้ |
| `release/<version>` (Optional) | `develop` | `main` + `develop` | เตรียม Release เมื่อ `develop` เสถียรพร้อมขึ้น Production |

### ตัวอย่างชื่อ Branch

```
feature/phase1-line-command-parser
feature/phase2-portfolio-dashboard
fix/portfolio-roi-calculation
hotfix/webhook-signature-bypass
```

### กฎสำคัญ

- `main` ต้อง Deploy ได้จริงเสมอ (Deployable at all times)
- ทุกการ Merge เข้า `main`/`develop` ต้องผ่าน Pull Request มี Code
  Review อย่างน้อย 1 คนก่อน Merge (ดู Checklist หัวข้อ 5)
- Branch ที่ Merge แล้วให้ลบทิ้งทันที ไม่ปล่อยค้างไว้

---

## 5. Code Review Checklist ก่อน Merge

ก่อน Approve Pull Request ทุกครั้ง ต้องตรวจสอบครบทุกข้อ:

- [ ] **RLS** — ถ้ามี Table ใหม่หรือ Column ใหม่ที่กระทบสิทธิ์การเข้าถึง
      ต้องมี RLS Policy มาพร้อมกันใน Migration เดียวกัน (ดู
      [SECURITY.md § 2](./SECURITY.md))
- [ ] **ไม่มี Secret หลุด** — ไม่มี API Key/Token/Password Hardcode ใน
      โค้ด ทุกค่าที่ Sensitive ต้องมาจาก Environment Variable
- [ ] **กฎ AI ห้ามแนะนำซื้อขาย** — ถ้าโค้ดเกี่ยวข้องกับข้อความ/ผลลัพธ์ที่
      ส่งให้ผู้ใช้ ตรวจสอบว่าไม่มีคำแนะนำซื้อ/ขาย หรือชี้นำการลงทุน
      (ดู [AI_CONTEXT.md](./AI_CONTEXT.md))
- [ ] **Error Handling ตรงตามมาตรฐาน** — ใช้ Error Code และ Response
      Format ตาม [SRS.md § 6](./SRS.md) ไม่ Throw Error แบบไม่มี
      Code/Message ที่ Client จัดการได้
- [ ] **Rate Limiting** — Endpoint ใหม่ที่มีความเสี่ยงถูก Abuse ต้องมี
      Rate Limit ตาม [SECURITY.md § 3](./SECURITY.md)
- [ ] **Naming Convention** — ตรงตามหัวข้อ 1 ของเอกสารนี้ทั้ง
      Database/Backend/API
- [ ] **ไม่มีข้อมูลถูกลบจริงโดยไม่ตั้งใจ** — ตรวจสอบว่าไม่มี Hard Delete
      Query ที่กระทบข้อมูลผู้ใช้ นอกเหนือจาก Flow PDPA ที่อนุมัติแล้ว
      (ดู [SECURITY.md § 8](./SECURITY.md))
- [ ] **ไม่มี Debug Code หลงเหลือ** — ไม่มี `console.log`, Commented-out
      Code หรือ TODO ที่ไม่มี Context ค้างอยู่
- [ ] **Test ผ่านทั้งหมด** — Test ที่เกี่ยวข้องรันผ่าน (อ้างอิงแผนทดสอบ
      ที่ [TEST_PLAN.md](./TEST_PLAN.md) เมื่อเขียนเสร็จ)
- [ ] **Migration ปลอดภัย** — ถ้ามี Schema Migration ตรวจสอบว่า Backup
      ก่อน Migration ตาม [BACKUP_AND_RECOVERY.md § 4](./BACKUP_AND_RECOVERY.md)
      และ Migration Rollback ได้
- [ ] **ตรงกับ Phase ปัจจุบัน** — ฟีเจอร์นี้อยู่ใน Phase ที่ควรทำแล้วจริง
      ตาม [ROADMAP.md](./ROADMAP.md) ไม่ใช่การรีบทำฟีเจอร์ Phase หลัง
      ก่อนเวลา

---

## 6. Definition of Done (DoD)

งานหนึ่งชิ้น (Feature/Fix) จะถือว่า **"เสร็จ" (Done)** ก็ต่อเมื่อผ่านครบ
ทุกข้อต่อไปนี้ — ใช้คู่กับ Code Review Checklist ในหัวข้อ 5 ด้านบน (DoD
คือเกณฑ์ระดับภาพรวมของงานทั้งชิ้น ส่วน Checklist หัวข้อ 5 คือรายการย่อย
ที่ต้องตรวจตอน Review PR)

- [ ] **Code Complete** — Implement ครบตาม Spec ที่ระบุใน
      [PRD.md](./PRD.md) และ [ROADMAP.md](./ROADMAP.md) สำหรับ Phase นั้น
      จริง ไม่ใช่แค่ "รันได้" หรือ Cover เฉพาะ Happy Path
- [ ] **ESLint ผ่าน** — ไม่มี Error/Warning ค้าง ตาม Lint Job ที่ตั้งไว้ใน
      CI ([DEPLOYMENT.md § 5.1](./DEPLOYMENT.md))
- [ ] **Test ผ่าน** — Unit/Integration Test ที่เกี่ยวข้องผ่านทั้งหมด
      ตาม [TEST_PLAN.md](./TEST_PLAN.md) — ถ้าเป็น Feature ใหม่ที่ยังไม่มี
      Test Case ใน TEST_PLAN.md ต้องเพิ่ม Test Case ใหม่ในเอกสารนั้นก่อน
      Merge (ไม่ใช่เขียน Test ลอยๆ ที่ไม่ถูกบันทึกไว้ให้คนอื่นเห็นภาพรวม)
- [ ] **Documentation Update** — ถ้างานนี้กระทบ Schema/API/Flow ที่เอกสาร
      ใน `docs/` มีอยู่แล้ว ต้องอัพเดทไฟล์ที่เกี่ยวข้องในการ Commit เดียวกัน
      หรือ Commit ถัดไปทันที ใช้กฎเดียวกับ
      [DEPLOYMENT.md § 4 ขั้นตอน [7]](./DEPLOYMENT.md) ที่บังคับอัพเดท
      DATABASE.md ให้ตรงกับ Schema จริงเสมอ — ห้ามปล่อยให้เอกสารกับโค้ด
      ไม่ตรงกัน
- [ ] **Code Review ผ่าน** — ผ่าน Code Review Checklist ในหัวข้อ 5 ครบทุก
      ข้อ โดยมีคนอื่น (หรือ AI อีกตัว) Review อย่างน้อย 1 ครั้งก่อน Merge
      ตาม Git Branch Strategy ในหัวข้อ 4
- [ ] **Merge สำเร็จ** — Merge เข้า Branch เป้าหมาย (`develop`/`main`)
      สำเร็จจริง ตาม Git Branch Strategy ในหัวข้อ 4

**ความสัมพันธ์กับ Pre-deploy Checklist:** DoD ข้างต้นคือเกณฑ์ระดับ
**งานแต่ละชิ้น** (ต่อ PR หนึ่งใบ) ส่วน
[Pre-deploy Checklist ใน DEPLOYMENT.md § 8](./DEPLOYMENT.md) คือเกณฑ์ระดับ
**การ Deploy ขึ้น Production** ซึ่งอาจรวมหลายงานที่ผ่าน DoD มาแล้วพร้อมกัน
— งานที่ยังไม่ผ่าน DoD ครบทุกข้อ **ห้าม Merge เข้า `develop`/`main`**
และแน่นอนว่าห้ามอยู่ใน Release ที่จะผ่าน Pre-deploy Checklist ไปด้วย

---

## 7. Comment Style และเมื่อไหร่ควร Comment

### หลักการ

**Default คือไม่ Comment** — ตั้งชื่อตัวแปร/ฟังก์ชันให้สื่อความหมายใน
ตัวเองตามหัวข้อ 1 แทนการเขียนอธิบายด้วย Comment ถ้าลบ Comment ออกแล้ว
โค้ดยังอ่านเข้าใจได้ปกติ แปลว่า Comment นั้นไม่จำเป็น

### เมื่อไหร่ควร Comment

เขียน Comment เฉพาะกรณีที่ **เหตุผล (WHY)** ไม่ชัดเจนจากโค้ดเพียงอย่าง
เดียว:

- **กฎ Business ที่ไม่ตรงไปตรงมา** เช่น ทำไม Grace Period ถึงนับ 7 วัน
  หรือทำไม Concentration Alert ถึงต้องใช้ถ้อยคำเชิงข้อเท็จจริงเท่านั้น
  (อ้างอิงกฎจาก AI_CONTEXT.md)
- **Workaround สำหรับพฤติกรรมพิเศษของ External API** เช่น ทำไมต้องอ่าน
  Raw Body ก่อน Parse JSON ตอนตรวจสอบ LINE Signature (ดู
  [SECURITY.md § 4](./SECURITY.md))
- **จุดที่เกี่ยวข้องกับกฎหมาย/Compliance** เช่น โค้ดจุดที่บังคับใช้กฎ
  "ห้าม Hard Delete" หรือ Flow ลบข้อมูลตาม PDPA ควร Comment สั้นๆ ชี้ไปที่
  เอกสารอ้างอิง (`// ดู SECURITY.md § 8 — ต้องยืนยันตัวตนก่อนเสมอ`)
- **ตัวเลข/Threshold ที่ดูเหมือนสุ่มแต่จริงๆ มีที่มา** เช่น
  `const MAX_FREE_ASSETS = 2; // ตาม PRD.md § 4.2 Free Plan`

### ข้อห้าม

- ห้าม Comment อธิบาย **อะไร (WHAT)** ที่โค้ดทำอยู่แล้วซ้ำอีกครั้ง เช่น
  `// เพิ่ม 1 เข้าไปใน count` เหนือ `count += 1;`
- ห้าม Comment อ้างอิงถึง Task/Issue ปัจจุบัน (เช่น "แก้ตามที่ขอในแชท")
  เพราะ Context นั้นจะหายไปเมื่อเวลาผ่านไป ให้ใส่ไว้ใน Commit
  Message/PR Description แทน
- ห้าม Comment โค้ดเก่าทิ้งไว้ (Commented-out Code) — ถ้าไม่ใช้แล้วให้ลบ
  ทิ้ง Git History เก็บให้อยู่แล้ว

---

**Version:** 1.1.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
