# Prompt สำหรับ Claude Code — ทำงานต่อ Task #18

> คัดลอกทั้งบล็อกด้านล่างไปวางใน Claude Code ได้เลย

---

```
Model: Opus (งานแตะ Schema/Ledger การเงินจริง ตาม docs/AI_WORK_POLICY.md § 1)

## อ่านก่อนเริ่ม (บังคับ ห้ามข้าม ห้ามเดา)

1. docs/HANDOFF_DASHBOARD_MULTIPORTFOLIO.md  ← อ่านไฟล์นี้ก่อนเป็นอย่างแรก มีบริบททั้งหมด
2. CLAUDE.md
3. docs/AI_CONTEXT.md
4. docs/AI_WORK_POLICY.md
5. docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md

คำตอบของคำถามเชิงธุรกิจทั้ง 8 ข้อ Founder ตัดสินไว้แล้วในเอกสารข้อ 1 หมวด § 3
ห้ามถามซ้ำ ห้ามเปลี่ยนเอง

## กฎเหล็ก (ละเมิดไม่ได้เด็ดขาด)

- ห้าม Push / Merge / Deploy จนกว่า Founder อนุมัติเป็นลายลักษณ์อักษร — commit local เท่านั้น
- ห้าม merge branch demo/multipage-ux-redesign เข้า main (จะลบงาน Production 6,872 บรรทัดทิ้ง)
- ห้ามลบ Dashboard เดิม / ไฟล์ demo เดิม
- Immutable Ledger: ห้าม DELETE/UPDATE transaction — ใช้รายการหักล้างเท่านั้น
- brokerId/portfolioId จาก Request Body ต้อง SELECT ยืนยันเจ้าของก่อนใช้เสมอ
  (FK ตรวจแค่ว่า "มีอยู่จริง" ไม่ได้ตรวจว่า "ของใคร")
- ทุก Query ใหม่ต้องลงทะเบียนใน TABLE_REGISTRY + ผ่าน queryForUser ใน utils/ownership.util.js
- Migration ต้องล็อก search_path ตาม Pattern 028
- Label ปุ่ม LINE Quick Reply ≤20 ตัวอักษร (Unicode Code Point)
- Internal Navigation ใช้ React Router ห้าม <a href> (JWT เก็บใน Memory จะหาย)

## สถานะ: branch feat/dashboard-production-wire

commit แล้ว: dc86b55(DesignDoc) a3bc2e5(S1) 2cee72f(S2) 2038a5d(S3) caa68cf(S4) 38aa28a(S6a) cd6bcf0(docs)
Test ปัจจุบัน: 118 suites / 2,381 tests เขียวหมด
Migration 042-046 เขียนแล้ว แต่ยังไม่ Apply บน Supabase เลยสักตัว

## ═══ งานที่ 1 (ทำก่อนอย่างอื่นทันที) — ปิด Stage 5 ที่ค้าง ═══

Agent ก่อนหน้าถูกตัดกลางคันเพราะชนลิมิต งาน Stage 5 ค้างในเครื่องยังไม่ commit
เสี่ยงหาย ต้องทำให้จบก่อน

ไฟล์ใหม่ที่สร้างไว้แล้ว:
  backend/migrations/046_assets_unique_with_broker.sql
  backend/src/services/assetResolution.service.js

ไฟล์ที่แก้ค้างไว้ (7 ไฟล์ + tests 14 ไฟล์, รวม 26 files +731/-246):
  backend/src/jobs/portfolioSnapshot.job.js
  backend/src/repositories/asset.repository.js
  backend/src/repositories/pendingTransaction.repository.js
  backend/src/services/pendingTransaction.service.js
  backend/src/services/portfolio.service.js
  backend/src/services/profit.service.js
  backend/src/services/transaction.service.js

สิ่งที่ต้องทำ:
1. git status ดูของค้างทั้งหมด
2. อ่าน diff ให้เข้าใจว่า Agent ก่อนหน้าทำอะไรค้างไว้ ตรงไหนยังไม่จบ
3. ทำให้จบ: รัน `cd backend && npm test` ให้เขียวทั้งหมด + `npm run lint` สะอาด
4. commit เป็น Stage 5

### เนื้อหา Stage 5 ที่ต้องมีให้ครบ

Migration 046 ใช้ constraint นี้ (วิเคราะห์ยืนยันแล้ว ใช้ได้เลย):
  UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id)

เหตุผล: บั๊กเดิมที่ Migration 014 กันอยู่คือ asset ซ้ำ 2 แถว ทำให้ประวัติธุรกรรมของ
symbol เดียวกันแตกไปคนละ asset_id แล้ว Moving Average Cost Basis เห็นแค่ครึ่งเดียว
→ P&L ผิดทันที
NULLS NOT DISTINCT ทำให้ broker_id ที่เป็น NULL (ข้อมูลเดิม 100%) ถือว่าเท่ากัน
สองแถว (U,BTC,P1,NULL) จึงยังชนกันเหมือนเดิม กันบั๊กเดิมได้ครบ
แต่เปิดให้ (U,BTC,P1,Bitkub) กับ (U,BTC,P1,Binance) อยู่ร่วมกันได้
→ ไม่ต้องใช้ COALESCE / Partial Index

ต้องแก้คู่กัน: asset.repository.findByUserAndSymbol() ใช้ .maybeSingle()
ซึ่งจะ error ทันทีเมื่อ symbol มี 2 แถว ถูกเรียกจาก 5 จุดบนเส้นทางเงิน:
  - transaction.service (validateBuy / validateSell)
  - webhook.controller (ฝั่ง LINE)
  - bulkImport.service
  - profit.service
ไล่แก้ให้ครบทุกจุด อย่าตกจุดใดจุดหนึ่ง

Flow ถามโบรกทาง LINE (Founder ตัดสินแล้ว):
  - ถ้าถือ symbol นั้นหลายโบรก → ตอบกลับเป็นปุ่มให้เลือกโบรกก่อนบันทึก ห้ามเดา
    (กฎยืนข้อ 11 CLAUDE.md: Silent Default เป็น Anti-pattern เสมอ)
  - ถ้าถือโบรกเดียว → ห้ามถาม บันทึกตรงเลย
    (กฎยืนข้อ 10: ห้ามเพิ่ม Latency บน Live Path โดยไม่จำเป็น)
  - Reuse Quick Reply/Postback Pattern เดิมใน webhook.controller.js + flexMessage.util.js
    ห้ามสร้าง Flow ใหม่ซ้ำซ้อน
  - ต้องกันกรณีผู้ใช้ทิ้ง Flow ค้าง (Pending expire) ตาม Pattern เดิม

Free-tier นับ distinct symbol (Founder ตัดสินแล้ว):
  - ถือ BTC 2 โบรก = นับเป็น 1 สินทรัพย์
  - ใช้ countActiveSymbolsGroupedByUser ไม่ใช่ countActiveByUser ที่นับแถว
  - ไล่ดูว่าจุดไหนในระบบยังใช้ตัวนับแถวอยู่ แล้วแก้ให้สอดคล้อง
  - Test บังคับ: Free ถือ BTC 2 โบรก + ETH 1 โบรก → เพิ่มสินทรัพย์ตัวที่ 3 ไม่ได้
    แต่เพิ่มโบรกที่ 3 ให้ BTC ได้

### DoD ของ Stage 5
- Regression พิสูจน์ Red-Green จริง: ถอด constraint ใหม่ออก → ต้องเห็นเทสต์แดงก่อน
  ใส่กลับ → เขียว (ต้องรายงานเลขแดง/เขียวจริง ไม่ใช่บอกว่า "ผ่านแล้ว")
- Regression Cross-User: ผู้ใช้ A ต้องยัดสินทรัพย์เข้าพอร์ต/โบรกของผู้ใช้ B ไม่ได้
- เทสต์เดิมทั้งหมดเขียว รายงานตัวเลขก่อน/หลัง
- npm run build ผ่าน, ESLint สะอาดบนไฟล์ที่แตะ
- อัปเดต docs/CHANGELOG.md, docs/DATABASE.md

## ═══ งานที่ 2 — Stage 6b: เปิด dividend ═══

Migration 047 เปิด CHECK constraint ให้รับ 'dividend'
ต้องเป็น Migration ตัวสุดท้ายเสมอ ห้ามสลับลำดับ

ก่อนเปิด ต้องยืนยันว่า Stage 6a (commit 38aa28a) ครอบครบทั้ง 7 จุดแล้วจริง
เพราะสูตรเงินเดิมเขียนแบบ binary (buy หรือ "ไม่ใช่ buy") ถ้าตกจุดใดจุดหนึ่ง
dividend จะถูกตีความเป็น sell เงียบๆ:
  1. services/transaction.service.js:392       → จำนวนที่ถือหายไป
  2. services/portfolio.service.js:46-72       → ต้นทุนถูกตัด + กำไรเพี้ยน
  3. migrations/041:130 (และ 034, 036)         → ผิดถึงระดับ DB
  4. utils/flexMessage.util.js:726             → แสดงว่า "ขาย"
  5. reportExport.service.js:529,698           → แสดงว่า "ขาย"
  6. transactions.controller.js:613            → แสดงว่า "ขาย"
  7. undoTransaction.service.js:121            → ร้ายแรงสุด: กด "ย้อนล่าสุด" บนปันผล
                                                 จะสร้างแถว buy เพิ่มหุ้น+ต้นทุนจากอากาศ

กฎของ dividend:
- ไม่กระทบ heldQty / costBasis / realizedPnL เลย (เป็นรายได้ คนละก้อนกับกำไรส่วนต่างราคา)
- Undo dividend ต้องสร้าง dividend_reversal ตาม Pattern undoTransaction.service.js
  (ไม่ลบ ไม่แก้แถวเดิม แต่ INSERT แถวใหม่ note = 'UNDO_OF:<id ต้นฉบับ>')
- เป็นฟีเจอร์ Free ไม่ Gate ด้วย Premium
- Stock Dividend (ปันผลเป็นหุ้น) เลื่อนไปรอบหน้า ไม่ทำในรอบนี้ — บันทึกใน CHANGELOG/TODO

## ═══ งานที่ 3 — Stage 8: Endpoint ใหม่ ═══

สร้าง Endpoint ทั้งหมดตาม docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md

ต้องแก้ Spec ด้วย: docs/API.md § 14.2 เขียน GET /portfolios เป็น Premium
→ ต้องเปลี่ยนเป็น Free เพราะหลัง backfill ทุกคนจะมีพอร์ต Default
ถ้าคืน 403 หน้า Dashboard ของผู้ใช้ Free จะพังทันที
ตัวคุมสิทธิ์จริงคือ POST (สร้างพอร์ตใหม่) ไม่ใช่ GET

กฎสิทธิ์ที่ต้อง implement:
- Free = พอร์ตเดียว (docs/AI_CONTEXT.md บรรทัด 95 ระบุ Multiple Portfolio: Free ❌)
- Premium หมดอายุแต่มีหลายพอร์ต = "อ่านได้ เขียนไม่ได้"
  พอร์ตส่วนเกินเปิดดูย้อนหลังได้ แต่เพิ่มสินทรัพย์/บันทึกรายการใหม่ไม่ได้
  ต่ออายุแล้วกลับมาใช้ได้ทันที ห้ามลบข้อมูลเด็ดขาด
  "พอร์ตไหนคือส่วนเกิน" ต้อง Deterministic — เรียงตาม created_at พอร์ตแรกสุดยังเขียนได้
  ต้องมี Test ครอบให้ชัด
- Sanity Cap 50 พอร์ตต่อ user

Broker name normalize:
- trim ช่องว่างหัวท้าย + ยุบช่องว่างซ้ำ + เทียบ case-insensitive
- กัน "Bitkub" / "bitkub" / "Bitkub " กลายเป็น 3 กลุ่มบนกราฟโดนัท
- แต่เก็บรูปแบบที่ผู้ใช้พิมพ์ครั้งแรกไว้แสดงผล (ห้ามบังคับเป็นตัวพิมพ์เล็กหมด)
- ไม่ต้องทำ Autocomplete รายชื่อโบรกในรอบนี้

## ═══ งานที่ 4 — Stage 9: ต่อ Frontend ═══

Port UI จาก branch demo/multipage-ux-redesign มาใส่บน main ทีละไฟล์
ห้าม merge branch เด็ดขาด (จะลบงาน Production ทิ้ง)

ไฟล์ต้นทางใน demo branch:
  frontend/src/pages/demo/Demo{Dashboard,Portfolio,Transactions,Dca,Profile}.jsx
  frontend/src/components/demo/*
  frontend/src/lib/demo/*

ข้อบังคับ:
- ทำเป็น Route คู่ขนาน / Feature Flag ก่อน ห้ามลบ Dashboard เดิม (ให้ Rollback ง่าย)
- แทน frontend/src/lib/demo/planEntitlements.js (ของปลอม) ด้วย Entitlement จริงจาก /dashboard/me
- Reuse frontend/src/lib/api.js เดิม ห้ามเขียน API Client ใหม่
- ต้องมี Loading state + Error state ทุกหน้า ห้าม Silent Default
- /dashboard/overview คืน flag เหล่านี้มาด้วย ต้องมี UI รองรับ (Demo ไม่มี):
  fxStale, fxUnavailableForUsd, priceUnavailable, excludedCount, isEmpty
  API.md ระบุชัดว่าห้ามรวมยอดข้ามสกุลเงินเมื่อ fxUnavailableForUsd = true

## ═══ ลำดับ Apply Migration (Founder รันเอง อย่ารันแทน) ═══

042 → 043 → 044 → 045 → 046 → 047
รันทีละไฟล์ ห้ามข้ามลำดับ Verify Query เขียนไว้ท้ายไฟล์ทุกตัวแล้ว

ก่อนรัน 044 ต้องทำ 2 อย่างนี้ก่อนเสมอ (044 เป็นตัวแรกที่แตะข้อมูลเดิมจริง):
  1. จดเลขแถวตั้งต้นของ assets / portfolios / users
  2. สร้าง _backup_044_assets_portfolio

## ═══ DoD ทุก Stage (docs/AI_WORK_POLICY.md § 3) ═══

1. Unit + Integration Test ครอบ Logic ใหม่
2. Regression พิสูจน์ Red-Green จริง — ถอด Fix ออกต้องเห็นแดงก่อน
   ต้องรายงานเลขแดง/เขียวจริง ห้ามบอกแค่ว่า "ผ่านแล้ว"
3. เทสต์เดิมทั้งหมดเขียว รายงานตัวเลขก่อน/หลัง
4. Production Verification — รอบนี้ทำไม่ได้เพราะห้าม Deploy
   ต้องระบุชัดในรายงานว่ายังไม่ได้ Verify บน Production
5. npm run build ผ่านทั้ง Backend/Frontend, ESLint สะอาดบนไฟล์ที่แตะ
6. อัปเดต docs/CHANGELOG.md, docs/API.md, docs/DATABASE.md ให้ตรงของจริง

## ═══ รายงานกลับที่ต้องการ ═══

1. Stage ไหนเสร็จ commit hash อะไร
2. หลักฐาน Red-Green ของ UNIQUE constraint 046 (เลขแดง/เขียวจริง)
3. ตัวเลขเทสต์ก่อน/หลัง
4. จุดที่ยังไม่ได้ทำ / ที่ต้องให้ Founder ตัดสิน
5. คำสั่ง diff ให้ Founder ตรวจงานทั้งหมด

หยุดก่อน Push เสมอ รอ Founder ตรวจ

ถ้าเจอเรื่องที่ต้องตัดสินใจเชิงธุรกิจหรือเสี่ยงต่อ Ledger ที่เอกสารไม่ได้ครอบ
ให้หยุดถามก่อน อย่าเดา
แต่ถ้าเป็นรายละเอียดเทคนิคที่มี Pattern เดิมในโปรเจกต์อยู่แล้ว ให้ยึด Pattern เดิมและทำต่อได้เลย

เริ่มจากงานที่ 1 (ปิด Stage 5 ที่ค้าง) ทันที
```
