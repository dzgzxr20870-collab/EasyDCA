# TEST_PLAN.md — แผนการทดสอบ

> เอกสารนี้กำหนดกลยุทธ์และ Test Case หลักของ EasyDCA อ้างอิงคำสั่ง
> LINE Bot จาก [ROADMAP.md](./ROADMAP.md), Flow ทางเทคนิคจาก
> [SRS.md](./SRS.md) และมาตรการความปลอดภัยจาก
> [SECURITY.md](./SECURITY.md) ใช้คู่กับ Pre-deploy Checklist ใน
> [DEPLOYMENT.md § 8](./DEPLOYMENT.md)

---

## 1. Test Strategy ภาพรวม

ทีมพัฒนาขนาดเล็ก (ดู [PROJECT_BRIEF.md § 3](../PROJECT_BRIEF.md))
จึงออกแบบ Testing Pyramid ให้เน้นน้ำหนักไปที่ระดับล่างซึ่งเขียนและ
Maintain ได้เร็วกว่า แทนที่จะทำ E2E ครอบคลุมทุกกรณี

```
        ▲
       /E2E\          น้อยที่สุด — เฉพาะ Flow สำคัญที่กระทบเงิน/ข้อมูลผู้ใช้
      /------\
     /Integr. \       ปานกลาง — ทดสอบ API + Database (รวม RLS) จริง
    /----------\
   /   Unit     \     มากที่สุด — Business Logic ล้วนๆ รันเร็ว ไม่พึ่ง Network
  /--------------\
```

### 1.1 Unit Test

- **ขอบเขต:** ฟังก์ชันคำนวณและ Logic ล้วนๆ ที่ไม่พึ่งพา Database/Network
  เช่น การคำนวณ Average Cost/ROI/P&L, Command Parser (Pattern
  Matching), การตรวจสอบ Freemium Limit, การตรวจสอบ Grace Period
- **เครื่องมือ:** Jest (มาตรฐาน Node.js/React)
- **เป้าหมาย:** รันเร็ว (วินาที) รันได้ทุกครั้งก่อน Commit และใน CI
  ทุก PR (ดู [DEPLOYMENT.md § 5.1](./DEPLOYMENT.md))

### 1.2 Integration Test

- **ขอบเขต:** ทดสอบ API Endpoint จริงคู่กับ Supabase Project สำหรับ
  ทดสอบโดยเฉพาะ (ไม่ Mock Database) เพื่อให้ครอบคลุม RLS Policy จริงด้วย
  — ครอบคลุม Payment Flow, Auth Flow, Webhook Signature Validation
- **เครื่องมือ:** Jest + Supertest (เรียก Express App ตรงๆ) และ
  Supabase Test Project แยกต่างหาก (ไม่ใช้ Production/Staging DB)
- **เป้าหมาย:** รันใน CI ก่อน Merge เข้า `develop`/`main`

### 1.3 E2E Test

- **ขอบเขต:** จำกัดเฉพาะ Flow ที่สำคัญที่สุดที่กระทบเงินหรือข้อมูลผู้ใช้
  โดยตรง:
  1. บันทึกธุรกรรมผ่าน LINE Bot ครบ Flow (Parse → Confirm → บันทึก)
  2. อัพโหลดสลิป → Admin Approve → Unlock Premium
  3. Login ผ่าน LIFF → เห็น Dashboard ถูกต้อง
- **เครื่องมือ:**
  - Web Dashboard: Playwright (Phase 2 เมื่อเริ่มมี Web UI จริง)
  - LINE Bot: จำลอง Webhook Event ด้วย Script ที่คำนวณ HMAC Signature
    ให้ถูกต้องแล้วยิง Request เข้า Local/Staging Endpoint ตรง (Automate
    ได้เต็มรูปแบบ ไม่ต้องพึ่ง LINE App จริงระหว่างพัฒนา) ส่วนการทดสอบ
    ผ่าน LINE App จริงทำแบบ Manual ก่อน Launch แต่ละ Phase (ดูหัวข้อ 7)
- **เป้าหมาย:** รันก่อน Deploy Production ทุกครั้งที่มีการเปลี่ยนแปลง
  Flow หลัก ไม่จำเป็นต้องรันทุก PR

### 1.4 Manual Testing

ฟีเจอร์ที่ทดสอบอัตโนมัติได้ยาก (UI/UX จริงบน Mobile, การแสดงผล Flex
Message บน LINE App จริง) ให้ทดสอบด้วยมือตาม Checklist ก่อน Launch
แต่ละ Phase (หัวข้อ 7) โดย Beta Tester อย่างน้อย 10 คนตามเกณฑ์ผ่าน
Phase 1 ใน ROADMAP.md

---

## 2. Test Case หลักของแต่ละฟีเจอร์

### 2.1 Phase 1 — LINE Bot Core

| ฟีเจอร์ | Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|---|
| Command Parser | ส่ง `ซื้อ BTC 1000` | Parse เป็น BUY, symbol=BTC, amount_thb=1000 |
| Command Parser | ส่ง `ขาย PTT 50 หุ้น ราคา 34` | Parse เป็น SELL, symbol=PTT, quantity=50, price=34 |
| Command Parser | ส่ง `พอต` | คืน Flex Message สรุปพอร์ตปัจจุบัน |
| Command Parser | ส่ง `กำไร BTC` | คืน P&L เฉพาะ BTC |
| Command Parser | ส่ง `ประวัติ` | คืนรายการธุรกรรมล่าสุด |
| Command Parser | ส่ง `ยกเลิก` | ยกเลิก Transaction ล่าสุดของ User |
| Freemium Limit | User Free มี Asset ครบ 2 แล้ว เพิ่ม Symbol ที่ 3 | ปฏิเสธ พร้อม Flex Message แจ้งอัพเกรด (`ASSET_LIMIT_REACHED`) |
| Flex Message Confirm | ส่งคำสั่งซื้อ/ขายที่ Parse สำเร็จ | แสดงปุ่ม [ยืนยัน][แก้ไข][ยกเลิก] ตาม UI_UX.md § 3.1 |
| Rich Menu | เปิด LINE OA ครั้งแรก | แสดง Rich Menu พร้อมปุ่มครบตาม PRD.md |
| DCA Reminder | ถึงวันที่ตั้งใน `dca_reminder_day` | ได้รับข้อความแจ้งเตือนตรงเวลา (08:00) |
| Command History | ยกเลิกรายการล่าสุดหลังบันทึกไปแล้ว | Transaction ตรงข้ามถูกสร้าง ยอดพอร์ตกลับสู่ค่าก่อนหน้า |

### 2.2 Phase 2 — Web Dashboard + ชำระเงิน

| ฟีเจอร์ | Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|---|
| LIFF Login | เปิด Web Dashboard ครั้งแรก | Redirect ไป LINE Login แล้วสร้าง/Login User สำเร็จ |
| Portfolio Dashboard | User Premium มีหลายพอร์ต | สลับดูรายพอร์ต/รวมทุกพอร์ตได้ถูกต้อง |
| Asset Detail | คลิกสินทรัพย์จาก Dashboard | แสดงข้อมูลตรงกับ Transaction ที่มีอยู่จริง |
| Investment Goal | ตั้งเป้าหมายใหม่ | Progress Bar คำนวณถูกต้องตาม `current_amount`/`target_amount` |
| Portfolio Snapshot | Cron รันทุกวัน 00:05 | มี Record ใหม่ใน `portfolio_snapshots` ทุกวันไม่ขาด |
| Demo Dashboard | User Free เปิด Demo Dashboard | เห็น Mock Data + ส่วน Premium ถูก Blur พร้อม CTA อัพเกรด |
| Export | User Premium กด Export | ได้ไฟล์ Excel/PDF ที่ข้อมูลตรงกับ Dashboard |

---

## 3. การทดสอบ Command Parser (Pattern Matching)

อ้างอิง Pattern จาก [SRS.md § 2.2](./SRS.md) ทดสอบทั้งกรณีปกติและ Edge
Case:

| Input | คาดว่า Parse ได้ | หมายเหตุ |
|---|---|---|
| `ซื้อ BTC 1000` | BUY, BTC, 1000 บาท | Basic Case |
| `ซื้อ  BTC   1000` (Whitespace เกิน) | BUY, BTC, 1000 บาท | ต้อง Normalize Whitespace ก่อน Match |
| `ซื้อ ptt 500` (พิมพ์เล็ก) | BUY, PTT, 500 บาท | Normalize เป็น lowercase ก่อนเทียบ แต่เก็บ Symbol เป็นตัวพิมพ์ใหญ่ |
| `ซื้อ BTC ๑๐๐๐` (เลขไทย) | BUY, BTC, 1000 บาท | ต้องแปลงเลขไทย → Arabic ก่อน Parse |
| `ซื้อ BTC 1,000` (มี Comma) | BUY, BTC, 1000 บาท | Regex ต้องรองรับ Comma คั่นหลักพัน |
| `ขาย PTT 50 หุ้น ราคา 34` | SELL, PTT, quantity=50, price=34 | Pattern ระบุราคาต่อหน่วย |
| `ซื้อ 1000` (ไม่มี Symbol) | Parse ไม่สำเร็จ | ต้องส่ง Help Message ไม่ Crash |
| `ซื้อ BTC` (ไม่มีจำนวนเงิน) | Parse ไม่สำเร็จ | ส่ง Help Message พร้อมตัวอย่างที่ถูกต้อง |
| `ฃื้อ BTC 1000` (พิมพ์ผิด) | Parse ไม่สำเร็จ | ตกไปที่ Help Message ไม่ตีความมั่ว |
| `ข้อความสุ่มไม่เกี่ยวข้อง` | `COMMAND_NOT_FOUND` | ส่ง Help Message ตาม SRS.md § 6.3 |
| `พอต` / `พอร์ต` / `portfolio` | PORTFOLIO command | รองรับคำพ้องความหมายตาม SRS.md § 2.2 |

**หลักการทดสอบ:** Unit Test ของ Command Parser ต้อง Cover ทุกแถวใน
ตารางนี้เป็นอย่างน้อย และเพิ่ม Test Case ใหม่ทุกครั้งที่พบ Pattern
แปลกที่ผู้ใช้จริงพิมพ์เข้ามาแล้ว Parse ผิดพลาด (Regression Test)

---

## 4. การทดสอบ Payment Flow (Upload Slip → Admin Approve)

อ้างอิง Flow จาก [SRS.md § 4](./SRS.md)

| ขั้นตอน | Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|---|
| Upload — ไฟล์ถูกต้อง | อัพโหลด .jpg ขนาด 1MB | สร้าง Payment Record สถานะ `pending`, แจ้ง Admin ผ่าน LINE Notify |
| Upload — ไฟล์ผิดชนิด | อัพโหลด .pdf | ปฏิเสธด้วย `INVALID_FILE_TYPE` (400) |
| Upload — ไฟล์ใหญ่เกิน | อัพโหลดไฟล์ 8MB | ปฏิเสธด้วย `FILE_TOO_LARGE` (400) |
| Upload — สลิปซ้ำ | อัพโหลดไฟล์ที่มี Hash ตรงกับ Payment เดิม | ปฏิเสธด้วย `DUPLICATE_SLIP` (400) |
| Admin Approve | Admin กด Approve รายการ `pending` | `status → approved`, `user.plan → premium`, `plan_expires_at` อัพเดทถูกต้อง, ผู้ใช้ได้รับ LINE แจ้งสำเร็จ, มี `audit_log` (`approve_payment`) |
| Admin Reject | Admin กด Reject พร้อมระบุเหตุผล | `status → rejected`, `reject_reason` ถูกบันทึก, ผู้ใช้ได้รับ LINE แจ้งพร้อมเหตุผล, มี `audit_log` (`reject_payment`) |
| Payment Expiry | Payment สถานะ `pending`/`reviewing` เกิน 48 ชั่วโมง | Cron Job เปลี่ยนสถานะเป็น `expired` อัตโนมัติ (SRS.md § 5.1) |
| Approve ล้มเหลวกลางทาง | จำลอง Database Error ระหว่าง Unlock Premium | Transaction Rollback ทั้งหมด (ไม่ใช่ Payment อัพเดทแต่ User ไม่ Unlock), บันทึก Critical Error + แจ้ง Admin (SRS.md § 6.4) |
| Rate Limit | อัพโหลดสลิปเกิน 5 ครั้งใน 10 นาที | ตอบกลับ `429` พร้อม `Retry-After` |

---

## 5. การทดสอบ Security พื้นฐาน

อ้างอิงมาตรการจาก [SECURITY.md](./SECURITY.md)

### 5.1 Row Level Security (RLS)

| Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|
| User A พยายาม SELECT ข้อมูล `transactions` ของ User B ผ่าน Client (`authenticated` role) | ไม่คืนข้อมูลใดๆ (Empty Result เพราะ RLS กรองออก) |
| User A พยายาม UPDATE/DELETE Record ของ User B | ปฏิเสธ (0 Row Affected) |
| Role `anon` พยายามเข้าถึง Table ใดๆ โดยตรง | ปฏิเสธทั้งหมด |
| Backend (`service_role`) อ่าน/เขียนข้าม User (เช่น Cron Job สร้าง Snapshot) | สำเร็จ (Bypass RLS ตามที่ออกแบบไว้) |
| ผู้ใช้ทั่วไปพยายามอ่าน `audit_logs`/`system_logs` | ไม่มี Policy ให้เข้าถึง ปฏิเสธทั้งหมด |

### 5.2 LINE Webhook Signature Validation

| Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|
| Signature ถูกต้องตรงกับ Body | ประมวลผล Event ปกติ |
| Signature ไม่ตรงกับ Body (ปลอมแปลง) | คืน `401`, ไม่ประมวลผล Event, บันทึก `system_log` (`type=warning`) |
| ไม่มี Header `x-line-signature` มาเลย | คืน `401` ทันที |
| Body ถูกแก้ไขหลังคำนวณ Signature (Replay/Tamper) | Signature ไม่ตรง → คืน `401` |

### 5.3 Rate Limiting

| Endpoint | Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|---|
| `POST /api/v1/auth/line` | ยิง Request เกิน 10 ครั้ง/นาที จาก IP เดียว | ครั้งที่เกิน Limit ได้ `429` พร้อม `Retry-After` |
| `POST /api/v1/transactions` | User เดียวยิงเกิน 30 ครั้ง/นาที | ได้ `429` เฉพาะ User นั้น ไม่กระทบ User อื่น |
| `POST /api/v1/payments/upload-slip` | เกิน 5 ครั้ง/10 นาที | ได้ `429` ตาม Limit เข้มกว่า Endpoint ทั่วไป |

---

## 6. การทดสอบ Freemium Limit และ Premium Expiry Flow

### 6.1 Freemium Limit

| Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|
| Free User เพิ่ม Asset ตัวที่ 1–2 | สำเร็จปกติ |
| Free User เพิ่ม Asset ตัวที่ 3 (Symbol ใหม่) | ปฏิเสธ `ASSET_LIMIT_REACHED` พร้อม CTA อัพเกรด |
| Free User เพิ่มธุรกรรมใหม่ให้ Asset เดิมที่มีอยู่แล้ว (ไม่ใช่ Symbol ใหม่) | สำเร็จ — ไม่นับเป็นการเพิ่ม Asset ใหม่ |
| User อัพเกรดเป็น Premium ระหว่างที่ติด Limit | เพิ่ม Asset ใหม่ได้ทันทีไม่จำกัดจำนวน |

### 6.2 Premium Expiry Flow (อ้างอิง SRS.md § 5.4)

| Test Case | ผลลัพธ์ที่คาดหวัง |
|---|---|
| `plan_expires_at` อีก 3 วันจะหมดอายุ | ได้รับแจ้งเตือน "จะหมดอายุในอีก 3 วัน" |
| `plan_expires_at` = วันนี้ | เริ่ม Grace Period, ได้รับแจ้งเตือน, ยังบันทึก/ดูข้อมูลได้ปกติ |
| อยู่ใน Grace Period วันที่ 2/4/6 | ได้รับแจ้งเตือนสถานะ Grace Period ตามรอบ |
| อยู่ใน Grace Period — User พยายามบันทึกธุรกรรมใหม่ | ปฏิเสธด้วย `PLAN_EXPIRED` แต่ยัง SELECT ดูข้อมูลเดิมได้ |
| พ้น Grace Period (วันที่ 7) | `is_locked = true`, ได้รับแจ้งเตือนด่วน, ข้อมูลถูกล็อค (ไม่ใช่ลบ) |
| User ต่ออายุขณะอยู่ใน Grace Period หรือหลังถูกล็อค | `is_locked = false`, Unlock ข้อมูลทันที, `plan_expires_at` อัพเดทถูกต้อง |
| ตรวจสอบว่าไม่มีข้อมูลผู้ใช้ถูกลบในทุกกรณีของ Flow นี้ | ข้อมูลยังอยู่ครบตามหลักการ "ห้ามลบข้อมูลผู้ใช้" |

---

## 7. Checklist ก่อน Launch จริงทุกครั้ง

ผูกกับ **เกณฑ์ผ่านแต่ละ Phase** ใน [ROADMAP.md](./ROADMAP.md) — ก่อน
ประกาศว่า Phase ใด "จบแล้ว" และเปิดให้ผู้ใช้จริงใช้งาน ต้องผ่านครบ
ทั้งเกณฑ์เฉพาะ Phase นั้น และ Checklist ทั่วไปด้านล่าง

### 7.1 Checklist ทั่วไป (ทุก Phase)

- [ ] Test Case ทั้งหมดในหัวข้อ 2–6 ที่เกี่ยวข้องกับ Phase นี้ผ่านครบ
- [ ] Pre-deploy Checklist ใน [DEPLOYMENT.md § 8](./DEPLOYMENT.md)
      ผ่านครบ
- [ ] ไม่มี Critical/High Bug ค้างอยู่ใน Backlog
- [ ] Backup ล่าสุดทำสำเร็จและทดสอบ Restore ได้จริงตาม
      [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md)
- [ ] Monitoring/Alert (SECURITY.md § 9) Active และเคยทดสอบยิง Critical
      Alert จริงอย่างน้อย 1 ครั้งว่าถึง Admin จริง

### 7.2 เกณฑ์เฉพาะ Phase (อ้างอิงจาก ROADMAP.md)

| Phase | เกณฑ์ผ่านหลัก |
|---|---|
| Phase 0 | เอกสาร docs/ ครบทุกไฟล์และ Review แล้ว, ER Diagram/API Design/Folder Structure ตกลงแล้ว |
| Phase 0.5 | RLS เปิดและทดสอบแล้วทุก Table, Webhook Signature Validation ทำงานได้, Rate Limiting ทำงานได้, Backup/Restore ทดสอบแล้ว, Privacy Policy/Terms of Service พร้อม Publish |
| Phase 1 | คำสั่งภาษาไทยบันทึก Transaction ถูกต้อง, Freemium Limit ทำงานได้, Flex Message/Rich Menu ใช้งานได้, DCA Reminder ส่งตรงเวลา, **ทดสอบกับผู้ใช้จริงอย่างน้อย 10 คน (Beta)** |
| Phase 2 | LIFF Login ทำงานได้, Dashboard แสดงข้อมูลถูกต้อง, อัพโหลดสลิป+Admin Approve+Unlock อัตโนมัติทำงานได้, Portfolio Snapshot รันทุกวัน, Demo Dashboard แสดงผลถูกต้อง |
| Phase 3 | Role-based Access Control ถูกต้องทุก Role, Analytics/Health Dashboard แสดงข้อมูลถูกต้อง, Audit Log บันทึกครบ, Broadcast Message ส่งถูกกลุ่ม |
| Phase 4 | Premium+ Hero Features ครบ, AI Financial Journal ผ่านการทดสอบ Wording ว่าไม่แนะนำลงทุน, Annual Report สร้าง/ดาวน์โหลดได้, AI อ่านสลิปแม่นยำ ≥ 95%, Portfolio Replay ทำงานได้ |

**กฎสำคัญ:** ห้าม Launch Phase ใดที่ยังไม่ผ่านเกณฑ์ครบทุกข้อ
โดยเฉพาะ Phase 4 (Premium+/AI ขั้นสูง) ที่ [ROADMAP.md](./ROADMAP.md)
ย้ำชัดว่าต้องผ่านการทดสอบและปรับปรุงอย่างรอบคอบก่อนนำไป Deploy ใช้งาน
จริงเสมอ ไม่รีบปล่อยทันทีที่พัฒนาเสร็จ

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
