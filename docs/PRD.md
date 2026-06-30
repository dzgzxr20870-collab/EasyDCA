# PRD — Product Requirements Document

> เอกสารนี้ระบุฟีเจอร์ทั้งหมดของ EasyDCA แยกตาม Package และ Phase
> ใช้เป็น Source of Truth สำหรับการตัดสินใจว่าฟีเจอร์ไหนทำเมื่อไหร่
> และอยู่ใน Package ไหน

---

## 1. Product Overview

**EasyDCA** คือ Personal Investment Platform สำหรับนักลงทุนสาย DCA ชาวไทย
ที่ต้องการติดตามพอร์ตแบบง่ายผ่าน LINE และ Web Dashboard

**Core Value Proposition:**
บันทึกการลงทุนด้วยการพิมข้อความสั้นๆ ใน LINE ระบบจัดการคำนวณและ
แสดงผลพอร์ตทั้งหมดให้อัตโนมัติ ไม่ต้องใช้ Excel ไม่ต้องจดเอง

---

## 2. กลุ่มเป้าหมาย (Target Users)

### Primary User
นักลงทุนชาวไทยที่:
- ลงทุนแบบ DCA สม่ำเสมอ (รายสัปดาห์ / รายเดือน)
- ลงทุนในสินทรัพย์หลากหลาย (Crypto, หุ้นไทย, หุ้นต่างประเทศ, ETF, กองทุน)
- ใช้ LINE เป็นช่องทางหลักในชีวิตประจำวัน
- ต้องการเครื่องมือง่าย ไม่ซับซ้อน ไม่อยากเรียนรู้แอปใหม่

### Pain Points ที่แก้
| ปัญหา | วิธีที่ EasyDCA แก้ |
|---|---|
| ต้องใช้ Excel ติดตามพอร์ต | บันทึกผ่าน LINE ด้วยคำสั่งสั้นๆ |
| ไม่รู้กำไร/ขาดทุนที่แท้จริง | ระบบคำนวณ P&L อัตโนมัติ |
| ไม่เห็นภาพรวมพอร์ตทั้งหมด | Dashboard รวมทุกสินทรัพย์ในที่เดียว |
| ลืม DCA ประจำเดือน | ระบบแจ้งเตือนอัตโนมัติ |

---

## 3. สินทรัพย์ที่รองรับ

| ประเภท | ตัวอย่าง |
|---|---|
| Crypto | BTC, ETH, BNB, SOL ฯลฯ |
| หุ้นไทย | PTT, KBANK, SCB, AOT ฯลฯ |
| หุ้นต่างประเทศ | AAPL, GOOGL, TSLA ฯลฯ |
| ETF | SSF, TISCO, LTF ฯลฯ |
| กองทุนรวม | กองทุนรวมทั่วไป |

---

## 4. โครงสร้างแพ็กเกจ

### 4.1 กลยุทธ์การเปิดตัว

เปิดตัวด้วย **2 แพ็กเกจ: Free และ Premium**
Premium+ จะตามมาใน Phase 4 หลังจากทดสอบ AI Features อย่างรอบคอบแล้ว

---

### 4.2 FREE

**เป้าหมาย:** ให้ทดลองจนติด แต่รู้สึกว่า "ไม่พอ" สำหรับคนที่ลงทุนหลายสินทรัพย์จริงจัง

**ราคา:** ฟรีตลอดชีพ

#### ฟีเจอร์ที่มี

| ฟีเจอร์ | รายละเอียด |
|---|---|
| จำนวนสินทรัพย์ | สูงสุด **2 สินทรัพย์** |
| บันทึกผ่าน LINE | พิมคำสั่งภาษาไทย เช่น "ซื้อ BTC 1000" |
| สรุปพอร์ตใน LINE | มูลค่ารวม, กำไร/ขาดทุนปัจจุบัน |
| ประวัติย้อนหลัง | **30 วัน** เท่านั้น |
| Rich Menu พื้นฐาน | ปุ่มหลักใน LINE OA |
| แจ้งเตือน DCA | 1 รายการต่อเดือน |
| Demo Dashboard | ดูตัวอย่าง Web UI เพื่อกระตุ้นการอัพเกรด |

#### ฟีเจอร์ที่ไม่มี

- Web Dashboard จริง (มีแค่ Demo)
- ย้อนดูพอร์ตรายสัปดาห์/เดือน/ปี
- Multiple Portfolio
- Investment Goal
- ส่งรูปสลิปให้ AI อ่าน
- Export ข้อมูล (Excel/PDF)
- Concentration Alert

---

### 4.3 PREMIUM

**เป้าหมาย:** ตอบโจทย์การใช้งานประจำของสาย DCA ทั่วไป
เป็นแพ็กเกจหลักที่ควรขายได้มากที่สุด

**ราคา:** 99–129 บาท/เดือน หรือ ~799 บาท/ปี

#### ฟีเจอร์ที่มี (รวมทุกอย่างใน Free บวก)

**Portfolio Management**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| จำนวนสินทรัพย์ | **ไม่จำกัด** |
| Multiple Portfolio | แยกพอร์ตได้หลายพอร์ต เช่น Crypto, หุ้นไทย, หุ้นต่างประเทศ, ETF, พอร์ตตามเป้าหมาย |
| ดู Dashboard | แยกรายพอร์ต หรือรวมทุกพอร์ตได้ |

**Web Dashboard**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| Portfolio Value vs ต้นทุน | กราฟเปรียบเทียบมูลค่าพอร์ตกับเงินที่ลงทุนไปทั้งหมด |
| Portfolio Allocation | Pie Chart แสดงสัดส่วนสินทรัพย์ |
| Asset Performance | กราฟกำไร/ขาดทุนแยกรายสินทรัพย์ |
| ย้อนดูพอร์ต | รายสัปดาห์ / รายเดือน / รายปี |
| Asset Detail | ราคาปัจจุบัน, Average Cost, จำนวนถือครอง, จำนวนครั้งที่ซื้อ, กำไร % |
| Transaction History | ประวัติการซื้อ/ขายทั้งหมด |
| Portfolio Timeline | เหตุการณ์การลงทุนแบบ Feed |
| Watchlist | ติดตามสินทรัพย์ที่สนใจแต่ยังไม่ได้ลงทุน |
| ค้นหา | ค้นหาสินทรัพย์และประวัติธุรกรรม |

**Smart Features**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| Investment Goal | ตั้งเป้าหมายได้ **1 เป้าหมาย** พร้อม Progress Bar |
| Asset Concentration Alert | แจ้งเตือนเชิงข้อมูลเมื่อสินทรัพย์ใดมีสัดส่วนสูงผิดปกติ เช่น "BTC มีสัดส่วน 75% ของพอร์ต" (รายงานข้อเท็จจริง ไม่ใช่คำแนะนำ) |
| AI อ่านสลิป | ส่งรูปสลิปให้ AI อ่านอัตโนมัติ **(Phase 4)** |

**Notifications & Reports**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| Weekly Summary | ส่งสรุปพอร์ตรายสัปดาห์อัตโนมัติผ่าน LINE |
| Monthly Summary | ส่งสรุปพอร์ตรายเดือนอัตโนมัติผ่าน LINE |
| Export | ดาวน์โหลดข้อมูลเป็น Excel หรือ PDF |

---

### 4.4 PREMIUM+ (Phase 4 — ยังไม่เปิดตัว)

**เป้าหมาย:** สำหรับนักลงทุนที่ซีเรียสเรื่องการเงิน มีหลายเป้าหมาย
ต้องการ AI ช่วยวิเคราะห์เชิงลึก

**ราคา:** 199–249 บาท/เดือน หรือ ~1,990 บาท/ปี

#### ฟีเจอร์ที่มี (รวมทุกอย่างใน Premium บวก)

**ย้อนดูพอร์ต**

| ฟีเจอร์ | รายละเอียด |
|---|---|
| Historical View | ย้อนดูพอร์ตได้ลึกสุด 5 ปี / 10 ปี |
| Custom Range | เปรียบเทียบช่วงเวลาแบบ Custom |

**Hero Features (จุดขายหลัก)**

**1. Goal-Based DCA Planner หลายเป้าหมาย**
- ตั้งเป้าหมายได้ไม่จำกัด (ดาวน์รถ, เที่ยว, การศึกษา, เกษียณ ฯลฯ)
- ระบบคำนวณว่าต้องออม/เดือนเท่าไหร่ถึงจะถึงเป้า
- เปรียบเทียบสินทรัพย์หลายแบบสำหรับแต่ละเป้าหมาย
- แจ้งเตือนเมื่อหลุดแผน พร้อมแนะนำปรับแผนใหม่

**2. AI Financial Journal**
- AI สรุปผลการลงทุนเป็นภาษาธรรมชาติทุกสัปดาห์/เดือน
- ครอบคลุม: เงินลงทุนทั้งหมด, กำไร/ขาดทุน, สินทรัพย์ที่เติบโตดีที่สุด,
  ความสม่ำเสมอในการทำ DCA
- ช่วยให้เข้าใจพอร์ตตัวเองมากขึ้น **ไม่ใช่คำแนะนำลงทุน**

**3. Annual Investment Report**
- รายงานสรุปการลงทุนประจำปีรูปแบบ PDF สไตล์ Spotify Wrapped
- ข้อมูลที่แสดง: เงินลงทุนทั้งปี, ผลตอบแทนรวม, จำนวนครั้งที่ลงทุน,
  สินทรัพย์ที่สร้างผลตอบแทนดีที่สุด, จำนวนเดือนที่ลงทุนต่อเนื่อง,
  สถิติการใช้งาน EasyDCA
- ดาวน์โหลดและแชร์ได้ (ช่วย Viral Marketing)

**สิทธิพิเศษอื่นๆ**
- Priority Support
- Early Access ฟีเจอร์ใหม่ก่อนใคร
- Badge พิเศษใน LINE

> **หมายเหตุ:** ฟีเจอร์กลุ่ม Premium+ ทั้งหมดต้องผ่านการทดสอบและปรับปรุง
> อย่างรอบคอบก่อนนำไป Deploy ใช้งานจริง ไม่รีบปล่อยทันทีที่พัฒนาเสร็จ

---

## 5. ตารางเปรียบเทียบแพ็กเกจ (สรุป)

| ฟีเจอร์ | Free | Premium | Premium+ |
|---|---|---|---|
| ราคา | 0฿ | 99–129฿/เดือน | 199–249฿/เดือน |
| จำนวนสินทรัพย์ | 2 | ไม่จำกัด | ไม่จำกัด |
| Multiple Portfolio | ❌ | ✅ | ✅ |
| Web Dashboard | Demo เท่านั้น | ✅ เต็มรูปแบบ | ✅ |
| ย้อนดูพอร์ต | 30 วัน | สัปดาห์/เดือน/ปี | + 5–10 ปี |
| AI อ่านสลิป | ❌ | ✅ (Phase 4) | ✅ |
| Investment Goal | ❌ | 1 เป้าหมาย | ไม่จำกัด |
| Concentration Alert | ❌ | ✅ | ✅ |
| Export Excel/PDF | ❌ | ✅ | ✅ |
| Weekly/Monthly Summary | ❌ | ✅ | ✅ |
| Goal-Based DCA Planner | ❌ | ❌ | ✅ |
| AI Financial Journal | ❌ | ❌ | ✅ |
| Annual Investment Report | ❌ | ❌ | ✅ |
| Priority Support | ❌ | ❌ | ✅ |

---

## 6. ฟีเจอร์แยกตาม Phase

### Phase 1 — LINE Bot Core

| ฟีเจอร์ | Package | รายละเอียด |
|---|---|---|
| รับคำสั่งภาษาไทย | Free + | "ซื้อ BTC 1000", "ขาย PTT 50 หุ้น ราคา 34", "พอต", "กำไร BTC", "ประวัติ" |
| Flex Message | Free + | ตอบกลับพร้อมปุ่ม Confirm / แก้ไข |
| Freemium Limit | Free | บันทึกได้สูงสุด 2 สินทรัพย์ แจ้งเตือนให้อัพเกรดเมื่อครบ |
| Rich Menu | Free + | เพิ่มรายการ, พอร์ต, ประวัติ, Premium, ตั้งค่า |
| DCA Reminder | Free (1), Premium (ไม่จำกัด) | แจ้งเตือน DCA ประจำเดือน |
| Weekly Summary | Premium | ส่งสรุปรายสัปดาห์อัตโนมัติ |
| Monthly Summary | Premium | ส่งสรุปรายเดือนอัตโนมัติ |
| Premium Expiry Alert | Premium | แจ้งเตือน 3 วัน / วันหมด / ทุก 2 วันใน Grace Period / วันสุดท้าย |
| Command History | Free + | ยกเลิกรายการล่าสุด / ย้อนกลับการบันทึก |
| User Settings | Free + | สกุลเงิน, ภาษา, เขตเวลา, เปิด/ปิดแจ้งเตือน |

### Phase 2 — Web Dashboard + ชำระเงิน

| ฟีเจอร์ | Package | รายละเอียด |
|---|---|---|
| LINE Login (LIFF) | Free + | เข้าสู่ระบบด้วย LINE Account |
| Demo Dashboard | Free | ดูตัวอย่าง Web UI เพื่อกระตุ้นอัพเกรด |
| Portfolio Dashboard | Premium | Portfolio Value, Total Investment, P&L, ROI, Allocation |
| Asset Detail Page | Premium | ราคาปัจจุบัน, Average Cost, กำไร %, Transaction History |
| Investment Goal | Premium | ตั้งได้ 1 เป้าหมาย พร้อม Progress Bar |
| Portfolio Timeline | Premium | เหตุการณ์การลงทุนแบบ Feed |
| Watchlist | Premium | ติดตามสินทรัพย์ที่สนใจ |
| ค้นหา | Premium | ค้นหาสินทรัพย์ / ประวัติธุรกรรม |
| Portfolio Snapshot | Premium | บันทึกมูลค่าพอร์ตทุกวัน (Scheduled Job) |
| ระบบชำระเงิน | — | อัพโหลดสลิปในเว็บ, Admin Approve, Unlock Premium |
| AI Fraud Detection | — | ตรวจสลิปซ้ำ, ยอดไม่ตรง, สลิปหมดอายุ |

### Phase 3 — Admin Dashboard

| ฟีเจอร์ | รายละเอียด |
|---|---|
| User Management | จำนวน User, DAU, MAU, Conversion Rate |
| Revenue Dashboard | รายได้รายวัน/เดือน/ปี, ARPU |
| Usage Stats | ธุรกรรมต่อวัน, สินทรัพย์ยอดนิยม |
| Health Dashboard | สถานะ API, Database, Webhook, Queue แบบ Real-time |
| Error Log Dashboard | รวม Error จาก Webhook, Parser, Database, Payment |
| Payment Management | Approve/Reject สลิป, Payment Queue |
| Broadcast Message | ส่งประกาศไปยัง Free / Premium / ใกล้หมดอายุ |
| Audit Log | บันทึกทุก Admin Action |

Admin Roles: **Super Admin, Admin, Developer, Support, Finance**

### Phase 4 — Premium+ และ AI Features

| ฟีเจอร์ | Package | รายละเอียด |
|---|---|
| เปิดตัว Premium+ | Premium+ | พร้อม Hero Features ทั้ง 3 |
| Goal-Based DCA Planner | Premium+ | หลายเป้าหมาย |
| AI Financial Journal | Premium+ | สรุปผลรายสัปดาห์/เดือน |
| Annual Investment Report | Premium+ | PDF สไตล์ Spotify Wrapped |
| Portfolio Replay | Premium+ | Time Machine ดูพอร์ตย้อนหลัง Interactive |
| AI อ่านสลิป | Premium | Bitkub, Binance, Bybit, OKX, Settrade, Streaming, InnovestX, Dime!, FINNOMENA |
| Bank API | — | SCB Easy API / KBank KProxy (ต้องสมัคร Business Account ล่วงหน้า) |

---

## 7. ฟีเจอร์ที่เก็บไว้พิจารณา (ยังไม่ตัดสินใจ)

### Portfolio Health Score
ระบบ AI ให้คะแนนสุขภาพพอร์ต (เช่น 82/100) พร้อมอธิบายเหตุผล

**ความเสี่ยง:** มีความเสี่ยงด้านกฎหมายสูงที่สุดในกลุ่มฟีเจอร์ทั้งหมด
การให้คะแนนอาจถูกตีความเป็นการ "ตัดสิน" พอร์ต
ต้องปรึกษาเรื่อง Wording ให้ปลอดภัยก่อนพัฒนา

**สถานะ:** เก็บไว้พิจารณา Phase 4 ปลายๆ

---

## 8. นโยบาย Premium หมดอายุ

**กฎหลัก: ห้ามลบข้อมูลลูกค้าเด็ดขาด**

| ช่วงเวลา | สิ่งที่เกิดขึ้น |
|---|---|
| ก่อนหมด 3 วัน | แจ้งเตือนผ่าน LINE |
| วันที่หมดอายุ | เริ่ม Grace Period, แจ้งเตือน |
| Grace Period (7 วัน) | ดูข้อมูลได้ปกติ, บันทึกเพิ่มไม่ได้, แจ้งเตือนทุก 2 วัน |
| วันสุดท้าย Grace Period | แจ้งเตือนด่วน |
| หลัง Grace Period | ล็อคข้อมูลทั้งหมด (ไม่ใช่ลบ) |
| ต่ออายุ | Unlock ทันที |

---

## 9. ระบบชำระเงิน

### ช่วงเปิดตัว (Manual Flow)

```
1. ลูกค้าเลือกแพ็กเกจ
2. โอนเงิน (PromptPay / โอนธนาคาร)
3. ส่งสลิปในเว็บ หรือส่งใน LINE OA โดยตรง
4. ระบบแจ้งเตือน Admin ทันทีผ่าน LINE Notify
5. Admin ตรวจสลิป → กด Approve / Reject
6. Approve → Unlock Premium ให้ลูกค้าอัตโนมัติทันที
```

**Payment Status:** `Pending → Reviewing → Approved / Rejected / Expired`

**AI Fraud Detection (Phase 2):**
- ตรวจสลิปซ้ำ (ใช้สลิปเดิมหลายครั้ง)
- ตรวจยอดเงินไม่ตรง
- ตรวจสลิปหมดอายุ

### Phase 4 — Bank API
เชื่อม SCB Easy API / KBank KProxy ยืนยันการชำระเงินอัตโนมัติ 100%
ต้องสมัคร Business Account ล่วงหน้า (อนุมัติ 2–4 สัปดาห์)
แนะนำสมัครคู่ขนานไปกับการพัฒนา Phase 1–2

---

## 10. Non-Goals (สิ่งที่ EasyDCA จะไม่ทำ)

- ไม่ใช่แอปแนะนำซื้อขายหุ้น/คริปโต
- AI จะไม่ตัดสินใจแทนผู้ใช้ในเรื่องการลงทุนใดๆ
- ไม่เก็บเงินแบบบังคับ ไม่ลบข้อมูลผู้ใช้แม้ยกเลิก Premium
- ไม่รีบ Launch ฟีเจอร์ที่ยังไม่ผ่านการทดสอบอย่างรอบคอบ
  โดยเฉพาะกลุ่ม Premium+ และ AI ขั้นสูง

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
