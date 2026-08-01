# Changelog

ทุก Entry ใหม่ให้เพิ่มต่อจาก Unreleased ด้านบนสุดเสมอ (ใหม่สุดอยู่บนสุด)

## [Unreleased]
### Added
- **Cron เตือนก่อน Premium หมดอายุ 3 วัน** (`premiumExpiryReminder.job`, ทุกวันตี 2)
  — เดิมระบบมีแต่ Push *หลัง* หมดอายุแล้ว (`planDowngrade.job` — สายเกินจะต่อทัน)
  · **Migration 030** (`users.expiry_reminder_sent_at`)
  - ใช้กับ Premium **ทุกคนเท่ากัน** ไม่ว่าได้มาจากทางไหน (จ่ายเงินจริง / Admin Grant /
    Free Trial) เพราะกรองจาก `plan` + `plan_expires_at` ซึ่งเป็นคอลัมน์เดียวที่ทุก Path
    เขียนลงไป — ไม่มี Path ไหนถูกลืม
  - กันส่งซ้ำ: `expiry_reminder_sent_at` ปั๊ม**หลัง** Push สำเร็จเท่านั้น และถูก Reset
    เป็น NULL ที่ `updatePlan()`/`claimFreeTrial()` เพื่อให้รอบบิลถัดไปเตือนได้อีก
  - รันตี 2 (หลัง `planDowngrade` ตี 1) + Error Isolation รายคน (1 คนพังไม่หยุด Batch)
- **รับ Premium ฟรี 1 เดือนได้เอง (แคมเปญชั่วคราว)** — ผู้ใช้กดรับเองที่หน้า `/premium`
  ไม่ต้องรอ Admin กดให้ทีละคน · **Migration 029** (`users.free_trial_claimed_at`)
  - **สิทธิ์ครั้งเดียวตลอดชีพต่อบัญชี** กันด้วย Atomic Claim
    (`UPDATE ... WHERE free_trial_claimed_at IS NULL` — Statement เดียวกับตอนให้สิทธิ์
    จึงกันกดรัวพร้อมกันได้จริง Pattern เดียวกับ `claimForApproval` ของ Payment)
  - ได้ **1 เดือนเป๊ะ ไม่ Stack** (ส่ง `null` เข้า `computeRenewalExpiry` โดยเจตนา)
    หมดอายุแล้ว `planDowngrade.job` ลดกลับเป็น Free อัตโนมัติด้วย Path เดียวกับ
    Premium ที่จ่ายเงินจริง — ไม่ต่ออายุให้เอง
  - Guard 6 ชั้น: Flag ปิด / บัญชี locked-anonymized / เคยกดรับ / เป็น Premium อยู่ /
    เคยจ่ายเงินสำเร็จ / เคยได้ Admin Grant
  - ปิดแคมเปญได้ด้วย Env Var `PREMIUM_FREE_TRIAL_ENABLED=false` (Restart ~1-2 นาที
    **ไม่ต้อง git push / ไม่ต้อง Build**) — Fail-closed: ต้องเป็น `true` เป๊ะถึงจะเปิด
  - ⚠️ ผลต่อ `/admin/stats`: **ไม่กระทบรายได้** (ไม่แตะตาราง `payments` เลย) แต่
    `premiumUsers` เพิ่มตามจริง — ระหว่างแคมเปญ Premium ≠ คนจ่ายเงิน
- **โลโก้สินทรัพย์บน Dashboard เว็บ** — ดึงอัตโนมัติแทนตัวอักษรย่อ+สีเดิม (Crypto ผ่าน
  CoinGecko API + Cache localStorage 30 วัน / หุ้นผ่าน `cdn.tickerlogos.com` ตาม Domain
  บริษัทที่ Curate ไว้ ~55 ตัวหลัก) Fallback กลับตัวอักษรย่อเดิมเสมอเมื่อหาโลโก้ไม่ได้
  หรือโหลดรูปไม่สำเร็จ (ไม่ใช่ Broken Image Icon) — UI-only ไม่แตะ Logic การเงิน
- **บันทึกการขายบน Dashboard เว็บ** — Toggle 🟢 ซื้อ / 🔴 ขาย ในกล่องบันทึกรายการเดียวกัน
  (เดิมเว็บบันทึกได้แค่ซื้อ ต้องไปพิมพ์คำสั่งใน LINE ถ้าจะขาย)
  - `POST /api/v1/transactions` รับ `side` เพิ่ม (ไม่ส่ง = `"buy"` เหมือนเดิมทุกประการ)
    รองรับ `quantity + pricePerUnit` และ `sellAll: true` — เรียก
    `transaction.service.processSellCommand` ตัวเดียวกับคำสั่งพิมพ์ใน LINE
    (ไม่มี Logic คำนวณเงินใหม่ / ไม่แตะ `transaction.service` / **ไม่มี Migration**)
  - โหมดขายเลือกได้เฉพาะสินทรัพย์ที่ถืออยู่จริง + แสดงยอดคงเหลือ + ปุ่ม "ขายทั้งหมด"
    (ส่ง `sellAll` ให้ Backend หายอด+ราคาตลาดเอง จึงไม่เหลือเศษค้างในพอร์ต)
### Fixed
- Error Code ฝั่งขาย (`ASSET_NOT_FOUND` / `NOTHING_TO_SELL` / `INSUFFICIENT_QUANTITY`)
  ที่ `validateSell` โยนมา ไม่เคยถูก Map ใน `transactions.controller` เลย — เดิมจะตกไป
  **500 "เกิดข้อผิดพลาดภายในระบบ"** ทั้งที่เป็น Business Rule ที่ผู้ใช้แก้เองได้
  ตอนนี้ตอบ 400 พร้อมข้อความไทย (และ `details: { requested, held }` สำหรับขายเกินยอด)
- ปุ่ม "แดชบอร์ดเว็บ" บน Rich Menu (และลิงก์ Dashboard/Support อื่นในแชท LINE) เปิดไม่ขึ้น
  ในบาง Case เพราะชี้ `https://liff.line.me/{liffId}` ซึ่งเปิดผ่าน LIFF In-App Browser
  ที่ไม่เสถียร — เปลี่ยนทุกจุดให้ชี้ Domain ของเว็บเราตรงๆ พร้อม `?openExternalBrowser=1`
  บังคับเปิดผ่าน Browser ภายนอกของเครื่องเสมอ (ยืนยันจาก LINE Docs ว่าพารามิเตอร์นี้
  ใช้ไม่ได้กับ `liff.line.me` จึงต้องเลิกใช้ Domain นั้นด้วย — ดู
  `backend/src/utils/externalUrl.util.js`) Login/JWT ยังทำงานถูกต้องเหมือนเดิม
  (`Login.jsx` เรียก `liff.init()`+`liff.login()` เอง ไม่ได้พึ่งการเปิดผ่าน LIFF)

## [0.3.0] - 2026-07-04
### Added
- Payment/Premium Subscription เต็มระบบ (PromptPay QR + Admin Manual Approval)
- Dashboard Redesign Round 4-5 (Endpoint /me, Banner Free/Premium, 4 แท็บ, ธีมมืด/สว่าง, กราฟ/Donut)
- แก้เมนู ADD ให้สอนวิธีพิมพ์คำสั่งซื้อ/ขาย
- Publish LINE Login Channel (privacy.html/terms.html)
- ลบไฟล์ขยะ (backend/npm, root package-lock.json)

## [0.2.0] - 2026-07-03
### Added
- LIFF Login (Foundation)
- Web Dashboard (React) — Portfolio/History/Profit Endpoints + หน้า Dashboard พื้นฐาน

## [0.1.0] - 2026-07-03
### Added
- LINE Bot Core MVP: Webhook, Command Parser, Freemium Limit, Postback Confirm/แก้ไข/ยกเลิก, Rich Menu, Price Feed (Crypto)
- Deploy Railway Production สำเร็จ + ทดสอบผ่าน LINE จริงครบทุกฟีเจอร์หลัก
