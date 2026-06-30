# DATABASE.md — Database Schema

> Database: Supabase (PostgreSQL)
> กฎสำคัญ: ทุก Table ต้องเปิด Row Level Security (RLS)
> ห้ามลบข้อมูลผู้ใช้เด็ดขาด — ใช้ soft delete หรือ lock แทน

---

## 1. ER Diagram (อธิบายเป็นข้อความ)

```
users (1) ──────────────────── (many) portfolios
users (1) ──────────────────── (many) assets
users (1) ──────────────────── (many) transactions
users (1) ──────────────────── (many) payments
users (1) ──────────────────── (many) goals
users (1) ──────────────────── (many) notifications
users (1) ──────────────────── (1)    user_settings
users (1) ──────────────────── (many) watchlists
users (1) ──────────────────── (many) portfolio_snapshots

portfolios (1) ─────────────── (many) assets
portfolios (1) ─────────────── (many) portfolio_snapshots

assets (1) ─────────────────── (many) transactions

admins (1) ─────────────────── (many) audit_logs
admins (1) ─────────────────── (many) payments  [FK: approved_by]
```

### ความสัมพันธ์หลัก

| ตาราง | เชื่อมกับ | ผ่าน Field | ประเภท |
|---|---|---|---|
| portfolios | users | user_id | Many-to-One |
| assets | users | user_id | Many-to-One |
| assets | portfolios | portfolio_id | Many-to-One |
| transactions | users | user_id | Many-to-One |
| transactions | assets | asset_id | Many-to-One |
| payments | users | user_id | Many-to-One |
| payments | admins | approved_by | Many-to-One (nullable) |
| goals | users | user_id | Many-to-One |
| notifications | users | user_id | Many-to-One |
| user_settings | users | user_id | One-to-One |
| watchlists | users | user_id | Many-to-One |
| portfolio_snapshots | users | user_id | Many-to-One |
| portfolio_snapshots | portfolios | portfolio_id | Many-to-One (nullable) |
| audit_logs | admins | admin_id | Many-to-One |

---

## 2. Table Definitions

---

### `users`

เก็บข้อมูลผู้ใช้ที่ล็อกอินผ่าน LINE

```sql
CREATE TABLE users (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id      TEXT          NOT NULL UNIQUE,
  display_name      TEXT          NOT NULL,
  picture_url       TEXT,
  plan              TEXT          NOT NULL DEFAULT 'free'
                                  CHECK (plan IN ('free', 'premium', 'premium_plus')),
  plan_expires_at   TIMESTAMPTZ,
  is_locked         BOOLEAN       NOT NULL DEFAULT false,
  locked_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key — ใช้ UUID แทน auto-increment |
| line_user_id | TEXT | LINE User ID (ขึ้นต้นด้วย `U`) — Unique |
| display_name | TEXT | ชื่อที่แสดงใน LINE |
| picture_url | TEXT | URL รูปโปรไฟล์ LINE (nullable) |
| plan | TEXT | แพ็กเกจปัจจุบัน: `free` / `premium` / `premium_plus` |
| plan_expires_at | TIMESTAMPTZ | วันหมดอายุของ Premium (null = ไม่หมดอายุ หรือ Free) |
| is_locked | BOOLEAN | true = อยู่หลัง Grace Period — ล็อคข้อมูล ไม่ใช่ลบ |
| locked_at | TIMESTAMPTZ | วันที่ถูกล็อค (nullable) |
| created_at | TIMESTAMPTZ | วันที่สมัคร |
| updated_at | TIMESTAMPTZ | วันที่อัพเดทล่าสุด |

**Index:**
```sql
CREATE INDEX idx_users_line_user_id ON users(line_user_id);
CREATE INDEX idx_users_plan ON users(plan);
CREATE INDEX idx_users_plan_expires_at ON users(plan_expires_at)
  WHERE plan != 'free';
```

---

### `portfolios`

เก็บพอร์ตลงทุนแยกประเภทของแต่ละผู้ใช้ (Multiple Portfolio — Premium เท่านั้น)

```sql
CREATE TABLE portfolios (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id),
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL
              CHECK (type IN ('crypto', 'stock_th', 'stock_us', 'etf', 'fund', 'custom')),
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| name | TEXT | ชื่อพอร์ต เช่น "พอร์ต Crypto", "หุ้นไทย" |
| type | TEXT | ประเภทพอร์ต: `crypto` / `stock_th` / `stock_us` / `etf` / `fund` / `custom` |
| is_default | BOOLEAN | true = พอร์ตเริ่มต้น (ใช้กับ Free ที่มีพอร์ตเดียว) |
| created_at | TIMESTAMPTZ | วันที่สร้างพอร์ต |
| updated_at | TIMESTAMPTZ | วันที่อัพเดทล่าสุด |

**Index:**
```sql
CREATE INDEX idx_portfolios_user_id ON portfolios(user_id);
```

---

### `assets`

เก็บสินทรัพย์ที่ผู้ใช้ถือครองอยู่

```sql
CREATE TABLE assets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id),
  portfolio_id UUID        REFERENCES portfolios(id),
  symbol       TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  type         TEXT        NOT NULL
               CHECK (type IN ('crypto', 'stock_th', 'stock_us', 'etf', 'fund')),
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, portfolio_id)
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| portfolio_id | UUID | FK → portfolios.id (nullable สำหรับ Free ที่ไม่มี Multiple Portfolio) |
| symbol | TEXT | ตัวย่อสินทรัพย์ เช่น `BTC`, `PTT`, `AAPL` |
| name | TEXT | ชื่อเต็ม เช่น "Bitcoin", "PTT Public Company" |
| type | TEXT | ประเภทสินทรัพย์: `crypto` / `stock_th` / `stock_us` / `etf` / `fund` |
| is_active | BOOLEAN | false = ขายออกหมดแล้ว แต่ยังเก็บประวัติ |
| created_at | TIMESTAMPTZ | วันที่เพิ่มสินทรัพย์ |
| updated_at | TIMESTAMPTZ | วันที่อัพเดทล่าสุด |

**Index:**
```sql
CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_portfolio_id ON assets(portfolio_id);
CREATE INDEX idx_assets_user_symbol ON assets(user_id, symbol);
```

---

### `transactions`

เก็บประวัติการซื้อ/ขายสินทรัพย์ทุกรายการ

```sql
CREATE TABLE transactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id),
  asset_id        UUID        NOT NULL REFERENCES assets(id),
  type            TEXT        NOT NULL CHECK (type IN ('buy', 'sell')),
  amount_thb      NUMERIC(15,2) NOT NULL CHECK (amount_thb > 0),
  price_per_unit  NUMERIC(20,8) NOT NULL CHECK (price_per_unit > 0),
  quantity        NUMERIC(20,8) NOT NULL CHECK (quantity > 0),
  fee_thb         NUMERIC(10,2) NOT NULL DEFAULT 0,
  date            DATE        NOT NULL,
  note            TEXT,
  source          TEXT        NOT NULL DEFAULT 'line'
                  CHECK (source IN ('line', 'web', 'slip_ai')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| asset_id | UUID | FK → assets.id |
| type | TEXT | ประเภท: `buy` / `sell` |
| amount_thb | NUMERIC(15,2) | จำนวนเงินเป็นบาท |
| price_per_unit | NUMERIC(20,8) | ราคาต่อหน่วย (รองรับ Crypto ทศนิยมสูง) |
| quantity | NUMERIC(20,8) | จำนวนหน่วยที่ซื้อ/ขาย |
| fee_thb | NUMERIC(10,2) | ค่าธรรมเนียม (บาท) |
| date | DATE | วันที่ทำธุรกรรม (ไม่ใช่วันที่บันทึก) |
| note | TEXT | หมายเหตุ (nullable) |
| source | TEXT | ช่องทางบันทึก: `line` / `web` / `slip_ai` |
| created_at | TIMESTAMPTZ | วันที่บันทึกเข้าระบบ |

**Index:**
```sql
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_asset_id ON transactions(asset_id);
CREATE INDEX idx_transactions_date ON transactions(date DESC);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC);
```

---

### `payments`

เก็บประวัติการชำระเงินและสถานะการตรวจสอบสลิป

```sql
CREATE TABLE payments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id),
  amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  plan         TEXT        NOT NULL CHECK (plan IN ('premium', 'premium_plus')),
  duration     TEXT        NOT NULL CHECK (duration IN ('monthly', 'yearly')),
  slip_url     TEXT        NOT NULL,
  slip_hash    TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'expired')),
  reject_reason TEXT,
  approved_by  UUID        REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  approved_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| amount | NUMERIC(10,2) | จำนวนเงินที่ชำระ (บาท) |
| plan | TEXT | แพ็กเกจที่ต้องการ: `premium` / `premium_plus` |
| duration | TEXT | ระยะเวลา: `monthly` / `yearly` |
| slip_url | TEXT | URL รูปสลิปที่เก็บใน Supabase Storage |
| slip_hash | TEXT | Hash ของสลิป สำหรับตรวจสลิปซ้ำ (AI Fraud Detection) |
| status | TEXT | สถานะ: `pending` → `reviewing` → `approved` / `rejected` / `expired` |
| reject_reason | TEXT | เหตุผลที่ Reject (nullable) |
| approved_by | UUID | FK → users.id ของ Admin ที่ Approve (nullable) |
| created_at | TIMESTAMPTZ | วันที่ส่งสลิป |
| reviewed_at | TIMESTAMPTZ | วันที่ Admin เริ่มตรวจ (nullable) |
| approved_at | TIMESTAMPTZ | วันที่ Approve (nullable) |
| expires_at | TIMESTAMPTZ | วันที่สลิปหมดอายุ (nullable) |

**Index:**
```sql
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_slip_hash ON payments(slip_hash) WHERE slip_hash IS NOT NULL;
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);
```

---

### `goals`

เก็บเป้าหมายการลงทุน (Premium: 1 เป้าหมาย, Premium+: ไม่จำกัด)

```sql
CREATE TABLE goals (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id),
  goal_name      TEXT        NOT NULL,
  target_amount  NUMERIC(15,2) NOT NULL CHECK (target_amount > 0),
  target_date    DATE        NOT NULL,
  current_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_achieved    BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| goal_name | TEXT | ชื่อเป้าหมาย เช่น "ดาวน์รถ", "เที่ยวญี่ปุ่น" |
| target_amount | NUMERIC(15,2) | จำนวนเงินที่ตั้งเป้าหมาย (บาท) |
| target_date | DATE | วันที่ต้องการบรรลุเป้าหมาย |
| current_amount | NUMERIC(15,2) | จำนวนเงินสะสมปัจจุบัน |
| is_achieved | BOOLEAN | true = บรรลุเป้าหมายแล้ว |
| created_at | TIMESTAMPTZ | วันที่สร้างเป้าหมาย |
| updated_at | TIMESTAMPTZ | วันที่อัพเดทล่าสุด |

**Index:**
```sql
CREATE INDEX idx_goals_user_id ON goals(user_id);
```

---

### `notifications`

เก็บประวัติการแจ้งเตือนทุกประเภทที่ส่งผ่าน LINE

```sql
CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id),
  type       TEXT        NOT NULL
             CHECK (type IN (
               'dca_reminder', 'weekly_summary', 'monthly_summary',
               'premium_expiry', 'premium_locked', 'payment_approved',
               'payment_rejected', 'concentration_alert'
             )),
  message    TEXT        NOT NULL,
  is_read    BOOLEAN     NOT NULL DEFAULT false,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| type | TEXT | ประเภทการแจ้งเตือน |
| message | TEXT | เนื้อหาข้อความที่ส่ง |
| is_read | BOOLEAN | true = ผู้ใช้เปิดอ่านแล้ว |
| sent_at | TIMESTAMPTZ | วันเวลาที่ส่ง |

**Index:**
```sql
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_sent_at ON notifications(sent_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);
```

---

### `audit_logs`

บันทึก Action ทุกอย่างของ Admin — ต้องไม่มีการลบหรือแก้ไข

```sql
CREATE TABLE audit_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        NOT NULL REFERENCES users(id),
  action     TEXT        NOT NULL
             CHECK (action IN (
               'approve_payment', 'reject_payment',
               'edit_user', 'change_user_role',
               'delete_user_data', 'broadcast_message',
               'change_admin_role', 'login', 'logout'
             )),
  target_id  UUID,
  target_type TEXT,
  detail     JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| admin_id | UUID | FK → users.id ของ Admin ที่ทำ Action |
| action | TEXT | ประเภท Action |
| target_id | UUID | ID ของ Record ที่ถูกกระทำ (nullable) |
| target_type | TEXT | ประเภท Record เช่น `user`, `payment` (nullable) |
| detail | JSONB | รายละเอียดเพิ่มเติม เช่น ค่าก่อน/หลังแก้ไข |
| ip_address | TEXT | IP ของ Admin (nullable) |
| created_at | TIMESTAMPTZ | วันเวลาที่ทำ Action |

**Index:**
```sql
CREATE INDEX idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_target_id ON audit_logs(target_id) WHERE target_id IS NOT NULL;
```

---

### `portfolio_snapshots`

บันทึกมูลค่าพอร์ตรายวัน สำหรับ Timeline, Chart และ Portfolio Replay

```sql
CREATE TABLE portfolio_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id),
  portfolio_id    UUID        REFERENCES portfolios(id),
  total_value     NUMERIC(15,2) NOT NULL,
  total_invested  NUMERIC(15,2) NOT NULL,
  profit_loss     NUMERIC(15,2) NOT NULL,
  roi             NUMERIC(8,4)  NOT NULL,
  snapshot_date   DATE        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, portfolio_id, snapshot_date)
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| portfolio_id | UUID | FK → portfolios.id (nullable = snapshot รวมทุกพอร์ต) |
| total_value | NUMERIC(15,2) | มูลค่าพอร์ตทั้งหมด ณ วันนั้น (บาท) |
| total_invested | NUMERIC(15,2) | เงินลงทุนสะสม ณ วันนั้น (บาท) |
| profit_loss | NUMERIC(15,2) | กำไร/ขาดทุน (บาท) |
| roi | NUMERIC(8,4) | ROI เป็น % เช่น 12.5000 = 12.5% |
| snapshot_date | DATE | วันที่บันทึก |
| created_at | TIMESTAMPTZ | วันที่สร้าง Record |

**Index:**
```sql
CREATE INDEX idx_snapshots_user_id ON portfolio_snapshots(user_id);
CREATE INDEX idx_snapshots_user_date ON portfolio_snapshots(user_id, snapshot_date DESC);
CREATE INDEX idx_snapshots_portfolio_date ON portfolio_snapshots(portfolio_id, snapshot_date DESC)
  WHERE portfolio_id IS NOT NULL;
```

---

### `user_settings`

เก็บการตั้งค่าของผู้ใช้แต่ละคน — One-to-One กับ users

```sql
CREATE TABLE user_settings (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES users(id),
  currency              TEXT        NOT NULL DEFAULT 'THB',
  timezone              TEXT        NOT NULL DEFAULT 'Asia/Bangkok',
  language              TEXT        NOT NULL DEFAULT 'th',
  dca_reminder_day      SMALLINT    CHECK (dca_reminder_day BETWEEN 1 AND 31),
  notification_enabled  BOOLEAN     NOT NULL DEFAULT true,
  weekly_summary        BOOLEAN     NOT NULL DEFAULT true,
  monthly_summary       BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id — Unique (One-to-One) |
| currency | TEXT | สกุลเงิน เช่น `THB`, `USD` |
| timezone | TEXT | เขตเวลา เช่น `Asia/Bangkok` |
| language | TEXT | ภาษา เช่น `th`, `en` |
| dca_reminder_day | SMALLINT | วันที่ของเดือนที่ต้องการรับแจ้งเตือน DCA (1–31) |
| notification_enabled | BOOLEAN | เปิด/ปิดการแจ้งเตือนทั้งหมด |
| weekly_summary | BOOLEAN | รับสรุปรายสัปดาห์หรือไม่ (Premium) |
| monthly_summary | BOOLEAN | รับสรุปรายเดือนหรือไม่ (Premium) |
| created_at | TIMESTAMPTZ | วันที่สร้าง |
| updated_at | TIMESTAMPTZ | วันที่อัพเดทล่าสุด |

**Index:**
```sql
CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
```

---

### `watchlists`

เก็บสินทรัพย์ที่ผู้ใช้ติดตามแต่ยังไม่ได้ลงทุน (Premium)

```sql
CREATE TABLE watchlists (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id),
  symbol     TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  type       TEXT        NOT NULL
             CHECK (type IN ('crypto', 'stock_th', 'stock_us', 'etf', 'fund')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| user_id | UUID | FK → users.id |
| symbol | TEXT | ตัวย่อสินทรัพย์ |
| name | TEXT | ชื่อเต็ม |
| type | TEXT | ประเภทสินทรัพย์ |
| note | TEXT | หมายเหตุส่วนตัว (nullable) |
| created_at | TIMESTAMPTZ | วันที่เพิ่มเข้า Watchlist |

**Index:**
```sql
CREATE INDEX idx_watchlists_user_id ON watchlists(user_id);
```

---

### `system_logs`

เก็บ Error และ Event สำคัญของระบบ สำหรับ Developer และ Admin

```sql
CREATE TABLE system_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT        NOT NULL
              CHECK (type IN ('error', 'warning', 'info')),
  source      TEXT        NOT NULL
              CHECK (source IN ('webhook', 'parser', 'database', 'payment', 'notification', 'auth', 'cron')),
  message     TEXT        NOT NULL,
  stack_trace TEXT,
  user_id     UUID        REFERENCES users(id),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Field | Type | คำอธิบาย |
|---|---|---|
| id | UUID | Primary Key |
| type | TEXT | ระดับความรุนแรง: `error` / `warning` / `info` |
| source | TEXT | ระบบต้นทาง: `webhook` / `parser` / `database` / `payment` / `notification` / `auth` / `cron` |
| message | TEXT | ข้อความ Error หรือ Event |
| stack_trace | TEXT | Stack trace เต็ม (nullable) |
| user_id | UUID | FK → users.id ที่เกี่ยวข้อง (nullable) |
| metadata | JSONB | ข้อมูลเพิ่มเติม เช่น request body, response code |
| created_at | TIMESTAMPTZ | วันเวลาที่เกิด |

**Index:**
```sql
CREATE INDEX idx_system_logs_type ON system_logs(type);
CREATE INDEX idx_system_logs_source ON system_logs(source);
CREATE INDEX idx_system_logs_created_at ON system_logs(created_at DESC);
CREATE INDEX idx_system_logs_user_id ON system_logs(user_id) WHERE user_id IS NOT NULL;
```

---

## 3. Row Level Security (RLS)

ทุก Table ต้องเปิด RLS — ผู้ใช้เข้าถึงได้เฉพาะข้อมูลของตัวเองเท่านั้น

### หลักการ

| Role | สิทธิ์ |
|---|---|
| `authenticated` (user) | เข้าถึงได้เฉพาะ row ที่ `user_id = auth.uid()` |
| `service_role` (backend) | Bypass RLS ทั้งหมด — ใช้เฉพาะ Server-side |
| `anon` | ไม่มีสิทธิ์เข้าถึง Table ใดเลย |

### RLS Policy แต่ละตาราง

**users**
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.uid());
-- ห้าม INSERT / DELETE ผ่าน client โดยตรง
```

**portfolios**
```sql
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portfolios_own" ON portfolios
  FOR ALL USING (user_id = auth.uid());
```

**assets**
```sql
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assets_own" ON assets
  FOR ALL USING (user_id = auth.uid());
```

**transactions**
```sql
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_own" ON transactions
  FOR ALL USING (user_id = auth.uid());
```

**payments**
```sql
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select_own" ON payments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "payments_insert_own" ON payments
  FOR INSERT WITH CHECK (user_id = auth.uid());
-- UPDATE / DELETE ทำได้เฉพาะ service_role (Admin)
```

**goals**
```sql
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goals_own" ON goals
  FOR ALL USING (user_id = auth.uid());
```

**notifications**
```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (user_id = auth.uid());
-- INSERT ทำได้เฉพาะ service_role (ระบบส่งเอง)
```

**user_settings**
```sql
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings_own" ON user_settings
  FOR ALL USING (user_id = auth.uid());
```

**watchlists**
```sql
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlists_own" ON watchlists
  FOR ALL USING (user_id = auth.uid());
```

**portfolio_snapshots**
```sql
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_select_own" ON portfolio_snapshots
  FOR SELECT USING (user_id = auth.uid());
-- INSERT ทำได้เฉพาะ service_role (Cron Job)
```

**audit_logs, system_logs**
```sql
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;
-- ไม่มี Policy สำหรับ authenticated user
-- เข้าถึงได้เฉพาะ service_role เท่านั้น
```

---

## 4. ข้อกำหนดสำคัญ

### ห้ามลบข้อมูล

```sql
-- ไม่มี DELETE policy บน Table หลักใดเลย
-- ใช้ soft approach แทน:
--   users: is_locked = true
--   assets: is_active = false
--   transactions: ไม่ลบ — แต่รองรับ "ยกเลิกรายการ" ด้วยการสร้าง transaction ตรงข้าม
```

### Timestamp ทุก Table

ทุก Table ต้องมี `created_at` และ Table ที่มีการ Update ต้องมี `updated_at`
ใช้ Trigger อัพเดท `updated_at` อัตโนมัติ:

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply ให้ทุก Table ที่มี updated_at
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- (ทำซ้ำกับ portfolios, assets, goals, user_settings)
```

### UUID แทน Auto-increment

ใช้ `gen_random_uuid()` สำหรับทุก Primary Key
เพื่อความปลอดภัยและรองรับ Distributed system ในอนาคต

---

**Version:** 1.0.0 | **Last Updated:** 1 กรกฎาคม 2569

*อ้างอิงจาก [PROJECT_BRIEF.md](../PROJECT_BRIEF.md)*
