# DEPLOYMENT.md — ขั้นตอน Deploy

> เอกสารนี้อธิบาย Deployment Workflow ของ EasyDCA ตั้งแต่ Local จนถึง
> Production ตาม Phase 0 ใน [ROADMAP.md](./ROADMAP.md) (Deployment
> Workflow, CI/CD Pipeline เบื้องต้น) อ้างอิง Environment Variables จาก
> [ENV_VARIABLES.md](./ENV_VARIABLES.md), Schema/Migration จาก
> [DATABASE.md](./DATABASE.md) และแผนกู้คืนจาก
> [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md)

---

## 1. ภาพรวม Environment

| Environment | จุดประสงค์ | Branch | `NODE_ENV` |
|---|---|---|---|
| **Local** | พัฒนาและทดสอบบนเครื่องตัวเอง | `feature/*`, `fix/*` | `development` |
| **Staging** | ทดสอบก่อนขึ้นจริง จำลอง Production | `develop` | `staging` |
| **Production** | ใช้งานจริงโดยผู้ใช้ | `main` | `production` |

### หลักการสำคัญ

- **แยก Supabase Project และ LINE Channel ระหว่าง Staging กับ
  Production** ตั้งแต่ Phase 2 เป็นต้นไป (เมื่อเริ่มมีข้อมูลผู้ใช้จริง)
  เพื่อไม่ให้การทดสอบบน Staging กระทบข้อมูลจริงของผู้ใช้ — ใช้ LINE
  "Developer Trial" Channel แยกสำหรับ Staging (ไม่มีค่าใช้จ่ายเพิ่ม)
- **Phase 0–1** (ยังไม่มี User จริง) ใช้ Supabase Project เดียวและ LINE
  Channel เดียวข้าม Local/Staging ได้ เพื่อประหยัดต้นทุนตามงบประมาณใน
  [ROADMAP.md § งบประมาณ](./ROADMAP.md)
- Deploy เข้า `main` (Production) ต้องผ่านการทดสอบบน Staging มาก่อน
  เสมอ ห้าม Deploy จาก `feature/*` ตรงไป Production

### Flow โดยสรุป

```
[Local]  feature/* ──PR──▶ develop ──Auto Deploy──▶ [Staging]
                                │
                        ทดสอบผ่านครบตาม
                        Pre-deploy Checklist (หัวข้อ 8)
                                │
                                ▼
                    PR: develop → main ──Auto Deploy──▶ [Production]
```

---

## 2. Environment Variables บน Railway

รายการตัวแปรทั้งหมดอยู่ที่ [ENV_VARIABLES.md](./ENV_VARIABLES.md)
หัวข้อนี้สรุปเฉพาะสิ่งที่ต้องระวังตอนตั้งค่าบน Railway

### 2.1 วิธีตั้งค่า

1. เปิด Railway Project → เลือก Service (`backend`, `frontend`, `admin`)
2. ไปที่แท็บ **Variables**
3. เพิ่มตัวแปรทีละตัวตามรายการใน ENV_VARIABLES.md **ห้ามอัพโหลดไฟล์
   `.env` ขึ้น Railway โดยตรง** ให้กรอกผ่านหน้า UI หรือใช้ Railway CLI
   (`railway variables set KEY=VALUE`) เท่านั้น
4. ตัวแปรที่เป็น Secret (`LINE_CHANNEL_SECRET`, `JWT_SECRET`,
   `SUPABASE_SERVICE_ROLE_KEY` ฯลฯ) ตั้งค่าแยกกันคนละค่าระหว่าง Staging
   และ Production เสมอ — **ห้ามใช้ค่าเดียวกันข้าม Environment**
   (ตรงตามข้อกำหนดใน ENV_VARIABLES.md และ SECURITY.md § 1.2)

### 2.2 ตัวแปรที่ต้องเปลี่ยนค่าตาม Environment

| Variable | Local | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `APP_URL` | `http://localhost:3000` | `https://staging.easydca.app` | `https://easydca.app` |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | Channel ทดสอบ | Channel ทดสอบ (Developer Trial) | Channel จริง |
| `LIFF_ID` | LIFF ID ของ Channel ทดสอบ | LIFF ID ของ Channel ทดสอบ | LIFF ID ของ Channel จริง |
| `SUPABASE_URL` / Keys ทั้งหมด | Supabase Project ทดสอบ | Supabase Project แยก (Phase 2+) | Supabase Project จริง |
| `JWT_SECRET` | ค่าสุ่มเฉพาะเครื่อง | ค่าสุ่มเฉพาะ Staging | ค่าสุ่มเฉพาะ Production |

### 2.3 ข้อควรระวัง

- ตรวจสอบให้แน่ใจว่า `SUPABASE_SERVICE_ROLE_KEY` ถูกตั้งเฉพาะ Service
  ฝั่ง Backend เท่านั้น **ห้ามตั้งค่านี้ให้ Service ฝั่ง `frontend`/`admin`**
  ที่ Build เป็น Static/Client Bundle เด็ดขาด (ดู SECURITY.md § 5.3)
- หลังตั้งค่า Environment Variable ใหม่ ต้อง Redeploy Service นั้นเพื่อ
  ให้มีผล (Railway ไม่ Reload ค่าอัตโนมัติแบบ Real-time)

---

## 3. Railway Deployment Steps (ทีละขั้น)

### 3.1 ตั้งค่าครั้งแรก (One-time Setup)

```
[1] สมัคร Railway Account และเชื่อมต่อ GitHub Repository ของ EasyDCA

[2] สร้าง Project ใหม่บน Railway
    - เลือก "Deploy from GitHub Repo"
    - เลือก Repository EasyDCA

[3] สร้าง Service แยกตาม Package ในโครงสร้าง Monorepo
    (ดู CODING_STANDARD.md § 2):
    - Service "backend"  → Root Directory: /backend
    - Service "frontend" → Root Directory: /frontend
    - Service "admin"    → Root Directory: /admin (เริ่มใช้จริง Phase 3)

[4] ตั้งค่า Build/Start Command ต่อ Service
    - backend:  Build: npm install   | Start: npm run start
    - frontend: Build: npm run build | Start: npm run preview (หรือ Serve static ผ่าน CDN/Railway Static)
    - admin:    เหมือน frontend

[5] ตั้งค่า Environment Variables ตามหัวข้อ 2 ให้ครบทุก Service

[6] ตั้งค่า Auto-Deploy ตาม Branch
    - Service ที่ผูกกับ Staging Environment → Auto Deploy จาก branch `develop`
    - Service ที่ผูกกับ Production Environment → Auto Deploy จาก branch `main`
    (ใช้ Railway Environments feature แยก Staging/Production ภายใน
    Project เดียวกัน หรือแยกเป็นคนละ Project ก็ได้ตามความสะดวก)

[7] ตั้งค่า Health Check Path
    - backend: กำหนด Endpoint เช่น GET /health คืนค่า 200 เมื่อ API
      และการเชื่อมต่อ Database ปกติ — Railway ใช้ Endpoint นี้ตรวจสอบ
      ว่า Deploy สำเร็จก่อน Switch Traffic
```

### 3.2 ขั้นตอน Deploy ปกติ (Routine Deploy)

```
[1] Merge PR เข้า develop (Staging) หรือ main (Production)
    ตาม Git Branch Strategy ใน CODING_STANDARD.md § 4

[2] Railway ตรวจพบการเปลี่ยนแปลงบน Branch ที่ผูกไว้ → เริ่ม Build
    อัตโนมัติทันที (Auto-Deploy)

[3] Railway รัน Health Check หลัง Build เสร็จ
    - ผ่าน → Switch Traffic ไปยัง Deployment ใหม่ (Zero-downtime)
    - ไม่ผ่าน → Railway คง Deployment เดิมไว้ ไม่ Switch Traffic
      (ดูหัวข้อ 6 Rollback Plan)

[4] ตรวจสอบ Log หลัง Deploy เสร็จทุกครั้ง (Railway Dashboard → Logs)
    ว่าไม่มี Error ผิดปกติในช่วงแรกที่เริ่มรับ Traffic จริง
```

---

## 4. Database Migration Workflow

Schema ทั้งหมดอ้างอิงจาก [DATABASE.md](./DATABASE.md) การเปลี่ยนแปลง
Schema ทุกครั้งต้องทำผ่าน Migration File ที่เก็บไว้ใน Repository
(เช่น `backend/migrations/`) ไม่แก้ Schema ตรงผ่าน Supabase Dashboard
โดยไม่บันทึกเป็นไฟล์ เพื่อให้ทุก Environment มี Schema ตรงกันและย้อนดู
ประวัติได้

```
[1] เขียน Migration File ใหม่
    - ตั้งชื่อไฟล์แบบเรียงลำดับเวลา เช่น
      20260701_add_portfolios_table.sql
    - รวม RLS Policy ไว้ในไฟล์เดียวกับการสร้าง/แก้ Table เสมอ
      (ตามกฎใน SECURITY.md § 2 — ห้าม Deploy Table ที่ยังไม่มี RLS)

[2] ทดสอบ Migration บน Local ก่อนเสมอ
    - รันกับ Supabase Project ทดสอบในเครื่อง หรือ Local Postgres
      ที่จำลอง Schema เดียวกัน
    - ตรวจสอบว่า Query/Repository Layer ที่มีอยู่ยังทำงานถูกต้อง

[3] Backup ก่อน Migration ทุกครั้ง (ไม่มีข้อยกเว้น)
    - ตามขั้นตอนใน BACKUP_AND_RECOVERY.md § 1.1 (Manual Backup ก่อน
      Deploy/Migration ใหญ่) — รัน pg_dump เก็บสำรองแยกไว้ก่อนรัน
      Migration บน Staging/Production

[4] Apply Migration บน Staging ก่อน
    - รัน Migration ผ่าน Supabase CLI/Migration Tool
    - ตรวจสอบว่า RLS Policy ทำงานถูกต้องด้วย Test Case ใน
      TEST_PLAN.md § 5 (Security Testing)

[5] ตรวจสอบผลลัพธ์บน Staging ให้ครบตาม Pre-deploy Checklist (หัวข้อ 8)
    ก่อนจึง Apply Migration เดียวกันบน Production

[6] Apply Migration บน Production
    - เลือกช่วงเวลาที่ Traffic ต่ำที่สุดเท่าที่ทำได้ (แม้ Phase 0-2
      Traffic จะยังน้อย ก็ควรฝึกวินัยนี้ไว้ตั้งแต่ต้น)
    - Monitor Log ทันทีหลัง Apply เพื่อจับ Error ให้เร็วที่สุด

[7] อัพเดท DATABASE.md ให้ตรงกับ Schema จริงเสมอ
    - ทุก Migration ที่เปลี่ยนโครงสร้างสำคัญต้องสะท้อนกลับไปที่
      DATABASE.md ในการ Commit เดียวกันหรือ Commit ถัดไปทันที
      ไม่ปล่อยให้เอกสารกับ Schema จริงไม่ตรงกัน
```

---

## 5. CI/CD Pipeline เบื้องต้น

ขนาดทีมและ Phase ปัจจุบัน (Phase 0-2, ทีมเล็ก) ยังไม่จำเป็นต้องมี
Pipeline ที่ซับซ้อน เน้นให้เบาแต่ครอบคลุมสิ่งที่จำเป็นที่สุดก่อน

### 5.1 CI (ก่อน Merge)

**Implemented** — `.github/workflows/test.yml` รันอัตโนมัติผ่าน **GitHub
Actions** ทุกครั้งที่ Push หรือเปิด Pull Request เข้า `main` (Repo นี้มีแค่
Branch `main` เท่านั้น ไม่มี `develop`):

```
on:
  push:        branches: [main]
  pull_request: branches: [main]

jobs (รันขนานกัน ไม่รอกัน):
  - backend-test               npm ci + npm test (Jest) ใน backend/
  - frontend-test              npm install + npm test (Vitest) ใน frontend/
                                (npm install ไม่ใช่ npm ci — ดูเหตุผลด้านล่าง)
  - migration-numbering-check  ตรวจชื่อไฟล์ backend/migrations/*.sql
                                ไม่ให้เลขนำหน้าซ้ำ/Zero-padding ไม่เท่ากัน
                                (.github/scripts/check-migration-numbering.js)
```

**สิ่งที่ CI นี้ "ไม่ได้" ทำ** (สำคัญ — อย่าเข้าใจผิดว่า CI เขียว = ปลอดภัย Deploy):
- ไม่ Deploy อะไรทั้งสิ้น — Railway Auto-Deploy (§ 5.2) ทำงานแยกอิสระจาก CI นี้
  โดยสิ้นเชิง Push เข้า `main` จะ Trigger ทั้งคู่พร้อมกัน แต่ไม่ได้รอผลกันและกัน
- ไม่รัน Migration ใดๆ กับ Database จริง (Local หรือ Production) —
  `migration-numbering-check` ตรวจแค่ "ชื่อไฟล์ไม่ชนกัน" (กันเลขซ้ำ) เท่านั้น
  **ไม่ได้** ตรวจว่าเนื้อหา SQL รันได้จริงหรือไม่ เพราะ Migration 001-015
  เป็น Delta ที่พึ่งพา Baseline Schema (`users`/`portfolios`/`assets`/
  `transactions` ฯลฯ + ฟังก์ชัน `update_updated_at()`) ที่ถูกสร้างตรงผ่าน
  Supabase SQL Editor มาก่อน ไม่เคยถูก Capture เป็น Migration File เลย — จึง
  ไม่มีทาง Apply Migration ไล่ตั้งแต่ Migration แรกบน Postgres เปล่าใน CI ได้จริง
  โดยไม่สร้าง Baseline จำลองขึ้นมาเอง (ซึ่งเสี่ยงให้ผลลัพธ์เข้าใจผิดยิ่งกว่าไม่ตรวจเลย
  ถ้า Baseline จำลองนั้นไม่ตรงกับของจริง) ขั้นตอน Manual Apply Migration + Backup
  ก่อนเสมอ (หัวข้อ 4 ด้านบน) จึงยังจำเป็นเหมือนเดิมทุกประการ ไม่มีอะไรเปลี่ยน
- ไม่ทดแทน Manual Migration Review — การตรวจว่า Migration ปลอดภัยจริง (เช่น
  ต้อง Query หา Data ที่ละเมิด Constraint ใหม่ก่อนไหม, Backward Compatible
  หรือไม่) ยังเป็นขั้นตอนที่ต้องทำโดย Human/Claude Review ก่อน Merge เหมือนเดิม
- ไม่มี Lint Step หรือ Build-check Step แยกต่างหาก (ต่างจากแผนเดิมที่เขียนไว้
  ก่อนหน้านี้) — ขอบเขตปัจจุบันคือ Test Suite + Migration Filename Check เท่านั้น
  เพิ่ม Lint/Build Check เป็น Step แยกได้ในอนาคตถ้าต้องการ

**หมายเหตุ `frontend-test` ใช้ `npm install` ไม่ใช่ `npm ci`:**
`frontend/package-lock.json` ไม่ได้ถูก Commit เข้า Repo "โดยตั้งใจ" (ไม่ใช่ปัญหา
ค้างที่รอแก้) — Commit `6ebd4ba` ("Remove package-lock.json from repo to force
Railway to use npm install instead of npm ci") ลบออกไปแล้วเลือกใช้ `npm install`
แทนอย่างถาวร เพราะเคย Regenerate Lockfile บน Windows แล้วขาด Optional Dependency
ของแพลตฟอร์ม Linux (`@esbuild`/`@rollup` Binaries) ทำให้ Railway Build Fail —
Railway Service ฝั่ง Frontend จริงก็ตั้งค่า Build Command เป็น `npm install`
(ไม่ใช่ `npm ci`) มาตั้งแต่ตอนนั้นและทำงานได้ปกติมาตลอด CI จึงจำลองพฤติกรรมเดียวกับ
ที่ Deploy จริงใช้ ไม่ใช่ Bug ที่ต้องแก้

PR จะ Merge ได้ก็ต่อเมื่อ CI ผ่านทั้งหมด **และ** ผ่าน Code Review
Checklist ใน [CODING_STANDARD.md § 5](./CODING_STANDARD.md)

### 5.2 CD (หลัง Merge)

ใช้ **Railway Auto-Deploy** จาก Git Branch โดยตรง (ตามหัวข้อ 3) แทนการ
เขียน Deploy Script เอง — Railway ตรวจ Push เข้า `main` แล้ว
Build+Deploy ให้อัตโนมัติ ถือเป็น CD ของโปรเจคในช่วงนี้

### 5.3 แนวทางขยายในอนาคต (Phase 3+)

เมื่อทีมโตขึ้นและ Production มี Traffic จริงจัง พิจารณาเพิ่ม:
- Automated Smoke Test บน Staging หลัง Deploy เสร็จอัตโนมัติ
- E2E Test Suite รันใน CI ก่อน Merge เข้า `main` (ดู TEST_PLAN.md § 1)
- Notification เข้า LINE Notify เมื่อ CI/CD ล้มเหลว

---

## 6. Rollback Plan

### 6.1 Rollback Application (Railway Deployment)

```
[1] เข้า Railway Dashboard → Service ที่มีปัญหา → แท็บ Deployments
[2] เลือก Deployment ก่อนหน้าที่ทำงานปกติ (Known Good)
[3] กด "Redeploy" บน Deployment นั้น — Railway จะ Switch Traffic
    กลับไปใช้ Build เดิมทันที (เร็วกว่าการแก้โค้ดแล้ว Deploy ใหม่)
[4] แจ้ง Super Admin/Project Owner ทันทีผ่าน LINE Notify
    (Critical Alert ตาม SECURITY.md § 9)
[5] วิเคราะห์สาเหตุที่ Deploy พังก่อนพยายาม Deploy เวอร์ชันใหม่ซ้ำ
```

### 6.2 Rollback Database Migration

```
[1] ถ้า Migration มี Down Script → รัน Down Script ทันที
[2] ถ้าไม่มี Down Script หรือ Rollback ด้วย Script ไม่ปลอดภัย
    (เช่น Migration ที่ลบ Column ข้อมูลจริงไปแล้ว)
    → Restore จาก Backup ที่ทำไว้ก่อน Migration (หัวข้อ 4 ขั้นตอน [3])
    ตามขั้นตอนเต็มใน BACKUP_AND_RECOVERY.md § 3 (Restore Procedure)
[3] สิทธิ์การสั่ง Rollback ระดับ Database ใช้กฎเดียวกับผู้มีสิทธิ์สั่ง
    Restore ใน BACKUP_AND_RECOVERY.md § 3.1 (Super Admin/Developer)
```

### 6.3 หลักการทั่วไป

- **Rollback ก่อน แล้วค่อยสืบสาเหตุทีหลัง** — เมื่อ Production มีปัญหา
  ให้ทำให้ระบบกลับมาใช้งานได้ปกติก่อนเป็นอันดับแรก ไม่เสียเวลา Debug
  บน Production ที่กำลังพัง
- ทุกครั้งที่ Rollback ต้องบันทึกเหตุการณ์ไว้ (Post-mortem สั้นๆ) เพื่อ
  ป้องกันปัญหาเดิมเกิดซ้ำ

---

## 7. Domain + SSL Setup

```
[1] จดทะเบียน Domain (เช่น easydca.app) กับผู้ให้บริการที่เลือกไว้

[2] เพิ่ม Custom Domain ใน Railway
    - Service "frontend" (Production) → Settings → Custom Domain
    - ใส่ Domain หลัก เช่น easydca.app (และ www.easydca.app ถ้าต้องการ)
    - Service "backend" → ใส่ Subdomain แยก เช่น api.easydca.app
    - Staging ใช้ Subdomain แยกชัดเจน เช่น staging.easydca.app

[3] ตั้งค่า DNS ที่ผู้ให้บริการ Domain
    - เพิ่ม CNAME Record ชี้ไปยังค่าที่ Railway ให้มา
    - รอ DNS Propagate (อาจใช้เวลาไม่กี่นาทีถึงไม่กี่ชั่วโมง)

[4] SSL Certificate
    - Railway ออก SSL Certificate ให้อัตโนมัติผ่าน Let's Encrypt
      ทันทีที่ตรวจสอบ Domain สำเร็จ ไม่ต้องตั้งค่าเพิ่มเติมเอง
    - ตรวจสอบว่า Certificate Active แล้วก่อนเปลี่ยนค่า APP_URL

[5] บังคับ HTTPS ทุก Request
    - ตั้งค่า Redirect HTTP → HTTPS ที่ Application Level (Express
      Middleware) เผื่อกรณี Client เข้าผ่าน HTTP โดยตรง

[6] อัพเดท Configuration ที่อ้างอิง Domain เดิม
    - Environment Variable `APP_URL` ให้ตรงกับ Domain ใหม่
    - LINE Developers Console: อัพเดท Webhook URL และ LIFF Endpoint URL
      ให้ชี้มาที่ Domain ใหม่
    - ทดสอบ Webhook Signature Validation อีกครั้งหลังเปลี่ยน Domain
      (ดู SECURITY.md § 4) เพราะ URL เปลี่ยนอาจกระทบการตั้งค่าฝั่ง LINE
```

---

## 8. Pre-deploy Checklist

ก่อน Deploy เข้า Production ทุกครั้ง ต้องผ่านครบทุกข้อ (ต่อยอดจาก Code
Review Checklist ใน [CODING_STANDARD.md § 5](./CODING_STANDARD.md)
ซึ่งต้องผ่านมาแล้วตั้งแต่ขั้นตอน PR):

- [ ] Code Review Checklist ใน CODING_STANDARD.md § 5 ผ่านครบทุกข้อ
- [ ] CI (Lint + Unit Test + Build) ผ่านทั้งหมด
- [ ] ทดสอบ Feature/Fix บน Staging แล้วทำงานถูกต้องตรงตามที่ตั้งใจ
- [ ] Environment Variables บน Production ตั้งค่าครบและถูกต้องตาม
      หัวข้อ 2 (โดยเฉพาะค่าที่เพิ่งเพิ่มใหม่)
- [ ] ถ้ามี Schema Migration: Backup ก่อน Migration เสร็จแล้ว และทดสอบ
      บน Staging ผ่านตามหัวข้อ 4
- [ ] RLS Policy ของ Table ใหม่/ที่แก้ไข ทดสอบแล้วว่าใช้งานได้จริงตาม
      SECURITY.md § 2
- [ ] Rollback Plan พร้อมใช้งาน (รู้ว่าจะ Rollback อย่างไรถ้าพัง ก่อน
      เริ่ม Deploy ไม่ใช่มาคิดตอนพังแล้ว)
- [ ] แจ้งทีมงาน/Admin ล่วงหน้าก่อน Deploy ที่มีความเสี่ยงสูง หรือมี
      Downtime ที่คาดการณ์ได้
- [ ] หลัง Deploy เสร็จ ตรวจสอบ Health Check และ Log อย่างน้อย
      15–30 นาทีแรก เพื่อจับปัญหาให้เร็วที่สุด

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
