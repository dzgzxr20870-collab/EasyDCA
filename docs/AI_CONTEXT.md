# AI_CONTEXT.md — บริบทสำหรับ AI ทุกตัว

> ไฟล์นี้คือไฟล์ที่สำคัญที่สุดในโปรเจค
> AI ทุกตัว (Claude, Claude Code, ChatGPT ฯลฯ) ต้องอ่านไฟล์นี้ก่อน
> ทำงานใดๆ ในโปรเจค EasyDCA เสมอ

---

## โปรเจคนี้คืออะไร

EasyDCA คือ Personal Investment Platform SaaS สำหรับนักลงทุนสาย DCA
ชาวไทย ผู้ใช้บันทึกธุรกรรมการซื้อขายสินทรัพย์ผ่าน LINE OA ด้วยคำสั่ง
ภาษาไทยสั้นๆ หรือส่งรูปสลิป ระบบคำนวณพอร์ตและแสดงผลผ่าน LINE และ
Web Dashboard โดยอัตโนมัติ

สินทรัพย์ที่รองรับ: Crypto, หุ้นไทย, หุ้นต่างประเทศ, ETF, กองทุนรวม

---

## กฎเหล็กที่ห้ามละเมิด

### 1. AI ห้ามแนะนำซื้อขายสินทรัพย์

นี่คือข้อห้ามสูงสุด มีผลกับทุกฟีเจอร์และทุกข้อความที่ระบบส่งออกไป:

- **ห้ามแนะนำให้ซื้อหรือขายสินทรัพย์ใดๆ ทั้งสิ้น**
- **ห้ามชี้นำหรือแนะนำการตัดสินใจลงทุน**
- AI ทำหน้าที่วิเคราะห์และรายงานข้อมูลจริงในพอร์ตเท่านั้น
- ใช้ภาษาเชิงข้อเท็จจริง ไม่ใช่เชิงตัดสิน

**ตัวอย่างที่ถูกต้อง:** "BTC มีสัดส่วน 75% ของพอร์ต"
**ตัวอย่างที่ห้ามทำ:** "พอร์ตคุณเสี่ยงเกินไป ควรลด BTC"

เหตุผล: การแนะนำลงทุนโดยไม่มีใบอนุญาตมีความเสี่ยงทางกฎหมายในไทย

### 2. ห้ามลบข้อมูลผู้ใช้

ทุก Table ในฐานข้อมูลต้องไม่มีการลบข้อมูลจริง (Hard Delete)
เมื่อผู้ใช้ยกเลิก Premium ให้ล็อคข้อมูล ไม่ใช่ลบ

### 3. ห้ามเขียนโค้ดที่ยังไม่ได้ออกแบบ Architecture

ต้องมีเอกสาร Architecture ก่อนเสมอ ห้าม Implement ก่อนแล้วค่อยแก้ทีหลัง

---

## สถานะปัจจุบัน

| รายการ | สถานะ |
|---|---|
| Phase | Phase 0 (Architecture Design) — ยังไม่เริ่ม |
| เอกสาร docs/ | กำลังเขียน (เริ่มจาก README → AI_CONTEXT) |
| โค้ด | ยังไม่มี — เป็นการเริ่มต้นใหม่จริงๆ |
| Supabase | ยังไม่ได้สมัคร |
| Railway | ยังไม่ได้สมัคร |
| LINE Developer | ยังไม่ได้สมัคร |
| GitHub | เชื่อมต่อแล้ว |

---

## Tech Stack ที่ตัดสินใจแล้ว (ห้ามเปลี่ยนโดยพลการ)

| ส่วน | เทคโนโลยี | หมายเหตุ |
|---|---|---|
| Backend | Node.js + Express | — |
| Database | Supabase (PostgreSQL) | ต้องเปิด RLS ทุก Table |
| LINE | LINE Messaging API + LIFF | — |
| Web UI | React + Chart.js | — |
| Hosting | Railway.app | — |
| Admin Notifications | LINE Notify | — |
| Vision AI | Claude API | Phase 4 เท่านั้น |
| Version Control | Git + GitHub | — |

หากจำเป็นต้องเปลี่ยน Tech Stack รายการใด ให้แจ้ง Project Owner ก่อนเสมอ
ห้ามเปลี่ยนโดยไม่ได้รับการอนุมัติ

---

## โครงสร้างทีม

| บทบาท | ผู้รับผิดชอบ |
|---|---|
| Project Owner | MJF STUDIO |
| Product & Technical Architect | ChatGPT / Claude |
| Documentation & Analysis | Claude |
| Coding Assistant | Claude Code |

---

## แพ็กเกจและข้อจำกัดที่ต้องพิจารณาเสมอเวลาเขียนโค้ด

| ฟีเจอร์ | Free | Premium | Premium+ |
|---|---|---|---|
| จำนวนสินทรัพย์ | สูงสุด 2 | ไม่จำกัด | ไม่จำกัด |
| Multiple Portfolio | ❌ | ✅ | ✅ |
| Web Dashboard | Demo เท่านั้น | ✅ | ✅ |
| ย้อนดูพอร์ต | 30 วัน | สัปดาห์/เดือน/ปี | + 5–10 ปี |
| AI อ่านสลิป | ❌ | ✅ (Phase 4) | ✅ |
| Investment Goal | ❌ | 1 เป้าหมาย | ไม่จำกัด |
| Export Excel/PDF | ❌ | ✅ | ✅ |
| AI Financial Journal | ❌ | ❌ | ✅ |
| Annual Investment Report | ❌ | ❌ | ✅ |

> **หมายเหตุ:** Premium+ ยังไม่เปิดตัว — อยู่ใน Phase 4
> เวลาเขียนโค้ดให้ออกแบบให้รองรับได้ในอนาคต แต่ยังไม่ต้อง Implement

---

## Database Schema (สรุปย่อ)

ดูรายละเอียดเต็มที่ [DATABASE.md](./DATABASE.md)

```
users           — ข้อมูลผู้ใช้, plan, plan_expires_at
portfolios      — พอร์ตแยกประเภท (Multiple Portfolio)
assets          — สินทรัพย์ที่ถือ (ผูกกับ portfolio_id)
transactions    — ประวัติซื้อ/ขาย
payments        — การชำระเงิน + สถานะสลิป
goals           — เป้าหมายการลงทุน
notifications   — ประวัติการแจ้งเตือน
audit_logs      — บันทึก Action ของ Admin ทุกครั้ง
portfolio_snapshots — มูลค่าพอร์ตรายวัน (สำหรับ Timeline)
user_settings   — การตั้งค่าผู้ใช้
watchlists      — สินทรัพย์ที่ติดตาม
system_logs     — Error logs
```

**กฎสำคัญ:** ทุก Table ต้องเปิด Row Level Security (RLS) บน Supabase

---

## API Structure (ที่ตัดสินใจแล้ว)

- REST API พร้อม Versioning: `/api/v1/...`
- Authentication: LINE Login + JWT
- ดูรายละเอียดที่ [API.md](./API.md)

---

## Roadmap สรุป

```
Phase 0    — Architecture Design (ER Diagram, API Design, Folder Structure)
Phase 0.5  — Security & Compliance (RLS, Encryption, Rate Limiting, PDPA)
Phase 1    — LINE Bot Core (Thai commands, Freemium, Flex Message, Notifications)
Phase 2    — Web Dashboard + ระบบชำระเงิน Manual
Phase 3    — Admin Dashboard (Analytics, Roles, Audit Logs)
Phase 4    — Premium+, AI Features, Bank API Automation
```

ดูรายละเอียดที่ [ROADMAP.md](./ROADMAP.md)

---

## ระบบชำระเงิน (ช่วงเปิดตัว)

ระบบเปิดตัวด้วย Manual Payment Flow:
1. ลูกค้าโอนเงิน → ส่งสลิปในเว็บหรือใน LINE OA
2. ระบบแจ้งเตือน Admin ทาง LINE Notify ทันที
3. Admin กด Approve → ระบบ Unlock Premium อัตโนมัติ

Payment Status: `Pending → Reviewing → Approved / Rejected / Expired`

Bank API (SCB/KBank) จะมาใน Phase 4

---

## นโยบาย Premium หมดอายุ

- **ห้ามลบข้อมูลเด็ดขาด** ไม่ว่ากรณีใด
- Grace Period 7 วัน: ดูข้อมูลได้ บันทึกเพิ่มไม่ได้
- หลัง 7 วัน: ล็อคข้อมูล (ไม่ใช่ลบ) รอต่ออายุ
- ต่ออายุแล้ว Unlock ทันที

---

## สิ่งที่ EasyDCA จะ "ไม่ทำ" (Non-Goals)

- ไม่ใช่แอปแนะนำซื้อขายหุ้น/คริปโต
- AI จะไม่ตัดสินใจแทนผู้ใช้ในเรื่องการลงทุนใดๆ
- ไม่บังคับซื้อ Premium เพื่อเข้าถึงข้อมูลที่เคยบันทึกไว้แล้ว
- ไม่รีบ Launch ฟีเจอร์ที่ยังไม่ผ่านการทดสอบ โดยเฉพาะ Premium+ และ AI
- ไม่เปลี่ยน Tech Stack โดยไม่ได้รับอนุมัติ

---

## คำถามที่ AI ต้องถามตัวเองก่อนทำงานทุกครั้ง

1. ฟีเจอร์นี้อยู่ใน Phase ไหน? ถึงเวลาทำแล้วหรือยัง?
2. มีเอกสาร Architecture รองรับแล้วหรือยัง?
3. ฟีเจอร์นี้อยู่ใน Package ไหน? Free / Premium / Premium+?
4. ข้อความหรือผลลัพธ์ที่ส่งออกไปมีการชี้นำการลงทุนหรือไม่?
5. โค้ดนี้เปิด RLS หรือตรวจสอบสิทธิ์ผู้ใช้ก่อนเข้าถึงข้อมูลแล้วหรือยัง?

---

## ลิงก์เอกสารสำคัญ

| เอกสาร | ลิงก์ |
|---|---|
| Project Brief (Single Source of Truth) | [PROJECT_BRIEF.md](../PROJECT_BRIEF.md) |
| ภาพรวมโปรเจค | [README.md](./README.md) |
| ฟีเจอร์ทั้งหมด | [PRD.md](./PRD.md) |
| Database Schema | [DATABASE.md](./DATABASE.md) |
| API Documentation | [API.md](./API.md) |
| Security Policy | [SECURITY.md](./SECURITY.md) |
| Roadmap | [ROADMAP.md](./ROADMAP.md) |
| Coding Standard | [CODING_STANDARD.md](./CODING_STANDARD.md) |

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569 — Phase 0 เริ่มต้น
