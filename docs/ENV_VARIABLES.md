# ENV_VARIABLES.md — Environment Variables

> รายการ Environment Variables ทั้งหมดที่ระบบ EasyDCA ต้องใช้
> ห้าม Commit ค่าจริงลง Git เด็ดขาด ใช้ไฟล์ `.env` ที่อยู่ใน `.gitignore`

---

## วิธีใช้งาน

1. Copy ไฟล์ `.env.example` เป็น `.env`
2. กรอกค่าจริงในไฟล์ `.env`
3. ห้าม Commit ไฟล์ `.env` ลง Git เด็ดขาด

```bash
cp .env.example .env
```

---

## LINE

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `LINE_CHANNEL_SECRET` | ✅ | Channel Secret สำหรับตรวจสอบ Webhook Signature ป้องกันคำขอปลอม ได้จาก LINE Developers Console |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | Token สำหรับส่งข้อความกลับไปยังผู้ใช้ผ่าน LINE Messaging API ได้จาก LINE Developers Console |
| `LINE_NOTIFY_TOKEN` | ❌ | ⚠️ **LINE Notify ปิดบริการแล้ว ขอ Token ใหม่ไม่ได้** — ตัวแปรนี้เหลือไว้เผื่อ Legacy Config เท่านั้น ไม่ถูกใช้จริง ช่องทางแจ้งเตือน Admin ปัจจุบันคือ LINE Push ผ่าน `ADMIN_LINE_USER_IDS` ด้านล่าง (ดู [SECURITY.md § 9.4](./SECURITY.md) และ Infra ก่อน Beta — /health + Error Alert) |
| `LIFF_ID` | ✅ | ID ของ LIFF App สำหรับ Login ด้วย LINE Account บน Web Dashboard |
| `ADMIN_LINE_USER_IDS` | ❌ | `line_user_id` ของ Admin ที่รับ LINE Push แจ้งเตือน คั่นด้วย `,` ถ้าหลายคน — Reuse ตัวเดียวกันทั้งแจ้งคำขอชำระเงินเข้าใหม่ (payment.service) และ Critical Alert (`/health` ล่ม, Backup ล้มเหลว — healthAlert.service) ถ้าไม่ตั้งค่า จะไม่มีใครได้รับแจ้งเตือนเลย (Log ไว้เฉยๆ ไม่ Crash) |

---

## Supabase

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `SUPABASE_URL` | ✅ | URL ของ Supabase Project เช่น `https://xxxx.supabase.co` ได้จาก Supabase Dashboard → Project Settings → API |
| `SUPABASE_ANON_KEY` | ✅ | Public API Key สำหรับ Client-side queries ผ่าน RLS ได้จาก Supabase Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Secret Key สำหรับ Server-side operations ที่ต้องการ Bypass RLS ใช้เฉพาะใน Backend เท่านั้น **ห้าม Expose ฝั่ง Client** |
| `DATABASE_URL` | ✅ | PostgreSQL Connection String เต็มรูปแบบ เช่น `postgresql://user:password@host:5432/db` ใช้สำหรับ Database Migrations |

---

## Authentication

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `JWT_SECRET` | ✅ | Secret Key สำหรับ Sign และ Verify JWT Token ต้องเป็น String ที่ยาวและสุ่มขึ้นมา ความยาวขั้นต่ำ 32 ตัวอักษร |
| `JWT_EXPIRES_IN` | ❌ | อายุของ JWT Token เช่น `7d`, `24h` (Default: `24h` — ย่นจาก `7d` เดิมก่อน Beta Launch เพื่อจำกัด Blast Radius ถ้า Token หลุด ดู [SECURITY.md § 1.2](./SECURITY.md)) |

---

## Application

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `APP_URL` | ✅ | URL หลักของ Web Application เช่น `https://easydca.app` หรือ `http://localhost:3000` ใช้สำหรับสร้าง Redirect URL และ CORS |
| `NODE_ENV` | ✅ | Environment ปัจจุบัน ค่าที่ใช้ได้: `development`, `staging`, `production` |
| `PORT` | ❌ | Port ที่ Server รันอยู่ (Default: `3000`) |

---

## Market Data (หุ้นสหรัฐ)

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `TWELVE_DATA_API_KEY` | ❌ | API Key ของ [Twelve Data](https://twelvedata.com) Free Tier สำหรับดึงราคาหุ้นสหรัฐ (`stock_us`) และอัตราแลกเปลี่ยน USD/THB เพื่อแปลงราคาเป็นบาท ถ้าไม่ตั้งค่า ราคาหุ้นสหรัฐจะคืน `null` (ระบบไม่ Crash) |

---

## Claude API (Phase 4)

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `CLAUDE_API_KEY` | Phase 4 | API Key สำหรับเรียก Claude API เพื่ออ่านรูปสลิป ยังไม่ต้องใช้จนถึง Phase 4 |

---

## Nightly Backup (Cloudflare R2)

ใช้โดย `backend/src/jobs/dbBackup.job.js` (รันบน Service `easydca-worker` เท่านั้น
ตี 3 ทุกคืน Asia/Bangkok) — ถ้าไม่ตั้งค่าครบ Job จะข้ามรอบนั้นแล้ว Push แจ้ง Admin
ผ่าน `ADMIN_LINE_USER_IDS` แทนที่จะ Crash Worker Process

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `R2_ACCOUNT_ID` | ❌* | Cloudflare Account ID — Cloudflare Dashboard → R2 → Overview (ใช้ประกอบ Endpoint URL) |
| `R2_ACCESS_KEY_ID` | ❌* | Access Key ID — สร้างที่ R2 → Manage API Tokens → Create API Token (ให้สิทธิ์ Object Read & Write เฉพาะ Bucket ที่ใช้เก็บ Backup) |
| `R2_SECRET_ACCESS_KEY` | ❌* | Secret Access Key คู่กับ Access Key ID ด้านบน (แสดงครั้งเดียวตอนสร้าง Token — เก็บไว้ทันที) |
| `R2_BUCKET_NAME` | ❌* | ชื่อ Bucket ที่สร้างไว้เก็บ Backup โดยเฉพาะ (แนะนำแยก Bucket จากการใช้งานอื่น) |
| `BACKUP_RETENTION_DAYS` | ❌ | จำนวนวันเก็บ Backup ย้อนหลังก่อนลบทิ้งอัตโนมัติ (Default: `14`) |

\* ทั้ง 4 ตัวต้องตั้งค่าครบพร้อมกันถึงจะเริ่ม Backup ได้จริง (Job เช็ค `isConfigured()`
ก่อนทุกครั้ง) — `DATABASE_URL` (ในหมวด Supabase ด้านบน) ก็ต้องมีค่าด้วยเช่นกัน
เพราะเป็น Connection String ที่ `pg_dump` ใช้เชื่อมต่อจริง

⚠️ **ต้องมี Binary `pg_dump` บน Railway ด้วย** — ทั้ง Service `backend` และ
`easydca-worker` ใช้ `backend/nixpacks.toml` ร่วมกัน (Root Directory เดียวกัน)
ประกาศ `nixPkgs = ["...", "postgresql"]` เพื่อ **Extend** Package ที่ Nixpacks
Node.js Provider Detect เองอยู่แล้ว (`nodejs`/`yarn` ฯลฯ) ไม่ใช่ Override ทับ —
`"..."` เป็นส่วนบังคับ (ยืนยันจาก [Nixpacks Docs](https://nixpacks.com/docs/configuration/file));
ถ้าลืม `"..."` Build จะพังทั้ง 2 Service เพราะขาด `nodejs` ไม่ใช่แค่ Backup ใช้
ไม่ได้ — Syntax ตรวจสอบกับเอกสารทางการแล้ว แต่ยังไม่เคย Deploy จริงบน Railway
ให้เห็นผลลัพธ์ปลายทาง (Build สำเร็จ + `pg_dump` เรียกได้จริง) ต้องตรวจสอบ Log
Build + Worker หลัง Deploy รอบแรกที่มีการตั้งค่าตัวแปรครบ

---

## ตัวอย่างไฟล์ `.env.example`

```env
# ===== LINE =====
LINE_CHANNEL_SECRET=your_line_channel_secret_here
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token_here
# LINE_NOTIFY_TOKEN — ปิดบริการแล้ว ไม่ต้องตั้งค่า (ดูตารางด้านบน)
LIFF_ID=your_liff_id_here
# ADMIN_LINE_USER_IDS — line_user_id ของ Admin คั่นด้วย ',' (แจ้งคำขอชำระเงิน + Critical Alert)
ADMIN_LINE_USER_IDS=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ===== Supabase =====
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres

# ===== Authentication =====
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters
JWT_EXPIRES_IN=24h

# ===== Application =====
APP_URL=http://localhost:3000
NODE_ENV=development
PORT=3000

# ===== Market Data (หุ้นสหรัฐ) =====
# TWELVE_DATA_API_KEY=your_twelve_data_api_key_here

# ===== Claude API (Phase 4 only) =====
# CLAUDE_API_KEY=your_claude_api_key_here

# ===== Nightly Backup (Cloudflare R2) — easydca-worker Service เท่านั้น =====
# R2_ACCOUNT_ID=your_cloudflare_account_id_here
# R2_ACCESS_KEY_ID=your_r2_access_key_id_here
# R2_SECRET_ACCESS_KEY=your_r2_secret_access_key_here
# R2_BUCKET_NAME=easydca-db-backups
# BACKUP_RETENTION_DAYS=14
```

---

## ข้อควรระวัง

- **ห้าม Commit** ไฟล์ `.env` ลง Git เด็ดขาด
- ตรวจสอบว่า `.env` อยู่ใน `.gitignore` แล้วก่อน `git add`
- `SUPABASE_SERVICE_ROLE_KEY` มีสิทธิ์ Bypass RLS ทั้งหมด ใช้เฉพาะใน Backend Server เท่านั้น
- `JWT_SECRET` ต้องไม่ซ้ำกันระหว่าง `development`, `staging`, `production`
- ใน Production ใช้ Railway Environment Variables แทนไฟล์ `.env`

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
