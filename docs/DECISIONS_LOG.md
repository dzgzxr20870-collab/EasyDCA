# DECISIONS_LOG.md — บันทึกการตัดสินใจสำคัญ (ย้ายมาจาก CHANGELOG.md เดิม)

> ไฟล์นี้แยกออกมาจาก `CHANGELOG.md` เดิม (วันที่ 9 กรกฎาคม 2569) เพื่อให้
> `CHANGELOG.md` ใช้รูปแบบ [Keep a Changelog](https://keepachangelog.com/)
> แบบมาตรฐาน (เรียงตาม Version v0.1.0, v0.2.0, ...) ควบคู่กับการเริ่ม
> Git Tag Versioning จริงจังตั้งแต่ Phase 3 เป็นต้นไป
>
> ไฟล์นี้เก็บ "บันทึกรายวัน" (Day-by-day Log) และ "การตัดสินใจสำคัญ"
> (Decided) ของช่วง Phase 0 ไว้ตามเดิมทุกตัวอักษร — ไม่มีอะไรถูกลบทิ้ง

---

## [Day 1] - 1 กรกฎาคม 2569

### Added

**เอกสาร `docs/` เขียนเสร็จ 15/16 ไฟล์** (เหลือ API.md ตั้งใจปล่อยว่าง
รอ Phase 0):

| ไฟล์ | สรุปเนื้อหา |
|---|---|
| [README.md](./README.md) | ภาพรวมโปรเจค เป้าหมาย กลุ่มเป้าหมาย และ Tech Stack |
| [AI_CONTEXT.md](./AI_CONTEXT.md) | บริบทสำคัญที่สุดสำหรับ AI ทุกตัวที่ร่วมพัฒนา รวมกฎเหล็กที่ห้ามละเมิด |
| [PRD.md](./PRD.md) | ฟีเจอร์ทั้งหมดแยกตาม Package (Free/Premium/Premium+) และ Phase |
| [ENV_VARIABLES.md](./ENV_VARIABLES.md) | รายการ Environment Variables ทั้งหมดที่ระบบต้องใช้ พร้อมข้อควรระวัง |
| [ROADMAP.md](./ROADMAP.md) | แผนพัฒนา Phase 0–4 พร้อมเกณฑ์ผ่านแต่ละ Phase และงบประมาณโดยประมาณ |
| [DATABASE.md](./DATABASE.md) | Database Schema เต็มรูปแบบ 12 Table พร้อม RLS Policy ทุกตาราง |
| [SRS.md](./SRS.md) | Flow การทำงานทางเทคนิคของทุกระบบหลัก (LINE Bot, Web, Payment, Cron, Error Handling) |
| [SECURITY.md](./SECURITY.md) | นโยบายความปลอดภัยภาพรวม: Auth, RLS, Rate Limiting, Webhook Validation, Encryption, PDPA, Monitoring |
| [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md) | คู่มือปฏิบัติการจริง: Backup Schedule, Restore Procedure, Migration Plan, Disaster Recovery, RTO/RPO |
| [UI_UX.md](./UI_UX.md) | Design System, Wireframe หน้าหลัก, Flex Message Templates, Responsive/Accessibility |
| [CODING_STANDARD.md](./CODING_STANDARD.md) | Naming Convention, Folder Structure, Git Commit/Branch, Code Review Checklist, Comment Style |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | ขั้นตอน Deploy Local → Staging → Production บน Railway, Migration/Rollback/Domain+SSL |
| [TEST_PLAN.md](./TEST_PLAN.md) | Test Strategy และ Test Case หลักของทุกฟีเจอร์ รวม Security Testing |
| [MARKETING.md](./MARKETING.md) | กลยุทธ์หา Beta User, Positioning, Conversion Funnel, Referral, Success Metrics |
| CHANGELOG.md | ไฟล์นี้เอง — บันทึกความเปลี่ยนแปลงของโปรเจค |

**อื่นๆ**

- เชื่อมต่อและ Push GitHub Repository สำเร็จ
- สร้างโครงสร้างโฟลเดอร์โปรเจค (`admin`, `assets`, `backend`, `docs`,
  `frontend`, `line-bot`) เตรียมไว้รอเริ่มเขียนโค้ดจริงใน Phase 0
- กำหนด Project Positioning, Development Philosophy และ Team Structure
  ใน [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)

### Decided

- **เปิดตัวด้วย 2 แพ็กเกจ (Free + Premium) ก่อน** — Premium+ จะตามมา
  ทีหลังใน Phase 4 หลังจากทดสอบ AI Features อย่างรอบคอบแล้วเท่านั้น
- **Hero Features ของ Premium+** ที่ตกลงไว้ล่วงหน้า 3 อย่าง: Goal-Based
  DCA Planner หลายเป้าหมาย, AI Financial Journal, Annual Investment
  Report (สไตล์ Spotify Wrapped)
- **นโยบาย Premium หมดอายุ:** Grace Period 7 วัน (ดูข้อมูลได้ปกติ
  บันทึกเพิ่มไม่ได้ ระหว่างนั้น) ก่อนล็อคข้อมูลทั้งหมด (ไม่ใช่ลบ) —
  ต่ออายุแล้ว Unlock ทันที
- **กฎเหล็ก: AI ห้ามแนะนำซื้อขายสินทรัพย์หรือชี้นำการตัดสินใจลงทุนใดๆ
  ทั้งสิ้น** ใช้ภาษาเชิงข้อเท็จจริงเท่านั้น (เช่น "BTC มีสัดส่วน 75%
  ของพอร์ต" ไม่ใช่ "พอร์ตคุณเสี่ยงเกินไป") — กฎนี้ขยายผลไปถึงการ
  สื่อสารการตลาดทั้งหมดด้วย ไม่ใช่แค่ Feature ของ AI
  (ดู MARKETING.md § 7)
- **ห้ามลบข้อมูลผู้ใช้เด็ดขาด** ไม่ว่าจะยกเลิก Premium หรือ Grace
  Period หมดอายุ ยกเว้นกรณีผู้ใช้ร้องขอลบข้อมูลของตนเองอย่างชัดแจ้ง
  ตาม PDPA เท่านั้น (สองกฎนี้ไม่ขัดแย้งกัน — ดู SECURITY.md § 8)
- **เพิ่ม ENV_VARIABLES.md เข้ามานอกแผนเดิม** ตามข้อเสนอแนะจาก GPT
  Review (30 มิถุนายน 2569) เพื่อให้ระบบมีรายการ Environment Variables
  ที่ชัดเจนตั้งแต่ต้น ไม่ต้องรอถึง Phase 0
- **ย้าย BACKUP_AND_RECOVERY.md มาเขียนคู่กับ SECURITY.md** ในสัปดาห์
  เดียวกัน แทนที่จะแยกห่างกันตามแผนเดิม เพราะเป็นเรื่องเกี่ยวข้องกัน
  โดยตรงและควรรู้แผนรับมือก่อนเริ่ม Phase 1 ที่จะมีข้อมูลผู้ใช้จริง
- **ใช้ Conventional Commits + Git Branch Strategy** (`main` /
  `develop` / `feature` / `hotfix`) เป็นมาตรฐานของทีมตั้งแต่ต้น
- **RLS ทุกตาราง, Rate Limiting และ LINE Webhook Signature Validation
  เป็นข้อกำหนดบังคับตั้งแต่ Phase 0.5** ก่อนเริ่มมี User จริงเข้าระบบ
  ไม่ใช่ค่อยเพิ่มทีหลัง

### สถานะปัจจุบัน (ณ วันที่บันทึกนี้เขียน — 1 กรกฎาคม 2569)

- **Phase 0 (เอกสาร docs/):** เสร็จสมบูรณ์ 15/16 ไฟล์ (รวม CHANGELOG.md
  ไฟล์นี้)
- เหลือ **API.md** ที่ตั้งใจปล่อยว่างไว้ก่อนตามแผนเดิม — จะเขียนตอน
  ขั้นตอน API Design จริงใน Phase 0 (ตาม
  [ROADMAP.md § Phase 0](./ROADMAP.md))

### สิ่งที่ต้องทำต่อไป (ณ วันที่บันทึกนี้เขียน)

ตาม [ROADMAP.md § Phase 0](./ROADMAP.md):

- [ ] Database ER Diagram — ทำให้ Schema และ Relationship ใน
      DATABASE.md เป็นทางการ (Diagram จริง ไม่ใช่แค่คำอธิบาย)
- [ ] API Design — ออกแบบ REST API Spec, Versioning `/api/v1`, Request/
      Response Format แล้วเขียนลง API.md
- [ ] Folder Structure — จัดวางโครงสร้างไฟล์จริงใน `backend/`,
      `frontend/`, `line-bot/`, `admin/` ตาม
      [CODING_STANDARD.md § 2](./CODING_STANDARD.md)
- [ ] Review เอกสารทั้งหมดร่วมกับ GPT อีกรอบก่อนเริ่มเขียนโค้ดจริง
      (ตามลำดับที่วางไว้ใน PROJECT_BRIEF.md § 13 สัปดาห์ที่ 4)

---

**หมายเหตุ:** งานทั้งหมดในรายการ "สิ่งที่ต้องทำต่อไป" ข้างต้นเสร็จแล้ว
จริงตั้งแต่ Phase 0 ปิดรอบ — รายการนี้เป็นบันทึกประวัติ ณ เวลานั้น
ไม่ใช่สถานะปัจจุบันของโปรเจค (ดูสถานะปัจจุบันจริงได้ที่
`claude/project-summary.md` ใน Claude Project)

**Version เดิมของไฟล์นี้ก่อนแยก:** 1.0.0 | **บันทึกล่าสุดก่อนแยก:** 1 กรกฎาคม 2569
