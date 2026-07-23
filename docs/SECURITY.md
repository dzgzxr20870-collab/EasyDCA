# SECURITY.md — Security Policy

> เอกสารนี้คือนโยบายความปลอดภัยภาพรวมของ EasyDCA ตาม Phase 0.5
> (Security & Compliance) ใน [ROADMAP.md](./ROADMAP.md) และ Checklist
> ข้อ 11 ใน [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)
>
> เอกสารนี้เป็น "นโยบายภาพรวม" ส่วนขั้นตอนปฏิบัติการจริงเวลาเกิดเหตุ
> (Backup/Restore/Disaster Recovery) อยู่ที่
> [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md)

---

## 1. Authentication และ Authorization

### 1.1 User Authentication (LINE Login + JWT)

ผู้ใช้ทั่วไป Login ด้วย LINE Account ผ่าน LIFF เท่านั้น ไม่มีระบบ
Password แยกต่างหาก รายละเอียด Flow เต็มดูได้ที่
[SRS.md § 3.1](./SRS.md)

สรุปหลักการ:

1. Client เรียก `liff.login()` แล้วได้ LINE Access Token
2. Backend ตรวจสอบ Token กับ LINE Profile API (`GET /v2/profile`)
   เพื่อยืนยันว่า Token มาจาก LINE จริง — **ห้าม Trust ข้อมูลที่ Client ส่งมาตรงๆ**
3. Backend สร้าง/อัพเดท `users` record แล้วออก JWT ของตัวเอง
   (Payload: `userId`, `lineUserId`, `plan`, `exp`)
4. Client เก็บ JWT ไว้ใน Memory เท่านั้น **ห้ามเก็บใน localStorage**
   (ป้องกัน XSS ขโมย Token) และแนบ `Authorization: Bearer <JWT>` ทุก Request

### 1.2 JWT Policy

| หัวข้อ | ค่า |
|---|---|
| Signing Secret | `JWT_SECRET` (ดู [ENV_VARIABLES.md](./ENV_VARIABLES.md)) ยาวขั้นต่ำ 32 ตัวอักษร ต่างกันทุก Environment |
| Algorithm | HS256 |
| Default Expiry | `JWT_EXPIRES_IN` (Default `24h` — ดู "เหตุผลที่ย่นอายุ Token" ด้านล่าง) |
| การ Verify | ทุก Request ที่ต้องการ Auth ต้อง Verify signature + `exp` ก่อนเสมอ (Middleware) |
| การ Revoke | เนื่องจากเป็น Stateless JWT การ Revoke ก่อนหมดอายุทำไม่ได้โดยตรง — ถ้าต้อง Force Logout (เช่น พบบัญชีถูกโจมตี) ให้เปลี่ยน `JWT_SECRET` เฉพาะกรณีฉุกเฉิน (จะ Logout ทุกคนพร้อมกัน) หรือเก็บ Token Blacklist สั้นๆ ใน Cache สำหรับกรณีเฉพาะราย |

**เหตุผลที่ย่นอายุ Token จาก `7d` เป็น `24h` (ก่อน Beta Launch):** ไม่มีกลไก Refresh
Token ในระบบตอนนี้ (Stateless JWT ล้วน) — อายุยิ่งยาว Blast Radius ยิ่งกว้างถ้า Token
หลุด/ถูกขโมย (เช่นผ่าน XSS หรืออุปกรณ์ที่ถูกขโมย) เลือก `24h` เพราะ Re-authentication ของ
LIFF (`liffAuth.service.js`) เป็น Handshake ที่ "แทบไม่มีผลกระทบต่อผู้ใช้" ในกรณีทั่วไป:
Frontend (`frontend/src/lib/api.js`) เจอ 401 → ล้าง Token แล้ว Redirect ไปหน้า Login
ทันที ซึ่ง `Login.jsx` เรียก `liff.isLoggedIn()` แล้วขอ LIFF Access Token ใหม่ + แลกเป็น
JWT ของระบบให้อัตโนมัติ โดยผู้ใช้ไม่ต้องกดอะไรเพิ่ม ตราบใดที่ยัง Login LINE ค้างอยู่ (กรณี
ปกติเกือบทั้งหมดเมื่อเปิดผ่าน LINE App) — จึงเลือกค่าที่นานพอสำหรับ Session การใช้งาน
รายวันทั่วไป แต่สั้นพอที่จะจำกัดความเสียหายถ้า Token หลุด ยังไม่ได้สร้างระบบ Refresh Token
(ต้องออกแบบ Storage/Rotation/Revocation แยกต่างหาก — Scope ใหญ่กว่านี้ พิจารณาเป็นงาน
ถัดไปถ้าพบว่า `24h` สั้นเกินไปในทางปฏิบัติจริง)

⚠️ **หมายเหตุความคลาดเคลื่อนที่พบระหว่างตรวจสอบ (S6):** § 1.1 ข้อ 4 ด้านบนระบุว่า Client
ต้องเก็บ JWT ไว้ใน Memory เท่านั้น ห้ามเก็บ `localStorage` — แต่ Implementation จริงใน
`frontend/src/lib/api.js` และ `frontend/src/pages/Login.jsx` เก็บ JWT ไว้ใน
`localStorage` (`easydca_token`) ซึ่งขัดกับนโยบายที่เขียนไว้ (เสี่ยงต่อ XSS มากกว่า Memory
ตามที่ § 1.1 อธิบายไว้) การแก้ไขส่วนนี้อยู่นอก Scope ของงาน S6 (เปลี่ยนแค่อายุ Token ไม่ใช่
วิธีเก็บ) จึงพบแล้วบันทึกไว้ตรงนี้ ไม่ได้แก้ไข Frontend — ควรพิจารณาเป็นงานถัดไป

### 1.3 Admin Authentication (Phase 3)

Admin Dashboard เข้าได้เฉพาะทีมงานเท่านั้น **แยกช่องทาง Login จากผู้ใช้ทั่วไป**
ไม่ใช้ LINE Login เพราะ Admin ต้องการการควบคุมที่รัดกุมกว่า (เช่น บังคับ MFA)
รายละเอียด Schema ของ Admin Account จะออกแบบให้ชัดเจนใน Phase 3 แต่หลักการที่
ตกลงไว้ล่วงหน้า:

- ใช้ Email + Password ผ่าน Supabase Auth (Password Hash ด้วย bcrypt โดย Supabase เอง ไม่เก็บ Plaintext)
- แนะนำเปิด MFA (TOTP) สำหรับ Role `Super Admin` และ `Admin` เป็นอย่างน้อย
- Role ที่รองรับ: `Super Admin`, `Admin`, `Developer`, `Support`, `Finance`
  (รายละเอียดสิทธิ์แต่ละ Role ดูที่ [ROADMAP.md § Phase 3](./ROADMAP.md))
- ทุก Action ของ Admin ต้องถูกบันทึกลง `audit_logs` (ดู [DATABASE.md](./DATABASE.md))

### 1.4 Authorization (Role-based Access Control)

| ระดับ | กลไกบังคับใช้ |
|---|---|
| User เข้าถึงข้อมูลตัวเอง | Row Level Security (RLS) บน Supabase — ดูหัวข้อ 2 |
| User เข้าถึงฟีเจอร์ตาม Plan (Free/Premium/Premium+) | Middleware ตรวจสอบ `user.plan` และ `plan_expires_at` ทุก Request ก่อนเข้าฟีเจอร์ Premium (`SRS.md § 3.3`) — คืน error `PREMIUM_REQUIRED` หรือ `PLAN_EXPIRED` |
| Admin เข้าถึง Admin Dashboard ตาม Role | Middleware ตรวจสอบ Role จาก Admin Account ทุก Request บน `/api/v1/admin/*` |
| Service ↔ Service (Backend ↔ Supabase) | ใช้ `SUPABASE_SERVICE_ROLE_KEY` เฉพาะฝั่ง Backend เท่านั้น ห้าม Expose สู่ Client เด็ดขาด |

**หลักการสำคัญ:** ตรวจสอบสิทธิ์ทั้งที่ชั้น API (Middleware) และชั้น Database
(RLS) เสมอ — Defense in Depth ห้ามพึ่งพาแค่ชั้นใดชั้นหนึ่ง

---

## 2. Row Level Security (RLS)

รายละเอียด Policy เต็มของทุกตารางอยู่ที่
[DATABASE.md § 3 Row Level Security](./DATABASE.md) เอกสารนี้สรุปเฉพาะหลักการ

### หลักการ 3 Role

| Role | สิทธิ์ |
|---|---|
| `anon` | ไม่มีสิทธิ์เข้าถึง Table ใดเลย |
| `authenticated` (user) | เข้าถึงได้เฉพาะ row ที่ `user_id = auth.uid()` ของตัวเอง |
| `service_role` (backend) | Bypass RLS ทั้งหมด ใช้เฉพาะ Server-side สำหรับงานที่ User ทำเองไม่ได้ (เช่น Cron Job, Admin Approve Payment) |

### กฎที่ต้องยึดเสมอ

- **ทุก Table ต้องเปิด RLS ตั้งแต่สร้าง** ห้าม Deploy Table ใดที่ยังไม่มี Policy
- `audit_logs` และ `system_logs` **ไม่มี Policy สำหรับ `authenticated`
  เลย** — เข้าถึงได้เฉพาะ `service_role` (Backend/Admin API) เท่านั้น
  เพื่อป้องกันผู้ใช้ทั่วไปเห็น Log หรือ Audit Trail ของระบบ
- Table ที่มีการ INSERT โดยระบบเท่านั้น (เช่น `notifications`,
  `portfolio_snapshots`) ต้องจำกัด Policy INSERT ให้ `service_role`
  เท่านั้น ผู้ใช้ SELECT ได้อย่างเดียว
- ทุกครั้งที่เพิ่ม Table ใหม่ ต้องเขียน RLS Policy คู่กันในการ Migration
  เดียวกัน ไม่ผ่านการ Review ถ้ายังไม่มี RLS

---

## 3. Rate Limiting

รายละเอียด Limit ของแต่ละ Endpoint อยู่ที่
[SRS.md § 7 Rate Limiting](./SRS.md) สรุปหลักการ:

| Endpoint | Limit |
|---|---|
| `POST /api/v1/auth/line` | 10 req / นาที / IP |
| `GET /api/v1/portfolio/*` | 60 req / นาที / user |
| `POST /api/v1/transactions` | 30 req / นาที / user |
| `POST /api/v1/payments/upload-slip` | 5 req / 10 นาที / user |
| `POST /api/v1/admin/*` | 120 req / นาที / admin |
| LINE Webhook | ไม่จำกัดฝั่ง App (LINE ควบคุมเอง) แต่ต้องผ่าน Signature Validation ก่อนประมวลผลเสมอ (ดูหัวข้อ 4) |

- เมื่อเกิน Limit → ตอบกลับ `429 Too Many Requests` พร้อม `Retry-After` header
- Rate Limit นับแยกตาม User/IP เพื่อป้องกันทั้ง Spam จากภายนอกและ
  การใช้งานผิดปกติจากบัญชีเดียว
- Endpoint ที่มีความเสี่ยงสูง (`upload-slip`) ตั้ง Limit เข้มกว่า Endpoint
  ทั่วไป เพื่อลดความเสี่ยงจาก Fraud/Spam สลิป

---

## 4. LINE Webhook Signature Validation

ทุก Request ที่อ้างว่ามาจาก LINE Platform ต้องผ่านการตรวจสอบ Signature
ก่อนถูกประมวลผลเสมอ ไม่มีข้อยกเว้น รายละเอียด Flow เต็มอยู่ที่
[SRS.md § 2.1](./SRS.md)

### ขั้นตอนตรวจสอบ

1. อ่าน Header `x-line-signature` จาก Request
2. คำนวณ HMAC-SHA256 ของ **Raw Request Body** (ต้องเป็น Body ดิบก่อน
   ผ่าน JSON Parser — ถ้า Parse ก่อนแล้วค่อยคำนวณ Hash จะได้ค่าไม่ตรงกัน)
   โดยใช้ `LINE_CHANNEL_SECRET` เป็น Key
3. เปรียบเทียบผลลัพธ์กับค่าใน Header ด้วย **Constant-time Comparison**
   (เช่น `crypto.timingSafeEqual` ใน Node.js) เพื่อป้องกัน Timing Attack
   — ห้ามใช้ `===` เปรียบเทียบ String ตรงๆ
4. ถ้าไม่ตรงกัน → คืน `401 Unauthorized` ทันที ไม่ประมวลผล Event ใดๆ
   และบันทึก `system_log` (`type=warning`, `source=webhook`)
5. ถ้าตรงกัน → ดำเนินการ Parse Event ต่อ

### ข้อควรระวัง

- ต้อง Config Middleware ให้เก็บ Raw Body ไว้สำหรับ Route Webhook
  โดยเฉพาะ (แยกจาก JSON Parser ทั่วไปที่ใช้กับ Route อื่น)
- `LINE_CHANNEL_SECRET` ต้องไม่ Log ออกมาที่ไหนทั้งสิ้น รวมถึง Error Log

---

## 5. Data Encryption

### 5.1 Encryption in Transit

- บังคับ HTTPS ทุกช่องทาง: Web Dashboard (Railway), Webhook Endpoint,
  Supabase API/Storage, การเรียก LINE API — ไม่มี Endpoint ใด Serve ผ่าน
  HTTP ธรรมดา
- ใช้ HSTS Header บน Web Dashboard เพื่อบังคับ Browser ใช้ HTTPS เสมอ

### 5.2 Encryption at Rest

- Database (Supabase/PostgreSQL) เข้ารหัสข้อมูล at Rest โดย Supabase
  เป็นค่าเริ่มต้นอยู่แล้ว (Managed Service)
- รูปสลิปการชำระเงินเก็บใน Supabase Storage ซึ่งเข้ารหัส at Rest เช่นกัน
  และเข้าถึงได้เฉพาะผ่าน Signed URL / Policy ที่จำกัดสิทธิ์ ไม่ Public
  โดย Default

### 5.3 Secrets Management

- Secret ทั้งหมด (`JWT_SECRET`, `LINE_CHANNEL_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY` ฯลฯ) เก็บเป็น Environment Variable เท่านั้น
  ห้าม Hardcode ในโค้ดหรือ Commit ลง Git เด็ดขาด — รายละเอียดเต็มดูที่
  [ENV_VARIABLES.md](./ENV_VARIABLES.md)
- Production ใช้ Railway Environment Variables แทนไฟล์ `.env`
- `SUPABASE_SERVICE_ROLE_KEY` ใช้เฉพาะ Backend Server เท่านั้น เพราะ
  Bypass RLS ทั้งหมด — ถ้าหลุดไปฝั่ง Client เท่ากับข้อมูลผู้ใช้ทุกคนเปิด
  เผยทันที ต้องตรวจสอบทุกครั้งก่อน Deploy ว่าไม่มี Key นี้อยู่ใน Bundle
  ฝั่ง Frontend

### 5.4 Sensitive Data ระดับ Application

| ข้อมูล | การป้องกัน |
|---|---|
| LINE User ID / Profile | เก็บใน Database ที่มี RLS คุ้มครอง ไม่แสดงต่อ User อื่น |
| รูปสลิปการชำระเงิน | เก็บใน Storage แบบ Private + Policy จำกัดสิทธิ์ |
| Admin Password | Hash ด้วย bcrypt ผ่าน Supabase Auth ไม่เก็บ Plaintext |
| JWT | เก็บฝั่ง Client ใน Memory เท่านั้น ไม่เก็บ localStorage/Cookie ที่ไม่มี HttpOnly |

---

## 6. Privacy Policy (สรุปสาระสำคัญ)

> เอกสารฉบับเต็มสำหรับผู้ใช้ (Public-facing) จะจัดทำและ Publish ก่อนเปิด
> รับผู้ใช้จริง (Phase 0.5 Checklist) เนื้อหาด้านล่างคือสาระสำคัญที่ต้อง
> ครอบคลุมในเอกสารนั้น

1. **ข้อมูลที่จัดเก็บ** — LINE Profile (User ID, ชื่อที่แสดง, รูปโปรไฟล์),
   ประวัติธุรกรรมการลงทุน, รูปสลิปการชำระเงิน, เป้าหมายการลงทุน,
   การตั้งค่าผู้ใช้, Log การใช้งานที่จำเป็นสำหรับ Debug
2. **วัตถุประสงค์การใช้ข้อมูล** — คำนวณและแสดงผลพอร์ตลงทุน, ส่งแจ้งเตือน
   ผ่าน LINE, ตรวจสอบและอนุมัติการชำระเงิน, ปรับปรุงคุณภาพบริการ
3. **การแชร์ข้อมูลกับบุคคลที่สาม** — ไม่ขายหรือแชร์ข้อมูลผู้ใช้เพื่อการ
   ตลาดของบุคคลที่สาม ใช้ Third-party Service เท่าที่จำเป็นต่อการให้
   บริการเท่านั้น (LINE Platform, Supabase, Railway, Claude API ใน
   Phase 4 สำหรับอ่านสลิป)
4. **สิทธิ์ของผู้ใช้ (ตาม PDPA)** — สิทธิ์ขอเข้าถึง, แก้ไข, และขอลบข้อมูล
   ของตนเอง (ดูหัวข้อ 8), สิทธิ์ถอน Consent การรับแจ้งเตือน
5. **ระยะเวลาการเก็บข้อมูล** — เก็บไว้ตลอดอายุการใช้งานบัญชี รวมถึงหลัง
   ยกเลิก Premium (ตามหลักการ "ห้ามลบข้อมูลผู้ใช้" ของโปรเจค) จนกว่าผู้ใช้
   จะร้องขอลบข้อมูลอย่างชัดเจนตาม PDPA
6. **ความปลอดภัยของข้อมูล** — สรุปอ้างอิงมาตรการในหัวข้อ 1–5 ของเอกสารนี้
7. **ช่องทางติดต่อ** — ช่องทางสอบถามหรือร้องเรียนเกี่ยวกับข้อมูลส่วนบุคคล
   ผ่าน LINE OA หรืออีเมลที่กำหนดใน Phase 0.5

---

## 7. Terms of Service (สรุปสาระสำคัญ)

> เอกสารฉบับเต็มจะจัดทำและ Publish คู่กับ Privacy Policy ก่อนเปิดรับ
> ผู้ใช้จริง เนื้อหาด้านล่างคือสาระสำคัญที่ต้องครอบคลุม

1. **ลักษณะบริการ** — EasyDCA เป็นเครื่องมือบันทึกและติดตามพอร์ตการลงทุน
   **ไม่ใช่ที่ปรึกษาการลงทุนและไม่ให้คำแนะนำซื้อขายสินทรัพย์ใดๆ**
   ทั้งสิ้น (สอดคล้องกับกฎเหล็กใน
   [AI_CONTEXT.md](./AI_CONTEXT.md))
2. **แพ็กเกจและการชำระเงิน** — เงื่อนไข Free/Premium/Premium+, รอบการ
   เรียกเก็บ (รายเดือน/รายปี), ช่วงเปิดตัวเป็น Manual Payment ไม่ใช่ Auto
   Renewal จึงไม่มีการหักเงินอัตโนมัติ ผู้ใช้ต้องชำระเองทุกรอบ
3. **นโยบายการคืนเงิน** — เนื่องจากเป็นการตรวจสลิปด้วย Manual Process
   จะกำหนดเงื่อนไขการคืนเงินกรณีระบบผิดพลาดฝั่ง EasyDCA เอง (เช่น
   Approve ผิดคน) ให้ชัดเจนก่อน Publish จริง
4. **ความรับผิดชอบด้านความถูกต้องของข้อมูล** — ผู้ใช้เป็นผู้รับผิดชอบ
   ความถูกต้องของข้อมูลที่บันทึกเอง (จำนวนเงิน/ราคา/จำนวนหน่วย) EasyDCA
   ไม่รับประกันความถูกต้อง 100% ของราคาตลาดที่แสดงผล
5. **เงื่อนไขการระงับ/ยกเลิกบัญชี** — กรณีพบการฉ้อโกงสลิป, สแปม, หรือ
   ละเมิดเงื่อนไขการใช้งาน EasyDCA สงวนสิทธิ์ระงับการใช้งานฟีเจอร์ Premium
   ชั่วคราวโดยไม่ลบข้อมูล
6. **ข้อจำกัดความรับผิด (Limitation of Liability)** — EasyDCA ไม่รับผิด
   ต่อความเสียหายทางการเงินที่เกิดจากการตัดสินใจลงทุนของผู้ใช้เอง
7. **กฎหมายที่ใช้บังคับ** — ประเทศไทย
8. **การเปลี่ยนแปลงเงื่อนไข** — แจ้งผู้ใช้ล่วงหน้าผ่าน LINE ก่อนมีผลบังคับ
   ใช้ทุกครั้งที่มีการแก้ไขสาระสำคัญ

---

## 8. ระบบลบข้อมูลตามคำขอผู้ใช้ (PDPA Data Deletion Request)

> **อัปเดต (PDPA Self-Service Erasure, migrations 017/018/019):** หัวข้อนี้เคย
> ร่างเป็น Flow แบบ Admin-gated (Admin ต้องกดยืนยันใน Admin Dashboard ก่อนถึงจะ
> ลบข้อมูลจริง) แต่ **ยังไม่เคยถูก Implement จริง** — Flow ที่ Build จริงและใช้งาน
> อยู่ตอนนี้คือ **Self-Service เต็มรูปแบบผ่าน LINE Chat** ไม่ผ่าน Admin เลย (ผู้ใช้
> ยืนยัน 2 ชั้นด้วยตัวเองแล้วดำเนินการทันที) เนื้อหาด้านล่างปรับปรุงให้ตรงกับของจริง
> แล้ว — ตารางที่เคยอ้างถึง (`audit_logs`) ไม่มีอยู่จริงในระบบ ถูกแทนที่ด้วย
> `erasure_logs` (migration 019) ที่ Implement จริง

### ข้อควรเข้าใจก่อน: แยกกฎ 2 ระดับให้ชัดเจน

- **กฎภายในของโปรเจค** ("ห้ามลบข้อมูลผู้ใช้เด็ดขาด" ใน
  [PROJECT_BRIEF.md § 9](../PROJECT_BRIEF.md)) ใช้กับกรณี **Premium
  หมดอายุ/ยกเลิกการใช้งานตามปกติ** — ระบบล็อคข้อมูล ไม่ลบ เพื่อรักษา
  ประสบการณ์ผู้ใช้ที่อาจกลับมาสมัครใหม่
- **สิทธิ์ตาม PDPA** เป็นสิทธิ์ทางกฎหมายของเจ้าของข้อมูลที่ร้องขอให้ลบ
  ข้อมูลส่วนบุคคลของตนเองอย่างชัดแจ้ง — **ต้องได้รับการปฏิบัติตามเสมอ**
  ไม่ว่ากฎภายในข้อแรกจะระบุไว้อย่างไร สองกฎนี้ไม่ขัดแย้งกัน เพราะกฎแรก
  คุ้มครองกรณีที่ผู้ใช้ "ไม่ได้ร้องขอ" ส่วนกฎที่สองใช้เมื่อผู้ใช้ "ร้องขอ
  อย่างชัดเจน" เท่านั้น

### Flow การรับคำขอลบข้อมูล (Self-Service — ของจริง)

1. **ช่องทางรับคำขอ** — ผู้ใช้พิมพ์คำสั่ง `ลบข้อมูล` ใน LINE Chat ตรงๆ
   (`commandParser.service.js` — `ERASE_DATA_REQUEST`) ไม่มีช่องทางอีเมล
   แยกต่างหากในตอนนี้ (LINE OA เป็นช่องทางเดียว ตามที่ระบุใน Privacy
   Policy)
2. **ยืนยันตัวตน** — ยืนยันโดยปริยายผ่านการที่ผู้ใช้พิมพ์คำสั่งจาก LINE
   Account ของตนเองโดยตรง (Webhook Event ผูกกับ `event.source.userId`
   เสมอ ไม่มีช่องทางให้ปลอมตัวเป็นคนอื่นพิมพ์คำสั่งนี้แทนได้)
3. **แจ้งผลกระทบก่อนดำเนินการ + ยืนยัน 2 ชั้น (2-Step Confirm)** — Bot
   ตอบกลับอธิบายผลกระทบทั้งหมด (ข้อมูลระบุตัวตนถูกลบถาวร, ประวัติ
   ธุรกรรม/การชำระเงินถูกเก็บแบบไม่ระบุตัวตนต่อ, ไม่สามารถเข้าใช้บัญชีเดิม
   ได้อีก, คำเตือนพิเศษถ้ามี Payment ที่ยังไม่ Resolve ค้างอยู่) พร้อมปุ่ม
   "ยืนยันลบ"/"ยกเลิก" — ต้องกดยืนยันอีกครั้งก่อนดำเนินการจริงเสมอ (Action
   ย้อนกลับไม่ได้ — `flexMessage.buildErasureConfirmMessage`)
4. **ดำเนินการทันที ไม่มี Admin Gate** — เมื่อผู้ใช้กด "ยืนยันลบ"
   (`webhook.controller.js` case `confirm_erase_data`)
   `userErasure.service.eraseUserData` ดำเนินการทันทีโดยไม่ต้องรอ Admin
   อนุมัติ — ตัดสินใจแล้วว่า Self-Service ให้ผลลัพธ์ตรงตามเจตนารมณ์ของ
   สิทธิ์ Erasure (รวดเร็ว ไม่ต้องพึ่งความพร้อมของ Admin) โดยไม่ลดทอนความ
   ปลอดภัย เพราะขั้นตอนที่ 2-3 ป้องกันการกดผิดพลาดอยู่แล้ว
5. **ระยะเวลาดำเนินการ** — **ทันที** (ไม่ใช่ภายใน 30 วันแบบ Flow เดิมที่
   เคยร่างไว้ — Self-Service ทำให้ไม่มีความหน่วงจาก Manual Process ของ
   Admin)
6. **ขอบเขตข้อมูลที่ลบ/Anonymize** — Anonymize `users` Row (แทนที่
   `line_user_id`/`display_name`/`picture_url` ด้วยข้อมูลไม่ระบุตัวตน —
   ยืนยันจาก Schema จริงแล้วว่าเป็น Field ระบุตัวตนทั้งหมดที่มี ไม่มี
   Watchlist/Goal แยกต่างหากให้ต้องลบเพิ่ม) และ **ลบรูปสลิปโอนเงินจริง**
   (Hard Delete) ออกจาก Storage Bucket `payment-slips` ทั้งหมดของผู้ใช้
   รายนั้น — **ไม่แตะ `transactions`/`payments` แถวจริงเด็ดขาด**
   (Immutable Ledger ตาม PROJECT_BRIEF § 9)
7. **ข้อมูลที่ต้องเก็บไว้ต่อแม้ถูกร้องขอลบ** — `transactions`/`payments`
   ที่ Anonymize `user_id` ไม่ได้ (FK RESTRICT ป้องกันอยู่แล้ว) ยังคงอยู่
   ครบถ้วนแบบ Anonymized (เชื่อมโยงกลับหาตัวบุคคลไม่ได้อีกต่อไป เพราะ
   `users` Row ที่อ้างถึงถูกล้างข้อมูลระบุตัวตนไปแล้ว) ตามระยะเวลาที่
   กฎหมายไทยกำหนด (เช่น เอกสารบัญชี ~5 ปี)
8. **ข้อยกเว้น/คำเตือนกรณี Payment ค้างอยู่** — ถ้ามี Payment ที่ยังไม่
   Resolve ค้างอยู่ตอนพิมพ์คำสั่ง Bot จะแนบคำเตือนพิเศษในขั้นตอนที่ 3 ว่า
   Admin จะตรวจสอบไม่ได้อีกว่ารายการนั้นเป็นของใครหากดำเนินการลบต่อ — เป็น
   การแจ้งเตือนก่อนตัดสินใจ ไม่ใช่การบล็อกไม่ให้ลบ (สิทธิ์ Erasure ต้องได้
   รับการปฏิบัติตามเสมอตามหลักการด้านบน)
9. **บันทึก Audit** — ทุกครั้งที่ Anonymize สำเร็จ บันทึกลง `erasure_logs`
   (migration 019 — `user_id`, `had_pending_payment`, `created_at`)
10. **แจ้งผลกลับผู้ใช้** — Bot ตอบกลับยืนยันว่าลบข้อมูลสำเร็จทันทีผ่าน
    `event.replyToken` เดิม (ยังใช้งานได้ปกติแม้ `line_user_id` จะถูก
    Anonymize ไปแล้ว เพราะผูกกับ Event ไม่ใช่การค้นหา User ใหม่)

### ผลลัพธ์ที่ควรทราบ: การกลับมาใช้งานอีกครั้ง

หากผู้ใช้ที่ถูก Anonymize แล้วส่งข้อความมาที่ LINE OA อีกครั้งด้วย LINE
Account เดิม ระบบจะไม่พบ User เดิม (เพราะ `line_user_id` ถูกแทนที่ด้วยค่า
สังเคราะห์แล้ว) และจะสร้าง User Row ใหม่ทั้งหมดให้โดยอัตโนมัติ (ไม่มี
ประวัติเดิมติดมา ต้อง Consent ใหม่อีกครั้ง) — เป็นผลลัพธ์ที่ถูกต้องและ
คาดหวังไว้ของการ Anonymize ไม่ใช่ข้อบกพร่อง

---

## 9. Monitoring และ Alert เมื่อระบบผิดปกติ

### 9.1 System Logging

Error/Event สำคัญของระบบทั้งหมดบันทึกลงตาราง `system_logs`
(ดู [DATABASE.md](./DATABASE.md)) แยกตาม:

- **ระดับความรุนแรง (`type`)**: `error` / `warning` / `info`
- **แหล่งที่มา (`source`)**: `webhook` / `parser` / `database` /
  `payment` / `notification` / `auth` / `cron`

### 9.2 Alert เมื่อระบบผิดปกติ

อ้างอิงหลักการ Error Handling จาก [SRS.md § 6](./SRS.md):

| ระดับ | การจัดการ |
|---|---|
| Validation Error (4xx) | ตอบกลับ Client ทันที ไม่ต้อง Alert |
| Internal Server Error (5xx) | บันทึก `system_log`, ตอบกลับ Client ด้วยข้อความทั่วไป |
| Critical Error (เช่น Approve Payment แล้ว Unlock Premium ล้มเหลว, Database Connection ล้มเหลวหลัง Retry ครบ, Cron Job ทั้งหมดล้มเหลว) | บันทึก `system_log` **และ** แจ้ง Admin ทันทีผ่าน LINE Push (ดู § 9.4) |

### 9.3 Health & Uptime Monitoring

- **`GET /health`** (Implemented — Infra ก่อน Beta) เช็คว่า Database
  (Supabase) เชื่อมต่อได้จริง (ไม่ใช่แค่ Process ยังไม่ตาย) คืน `200` ถ้า
  ปกติ, `503` ถ้าเชื่อมต่อ Database ไม่ได้ (ดู `src/index.js` +
  `src/services/healthAlert.service.js`) — ไม่ต้อง Auth เพราะต้องเรียก
  ได้จากภายนอกโดย UptimeRobot/Railway Health Check
- **Uptime Monitoring ภายนอก:** ตั้ง UptimeRobot Monitor (Free Tier)
  ชี้มาที่ `GET /health` ของ Production ทุก 5 นาที — ยังต้อง Setup ผ่าน
  UptimeRobot Dashboard เอง (Login เว็บ ไม่มี API ให้ Claude Code ตั้งแทนได้)
- **Health Dashboard** (Phase 3 Admin Dashboard) แสดงสถานะ API Server,
  Database, Webhook, Notification Queue แบบ Real-time
- **Error Log Dashboard** (Phase 3) รวม Error จากทุก Source ไว้ที่เดียว
  ให้ Developer ตรวจสอบได้เร็ว

### 9.4 Alert Channel

- ⚠️ **LINE Notify ปิดบริการแล้ว** (ขอ Token ใหม่ไม่ได้) — ช่องทางแจ้งเตือน
  Admin ปัจจุบันคือ **LINE Push** ไปยัง `line_user_id` ที่ตั้งไว้ใน
  `ADMIN_LINE_USER_IDS` (Reuse ตัวเดียวกับที่แจ้งคำขอชำระเงินเข้าใหม่ —
  ดู `payment.service`) ผ่าน `healthAlert.service.pushAdminAlert()` ใช้
  แจ้งทั้งกรณี Critical Error (`/health` ตรวจพบ Database ล่ม, Nightly
  Backup ล้มเหลว) และสลิปการชำระเงินเข้าใหม่
- `/health` มี Debounce กันแจ้งเตือนถี่เกินไป: Push แค่ตอน "เพิ่งเจอปัญหา"
  และตอน "กลับมาปกติ" เท่านั้น ไม่ Push ซ้ำระหว่างที่ยังพังต่อเนื่อง (ดู
  `healthAlert.service.checkAndAlert`)
- Cron Job ที่ล้มเหลวต้อง Retry ตามนโยบายใน SRS.md (Database
  Connection: Retry 3 ครั้ง ห่างกัน 30 วินาที) ก่อนจึง Escalate เป็น
  Critical Alert

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
