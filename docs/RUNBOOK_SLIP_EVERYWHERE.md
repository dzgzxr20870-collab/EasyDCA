# Runbook — feature/slip-everywhere (Production Verification)

> **สถานะ:** ยังไม่ Deploy · Migration 040 **ยังไม่ได้ Apply** · รอ Founder อนุมัติ
>
> เอกสารนี้คือขั้นตอนที่ **Founder ทำเอง** หลังอนุมัติ ตาม
> [AI_WORK_POLICY.md § 3 ข้อ 4](./AI_WORK_POLICY.md) (Production Verification —
> ต้อง Verify บน Container ที่ Deploy จริง ไม่ใช่แค่ "Build ผ่าน")
>
> ⚠️ ทำ **ตามลำดับ** เท่านั้น — ข้ามขั้นแล้วพังยากกว่าเดิม

---

## สิ่งที่งานนี้เปลี่ยน (สรุปก่อนเริ่ม)

| ส่วน | ของใหม่ | ของเดิมที่ต้องไม่พัง |
|---|---|---|
| DB | ตาราง `transaction_slip_sessions` (migration 040) | ทุกตารางเดิม ไม่ถูกแตะ |
| Web | `POST /transactions/slip-ocr` · `slipToken` ใน `POST /transactions` | ดูสลิปย้อนหลัง · แนบสลิปตอนบันทึกใหม่ |
| LINE | ถามหาสลิปหลังพิมพ์เอง · ทดลองฟรี 3 ครั้ง | AI OCR เดิม · สลิปโอนเงิน Premium |
| Worker | Cron `purgeStaleTransactionSlipSessions` (ตี 3) | 15 Job เดิม (รวมเป็น 16) |

---

## ขั้นที่ 1 — Apply Migration 040 (ทำก่อน Deploy โค้ดเสมอ)

เปิด **Supabase → SQL Editor** แล้วรันไฟล์
`backend/migrations/040_create_transaction_slip_sessions.sql` ทั้งไฟล์

> ⚠️ **ต้อง Apply ก่อน Deploy โค้ด** — ถ้า Deploy โค้ดก่อน การกดยืนยันรายการใน LINE
> จะพยายามเขียน Session ลงตารางที่ยังไม่มี (ถูก Swallow เป็น Best-effort ธุรกรรม
> ไม่พัง แต่จะมี Error Log รัวทุกครั้งที่บันทึก และไม่มีใครถูกถามหาสลิปเลย)

### VERIFY (รันทีละ Query — ทั้ง 4 ต้องผ่านก่อนไปขั้นถัดไป)

```sql
-- 1) ตารางมีจริง + คอลัมน์ครบ 4
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'transaction_slip_sessions'
 ORDER BY ordinal_position;
-- คาดหวัง: user_id(uuid,NO) / transaction_id(uuid,NO) / created_at / updated_at

-- 2) RLS เปิดจริง และไม่มี Policy ให้ anon/authenticated
SELECT relrowsecurity FROM pg_class WHERE relname = 'transaction_slip_sessions';
-- คาดหวัง: true
SELECT count(*) FROM pg_policies WHERE tablename = 'transaction_slip_sessions';
-- คาดหวัง: 0

-- 3) FK + ON DELETE ถูกต้อง
SELECT conname, confdeltype FROM pg_constraint
 WHERE conrelid = 'transaction_slip_sessions'::regclass AND contype = 'f';
-- คาดหวัง: user_id = 'r' (RESTRICT) / transaction_id = 'c' (CASCADE)

-- 4) Trigger updated_at ติดจริง
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'transaction_slip_sessions'::regclass AND NOT tgisinternal;
-- คาดหวัง: trg_transaction_slip_sessions_updated_at
```

---

## ขั้นที่ 2 — Deploy โค้ด (ทั้ง 2 Service)

⚠️ งานนี้แตะ **ทั้ง Web และ Worker** — ต้อง Deploy **ทั้งคู่** ไม่ใช่แค่ตัวเดียว

| Service | ทำไมต้อง Deploy |
|---|---|
| `EasyDCA` (Web) | Endpoint ใหม่ + Gate ทดลองฟรี + LINE Webhook |
| `easydca-worker` | Cron `purgeStaleTransactionSlipSessions` ตัวใหม่ |

### VERIFY Worker (บน Container จริง — ไม่ใช่แค่เช็ค `/health` ของ Web)

ตาม § 4.4: Job ใหม่อยู่บน Worker ซึ่งเป็น **คนละ Container/Build** กับ Web

```bash
railway logs --service easydca-worker | grep "worker process started"
```

**คาดหวัง:** `{"jobCount":16,...}` — ถ้ายังเป็น **15** แปลว่า Worker **ยังไม่ได้ Deploy
โค้ดใหม่** (Cron ตัวใหม่จะไม่ทำงานเลยแบบเงียบๆ ไม่มี Error ให้เห็น)

---

## ขั้นที่ 3 — Smoke Test 3 เส้นทาง (ใช้บัญชี Premium จริง)

### 3.1 เว็บ — แนบสลิปเข้ารายการเดิม (งานที่ 2.1)

1. เปิด `/dashboard` → แท็บ **ประวัติรายการ**
2. หาแถวที่คอลัมน์ "สลิป" เป็น `📎 แนบสลิป` → กด → เลือกรูป
3. **คาดหวัง:** ปุ่มเปลี่ยนเป็น `🧾 ดูสลิป` · กดแล้วเห็นรูปที่เพิ่งแนบ

```sql
SELECT id, symbol, slip_image_path FROM transactions
 WHERE user_id = '<user_id>' AND slip_image_path IS NOT NULL
 ORDER BY created_at DESC LIMIT 3;
```

**Regression ที่ต้องเช็คคู่กัน:** รายการที่ **มีสลิปอยู่แล้วเดิม** ต้องยังกด "ดูสลิป"
ได้เหมือนเดิมเป๊ะ และ **ต้องไม่มี** ปุ่ม "แนบสลิป" โผล่ทับ

### 3.2 เว็บ — AI อ่านสลิป (งานที่ 2.2)

1. `/dashboard` → กล่อง **บันทึกรายการ** → ปุ่ม `📷 อัปโหลดสลิปให้ AI อ่าน` (บนสุด)
2. เลือกรูปสลิปจริง → รอ `🤖 กำลังอ่านสลิป…`
3. **คาดหวัง:** ฟอร์มถูกเติมค่าให้ (สินทรัพย์/จำนวนเงิน/วันที่) + แถบ 🤖 บอกโควตาคงเหลือ
4. **แก้ไขค่าสักช่อง** (พิสูจน์ว่าแก้ได้จริง) → กดบันทึก
5. **คาดหวัง:** บันทึกสำเร็จ + รายการใหม่ในประวัติมีสลิปแนบมาให้เลย (ไม่ต้องแนบซ้ำ)

```sql
-- โควตาต้องขยับทั้ง count และ call_count
SELECT user_id, year_month, count, call_count FROM ai_ocr_usage
 WHERE year_month = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM');
```

**เคสที่ต้องลองด้วย (สำคัญ):** ส่งรูปที่ **ไม่ใช่สลิป** (รูปวิว) →
คาดหวัง: ข้อความบอกว่าอ่านไม่ได้ + **`count` เท่าเดิม แต่ `call_count` +1**
(นี่คือหัวใจของเพดานคุมต้นทุนจาก migration 038)

### 3.3 LINE — ถามหาสลิปหลังพิมพ์เอง (งานที่ 3)

1. พิมพ์ใน LINE: `ซื้อ BTC 100` → กด **ยืนยัน**
2. **คาดหวัง:** ได้ **2 ข้อความ** — การ์ดยืนยันเดิม + การ์ด `📎 แนบสลิปไว้ด้วยไหม`

```sql
SELECT s.user_id, s.transaction_id, t.symbol, s.updated_at
  FROM transaction_slip_sessions s JOIN transactions t ON t.id = s.transaction_id;
-- คาดหวัง: 1 แถวชี้ไปรายการที่เพิ่งสร้าง
```

3. ส่งรูปสลิปเข้าไปในแชท
4. **คาดหวัง:** ตอบ `✅ แนบสลิปเรียบร้อย` · แถว Session **หายไป** · `slip_image_path` มีค่า
5. **ไม่มีการเรียก Claude** — ยืนยันจาก `ai_ocr_usage.call_count` **ไม่ขยับ**

**Regression ที่สำคัญที่สุดของข้อนี้:** รอให้เกิน 10 นาที (หรือลบแถว Session ทิ้ง)
แล้วส่งรูปสลิปใหม่ → **ต้องเข้า AI OCR ตามปกติ** (ได้การ์ด Preview พร้อมปุ่มยืนยัน)
ถ้ายังถูกแนบเข้ารายการเก่า = TTL ไม่ทำงาน ให้ Rollback ทันที

### 3.4 ทดลองฟรี 3 ครั้ง (งานที่ 4) — ใช้บัญชี Free

1. ส่งรูปสลิปด้วยบัญชี **Free** → **คาดหวัง:** อ่านได้ + การ์ดบอกสิทธิ์คงเหลือ
2. ทำซ้ำจนครบ 3 ครั้ง (เว้น 10 วินาทีระหว่างครั้ง — Rate Limit ยังบังคับกับ Free)
3. ครั้งที่ 4 → **คาดหวัง:** การ์ด `ใช้สิทธิ์ทดลองอ่านสลิปด้วย AI ครบแล้ว` + ปุ่มอัพเกรด
4. **ต้องยืนยันว่ากดบันทึกจากการ์ด Preview ได้จริงในครั้งที่ 1-3** (ไม่ใช่ให้ชิมแล้วปฏิเสธ)

```sql
-- โควตาทดลองนับจากถังเดียวกัน (รวมทุกเดือน)
SELECT user_id, SUM(count) AS lifetime_count, SUM(call_count) AS lifetime_calls
  FROM ai_ocr_usage WHERE user_id = '<free_user_id>' GROUP BY user_id;
-- คาดหวัง: lifetime_count = 3
```

**Cross-channel ที่ต้องพิสูจน์:** ให้บัญชี Free ใช้ทดลอง **1 ครั้งทางเว็บ** แล้ว
**1 ครั้งทาง LINE** → `lifetime_count` ต้องเป็น **2** (ไม่ใช่ 1+1 แยกถัง)

---

## ขั้นที่ 3.5 — ตัวเลขที่บันทึกต้องตรงสลิป (fix/slip-quantity-from-slip)

> เพิ่มหลังพบว่ารายการที่บันทึกจากสลิปบนเว็บ **ทิ้งจำนวนหุ้น/ราคาจากสลิป** แล้วไป
> คำนวณใหม่จากราคาตลาด ณ ตอนกดบันทึก (ยิ่งสลิปเก่ายิ่งเพี้ยน)

**ต้องใช้สลิปเก่า** (วันที่ห่างจากวันนี้อย่างน้อย 3-5 วัน) — สลิปวันนี้จะดูไม่ออก
เพราะราคาตลาดใกล้เคียงราคาในสลิปอยู่แล้ว

1. `/dashboard` → `📷 อัปโหลดสลิปให้ AI อ่าน` → เลือกสลิปเก่า
2. **คาดหวัง:** มีบล็อกเขียว `🧾 ตัวเลขจากสลิป — ระบบจะบันทึกตามนี้` โผล่ขึ้นมา
   พร้อมช่อง "จำนวนหน่วยที่ได้จริง" + "ราคาต่อหน่วยที่ได้จริง" ที่**แก้ไขได้**
3. เทียบตัวเลขในช่องกับสลิปด้วยตา → ต้องตรงกันเป๊ะ
4. กดบันทึก แล้ว Query เทียบ:

```sql
SELECT symbol, date, created_at::date AS บันทึกวันที่,
       quantity AS จำนวนหน่วย, price_per_unit AS ราคาต่อหน่วย,
       amount_thb AS ยอดรวม, currency
  FROM transactions
 WHERE user_id = '<user_id>'
 ORDER BY created_at DESC LIMIT 1;
```

**คาดหวัง:** `quantity` และ `price_per_unit` **ตรงกับตัวเลขบนสลิปเป๊ะ**
(ทศนิยมครบ เช่น `20.0104114`) ไม่ใช่ตัวเลขที่หารมาจากราคาตลาดวันนี้

**Regression ที่ต้องเช็คคู่กัน (ห้ามพัง):**

| เคส | คาดหวัง |
|---|---|
| กรอกฟอร์มเอง (ไม่สแกนสลิป) | ยังใช้ราคาตลาดคำนวณให้เหมือนเดิม ไม่ต้องกรอกราคา |
| สลิปที่มี**แต่ยอดเงิน** (ไม่มีจำนวนหุ้น) | ไม่มีบล็อกเขียว · ใช้ราคาตลาดคำนวณเหมือนเดิม |
| พิมพ์ `ซื้อ BTC 1000` ใน LINE | ยังใช้ราคาตลาดเหมือนเดิม |
| สแกนสลิปทาง **LINE** | ตัวเลขตรงสลิป (พฤติกรรมนี้ถูกต้องอยู่แล้วก่อนแก้) |

---

## ขั้นที่ 3.6 — ค่าธรรมเนียม (feature/transaction-fee · migration 041)

> ⚠️ **ต้อง Apply migration 041 ก่อน Deploy โค้ดเสมอ** — ถ้า Deploy โค้ดก่อน
> การส่ง `fee_thb = NULL` จะโดน NOT NULL constraint ปฏิเสธ = **บันทึกรายการไม่ได้เลย**
> (ต่างจาก migration 040 ที่ Fail แบบ Best-effort — อันนี้บล็อกการบันทึกจริง)

### VERIFY หลัง Apply (ก่อน Deploy โค้ด)

```sql
SELECT table_name, column_name, is_nullable
  FROM information_schema.columns
 WHERE column_name = 'fee_thb'
   AND table_name IN ('transactions', 'pending_transactions');
-- คาดหวัง: is_nullable = YES ทั้ง 2 แถว
```

### Smoke Test หลัง Deploy

**A. สลิปที่มีค่าธรรมเนียม (ใช้ EOSE หรือ ASTS ใบเดิม)**

1. เว็บ → สแกนสลิป → **คาดหวัง:** กล่องเขียวแสดงแยกบรรทัด

   ```
   มูลค่าหุ้น (บันทึกเป็นต้นทุน)   1,497.60 USD
   ค่าธรรมเนียม                        2.40 USD
   ─────────────────────────────────────────
   รวมจ่ายจริง                     1,500.00 USD
   ```
2. ต้องมีข้อความกำกับว่า *"ต่างจากยอดที่จ่ายเพราะค่าธรรมเนียม ไม่ใช่ระบบอ่านผิด"*
3. กดบันทึก แล้ว Query:

```sql
SELECT a.symbol, t.amount_thb AS มูลค่าหุ้น, t.fee_thb AS ค่าธรรมเนียม,
       t.quantity, t.price_per_unit, t.currency, t.date
  FROM transactions t JOIN assets a ON a.id = t.asset_id
 WHERE t.user_id = '<user_id>' ORDER BY t.created_at DESC LIMIT 1;
```

**คาดหวัง (ASTS):** `มูลค่าหุ้น = 1497.60` · `ค่าธรรมเนียม = 2.40` · `quantity = 20.0104114`

**B. LINE — สลิปเดียวกัน** ต้องเห็นการ์ด Preview แยกบรรทัดแบบเดียวกัน แล้วบันทึกได้ค่าตรงกัน

**C. Regression — "ไม่รู้" ต้องเป็น NULL ไม่ใช่ 0**

พิมพ์ `ซื้อ BTC 100` ใน LINE (ไม่มีสลิป) → กดยืนยัน แล้ว Query:

```sql
SELECT a.symbol, t.fee_thb, t.source
  FROM transactions t JOIN assets a ON a.id = t.asset_id
 WHERE t.user_id = '<user_id>' ORDER BY t.created_at DESC LIMIT 1;
```

**คาดหวัง:** `fee_thb` เป็น **NULL** (ไม่ใช่ 0) — นี่คือความหมาย "ระบบไม่รู้ค่าธรรมเนียม"

**D. 🔴 P&L ต้องไม่ขยับแม้แต่บาทเดียว**

จดตัวเลขนี้ไว้ **ก่อน** Deploy แล้วเทียบหลัง Deploy:

```sql
SELECT round(sum(CASE WHEN type='buy' THEN amount_thb ELSE -amount_thb END), 2) AS เงินลงทุนสุทธิ,
       count(*) AS จำนวนรายการ
  FROM transactions WHERE note IS NULL OR note NOT LIKE 'UNDO_OF:%';
```

**คาดหวัง:** ตัวเลขเท่าเดิมเป๊ะ (รายการใหม่ที่บันทึกระหว่างทดสอบจะทำให้ขยับตามปกติ
เท่านั้น) · หน้า Dashboard ต้องแสดงกำไร/ขาดทุนเท่าเดิมทุกตัว

**E. ช่องราคาต่อหน่วยใช้ได้ทุกสินทรัพย์แล้ว**

| เคส | คาดหวัง |
|---|---|
| เลือก BTC/หุ้น US แล้วเว้นช่องราคาว่าง | ข้อความ *"เว้นว่างไว้ = ระบบดึงราคาตลาด…"* · บันทึกได้ปกติด้วยราคาตลาด |
| กรอกราคาเอง | ข้อความเปลี่ยนเป็น *"จะบันทึกด้วยราคาที่คุณกรอก — ไม่ดึงราคาตลาด"* |
| หุ้นไทย | ยังบังคับกรอกเหมือนเดิม |
| โหมดสลิป | ช่องราคาปกติ**หายไป** (ใช้กล่องเขียวแทน) และ**ไม่มี**ข้อความเรื่องราคาตลาดโผล่ขัดกัน |

⚠️ ช่องราคาต้อง **ว่างเสมอตอนเปิดฟอร์ม** — ห้ามมีการเติมราคาให้อัตโนมัติ
(จะกลายเป็นยิง Price Feed ทุกครั้งที่เปิดฟอร์ม ซึ่ง Twelve Data ชนเพดาน 8 ครั้ง/นาที)

---

## ขั้นที่ 4 — เช็คหลัง Deploy 24 ชม.

```bash
# Cron ตี 3 ต้องรันจริงบน Worker
railway logs --service easydca-worker | grep "cron:purge-slip-session"
# คาดหวัง: purged N stale transaction slip session(s)
```

```sql
-- ต้องไม่มี Session ค้างเก่ากว่า 10 นาทีสะสม
SELECT count(*) FROM transaction_slip_sessions
 WHERE updated_at < now() - interval '10 minutes';
-- คาดหวัง: 0 (หรือน้อยมากถ้ายังไม่ถึงรอบ Cron)
```

**ผลกระทบต่อ `/admin/stats`:** **ไม่มี** — งานนี้ไม่แตะ `payments` และไม่เปลี่ยนสิทธิ์
Premium ของใคร (ทดลองฟรีเป็นการ "ให้ใช้ AI" ไม่ใช่การให้สถานะ Premium)
ตัวเลขรายได้/จำนวน Premium User ต้องเท่าเดิมทุกประการ

**สิ่งที่ต้องจับตาเป็นพิเศษ (เงินจริง):**

```sql
-- ต้นทุน Claude Vision — call_count ที่โตผิดปกติแปลว่ามีคนยิงรัว
SELECT user_id, count, call_count FROM ai_ocr_usage
 WHERE year_month = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')
 ORDER BY call_count DESC LIMIT 10;
```

---

## ROLLBACK PLAN

⚠️ **ลำดับสำคัญ: โค้ดก่อน แล้วค่อย DB เสมอ**

1. **Revert โค้ด** — Railway → Deployments → Redeploy ตัวก่อนหน้า (ทั้ง Web + Worker)
2. **ค่อย DROP ตาราง** (ถ้าจำเป็นจริงๆ):
   ```sql
   DROP TABLE IF EXISTS transaction_slip_sessions;
   ```

**สิ่งที่จะเสียไปถ้า Rollback:** เฉพาะ "คำขอแนบสลิปที่ค้างอยู่ ณ ขณะนั้น" (อายุไม่เกิน
10 นาที) ผู้ใช้แค่ต้องแนบสลิปใหม่ผ่านหน้าเว็บแทน

**สิ่งที่ **ไม่** กระทบเลย:** Ledger (`transactions`) · สลิปที่แนบไปแล้ว
(`slip_image_path` คนละที่กัน) · สิทธิ์ Premium · โควตา `ai_ocr_usage`

> **Rollback เฉพาะบางส่วนได้ไหม?** ได้ — ถ้าปัญหาอยู่ที่ Flow LINE อย่างเดียว
> การ Revert โค้ดอย่างเดียวโดย **ไม่ต้อง DROP ตาราง** ก็พอ (ตารางที่ไม่มีใครเขียน
> ไม่สร้างความเสียหาย และเก็บไว้ให้ Deploy รอบหน้าใช้ต่อได้เลย)

---

## สิ่งที่ยังไม่ได้ทำ / รู้ข้อจำกัดไว้ก่อน

| ประเด็น | สถานะ |
|---|---|
| กัน Reset โควตาทดลองด้วยการสร้าง LINE Account ใหม่ | **กันไม่ได้** — ผูกกับ `users.id` ↔ `line_user_id` ระบบไม่มีการยืนยันเบอร์/บัตร |
| แนบสลิปในโหมด **ขาย** บนเว็บ | ยังไม่เปิด (Endpoint รองรับแล้ว แต่ UI ยังไม่มี — ของเดิมเป็นแบบนี้อยู่ก่อนแล้ว) |
| Production Verification ด้วยสลิปจริงหลายโบรก | **ต้องทำตอน Smoke Test** — § 3 ข้อ 4 ระบุว่างานที่พึ่งความแม่นของ AI ต้อง Verify ด้วยข้อมูลจริง ไม่ใช่ Mock |
| Rate Limit เป็น In-memory ต่อ Process | ข้อจำกัดเดิมของ `slipOcr.service` — ถ้า Scale หลาย Instance ต้องย้ายไป Redis |
