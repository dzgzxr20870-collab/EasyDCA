# UI_UX.md — Design System + Wireframe

> เอกสารนี้กำหนด Design System และโครงหน้าหลักของ EasyDCA ทั้ง Web
> Dashboard และ Flex Message บน LINE ใช้เป็น Reference เดียวกันสำหรับ
> Frontend, LINE Bot และ Admin Dashboard เพื่อให้ประสบการณ์ใช้งาน
> สอดคล้องกันทุกช่องทาง
>
> อ้างอิงฟีเจอร์และ Package จาก [PRD.md](./PRD.md), Flow จาก
> [SRS.md](./SRS.md), และ Error Code จาก SRS.md § 6

---

## 1. Design System พื้นฐาน

หลักการออกแบบ: **น่าเชื่อถือ สงบ อ่านง่าย** เหมาะกับแอปการเงิน
หลีกเลี่ยงสีฉูดฉาดหรือ Gradient เยอะ เน้นให้ตัวเลขและกราฟเป็นจุดเด่น
ของหน้าจอ ไม่ใช่ตัว UI เอง

### 1.1 สี (Color Palette)

**สีหลัก (Primary / Brand)**

| ชื่อ | Hex | การใช้งาน |
|---|---|---|
| Primary (Navy Blue) | `#0F3D68` | Header, ปุ่มหลัก, Logo, Link |
| Primary Hover | `#0C2F50` | สถานะ Hover/Active ของปุ่มหลัก |
| Primary Light | `#E6EEF5` | พื้นหลัง Section เน้น, Badge พื้นอ่อน |

**สีสถานะทางการเงิน (Financial Status)**

| ชื่อ | Hex | การใช้งาน |
|---|---|---|
| Profit / Positive | `#16A34A` | กำไร, ROI บวก, สถานะ Approved |
| Loss / Negative | `#DC2626` | ขาดทุน, ROI ลบ, สถานะ Rejected |
| Warning | `#D97706` | Premium ใกล้หมดอายุ, Concentration Alert, สถานะ Pending/Reviewing |
| Neutral Info | `#2563EB` | ข้อมูลทั่วไปที่ไม่ใช่กำไร/ขาดทุน (เช่น Total Invested) |

**สีกลาง (Neutral / Grayscale)**

| ชื่อ | Hex | การใช้งาน |
|---|---|---|
| Background | `#F8FAFC` | พื้นหลังหน้าเว็บโดยรวม |
| Surface (Card) | `#FFFFFF` | พื้นหลัง Card/Modal |
| Border | `#E2E8F0` | เส้นขอบ Card, Divider |
| Text Primary | `#1E293B` | ข้อความหลัก |
| Text Secondary | `#64748B` | ข้อความรอง, Label, Timestamp |
| Text Disabled | `#CBD5E1` | ข้อความ/ปุ่มที่ปิดใช้งาน |

**หลักการใช้สี:** สีเขียว/แดงใช้เฉพาะแสดงผลกำไร/ขาดทุนหรือสถานะ
สำเร็จ/ล้มเหลวเท่านั้น ห้ามใช้เป็นสี Decoration ทั่วไป เพื่อไม่ให้ผู้ใช้
สับสนกับความหมายทางการเงิน (ดูเพิ่มเติมหัวข้อ 5 Accessibility)

### 1.2 Font (Typography)

| การใช้งาน | Font | หมายเหตุ |
|---|---|---|
| ข้อความภาษาไทย (Body/Heading) | **Noto Sans Thai** | อ่านง่ายบนหน้าจอมือถือ รองรับสระ/วรรณยุกต์ไทยได้ดี |
| ข้อความภาษาอังกฤษ/ตัวเลข | **Inter** | ใช้คู่กับ Noto Sans Thai สำหรับตัวเลขพอร์ต/สัญลักษณ์สินทรัพย์ให้คมชัด |
| Fallback | `-apple-system, "Segoe UI", sans-serif` | กรณี Font หลักโหลดไม่ทัน |

**ขนาด Font (Type Scale)**

| ระดับ | ขนาด (px) | น้ำหนัก | การใช้งาน |
|---|---|---|---|
| Display | 32 | 700 (Bold) | ตัวเลข Portfolio Value บน Dashboard |
| H1 | 24 | 700 | หัวข้อหน้า |
| H2 | 20 | 600 | หัวข้อ Section |
| Body | 16 | 400 | ข้อความทั่วไป (ขั้นต่ำเพื่อป้องกัน iOS Auto-zoom ใน Input) |
| Body Small | 14 | 400 | Label, Caption, Timestamp |
| Micro | 12 | 400 | หมายเหตุเล็กๆ, Badge Text |

### 1.3 Spacing

ใช้หน่วยฐาน 4px คูณเป็นสเกลเดียวทั้งระบบ เพื่อให้ Layout สม่ำเสมอ:

```
4px  — spacing-1  (ระหว่าง Icon กับข้อความ)
8px  — spacing-2  (ระหว่าง Element ย่อยในกลุ่มเดียวกัน)
12px — spacing-3  (Padding ภายใน Input/Badge)
16px — spacing-4  (Padding ภายใน Card, ระยะห่างมาตรฐาน)
24px — spacing-6  (ระยะห่างระหว่าง Section ย่อย)
32px — spacing-8  (ระยะห่างระหว่าง Section หลัก)
48px — spacing-12 (ระยะห่างบน/ล่างของหน้า)
```

### 1.4 Border Radius

| ระดับ | ค่า | การใช้งาน |
|---|---|---|
| Small | 6px | Badge, Tag, Input เล็ก |
| Medium | 10px | Card, Input, Dropdown |
| Large | 16px | Modal, Bottom Sheet |
| Full | 999px | Avatar, ปุ่มวงกลม, Pill Badge (สถานะ) |

### 1.5 Elevation (เงา)

ใช้เงาบางเบามาก เพื่อรักษาความรู้สึกน่าเชื่อถือ ไม่ใช้เงาหนักแบบ
Skeuomorphic:

```
Card ปกติ:   0 1px 2px rgba(15, 23, 42, 0.06)
Card Hover:  0 2px 8px rgba(15, 23, 42, 0.10)
Modal:       0 8px 24px rgba(15, 23, 42, 0.16)
```

---

## 2. Wireframe คำอธิบายหน้าหลัก

> อธิบายเป็นโครงข้อความ (Layout จากบนลงล่าง) ยังไม่ใช่ Visual Mockup
> ใช้เป็นแนวทางให้ Frontend เริ่มออกแบบ Component จริงต่อได้

### 2.1 Landing Page (Public, ก่อน Login)

```
[Header] Logo EasyDCA | เมนู: ฟีเจอร์ / แพ็กเกจ / [ปุ่ม: เริ่มใช้งานฟรี → เพิ่มเพื่อน LINE OA]

[Hero Section]
  - หัวข้อใหญ่: คุณค่าหลัก ("บันทึกการลงทุน DCA ง่ายๆ ผ่าน LINE")
  - คำอธิบายสั้น (Pain Point ที่แก้ตาม PRD.md § 2)
  - CTA หลัก: ปุ่ม "เพิ่มเพื่อน LINE OA" + QR Code
  - ภาพประกอบ/Mockup หน้าจอ Dashboard และ LINE Chat

[Pain Point Section]
  - ตาราง/การ์ด 4 ช่อง: ปัญหา → วิธีที่ EasyDCA แก้ (จาก PRD.md § 2.1)

[Feature Highlight Section]
  - บันทึกผ่าน LINE ด้วยคำสั่งสั้นๆ (ตัวอย่างข้อความจริง)
  - Web Dashboard กราฟเต็มรูปแบบ
  - Multiple Portfolio
  - Investment Goal + Progress Bar

[Package Comparison Section]
  - ตารางเปรียบเทียบ Free / Premium (ย่อจาก PRD.md § 5)
  - ปุ่ม CTA ใต้แต่ละแพ็กเกจ

[Demo Dashboard Teaser]
  - Screenshot/ลิงก์ไปยัง Demo Dashboard (หัวข้อ 2.6) พร้อมข้อความ
    "ลองดู Dashboard ตัวอย่างก่อนสมัคร"

[Footer]
  - ลิงก์ Privacy Policy / Terms of Service (SECURITY.md § 6, 7)
  - ช่องทางติดต่อ / Social
```

### 2.2 Dashboard (Premium — หน้าหลักหลัง Login)

```
[Top Bar]
  - Logo | Portfolio Switcher (Dropdown: รวมทุกพอร์ต / Crypto / หุ้นไทย ฯลฯ — Multiple Portfolio)
  - Badge แพ็กเกจปัจจุบัน (Premium) | Avatar + ชื่อผู้ใช้ (จาก LINE Profile)

[Summary Cards Row] (4 การ์ดเรียงแนวนอน, มือถือ: เลื่อนแนวนอนหรือ Stack)
  - Portfolio Value (ตัวเลขใหญ่ Display Size)
  - Total Investment
  - Unrealized P&L (สีเขียว/แดงตามค่า + เครื่องหมาย ▲/▼)
  - ROI (%)

[Chart Section]
  - Line Chart: Portfolio Value vs Total Invested ตามช่วงเวลา
    (Toggle: สัปดาห์ / เดือน / ปี — ใช้ข้อมูลจาก portfolio_snapshots)
  - Pie Chart: Portfolio Allocation (สัดส่วนสินทรัพย์)
  - Bar Chart: Asset Performance (กำไร/ขาดทุนรายสินทรัพย์)

[Investment Goal Widget] (ถ้ามีการตั้งเป้าหมาย)
  - ชื่อเป้าหมาย, Progress Bar, จำนวนเงินสะสม / เป้าหมาย, วันที่คาดว่าจะถึง

[Concentration Alert Banner] (แสดงเมื่อมีสินทรัพย์สัดส่วนสูงผิดปกติ)
  - ข้อความเชิงข้อเท็จจริง เช่น "BTC มีสัดส่วน 75% ของพอร์ต"
    (สีเหลือง Warning ไม่ใช่สีแดง เพราะไม่ใช่ Error)

[Portfolio Timeline]
  - Feed เหตุการณ์การลงทุนล่าสุด (ซื้อ/ขาย เรียงตามเวลา)

[Asset List Table]
  - รายการสินทรัพย์ทั้งหมด: Symbol, จำนวนถือครอง, Average Cost,
    มูลค่าปัจจุบัน, กำไร % → คลิกแถวเพื่อไปหน้า Asset Detail
```

### 2.3 Asset Detail Page

```
[Header]
  - ปุ่มย้อนกลับ | Symbol + ชื่อเต็มสินทรัพย์ | Badge ประเภท (crypto/stock_th/...)
  - ราคาปัจจุบัน (ตัวใหญ่) + % เปลี่ยนแปลง

[Stats Row]
  - จำนวนที่ถือครอง (Quantity)
  - Average Cost ต่อหน่วย
  - มูลค่าปัจจุบันรวม
  - กำไร/ขาดทุน % (สีตามค่า)

[Price Chart]
  - กราฟราคาย้อนหลัง (Toggle ช่วงเวลาเช่นเดียวกับ Dashboard)

[Action Buttons]
  - [+ เพิ่มลงทุน] (Shortcut ไปบันทึกธุรกรรมใหม่สำหรับสินทรัพย์นี้)
  - [☆ เพิ่มใน Watchlist] (ถ้ายังไม่ได้ถือ หรือกรณีต้องการติดตามเพิ่ม)

[Transaction History Table]
  - วันที่ | ประเภท (ซื้อ/ขาย) | จำนวนหน่วย | ราคา/หน่วย | มูลค่ารวม | หมายเหตุ
  - เรียงจากล่าสุดไปเก่าสุด, รองรับค้นหา/กรองตามช่วงวันที่
```

### 2.4 Payment / Upload Slip Page

```
[Step 1: เลือกแพ็กเกจ]
  - การ์ดเปรียบเทียบ Free / Premium / Premium+ (จาง/ล็อคถ้ายังไม่เปิดตัว)
  - Toggle รายเดือน / รายปี (แสดงราคาที่ประหยัดได้ต่อปี)
  - ปุ่ม "เลือกแพ็กเกจนี้"

[Step 2: วิธีชำระเงิน]
  - แสดง PromptPay QR Code / เลขบัญชีธนาคาร
  - จำนวนเงินที่ต้องโอนตามแพ็กเกจที่เลือก

[Step 3: อัพโหลดสลิป]
  - Dropzone/ปุ่มถ่ายภาพ (รองรับ Drag & Drop บน Desktop, เปิดกล้อง
    โดยตรงบนมือถือ)
  - แสดง Preview รูปสลิปก่อนกดส่ง
  - Validation ทันที: ชนิดไฟล์ (jpg/png), ขนาดไม่เกิน 5MB
    (อ้างอิง Error Code `INVALID_FILE_TYPE`, `FILE_TOO_LARGE` ใน SRS.md § 6.3)

[Step 4: สถานะการตรวจสอบ] (Stepper แนวนอน/แนวตั้งตามหน้าจอ)
  - Pending → Reviewing → Approved / Rejected / Expired
  - ถ้า Rejected แสดง `reject_reason` และปุ่ม "ส่งสลิปใหม่"
  - ถ้า Approved แสดงข้อความยืนยันและปุ่ม "ไปที่ Dashboard"
```

### 2.5 Admin Dashboard (Phase 3 — Internal Only)

```
[Sidebar Navigation] (เปลี่ยนรายการตาม Role — ดู SECURITY.md § 1.3)
  - Analytics (User Stats, Revenue, Conversion)
  - Payment Queue
  - User Management
  - Broadcast Message
  - System Health
  - Error Logs
  - Audit Log

[Top Bar]
  - Badge Role ของ Admin ที่ Login อยู่ | จำนวน Alert ที่รอดำเนินการ

[Overview Cards] (หน้า Analytics)
  - Total Users, DAU, MAU
  - Conversion Rate Free → Premium
  - Revenue รายวัน/เดือน/ปี, ARPU

[Payment Queue Table]
  - รูปสลิป (Thumbnail คลิกขยาย) | ผู้ใช้ | แพ็กเกจ | จำนวนเงิน | เวลาที่ส่ง
  - ปุ่ม [Approve] [Reject] ต่อแถว (Reject ต้องกรอกเหตุผล)

[System Health Panel]
  - Indicator วงกลมสี (เขียว/เหลือง/แดง) สำหรับ API Server, Database,
    Webhook, Notification Queue แบบ Real-time

[Error Log Table]
  - กรองตาม source (webhook/parser/database/payment/...) และ type
    (error/warning/info)

[Audit Log Table]
  - Admin | Action | Target | เวลา | รายละเอียด (JSON แบบย่อ, คลิกดูเต็ม)
```

### 2.6 Demo Dashboard (สำหรับ Free User — กระตุ้นการอัพเกรด)

```
[Banner บนสุด] (Sticky)
  - "นี่คือ Dashboard ตัวอย่าง — อัพเกรดเป็น Premium เพื่อดูพอร์ตจริงของคุณ"
  - ปุ่ม [อัพเกรดเป็น Premium] เด่นชัด สี Primary

[เนื้อหา Layout เดียวกับ Dashboard จริง (หัวข้อ 2.2)]
  - ใช้ข้อมูลสมมติ (Mock Data) ที่ดูสมจริง ไม่ใช่ Placeholder ว่างเปล่า
  - มี Watermark โปร่งใสมุมหน้าจอ: "ตัวอย่าง"

[ส่วนที่ Premium เท่านั้น] แสดงแบบ Blur/Overlay พร้อม Icon กุญแจ
  - Multiple Portfolio Tabs
  - ปุ่ม Export Excel/PDF
  - Investment Goal Widget
  - คลิกส่วนที่ Blur → เปิด Modal อธิบายฟีเจอร์ + CTA อัพเกรด
```

---

## 3. Flex Message Templates (LINE)

โครงสร้างหลักที่ใช้บ่อย อ้างอิง Flow จาก [SRS.md](./SRS.md) ทุก
Template ใช้สี Design System เดียวกับหัวข้อ 1 เพื่อให้ LINE กับ Web
Dashboard ดู "เป็นแบรนด์เดียวกัน"

### 3.1 Confirm Transaction (จาก SRS.md § 2.3 ขั้นตอน [4])

ใช้ Bubble แบบ Header + Body + Footer:

```
Header:
  - ไอคอน + ป้ายสี: "🟢 ซื้อ" (พื้นเขียวอ่อน) หรือ "🔴 ขาย" (พื้นแดงอ่อน)

Body:
  - สินทรัพย์: BTC (Bitcoin)
  - จำนวน: 0.00032 BTC
  - ราคาต่อหน่วย: 3,125,000 บาท
  - มูลค่ารวม: 1,000 บาท
  - วันที่: 1 ก.ค. 2569

Footer (ปุ่ม 3 ปุ่มแนวนอน หรือ Stack บนจอแคบ):
  [✅ ยืนยัน]  (สี Primary, Primary Action)
  [✏️ แก้ไข]   (สี Text Secondary, Outline)
  [❌ ยกเลิก]  (สี Text Secondary, Text Only)
```

ตัวอย่างโครงสร้าง JSON แบบย่อ:

```json
{
  "type": "bubble",
  "header": {
    "type": "box", "layout": "horizontal",
    "backgroundColor": "#E6F4EA",
    "contents": [{ "type": "text", "text": "🟢 ยืนยันรายการซื้อ", "weight": "bold", "color": "#16A34A" }]
  },
  "body": {
    "type": "box", "layout": "vertical", "spacing": "sm",
    "contents": [
      { "type": "text", "text": "BTC (Bitcoin)", "size": "lg", "weight": "bold" },
      { "type": "text", "text": "จำนวน: 0.00032 BTC", "size": "sm", "color": "#64748B" },
      { "type": "text", "text": "ราคาต่อหน่วย: 3,125,000 บาท", "size": "sm", "color": "#64748B" },
      { "type": "text", "text": "มูลค่ารวม: 1,000 บาท", "size": "md", "weight": "bold" }
    ]
  },
  "footer": {
    "type": "box", "layout": "horizontal", "spacing": "sm",
    "contents": [
      { "type": "button", "style": "primary", "color": "#0F3D68", "action": { "type": "postback", "label": "ยืนยัน", "data": "action=confirm" } },
      { "type": "button", "style": "secondary", "action": { "type": "postback", "label": "แก้ไข", "data": "action=edit" } },
      { "type": "button", "style": "link", "action": { "type": "postback", "label": "ยกเลิก", "data": "action=cancel" } }
    ]
  }
}
```

### 3.2 Portfolio Summary (จาก SRS.md § 2.4 คำสั่ง "พอต")

```
Header:
  - ชื่อพอร์ต (หรือ "พอร์ตรวมทุกรายการ" ถ้าไม่ระบุ)

Body:
  - มูลค่าพอร์ตรวม (Display Size)
  - เงินลงทุนทั้งหมด
  - กำไร/ขาดทุน (สีเขียว/แดง + ▲/▼) พร้อม ROI %
  - รายการสินทรัพย์ Top 3 ตามมูลค่า (Symbol + กำไร %)

Footer:
  [📊 ดู Dashboard เต็มรูปแบบ] → เปิด LIFF ไปหน้า Dashboard (Premium)
                                → หรือ Demo Dashboard (Free)
```

### 3.3 Premium Expiry Alert (จาก SRS.md § 5.4)

ใช้ Bubble เดียวกัน แต่เปลี่ยนสี Header/ข้อความตามช่วงเวลา:

| ช่วงเวลา | สี Header | ข้อความหลัก |
|---|---|---|
| 3 วันก่อนหมดอายุ | เหลืองอ่อน (`#FEF3C7`) | "Premium ของคุณจะหมดอายุในอีก 3 วัน" |
| วันหมดอายุ (เริ่ม Grace Period) | ส้มอ่อน (`#FDE8CC`) | "Premium หมดอายุแล้ว มี Grace Period 7 วัน" |
| ระหว่าง Grace Period (ทุก 2 วัน) | ส้มอ่อน | "หมดอายุแล้ว X วัน เหลือเวลาอีก Y วัน ก่อนถูกล็อคข้อมูล" |
| วันสุดท้าย Grace Period | แดงอ่อน (`#FEE2E2`) | "วันสุดท้ายก่อนข้อมูลจะถูกล็อค!" |

```
Footer:
  [🔄 ต่ออายุ Premium] → เปิด LIFF ไปหน้า Payment (หัวข้อ 2.4)
```

### 3.4 แม่แบบอื่นๆ ที่ใช้หลักการเดียวกัน

Template ต่อไปนี้ใช้โครง Header/Body/Footer และสีจาก Design System
เดียวกัน ไม่ต้องออกแบบใหม่ทั้งหมด:

- **Freemium Limit Reached** — Header สีเหลือง, Body อธิบายว่าครบ 2
  สินทรัพย์แล้ว, Footer ปุ่ม [อัพเกรดเป็น Premium]
- **Payment Approved / Rejected** — Header สีเขียว/แดงตามผล, Body สรุป
  แพ็กเกจ+จำนวนเงิน (และเหตุผลถ้า Rejected)
- **Help Message (Command ไม่รู้จัก)** — Body แสดงตัวอย่างคำสั่งที่ใช้ได้
  ทั้งหมด (ซื้อ/ขาย/พอต/กำไร/ประวัติ/ยกเลิก)

---

## 4. Responsive Design (Mobile-first)

LIFF ส่วนใหญ่เปิดผ่านหน้าจอมือถือภายใน LINE App จึงออกแบบ Mobile-first
เสมอ แล้วค่อยขยายไป Tablet/Desktop

### 4.1 Breakpoints

| ชื่อ | ความกว้าง | การใช้งาน |
|---|---|---|
| Base (Mobile) | < 640px | Layout เริ่มต้น — ทุก Component ต้องใช้งานได้ดีที่ขนาดนี้ก่อนเสมอ |
| `sm` | ≥ 640px | มือถือแนวนอน / จอเล็ก |
| `md` | ≥ 768px | Tablet |
| `lg` | ≥ 1024px | Desktop — Web Dashboard เต็มรูปแบบ (Sidebar ถาวร) |
| `xl` | ≥ 1280px | Desktop จอใหญ่ (Admin Dashboard) |

### 4.2 หลักการ

- ออกแบบ Layout เริ่มจาก Viewport ประมาณ 375–430px (ขนาด LIFF ทั่วไป)
  ก่อนเสมอ ไม่ออกแบบ Desktop ก่อนแล้วค่อยบีบลงมือถือ
- Summary Cards, Chart, Table บนมือถือให้ Stack แนวตั้งหรือเลื่อน
  แนวนอนได้ (Horizontal Scroll) แทนการบีบให้เล็กจนอ่านไม่ออก
- Chart ใช้ Chart.js แบบ `responsive: true, maintainAspectRatio: false`
  เพื่อปรับตามความกว้าง Container เสมอ
- ปุ่มและ Element ที่กดได้ (Tap Target) ต้องมีขนาดขั้นต่ำ 44×44px
  ตามแนวทาง Touch Target มาตรฐาน
- Navigation บนมือถือใช้ Bottom Sheet/Bottom Nav แทน Sidebar ถาวร
  ซึ่งจะใช้เฉพาะขนาด `lg` ขึ้นไป
- Admin Dashboard ใช้งานหลักบน Desktop (`lg`/`xl`) แต่ต้องแสดงผลได้
  อย่างน้อยระดับ "ใช้งานได้" บน Tablet สำหรับกรณี Admin ตรวจสลิปด่วน
  ผ่านมือถือ/แท็บเล็ต

---

## 5. Accessibility พื้นฐาน

### 5.1 Contrast

- ข้อความหลัก (Text Primary `#1E293B` บนพื้น `#FFFFFF`/`#F8FAFC`) ต้อง
  ได้ Contrast Ratio ขั้นต่ำ **4.5:1** ตาม WCAG AA
- Element UI ที่ไม่ใช่ข้อความ (ขอบปุ่ม, Icon สื่อความหมาย) ต้องได้
  Contrast ขั้นต่ำ **3:1**
- **ห้ามสื่อความหมายด้วยสีเพียงอย่างเดียว** — กำไร/ขาดทุนต้องมีสัญลักษณ์
  ▲/▼ หรือ +/- กำกับคู่กับสีเขียว/แดงเสมอ เผื่อผู้ใช้ที่มีภาวะตาบอดสี

### 5.2 Font Size และการอ่านง่าย

- ขนาด Font ต่ำสุดที่ใช้แสดงข้อความคือ **14px** (Body Small) ห้ามใช้
  เล็กกว่านี้สำหรับเนื้อหาที่ต้องอ่าน
- Input Field บนมือถือใช้ Font ขั้นต่ำ **16px** เพื่อป้องกัน Safari/iOS
  Auto-zoom เข้าฟอร์มโดยไม่ตั้งใจ
- รองรับการ Zoom ของ Browser ได้ถึง 200% โดย Layout ไม่พังหรือ
  ข้อความซ้อนทับกัน

### 5.3 อื่นๆ

- Interactive Element (ปุ่ม, ลิงก์, Input) ต้องมี Focus State ที่มองเห็น
  ชัดเจนเมื่อใช้ Keyboard Navigation
- รูปภาพ/ไอคอนที่สื่อความหมาย (เช่น Icon เตือนใน Concentration Alert)
  ต้องมี Text อธิบายควบคู่เสมอ ไม่ใช้ไอคอนอย่างเดียว
- ทดสอบว่า Noto Sans Thai แสดงผลถูกต้องบน Browser/อุปกรณ์หลักที่กลุ่ม
  เป้าหมายใช้งาน (Chrome/Safari บน Android/iOS) ก่อน Deploy จริงทุกครั้ง

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
