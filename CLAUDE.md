# CLAUDE.md — EasyDCA

> ไฟล์นี้เป็น **Pointer เท่านั้น** — ชี้ไปเอกสารที่เป็น Source of Truth จริง
> **ห้ามคัดลอกเนื้อหาจากเอกสารที่ลิงก์ไว้มาไว้ที่นี่** เพราะจะกลายเป็นข้อมูลซ้ำซ้อน
> ที่ต้องอัปเดต 2 ที่แล้วเพี้ยนไม่ตรงกันในที่สุด ถ้าต้องเพิ่มกฎใหม่ ให้เพิ่มใน
> เอกสารต้นทาง (`docs/*`) แล้วชี้มาจากที่นี่

EasyDCA = ผู้ช่วยบันทึก/ติดตามการลงทุนแบบ DCA ผ่าน LINE + เว็บ (ระยะแรกของ JaydeX)

---

## ⚠️ อ่าน 2 ไฟล์นี้ก่อนเริ่มงานทุกครั้ง (บังคับ)

### 1. [`docs/AI_CONTEXT.md`](./docs/AI_CONTEXT.md) — บริบทโปรเจกต์
- **กฎเหล็กที่ห้ามละเมิด** (ห้ามแนะนำซื้อขายสินทรัพย์ · ห้ามลบข้อมูลผู้ใช้ ·
  ห้ามเขียนโค้ดที่ยังไม่ได้ออกแบบ Architecture)
- Tech Stack ที่ตัดสินใจแล้ว (ห้ามเปลี่ยนโดยพลการ), แพ็กเกจ/ข้อจำกัดที่ต้อง
  พิจารณาเสมอเวลาเขียนโค้ด, Non-Goals
- **"คำถามที่ AI ต้องถามตัวเองก่อนทำงานทุกครั้ง"** — ไล่ให้ครบก่อนลงมือ

### 2. [`docs/AI_WORK_POLICY.md`](./docs/AI_WORK_POLICY.md) — วิธีทำงาน
- **§ 1 Model Selection** — ต้องระบุ Model (Sonnet/Opus) + เหตุผล **ก่อน** เริ่มงาน
  ไม่ใช่หลังทำเสร็จ (งานแตะเงิน/Ledger/Entitlement/PII/Infra → Opus เป็น Default)
- **§ 2 Git Hygiene** — `git status` ก่อนลงมือเสมอ · review ไฟล์ที่ `git add` ก่อน
  commit · ห้าม `push --force`/`reset --hard` โดยไม่ถามก่อน
- **§ 3 Definition of Done 4 ชั้น** — Unit → Integration → **Regression (ต้อง
  พิสูจน์ Red-Green จริง: ถอด Fix ออกต้องเห็นแดงก่อน)** → Production Verification
  (ต้อง Verify บน Container ที่ Deploy จริง ไม่ใช่แค่ "Build ผ่าน")
- **§ 4 5 หมวดไฟล์เสี่ยงสูง + Policy เฉพาะ** — เช็คว่าไฟล์ที่จะแตะอยู่หมวดไหน
  ก่อนเริ่ม · **§ 5** ไฟล์ที่คาบเกี่ยวหลายหมวดต้องยึด Policy ที่เข้มที่สุด
- **§ 6 บทเรียนจากเคสจริง** — อ่านก่อนแก้บั๊กคล้ายๆ กัน จะได้ไม่พลาดซ้ำ

---

## สถานะงานล่าสุด

[`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md) — Blueprint + สถานะปัจจุบัน
(สิ่งที่ปิดแล้ว/TODO ที่เหลือ) และ **"กฎยืนสำคัญที่สุด"** ที่ต้องรู้ก่อนแตะโค้ด

> ⚠️ **อย่าเชื่อคำว่า "ปิดสมบูรณ์แล้ว" ในเอกสารนี้ 100%** — พบเคสจริง (9 ส.ค. 2026)
> ว่าเคยเขียนไว้ว่า "Ownership Filter ทุก Query" ปิดสมบูรณ์ และ "Security Audit
> ทั้งชุดปิดสมบูรณ์ 100%" **ทั้งที่ยังมีช่องโหว่ Cross-User จริงซ่อนอยู่ 6 จุด**
> บนเส้นทางเงิน (Cross-User Isolation Audit เจอและแก้ไปแล้ว)
>
> ถ้าจะพึ่งข้อความ "ปิดแล้ว" เป็นเหตุผลว่าไม่ต้องตรวจซ้ำ → **ต้องยืนยันกับของจริง
> ก่อนเสมอ**: `git log` ของไฟล์นั้น, โค้ดจริง, หรือ Test ที่ครอบอยู่จริง
> (ตาม `AI_WORK_POLICY.md` § 2 — ห้ามเชื่อว่า "ดูถูกต้อง" = "ถูกต้องจริง")

---

## เอกสารอ้างอิงเจาะจง (เปิดเมื่อต้องใช้)

| ต้องการอะไร | ไฟล์ |
|---|---|
| Schema, Migration, กฎ Immutable Ledger, RLS | [`docs/DATABASE.md`](./docs/DATABASE.md) |
| Endpoint, Request/Response, Error Code | [`docs/API.md`](./docs/API.md) |
| Auth, PDPA, Threat Model, Security Checklist | [`docs/SECURITY.md`](./docs/SECURITY.md) |
| Naming, Layering, DoD ทั่วไป (§ 6) | [`docs/CODING_STANDARD.md`](./docs/CODING_STANDARD.md) |
| Deploy, Railway, Env Var | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) · [`docs/ENV_VARIABLES.md`](./docs/ENV_VARIABLES.md) |
| Backup/Restore | [`docs/BACKUP_AND_RECOVERY.md`](./docs/BACKUP_AND_RECOVERY.md) |
| แผน Test | [`docs/TEST_PLAN.md`](./docs/TEST_PLAN.md) |
| ประวัติการตัดสินใจ / การเปลี่ยนแปลง | [`docs/DECISIONS_LOG.md`](./docs/DECISIONS_LOG.md) · [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) |

---

## คำสั่งที่ใช้บ่อย

```bash
cd backend && npm test     # Jest (ต้องเขียวทั้งหมดก่อน commit)
cd backend && npm run lint # ESLint
cd frontend && npm run dev # Dashboard (Vite)
```

โครงสร้าง: `backend/` (Express + worker) · `frontend/` (React/Vite) ·
`backend/migrations/` (SQL — Apply+Verify บน Supabase ก่อน Deploy Code เสมอ)
