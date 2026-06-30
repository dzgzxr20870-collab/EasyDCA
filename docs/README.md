# EasyDCA — ภาพรวมโปรเจค

EasyDCA คือ Personal Investment Platform สำหรับนักลงทุนสาย DCA ชาวไทย
ที่ต้องการติดตามพอร์ตลงทุนแบบง่าย ผ่านช่องทางที่ใช้อยู่ทุกวันอย่าง LINE

---

## ปัญหาที่แก้

นักลงทุนสาย DCA ซื้อสินทรัพย์สม่ำเสมอทุกเดือน แต่ขาดเครื่องมือติดตามที่
สะดวก ส่วนใหญ่ต้องใช้ Excel หรือจดมือเอง ทำให้ไม่เห็นภาพรวมพอร์ตที่แท้จริง
ไม่รู้กำไรขาดทุนที่ชัดเจน

EasyDCA แก้ปัญหานี้โดยให้ผู้ใช้บันทึกผ่าน LINE OA ด้วยการพิมข้อความสั้นๆ
หรือส่งรูปสลิป ระบบจัดการคำนวณและแสดงผลให้อัตโนมัติ ทั้งใน LINE และ
Web Dashboard

---

## กลุ่มเป้าหมาย

นักลงทุนชาวไทยที่ลงทุนแบบ DCA ในสินทรัพย์หลากหลายประเภท ไม่ว่าจะเป็น
Crypto, หุ้นไทย, หุ้นต่างประเทศ, ETF หรือกองทุนรวม ที่ต้องการเครื่องมือ
ติดตามที่ง่ายและใช้ LINE เป็นหลักในชีวิตประจำวัน

---

## แพ็กเกจ

| | Free | Premium | Premium+ |
|---|---|---|---|
| ราคา | 0฿ | 99–129฿/เดือน | 199–249฿/เดือน |
| จำนวนสินทรัพย์ | 2 | ไม่จำกัด | ไม่จำกัด |
| Multiple Portfolio | ❌ | ✅ | ✅ |
| Web Dashboard | Demo เท่านั้น | ✅ เต็มรูปแบบ | ✅ |
| ย้อนดูพอร์ต | 30 วัน | สัปดาห์/เดือน/ปี | + 5–10 ปี |
| Investment Goal | ❌ | 1 เป้าหมาย | ไม่จำกัด |
| Export Excel/PDF | ❌ | ✅ | ✅ |
| AI Financial Journal | ❌ | ❌ | ✅ |
| Annual Investment Report | ❌ | ❌ | ✅ |

> **หมายเหตุ:** Premium+ จะเปิดตัวใน Phase 4 หลังจากทดสอบ AI Features
> อย่างรอบคอบแล้ว

---

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| Backend | Node.js + Express |
| Database | Supabase (PostgreSQL) |
| LINE Integration | LINE Messaging API + LIFF |
| Web UI | React + Chart.js |
| Hosting | Railway.app |
| Admin Notifications | LINE Notify |
| Vision AI (Phase 4) | Claude API |
| Version Control | Git + GitHub |

---

## Roadmap

```
Phase 0    — Architecture Design
Phase 0.5  — Security & Compliance
Phase 1    — LINE Bot Core (MVP)
Phase 2    — Web Dashboard + ระบบชำระเงิน
Phase 3    — Admin Dashboard
Phase 4    — Premium+, AI Features, Bank API
```

รายละเอียดแต่ละ Phase ดูได้ที่ [ROADMAP.md](./ROADMAP.md)

---

## หลักการพัฒนา

1. **Architecture First** — วางโครงสร้างระบบก่อนเขียนโค้ด
2. **MVP First** — เริ่มจากฟีเจอร์แกนหลักที่จำเป็นจริงก่อน
3. **Documentation First** — เอกสารต้องครบก่อนเริ่มพัฒนาแต่ละ Phase
4. **Security by Design** — ออกแบบความปลอดภัยตั้งแต่ต้น
5. **Data-driven Product** — ตัดสินใจฟีเจอร์จากข้อมูลการใช้งานจริง
6. **Scalable Architecture** — ขยายระบบได้โดยไม่ต้อง Refactor ใหญ่
7. **AI เป็นผู้ช่วยวิเคราะห์ ไม่ใช่ผู้ตัดสินใจแทนผู้ใช้** — กฎเหล็กตลอดทั้งระบบ

---

## กฎสำคัญเรื่อง AI

ทุกฟีเจอร์ที่เกี่ยวข้องกับ AI ต้องยึดหลัก:

- วิเคราะห์และอธิบายข้อมูลจริงในพอร์ตของผู้ใช้เท่านั้น
- **ห้ามแนะนำให้ซื้อหรือขายสินทรัพย์ใดๆ**
- **ห้ามชี้นำการตัดสินใจลงทุน**
- ใช้ภาษาเชิงข้อมูล/ข้อเท็จจริง เช่น "BTC มีสัดส่วน 75% ของพอร์ต"
  ไม่ใช่ "พอร์ตคุณเสี่ยงเกินไป"

---

## โครงสร้างเอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| [README.md](./README.md) | ภาพรวมโปรเจค (ไฟล์นี้) |
| [AI_CONTEXT.md](./AI_CONTEXT.md) | บริบทสำหรับ AI ทุกตัวที่ร่วมพัฒนา |
| [PRD.md](./PRD.md) | ฟีเจอร์ทั้งหมด + แพ็กเกจ |
| [SRS.md](./SRS.md) | การทำงานทางเทคนิค |
| [DATABASE.md](./DATABASE.md) | Database Schema |
| [API.md](./API.md) | API Documentation |
| [UI_UX.md](./UI_UX.md) | Design System + Wireframe |
| [ROADMAP.md](./ROADMAP.md) | Phase 0–4 |
| [SECURITY.md](./SECURITY.md) | Security Policy |
| [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md) | แผน Backup และ Disaster Recovery |
| [MARKETING.md](./MARKETING.md) | กลยุทธ์การตลาด |
| [CHANGELOG.md](./CHANGELOG.md) | บันทึกความเปลี่ยนแปลง |
| [CODING_STANDARD.md](./CODING_STANDARD.md) | มาตรฐานโค้ด |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | ขั้นตอน Deploy |
| [TEST_PLAN.md](./TEST_PLAN.md) | แผนการทดสอบ |

---

## ข้อมูลโปรเจค

- **Project Owner:** MJF STUDIO
- **วันเริ่มพัฒนา:** 1 กรกฎาคม 2569
- **Repository:** GitHub (เชื่อมต่อแล้ว)
- **Local Path:** `C:\Project_EasyDCA\EasyDCA`

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*Single Source of Truth สำหรับโปรเจค EasyDCA อยู่ที่ [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
