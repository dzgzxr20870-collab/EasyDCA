# ROADMAP.md — แผนการพัฒนา Phase 0–4

> แผนการพัฒนา EasyDCA ตั้งแต่ต้นจนถึงระบบเต็มรูปแบบ
> แต่ละ Phase ต้องเสร็จสมบูรณ์ก่อนเริ่ม Phase ถัดไป
> เน้นทำทีละขั้นตอนอย่างรอบคอบ ยอมเสร็จช้ากว่า แลกกับระบบที่ดีและมั่นคง

---

## ภาพรวม

```
Phase 0    — Architecture Design         [ปัจจุบัน]
Phase 0.5  — Security & Compliance
Phase 1    — LINE Bot Core (MVP)
Phase 2    — Web Dashboard + ชำระเงิน
Phase 3    — Admin Dashboard
Phase 4    — Premium+, AI Features, Bank API
```

---

## Phase 0 — Architecture Design

**เป้าหมาย:** วางรากฐานทางเทคนิคทั้งหมดก่อนเขียนโค้ดบรรทัดแรก

**สถานะ:** 🔄 กำลังดำเนินการ (เขียนเอกสาร docs/ อยู่)

### งานที่ต้องทำ

| งาน | รายละเอียด | สถานะ |
|---|---|---|
| เขียนเอกสาร docs/ | README, AI_CONTEXT, PRD, ROADMAP, DATABASE, SRS, SECURITY, BACKUP_AND_RECOVERY, UI_UX, CODING_STANDARD, DEPLOYMENT, TEST_PLAN, MARKETING, ENV_VARIABLES | 🔄 กำลังทำ |
| Database ER Diagram | ออกแบบ Schema ทุก Table พร้อม Relationship | ⏳ รอ |
| API Design | REST API spec, Versioning `/api/v1`, Response format | ⏳ รอ |
| Folder Structure | Monorepo: API, LINE Bot, Web Dashboard, Admin Dashboard, Shared Packages | ⏳ รอ |
| Git Workflow | Branch naming, Commit convention, PR process | ⏳ รอ |
| Coding Standard | ตกลง Style, Linting, Formatting rules | ⏳ รอ |
| Deployment Workflow | CI/CD Pipeline เบื้องต้น, Environment strategy | ⏳ รอ |
| Monitoring Plan | Error tracking, Uptime monitoring, Alert setup | ⏳ รอ |

### เกณฑ์ผ่าน Phase 0

- [ ] เอกสาร docs/ ครบทุกไฟล์ และ Review กับ GPT แล้ว
- [ ] ER Diagram อนุมัติแล้ว
- [ ] API Design Draft เสร็จแล้ว
- [ ] Folder Structure ตกลงแล้ว
- [ ] Git Workflow และ Coding Standard กำหนดแล้ว

---

## Phase 0.5 — Security & Compliance

**เป้าหมาย:** วางระบบความปลอดภัยก่อนมีข้อมูลผู้ใช้จริงเข้าระบบ

**สถานะ:** ⏳ รอ Phase 0 เสร็จ

### งานที่ต้องทำ

| งาน | รายละเอียด |
|---|---|
| Authentication | LINE Login + JWT — ออกแบบ Flow ให้รัดกุม |
| Authorization | Role-based Access Control (User, Admin roles) |
| Row Level Security | เปิด RLS ทุก Table บน Supabase ตั้งแต่เริ่ม |
| Encryption | เข้ารหัสข้อมูลสำคัญ (Encryption at rest) |
| Rate Limiting | ป้องกัน Spam และ Bot — LINE Webhook + API |
| Webhook Validation | LINE Webhook Signature Validation ทุก Request |
| Backup Strategy | ตั้งค่า Backup Schedule + Retention Policy |
| Disaster Recovery | เขียน Runbook สำหรับ Emergency scenarios |
| Privacy Policy | เขียนและ Publish ก่อนรับผู้ใช้จริง |
| Terms of Service | เขียนและ Publish ก่อนรับผู้ใช้จริง |
| Data Consent | ระบบขอ Consent การจัดเก็บข้อมูลผู้ใช้ |
| Data Deletion | ระบบรับคำขอลบข้อมูลตาม PDPA |
| Monitoring & Alert | ตั้งค่า Alert เมื่อระบบผิดปกติ |

### เกณฑ์ผ่าน Phase 0.5

- [ ] RLS เปิดและทดสอบแล้วทุก Table
- [ ] LINE Webhook Signature Validation ทำงานได้
- [ ] Rate Limiting ทำงานได้
- [ ] Backup ทำงานและทดสอบ Restore แล้ว
- [ ] Privacy Policy และ Terms of Service พร้อม Publish

---

## Phase 1 — LINE Bot Core

**เป้าหมาย:** MVP ที่ใช้งานได้จริง — ผู้ใช้บันทึกธุรกรรมและดูพอร์ตผ่าน LINE ได้

**สถานะ:** ⏳ รอ Phase 0.5 เสร็จ

**แพ็กเกจที่รองรับ:** Free + Premium

### คำสั่งภาษาไทยที่รองรับ

| คำสั่ง | ตัวอย่าง | คำอธิบาย |
|---|---|---|
| ซื้อ | `ซื้อ BTC 1000` | บันทึกการซื้อด้วยจำนวนเงิน |
| ซื้อ (ระบุราคา) | `ซื้อ PTT 50 หุ้น ราคา 34` | บันทึกการซื้อด้วยจำนวนหน่วยและราคา |
| ขาย | `ขาย BTC 500` | บันทึกการขาย |
| พอต / พอร์ต | `พอต` | ดูสรุปพอร์ตปัจจุบัน |
| กำไร | `กำไร BTC` | ดูกำไร/ขาดทุนของสินทรัพย์นั้น |
| ประวัติ | `ประวัติ` | ดูประวัติธุรกรรมล่าสุด |
| ยกเลิก | `ยกเลิก` | ยกเลิกรายการล่าสุด |

### ฟีเจอร์ที่ต้องพัฒนา

| ฟีเจอร์ | Package | รายละเอียด |
|---|---|---|
| Command Parser | Free + | แปลงคำสั่งภาษาไทยเป็น Transaction |
| Flex Message | Free + | ตอบกลับพร้อมปุ่ม Confirm / แก้ไข |
| Freemium Limit | Free | จำกัด 2 สินทรัพย์ แจ้งเตือนให้อัพเกรดเมื่อครบ |
| Rich Menu | Free + | เพิ่มรายการ, พอร์ต, ประวัติ, Premium, ตั้งค่า |
| DCA Reminder | Free (1), Premium (ไม่จำกัด) | แจ้งเตือน DCA ประจำเดือน |
| Weekly Summary | Premium | ส่งสรุปพอร์ตรายสัปดาห์อัตโนมัติ |
| Monthly Summary | Premium | ส่งสรุปพอร์ตรายเดือนอัตโนมัติ |
| Premium Expiry Alert | Premium | แจ้งเตือน 3 วัน / วันหมด / ทุก 2 วันใน Grace Period / วันสุดท้าย |
| Command History | Free + | ยกเลิกรายการล่าสุด / ย้อนกลับการบันทึก |
| User Settings | Free + | สกุลเงิน, ภาษา, เขตเวลา, เปิด/ปิดแจ้งเตือน |

### เกณฑ์ผ่าน Phase 1

- [ ] รับคำสั่งภาษาไทยและบันทึก Transaction ได้ถูกต้อง
- [ ] Freemium Limit ทำงานได้ (Free จำกัด 2 สินทรัพย์)
- [ ] Flex Message แสดงผลถูกต้องและปุ่มทำงานได้
- [ ] Rich Menu แสดงและใช้งานได้
- [ ] DCA Reminder ส่งอัตโนมัติตามกำหนด
- [ ] ทดสอบกับผู้ใช้จริงอย่างน้อย 10 คน (Beta)

---

## Phase 2 — Web Dashboard + ระบบชำระเงิน

**เป้าหมาย:** Web Dashboard เต็มรูปแบบ + ระบบรับชำระเงิน Manual

**สถานะ:** ⏳ รอ Phase 1 เสร็จ

**แพ็กเกจที่รองรับ:** Free (Demo) + Premium (เต็มรูปแบบ)

### หน้าที่ต้องพัฒนา

**หน้า Dashboard (Premium)**

| Section | ข้อมูลที่แสดง |
|---|---|
| Portfolio Value | มูลค่าพอร์ตปัจจุบัน vs เงินต้น |
| P&L Summary | Unrealized / Realized Profit/Loss, ROI รวม |
| Portfolio Allocation | Pie Chart สัดส่วนสินทรัพย์ |
| Asset Performance | กราฟกำไร/ขาดทุนแยกรายสินทรัพย์ |
| Monthly Investment | เงินที่ลงทุนรายเดือน |
| Multiple Portfolio | สลับดูแต่ละพอร์ต หรือรวมทุกพอร์ต |

**หน้า Asset Detail (Premium)**

| Section | ข้อมูลที่แสดง |
|---|---|
| Holding Info | จำนวนที่ถือครอง, Average Cost, ราคาปัจจุบัน |
| Performance | กำไร/ขาดทุน %, จำนวนครั้งที่ซื้อ |
| Price Chart | กราฟราคา |
| Transaction History | ประวัติซื้อ/ขายทั้งหมดของสินทรัพย์นี้ |

**ฟีเจอร์เสริม (Premium)**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| Investment Goal | ตั้งได้ 1 เป้าหมาย พร้อม Progress Bar |
| Portfolio Timeline | เหตุการณ์การลงทุนแบบ Feed |
| Watchlist | ติดตามสินทรัพย์ที่สนใจ |
| ค้นหา | ค้นหาสินทรัพย์ / ประวัติธุรกรรม |
| Portfolio Snapshot | บันทึกมูลค่าพอร์ตทุกวัน (Scheduled Job) |

**ระบบชำระเงิน**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| หน้าเลือกแพ็กเกจ | แสดง Free / Premium พร้อมราคาและฟีเจอร์ |
| อัพโหลดสลิป | อัพโหลดในเว็บหรือส่งใน LINE OA |
| AI Fraud Detection | ตรวจสลิปซ้ำ, ยอดไม่ตรง, สลิปหมดอายุ |
| Payment Queue | Pending → Reviewing → Approved / Rejected / Expired |
| LINE Notify | แจ้ง Admin ทันทีเมื่อมีสลิปเข้า |
| Auto Unlock | Approve แล้ว Unlock Premium อัตโนมัติ |

**Demo Dashboard (Free)**
- หน้าตัวอย่าง Web UI สำหรับผู้ใช้ Free
- แสดงข้อมูลสมมติเพื่อกระตุ้นการอัพเกรด
- มีปุ่ม "อัพเกรดเป็น Premium" ที่ชัดเจน

### เกณฑ์ผ่าน Phase 2

- [ ] LINE Login (LIFF) ทำงานได้
- [ ] Dashboard แสดงข้อมูลพอร์ตถูกต้อง
- [ ] อัพโหลดสลิปและ Admin Approve ทำงานได้
- [ ] Unlock Premium อัตโนมัติหลัง Approve
- [ ] Portfolio Snapshot Job รันทุกวัน
- [ ] Demo Dashboard แสดงผลถูกต้อง

---

## Phase 3 — Admin Dashboard

**เป้าหมาย:** เครื่องมือจัดการระบบสำหรับทีมงาน

**สถานะ:** ⏳ รอ Phase 2 เสร็จ

**เข้าได้เฉพาะทีมงาน — ไม่ใช่ผู้ใช้ทั่วไป**

### Admin Roles

| Role | สิทธิ์ |
|---|---|
| Super Admin | เข้าถึงทุกส่วน |
| Admin | จัดการ User และชำระเงิน |
| Developer | ดู Logs และระบบ |
| Support | ดูข้อมูล User เพื่อช่วยแก้ปัญหา |
| Finance | ดูรายได้และค่าใช้จ่าย |

### ฟีเจอร์ที่ต้องพัฒนา

**Analytics Dashboard**

| ข้อมูล | รายละเอียด |
|---|---|
| User Stats | จำนวน User ทั้งหมด, DAU, MAU |
| Conversion | Conversion Rate Free → Premium |
| Revenue | รายได้รายวัน/เดือน/ปี, ARPU |
| Usage | จำนวนธุรกรรมต่อวัน, สินทรัพย์ยอดนิยม |
| AI Stats | จำนวนการส่งสลิป AI (Phase 4) |

**System Health**

| ข้อมูล | รายละเอียด |
|---|---|
| Health Dashboard | สถานะ API Server, Database, Webhook, Notification Queue แบบ Real-time |
| Error Log Dashboard | รวม Error จาก Webhook, Parser, Database, Payment |

**จัดการระบบ**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| Payment Management | ดู Queue, Approve/Reject สลิป |
| Broadcast Message | ส่งประกาศไปยัง Free / Premium / ใกล้หมดอายุ |
| Audit Log | บันทึกทุก Admin Action: Approve/Reject Premium, แก้ไขข้อมูล User, เปลี่ยนสิทธิ์ทีมงาน, ลบข้อมูล |

### เกณฑ์ผ่าน Phase 3

- [ ] Role-based Access Control ทำงานถูกต้องทุก Role
- [ ] Analytics Dashboard แสดงข้อมูลถูกต้อง
- [ ] Health Dashboard แสดง Status แบบ Real-time
- [ ] Audit Log บันทึกทุก Admin Action
- [ ] Broadcast Message ส่งถึงผู้ใช้กลุ่มที่เลือกได้

---

## Phase 4 — Premium+ และ AI Features

**เป้าหมาย:** เปิดตัว Premium+, AI Features ขั้นสูง, ระบบชำระเงินอัตโนมัติ

**สถานะ:** ⏳ รอ Phase 3 เสร็จ

> **หมายเหตุสำคัญ:** Phase 4 ทั้งหมดต้องผ่านการทดสอบและปรับปรุง
> อย่างรอบคอบก่อนนำไป Deploy ใช้งานจริง ไม่รีบปล่อยทันทีที่พัฒนาเสร็จ

### เปิดตัว Premium+

**Hero Features ที่ต้องพัฒนา:**

**1. Goal-Based DCA Planner หลายเป้าหมาย**
- ตั้งเป้าหมายได้ไม่จำกัด (ดาวน์รถ, เที่ยว, การศึกษา, เกษียณ ฯลฯ)
- ระบบคำนวณว่าต้องออม/เดือนเท่าไหร่ถึงจะถึงเป้า
- เปรียบเทียบสินทรัพย์หลายแบบสำหรับแต่ละเป้าหมาย
- แจ้งเตือนเมื่อหลุดแผน พร้อมแนะนำปรับแผนใหม่

**2. AI Financial Journal**
- AI สรุปผลการลงทุนเป็นภาษาธรรมชาติทุกสัปดาห์/เดือน
- ครอบคลุม: เงินลงทุนทั้งหมด, กำไร/ขาดทุน, สินทรัพย์ที่เติบโตดีที่สุด, ความสม่ำเสมอในการทำ DCA
- **ต้องยึดกฎเหล็ก:** ห้ามแนะนำซื้อขาย ใช้ภาษาเชิงข้อเท็จจริงเท่านั้น

**3. Annual Investment Report**
- PDF สไตล์ Spotify Wrapped ประจำปี
- ข้อมูล: เงินลงทุนทั้งปี, ผลตอบแทนรวม, จำนวนครั้งที่ลงทุน, สินทรัพย์ที่ดีที่สุด, เดือนที่ลงทุนต่อเนื่อง, สถิติการใช้ EasyDCA
- ดาวน์โหลดและแชร์ได้ (ช่วย Viral Marketing)

### AI อ่านสลิป (Premium)

รองรับสลิปจาก:
`Bitkub, Binance, Bybit, OKX, Settrade, Streaming, InnovestX, Dime!, FINNOMENA`

ใช้ Claude API สำหรับ Vision/OCR

### Portfolio Replay

Time Machine ดูพอร์ตย้อนหลังแบบ Interactive
ใช้ข้อมูลจาก `portfolio_snapshots` ที่บันทึกรายวันตั้งแต่ Phase 2

### Bank API (ระบบชำระเงินอัตโนมัติ)

- เชื่อม SCB Easy API / KBank KProxy
- ยืนยันการชำระเงินอัตโนมัติ 100% ไม่ต้องส่งสลิป
- ต้องสมัคร Business Account ล่วงหน้า (อนุมัติ 2–4 สัปดาห์)
- **แนะนำ:** เริ่มสมัครคู่ขนานไปกับการพัฒนา Phase 1–2

### ฟีเจอร์ที่เก็บไว้พิจารณา (Phase 4 ปลายๆ)

**Portfolio Health Score**
- ระบบ AI ให้คะแนนสุขภาพพอร์ต เช่น 82/100
- มีความเสี่ยงด้านกฎหมายสูงที่สุด — ต้องปรึกษาเรื่อง Wording ก่อนพัฒนา
- สถานะ: **ยังไม่ตัดสินใจ**

### เกณฑ์ผ่าน Phase 4

- [ ] Premium+ เปิดตัวพร้อม Hero Features ทั้ง 3
- [ ] AI Financial Journal ผ่านการทดสอบ Wording ว่าไม่แนะนำลงทุน
- [ ] Annual Investment Report สร้างและดาวน์โหลดได้
- [ ] AI อ่านสลิปได้ถูกต้องอย่างน้อย 95%
- [ ] Portfolio Replay ทำงานได้

---

## งบประมาณโดยประมาณ

| Phase | งบ/เดือน | หมายเหตุ |
|---|---|---|
| Phase 0–1 | ~1,000–1,200฿ | ใช้ Free Tier เกือบทั้งหมด |
| Phase 2–3 | ~900–1,500฿ | เริ่มมี Railway Starter |
| เปิด Beta | ~2,100฿ | LINE OA Basic เริ่มใช้ |
| Production จริง | ~3,000–4,000฿ | ตาม User ที่เพิ่มขึ้น |

**จุดคุ้มทุน:**
- ต้นทุนคงที่ ~2,100฿/เดือน (ช่วง Beta)
- Premium 99฿/เดือน → ต้องการผู้ใช้จ่ายจริง 22 คน
- ถ้า Conversion Rate 20% → ต้องมี User รวม 110 คน

---

## สิ่งที่ต้องเตรียมก่อนเริ่ม Phase 1

- [ ] สมัคร LINE Developer Account
- [ ] สมัคร Supabase
- [ ] สมัคร Railway
- [ ] ตั้งค่า Environment Variables ตาม [ENV_VARIABLES.md](./ENV_VARIABLES.md)
- [ ] Phase 0 และ Phase 0.5 เสร็จสมบูรณ์

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
