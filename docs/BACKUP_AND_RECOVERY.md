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
- ⚠️ **ยังไม่เข้ารหัสไฟล์ Backup แยกต่างหาก** (Encrypted Archive) ก่อนอัปโหลด
  ในรอบ Implement นี้ — พึ่ง Encryption at Rest ของ Cloudflare R2 เอง (Data
  เข้ารหัสอยู่แล้วบน Storage ฝั่ง Provider) แต่ยังไม่มี Client-side
  Encryption เพิ่มอีกชั้นตามที่ระบุไว้เดิมในเอกสารนี้ — ควรพิจารณาเพิ่มก่อน
  Production จริงที่มีข้อมูลผู้ใช้จำนวนมาก (Bucket ตั้ง Private เท่านั้น
  ไม่ Public Access เป็นการป้องกันชั้นแรกที่มีอยู่แล้ว)
- **Retention:** เก็บ 14 วันล่าสุด (Default — Override ได้ผ่าน
  `BACKUP_RETENTION_DAYS`) ลบของเก่ากว่านั้นทิ้งอัตโนมัติทุกรอบที่ Backup
  สำเร็จ (`purgeOldBackups`)
- **แจ้งเตือนถ้า Backup ล้มเหลว:** Push หา Admin ทันทีผ่านกลไกเดียวกับ
  Critical Alert (§ 9.4 ใน [SECURITY.md](./SECURITY.md)) — ไม่ใช่แค่ Log เงียบๆ
- ไฟล์ Backup ที่ Export ออกมาต้องเข้ารหัสก่อนเก็บ (Encrypted Archive)
  เนื่องจากมีข้อมูลส่วนบุคคลของผู้ใช้อยู่ในนั้น — ดูหมายเหตุด้านบน (ยังไม่
  Implement ส่วนนี้)
- **จำนวนชุดขั้นต่ำ:** เก็บอย่างน้อย 2 ชุดล่าสุดในที่เก็บสำรอง (คนละ
  สถานที่จาก Supabase) เพื่อไม่ให้พึ่งพา Backup ชุดเดียว — Retention 14 วัน
  ด้านบนรับประกันข้อนี้อยู่แล้วตราบใดที่ Backup รันสำเร็จอย่างน้อย 2
  ครั้งใน 14 วัน

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

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
