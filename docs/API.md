# API.md — API Specification

> เอกสารนี้กำหนดมาตรฐาน REST API ทั้งหมดของ EasyDCA และรายการ Endpoint
> จริงที่ต้อง Implement อ้างอิงจาก:
> - [DATABASE.md](./DATABASE.md) — Schema, Section 5–12 (ER Diagram, UUID/Timezone/Soft
>   Delete/FK Cascade/Index/Snapshot/Transaction Strategy)
> - [SRS.md](./SRS.md) — Architecture และ Flow ของแต่ละระบบ (§ 1–8)
> - [SECURITY.md](./SECURITY.md) — Authentication, RLS, Rate Limiting (§ 1, 3)
> - [CODING_STANDARD.md](./CODING_STANDARD.md) — Naming Convention (§ 1.3 camelCase)
> - [ENV_VARIABLES.md](./ENV_VARIABLES.md) — ค่า Config ที่ Endpoint เหล่านี้ต้องใช้
>
> Schema นิ่งแล้ว (DATABASE.md อัพเดทล่าสุดครบ Section 12) เอกสารนี้จึงออกแบบ
> Endpoint จริงทั้งหมดที่ผูกกับ Schema ดังกล่าว

---

## 1. API Versioning

ยืนยันตาม [SRS.md § 8](./SRS.md):

- Base path ของทุก Endpoint คือ **`/api/v1/`** ไม่มีข้อยกเว้น
- เมื่อต้องทำ Breaking Change (เปลี่ยน Response Shape, ลบ Field, เปลี่ยน
  ความหมาย Field เดิม) → สร้าง `/api/v2/` เป็น Namespace ใหม่ทั้งหมด
  ห้ามแก้ `/api/v1/` แบบ Breaking Change ตรงๆ
- Non-breaking Change (เพิ่ม Field ใหม่, เพิ่ม Endpoint ใหม่, เพิ่ม Query
  Parameter ที่ Optional) ทำใน `/api/v1/` ได้ทันทีโดยไม่ต้อง Bump Version

### นโยบาย Deprecation

1. เมื่อ `/api/v2/` พร้อมใช้งานจริง `/api/v1/` เข้าสู่สถานะ **Deprecated**
   แต่ต้องยังทำงานได้ปกติทุกประการ — **ห้ามปิดหรือเปลี่ยน Behavior ทันที**
2. ต้องแจ้ง Deprecation ล่วงหน้า **อย่างน้อย 3 เดือน** ก่อนปิด `/api/v1/`
   จริง (ตามที่ตกลงไว้ใน SRS.md § 8) ผ่านช่องทาง:
   - Response Header `Deprecation: true` และ `Sunset: <วันที่จะปิด>`
     (RFC 8594) บนทุก Response ของ `/api/v1/` หลังประกาศ Deprecate
   - แจ้งใน [CHANGELOG.md](./CHANGELOG.md) และช่องทาง Developer ที่เกี่ยวข้อง
     (เช่น Frontend/Admin/Line-bot team ที่ Consume API นี้)
3. ระหว่างช่วง Deprecation ทั้ง `/api/v1/` และ `/api/v2/` ต้องรันคู่ขนานกัน
   ได้จริง ห้าม Migration ที่บังคับให้ทั้งสอง Version ใช้ Database Schema
   คนละแบบที่เข้ากันไม่ได้
4. หลังพ้น 3 เดือน และยืนยันว่าไม่มี Client (Web/Line-bot/Admin) เหลือเรียก
   `/api/v1/` แล้วเท่านั้น จึงปิด Endpoint จริง

---

## 2. Naming Convention (Endpoint URL)

ตรงกับ [CODING_STANDARD.md § 1](./CODING_STANDARD.md) — Endpoint ทุกตัวใช้
**kebab-case** และ **พหูพจน์ (plural)** สำหรับชื่อ Resource หลัก:

| หลักการ | ตัวอย่างถูก | ตัวอย่างผิด |
|---|---|---|
| Resource เป็นพหูพจน์ | `/api/v1/transactions` | `/api/v1/transaction` |
| หลายคำใช้ kebab-case | `/api/v1/payments/upload-slip` | `/api/v1/payments/uploadSlip`, `/api/v1/payments/upload_slip` |
| Sub-resource ต่อท้ายด้วย `/{id}` | `/api/v1/goals/{id}` | `/api/v1/goal-detail/{id}` |
| Action ที่ไม่ใช่ CRUD มาตรฐานใช้ Verb ต่อท้าย Path (kebab-case) | `/api/v1/admin/payments/{id}/approve` | `/api/v1/admin/approvePayment/{id}` |
| Query Parameter ใช้ `camelCase` (ตรงกับ JSON Body Convention) | `?sort=date:desc&portfolioId=...` | `?sort=date:desc&portfolio_id=...` |

**ข้อยกเว้นที่ตกลงไว้แล้วใน SRS.md (คงไว้ตามเดิม ไม่เปลี่ยน):**
`/api/v1/portfolio/summary` และ `/api/v1/portfolio/snapshots` ใช้
`portfolio` เอกพจน์ เพราะเป็น **Feature Namespace** ของภาพรวมพอร์ตของ
User คนเดียว (มีค่าเดียวเสมอ ไม่ใช่ List ของหลาย Record) ส่วน CRUD ของ
ตาราง `portfolios` จริง (สร้าง/แก้ไข/ลบพอร์ตย่อยสำหรับ Multiple
Portfolio) ใช้ `/api/v1/portfolios` พหูพจน์ตามหลักปกติ — ดูรายละเอียดที่
Section 14.2

---

## 3. Response Format (Success)

ยืนยันและขยายจาก [SRS.md § 8](./SRS.md):

```json
{
  "success": true,
  "data": { ... }
}
```

| Field | Type | คำอธิบาย |
|---|---|---|
| `success` | boolean | `true` เสมอสำหรับ Response สำเร็จ |
| `data` | object \| array | เนื้อหาจริงของ Response — เป็น `object` สำหรับ Single Resource, เป็น `array` สำหรับ List (ดู Section 8 Pagination) |
| `meta` | object (optional) | ข้อมูลเสริมที่ไม่ใช่ตัว Resource เอง เช่น `requestId` สำหรับ Debug (ไม่บังคับ) |

**กฎสำคัญ:** ทุก Endpoint ที่สำเร็จต้องคืน `success: true` เสมอ แม้ว่า
`data` จะเป็นค่าว่าง (เช่น `DELETE` ที่สำเร็จคืน `data: null`) —
ห้ามคืน HTTP 200 พร้อม Body ที่ไม่มี `success` Field เด็ดขาด เพื่อให้ Client
เช็คสถานะได้จาก Field เดียวกันทุก Endpoint

---

## 4. Error Response Format

ใช้โครงสร้างเดียวกับ [SRS.md § 6.2](./SRS.md) ทุกประการ:

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

| Field | Type | คำอธิบาย |
|---|---|---|
| `success` | boolean | `false` เสมอ |
| `error.code` | string (`UPPER_SNAKE_CASE`) | รหัส Error ที่ Client Map เป็นข้อความภาษาไทยเองได้ (ดู [CODING_STANDARD.md § 1.2](./CODING_STANDARD.md)) |
| `error.message` | string | ข้อความภาษาอังกฤษสำหรับ Developer/Log — **ไม่ใช่ข้อความที่ส่งตรงให้ผู้ใช้เห็น** |
| `error.details` | object | รายละเอียดเพิ่มเติมเฉพาะกรณี เช่น Field ที่ Validate ไม่ผ่าน, ค่าปัจจุบันของ Resource ที่ทำให้เกิด Conflict — เป็น `{}` ได้ถ้าไม่มีรายละเอียดเพิ่ม |

**กฎสำคัญ:** ห้าม Throw Error ที่ไม่มี `code`/`message` หลุดออกไปถึง Client
เด็ดขาด (ตรงกับ Checklist ข้อ "Error Handling ตรงตามมาตรฐาน" ใน
[CODING_STANDARD.md § 5](./CODING_STANDARD.md)) — Unhandled Exception ต้อง
ถูกจับที่ `errorHandler` Middleware กลาง แล้วแปลงเป็น `INTERNAL_ERROR`
เสมอก่อนตอบกลับ

---

## 5. Error Codes (รวมทั้งหมด)

รวม Error Code เดิมจาก [SRS.md § 6.3](./SRS.md) และเพิ่ม Error Code ที่
จำเป็นสำหรับ Endpoint ใหม่ใน Section 14 ของเอกสารนี้ (แถวที่มีเครื่องหมาย
**🆕** คือ Error Code ใหม่)

| Code | HTTP | ความหมาย |
|---|---|---|
| `INVALID_SIGNATURE` | 401 | LINE Webhook Signature ไม่ถูกต้อง |
| `UNAUTHORIZED` | 401 | JWT หมดอายุ, ไม่ถูกต้อง, หรือไม่ได้แนบมา |
| `PREMIUM_REQUIRED` | 403 | ฟีเจอร์นี้ต้องการ Premium |
| `PLAN_EXPIRED` | 403 | Plan หมดอายุและพ้น Grace Period แล้ว |
| `ASSET_LIMIT_REACHED` | 403 | Free Plan ถึงจำกัด 2 สินทรัพย์แล้ว |
| `DUPLICATE_SLIP` | 400 | ส่งสลิปซ้ำ (ตรวจจาก `slip_hash`) |
| `INVALID_FILE_TYPE` | 400 | ไฟล์ไม่ใช่รูปภาพที่รองรับ |
| `FILE_TOO_LARGE` | 400 | ไฟล์ใหญ่เกิน 5MB |
| `COMMAND_NOT_FOUND` | 400 | ไม่รู้จักคำสั่ง LINE Bot |
| `ASSET_NOT_FOUND` | 404 | ไม่พบสินทรัพย์ |
| `INTERNAL_ERROR` | 500 | ข้อผิดพลาดภายในระบบ |
| `VALIDATION_ERROR` 🆕 | 400 | Request Body/Query ไม่ผ่าน Validation (Field ที่ผิดอยู่ใน `error.details`) |
| `TRANSACTION_NOT_FOUND` 🆕 | 404 | ไม่พบธุรกรรม |
| `GOAL_NOT_FOUND` 🆕 | 404 | ไม่พบเป้าหมาย |
| `PORTFOLIO_NOT_FOUND` 🆕 | 404 | ไม่พบพอร์ต |
| `PAYMENT_NOT_FOUND` 🆕 | 404 | ไม่พบรายการชำระเงิน |
| `USER_NOT_FOUND` 🆕 | 404 | ไม่พบผู้ใช้ (ใช้ในฝั่ง Admin) |
| `INSUFFICIENT_QUANTITY` 🆕 | 400 | ขายเกินจำนวนที่ถือครองอยู่จริง (ตรวจภายใน DB Transaction — ดู [DATABASE.md § 12](./DATABASE.md)) |
| `GOAL_LIMIT_REACHED` 🆕 | 403 | Premium ตั้งเป้าหมายได้ 1 รายการ — ครบ Limit แล้ว (Premium+ ไม่จำกัด) |
| `PAYMENT_ALREADY_PROCESSED` 🆕 | 409 | Payment ถูก Approve/Reject ไปแล้ว — ป้องกัน Admin กดซ้ำ (ดู Section 13 Idempotency) |
| `DISPUTE_PENDING` 🆕 | 409 | บัญชีมีข้อพิพาทการชำระเงินที่ยังไม่ยุติ — ดำเนินการลบข้อมูลไม่ได้ตอนนี้ (ดู [SECURITY.md § 8](./SECURITY.md)) |
| `FORBIDDEN` 🆕 | 403 | Role ปัจจุบันไม่มีสิทธิ์ทำ Action นี้ (RBAC ฝั่ง Admin — ดู [SECURITY.md § 1.4](./SECURITY.md)) |
| `RATE_LIMIT_EXCEEDED` 🆕 | 429 | เกิน Rate Limit ที่กำหนด (ดู Section 12) |
| `IDEMPOTENCY_KEY_REQUIRED` 🆕 | 400 | Endpoint นี้บังคับแนบ Header `Idempotency-Key` (ดู Section 13) |

---

## 6. HTTP Status Code Mapping

Mapping มาตรฐานที่ใช้ทั้งระบบ — ทุก Endpoint ต้องเลือก Status Code ตาม
ตารางนี้เท่านั้น ห้ามใช้ Code นอกรายการโดยไม่มีเหตุผลชัดเจน:

| Status | ใช้เมื่อ | ตัวอย่าง |
|---|---|---|
| `200 OK` | สำเร็จ, มี Body ส่งกลับ (GET, PATCH, POST ที่ไม่ใช่การสร้างใหม่) | `GET /transactions` |
| `201 Created` | สร้าง Resource ใหม่สำเร็จ (POST ที่สร้างข้อมูล) | `POST /transactions` |
| `204 No Content` | สำเร็จแต่ไม่มี Body ส่งกลับ (DELETE ที่ลบสำเร็จจริง) | `DELETE /goals/{id}` |
| `400 Bad Request` | Client ส่งข้อมูลผิดรูปแบบ/ผิดเงื่อนไข Business ที่ตรวจได้ก่อนเปลี่ยนสถานะ | `VALIDATION_ERROR`, `INSUFFICIENT_QUANTITY` |
| `401 Unauthorized` | ไม่ได้ Login หรือ JWT/Signature ไม่ถูกต้อง | `UNAUTHORIZED`, `INVALID_SIGNATURE` |
| `403 Forbidden` | Login แล้วแต่ไม่มีสิทธิ์ (Plan ไม่พอ, Role ไม่พอ, ถึง Limit) | `PREMIUM_REQUIRED`, `ASSET_LIMIT_REACHED`, `FORBIDDEN` |
| `404 Not Found` | ไม่พบ Resource ที่ระบุ หรือพบแต่ไม่ใช่ของ User นี้ (RLS ซ่อนเป็น 404 ไม่ใช่ 403 เพื่อไม่ Leak ว่า Resource มีอยู่จริง) | `ASSET_NOT_FOUND`, `PAYMENT_NOT_FOUND` |
| `409 Conflict` | Resource อยู่ในสถานะที่ทำ Action ซ้ำไม่ได้ | `PAYMENT_ALREADY_PROCESSED`, `DISPUTE_PENDING` |
| `422 Unprocessable Entity` | ไม่ใช้ในระบบนี้ — ใช้ `400 VALIDATION_ERROR` แทนทุกกรณีเพื่อลดความสับสนระหว่าง 400/422 | — |
| `429 Too Many Requests` | เกิน Rate Limit | ทุก Endpoint ใน Section 12 |
| `500 Internal Server Error` | Error ที่ไม่คาดคิดฝั่ง Server | `INTERNAL_ERROR` |
| `503 Service Unavailable` | Database/Storage/External Service ไม่ตอบสนอง (Retry ได้) | แนบ `Retry-After` header เสมอ |

---

## 7. Authentication Flow

สรุปจาก [SRS.md § 3.1](./SRS.md) และ [SECURITY.md § 1](./SECURITY.md) เป็น
Header/Flow ที่ทุก Endpoint (ยกเว้นที่ระบุว่า Public) ต้องผ่าน:

### Header ที่ต้องแนบ

```
Authorization: Bearer <JWT>
```

| หัวข้อ | ค่า |
|---|---|
| ที่มาของ JWT | `POST /api/v1/auth/line` หลังตรวจสอบ LINE Access Token กับ LINE Profile API สำเร็จ |
| Payload | `{ userId, lineUserId, plan, exp }` |
| Signing | HS256 ด้วย `JWT_SECRET` (ดู [ENV_VARIABLES.md](./ENV_VARIABLES.md)) |
| อายุ | `JWT_EXPIRES_IN` (Default `7d`) |
| ที่เก็บฝั่ง Client | Memory เท่านั้น **ห้าม** `localStorage`/Cookie ที่ไม่มี `HttpOnly` |

### ลำดับการตรวจสอบของ Middleware `auth` (ทุก Request ที่ต้อง Login)

```
[1] อ่าน Header Authorization: Bearer <JWT>
    - ไม่มี Header → 401 UNAUTHORIZED

[2] Verify JWT Signature + exp
    - Signature ไม่ถูกต้อง หรือหมดอายุ → 401 UNAUTHORIZED

[3] (เฉพาะ Endpoint ที่ต้องการ Premium) ตรวจสอบ Plan
    - ดึง user.plan, user.plan_expires_at จาก Database
    - plan = 'free' และ Endpoint ต้องการ Premium → 403 PREMIUM_REQUIRED
    - plan_expires_at < now() และพ้น Grace Period → 403 PLAN_EXPIRED
    - อยู่ใน Grace Period → อนุญาตเฉพาะ GET, ปฏิเสธ POST/PATCH/DELETE

[4] (เฉพาะ /api/v1/admin/*) ตรวจสอบ Role ของ Admin Account
    - Role ไม่มีสิทธิ์ทำ Action นี้ → 403 FORBIDDEN

[5] ผ่านทุกขั้นตอน → แนบ req.user (userId, plan) เข้า Request แล้วส่งต่อ
    Controller
```

**หลักการสำคัญ (Defense in Depth):** Middleware ชั้นนี้ตรวจสอบเพื่อคืน
Error ที่ Client อ่านเข้าใจได้ทันที แต่ **RLS ที่ชั้น Database (ดู
[DATABASE.md § 3](./DATABASE.md)) ยังคงบังคับใช้เสมอ** แม้ Middleware
จะมี Bug ก็ไม่สามารถเข้าถึงข้อมูลข้าม User ได้จริง — Backend เรียก
Supabase ด้วย `service_role` แล้ว Filter `user_id` เองในทุก Query
ระดับ Application อีกชั้นหนึ่งด้วย

### Endpoint ที่เป็น Public (ไม่ต้องมี `Authorization` Header)

- `POST /api/v1/auth/line`
- `POST /api/v1/webhook` (ใช้ `x-line-signature` แทน JWT — ดู
  [SECURITY.md § 4](./SECURITY.md))

---

## 8. Pagination Standard

ยืนยันรูปแบบจาก [SRS.md § 8](./SRS.md) — ใช้กับทุก Endpoint ที่คืน List
(`GET /transactions`, `GET /goals`, `GET /assets`, `GET /admin/payments`
ฯลฯ):

### Query Parameter

| Parameter | Default | คำอธิบาย |
|---|---|---|
| `page` | `1` | หน้าที่ต้องการ (เริ่มที่ 1) |
| `limit` | `20` | จำนวน Record ต่อหน้า — Max `100` (เกินกว่านี้ปัดเหลือ 100 ไม่ Error) |

### Response

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

| Field | คำอธิบาย |
|---|---|
| `total` | จำนวน Record ทั้งหมดที่ตรงเงื่อนไข Filter (ก่อนแบ่งหน้า) |
| `totalPages` | `Math.ceil(total / limit)` |

---

## 9. Sorting / Filtering

กำหนด Query Parameter มาตรฐานสำหรับทุก Endpoint แบบ List (`GET
/transactions`, `GET /goals`, `GET /assets`, `GET /admin/payments`):

### Sorting — `?sort=field:direction`

```
GET /api/v1/transactions?sort=date:desc
GET /api/v1/transactions?sort=date:desc,amountThb:asc   (เรียงหลายชั้น คั่นด้วย comma)
```

- `direction` เป็น `asc` หรือ `desc` เท่านั้น (Default `desc` ถ้าไม่ระบุ)
- `field` ต้องเป็น `camelCase` ตรงกับ JSON Response (ไม่ใช่ `snake_case`
  ของ Database)
- Field ที่อนุญาตให้ Sort ได้กำหนดเป็น Whitelist ต่อ Endpoint (ดู
  Section 14) — ถ้าส่ง Field ที่ไม่อยู่ใน Whitelist → `400
  VALIDATION_ERROR` **ห้าม Pass Field ที่ Client ส่งมาต่อเข้า `ORDER BY`
  ตรงๆ เด็ดขาด** (ป้องกัน SQL Injection ผ่านชื่อ Column)

### Filtering — `?filter[field]=value`

```
GET /api/v1/transactions?filter[type]=buy
GET /api/v1/transactions?filter[assetId]=<uuid>
GET /api/v1/transactions?filter[dateFrom]=2026-01-01&filter[dateTo]=2026-06-30
```

- ใช้ Bracket Notation `filter[field]` เพื่อแยกจาก Query Parameter อื่น
  (`page`, `limit`, `sort`) ชัดเจน
- Field ช่วงวันที่ใช้ Suffix พิเศษ `dateFrom` / `dateTo` (ไม่ใช่
  `filter[date]` ตรงๆ เพราะวันที่ต้องการเป็นช่วง ไม่ใช่ค่าเท่ากันเป๊ะ)
- Field ที่อนุญาตให้ Filter ได้เป็น Whitelist ต่อ Endpoint เช่นเดียวกับ
  Sort — Field นอก Whitelist คืน `400 VALIDATION_ERROR`
- Filter หลาย Field พร้อมกันคือเงื่อนไข `AND` เสมอ (ไม่รองรับ `OR` ระหว่าง
  Field คนละตัวใน Phase นี้)

### Filtering บน Field ประเภท Enum / CHECK Constraint

Field ที่อิงจาก `CHECK` Constraint ใน Database (เช่น `transactions.type`
`buy`/`sell`, `payments.status` `pending`/`reviewing`/`approved`/
`rejected`/`expired` — ดู [DATABASE.md § 2](./DATABASE.md)) มีกฎเพิ่มเติม
ดังนี้:

- **รับได้หลายค่าต่อการ Filter หนึ่งครั้ง** โดยคั่นด้วย **comma (`,`)**
  ภายใน Value เดียวกัน (ไม่ใช่การส่ง `filter[status]` ซ้ำหลาย Key) —
  ความหมายคือ `OR` ระหว่างค่าเหล่านั้น เช่น
  ```
  GET /api/v1/admin/payments?filter[status]=pending,reviewing
  GET /api/v1/transactions?filter[type]=buy
  ```
  (ตัวอย่างแรก: คืน Payment ที่ Status เป็น `pending` **หรือ**
  `reviewing`; `AND` ยังคงใช้ระหว่าง Field คนละตัวตามปกติ)
- **ค่าที่ยอมรับได้ต้องตรงกับ Enum ใน `CHECK` Constraint ของ Column นั้น
  เป๊ะๆ เท่านั้น** (Case-sensitive, ตรงตาม `snake_case` ค่าที่กำหนดไว้ใน
  DATABASE.md เช่น `'buy'`, `'sell'`, `'pending'`) — ไม่มีการ Normalize
  ตัวพิมพ์เล็ก/ใหญ่ให้อัตโนมัติ
- **ถ้าส่งค่าที่ไม่อยู่ใน Enum ที่กำหนดไว้ (แม้เพียงค่าเดียวในลิสต์ที่คั่น
  ด้วย comma)** → คืน `400 VALIDATION_ERROR` ทั้ง Request (ไม่ใช่เพียง
  ตัดค่านั้นทิ้งเงียบๆ) พร้อม `error.details` ระบุค่าที่ผิดและ Enum ที่
  รองรับจริง เช่น
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Invalid value for filter[status]",
      "details": {
        "field": "status",
        "invalidValue": "cancelled",
        "allowedValues": ["pending", "reviewing", "approved", "rejected", "expired"]
      }
    }
  }
  ```

---

## 10. Date Format

ตรงกับ [DATABASE.md § 7 Timezone Standard](./DATABASE.md) — Backend เก็บ
และส่งออกทุกอย่างเป็น UTC เสมอ ฝั่ง Client เป็นผู้แปลงเป็น
`Asia/Bangkok` (หรือ Timezone จาก `user_settings.timezone`) เอง

| ประเภท Field ใน Database | รูปแบบใน JSON | ตัวอย่าง |
|---|---|---|
| `TIMESTAMPTZ` (`created_at`, `updated_at`, `sentAt`, `approvedAt` ฯลฯ) | ISO 8601 พร้อม Timezone UTC (`Z` suffix) | `"2026-07-01T09:15:00.000Z"` |
| `DATE` (`date`, `targetDate`, `snapshotDate`) | ISO 8601 แบบวันที่ล้วน ไม่มีเวลา/Timezone | `"2026-07-01"` |

**ห้าม** ส่ง Timestamp แบบ Unix Epoch (Number) หรือแบบไม่มี Timezone
Suffix (เช่น `"2026-07-01 09:15:00"`) เพราะกำกวมว่าเป็น Timezone ใด

---

## 11. Decimal Precision (ตัวเลขการเงิน)

Column ที่เป็น `NUMERIC` ใน [DATABASE.md](./DATABASE.md) (เช่น
`amount_thb NUMERIC(15,2)`, `price_per_unit NUMERIC(20,8)`, `quantity
NUMERIC(20,8)`) **ต้องส่งเป็น String ใน JSON เสมอ ไม่ใช่ Number**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "assetId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "type": "buy",
  "amountThb": "3125000.00",
  "pricePerUnit": "97656250.12345678",
  "quantity": "0.00032000",
  "feeThb": "0.00",
  "date": "2026-07-01"
}
```

### เหตุผล

- `Number` ใน JavaScript/JSON เป็น IEEE 754 Double-precision Float —
  ไม่สามารถเก็บทศนิยมจำนวนมากได้แม่นยำ 100% (เช่น `0.1 + 0.2 !==
  0.3`) และ `NUMERIC(20,8)` ที่ใช้กับราคา Crypto ทศนิยม 8 หลักมีโอกาส
  คลาดเคลื่อนสูงถ้าผ่าน Float
- ถ้าส่งเป็น Number แล้ว Client แปลงกลับเป็น Float เพื่อคำนวณต่อ (เช่น
  คูณราคา × จำนวน) จะเกิด Rounding Error สะสม ซึ่งยอมรับไม่ได้กับข้อมูล
  ทางการเงิน
- ส่งเป็น String ทำให้ค่าที่ Backend คำนวณด้วย PostgreSQL `NUMERIC`
  (Exact Precision) ถูกส่งต่อไปยัง Client โดยไม่สูญเสียความแม่นยำระหว่าง
  ทาง

### ฝั่ง Client ต้องทำอย่างไร

- **ห้าม** ใช้ `parseFloat()`/`Number()` กับ Field เหล่านี้เพื่อนำไป
  คำนวณต่อ (ใช้แสดงผล Format ตัวเลขได้ แต่ไม่ใช้คำนวณ)
  ใช้ Decimal Library (เช่น `decimal.js`, `big.js`) แปลง String เป็น
  Decimal Object ก่อนคำนวณเสมอ แล้วค่อย Format เป็น String ตอนแสดงผล
- Field ที่ต้องปฏิบัติตามกฎนี้ทั้งหมด: `amountThb`, `pricePerUnit`,
  `quantity`, `feeThb`, `totalValue`, `totalInvested`, `profitLoss`,
  `roi`, `targetAmount`, `currentAmount`
- Field ที่เป็น Integer ปกติ (เช่น `page`, `limit`, `total`,
  `totalPages`, `dcaReminderDay`) ยังคงเป็น `Number` ตามปกติ — ไม่เข้า
  กฎนี้เพราะไม่มีความเสี่ยง Rounding Error

---

## 12. Rate Limiting

ยืนยันตาราง Limit จาก [SECURITY.md § 3](./SECURITY.md) (ตรงกับ
[SRS.md § 7](./SRS.md)):

| Endpoint | Limit | Window |
|---|---|---|
| LINE Webhook (`POST /api/v1/webhook`) | ไม่ Limit ฝั่ง App (LINE ควบคุมเอง) แต่ต้องผ่าน Signature Validation ก่อนเสมอ | — |
| `POST /api/v1/auth/line` | 10 req | 1 นาที / IP |
| `GET /api/v1/portfolio/*`, `GET /api/v1/portfolios*` | 60 req | 1 นาที / user |
| `POST /api/v1/transactions` | 30 req | 1 นาที / user |
| `POST /api/v1/payments/upload-slip` | 5 req | 10 นาที / user |
| `POST /api/v1/admin/*`, `PATCH /api/v1/admin/*` | 120 req | 1 นาที / admin |
| Endpoint อื่นที่ไม่อยู่ในตารางนี้ (`goals`, `assets` ฯลฯ) | 60 req | 1 นาที / user (ค่า Default ทั่วไป) |

- เกิน Limit → ตอบกลับ `429 Too Many Requests` พร้อม Body `error.code =
  RATE_LIMIT_EXCEEDED` และ Header `Retry-After` (วินาทีที่ต้องรอ)
- นับ Limit แยกตาม Key ที่เหมาะสมกับแต่ละ Endpoint: `IP` สำหรับก่อน
  Login (`auth/line`), `user_id` สำหรับหลัง Login, `admin_id` สำหรับ
  ฝั่ง Admin

---

## 13. Idempotency สำหรับ Payment API

Endpoint ที่มีผลเปลี่ยนสถานะทางการเงินแบบ **ทำซ้ำไม่ได้** (Approve/Reject
การชำระเงิน) ต้องมีกลไกป้องกัน Admin กดซ้ำ/กดพร้อมกันสองครั้ง ครอบคลุม
`PATCH /api/v1/admin/payments/{id}/approve` และ
`PATCH /api/v1/admin/payments/{id}/reject`

### กลไกที่ 1 — ตรวจสอบ Status ปัจจุบันก่อนเปลี่ยน (บังคับเสมอ)

ผูกกับ Payment Status Flow ใน [DATABASE.md](./DATABASE.md)
(`pending` → `reviewing` → `approved` / `rejected` / `expired`) และใช้
รูปแบบเดียวกับ [DATABASE.md § 12 Transaction Strategy](./DATABASE.md)
(Row Lock ก่อนตรวจสอบและเปลี่ยนค่า):

```sql
BEGIN;

-- Lock แถว payment กันสอง Request แก้ไข Record เดียวกันพร้อมกัน
SELECT status FROM payments WHERE id = :payment_id FOR UPDATE;

-- ถ้า status ไม่ใช่ 'pending' หรือ 'reviewing' แล้ว
-- → ROLLBACK ทันที และ return 409 PAYMENT_ALREADY_PROCESSED
--   พร้อม error.details = { currentStatus, approvedBy, approvedAt }

UPDATE payments SET status = 'approved', approved_by = :admin_id,
  approved_at = now() WHERE id = :payment_id;
UPDATE users SET plan = :plan, plan_expires_at = ... WHERE id = :user_id;
INSERT INTO audit_logs (admin_id, action, target_id, target_type, detail)
  VALUES (:admin_id, 'approve_payment', :payment_id, 'payment', ...);

COMMIT;
```

`SELECT ... FOR UPDATE` ทำให้ Request ที่สองที่มาถึงพร้อมกันต้องรอ
Transaction แรก Commit ก่อน แล้วจึงอ่านเจอ Status ที่เปลี่ยนไปแล้ว และ
ถูกปฏิเสธด้วย `409 PAYMENT_ALREADY_PROCESSED` แทนที่จะ Approve/Reject
ซ้ำ — ป้องกันทั้งกรณี Admin คนเดิมกดซ้ำ และ Admin สองคนกด Approve/Reject
Payment เดียวกันพร้อมกัน

### กลไกที่ 2 — `Idempotency-Key` Header (ป้องกัน Retry ซ้ำจาก Network)

นอกจากกลไกที่ 1 ซึ่งป้องกันที่ระดับ Database แล้ว ทั้งสอง Endpoint
**บังคับ** แนบ Header:

```
Idempotency-Key: <UUID ที่ Client สุ่มสร้างขึ้นใหม่ต่อการกดปุ่ม 1 ครั้ง>
```

- ถ้าไม่แนบ Header นี้ → `400 IDEMPOTENCY_KEY_REQUIRED`
- Backend เก็บคู่ `(idempotencyKey → response ที่ตอบไปครั้งแรก)` ไว้ชั่วคราว
  (เช่น 24 ชั่วโมง) เมื่อได้รับ Request ที่มี Key ซ้ำกับที่เคยประมวลผล
  สำเร็จแล้ว → **คืน Response เดิมที่เคยตอบไปทันที ไม่ประมวลผลซ้ำ** (ไม่
  ยิง LINE Message แจ้งผู้ใช้ซ้ำ ไม่เขียน `audit_logs` ซ้ำ)
- กลไกนี้ช่วยกรณีที่ Client Timeout แล้ว Retry เอง โดยไม่รู้ว่า Server
  ประมวลผลไปแล้วหรือยัง (ต่าง Case จากกลไกที่ 1 ซึ่งป้องกัน Race
  Condition ระดับ Database) ใช้ทั้งสองกลไกร่วมกันจึงครอบคลุมทั้ง Retry
  จาก Client และการกดซ้ำ/กดพร้อมกันจริง

---

## 14. Endpoint List (แยกตาม Resource)

Legend: **Auth** = ต้องแนบ `Authorization: Bearer <JWT>` หรือไม่ | **Plan**
= Plan ขั้นต่ำที่ต้องมี (`Free` / `Premium` / `Premium+` / `Admin`)

### 14.1 Auth

อ้างอิง Flow เต็มที่ [SRS.md § 3.1](./SRS.md)

| Method | Path | Auth | Plan | คำอธิบาย |
|---|---|---|---|---|
| POST | `/api/v1/auth/line` | ไม่ต้อง | — | รับ `{ accessToken }` จาก LIFF → ตรวจกับ LINE Profile API → สร้าง/อัพเดท `users` → ออก JWT |
| GET | `/api/v1/auth/me` | ✅ | Free | คืนข้อมูล User ปัจจุบัน (`id`, `displayName`, `plan`, `planExpiresAt`, `isLocked`) ใช้ตอน Dashboard โหลดครั้งแรกเพื่อตัดสินใจแสดง/ซ่อนฟีเจอร์ Premium (SRS.md § 3.3) |

> **หมายเหตุ Logout:** เนื่องจาก JWT เป็น Stateless (SECURITY.md § 1.2)
> การ Logout คือ Client ลบ Token ออกจาก Memory เอง ไม่มี Endpoint
> `/auth/logout` แยกต่างหากสำหรับ User ทั่วไป

### 14.2 Portfolio

อ้างอิง Flow เต็มที่ [SRS.md § 3.2](./SRS.md) (ภาพรวมพอร์ต) และ
`portfolios` table ใน [DATABASE.md](./DATABASE.md) (Multiple Portfolio —
Premium)

| Method | Path | Auth | Plan | คำอธิบาย |
|---|---|---|---|---|
| GET | `/api/v1/portfolio/summary` | ✅ | Free | สรุปภาพรวมพอร์ตทั้งหมด: Total Value, Total Invested, P&L, ROI, Allocation รายสินทรัพย์ (SRS.md § 3.2 [1]) |
| GET | `/api/v1/portfolio/snapshots?range=1y` | ✅ | Free | ดึง `portfolio_snapshots` รายวันสำหรับกราฟ Value vs Invested — `range` รองรับ `7d` / `30d` / `90d` / `1y` / `all` (SRS.md § 3.2 [2]) |
| GET | `/api/v1/portfolios` | ✅ | Premium | List พอร์ตย่อยทั้งหมดของ User (Multiple Portfolio) |
| POST | `/api/v1/portfolios` | ✅ | Premium | สร้างพอร์ตย่อยใหม่ — Body: `{ name, type }` |
| GET | `/api/v1/portfolios/{id}` | ✅ | Premium | ดูรายละเอียดพอร์ตย่อย 1 พอร์ต |
| PATCH | `/api/v1/portfolios/{id}` | ✅ | Premium | แก้ไขชื่อ/ประเภทพอร์ต |
| DELETE | `/api/v1/portfolios/{id}` | ✅ | Premium | ลบพอร์ตย่อย — Asset ที่อยู่ในพอร์ตนี้ย้ายเป็น "ไม่มีพอร์ต" (`portfolio_id = NULL`) ตาม FK Cascade Policy `SET NULL` ([DATABASE.md § 9](./DATABASE.md)) |

### 14.3 Transactions

อ้างอิง Flow เต็มที่ [SRS.md § 2.3](./SRS.md) (LINE Bot) และ
[DATABASE.md § 12](./DATABASE.md) (Transaction Strategy)

| Method | Path | Auth | Plan | คำอธิบาย |
|---|---|---|---|---|
| GET | `/api/v1/transactions` | ✅ | Free | List ธุรกรรมของ User — รองรับ Pagination (Section 8) และ Sort/Filter (Section 9): Sort ได้ที่ `date`, `amountThb`, `createdAt`; Filter ได้ที่ `type`, `assetId`, `portfolioId`, `dateFrom`, `dateTo` |
| GET | `/api/v1/transactions/{id}` | ✅ | Free | รายละเอียดธุรกรรม 1 รายการ |
| POST | `/api/v1/transactions` | ✅ | Free | **✅ ทำแล้ว (S8 R1a)** — บันทึกรายการซื้อ (DCA) จากฟอร์มเว็บ ผ่าน `transaction.service` ตัวเดียวกับ LINE **สัญญาจริงดู [Section 15](#15-s8-r1a--web-dca-endpoints-สัญญาจริง)** (Body จริงคือ `{ symbol, amountTotal, currency, date?, note?, pricePerUnit? }` — **ไม่ใช่** Body ที่เอกสารรุ่นก่อนร่างไว้) |
| POST | `/api/v1/transactions/undo-last` | ✅ | Free | **✅ ทำแล้ว (S8 R1a)** — ยกเลิก "รายการล่าสุดของตัวเอง" ด้วย Reversal Pattern (Immutable Ledger — [DATABASE.md § 8](./DATABASE.md)) ดู [Section 15](#15-s8-r1a--web-dca-endpoints-สัญญาจริง) |
| POST | `/api/v1/transactions/{id}/reverse` | — | — | 🚧 **ยังไม่ได้ทำ (ร่างไว้เฉยๆ)** — S8 R1a เลือกทำ `POST /transactions/undo-last` แทน เพื่อให้ Semantics ตรงกับคำสั่ง "ยกเลิก" ของ LINE เป๊ะ (ย้อนได้เฉพาะรายการล่าสุด ผ่าน `undoTransaction.service` ตัวเดียวกัน) — การรับ `{id}` อิสระจะเปิดให้ย้อนรายการเก่ากลางประวัติได้ ซึ่งทำให้ Moving Average Cost Basis เพี้ยนและไม่มีใน LINE |

> **ไม่มี `PATCH`/`DELETE` ตรงๆ บน `transactions`** เพราะ `transactions`
> เป็น Append-only ตามนโยบาย Soft Delete ([DATABASE.md § 8](./DATABASE.md))
> — แก้ไขทำผ่าน `reverse` แล้วสร้างรายการใหม่แทน

### 14.4 Assets

อ้างอิง `assets` table ใน [DATABASE.md](./DATABASE.md) และ Freemium Limit
Check ใน [SRS.md § 2.3 [2]](./SRS.md)

| Method | Path | Auth | Plan | คำอธิบาย |
|---|---|---|---|---|
| GET | `/api/v1/assets/symbols` | ✅ | Free | **✅ ทำแล้ว (S8 R1a)** — รายการสินทรัพย์ทั้งหมดที่ระบบรองรับ (Static จาก `symbolRegistry.service`) สำหรับ Dropdown ค้นหาบนเว็บ ดู [Section 15](#15-s8-r1a--web-dca-endpoints-สัญญาจริง) |
| GET | `/api/v1/assets` | ✅ | Free | List สินทรัพย์ของ User — Filter ได้ที่ `isActive`, `portfolioId`, `type` |
| GET | `/api/v1/assets/{id}` | ✅ | Free | รายละเอียดสินทรัพย์ 1 รายการ พร้อม Quantity/Average Cost ปัจจุบัน (คำนวณจาก `transactions` ตาม [DATABASE.md § 12](./DATABASE.md)) |
| PATCH | `/api/v1/assets/{id}` | ✅ | Free (`isActive`) / Premium (`portfolioId`) | แก้ไข `isActive` (Soft Delete เมื่อขายหมด) หรือย้าย `portfolioId` (Premium เท่านั้น — Free ไม่มี `portfolioId` ให้ย้าย) |

> **ไม่มี `POST /assets` แยกต่างหาก** — Asset ถูกสร้างโดยอัตโนมัติเมื่อมี
> `POST /transactions` ครั้งแรกของ `symbol` นั้น (SRS.md § 2.3 [3])
> ตรงกับ Flow ที่ตกลงไว้แล้ว ไม่ต้องเพิ่ม Endpoint สร้าง Asset ลอยๆ ที่ยัง
> ไม่มีธุรกรรมผูกอยู่

### 14.5 Goals

อ้างอิง `goals` table ใน [DATABASE.md](./DATABASE.md) — Premium: 1
เป้าหมาย, Premium+: ไม่จำกัด

| Method | Path | Auth | Plan | คำอธิบาย |
|---|---|---|---|---|
| GET | `/api/v1/goals` | ✅ | Premium, Premium+ | List เป้าหมายทั้งหมดของ User |
| GET | `/api/v1/goals/{id}` | ✅ | Premium, Premium+ | รายละเอียดเป้าหมาย 1 รายการ |
| POST | `/api/v1/goals` | ✅ | Premium (1 รายการ) / Premium+ (ไม่จำกัด) | สร้างเป้าหมายใหม่ — Premium ที่มีเป้าหมายอยู่แล้ว 1 รายการ → `403 GOAL_LIMIT_REACHED` |
| PATCH | `/api/v1/goals/{id}` | ✅ | Premium, Premium+ | แก้ไขเป้าหมาย (ชื่อ, จำนวนเงิน, วันที่, `currentAmount`) |
| DELETE | `/api/v1/goals/{id}` | ✅ | Premium, Premium+ | ลบเป้าหมายจริง (Hard Delete ได้ — `goals` ไม่มีนโยบาย Soft Delete ตาม [DATABASE.md § 8](./DATABASE.md)) |

> **หลักการ Plan Column:** Premium+ เป็น Tier ที่สูงกว่า Premium เสมอ —
> ทุก Endpoint ที่ Premium เข้าถึงได้ Premium+ เข้าถึงได้เช่นกัน ยกเว้น
> กรณีมี Limit ต่างกันชัดเจนตาม Business Rule (เช่น แถว `POST` ด้านบนที่
> Premium จำกัด 1 เป้าหมาย ส่วน Premium+ ไม่จำกัด) — แถวที่ไม่มี Limit
> ต่างกันจึงระบุทั้งสอง Plan ไว้ตรงๆ เพื่อไม่ให้ตีความผิดว่า Premium+
> เข้าถึงไม่ได้

### 14.6 Payments

อ้างอิง Flow เต็มที่ [SRS.md § 4.1](./SRS.md)

| Method | Path | Auth | Plan | คำอธิบาย |
|---|---|---|---|---|
| GET | `/api/v1/payments` | ✅ | Free | ประวัติการชำระเงินของตัวเอง |
| GET | `/api/v1/payments/{id}` | ✅ | Free | รายละเอียดรายการชำระเงิน 1 รายการ |
| POST | `/api/v1/payments/upload-slip` | ✅ | Free | อัพโหลดสลิป (`multipart/form-data`: `slip`, `plan`, `duration`) → ตรวจไฟล์ → ตรวจ `slip_hash` ซ้ำ → อัพโหลด Supabase Storage → สร้าง `payments` (`status='pending'`) → แจ้ง Admin ทาง LINE Notify (SRS.md § 4.1) |

### 14.7 Admin

อ้างอิง Flow เต็มที่ [SRS.md § 4.2](./SRS.md), Role ตาม
[SECURITY.md § 1.3–1.4](./SECURITY.md) และค่า `action` ทั้งหมดใน
`audit_logs` CHECK constraint ([DATABASE.md](./DATABASE.md)) — ทุก
Endpoint ในกลุ่มนี้บันทึก `audit_logs` เสมอ

| Method | Path | Auth | Plan/Role | คำอธิบาย | `audit_logs.action` |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/login` | ไม่ต้อง (Email+Password ผ่าน Supabase Auth) | — | Admin Login แยกช่องทางจาก User ทั่วไป (SECURITY.md § 1.3) | `login` |
| POST | `/api/v1/admin/logout` | ✅ Admin | Admin ทุก Role | Revoke Session ฝั่ง Admin | `logout` |
| GET | `/api/v1/admin/payments` | ✅ Admin | Admin, Finance | List รายการชำระเงิน — `?filter[status]=pending` (SRS.md § 4.2 [1]) | — |
| PATCH | `/api/v1/admin/payments/{id}/approve` | ✅ Admin + `Idempotency-Key` | Admin, Finance | Approve สลิป → Unlock Premium (Section 13 Idempotency) | `approve_payment` |
| PATCH | `/api/v1/admin/payments/{id}/reject` | ✅ Admin + `Idempotency-Key` | Admin, Finance | Reject สลิป — Body: `{ reason }` (Section 13 Idempotency) | `reject_payment` |
| GET | `/api/v1/admin/users` | ✅ Admin | Admin, Support | ค้นหา/List User ทั้งหมด | — |
| PATCH | `/api/v1/admin/users/{id}` | ✅ Admin | Admin | แก้ไขข้อมูล User (เช่น ปลด `isLocked` กรณีพิเศษ) | `edit_user` |
| POST | `/api/v1/admin/users/{id}/change-role` | ✅ Admin | Super Admin เท่านั้น | เปลี่ยน Role ผู้ใช้ (กรณีมี Role ระดับ User ในอนาคต) | `change_user_role` |
| DELETE | `/api/v1/admin/users/{id}/data` | ✅ Admin | Super Admin, Admin | ลบข้อมูลผู้ใช้ตามคำขอ PDPA — ปฏิเสธด้วย `409 DISPUTE_PENDING` ถ้ามี Payment สถานะ `reviewing` ค้างอยู่ (SECURITY.md § 8) | `delete_user_data` |
| POST | `/api/v1/admin/broadcasts` | ✅ Admin | Super Admin, Admin | ส่งข้อความ Broadcast หา User ผ่าน LINE | `broadcast_message` |
| POST | `/api/v1/admin/admins/{id}/role` | ✅ Admin | Super Admin เท่านั้น | เปลี่ยน Role ของ Admin คนอื่น (Phase 3 — Schema Admin Account จะออกแบบเพิ่มเติม) | `change_admin_role` |
| GET | `/api/v1/admin/audit-logs` | ✅ Admin | Super Admin, Admin | ดูประวัติ Action ของ Admin ทั้งหมด — Sort/Filter ได้ที่ `action`, `adminId`, `dateFrom`, `dateTo` | — |

### 14.8 Webhook (LINE) — ไม่ใช่ REST API ปกติ

| Method | Path | Auth | คำอธิบาย |
|---|---|---|---|
| POST | `/api/v1/webhook` | `x-line-signature` (ไม่ใช่ JWT) | รับ Event จาก LINE Platform ตรวจสอบ Signature ก่อนเสมอ (SRS.md § 2.1, SECURITY.md § 4) |

> Endpoint นี้ไม่ตาม Response Format (Section 3–4) เพราะ Request/Response
> Body ถูกกำหนดโดย LINE Platform Contract ไม่ใช่ Contract ของ EasyDCA เอง
> — Error ภายใน (เช่น Database ล้มเหลวระหว่างประมวลผล Event) ยังคง
> บันทึก `system_logs` ตามปกติ (SRS.md § 6.4) แต่ตอบกลับ LINE ด้วย
> `200 OK` เสมอตามข้อกำหนดของ LINE Messaging API (ไม่ตอบ Error Body
> กลับไปที่ LINE Platform โดยตรง)

---

## 15. S8 R1a — Web DCA Endpoints (สัญญาจริง)

Endpoint ที่ **ทำจริงและมีเทสต์ครอบแล้ว** ในรอบ S8 R1a (Backend สำหรับ Dashboard
ใหม่ + กล่องบันทึก DCA บนเว็บ) — Frontend รอบถัดไปเขียนตามสัญญาในหัวข้อนี้ได้เลย
ทุก Endpoint ผ่าน `requireAuth` + `requireConsent` และ Filter ด้วย `userId` จาก JWT
เสมอ (ไม่เคยรับ `userId` จาก Body/Query)

### ⚠️ รูปแบบ Error ของฝั่งเว็บ (ต่างจาก Section 4)

Section 4 ร่างไว้ว่า Error ต้องเป็น `{ success:false, error:{ code, message } }` แต่
**โค้ดจริงของทุก Endpoint ฝั่งเว็บ** (`auth` / `dashboard` / `payment` / `reports`)
ตอบแบบ Flat `{ error: "CODE" }` มาตั้งแต่ต้น และ `frontend/src/lib/api.js` อ่าน
`body.error` เป็น Error Code อยู่ — Endpoint ในรอบนี้จึงยึดรูปแบบเดิมของโค้ดจริง
(เปลี่ยนเป็นรูปแบบใน Section 4 = Frontend ปัจจุบันพังทันที) และ **เพิ่ม** `message`
ภาษาไทยที่แสดงให้ผู้ใช้ได้ตรงๆ:

```json
{
  "error": "PRICE_REQUIRED_FOR_ASSET",
  "message": "สินทรัพย์นี้ยังไม่มีราคาตลาดอัตโนมัติ (เช่น หุ้นไทย) กรุณากรอก \"ราคาต่อหน่วย\" ที่ซื้อด้วย",
  "details": { "symbol": "PTT", "type": "stock_th" }
}
```

| Field | คำอธิบาย |
|---|---|
| `error` | Error Code (`UPPER_SNAKE_CASE`) — ใช้ตัดสินใจใน Code |
| `message` | ข้อความไทยพร้อมแสดงผู้ใช้ตรงๆ |
| `details` | รายละเอียดเพิ่มเติม (ไม่มี Field นี้ถ้าไม่มีรายละเอียด) |

---

### 15.1 GET `/api/v1/assets/symbols`

รายการสินทรัพย์ทั้งหมดที่ระบบรองรับ (224 ตัว ณ ปัจจุบัน) สำหรับ Dropdown ค้นหา

- ข้อมูล Static ไม่แตะ DB — ตอบ `Cache-Control: private, max-age=3600`
- **ไม่มีกองทุนรวม (`fund`)** ใน List นี้ (กองทุน Resolve ผ่าน SEC API ในเส้นทาง LINE เท่านั้น)
- `type` ที่เป็นไปได้: `crypto` / `stock_th` / `stock_us` / `gold_bar` / `gold_ornament`

**Response `200`**
```json
{
  "symbols": [
    { "symbol": "BTC", "name": "Bitcoin บิตคอยน์", "type": "crypto" },
    { "symbol": "PTT", "name": "ปตท.", "type": "stock_th" },
    { "symbol": "AAPL", "name": "Apple แอปเปิล", "type": "stock_us" },
    { "symbol": "GOLD", "name": "ทองคำแท่ง (ราคาสมาคมฯ)", "type": "gold_bar" }
  ]
}
```

---

### 15.2 POST `/api/v1/transactions`

บันทึกรายการซื้อ (DCA) จากฟอร์มเว็บ — เรียก `transaction.service.processBuyCommand`
ตัวเดียวกับที่ LINE ใช้หลังกดยืนยัน (ไม่มีตรรกะสร้างธุรกรรมแยกของเว็บ)

**Request Body**

| Field | Type | บังคับ | คำอธิบาย |
|---|---|---|---|
| `symbol` | string | ✅ | ต้องอยู่ใน Registry (case-insensitive, ตัดช่องว่างให้) |
| `amountTotal` | number | ✅ | **จำนวนเงินรวม** (ไม่ใช่จำนวนหน่วย) > 0 — หน่วยตาม `currency` |
| `currency` | `"THB"` \| `"USD"` | — | Default `"THB"` — `"USD"` ใช้ได้เฉพาะ `crypto` / `stock_us` |
| `date` | string `YYYY-MM-DD` | — | Default = วันนี้ (Asia/Bangkok) — ย้อนหลังได้, **อนาคตไม่ได้** |
| `note` | string | — | ≤ 500 ตัวอักษร — ห้ามขึ้นต้นด้วย `UNDO_OF:` (Marker ของระบบ) |
| `pricePerUnit` | number | ⚠️ | **บังคับสำหรับ `stock_th`** (ไม่มี Price Feed) / ถ้าส่งมาสำหรับสินทรัพย์อื่น = ใช้ราคานี้แทนราคาตลาด (ตรงกับ LINE ที่พิมพ์ `"ซื้อ AAPL 10 หุ้น ราคา 190"` ได้) |

**2 เส้นทางที่ Map เข้า Logic เดิมของ LINE:**

| กรณี | ส่ง `pricePerUnit`? | เกิดอะไรขึ้น |
|---|---|---|
| `crypto` / `stock_us` / `gold_bar` / `gold_ornament` | ไม่ต้อง | Service ดึงราคาตลาดเอง แล้วหาร `quantity` (= เส้นทาง `"ซื้อ AAPL 1000"`) |
| `stock_th` | **บังคับ** | Controller แปลง `quantity = roundToEight(amountTotal / pricePerUnit)` แล้วส่งเข้า Service รูปแบบ `quantity + pricePerUnit` (= เส้นทาง `"ซื้อ PTT 50 หุ้น ราคา 34"`) |

**Request ตัวอย่าง**
```json
{ "symbol": "AAPL", "amountTotal": 1000, "currency": "THB", "date": "2026-07-17", "note": "DCA รายเดือน" }
```
```json
{ "symbol": "PTT", "amountTotal": 1700, "pricePerUnit": 34, "currency": "THB", "date": "2026-07-17" }
```

**Response `201`**
```json
{
  "transaction": {
    "id": "9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f",
    "symbol": "AAPL",
    "units": 5.24934383,
    "pricePerUnit": 190.5,
    "amountTotal": 1000,
    "currency": "THB",
    "date": "2026-07-17",
    "note": "DCA รายเดือน",
    "priceSource": "twelvedata",
    "newAssetCreated": false
  },
  "monthSummary": {
    "month": "2026-07",
    "count": 3,
    "amountByCurrency": { "THB": 3000, "USD": 50 }
  }
}
```

> `amountTotal` ใน Response = **ยอดที่บันทึกจริง** (สกุลตาม `currency`) ให้ Frontend
> แสดงค่านี้ ไม่ใช่ค่าที่ผู้ใช้กรอก — เส้นทาง "ระบุราคาเอง" คำนวณกลับจาก `units × price`
> `priceSource`: `coingecko` / `twelvedata` / `thaigold` / `secnav` / `user`

**Error ที่เป็นไปได้**

| Code | HTTP | เมื่อไหร่ |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `amountTotal` ไม่ใช่เลขบวก / `date` ผิดรูปแบบหรือไม่มีจริง / `currency` ไม่รู้จัก / `note` ยาวเกิน |
| `SYMBOL_NOT_SUPPORTED` | 400 | Symbol ไม่อยู่ใน Registry |
| `PRICE_REQUIRED_FOR_ASSET` | 400 | หุ้นไทย (หรือสินทรัพย์ไม่มีราคาสด) ไม่ส่ง `pricePerUnit` |
| `CURRENCY_NOT_SUPPORTED_FOR_ASSET` | 400 | `USD` กับสินทรัพย์ที่ไม่ใช่ `crypto`/`stock_us` |
| `DATE_IN_FUTURE` | 400 | วันที่เกินวันนี้ (เทียบ Asia/Bangkok) |
| `AMOUNT_TOO_SMALL_FOR_PRICE` | 400 | เงินน้อยจน `quantity` ปัดแล้วเป็น 0 |
| `NOTE_RESERVED_PREFIX` | 400 | `note` ขึ้นต้นด้วย `UNDO_OF:` |
| `ASSET_LIMIT_REACHED` | 403 | Free Plan ครบ 2 สินทรัพย์ แล้วจะสร้างตัวใหม่ |
| `PRICE_FEED_NOT_IMPLEMENTED` / `MARKET_PRICE_UNAVAILABLE` / `GOLD_PRICE_UNAVAILABLE` | 503 | ดึงราคาตลาดไม่ได้ (ไม่เดาราคา ไม่บันทึก) |

---

### 15.3 POST `/api/v1/transactions/undo-last`

ยกเลิก **รายการล่าสุดของตัวเอง** (Body ว่าง) — Reuse `undoTransaction.service`
ตัวเดียวกับคำสั่ง "ยกเลิก" ของ LINE ทุกประการ

> **ไม่มี DELETE by id** — `transactions` เป็น Immutable Ledger
> ([DATABASE.md § 8](./DATABASE.md)) การยกเลิกคือการ **INSERT รายการตรงข้าม**
> (`note = "UNDO_OF:<id เดิม>"`) ไม่ลบ/ไม่แก้แถวเดิม

**Response `200`**
```json
{
  "undone": {
    "transactionId": "9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f",
    "type": "buy",
    "symbol": "AAPL",
    "units": 5.24934383,
    "pricePerUnit": 190.5,
    "amountTotal": 1000
  },
  "reversal": { "transactionId": "1a2b3c4d-5678-4abc-9def-1234567890ab", "type": "sell" },
  "message": "ยกเลิกรายการซื้อ AAPL เรียบร้อยแล้ว"
}
```

| Code | HTTP | เมื่อไหร่ |
|---|---|---|
| `NO_TRANSACTION_TO_UNDO` | 400 | ไม่มีธุรกรรมเลย |
| `ALREADY_UNDONE` | 400 | รายการล่าสุดเป็น Reversal อยู่แล้ว (กดซ้ำ) |
| `CANNOT_UNDO_QUANTITY_MISMATCH` | 400 | ยอดคงเหลือน้อยกว่าจำนวนที่ซื้อไว้ (มีการขายตามหลัง) |

---

### 15.4 GET `/api/v1/dashboard/overview`

ข้อมูลทั้งหน้า Dashboard ใหม่ในครั้งเดียว (Endpoint เดิมทั้ง 4 ตัวของ
`/api/v1/dashboard/*` ยังอยู่ครบ ไม่ถูกแตะ)

**Response `200`**
```json
{
  "portfolio": {
    "totalCurrentValue": 87500.25,
    "unrealizedPnL": 4200.5,
    "unrealizedPnLPercent": 5.05,
    "realizedPnLByCurrency": { "THB": 1500, "USD": 0 },
    "realizedPnLThbEquivalent": 1500,
    "investedByCurrency": { "THB": 83299.75, "USD": 0 },
    "excludedCount": 2,
    "isEmpty": false
  },
  "lifetime": { "count": 42, "amountByCurrency": { "THB": 85000, "USD": 300 } },
  "thisMonth": { "month": "2026-07", "count": 3, "amountByCurrency": { "THB": 3000, "USD": 50 } },
  "streakMonths": 6,
  "allocation": [
    {
      "type": "stock_us",
      "valueByCurrency": { "THB": 45850, "USD": 0 },
      "valueThbEquivalent": 45850,
      "assets": [
        { "symbol": "AAPL", "name": "Apple แอปเปิล", "currency": "THB", "units": 10, "value": 25000, "priceUnavailable": false }
      ]
    },
    {
      "type": "stock_th",
      "valueByCurrency": { "THB": 25000, "USD": 0 },
      "valueThbEquivalent": 25000,
      "assets": [
        { "symbol": "PTT", "name": "ปตท.", "currency": "THB", "units": 50, "value": 1700, "priceUnavailable": true }
      ]
    }
  ],
  "recent": [
    {
      "id": "9f1c2e6a-1234-4bcd-9876-0a1b2c3d4e5f",
      "symbol": "NVDA", "side": "buy", "amountTotal": 1000, "currency": "THB",
      "date": "2026-07-14", "createdAt": "2026-07-14T14:04:00.000Z",
      "note": "DCA รายเดือน", "source": "web"
    }
  ],
  "monthlyInvested": [
    {
      "month": "2025-08", "count": 1,
      "amountByCurrency": { "THB": 8000, "USD": 0 },
      "cumulativeByCurrency": { "THB": 8000, "USD": 0 }
    }
  ],
  "fxRate": 35.12,
  "fxAsOf": "2026-07-17",
  "fxStale": false,
  "fxUnavailableForUsd": false
}
```

**สิ่งที่ Frontend ต้องรู้:**

1. **`portfolio.isEmpty = true`** → พอร์ตว่าง Response จะมีแค่ `{ "isEmpty": true }`
   ใน `portfolio` (ไม่มี Field ตัวเลขอื่น) — ต้องเช็คก่อนอ่าน
2. **`allocation[].assets[].priceUnavailable = true`** → ตัวนั้น **ไม่มีราคาตลาด**
   (หุ้นไทย/NAV ล่ม) ค่า `value` คือ **ต้นทุน** ไม่ใช่มูลค่าตลาด → ควรติดหมายเหตุใน UI
   (การ์ด P&L ด้านบน **ไม่รวม** ตัวพวกนี้ — ดู `portfolio.excludedCount`)
3. **ยอดทุกก้อนแยกสกุล (`amountByCurrency`)** ไม่ถูกบวกข้ามสกุลให้ — ดูเหตุผลด้านล่าง
4. **`fxUnavailableForUsd = true`** → มี USD ในพอร์ตแต่ดึงเรตไม่ได้ → **ห้าม**แสดงยอดรวม
   เทียบบาท (จะผิด) ให้เตือนผู้ใช้แทน
5. **`monthlyInvested`** = กราฟ **"เงินที่ลงไป"** ไม่ใช่มูลค่าพอร์ตย้อนหลัง — คืนครบ 12
   เดือนต่อเนื่องเสมอ (เดือนที่ไม่มีรายการ = 0) `cumulative` เริ่มนับจากเดือนแรกของ
   หน้าต่าง 12 เดือน (ไม่รวมยอดก่อนหน้านั้น — ยอดสะสมตลอดกาลอยู่ที่ `lifetime`)

> **ทำไมไม่รวม THB+USD เป็นก้อนเดียวในกราฟ/สถิติย้อนหลัง**
> `transactions.amount_thb` เก็บ "ยอดในสกุลของแถวนั้น" ตามจริง (migration 012 —
> แถว `currency='USD'` เก็บ USD) และ **ไม่มีคอลัมน์เก็บยอดเทียบบาท ณ วันที่ทำรายการ**
> ระบบก็ไม่เก็บเรต FX ย้อนหลังไว้ที่ใด → การรวมย้อนหลังต้องใช้เรตย้อนหลังที่ไม่มีจริง
> การใช้เรต "วันนี้" แปลงยอดของปีที่แล้วจะได้ตัวเลขที่ผิดและเปลี่ยนไปเรื่อยๆ ทุกวัน
> จึงคืนแยกสกุลให้ Frontend ตัดสินใจแสดงเอง (เช่น 2 เส้น/2 แท่ง หรือให้ผู้ใช้สลับสกุล)
> — ส่วนการ์ด "มูลค่าพอร์ตวันนี้" รวมข้ามสกุลได้ เพราะเป็นมูลค่า ณ ปัจจุบัน ใช้เรต
> ปัจจุบัน (`fxRate`) ถูกต้องตามนิยาม

**นิยาม `streakMonths`:** จำนวนเดือนติดต่อกันที่มีรายการซื้ออย่างน้อย 1 รายการ นับ
ถอยหลังจากเดือนปัจจุบัน (Asia/Bangkok) — เดือนปัจจุบันนับรวมถ้ามี ≥1 รายการ ถ้ายัง
ไม่มีจะเริ่มนับจากเดือนก่อนหน้า (ผู้ใช้ยังมีเวลาทั้งเดือนที่จะบันทึก จึงไม่ตัด Streak
เป็น 0 ทันทีในวันที่ 1) ขาดเดือนใด = จบทันที / **รายการที่ถูกยกเลิกแล้วไม่นับ**
(ทั้งแถวต้นฉบับและแถว Reversal) ทั้งใน Streak, `count` และยอดเงินทุกก้อน

**Field `todayDuePlans` (เพิ่มใน S8 R3 — Additive):** Array ของแผน DCA ที่ "ถึงรอบ
วันนี้" (เทียบวันนี้ตาม Asia/Bangkok) สำหรับ Panel "วันนี้ถึงรอบ DCA ของคุณ" + ปุ่ม
"บันทึกเลย" ที่ Prefill ฟอร์มบันทึก DCA ด้วย `symbol` + `amountTotal` + `currency`
ตรงๆ (Frontend ไม่คำนวณวัน/เงินเอง) — คำนวณจากแผน `active` ผ่าน Logic เดียวกับ Cron
แจ้งเตือน (รวม Clamp วันสิ้นเดือน) ว่างเปล่า `[]` ถ้าไม่มีแผนถึงรอบ:
```json
"todayDuePlans": [
  { "id": "uuid", "symbol": "SET", "name": "ดัชนี SET50", "amountTotal": 3000,
    "currency": "THB", "frequency": "monthly", "dayOfWeek": null, "dayOfMonth": 16,
    "dayLabel": "ทุกวันที่ 16 ของเดือน" }
]
```
> แต่ละ Object มี Field เหมือน "plan view" ของ §15.5 (ยกเว้นไม่มี `active` เพราะเป็น
> `active` เสมอ) — Frontend ใช้ `symbol`/`amountTotal`/`currency` Prefill ฟอร์ม, ใช้
> `name`/`dayLabel` แสดงผล

---

## 15.5 S8 R3 — DCA Plans Endpoints (แผน DCA บนเว็บ)

**"แผน DCA" = แถวใน `dca_reminders` (migration 002 + 020)** — ตารางเดียวกับ "ตั้งเตือน
DCA" ที่ตั้งผ่าน LINE ทุกประการ (Single Source of Truth, web=LINE): แผนที่ตั้งบนเว็บ
โผล่ใน LINE และกลับกัน, Cron แจ้งเตือนเดิมทำงานกับแผนเว็บด้วยทันที

> **หลักการสำคัญ:** ตารางนี้เป็น **Config ของผู้ใช้** (จะ DCA อะไรเมื่อไหร่) **ไม่ใช่
> Immutable Ledger** เหมือน `transactions` — จึง **UPDATE/DELETE ปกติได้** (แก้/หยุด/
> ลบแผน) ไม่ต้องทำ Reversal Pattern. ทุก Endpoint ผ่าน `requireAuth` + `requireConsent`
> และ Scope ด้วย `user_id` จาก JWT เสมอ (`:id` ถูกกรองด้วย user_id ทุก Query กัน IDOR)

Error Response Shape เหมือน §15 (Flat `{ error, message, details? }`).

### 15.5.1 POST `/api/v1/dca-plans` — สร้างแผนใหม่

สร้างแผน 1 แผนต่อ symbol (ถ้ามีแผน symbol เดิมอยู่ → แทนที่ของเดิม เหมือน LINE
"ตั้งใหม่ทับของเดิม").

| Field | Type | บังคับ | คำอธิบาย |
|---|---|---|---|
| `symbol` | string | ✅ | ต้องอยู่ใน Registry (case-insensitive) |
| `amountTotal` | number | ✅ | จำนวนเงินต่อรอบ > 0 (หน่วยตาม `currency`) |
| `currency` | `"THB"`\|`"USD"` | — | Default `"THB"` — `"USD"` เฉพาะ `crypto`/`stock_us` |
| `frequency` | `"weekly"`\|`"monthly"` | ✅ | ความถี่ |
| `frequencyValue` | int | ✅ | weekly = 0–6 (0=อาทิตย์) / monthly = 1–31 |

**Request:** `{ "symbol":"BTC", "amountTotal":1000, "frequency":"weekly", "frequencyValue":4 }`

**Response `201`:**
```json
{ "plan": { "id":"uuid", "symbol":"BTC", "name":"Bitcoin บิตคอยน์",
  "amountTotal":1000, "currency":"THB", "frequency":"weekly",
  "dayOfWeek":4, "dayOfMonth":null, "dayLabel":"ทุกวันพฤหัสบดี", "active":true } }
```

### 15.5.2 GET `/api/v1/dca-plans` — รายการแผนทั้งหมด (active + paused)

คืนแผน **ล่าสุดต่อ symbol** (active = กำลังทำงาน / `active:false` = หยุดชั่วคราว).
Response `200`: `{ "plans": [ <plan>, ... ] }`

> **หมายเหตุ (Edge):** reminder ที่เคยลบผ่าน LINE (Soft-delete `active=false`) จะโผล่
> เป็นแผน "paused" บนเว็บ (ไม่ได้หายไป) — ผู้ใช้ Resume หรือลบทิ้งจากเว็บได้

### 15.5.3 PATCH `/api/v1/dca-plans/:id` — แก้ไข / หยุด-เปิด

Request (ทุก Field optional, ส่งเฉพาะที่แก้):
`{ amountTotal?, currency?, frequency?, frequencyValue?, active? }`
- `active:false` = หยุดชั่วคราว / `active:true` = เปิดใหม่ (ระบบปิดแผน active อื่นของ
  symbol เดียวกันให้อัตโนมัติ)
- เปลี่ยน `frequency` ต้องส่ง `frequencyValue` ที่เข้ากันด้วย

Response `200`: `{ "plan": <plan> }`

### 15.5.4 DELETE `/api/v1/dca-plans/:id` — ลบแผน (Hard delete)

ลบจริง (เป็น Config ไม่ใช่ Ledger). Response `200`: `{ "deleted": { "id":"uuid" } }`

### Error Codes (§15.5)

| Code | HTTP | เมื่อไหร่ |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `amountTotal` ไม่ใช่เลขบวก / `currency` ไม่รู้จัก / `active` ไม่ใช่ boolean / PATCH ไม่มี Field ให้แก้ |
| `SYMBOL_NOT_SUPPORTED` | 400 | Symbol ไม่อยู่ใน Registry |
| `INVALID_FREQUENCY` | 400 | `frequency` ไม่ใช่ weekly/monthly |
| `INVALID_FREQUENCY_VALUE` | 400 | `frequencyValue` นอกช่วง (weekly 0–6 / monthly 1–31) |
| `CURRENCY_NOT_SUPPORTED_FOR_ASSET` | 400 | `USD` กับสินทรัพย์ที่ไม่ใช่ `crypto`/`stock_us` |
| `PLAN_NOT_FOUND` | 404 | ไม่พบแผน (ไม่ใช่ของ user / ถูกลบไปแล้ว) |

---

**Version:** 1.0.0 | **Last Updated:** 18 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
