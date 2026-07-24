# BACKUP_AND_RECOVERY.md — แผน Backup และ Disaster Recovery

> เอกสารนี้คือ "คู่มือปฏิบัติการจริง" แยกจาก [SECURITY.md](./SECURITY.md)
> โดยเฉพาะ เพื่อให้เปิดดูและทำตามได้ทันทีเวลาเกิดเหตุฉุกเฉิน
> ตามโครงสร้างที่วางไว้ใน [PROJECT_BRIEF.md § 14](../PROJECT_BRIEF.md)
>
> **กฎเหล็กที่ต้องยึดตลอดเอกสารนี้:** ห้ามลบข้อมูลผู้ใช้เด็ดขาด
> ทุกขั้นตอนด้านล่างต้องออกแบบมาให้ไม่มีการสูญเสียข้อมูลผู้ใช้โดยไม่ตั้งใจ

---

## 1. Backup Schedule

### 1.1 Database (Supabase / PostgreSQL)

| ประเภท | ความถี่ | หมายเหตุ |
|---|---|---|
| Full Backup | ทุกวัน (อัตโนมัติผ่าน Supabase Managed Backup) | ความถี่จริงขึ้นกับ Plan ของ Supabase ที่ใช้งาน ณ ช่วงเวลานั้น (Free/Pro/Team) — **ต้องตรวจสอบและยืนยันนโยบาย Backup ของ Plan ปัจจุบันทุกครั้งที่อัพเกรด/ดาวน์เกรด Plan** |
| Incremental (WAL / Point-in-Time Recovery) | ต่อเนื่อง (ถ้า Plan รองรับ PITR) | ใช้กู้ข้อมูลกลับไปยังเวลาที่ระบุได้ละเอียดกว่า Full Backup รายวัน เหมาะกับกรณี "ข้อมูลถูกลบผิดพลาด" (ดูหัวข้อ 5) |
| Manual Backup ก่อน Deploy/Migration ใหญ่ | ก่อนทุกครั้งที่มี Schema Migration หรือ Deploy ที่กระทบโครงสร้างข้อมูล | รัน `pg_dump` เก็บสำรองเพิ่มเติมนอกเหนือจาก Auto-backup เสมอ |

### 1.2 ความถี่ตามขนาดข้อมูลแต่ละ Phase

| Phase | ขนาดข้อมูล | ความถี่ที่เหมาะสม |
|---|---|---|
| Phase 0–1 (พัฒนา, ยังไม่มี User จริง) | น้อยมาก | Auto-backup รายวันเพียงพอ |
| Phase 2 (เปิด Beta, เริ่มมีข้อมูลจริง) | เล็ก–กลาง | Auto-backup รายวัน + Manual Backup ก่อน Deploy ทุกครั้ง |
| Phase 3+ (Production, User เพิ่มขึ้น) | กลาง–ใหญ่ | พิจารณาอัพเกรด Supabase Plan เพื่อเปิด PITR ถ้ายังไม่มี และเพิ่มความถี่ Manual Backup เป็นก่อน/หลัง Deploy สำคัญทุกครั้ง |

### 1.3 Storage (รูปสลิปการชำระเงิน)

| ประเภท | ความถี่ |
|---|---|
| Supabase Storage Backup | ตามนโยบาย Backup ของ Supabase Plan เดียวกับ Database |
| Export สำรองไปยัง External Storage | รายสัปดาห์ (อย่างน้อย) ในช่วง Production จริง เพื่อลดความเสี่ยงกรณี Supabase Project มีปัญหา |

### 1.4 Retention Policy

| ประเภท | เก็บไว้นานเท่าไหร่ |
|---|---|
| Daily Backup | 7–30 วันย้อนหลัง (ตาม Supabase Plan) |
| Manual Backup ก่อน Migration/Deploy สำคัญ | อย่างน้อย 90 วัน เก็บแยกไว้ต่างหากจาก Auto-backup |
| Backup สำหรับปิดปีบัญชี/รายงานการเงิน | เก็บตามระยะเวลาที่กฎหมายไทยกำหนด (เอกสารบัญชี/ภาษี ~5 ปี) — ดูความเชื่อมโยงกับ PDPA ที่ [SECURITY.md § 8](./SECURITY.md) |

---

## 2. Backup Storage

### 2.1 ที่เก็บหลัก

- **Supabase Auto-backup** — เก็บภายในระบบ Supabase ตาม Plan ที่ใช้งาน
  เป็นแหล่งกู้คืนหลักสำหรับเหตุการณ์ทั่วไป (Query ผิดพลาด, Bug ที่ทำ
  ข้อมูลเสีย)

### 2.2 ที่เก็บสำรอง (Redundancy)

- **External Storage สำรอง — Implemented (Infra ก่อน Beta):**
  `backend/src/jobs/dbBackup.job.js` รัน `pg_dump` ทุกคืนตี 3 Asia/Bangkok
  บน Service `easydca-worker` → บีบอัด (gzip) → อัปโหลดไปยัง **Cloudflare
  R2** (S3-compatible, แยกจาก Supabase โดยสิ้นเชิง — เลือกเพราะ Free Tier
  10GB + ไม่มีค่า Egress + Auth เป็น Access Key ตรงๆ ไม่ต้องพึ่ง OAuth) เพื่อ
  ป้องกันกรณี Supabase Project ทั้งหมดมีปัญหา (Account ถูกล็อค, บริการล่ม
  ระดับ Provider) — ดู Environment Variables ที่ต้องตั้งใน
  [ENV_VARIABLES.md § Nightly Backup](./ENV_VARIABLES.md)
- ✅ **Client-side Encryption — Implemented:** ไฟล์ Backup ถูกเข้ารหัสด้วย
  **AES-256-GCM** ตั้งแต่ "ก่อนออกจาก Server เรา" (`backend/src/utils/backupEncryption.util.js`)
  ไม่พึ่ง Encryption at Rest ของ Cloudflare R2 อย่างเดียวอีกต่อไป — R2 ยังเข้ารหัส
  ฝั่ง Provider ให้อยู่เหมือนเดิม แต่ตอนนี้เป็นชั้นที่ **2** ไม่ใช่ชั้นเดียว
  (Cloudflare ถือ Key ของชั้นนั้นเอง เราถือ Key ของชั้นเราเอง — ต่อให้ Bucket
  รั่วทั้งใบ ไฟล์ก็ยังอ่านไม่ได้ถ้าไม่มี `BACKUP_ENCRYPTION_KEY` ของเรา)
- **Flow เต็ม:** `pg_dump` → gzip → **encrypt (AES-256-GCM)** → upload R2 →
  purge เก่าเกิน Retention
- **ชื่อไฟล์ลงท้าย `.sql.gz.enc`** บอกชัดว่าเข้ารหัสแล้ว — `gunzip` ตรงๆ ไม่ได้
  ต้องผ่าน `scripts/decryptBackup.js` ก่อนเสมอ (ดู § 3.4)
- **รูปแบบไฟล์ (Envelope):** `[MAGIC 4B][VERSION 1B][IV 12B][AuthTag 16B][Ciphertext…]`
  — IV สุ่มใหม่ทุกไฟล์และเก็บรวมอยู่ในไฟล์เดียวกัน (ไม่แยกเป็น Metadata บน R2
  ที่อาจหลุดหาย/ไม่ตรงกับไฟล์) ทำให้ไฟล์ **Self-contained**: มีไฟล์ + มี Key =
  ถอดได้เสมอ ไม่ต้องพึ่ง State อื่นใด
- **เลือก GCM เพราะเป็น Authenticated Encryption:** ถ้า Key ผิด หรือไฟล์ถูกแก้ไข/
  ดาวน์โหลดมาไม่ครบ จะ **Fail ดังๆ เสมอ** (Auth Tag ไม่ตรง) ไม่มีทางได้ข้อมูลขยะ
  ออกมาเงียบๆ โดยไม่รู้ตัว — สำคัญมากตอนกู้คืนจริง เพราะ Silent Corruption
  อันตรายกว่า Error ที่เห็นชัด
- **Fail-Closed:** ถ้า `BACKUP_ENCRYPTION_KEY` ไม่ได้ตั้งค่าหรือ Format ผิด Job จะ
  **ข้ามรอบนั้นทั้งรอบ** พร้อม Push แจ้ง Admin — ไม่มี Fallback ไปอัปโหลดไฟล์ที่
  ไม่เข้ารหัสเด็ดขาด (ตรวจตั้งแต่ก่อนเรียก `pg_dump` เพื่อไม่ให้ Dump เสียเปล่า)
- **Retention:** เก็บ 14 วันล่าสุด (Default — Override ได้ผ่าน
  `BACKUP_RETENTION_DAYS`) ลบของเก่ากว่านั้นทิ้งอัตโนมัติทุกรอบที่ Backup
  สำเร็จ (`purgeOldBackups`)
- **แจ้งเตือนถ้า Backup ล้มเหลว:** Push หา Admin ทันทีผ่านกลไกเดียวกับ
  Critical Alert (§ 9.4 ใน [SECURITY.md](./SECURITY.md)) — ไม่ใช่แค่ Log เงียบๆ
- ไฟล์ Backup ที่ Export ออกมาต้องเข้ารหัสก่อนเก็บ (Encrypted Archive)
  เนื่องจากมีข้อมูลส่วนบุคคลของผู้ใช้อยู่ในนั้น — ✅ ทำแล้วตามรายละเอียดด้านบน
- **จำนวนชุดขั้นต่ำ:** เก็บอย่างน้อย 2 ชุดล่าสุดในที่เก็บสำรอง (คนละ
  สถานที่จาก Supabase) เพื่อไม่ให้พึ่งพา Backup ชุดเดียว — Retention 14 วัน
  ด้านบนรับประกันข้อนี้อยู่แล้วตราบใดที่ Backup รันสำเร็จอย่างน้อย 2
  ครั้งใน 14 วัน

### 2.3 Encryption Key — สิ่งที่พลาดไม่ได้

> ## ⚠️ Key หาย = Backup ทุกไฟล์กลายเป็นขยะถาวร
>
> `BACKUP_ENCRYPTION_KEY` คือสิ่งเดียวที่ถอดไฟล์ Backup ได้ **ถ้าหาย ไม่มีทาง
> กู้คืนข้อมูลได้เลยตลอดกาล** — Brute-force AES-256 ไม่ใช่สิ่งที่ทำได้จริงใน
> ทางปฏิบัติ ไม่มี Backdoor ไม่มีใครช่วยได้ รวมถึง Cloudflare และผู้พัฒนาระบบเอง
>
> ไฟล์ Backup ที่มีอยู่บน R2 ทั้งหมดจะไร้ค่าทันที **นี่คือความเสี่ยงที่ร้ายแรง
> กว่าตัว Database ล่มเสียอีก** เพราะ Database ล่มยังมี Backup ให้กู้ แต่ Key หาย
> คือไม่เหลืออะไรเลย

#### วิธี Generate Key (ครั้งแรกครั้งเดียว)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

ได้ Hex String 64 ตัวอักษร (32 Bytes สำหรับ AES-256) ใช้ `crypto.randomBytes()`
ซึ่งเป็น CSPRNG ของระบบปฏิบัติการ — **ห้ามคิด Key เองด้วยมือ** หรือใช้ข้อความที่
มีความหมาย (ชื่อโปรเจกต์, วันเกิด ฯลฯ) เพราะเดาได้ง่ายกว่าที่คิดมาก

#### กฎการเก็บ Key (ทำตามทุกข้อ ไม่มีข้อยกเว้น)

| # | กฎ | เหตุผล |
|---|---|---|
| 1 | **Copy เก็บทันทีที่ Generate เสร็จ** ก่อนจะเอาไปวางที่ไหนด้วยซ้ำ | รันคำสั่งแล้วเผลอปิด Terminal ทิ้ง = ต้อง Generate ใหม่ (ถ้ายังไม่ได้เข้ารหัสอะไรก็ยังไม่เสียหาย แต่ถ้าใช้ไปแล้วคือจบ) |
| 2 | **สำรองอย่างน้อย 2 ที่ที่แยกจากกันจริง** — เช่น Railway Variables + Password Manager ส่วนตัว | "แยกจากกัน" = ถ้าที่หนึ่งหายทั้งหมด อีกที่ต้องยังอยู่ ไม่ใช่เก็บ 2 ที่ในบัญชี/เครื่องเดียวกัน |
| 3 | **ห้าม Commit ค่าจริงลง Git เด็ดขาด** | Repo มีโอกาสถูกแชร์/หลุด และ Git เก็บ History ตลอดไป ลบทีหลังไม่หายจริง — ใน `.env.example` มีแค่ Placeholder |
| 4 | **ห้ามส่ง Key ผ่าน Chat/Email ที่ไม่เข้ารหัส** | ช่องทางเหล่านี้เก็บ Log ไว้นานกว่าที่คิด |
| 5 | **ห้าม Rotate Key เองโดยไม่วางแผน** | ดูหัวข้อถัดไป |

#### ถ้าจำเป็นต้องเปลี่ยน (Rotate) Key จริงๆ

Backup เก่าที่เข้ารหัสด้วย Key เดิม **จะกู้ไม่ได้ทันที** ถ้าไม่เก็บ Key เดิมไว้ด้วย
และปัจจุบัน Envelope **ไม่ได้บันทึกว่าไฟล์ไหนใช้ Key ไหน** (ดู § 7 ข้อ 1) ดังนั้น:

```
[1] อย่าเพิ่งลบ Key เดิม — เก็บไว้ในที่ปลอดภัยพร้อมกำกับวันที่ที่เลิกใช้
[2] ตั้ง Key ใหม่บน Railway Variables (Service easydca-worker)
[3] รอจนกว่า Backup ที่เข้ารหัสด้วย Key เดิมจะถูก Purge ครบตาม
    BACKUP_RETENTION_DAYS (Default 14 วัน) — ระหว่างนี้บน R2 จะมีไฟล์ 2 ยุคปนกัน
    ถ้าต้องกู้คืนช่วงนี้ ต้องลองถอดด้วย Key ใหม่ก่อน ถ้าไม่ผ่านค่อยลอง Key เดิม
[4] ยืนยันว่าไม่เหลือไฟล์ยุค Key เดิมบน R2 แล้ว จึงค่อยพิจารณาทำลาย Key เดิม
```

---

## 3. Restore Procedure

### 3.1 ผู้มีสิทธิ์สั่ง Restore

อ้างอิง Role จาก [ROADMAP.md § Phase 3](./ROADMAP.md):

| Role | สิทธิ์เกี่ยวกับ Restore |
|---|---|
| Super Admin | สั่ง Restore ได้ทุกกรณี รวมถึง Production |
| Developer | สั่ง Restore ได้ในกรณีฉุกเฉินทางเทคนิค แต่ต้องแจ้ง Super Admin/Project Owner ทันทีที่ทำ |
| Admin / Support / Finance | **ไม่มีสิทธิ์สั่ง Restore** — แจ้ง Super Admin หรือ Developer แทน |

**กฎสำคัญ:** การ Restore ระดับ Production ที่กระทบข้อมูลผู้ใช้จำนวนมาก
ต้องได้รับการยืนยันจาก Project Owner ก่อนดำเนินการเสมอ ยกเว้นกรณีฉุกเฉิน
ที่ระบบล่มอยู่และรอไม่ได้ — ให้ Restore ก่อนแล้วรายงานทันทีหลังจบงาน

### 3.2 ขั้นตอน Restore (ทีละขั้น)

```
[1] ยืนยันปัญหาก่อน Restore
    - ตรวจสอบว่าปัญหาคือข้อมูลเสียหายจริง ไม่ใช่ Bug ฝั่ง Application
      ที่แก้ที่โค้ดได้โดยไม่ต้อง Restore
    - บันทึกเวลาที่พบปัญหา (ใช้กำหนดจุด Restore ที่ต้องการ)

[2] แจ้งผู้เกี่ยวข้อง
    - แจ้ง Super Admin / Project Owner ผ่าน LINE Notify ก่อนเริ่ม
      (หรือทันทีหลังเริ่มถ้าเป็นเหตุฉุกเฉิน)
    - ถ้ากระทบผู้ใช้เป็นวงกว้าง พิจารณาแจ้ง Maintenance ผ่าน Broadcast

[3] เลือกจุด Restore (Restore Point)
    - ถ้ามี PITR: เลือกเวลาก่อนเกิดปัญหาแบบละเอียดที่สุดเท่าที่ทำได้
    - ถ้าไม่มี PITR: ใช้ Full Backup รายวันล่าสุดก่อนเกิดปัญหา

[4] Backup สถานะปัจจุบันก่อน Restore เสมอ
    - แม้ข้อมูลจะเสียหาย ก็ต้อง pg_dump สถานะปัจจุบันเก็บไว้ก่อน
      เผื่อ Restore ผิดจุดหรือจำเป็นต้องกู้ข้อมูลบางส่วนจากช่วงเวลานั้น

[5] ดำเนินการ Restore
    - Restore ไปยัง Environment แยกต่างหากก่อน (Staging) ถ้าเวลาเอื้ออำนวย
      เพื่อตรวจสอบความถูกต้องก่อนสลับ Production จริง
    - ถ้าเป็นเหตุฉุกเฉินที่รอไม่ได้ ให้ Restore ตรง Production พร้อม
      บันทึกทุกคำสั่งที่รันไว้

[6] ตรวจสอบความถูกต้องหลัง Restore
    - เทียบจำนวน Record หลัก (users, transactions, payments) กับ
      Backup ก่อนหน้า ว่าไม่มีข้อมูลหายผิดปกติ
    - สุ่มตรวจสอบพอร์ตของ User ตัวอย่างว่าคำนวณถูกต้อง

[7] เปิดระบบกลับให้ใช้งาน + แจ้งผลลัพธ์
    - แจ้ง Project Owner และทีมงานว่า Restore เสร็จสมบูรณ์
    - บันทึก audit_log และสรุปเหตุการณ์ไว้เป็นบทเรียน (Post-mortem)
```

### 3.3 เวลาที่ใช้โดยประมาณ

| ขนาดข้อมูล | เวลาโดยประมาณ |
|---|---|
| Phase 0–1 (ข้อมูลน้อย) | ภายใน 30 นาที |
| Phase 2 (Beta) | ภายใน 1–2 ชั่วโมง |
| Phase 3+ (Production ข้อมูลมาก) | ประเมินใหม่ตามขนาดจริง แนะนำซ้อมกู้คืน (Restore Drill) เป็นระยะเพื่อวัดเวลาจริง |

### 3.4 กู้คืนจาก Backup ที่เข้ารหัสบน Cloudflare R2 (ขั้นตอนรันได้จริง)

> ขั้นตอนนี้เขียนให้ "Copy ไปรันได้ทันที" ตอนเกิดเหตุจริง ไม่ต้องเดาอะไรเพิ่ม
> — สิ่งที่ต้องมีก่อนเริ่ม: **(1)** ไฟล์ Backup จาก R2 **(2)** `BACKUP_ENCRYPTION_KEY`
> ตัวที่ใช้เข้ารหัสไฟล์นั้น **(3)** Node.js + `psql` บนเครื่องที่รัน

#### [1] ดาวน์โหลดไฟล์ Backup จาก R2

เลือกทางใดทางหนึ่ง:

**ทาง A — Cloudflare Dashboard (ง่ายสุด ไม่ต้องติดตั้งอะไร):**
R2 → เลือก Bucket → โฟลเดอร์ `db-backups/` → เรียงตามวันที่ → กดดาวน์โหลดไฟล์
`easydca-<timestamp>.sql.gz.enc` ที่ต้องการ

**ทาง B — AWS CLI (S3-compatible — เหมาะเวลาต้องดูรายการหลายไฟล์):**
```bash
export AWS_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
export AWS_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
export R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com

# ดูรายการ Backup ทั้งหมดที่มี (เรียงตามชื่อ = เรียงตามเวลาอยู่แล้ว)
aws s3 ls s3://<R2_BUCKET_NAME>/db-backups/ --endpoint-url $R2_ENDPOINT

# ดาวน์โหลดไฟล์ที่ต้องการ
aws s3 cp s3://<R2_BUCKET_NAME>/db-backups/easydca-<timestamp>.sql.gz.enc ./ \
  --endpoint-url $R2_ENDPOINT
```

#### [2] ถอดรหัสไฟล์ (`.sql.gz.enc` → `.sql.gz`)

```bash
cd backend
export BACKUP_ENCRYPTION_KEY=<key ที่สำรองไว้>   # หรือใส่ใน backend/.env ก็ได้

node scripts/decryptBackup.js \
  ~/Downloads/easydca-<timestamp>.sql.gz.enc \
  ~/restore/easydca-<timestamp>.sql.gz
```

> Script **ปฏิเสธเขียนทับไฟล์ที่มีอยู่แล้ว** โดยตั้งใจ (กันพิมพ์ Path ผิดตอนรีบ
> แล้วทับไฟล์ดีทิ้ง) — ถ้าตั้งใจทับจริงต้องใส่ `--force` เอง

**ถ้าขึ้น Error แบบนี้ แปลว่าอะไร:**

| ข้อความ | สาเหตุ | ทำอย่างไรต่อ |
|---|---|---|
| `wrong BACKUP_ENCRYPTION_KEY, or file is corrupted/tampered` | Key ไม่ใช่ตัวที่ใช้เข้ารหัสไฟล์นี้ หรือไฟล์เสียหาย | ลอง Key สำรองอีกที่ / ถ้าเคย Rotate ให้ลอง Key เดิม (§ 2.3) / ลองดาวน์โหลดไฟล์ใหม่เผื่อโหลดมาไม่ครบ |
| `must be exactly 64 hex characters` | Key ผิด Format (Copy มาไม่ครบ/มีอักขระแปลกปน) | ตรวจว่า Copy Key มาครบ 64 ตัว (เว้นวรรคหน้า-หลังไม่เป็นไร ระบบตัดให้เอง) |
| `truncated or corrupt` | ไฟล์ไม่ครบ (ดาวน์โหลดค้าง) | ดาวน์โหลดใหม่ แล้วเทียบขนาดไฟล์กับที่แสดงบน R2 |
| `magic bytes mismatch` | ไฟล์นี้ไม่ใช่ไฟล์ที่ระบบนี้เข้ารหัส | เช็คว่าหยิบไฟล์ `.sql.gz.enc` ถูกตัวหรือเปล่า (ไม่ใช่ `.sql.gz` เปล่าๆ) |

#### [3] แตกไฟล์ + Restore เข้า Database

```bash
gunzip ~/restore/easydca-<timestamp>.sql.gz      # ได้ .sql ออกมา

# ⚠️ Restore เข้า Database "ใหม่/Staging" ก่อนเสมอถ้าเวลาเอื้ออำนวย (ดู § 3.2 ข้อ 5)
psql "<DATABASE_URL ปลายทาง>" < ~/restore/easydca-<timestamp>.sql
```

#### [4] ตรวจสอบว่ากู้คืนสำเร็จจริง

```bash
psql "<DATABASE_URL ปลายทาง>" -c "\dt"          # ตารางครบไหม
psql "<DATABASE_URL ปลายทาง>" -c "SELECT count(*) FROM users;"
psql "<DATABASE_URL ปลายทาง>" -c "SELECT count(*) FROM transactions;"
```

เทียบจำนวน Record กับที่คาดไว้ตาม § 3.2 ข้อ 6 — **อย่าเพิ่งสลับ Production
จนกว่าตัวเลขจะสมเหตุสมผล**

#### [5] เปิด RLS กลับให้ครบ (ถ้า Restore เข้า Project ใหม่)

`pg_dump` รันด้วย `--no-owner --no-privileges` (ตัด Ownership Metadata ที่ผูกกับ
Role ของ Supabase Project ต้นทาง) ดังนั้นหลัง Restore เข้า **Project ใหม่**
ต้องตรวจ RLS Policy ให้ครบทุกตารางตาม [DATABASE.md](./DATABASE.md) ก่อนเปิดใช้จริง
— ข้อเดียวกับ § 4.1 ข้อ 3 ที่ย้ำว่า **ห้ามลืมเปิด RLS หลัง Migration**

### 3.5 ซ้อมกู้คืน (Restore Drill) — ต้องทำจริงอย่างน้อย 1 ครั้ง

เอกสารที่ไม่เคยถูกรันจริงคือเอกสารที่ใช้ไม่ได้ — **ต้องซ้อมกู้คืนจาก Backup จริง
บน Production อย่างน้อย 1 ครั้งก่อนเปิด Beta** และทำซ้ำเป็นระยะหลังจากนั้น:

```
[1] รอ Backup รอบถัดไปที่รันจริงบน Production (ตี 3 Asia/Bangkok)
[2] ยืนยันว่าไฟล์ขึ้น R2 จริง (เช็ค Log ของ Service easydca-worker:
    "[cron:db-backup] uploaded db-backups/… (N bytes, encrypted)")
[3] ดาวน์โหลดไฟล์นั้นมาถอดรหัสตาม § 3.4 [1]-[2]
[4] gunzip แล้วเปิดดูหัวไฟล์ว่าเป็น SQL Dump จริง:
    head -20 easydca-<timestamp>.sql
[5] Restore เข้า Database ทดสอบ (ห้ามเข้า Production) แล้วนับ Record ตาม § 3.4 [4]
[6] บันทึกวันที่ซ้อม + เวลาที่ใช้จริงไว้ใน Post-mortem/บันทึกทีม
```

| วันที่ซ้อม | ผู้ทำ | เวลาที่ใช้จริง | ผลลัพธ์ |
|---|---|---|---|
| _(ยังไม่เคยซ้อมบน Production — ต้องทำก่อนเปิด Beta)_ | | | |

---

## 4. Migration Plan

### 4.1 วิธีย้ายระบบไปเซิร์ฟเวอร์ใหม่

```
[1] เตรียม Environment ใหม่
    - ตั้งค่า Environment Variables ทั้งหมดตาม ENV_VARIABLES.md
    - ตรวจสอบ Version Node.js / Dependencies ให้ตรงกับที่ทดสอบไว้

[2] Backup ข้อมูลชุดล่าสุดจากระบบเดิม
    - pg_dump ฐานข้อมูลเต็มรูปแบบ
    - Export ไฟล์ Storage (รูปสลิป) ทั้งหมด

[3] ตั้งค่า Database บนเซิร์ฟเวอร์ใหม่ (หรือ Supabase Project ใหม่)
    - Restore ข้อมูลจาก Backup
    - เปิด RLS ทุก Table ใหม่ทันที ตรวจสอบ Policy ให้ครบตาม DATABASE.md
      ก่อนเปิดใช้งานจริง (ห้ามลืมเปิด RLS หลัง Migration)

[4] Deploy Application ไปยังเซิร์ฟเวอร์ใหม่
    - Deploy แบบ Staging ก่อน ทดสอบ Flow หลักทั้งหมด
    - อัพเดท DNS/Webhook URL ที่ LINE Developers Console ให้ชี้มาที่
      เซิร์ฟเวอร์ใหม่เฉพาะตอนพร้อม Switch จริง

[5] Switch Traffic
    - เปลี่ยน Webhook URL และ APP_URL เป็นเซิร์ฟเวอร์ใหม่
    - Monitor Log อย่างใกล้ชิดในชั่วโมงแรกหลัง Switch

[6] Decommission เซิร์ฟเวอร์เดิม
    - เก็บเซิร์ฟเวอร์เดิมไว้อย่างน้อย 7 วันก่อนปิดจริง เผื่อต้อง Rollback
```

### 4.2 Checklist ก่อน Migration

- [ ] Backup ฐานข้อมูลและ Storage ชุดล่าสุดเรียบร้อย
- [ ] Environment Variables ครบตาม ENV_VARIABLES.md
- [ ] ทดสอบ Deploy บน Staging สำเร็จ
- [ ] แจ้งผู้ใช้ล่วงหน้าถ้ามี Downtime ที่คาดการณ์ได้ (ผ่าน Broadcast)
- [ ] เตรียมแผน Rollback ไว้ล่วงหน้า

### 4.3 Checklist หลัง Migration

- [ ] RLS เปิดครบทุก Table บน Database ใหม่
- [ ] Webhook Signature Validation ทำงานถูกต้องบน Endpoint ใหม่
- [ ] ทดสอบ Flow หลัก: บันทึกธุรกรรม, ดูพอร์ต, ส่งสลิป, Admin Approve
- [ ] ตรวจสอบ Cron Jobs รันตามตารางเวลาปกติ
- [ ] Monitor Error Log อย่างน้อย 24 ชั่วโมงแรก

### 4.4 วิธีทดสอบว่า Migration สำเร็จและข้อมูลครบถ้วน

- เทียบจำนวน Record ทุกตารางหลักระหว่างระบบเดิมกับระบบใหม่ให้ตรงกัน
- สุ่มตรวจสอบพอร์ตของ User ตัวอย่างหลาย Account ว่าคำนวณ P&L ตรงกับ
  ก่อน Migration
- ทดสอบส่งคำสั่ง LINE Bot และ Webhook แบบ End-to-end บนระบบใหม่จริง
  ก่อนประกาศว่า Migration เสร็จสมบูรณ์

---

## 5. Disaster Recovery Scenarios

### 5.1 Database ล่ม

```
[1] ตรวจสอบสถานะผ่าน Supabase Status Page / Dashboard
[2] ถ้าเป็นปัญหาฝั่ง Supabase (Provider ล่ม)
    → รอ Supabase แก้ไข พร้อมแจ้ง Maintenance ให้ผู้ใช้ทราบผ่าน
      Broadcast/Status Page ของ EasyDCA เอง
[3] ถ้าเป็นปัญหาจาก Connection/Config ฝั่งเรา
    → Developer ตรวจสอบ DATABASE_URL, Connection Pool, Network
[4] ถ้าข้อมูลเสียหายจริง → เข้าสู่ขั้นตอน Restore Procedure (หัวข้อ 3)
[5] ระหว่างรอแก้ไข: LINE Bot ควรตอบข้อความแจ้งผู้ใช้ว่าระบบขัดข้อง
    ชั่วคราว แทนที่จะ Error แบบไม่มีคำอธิบาย
```

**ผู้รับผิดชอบ:** Developer ตรวจสอบก่อน → Escalate ไป Super Admin
ถ้าต้อง Restore

### 5.2 Server ล่ม (เช่น Railway Down)

```
[1] ตรวจสอบ Railway Status Page ว่าเป็นปัญหา Provider หรือ Application
[2] ถ้าเป็นปัญหา Provider
    → รอ Railway แก้ไข พิจารณาว่าจำเป็นต้อง Fail Over ไปเซิร์ฟเวอร์
      สำรองหรือไม่ (ตามความรุนแรงและระยะเวลาที่ Railway แจ้ง)
[3] ถ้าเป็นปัญหา Application (Deploy พัง, Memory เต็ม ฯลฯ)
    → Rollback ไป Deploy ก่อนหน้าที่ทำงานปกติทันที
[4] แจ้ง Admin ทันทีผ่าน LINE Notify (Critical Alert ตาม SECURITY.md § 9)
[5] หลังระบบกลับมาปกติ ตรวจสอบว่า Cron Job ที่ควรรันช่วง Downtime
    (เช่น Daily Snapshot) รันซ้ำหรือ Skip ไปหรือไม่ ถ้า Skip ให้รันเอง
    ย้อนหลัง
```

**ผู้รับผิดชอบ:** Developer แก้ไขทันที, แจ้ง Super Admin/Project Owner
คู่ขนาน

### 5.3 ข้อมูลถูกลบผิดพลาด (Accidental Deletion)

```
[1] หยุดการเขียนข้อมูลเพิ่มในส่วนที่เกี่ยวข้องทันที (ถ้าทำได้)
    เพื่อไม่ให้ Backup ถัดไปทับข้อมูลที่ยังกู้คืนได้
[2] ระบุขอบเขตความเสียหาย — ตารางไหน, User รายใด, ช่วงเวลาใด
[3] ใช้ PITR (ถ้ามี) กู้คืนเฉพาะช่วงเวลาก่อนเกิดเหตุ แม่นยำกว่า
    Full Backup รายวัน
[4] ถ้าไม่มี PITR ใช้ Full Backup ล่าสุดก่อนเกิดเหตุ ตามขั้นตอน
    Restore Procedure (หัวข้อ 3) — พิจารณา Restore เฉพาะตารางที่กระทบ
    ไปยัง Database ชั่วคราว แล้วค่อย Merge ข้อมูลที่ขาดกลับเข้า
    Production แทนการ Restore ทับทั้งระบบ เพื่อลดผลกระทบต่อข้อมูลที่
    เกิดขึ้นใหม่หลังจากนั้น
[5] ตรวจสอบร่วมกับหลักการ "ห้ามลบข้อมูลผู้ใช้" — เหตุการณ์นี้ต้องนำมา
    ทบทวนว่า Business Logic จุดใดที่ยังเปิดช่องให้ Hard Delete ได้ และ
    ควรปิดช่องทางนั้นกันไว้ไม่ให้เกิดซ้ำ
```

**ผู้รับผิดชอบ:** Developer กู้คืนข้อมูล, Super Admin อนุมัติแนวทางก่อน
ดำเนินการกับ Production

### 5.4 ระบบถูกโจมตี / Hack

```
[1] ตัดการเข้าถึงทันที
    - หมุน (Rotate) Secret ที่มีความเสี่ยงถูกใช้ในทางที่ผิดทันที:
      JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY, LINE_CHANNEL_SECRET/TOKEN
    - เปลี่ยน JWT_SECRET จะทำให้ผู้ใช้ทุกคน Logout พร้อมกัน — ยอมรับ
      ผลกระทบนี้เพื่อความปลอดภัย
[2] ตรวจสอบขอบเขตความเสียหาย
    - ตรวจ system_logs และ audit_logs ว่ามี Action ผิดปกติช่วงใดบ้าง
    - ตรวจสอบว่า Data ถูกเข้าถึง/แก้ไข/ลบผิดปกติหรือไม่
[3] ปิดช่องโหว่ที่พบ
    - แก้ไข Vulnerability ต้นเหตุก่อน Deploy กลับ (ไม่ Deploy กลับด้วย
      ช่องโหว่เดิม)
[4] แจ้ง Project Owner ทันที (ไม่รอ)
[5] ประเมินว่าต้องแจ้งผู้ใช้ที่ได้รับผลกระทบหรือไม่
    - ถ้าข้อมูลส่วนบุคคลรั่วไหล ต้องพิจารณาแจ้งผู้ใช้และหน่วยงานกำกับ
      ดูแลตาม PDPA ภายในกรอบเวลาที่กฎหมายกำหนด
[6] Restore ข้อมูลจาก Backup ก่อนถูกโจมตี ถ้าข้อมูลถูกแก้ไข/ทำลาย
    (ตามขั้นตอน Restore Procedure หัวข้อ 3)
[7] เขียน Post-mortem บันทึกสาเหตุ ผลกระทบ และมาตรการป้องกันในอนาคต
```

**ผู้รับผิดชอบ:** Super Admin + Developer ร่วมกันตัดสินใจทันที,
ต้องแจ้ง Project Owner ในทุกกรณีโดยไม่มีข้อยกเว้น

---

## 6. Recovery Objectives

### 6.1 RTO (Recovery Time Objective)

ระยะเวลาที่ระบบต้องกลับมาใช้งานได้หลังเกิดเหตุ:

| Phase | RTO เป้าหมาย |
|---|---|
| Phase 0–1 (พัฒนา) | ไม่บังคับเข้มงวด — แก้ไขในเวลาทำการ |
| Phase 2 (Beta) | ภายใน 4 ชั่วโมง สำหรับปัญหาระดับ Critical |
| Phase 3+ (Production) | ภายใน 2 ชั่วโมง สำหรับปัญหาระดับ Critical (ทบทวนเป้าหมายนี้อีกครั้งเมื่อจำนวน User เพิ่มขึ้นมาก) |

### 6.2 RPO (Recovery Point Objective)

ปริมาณข้อมูลที่ยอมรับได้ว่าอาจสูญหาย (ช่วงเวลาระหว่าง Backup ล่าสุดกับ
เหตุการณ์):

| Phase | RPO เป้าหมาย |
|---|---|
| Phase 0–1 (พัฒนา) | ไม่บังคับเข้มงวด |
| Phase 2 (Beta) | ไม่เกิน 24 ชั่วโมง (ตาม Auto-backup รายวัน) |
| Phase 3+ (Production) | ไม่เกิน 1 ชั่วโมง — ต้องเปิดใช้ PITR บน Supabase Plan ที่รองรับก่อนถึง Phase นี้ |

> **หมายเหตุ:** ตัวเลข RTO/RPO ข้างต้นเป็นเป้าหมายเบื้องต้นที่ตั้งไว้ให้
> เหมาะกับงบประมาณและขนาดโปรเจคในแต่ละ Phase (ดู
> [ROADMAP.md § งบประมาณ](./ROADMAP.md)) ควรทบทวนร่วมกับ Project Owner
> อีกครั้งเมื่อใกล้เข้า Phase 3 และเมื่อจำนวนผู้ใช้จริงเพิ่มขึ้นอย่าง
> มีนัยสำคัญ

---

## 7. รู้อยู่แล้ว ยังไม่ทำ (Known Limitations)

ข้อจำกัดที่ **ตรวจเจอแล้วและตั้งใจพักไว้** ไม่ใช่สิ่งที่มองข้าม — บันทึกไว้พร้อม
เหตุผลว่าทำไมยังรอได้ และเงื่อนไขที่จะทำให้ "รอไม่ได้แล้ว"

### 7.1 Envelope ไม่มี Key ID — ไม่รู้ว่าไฟล์ไหนเข้ารหัสด้วย Key ไหน

**สภาพปัจจุบัน:** Byte `VERSION` ใน Envelope เป็น *Format* Version (บอกว่าโครงสร้าง
ไฟล์เป็นแบบไหน) ไม่ใช่ *Key* ID ถ้าวันหนึ่งมีการเปลี่ยน Key แล้วบน R2 มีไฟล์ 2 ยุค
ปนกัน จะไม่มีทางรู้จากตัวไฟล์ว่าอันไหนใช้ Key ไหน ต้องไล่ลองถอดทีละ Key

**ทำไมพักไว้ได้ตอนนี้:** ยังมี Key เดียวมาตลอดและ § 2.3 ห้าม Rotate โดยไม่วางแผน
อยู่แล้ว ประกอบกับ Retention แค่ 14 วัน แปลว่าช่วงที่ไฟล์ 2 ยุคปนกันสั้นมาก และ
GCM ทำให้ "ลองผิด Key" Fail ทันทีอย่างปลอดภัย (ไม่ได้ข้อมูลขยะออกมา) การไล่ลอง
2 Key จึงยังเป็นงานไม่กี่นาที ไม่ใช่ปัญหาจริง

**จะรอไม่ได้เมื่อ:** เริ่มมี Key มากกว่า 2 ตัวหมุนเวียน หรือ Retention ยาวขึ้นมาก
(เช่นเก็บ Backup ปิดปีบัญชี 5 ปีตาม § 1.4 ปนกับ Daily) — ตอนนั้นควรเพิ่ม Key ID
ลง Envelope โดยขึ้น `VERSION` เป็น 2 และให้ Decrypt รองรับทั้ง 2 รูปแบบ (**ห้าม**
ทำให้ไฟล์เก่าถอดไม่ได้เด็ดขาด)

### 7.2 ใช้ Memory ~3-4 เท่าของขนาด Dump (ยังไม่เป็น Stream)

**สภาพปัจจุบัน:** `runPgDump` คืน Buffer ทั้งก้อน แล้ว `encryptBuffer` ทำ
`Buffer.concat` อีกหลายรอบ ทำให้ Peak Memory ประมาณ 3-4 เท่าของขนาดไฟล์ Dump
ที่ gzip แล้ว

**ทำไมพักไว้ได้ตอนนี้:** ข้อมูล Phase 2 (Beta) ยังเล็กมาก และ Dump ผ่าน gzip มา
แล้วจึงเล็กกว่าขนาดจริงหลายเท่า — ตัวเลขปัจจุบันห่างจากเพดาน Memory ของ Railway
มาก

**จะรอไม่ได้เมื่อ:** ขนาด Dump เริ่มแตะหลักร้อย MB — จุดที่ต้องระวังเป็นพิเศษคือ
**OOM จะ Kill Process ทั้งตัว ไม่ใช่โยน Error** แปลว่า `try/catch` ใน
`runNightlyBackup` รับไม่ได้ และ **จะไม่มี Push แจ้ง Admin ด้วย** (เงียบสนิท ต่างจาก
ความล้มเหลวแบบอื่นที่แจ้งเตือนเสมอ) จึงควรเฝ้าดูขนาดไฟล์บน R2 เป็นระยะ ถ้าเริ่มโต
ให้เปลี่ยนเป็น Stream ทั้งสาย (`pg_dump` stdout → gzip → `createCipheriv` →
Multipart Upload) ซึ่ง `createCipheriv` เป็น Transform Stream อยู่แล้ว ต่อท้าย gzip
ได้ตรงๆ ไม่ต้องเขียนอะไรใหม่มาก

### 7.3 ยังไม่มีการตรวจสอบอัตโนมัติว่าไฟล์ที่อัปโหลดถอดกลับได้จริง

**สภาพปัจจุบัน:** Job อัปโหลดเสร็จแล้วลบ Backup เก่าเกิน Retention ทันที โดยไม่ได้
ดาวน์โหลดไฟล์ที่เพิ่งอัปโหลดกลับมาลองถอดดูก่อน

**ทำไมพักไว้ได้ตอนนี้:** Round-trip ถูกพิสูจน์ด้วย Integration Test ทุกครั้งที่รัน
เทสต์ (Encrypt จริง → Decrypt จริง → เทียบ SHA-256) และ Retention 14 วันแปลว่ามี
Backup สำรองอีกหลายชุดเสมอ ต่อให้ไฟล์ล่าสุดมีปัญหาก็ยังไม่ได้เหลือชุดเดียว

**จะรอไม่ได้เมื่อ:** ลด Retention ลงเหลือน้อยกว่า ~3 วัน หรือหลังจากเจอเหตุการณ์ที่
ไฟล์บน R2 เสียหายจริง — ทางแก้คือหลัง Upload ให้ดาวน์โหลดกลับมา Decrypt + เทียบ
Checksum ก่อนจะเรียก `purgeOldBackups()` (ต้องเพิ่ม `downloadBackup()` ใน
`backupStorage.service.js` ซึ่งตอนนี้ยังไม่มี)

---

**Version:** 1.1.0 | **Last Updated:** 24 กรกฎาคม 2569

*Changelog: 1.1.0 — เพิ่ม Client-side Encryption (AES-256-GCM) § 2.2/§ 2.3,
ขั้นตอน Disaster Recovery ที่รันได้จริง § 3.4/§ 3.5 และ Known Limitations § 7*

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
