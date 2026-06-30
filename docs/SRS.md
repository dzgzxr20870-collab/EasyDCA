# SRS.md — Software Requirements Specification

> เอกสารนี้อธิบายการทำงานทางเทคนิคของ EasyDCA
> ครอบคลุม Architecture, Flow ของแต่ละระบบ และ Error Handling
> ใช้ร่วมกับ [DATABASE.md](./DATABASE.md) และ [API.md](./API.md)

---

## 1. Architecture Overview

### ภาพรวมระบบ

```
┌─────────────────────────────────────────────────────────┐
│                        ผู้ใช้                            │
│              LINE OA          Web Browser                │
└──────┬─────────────────────────────┬────────────────────┘
       │                             │
       ▼                             ▼
┌──────────────┐            ┌────────────────┐
│  LINE Platform│            │  Web Dashboard │
│  (Webhook)    │            │  React + LIFF  │
└──────┬───────┘            └───────┬────────┘
       │                            │
       └────────────┬───────────────┘
                    │ HTTPS
                    ▼
        ┌───────────────────────┐
        │    API Server         │
        │  Node.js + Express    │
        │  Railway.app          │
        │                       │
        │  /api/v1/webhook      │
        │  /api/v1/auth         │
        │  /api/v1/portfolio    │
        │  /api/v1/transactions │
        │  /api/v1/payments     │
        │  /api/v1/admin        │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │    Supabase           │
        │  PostgreSQL + RLS     │
        │  Storage (slip images)│
        └───────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐    ┌─────────────────────┐
│  LINE Notify  │    │  Cron Jobs           │
│  (Admin Alert)│    │  - Daily Snapshot    │
└───────────────┘    │  - DCA Reminder      │
                     │  - Weekly Summary    │
                     │  - Monthly Summary   │
                     │  - Expiry Check      │
                     └─────────────────────┘
```

### Components

| Component | Technology | หน้าที่ |
|---|---|---|
| API Server | Node.js + Express | จัดการ Business Logic ทั้งหมด |
| LINE Bot | LINE Messaging API | รับ/ส่งข้อความกับผู้ใช้ |
| Web Dashboard | React + Chart.js | แสดง Dashboard และ Web UI |
| LIFF | LINE Front-end Framework | LINE Login บน Web |
| Database | Supabase (PostgreSQL) | เก็บข้อมูลทั้งหมด |
| Storage | Supabase Storage | เก็บรูปสลิปการชำระเงิน |
| Cron Jobs | Node-cron / Railway Cron | งานอัตโนมัติประจำวัน |
| Admin Notification | LINE Notify | แจ้งเตือน Admin |

---

## 2. LINE Bot Flow

### 2.1 Webhook Request Validation

ทุก Request ที่เข้ามาจาก LINE ต้องผ่านการตรวจสอบก่อนเสมอ

```
LINE Platform
    │
    │ POST /api/v1/webhook
    │ Header: x-line-signature
    │
    ▼
[1] ตรวจสอบ Signature
    - คำนวณ HMAC-SHA256 ของ Request Body ด้วย LINE_CHANNEL_SECRET
    - เปรียบเทียบกับ x-line-signature header
    - ถ้าไม่ตรง → return 401 (บันทึก system_log type=warning)

[2] Parse Events
    - แปลง JSON body เป็น LINE Event objects
    - Filter เฉพาะ MessageEvent type=text / type=image

[3] ส่งต่อไปยัง Handler ที่เหมาะสม
    - Text Message → Command Parser
    - Image Message → Slip Handler (Phase 4)
    - Follow Event → Welcome Flow
    - Unfollow Event → บันทึก log
```

### 2.2 Command Parser Flow

```
รับ Text Message จากผู้ใช้
    │
    ▼
[1] Normalize Text
    - แปลงเป็น lowercase
    - ตัด whitespace ส่วนเกิน
    - Normalize ตัวเลข (เช่น "๑๐๐๐" → "1000")

[2] Pattern Matching
    ├─ ซื้อ / buy
    │   Pattern: /^ซื้อ\s+(\S+)\s+([\d,]+(?:\.\d+)?)/i
    │   → BUY command
    │
    ├─ ขาย / sell
    │   Pattern: /^ขาย\s+(\S+)\s+([\d,]+(?:\.\d+)?)/i
    │   → SELL command
    │
    ├─ พอต / พอร์ต / portfolio
    │   → PORTFOLIO command
    │
    ├─ กำไร / profit [symbol]
    │   → PROFIT command
    │
    ├─ ประวัติ / history
    │   → HISTORY command
    │
    ├─ ยกเลิก / cancel
    │   → CANCEL command
    │
    └─ ไม่ตรง Pattern ใดเลย
        → ส่ง Help Message กลับ

[3] ถ้า Parse ไม่สำเร็จ
    → ส่ง Flex Message "ไม่เข้าใจคำสั่ง" พร้อมตัวอย่างการใช้งาน
```

### 2.3 BUY / SELL Transaction Flow

```
รับ BUY / SELL command
    │
    ▼
[1] ดึงข้อมูลผู้ใช้จาก line_user_id
    - ถ้าไม่มี user → สร้าง user ใหม่ + user_settings default

[2] ตรวจสอบ Freemium Limit (Free Plan)
    - นับ assets ที่ user มีอยู่
    - ถ้า >= 2 และ symbol ใหม่ที่ยังไม่มีในระบบ
      → ส่ง Flex Message แจ้งว่าถึง Limit
      → แสดงปุ่ม "อัพเกรดเป็น Premium"
      → หยุดการทำงาน

[3] ค้นหา Asset
    - ค้นหา asset ด้วย (user_id, symbol)
    - ถ้าไม่มี → สร้าง asset ใหม่ (is_active = true)

[4] สร้าง Confirm Message
    - แสดง Flex Message สรุปรายการที่จะบันทึก
      เช่น "ซื้อ BTC จำนวน 0.00032 BTC ราคา 3,125,000 บาท/BTC"
    - ปุ่ม: [✅ ยืนยัน] [✏️ แก้ไข] [❌ ยกเลิก]

[5] รอการ Confirm จากผู้ใช้
    - เก็บ pending transaction ใน Redis / Memory cache ชั่วคราว
    - มี Timeout 5 นาที — ถ้าเกินเวลาให้ยกเลิกอัตโนมัติ

[6] เมื่อผู้ใช้กด "ยืนยัน"
    - บันทึก transaction ลง Database
    - อัพเดท asset (is_active = true)
    - ส่ง Flex Message ยืนยันสำเร็จ พร้อมสรุปพอร์ตย่อ

[7] Error Handling
    - Database error → ส่ง "เกิดข้อผิดพลาด กรุณาลองใหม่"
                     → บันทึก system_log type=error, source=database
    - Timeout → ส่ง "รายการหมดเวลา กรุณาพิมคำสั่งใหม่"
```

### 2.4 PORTFOLIO Summary Flow

```
รับ PORTFOLIO command
    │
    ▼
[1] ดึง transactions ทั้งหมดของ user
[2] คำนวณสำหรับแต่ละ asset:
    - Average Cost = Σ(amount_thb) / Σ(quantity)  [เฉพาะ buy]
    - Current Quantity = Σ(buy quantity) - Σ(sell quantity)
    - Total Invested = Σ(buy amount_thb)
[3] ดึงราคาปัจจุบัน (External API — Phase 1 ใช้ราคาที่ user กรอกล่าสุด)
[4] คำนวณ P&L:
    - Current Value = Current Quantity × Current Price
    - Profit/Loss = Current Value - Total Invested
    - ROI = (Profit/Loss / Total Invested) × 100
[5] สร้าง Flex Message แสดงผลสรุปพอร์ต
```

---

## 3. Web Dashboard Flow

### 3.1 Authentication Flow (LIFF + JWT)

```
ผู้ใช้เปิด Web Dashboard
    │
    ▼
[1] LIFF Initialize
    - โหลด LIFF SDK
    - เรียก liff.init({ liffId: LIFF_ID })

[2] ตรวจสอบ Login Status
    ├─ ถ้ายังไม่ได้ Login → liff.login() (redirect ไป LINE Login)
    └─ ถ้า Login แล้ว → ดึง Access Token จาก LIFF

[3] ส่ง Access Token ไปที่ API Server
    POST /api/v1/auth/line
    Body: { accessToken: "..." }

[4] API Server ตรวจสอบ Token
    - เรียก LINE API: GET https://api.line.me/v2/profile
    - ได้รับ line_user_id, displayName, pictureUrl

[5] สร้างหรืออัพเดท User
    - ค้นหา user ด้วย line_user_id
    - ถ้าไม่มี → สร้าง user ใหม่ + user_settings default
    - อัพเดท display_name, picture_url

[6] ออก JWT Token
    - Payload: { userId, lineUserId, plan, exp }
    - Sign ด้วย JWT_SECRET
    - Return JWT ให้ Client

[7] Client เก็บ JWT
    - เก็บใน Memory (ไม่เก็บใน localStorage เพื่อความปลอดภัย)
    - แนบ Authorization: Bearer <JWT> ทุก API Request
```

### 3.2 Dashboard Data Flow

```
Client โหลด Dashboard
    │
    ▼
[1] GET /api/v1/portfolio/summary
    - API ดึง transactions ทั้งหมด
    - คำนวณ: Total Value, Total Invested, P&L, ROI, Allocation
    - Return พร้อม breakdown รายสินทรัพย์

[2] GET /api/v1/portfolio/snapshots?range=1y
    - ดึง portfolio_snapshots รายวัน
    - ใช้สร้างกราฟ Value vs Invested

[3] Render Charts
    - Portfolio Allocation: Chart.js Pie Chart
    - Value vs Invested: Chart.js Line Chart
    - Asset Performance: Chart.js Bar Chart

[4] Real-time Update
    - ไม่มี WebSocket ใน Phase 2
    - ผู้ใช้ Refresh เพื่อดูข้อมูลล่าสุด
    - (Phase 4: พิจารณา Polling หรือ WebSocket)
```

### 3.3 Plan Access Control (Web)

```
ทุก API Request ที่ต้องการ Premium
    │
    ▼
[1] Middleware ตรวจสอบ JWT
    - Verify JWT signature
    - ตรวจสอบ exp (expiry)

[2] ตรวจสอบ Plan
    - ดึง user.plan และ user.plan_expires_at จาก Database
    - ถ้า plan = 'free' และ request feature ที่ต้องการ Premium
      → return 403 { error: 'PREMIUM_REQUIRED' }
    - ถ้า plan = 'premium' แต่ plan_expires_at < now()
      → ตรวจสอบ Grace Period
      → ถ้าอยู่ใน Grace Period: อนุญาต SELECT แต่ไม่อนุญาต INSERT
      → ถ้าพ้น Grace Period: return 403 { error: 'PLAN_EXPIRED' }

[3] ถ้าผ่านทุกการตรวจสอบ → ดำเนินการต่อ
```

---

## 4. Payment Flow

### 4.1 Slip Submission Flow

```
ผู้ใช้เลือกแพ็กเกจและส่งสลิป
    │
    ▼
[1] Client อัพโหลดรูปสลิป
    POST /api/v1/payments/upload-slip
    Body: multipart/form-data { slip: File, plan: 'premium', duration: 'monthly' }

[2] ตรวจสอบไฟล์
    - ตรวจ MIME type: image/jpeg, image/png เท่านั้น
    - ตรวจขนาด: ไม่เกิน 5MB
    - ถ้าไม่ผ่าน → return 400 พร้อมข้อความชี้แจง

[3] AI Fraud Detection (เบื้องต้น)
    - คำนวณ Hash ของไฟล์ (SHA-256)
    - ค้นหา slip_hash ใน payments table
    - ถ้าซ้ำ → return 400 { error: 'DUPLICATE_SLIP' }
    - (Phase 4: Claude API ตรวจสลิปละเอียดขึ้น)

[4] อัพโหลดรูปไปยัง Supabase Storage
    - Path: slips/{user_id}/{timestamp}_{filename}
    - ได้รับ slip_url กลับมา

[5] สร้าง Payment Record
    INSERT INTO payments (user_id, amount, plan, duration, slip_url, slip_hash, status)
    VALUES (..., 'pending')

[6] แจ้งเตือน Admin ทาง LINE Notify
    ข้อความ: "💰 สลิปใหม่เข้า!\nผู้ใช้: {displayName}\nแพ็กเกจ: Premium Monthly\nจำนวน: 99 บาท\nดูที่: {admin_url}"

[7] แจ้งผู้ใช้ว่าอยู่ระหว่างตรวจสอบ
    - ส่ง Flex Message หรือ Response กลับ
    - "ระบบได้รับสลิปของคุณแล้ว อยู่ระหว่างตรวจสอบ (ปกติภายใน 24 ชั่วโมง)"
```

### 4.2 Admin Approval Flow

```
Admin เปิด Admin Dashboard
    │
    ▼
[1] GET /api/v1/admin/payments?status=pending
    - แสดงรายการสลิปที่รอตรวจ
    - แสดงรูปสลิป, ชื่อผู้ใช้, แพ็กเกจ, จำนวนเงิน, เวลาที่ส่ง

[2] Admin ตรวจสลิป
    ├─ กด Approve
    │   PATCH /api/v1/admin/payments/{id}/approve
    │   [3A] อัพเดท payment status = 'approved', approved_by, approved_at
    │   [4A] อัพเดท user.plan = 'premium', plan_expires_at = now() + duration
    │   [5A] บันทึก audit_log (action='approve_payment')
    │   [6A] ส่ง LINE Message แจ้งผู้ใช้: "✅ ชำระเงินสำเร็จ! Premium ของคุณเปิดใช้งานแล้ว"
    │
    └─ กด Reject
        PATCH /api/v1/admin/payments/{id}/reject
        Body: { reason: "ยอดเงินไม่ตรง" }
        [3B] อัพเดท payment status = 'rejected', reject_reason
        [4B] บันทึก audit_log (action='reject_payment')
        [5B] ส่ง LINE Message แจ้งผู้ใช้: "❌ สลิปไม่ผ่านการตรวจสอบ เหตุผล: {reason}"
```

---

## 5. Notification Flow (Cron Jobs)

### 5.1 ตารางงาน Cron

| งาน | Schedule | คำอธิบาย |
|---|---|---|
| Daily Snapshot | ทุกวัน 00:05 | บันทึกมูลค่าพอร์ตรายวัน |
| DCA Reminder | ทุกวัน 08:00 | ส่งแจ้งเตือน DCA ตามวันที่ user ตั้งไว้ |
| Expiry Check | ทุกวัน 09:00 | ตรวจและแจ้งเตือน Premium ใกล้หมดอายุ |
| Weekly Summary | ทุกวันจันทร์ 08:00 | ส่งสรุปพอร์ตรายสัปดาห์ (Premium) |
| Monthly Summary | วันที่ 1 ของทุกเดือน 08:00 | ส่งสรุปพอร์ตรายเดือน (Premium) |
| Payment Expiry | ทุกวัน 10:00 | ตั้ง status = 'expired' สำหรับสลิปที่เกิน 48 ชั่วโมง |

### 5.2 Daily Portfolio Snapshot

```
[Cron: ทุกวัน 00:05]
    │
    ▼
[1] ดึง user ทุกคนที่มี plan != 'free' หรือมี transactions อยู่
[2] สำหรับแต่ละ user:
    a. คำนวณ total_value, total_invested, profit_loss, roi
       จาก transactions ทั้งหมด + ราคาตลาดปัจจุบัน
    b. INSERT INTO portfolio_snapshots
       (user_id, total_value, total_invested, profit_loss, roi, snapshot_date)
    c. ถ้า user มี Multiple Portfolio → สร้าง snapshot รายพอร์ตด้วย
[3] บันทึก system_log (type=info, source=cron, message="Daily snapshot completed")
[4] Error Handling:
    - ถ้า user ใดคำนวณไม่ได้ → skip user นั้น, บันทึก error log
    - ไม่หยุด Job ทั้งหมดถ้ามี error บางส่วน
```

### 5.3 DCA Reminder Flow

```
[Cron: ทุกวัน 08:00]
    │
    ▼
[1] SELECT users ที่มี user_settings.dca_reminder_day = วันที่วันนี้
    AND notification_enabled = true
[2] สำหรับแต่ละ user:
    a. สร้างข้อความ: "🔔 วันนี้เป็นวัน DCA ของคุณ อย่าลืมลงทุนตามแผน!"
    b. ส่ง LINE Message ผ่าน LINE Messaging API
    c. INSERT INTO notifications (user_id, type='dca_reminder', message, sent_at)
[3] บันทึก system_log จำนวน notification ที่ส่ง
```

### 5.4 Premium Expiry Check Flow

```
[Cron: ทุกวัน 09:00]
    │
    ▼
[1] ตรวจ "ใกล้หมดอายุ 3 วัน"
    SELECT users WHERE plan_expires_at BETWEEN now() AND now() + interval '3 days'
    AND plan != 'free'
    → ส่งแจ้งเตือน: "⚠️ Premium ของคุณจะหมดอายุในอีก 3 วัน"

[2] ตรวจ "หมดอายุวันนี้" (เริ่ม Grace Period)
    SELECT users WHERE plan_expires_at::date = CURRENT_DATE
    AND plan != 'free'
    → ส่งแจ้งเตือน: "⚠️ Premium ของคุณหมดอายุแล้ว มี Grace Period 7 วัน"
    → (ยังไม่ lock — แค่แจ้งเตือน)

[3] ตรวจ "อยู่ใน Grace Period" (ทุก 2 วัน)
    SELECT users WHERE plan_expires_at < now()
    AND plan_expires_at > now() - interval '7 days'
    AND is_locked = false
    AND (วันนี้ - plan_expires_at) IN (2, 4, 6)
    → ส่งแจ้งเตือน: "⚠️ Premium หมดแล้ว X วัน เหลือเวลาอีก Y วัน"

[4] ตรวจ "สิ้นสุด Grace Period" (วันที่ 7)
    SELECT users WHERE plan_expires_at < now() - interval '7 days'
    AND is_locked = false
    → ส่งแจ้งเตือนด่วน
    → อัพเดท is_locked = true, locked_at = now()
    → ส่ง: "🔒 ข้อมูลของคุณถูกล็อคแล้ว ต่ออายุเพื่อ Unlock"
```

---

## 6. Error Handling

### 6.1 หลักการ

| ระดับ | การจัดการ |
|---|---|
| Validation Error (4xx) | Return error ที่ชัดเจนให้ Client แก้ไข |
| Business Logic Error | Return error code ที่ Client แปลงเป็นข้อความภาษาไทยได้ |
| Internal Server Error (5xx) | บันทึก system_log, Return generic message ให้ผู้ใช้ |
| Critical Error | บันทึก system_log + แจ้ง Admin ทาง LINE Notify |

### 6.2 Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "PREMIUM_REQUIRED",
    "message": "This feature requires Premium plan",
    "details": {}
  }
}
```

### 6.3 Error Codes

| Code | HTTP | ความหมาย |
|---|---|---|
| `INVALID_SIGNATURE` | 401 | LINE Webhook Signature ไม่ถูกต้อง |
| `UNAUTHORIZED` | 401 | JWT หมดอายุหรือไม่ถูกต้อง |
| `PREMIUM_REQUIRED` | 403 | ฟีเจอร์นี้ต้องการ Premium |
| `PLAN_EXPIRED` | 403 | Plan หมดอายุและพ้น Grace Period แล้ว |
| `ASSET_LIMIT_REACHED` | 403 | Free Plan ถึงจำกัด 2 สินทรัพย์แล้ว |
| `DUPLICATE_SLIP` | 400 | ส่งสลิปซ้ำ |
| `INVALID_FILE_TYPE` | 400 | ไฟล์ไม่ใช่รูปภาพ |
| `FILE_TOO_LARGE` | 400 | ไฟล์ใหญ่เกิน 5MB |
| `COMMAND_NOT_FOUND` | 400 | ไม่รู้จักคำสั่ง LINE Bot |
| `ASSET_NOT_FOUND` | 404 | ไม่พบสินทรัพย์ |
| `INTERNAL_ERROR` | 500 | ข้อผิดพลาดภายในระบบ |

### 6.4 Error Handling แต่ละจุด

**LINE Webhook**
```
- Signature ไม่ผ่าน → return 401, บันทึก warning log
- Parse JSON ไม่ได้ → return 400, บันทึก error log
- Command ไม่รู้จัก → ส่ง Help Message กลับผู้ใช้ (ไม่ throw error)
- Database error → ส่ง "เกิดข้อผิดพลาด กรุณาลองใหม่" ให้ผู้ใช้
                 → บันทึก error log พร้อม stack trace
- LINE API ส่งข้อความไม่ได้ → retry 1 ครั้ง, บันทึก error log
```

**Web Dashboard API**
```
- JWT ไม่ถูกต้อง → return 401 (Client redirect ไป Login)
- Plan ไม่พอ → return 403 พร้อม error code (Client แสดง Upgrade modal)
- Database timeout → return 503 พร้อม Retry-After header
- Unhandled exception → return 500, บันทึก critical error log + แจ้ง Admin
```

**Payment Flow**
```
- ไฟล์ไม่ถูกต้อง → return 400 พร้อมข้อความชี้แจง
- Supabase Storage upload ล้มเหลว → return 503, ไม่สร้าง payment record
- LINE Notify ส่งไม่ได้ → บันทึก error log แต่ Payment ยังสร้างสำเร็จ
                        → Admin เห็นใน Dashboard แทน
- Approve แล้ว unlock user ล้มเหลว → transaction rollback, บันทึก critical error
                                    → แจ้ง Admin ทาง LINE Notify ทันที
```

**Cron Jobs**
```
- Error ใน user รายหนึ่ง → skip user นั้น, บันทึก error log, ทำ user ถัดไปต่อ
- Cron Job ทั้งหมดล้มเหลว → บันทึก critical error log
                           → แจ้ง Admin ทาง LINE Notify
- Database connection ล้มเหลว → retry 3 ครั้ง ห่างกัน 30 วินาที
                               → ถ้ายังไม่ได้ → บันทึก critical error + แจ้ง Admin
```

---

## 7. Rate Limiting

| Endpoint | Limit | Window |
|---|---|---|
| LINE Webhook | ไม่ Limit (LINE ควบคุมเอง) | — |
| POST /api/v1/auth/line | 10 req | 1 นาที / IP |
| GET /api/v1/portfolio/* | 60 req | 1 นาที / user |
| POST /api/v1/transactions | 30 req | 1 นาที / user |
| POST /api/v1/payments/upload-slip | 5 req | 10 นาที / user |
| POST /api/v1/admin/* | 120 req | 1 นาที / admin |

เมื่อเกิน Limit → return 429 Too Many Requests พร้อม `Retry-After` header

---

## 8. API Versioning และ Response Format

### Versioning

- Base path: `/api/v1/`
- เมื่อต้องการเปลี่ยน Breaking change → สร้าง `/api/v2/` ใหม่
- `/api/v1/` ต้องยังทำงานได้ตลอดจนกว่าจะแจ้ง Deprecation อย่างน้อย 3 เดือน

### Success Response

```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

### Pagination (สำหรับ List endpoints)

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
