# EasyDCA — Project Brief

> ไฟล์นี้คือสรุปข้อมูลทั้งหมดของโปรเจค EasyDCA ที่ตกลงกันไว้
> ใช้เป็นข้อมูลอ้างอิงหลักสำหรับ Claude Code, GPT และ AI ทุกตัว
> ที่เกี่ยวข้องกับการพัฒนาโปรเจคนี้

---

## 1. Project Positioning

- **ชื่อโปรเจค:** EasyDCA
- **แนวคิด:** Personal Investment Platform
- **เป้าหมาย:** สร้างผลิตภัณฑ์ SaaS จริง ไม่ใช่โปรเจกต์ทดลอง
- **รองรับสินทรัพย์:** Crypto, หุ้นไทย, หุ้นต่างประเทศ, ETF, กองทุนรวม
- **แนวทางพัฒนา:** วางรากฐานด้าน Architecture, Documentation
  และ Scalability ตั้งแต่เริ่มต้น เน้นทำทีละขั้นตอนอย่างรอบคอบ
  ยอมเสร็จช้ากว่า แลกกับระบบที่ดีและมั่นคง

### ปัญหาที่แก้

นักลงทุนสาย DCA (Dollar Cost Averaging) ซื้อสินทรัพย์สม่ำเสมอ
ทุกเดือน แต่ไม่มีเครื่องมือติดตามที่สะดวก ต้องใช้ Excel หรือ
จดบันทึกเอง ทำให้ไม่รู้ภาพรวมพอร์ตที่แท้จริง ไม่รู้กำไรขาดทุน
ที่ชัดเจน EasyDCA แก้ปัญหานี้ด้วยการให้บันทึกผ่าน LINE OA
เพียงพิมข้อความสั้นๆ หรือส่งรูปสลิป ระบบจัดการคำนวณและ
แสดงผลให้อัตโนมัติ ผ่านทั้ง LINE และ Web Dashboard

### กลุ่มเป้าหมาย

นักลงทุนสาย DCA ที่ลงทุนในหุ้นไทย หุ้นต่างประเทศ คริปโต ETF
และกองทุนรวม ที่ต้องการติดตามพอร์ตแบบง่าย ไม่ต้องการเครื่องมือ
ซับซ้อน และใช้ LINE เป็นช่องทางหลักในชีวิตประจำวันอยู่แล้ว

---

## 2. Development Philosophy

หลักการพัฒนาที่ตกลงร่วมกัน:

1. **Architecture First** — วางโครงสร้างระบบก่อนเขียนโค้ด
2. **MVP First** — เริ่มจากฟีเจอร์แกนหลักที่จำเป็นจริงก่อน
3. **Documentation First** — เอกสารต้องครบก่อนเริ่มพัฒนาแต่ละ Phase
4. **Security by Design** — ออกแบบความปลอดภัยตั้งแต่ต้น ไม่ใช่เสริมทีหลัง
5. **Data-driven Product** — ตัดสินใจพัฒนาฟีเจอร์จากข้อมูลการใช้งานจริง
6. **Scalable Architecture** — ออกแบบให้ขยายระบบได้โดยไม่ต้อง Refactor ใหญ่
7. **AI เป็นผู้ช่วยวิเคราะห์ ไม่ใช่ผู้ตัดสินใจแทนผู้ใช้** — กฎเหล็กที่ต้อง
   ยึดตลอดทั้งระบบ เพื่อหลีกเลี่ยงความเสี่ยงด้านกฎหมายการชักชวนลงทุน

### กฎสำคัญเรื่อง AI

ทุกฟีเจอร์ที่เกี่ยวข้องกับ AI วิเคราะห์ข้อมูล ต้องยึดหลัก:
- วิเคราะห์และอธิบายข้อมูลจริงในพอร์ตของผู้ใช้เท่านั้น
- **ห้ามแนะนำให้ซื้อหรือขายสินทรัพย์ใดๆ**
- **ห้ามชี้นำการตัดสินใจลงทุน**
- ใช้ภาษาเชิงข้อมูล/ข้อเท็จจริง ไม่ใช่เชิงตัดสิน
  (เช่น "BTC มีสัดส่วน 75% ของพอร์ต" ไม่ใช่ "พอร์ตคุณเสี่ยงเกินไป")

---

## 3. Team Structure

- **Project Owner:** MJF STUDIO
- **Product & Technical Architect:** ChatGPT / Claude
- **Documentation & Analysis:** Claude
- **Coding Assistant:** Claude Code

---

## 4. Tech Stack

- **Backend:** Node.js + Express
- **Database:** Supabase (PostgreSQL)
- **LINE:** LINE Messaging API + LIFF
- **Web UI:** React + Chart.js
- **Hosting:** Railway.app
- **Notification (Admin):** LINE Notify
- **Vision AI (สลิป, Phase หลัง):** Claude API
- **Version Control:** Git + GitHub

---

## 5. โครงสร้างแพ็กเกจ

### กลยุทธ์เปิดตัว

**เปิดตัวจริงด้วย 2 แพ็กเกจ: Free และ Premium**
ส่วน Premium+ จะตามมาทีหลังใน Phase 4 เมื่อฟีเจอร์ AI
ขั้นสูงพัฒนาและทดสอบจนมั่นใจแล้ว

---

### 🆓 FREE

เป้าหมาย: ให้ลองใช้จนติด แต่รู้สึกว่า "ไม่พอ" สำหรับคนที่ลงทุน
หลายสินทรัพย์จริงจัง

**มีให้:**
- บันทึกได้ 2 สินทรัพย์
- พิมคำสั่งบันทึกผ่าน LINE
- สรุปพอร์ตพื้นฐานใน LINE (มูลค่ารวม, กำไร-ขาดทุนปัจจุบัน)
- ประวัติย้อนหลัง 30 วัน
- Rich Menu พื้นฐาน
- แจ้งเตือน DCA ประจำเดือน (1 รายการ)
- Demo Dashboard (ดูตัวอย่าง Web UI เพื่อกระตุ้นการอัพเกรด)

**ไม่มี:**
- Web Dashboard จริง (มีแค่ Demo)
- ย้อนดูพอร์ตรายสัปดาห์/เดือน/ปี
- Investment Goal
- ส่งรูปสลิปให้ AI อ่าน
- Export ข้อมูล

---

### 👑 PREMIUM (99-129 บาท/เดือน หรือ ~799 บาท/ปี)

เป้าหมาย: ตอบโจทย์การใช้งานประจำของสาย DCA ทั่วไป
เป็นแพ็กเกจหลักที่ควรขายได้มากที่สุด

**มีให้ (รวมทุกอย่างใน Free บวก):**
- บันทึกได้ไม่จำกัดสินทรัพย์
- **Multiple Portfolio** — แยกพอร์ตได้หลายพอร์ต เช่น
  Crypto, หุ้นไทย, หุ้นต่างประเทศ, ETF, พอร์ตตามเป้าหมาย
  ดู Dashboard แยกรายพอร์ตหรือรวมทุกพอร์ตได้
- Web Dashboard กราฟเต็มรูปแบบ
  - มูลค่าพอร์ต vs เงินต้น
  - สัดส่วนสินทรัพย์ (Pie Chart)
  - กราฟกำไร-ขาดทุนรายสินทรัพย์
- ย้อนดูพอร์ตได้: รายสัปดาห์ / รายเดือน / รายปี
- ส่งรูปสลิปให้ AI อ่านอัตโนมัติ (Phase หลัง)
- Investment Goal (ตั้งได้ 1 เป้าหมาย พร้อม Progress Bar)
- Export Excel/PDF
- Weekly + Monthly Summary (ส่งอัตโนมัติผ่าน LINE)
- Portfolio Timeline (แสดงเหตุการณ์การลงทุนแบบ Feed)
- **Asset Concentration Alert** — แจ้งเตือนเชิงข้อมูลเมื่อ
  สินทรัพย์ใดมีสัดส่วนสูงผิดปกติ เช่น "BTC มีสัดส่วน 75%
  ของพอร์ต" (เป็นการรายงานข้อเท็จจริง ไม่ใช่คำแนะนำซื้อขาย)

---

### 💎 PREMIUM+ (199-249 บาท/เดือน หรือ ~1,990 บาท/ปี)
**[ตามมาทีหลัง — เปิดใน Phase 4]**

เป้าหมาย: สำหรับคนที่ซีเรียสเรื่องการเงิน มีหลายเป้าหมาย
ต้องการ AI ช่วยวิเคราะห์เชิงลึก

**มีให้ (รวมทุกอย่างใน Premium บวก):**
- ย้อนดูพอร์ตได้ลึกสุด: 5 ปี / 10 ปี เปรียบเทียบช่วงเวลาแบบ Custom

**🌟 Hero Features (จุดขายหลักของ Premium+):**

1. **Goal-Based DCA Planner หลายเป้าหมาย**
   - ตั้งเป้าหมายได้ไม่จำกัด (ดาวน์รถ, เที่ยว, การศึกษา,
     เกษียณ ฯลฯ) — ไม่ใช่แค่วางแผนเกษียณแบบเดียว
   - ระบบคำนวณและแนะนำว่าต้องออม/เดือนเท่าไหร่ถึงจะถึงเป้า
   - เปรียบเทียบสินทรัพย์หลายแบบสำหรับแต่ละเป้าหมาย
   - แจ้งเตือนเมื่อหลุดแผน พร้อมแนะนำปรับแผนใหม่

2. **AI Financial Journal**
   - AI สรุปผลการลงทุนเป็นภาษาธรรมชาติทุกสัปดาห์/เดือน
   - สรุปเงินลงทุนทั้งหมด, กำไร/ขาดทุน, สินทรัพย์ที่เติบโตดีที่สุด,
     ความสม่ำเสมอในการทำ DCA
   - ช่วยให้ผู้ใช้เข้าใจพอร์ตตัวเองมากขึ้น ไม่ใช่คำแนะนำลงทุน

3. **Annual Investment Report**
   - รายงานสรุปการลงทุนประจำปีรูปแบบ PDF สไตล์ Spotify Wrapped
   - เงินลงทุนทั้งปี, ผลตอบแทนรวม, จำนวนครั้งที่ลงทุน,
     สินทรัพย์ที่สร้างผลตอบแทนดีที่สุด, จำนวนเดือนที่ลงทุน
     ต่อเนื่อง, สถิติการใช้งาน EasyDCA
   - ดาวน์โหลดและแชร์ได้ (ช่วย Viral Marketing)

**อื่นๆ:**
- Priority Support
- Early Access ฟีเจอร์ใหม่ก่อนใคร
- Badge พิเศษใน LINE

**หมายเหตุสำคัญ:** ฟีเจอร์กลุ่ม Premium+ ทั้งหมดต้องผ่านการ
ทดสอบและปรับปรุงอย่างรอบคอบก่อนนำไป Deploy ใช้งานจริง
ไม่รีบปล่อยทันทีที่พัฒนาเสร็จ

---

### เก็บไว้พิจารณาเพิ่มเติม (Phase 4 ปลายๆ)

**Portfolio Health Score** — ระบบ AI ให้คะแนนสุขภาพพอร์ต
(เช่น 82/100) พร้อมอธิบายเหตุผล มีไอเดียดีแต่มีความเสี่ยง
ด้านกฎหมายสูงที่สุดในกลุ่มฟีเจอร์ทั้งหมด เพราะการให้คะแนน
อาจถูกตีความเป็นการ "ตัดสิน" พอร์ต ต้องคิดเรื่อง Wording
ให้ปลอดภัยรอบคอบก่อนนำมาใส่จริง (ปรึกษา GPT เพิ่มเติม
เรื่องการใช้คำก่อนพัฒนา)

---

## 6. ตารางเปรียบเทียบแพ็กเกจ

| ฟีเจอร์ | Free | Premium | Premium+ (ทีหลัง) |
|---------|------|---------|---------|
| จำนวนสินทรัพย์ | 2 | ไม่จำกัด | ไม่จำกัด |
| Multiple Portfolio | ❌ | ✅ | ✅ |
| Web Dashboard | Demo เท่านั้น | ✅ เต็มรูปแบบ | ✅ |
| ย้อนดูพอร์ต | 30 วัน | สัปดาห์/เดือน/ปี | + 5-10 ปี |
| AI อ่านสลิป | ❌ | ✅ (Phase หลัง) | ✅ |
| Investment Goal | ❌ | 1 เป้าหมาย | ไม่จำกัด 🌟 |
| Concentration Alert | ❌ | ✅ | ✅ |
| Export Excel/PDF | ❌ | ✅ | ✅ |
| AI Financial Journal | ❌ | ❌ | ✅ 🌟 |
| Annual Investment Report | ❌ | ❌ | ✅ 🌟 |
| Priority Support | ❌ | ❌ | ✅ |
| ราคา | 0฿ | 99-129฿/เดือน | 199-249฿/เดือน |

---

## 7. Roadmap (Phase 0-4)

### Phase 0 — Architecture Design
- Database ER Diagram
- API Design (REST, versioning /api/v1)
- Folder Structure (Monorepo: API, LINE Bot, Web Dashboard,
  Admin Dashboard, Shared Packages)
- Coding Standard, Git Workflow
- Deployment Workflow, Backup Strategy
- Monitoring, CI/CD Pipeline เบื้องต้น

### Phase 0.5 — Security & Compliance
- Authentication และ Authorization ที่รัดกุม
- Row Level Security (RLS) บน Supabase
- เข้ารหัสข้อมูลสำคัญ (Encryption)
- Rate Limiting ป้องกัน Spam และ Bot
- LINE Webhook Signature Validation
- Backup และ Disaster Recovery
- Privacy Policy และ Terms of Service
- Consent สำหรับการจัดเก็บข้อมูลผู้ใช้
- ระบบลบข้อมูลตามคำขอของผู้ใช้
- Monitoring และ Alert เมื่อระบบผิดปกติ

### Phase 1 — LINE Bot Core
- รับคำสั่งภาษาไทย: "ซื้อ BTC 1000", "ขาย PTT 50 หุ้น ราคา 34",
  "พอต", "กำไร BTC", "ประวัติ"
- ระบบ Freemium (Free: 2 สินทรัพย์ / Premium: ไม่จำกัด)
- ตอบกลับด้วย Flex Message พร้อมปุ่ม Confirm/แก้ไข
- Smart Notification: แจ้งเตือน DCA ประจำเดือน, Weekly/Monthly
  Summary, แจ้งเตือน Premium ใกล้หมด (7/3/1 วันก่อนหมด)
- Rich Menu (เพิ่มรายการ, พอร์ต, ประวัติ, Premium, ตั้งค่า)
- Command History — ยกเลิกรายการล่าสุด/ย้อนกลับการบันทึก
- User Settings — สกุลเงิน, ภาษา, เขตเวลา, เปิด/ปิดแจ้งเตือน

### Phase 2 — Web UI + ชำระเงิน
- Login ด้วย LINE Account (LIFF)
- หน้าพอร์ต Dashboard: Portfolio Value, Total Investment,
  Unrealized/Realized Profit/Loss, ROI, Average Cost,
  Portfolio Allocation, Monthly Investment, Asset Performance
- หน้า Asset Detail: Current Holding, Average Cost, Current
  Price, Profit %, Transaction Count, Price Chart, Transaction
  History
- Investment Goal พร้อม Progress Bar
- Portfolio Timeline
- Demo Dashboard (สำหรับ Marketing)
- ระบบชำระเงิน:
  - หน้าเลือกแพ็กเกจ + อัพโหลดสลิปในเว็บ
  - AI Fraud Detection (ตรวจสลิปซ้ำ, ยอดไม่ตรง, สลิปหมดอายุ)
  - Payment Queue: Pending/Reviewing/Approved/Rejected/Expired
  - แจ้งแอดมินผ่าน LINE Notify ทันทีที่มีสลิปเข้า
  - แอดมิน Approve → Unlock Premium อัตโนมัติ
- Portfolio Snapshot — บันทึกมูลค่าพอร์ตทุกวันผ่าน Scheduled
  Job (รองรับ Portfolio Replay ในอนาคตโดยไม่ต้องคำนวณย้อนหลัง)
- Watchlist — ติดตามสินทรัพย์ที่สนใจแต่ยังไม่ได้ลงทุน
- ระบบค้นหาสินทรัพย์/ประวัติธุรกรรม

### Phase 3 — Admin Dashboard
เข้าได้เฉพาะทีมงาน ระบบ Role แยกชัดเจน:
- **Super Admin** — เข้าถึงทุกส่วน
- **Admin** — จัดการ User และชำระเงิน
- **Developer** — ดู Logs และระบบ
- **Support** — ดูข้อมูล User ช่วยแก้ปัญหา
- **Finance** — ดูรายได้และค่าใช้จ่าย

ข้อมูลที่แสดง:
- จำนวน User ทั้งหมด, DAU, MAU
- Conversion Rate Free → Premium
- รายได้รายวัน/เดือน/ปี, ARPU
- จำนวนธุรกรรมต่อวัน, สินทรัพย์ยอดนิยม
- จำนวนการส่งสลิป AI, กราฟสถิติการใช้งาน
- Health Dashboard (สถานะ API Server, Database, Webhook,
  Notification Queue แบบ Real-time)
- Error Log Dashboard (รวม Error จาก Webhook, Parser,
  Database, Payment)
- Broadcast Message (ส่งประกาศไปยัง Free/Premium/ใกล้หมดอายุ)
- Audit Log: บันทึกทุก Action (Approve/Reject Premium,
  แก้ไขข้อมูล User, เปลี่ยนสิทธิ์ทีมงาน, ลบข้อมูล)

### Phase 4 — Future Features
- **เปิดตัว Premium+** พร้อม Hero Features (Goal-Based DCA
  Planner หลายเป้าหมาย, AI Financial Journal, Annual
  Investment Report)
- Portfolio Replay (Time Machine ดูพอร์ตย้อนหลังแบบ Interactive)
- Portfolio Health Score (ต้องคิด Wording ให้ปลอดภัยก่อน)
- AI Portfolio Advisor ขั้นสูง
- Bank API ยืนยันการชำระเงินอัตโนมัติ (SCB Easy API /
  KBank KProxy — ต้องสมัคร Business Account ล่วงหน้า)
- Claude API อ่านรูปสลิปหุ้น/คริปโต รองรับ Bitkub, Binance,
  Bybit, OKX, Settrade, Streaming, InnovestX, Dime!, FINNOMENA

**หมายเหตุ:** Phase 4 ทั้งหมดต้องผ่านการทดสอบและปรับปรุง
อย่างรอบคอบก่อนนำไป Deploy ใช้งานจริงเสมอ

---

## 8. Database Schema (Supabase / PostgreSQL)

```
users
  id, line_user_id, display_name, picture_url,
  plan (free/premium/premium_plus), plan_expires_at,
  created_at

assets
  id, user_id, portfolio_id, symbol, name,
  type (crypto/stock/etf/fund), created_at

transactions
  id, user_id, asset_id, type (buy/sell),
  amount_thb, price_per_unit, quantity,
  date, note, created_at

payments
  id, user_id, amount, plan, slip_url,
  status (pending/reviewing/approved/rejected/expired),
  created_at, approved_at, approved_by

goals
  id, user_id, target_amount, target_date,
  goal_name, created_at

notifications
  id, user_id, type, message, sent_at, is_read

audit_logs
  id, admin_id, action, detail, created_at

portfolio_snapshots
  id, user_id, portfolio_id, total_value,
  total_invested, profit_loss, roi, snapshot_date

user_settings
  id, user_id, currency, timezone,
  dca_reminder_day, notification_enabled,
  weekly_summary, monthly_summary

watchlists
  id, user_id, symbol, name, type

system_logs
  id, type, message, stack_trace, created_at

portfolios  [เพิ่มจาก Multiple Portfolio]
  id, user_id, name, type, created_at
```

**หลักการสำคัญ:** ห้ามลบข้อมูลผู้ใช้เด็ดขาด ทุกตารางต้องมี
Row Level Security (RLS) บน Supabase

---

## 9. นโยบาย Premium หมดอายุ

**กฎหลัก: ห้ามลบข้อมูลลูกค้าเด็ดขาด**

### Grace Period 7 วัน (หลังหมดอายุ)
- ดูข้อมูลได้ปกติ
- บันทึกเพิ่มไม่ได้
- Bot แจ้งเตือนทุก 2 วัน

### หลัง 7 วัน
- ล็อคข้อมูลทั้งหมด (ไม่ใช่ลบ)
- เห็นแค่ว่ามีข้อมูลรออยู่ ต้องต่ออายุถึงจะ Unlock
- ต่ออายุแล้ว Unlock ทันที

### ตารางการแจ้งเตือน (ผ่าน LINE)
- 3 วันก่อนหมดอายุ
- วันที่หมดอายุ (เริ่ม Grace Period)
- ทุก 2 วันใน Grace Period
- วันสุดท้ายของ Grace Period (เตือนด่วน)

---

## 10. ระบบชำระเงิน

### ช่วงเปิดตัว (Manual + Phase 3 พัฒนา Bank API คู่กัน)
1. ลูกค้าเลือกแพ็กเกจ → โอนเงิน (PromptPay/โอนธนาคาร)
2. ส่งสลิปในเว็บ หรือส่งใน LINE OA โดยตรง
3. ระบบแจ้งเตือนแอดมินทันทีผ่าน LINE Notify
4. แอดมินตรวจสลิป กด Approve/Reject
5. Approve → Unlock Premium ให้ลูกค้าอัตโนมัติทันที

### ระยะยาว (Phase 4)
- เชื่อม Bank API (SCB Easy API / KBank KProxy)
- ยืนยันการชำระเงินอัตโนมัติ 100% ไม่ต้องส่งสลิป
- ต้องสมัคร Business Account ล่วงหน้า (ใช้เวลาอนุมัติ 2-4 สัปดาห์)
  แนะนำสมัครคู่ขนานไปกับการพัฒนา Phase 1-2

### Payment Queue Status
`Pending` → `Reviewing` → `Approved` / `Rejected` / `Expired`

---

## 11. Security & Compliance Checklist

- Authentication และ Authorization ที่รัดกุม (LINE Login + JWT)
- Row Level Security (RLS) บน Supabase ทุกตาราง
- เข้ารหัสข้อมูลสำคัญ (Encryption at rest)
- Rate Limiting ป้องกัน Spam และ Bot
- LINE Webhook Signature Validation
- Backup และ Disaster Recovery Plan
- Privacy Policy และ Terms of Service
- Consent สำหรับการจัดเก็บข้อมูลผู้ใช้
- ระบบลบข้อมูลตามคำขอของผู้ใช้ (Data Deletion Request)
- Monitoring และ Alert เมื่อระบบผิดปกติ
- AI Fraud Detection สำหรับสลิปการชำระเงิน

---

## 12. งบประมาณการพัฒนา (ประมาณการ)

| ช่วง | งบ/เดือน | หมายเหตุ |
|------|---------|---------|
| พัฒนา Phase 0-1 | ~1,000-1,200฿ | ใช้ Free Tier เกือบทั้งหมด |
| พัฒนา Phase 2-3 | ~900-1,500฿ | เริ่มมี Railway Starter |
| เปิด Beta | ~2,100฿ | Line OA Basic เริ่มใช้ |
| Production จริง | ~3,000-4,000฿ | ตาม User ที่เพิ่มขึ้น |

### จุดคุ้มทุน
- ต้นทุนคงที่ ~2,100฿/เดือน (ช่วง Beta)
- Premium 99฿/เดือน → ต้องมีคนจ่าย 22 คนถึงคุ้มทุน
- ถ้า Conversion Rate 20% → ต้องมี User รวม 110 คน

---

## 13. โครงสร้างเอกสาร (docs/)

```
docs/
├── README.md                  ← ภาพรวมโปรเจค
├── AI_CONTEXT.md               ← บริบทสำหรับ AI ทุกตัว (สำคัญที่สุด)
├── PRD.md                       ← ฟีเจอร์ทั้งหมด + แพ็กเกจ
├── ENV_VARIABLES.md         🆕   ← Environment Variables ทั้งหมด
├── SRS.md                       ← การทำงานทางเทคนิค
├── DATABASE.md                  ← Schema ทั้งหมด
├── API.md                       ← API Documentation (เริ่มว่าง)
├── UI_UX.md                      ← Design System + Wireframe
├── ROADMAP.md                    ← Phase 0-4
├── SECURITY.md                   ← Security Policy
├── BACKUP_AND_RECOVERY.md         ← แผน Backup และ Disaster Recovery
├── MARKETING.md                    ← กลยุทธ์การตลาด
├── CHANGELOG.md                     ← บันทึกความเปลี่ยนแปลง (มีแล้ว)
├── CODING_STANDARD.md                ← มาตรฐานโค้ด
├── DEPLOYMENT.md                      ← ขั้นตอน Deploy
└── TEST_PLAN.md                        ← แผนการทดสอบ
```

รวมทั้งหมด 16 ไฟล์

### ลำดับการเขียนเนื้อหา (ทำทีละไฟล์ ไม่รีบ) — อัพเดทตามสถานะจริง

**สัปดาห์ที่ 1 (เสร็จแล้ว ✅):** README → AI_CONTEXT → PRD → ENV_VARIABLES
**กำลังทำ:** ROADMAP
**สัปดาห์ที่ 2:** DATABASE → SRS → SECURITY → BACKUP_AND_RECOVERY
**สัปดาห์ที่ 3:** UI_UX → CODING_STANDARD → DEPLOYMENT → TEST_PLAN
**สัปดาห์ที่ 4:** Review ทั้งหมดกับ GPT → แก้ไข → เริ่ม Phase 0 จริง

หมายเหตุ: ย้าย BACKUP_AND_RECOVERY.md มาเขียนคู่กับ SECURITY.md
ในสัปดาห์ที่ 2 เพราะเป็นเรื่องที่เกี่ยวข้องกันโดยตรง ควรรู้แผน
รับมือก่อนเริ่ม Phase 1 ที่จะเริ่มมีข้อมูลผู้ใช้จริงเข้าระบบ

ENV_VARIABLES.md เพิ่มเข้ามานอกแผนเดิม ตามข้อเสนอแนะจาก GPT
Review (30 มิถุนายน 2569) เพื่อให้ระบบมีรายการ Environment
Variables ที่ชัดเจนตั้งแต่ต้น ไม่ต้องรอถึง Phase 0

---

## 14. BACKUP_AND_RECOVERY.md — รายละเอียดเนื้อหา

เอกสารนี้แยกออกจาก SECURITY.md โดยเฉพาะ เพื่อให้เป็น "คู่มือ
ปฏิบัติการจริง" ที่เปิดดูได้ทันทีเวลาเกิดเหตุฉุกเฉิน ต่างจาก
SECURITY.md ที่เป็นนโยบายภาพรวม

### โครงสร้างเนื้อหาที่ต้องมี

**1. Backup Schedule**
- Database backup ทุกกี่ชั่วโมง (Full vs Incremental)
- ความถี่ที่เหมาะสมตามขนาดข้อมูลในแต่ละ Phase
- เก็บ Backup ไว้กี่วัน/สัปดาห์/เดือน (Retention Policy)

**2. Backup Storage**
- เก็บที่ไหน (Supabase auto-backup + external storage สำรอง)
- จำนวนชุด/สถานที่จัดเก็บ (Redundancy)

**3. Restore Procedure**
- ขั้นตอน Restore ทีละขั้นแบบละเอียด
- ใครมีสิทธิ์สั่ง Restore ได้บ้าง (อ้างอิง Role จาก Phase 3)
- เวลาที่ใช้โดยประมาณในการ Restore

**4. Migration Plan**
- วิธีย้ายระบบไปเซิร์ฟเวอร์ใหม่
- Checklist ก่อน/หลัง Migration
- วิธีทดสอบว่า Migration สำเร็จและข้อมูลครบถ้วน

**5. Disaster Recovery Scenarios**
ขั้นตอนรับมือแยกตามสถานการณ์ ได้แก่ Database ล่ม, Server ล่ม
(เช่น Railway down), ข้อมูลถูกลบผิดพลาด, และระบบถูกโจมตี/Hack
โดยระบุชัดว่าใครต้องทำอะไรก่อน-หลังในแต่ละสถานการณ์

**6. Recovery Objectives**
- RTO (Recovery Time Objective) — ระบบต้องกลับมาใช้งานได้
  ภายในกี่ชั่วโมง
- RPO (Recovery Point Objective) — ยอมรับข้อมูลสูญหายได้
  มากที่สุดกี่ชั่วโมง

---

## 15. ENV_VARIABLES.md — รายการ Environment Variables

ไฟล์นี้รวบรวม Environment Variables ทั้งหมดที่ระบบต้องใช้
แยกเป็นหมวด LINE, Supabase, Authentication, Application,
และ Claude API (Phase 4) พร้อมระบุว่าตัวไหนจำเป็นต้องมี

ตัวแปรหลักที่ต้องเตรียม: `LINE_CHANNEL_SECRET`,
`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_NOTIFY_TOKEN`, `LIFF_ID`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL`, `JWT_SECRET`, `APP_URL`, `NODE_ENV`

**ข้อควรระวังสำคัญ:**
- ห้าม Commit ไฟล์ `.env` ลง Git เด็ดขาด
- `SUPABASE_SERVICE_ROLE_KEY` ใช้เฉพาะ Backend ห้าม Expose ฝั่ง Client
- `JWT_SECRET` ต้องไม่ซ้ำกันระหว่าง development/staging/production
- ใน Production ใช้ Railway Environment Variables แทนไฟล์ `.env`

---

## 16. ข้อมูลโปรเจคทางเทคนิค

- **Local Path:** `C:\Project_EasyDCA\EasyDCA`
- **Version Control:** Git + GitHub (เชื่อมต่อแล้ว)
- **วันเริ่มพัฒนาอย่างเป็นทางการ:** 1 กรกฎาคม 2569
- **Editor:** VS Code
- **Runtime:** Node.js

### สิ่งที่ติดตั้ง/เตรียมพร้อมแล้ว
- Node.js, VS Code, Git
- GitHub Repository (เชื่อมต่อแล้ว)
- Claude Pro + Claude Code (ติดตั้งและใช้งานแล้ว)
- เริ่มเขียนเนื้อหาจริงใน docs/ แล้ว
  (README.md, AI_CONTEXT.md, PRD.md, ENV_VARIABLES.md
  เสร็จแล้ว — มี Version 1.0.0 กำกับทุกไฟล์)
- โครงสร้างโฟลเดอร์โปรเจค (admin, assets, backend,
  docs, frontend, line-bot) สร้างไว้รอแล้ว ยังไม่มีโค้ด

### สิ่งที่ยังต้องทำ
- สมัคร LINE Developer Account
- สมัคร Supabase
- สมัคร Railway
- เขียนเนื้อหาที่เหลือ: ROADMAP (กำลังทำ), DATABASE, SRS,
  SECURITY, BACKUP_AND_RECOVERY, UI_UX, CODING_STANDARD,
  DEPLOYMENT, TEST_PLAN, API, MARKETING

---

## 17. สิ่งที่ตั้งใจ "ไม่ทำ" (Non-Goals)

- ไม่ใช่แอปแนะนำซื้อขายหุ้น/คริปโต
- AI จะไม่ตัดสินใจแทนผู้ใช้ในเรื่องการลงทุนใดๆ
- ไม่เก็บเงินแบบบังคับ ไม่ลบข้อมูลผู้ใช้แม้ยกเลิก Premium
- ไม่รีบ Launch ฟีเจอร์ที่ยังไม่ผ่านการทดสอบรอบคอบ
  โดยเฉพาะกลุ่ม Premium+ และ AI ขั้นสูง

---

*เอกสารนี้เป็น Single Source of Truth สำหรับโปรเจค EasyDCA
อัพเดทล่าสุด: 1 กรกฎาคม 2569 (เพิ่ม ENV_VARIABLES.md,
README/AI_CONTEXT/PRD เขียนเสร็จแล้ว, กำลังทำ ROADMAP.md)*
