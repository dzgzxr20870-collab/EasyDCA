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
| `APP_URL` | ✅ | URL หลักของ Web Application เช่น `https://easydca.app` หรือ `http://localhost:3000` ใช้สำหรับสร้าง Redirect URL |
| `FRONTEND_URL` | ✅ | URL ของ React App (เช่น `https://easydca-production-fcd3.up.railway.app`) ใช้ 2 อย่าง: (1) จำกัด **CORS Origin** และ (2) ประกอบลิงก์เปิด External Browser ในข้อความ LINE (`externalUrl.util.js`) |
| `PUBLIC_BASE_URL` | ❌ | URL สาธารณะของ **Backend ตัวนี้เอง** (เช่น `https://easydca-production.up.railway.app`) — ใช้ประกอบ URL รูป QR PromptPay ที่ LINE ต้อง Fetch ได้จากภายนอก ถ้าไม่ตั้ง จะ Fallback ไป `APP_URL` และถ้าไม่มีทั้งคู่ = `null` (**สร้างการ์ดชำระเงินไม่ได้**) |
| `NODE_ENV` | ✅ | Environment ปัจจุบัน ค่าที่ใช้ได้: `development`, `staging`, `production` |
| `PORT` | ❌ | Port ที่ Server รันอยู่ (Default: `3000`) |

> ### 💡 `PUBLIC_BASE_URL` vs `FRONTEND_URL` — คนละตัว อย่าสลับกัน
>
> สับสนกันได้ง่ายเพราะเป็น URL ทั้งคู่ แต่ชี้คนละ Service:
>
> | | ชี้ไปที่ | ใช้ทำอะไร |
> |---|---|---|
> | `FRONTEND_URL` | **React App** (เว็บที่ผู้ใช้เปิด) | CORS Origin + ปุ่ม/ลิงก์ในข้อความ LINE ที่พาไปหน้าเว็บ |
> | `PUBLIC_BASE_URL` | **Backend API** (Service นี้) | URL รูป QR (`/api/v1/payment/:id/qr.png`) ที่ LINE Server ต้อง Fetch เอง |
>
> ⚠️ ต้องเป็น URL ที่ **เข้าถึงได้จากอินเทอร์เน็ตจริงและเป็น `https`** — LINE Fetch รูป
> จาก Server ของตัวเอง ไม่ได้ Fetch จากเครื่องผู้ใช้ ดังนั้น `localhost` ใช้ไม่ได้
> (ตอน Dev ต้องใช้ ngrok หรือเทียบเท่า) ถ้าตั้งผิด/ไม่ตั้ง ผู้ใช้จะเห็นการ์ด Premium
> แบบ **ไม่มีรูป QR** ทั้งที่ระบบไม่ขึ้น Error

> ### ⚠️ `FRONTEND_URL` — Fail-fast ตั้งแต่ Boot (ไม่มี Fallback แล้ว)
>
> เดิม `src/index.js` Fallback CORS Origin เป็น `'*'` ถ้าไม่ได้ตั้งค่าตัวนี้ (ค่าชั่วคราว
> สมัยยังไม่รู้ URL ของ React App ตอน Deploy ครั้งแรก) — **ถอดออกแล้ว** เพราะถ้า
> Variable หายไปเงียบๆ (สะกดผิด / ลืม Copy ตอนสร้าง Environment ใหม่) ระบบจะเปิดให้
> ทุก Origin เรียก API ได้โดยไม่มีสัญญาณเตือนเลย ตอนนี้ Web Service จะ **Throw
> ตั้งแต่ Boot** แทน (เห็นทันทีใน Deploy Log ไม่ต้องรอให้มีคนมาโจมตี)
>
> ⚠️ **Local Dev:** ต้องเพิ่ม `FRONTEND_URL` ลง `backend/.env` ด้วย มิฉะนั้น
> `npm run dev` จะไม่ Boot (ดู `.env.example`) — ส่วน `npm run worker` (Cron)
> **ไม่ได้รับผลกระทบ** เพราะไม่ได้เปิด HTTP Server จึงไม่ต้องใช้ค่านี้

---

## Frontend (Vite — Build-time)

> ⚠️ Variable ของ Frontend **ต่างจากของ Backend เชิงกลไก**: Vite ฝังค่าลงไปใน
> Bundle **ตอน Build** ไม่ใช่อ่านตอน Runtime → **เปลี่ยนค่าแล้วต้อง Redeploy
> (Rebuild) เสมอ** การแก้ Variable บน Railway เฉยๆ ไม่มีผลกับ Bundle ที่ Build ไปแล้ว
>
> ⚠️ ทุกค่าที่ขึ้นต้น `VITE_` จะ**ปรากฏใน JS ที่ส่งถึงเบราว์เซอร์ผู้ใช้**
> — **ห้ามใส่ Secret/Key ใดๆ เด็ดขาด** (ตั้งที่ Service ของ React App เท่านั้น
> ไม่ใช่ Service `backend`)

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `VITE_API_BASE_URL` | ✅ | URL ของ Backend API ที่ React App จะเรียก (เช่น `https://easydca-production.up.railway.app`) |
| `VITE_ENABLE_MULTIPAGE_APP` | ❌ | Feature Flag ของ **Dashboard แบบแยกหน้า (`/app/*`)** — Stage 9 · ค่าที่รับได้: `true` เท่านั้นที่เปิด · **ค่าอื่นทั้งหมดรวมถึงไม่ตั้งเลย = ปิด** (Fail-closed) · Default: **ปิด** |

> ### `VITE_ENABLE_MULTIPAGE_APP` — เปิด/ปิดแล้วเกิดอะไร
>
> | สถานะ | ผลที่เกิด |
> |---|---|
> | **ปิด (Default)** | Route `/app/*` **ไม่มีอยู่ในแอปเลย** ผู้ใช้ที่พิมพ์ URL ตรงจะตกไปหน้า Login ตามปกติ · `/dashboard` เดิมทำงานเหมือนเดิมทุกประการ |
> | **เปิด (`true`)** | Route `/app/dashboard` `/app/portfolio` `/app/transactions` `/app/dca` `/app/profile` ใช้งานได้ · **`/dashboard` เดิมยังอยู่ครบไม่ถูกแทนที่** (Route คู่ขนาน) |
>
> ⭐ **นี่คือสวิตช์ Rollback** — ถ้าหน้าใหม่มีปัญหาบน Production ให้ปิด Flag แล้ว
> Redeploy พอ **ไม่ต้อง Revert โค้ด** (นี่คือเหตุผลที่ทำเป็น Route คู่ขนานตั้งแต่แรก)
>
> ⚠️ **ตอน Deploy รอบที่มี Stage 9 ครั้งแรก ยังไม่ต้องเปิด** — เปิดหลังเปิดดูหน้าเว็บ
> ด้วยตาบน Production แล้วเท่านั้น (ดู `DEPLOYMENT.md`)
>
> **ตั้งที่ไหน:** Railway → Service ของ **React App** (ไม่ใช่ `backend` / `easydca-worker`)
> → Variables → เพิ่ม `VITE_ENABLE_MULTIPAGE_APP=true` → Redeploy

---

## Premium / Payment

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `PROMPTPAY_ID` | ❌ | เบอร์พร้อมเพย์/เลขบัตรที่รับเงิน (ไม่ตั้ง = สร้าง QR ไม่ได้) |
| `ADMIN_LINE_USER_IDS` | ❌ | `line_user_id` ของ Admin ที่อนุมัติ Payment ได้ (คั่นด้วย `,`) |
| `PREMIUM_PRICE_MONTHLY` | ❌ | ราคารายเดือน (Default: `59`) |
| `PREMIUM_PRICE_YEARLY` | ❌ | ราคารายปี (Default: `590`) |
| `PREMIUM_FREE_TRIAL_ENABLED` | ❌ | **แคมเปญชั่วคราว** — เปิดให้ผู้ใช้กดรับ Premium ฟรี 1 เดือนเองได้ (ครั้งเดียวตลอดชีพต่อบัญชี) ค่าที่เปิดคือ `true` **ตรงๆ เท่านั้น** (Default: ปิด) |
| `FACEBOOK_LIKE_GRANT_ENABLED` | ❌ | **แคมเปญชั่วคราว** — เปิดให้ผู้ใช้ขอ Premium ฟรี 1 เดือนแลกกับการกด Like Facebook Page (ส่ง Screenshot → Admin ตรวจมือ → อนุมัติ) ค่าที่เปิดคือ `true` **ตรงๆ เท่านั้น** (Default: ปิด) |

> ### ⚠️ `PREMIUM_FREE_TRIAL_ENABLED` — Fail-closed โดยเจตนา
>
> ต้องเป็นสตริง `true` เป๊ะๆ ถึงจะเปิด — ไม่ตั้งค่า / สะกดผิด / ค่าว่าง = **ปิด**
> เพราะแคมเปญแจกของฟรีที่ "เปิดค้างเพราะพิมพ์ผิด" กระทบรายได้ทางเดียว จึงยอมให้
> พลาดไปทาง "ปิด" ดีกว่า "เปิด"
>
> **วิธีปิดแคมเปญบน Production:** Railway → Variables → ตั้ง
> `PREMIUM_FREE_TRIAL_ENABLED=false` → Service Restart อัตโนมัติ (~1-2 นาที)
> **ไม่ต้อง `git push` / ไม่ต้อง Build ใหม่** — ผู้ใช้ที่รับสิทธิ์ไปแล้วยังคงใช้
> Premium จนครบกำหนดตามปกติ (ปิดแคมเปญ = ปิดการ "กดรับใหม่" เท่านั้น)
>
> ผลกระทบต่อ `/admin/stats`: **ไม่กระทบ `totalRevenue`/`revenueThisMonth`**
> (Free Trial ไม่สร้างแถวใน `payments`) แต่ `premiumUsers` จะเพิ่มตามจริง —
> ระหว่างแคมเปญ ตัวเลข Premium ≠ จำนวนลูกค้าที่จ่ายเงิน

> ### ⚠️ `FACEBOOK_LIKE_GRANT_ENABLED` — Fail-closed เหมือนกันทุกประการ
>
> ต้องเป็นสตริง `true` เป๊ะๆ ถึงจะเปิด — ไม่ตั้งค่า / สะกดผิด / ค่าว่าง = **ปิด**
> (เหตุผลเดียวกับ `PREMIUM_FREE_TRIAL_ENABLED` ด้านบน)
>
> **Flag แยกจากกันโดยเจตนา** — เป็นคนละแคมเปญที่เปิด/ปิดคนละเวลากันได้ (เช่นปิด
> Facebook Like แต่เปิด Free Trial ธรรมดาไว้) ถ้าใช้ Flag เดียวกันจะบังคับให้ทั้งสอง
> แคมเปญมีชะตากรรมเดียวกันตลอดไป
>
> **กันได้ฟรี 2 เดือน:** ผู้ใช้ 1 คนรับได้แค่แคมเปญเดียวเท่านั้น — `facebookLikeGrant`
> เช็ค `users.free_trial_claimed_at` และ `freeTrial` เช็ค `premium_grant_logs` ที่
> แคมเปญนี้เขียนลงไป (Guard ทำงานทั้งสองทิศ) แม้เปิด Flag ทั้งคู่พร้อมกันก็ตาม
>
> **วิธีปิดแคมเปญบน Production:** Railway → Variables → ตั้ง
> `FACEBOOK_LIKE_GRANT_ENABLED=false` (ไม่ต้อง `git push` / ไม่ต้อง Build ใหม่) —
> ผู้ใช้ที่ได้รับอนุมัติไปแล้วยังใช้ Premium จนครบกำหนดตามปกติ ส่วนคำขอที่ยังค้าง
> `pending` อยู่จะ **อนุมัติไม่ได้อีก** (`approveRequest` เช็ค Flag ซ้ำตอน Admin กด)
> ควรเคลียร์คำขอค้างให้หมดก่อนปิด Flag
>
> ผลกระทบต่อ `/admin/stats`: **ไม่กระทบ `totalRevenue`/`revenueThisMonth`**
> (ไม่สร้างแถวใน `payments`) แต่ `premiumUsers` เพิ่มตามจริง — เหมือน Free Trial

---

## Market Data (หุ้นสหรัฐ)

| Variable | จำเป็น | คำอธิบาย |
|---|---|---|
| `TWELVE_DATA_API_KEY` | ❌ | API Key ของ [Twelve Data](https://twelvedata.com) Free Tier สำหรับดึงราคาหุ้นสหรัฐ (`stock_us`) และอัตราแลกเปลี่ยน USD/THB เพื่อแปลงราคาเป็นบาท ถ้าไม่ตั้งค่า ราคาหุ้นสหรัฐจะคืน `null` (ระบบไม่ Crash) |
| `TWELVE_DATA_RATE_LIMIT` | ❌ | โควตา Rate Limiter ของ Twelve Data (Credit/นาที) สำหรับ **Process นี้เท่านั้น** (Default: `8`) |

> ### ⚠️ `TWELVE_DATA_RATE_LIMIT` — ต้องตั้งแยกราย Service รวมกันไม่เกิน 8
>
> Twelve Data Free Tier จำกัด **8 Credit/นาทีต่อ API Key** (ไม่ใช่ต่อ Process) แต่
> Rate Limiter ของระบบนี้เป็น In-memory ผูกกับ Process เดียว — ระบบรัน 2 Service
> ที่ใช้ Key เดียวกัน (`EasyDCA` = API, `easydca-worker` = Cron) ถ้าไม่ตั้ง Variable
> นี้ ทั้งสองฝั่งจะ Default เป็น 8 เท่ากัน รวมกันยิงได้ถึง 16/นาที เกิน Budget จริง
>
> **ตั้งค่าจริงบน Railway (บังคับ ก่อนเปิดสาธารณะ):**
> - `EasyDCA` (Web API — Live Path) → `TWELVE_DATA_RATE_LIMIT=3`
> - `easydca-worker` (Cron) → `TWELVE_DATA_RATE_LIMIT=5`
>
> Worker ได้โควตามากกว่าเพราะเป็นฝั่งที่เคย Burst จริง (Cron `portfolioSnapshot`
> เที่ยงคืนยิงหลาย Symbol รัวๆ) ส่วน Live มี Cache 60 วินาที + Request Coalescing
> คุมอยู่แล้วจึงไม่ค่อยยิงพร้อมกันหลาย Symbol ในเวลาเดียวกัน — ตัวเลขนี้ปรับได้ตาม
> Traffic จริง ตราบใดที่ผลรวมสองฝั่งไม่เกิน 8 เสมอ
>
> ไม่ตั้งค่า = Default `8` ทั้งสองฝั่ง (ปลอดภัยสำหรับ Local Dev ที่รันแค่ Process
> เดียว แต่ **ไม่ปลอดภัยถ้าลืมตั้งบน Production ทั้งสอง Service**)

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
| `BACKUP_ENCRYPTION_KEY` | ✅** | Key สำหรับเข้ารหัสไฟล์ Backup แบบ Client-side (AES-256-GCM) ก่อนอัปโหลดขึ้น R2 — **Hex 64 ตัวอักษรเป๊ะ** (32 Bytes) เว้นวรรค/ขึ้นบรรทัดใหม่หน้า-หลังถูกตัดทิ้งให้อัตโนมัติ |

\* ทั้ง 4 ตัวต้องตั้งค่าครบพร้อมกันถึงจะเริ่ม Backup ได้จริง (Job เช็ค `isConfigured()`
ก่อนทุกครั้ง) — `DATABASE_URL` (ในหมวด Supabase ด้านบน) ก็ต้องมีค่าด้วยเช่นกัน
เพราะเป็น Connection String ที่ `pg_dump` ใช้เชื่อมต่อจริง

\*\* `BACKUP_ENCRYPTION_KEY` **บังคับ** สำหรับ Service `easydca-worker`: ถ้าไม่ตั้ง
(หรือ Format ผิด) Job จะข้ามรอบนั้นทั้งรอบพร้อม Push แจ้ง Admin — **ไม่มี Fallback
ไปอัปโหลดไฟล์ที่ไม่เข้ารหัสเด็ดขาด** เพราะไฟล์ Backup มีข้อมูลส่วนบุคคลของผู้ใช้อยู่
ข้างใน (Validate ตั้งแต่ก่อนเรียก `pg_dump` เพื่อไม่ให้ Dump ทั้งก้อนเสียเปล่า)

### สร้าง `BACKUP_ENCRYPTION_KEY`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ### ⚠️ อ่านก่อนตั้งค่า — Key นี้หาย = กู้ Backup ไม่ได้ตลอดกาล
>
> ไฟล์ที่เข้ารหัสด้วย AES-256 แล้ว **ไม่มีทางถอดได้เลยถ้าไม่มี Key** (Brute-force
> ไม่ใช่ทางเลือกที่ทำได้จริงในทางปฏิบัติ) ไม่มี Backdoor ไม่มีวิธีกู้ ไม่มีใคร
> ช่วยได้ รวมถึง Cloudflare — ดังนั้น:
>
> 1. **เก็บ Key ทันทีที่ Generate เสร็จ** ก่อนวางลง Railway ด้วยซ้ำ (อย่ารัน
>    คำสั่งแล้วปิด Terminal ทิ้งโดยยังไม่ได้ Copy ไปเก็บ)
> 2. **สำรองไว้อย่างน้อย 2 ที่ที่แยกจากกันจริง** เช่น Railway Variables +
>    Password Manager ส่วนตัว (1Password/Bitwarden ฯลฯ) — "ที่แยกจากกัน" หมายถึง
>    ถ้าที่หนึ่งหายไปทั้งหมด อีกที่ยังอยู่ ไม่ใช่เก็บ 2 ที่ในบัญชีเดียวกัน
> 3. **ห้าม Commit ค่าจริงลง Repo เด็ดขาด** — ใน `.env.example` มีแค่ Placeholder
> 4. **ห้ามเปลี่ยน (Rotate) Key เองโดยไม่วางแผน** — Backup เก่าที่เข้ารหัสด้วย
>    Key เดิมจะกู้ไม่ได้ทันทีถ้าไม่เก็บ Key เดิมไว้ด้วย ถ้าจำเป็นต้องเปลี่ยนจริง
>    ต้องเก็บ Key เดิมไว้จนกว่า Backup ยุคเก่าจะถูก Purge ครบตาม
>    `BACKUP_RETENTION_DAYS` (Default 14 วัน) ดู
>    [BACKUP_AND_RECOVERY.md § 2.3](./BACKUP_AND_RECOVERY.md)

⚠️ **ต้องมี Binary `pg_dump` เวอร์ชัน 17 บน Railway ด้วย (ไม่ใช่แค่ "มี pg_dump"
เฉยๆ)** — ทั้ง Service `backend` และ `easydca-worker` ใช้ `backend/railpack.json`
ร่วมกัน (Root Directory เดียวกัน) โดย Step "build" ถูกขยายด้วย `"..."` (Array
Extending — เก็บคำสั่ง Auto-detect ของ Node Provider เดิมไว้ ไม่ Override ทับ)
เพื่อดาวน์โหลด `postgresql-client-17` จาก **PGDG** (PostgreSQL Official Apt
Repository) แล้ว Copy `pg_dump` + Shared Library ที่จำเป็นทั้งหมดไปไว้ที่
`/app/vendor-pg17/`

**ทำไมต้อง Vendor เองแทนใช้ `postgresql-client` ธรรมดาจาก Debian:** Supabase
Project จริงรัน **PostgreSQL 17.6** แต่ apt Package `postgresql-client` ของ
Debian bookworm (Base Image ที่ Railway ใช้) ให้เวอร์ชัน **15** เป็น Default
เท่านั้น และ `pg_dump` ปฏิเสธ Dump จาก Server ที่ Major Version สูงกว่าตัวเอง
เสมอ (`aborting because of server version mismatch`) — ทำให้ Backup ใช้งาน
ไม่ได้เลยแม้แต่คืนเดียวจนกว่าจะแก้จุดนี้ ดูขั้นตอน Build เต็มใน
[DEPLOYMENT.md § 3.1 ข้อ [8]](./DEPLOYMENT.md) และเหตุผล/ผลกระทบเต็มใน
[BACKUP_AND_RECOVERY.md § 2.2](./BACKUP_AND_RECOVERY.md)

`backend/src/utils/pgDump.util.js` เรียก `/app/vendor-pg17/pg_dump` ตรงๆ
(ไม่ใช่ `pg_dump` เฉยๆ ที่ PATH ของระบบจะไปเจอ Binary v15 แทน) พร้อมตั้ง
`LD_LIBRARY_PATH=/app/vendor-pg17` เสมอ — ตรวจสอบหลัง Deploy ทุกครั้งด้วย
`railway ssh --service easydca-worker` แล้วรัน
`LD_LIBRARY_PATH=/app/vendor-pg17 /app/vendor-pg17/pg_dump --version` ต้องได้
เลข 17.x และ `node --version` ต้องยังทำงานได้ปกติทั้งคู่ ก่อนเชื่อว่า Deploy
สำเร็จจริง (เคยพบว่าการตั้งค่า `deploy.inputs` เองใน `railpack.json` ทำให้
Node Runtime หายไปทั้ง Deploy Image — ดู Comment เต็มในไฟล์จริง)

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

# ===== Frontend (Vite — ตั้งที่ Service ของ React App เท่านั้น) =====
# ⚠️ ค่าที่ขึ้นต้น VITE_ ถูกฝังลง Bundle ตอน Build และผู้ใช้เห็นได้ — ห้ามใส่ Secret
# VITE_API_BASE_URL=https://easydca-production.up.railway.app
# VITE_ENABLE_MULTIPAGE_APP=true   # Feature Flag /app/* (Stage 9) — ไม่ตั้ง = ปิด

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
# ⚠️ Key หาย = กู้ Backup เก่าไม่ได้ตลอดกาล — สำรองไว้ 2 ที่แยกกันเสมอ (ดูหัวข้อด้านบน)
# BACKUP_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
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
