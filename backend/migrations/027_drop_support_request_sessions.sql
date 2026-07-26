-- ═══════════════════════════════════════════════════════════════════════
-- Migration 027 — Drop support_request_sessions (Migration 024)
-- ═══════════════════════════════════════════════════════════════════════
-- Flow "ติดต่อ Admin/Support" ถูก Pivot ไปเป็นหน้าเว็บ /support (ดู Migration 026)
-- — LINE Chat ฝั่งเดิมเปลี่ยนจาก "พิมพ์ Trigger → ถามข้อความ → รอ Input" (State
-- Machine ที่ตารางนี้เก็บ) เป็น "พิมพ์ Trigger → ตอบ Link ไปหน้าเว็บทันที" ไม่มีการ
-- รอ Input จาก User ใน LINE Chat อีกต่อไป — ตารางนี้จึงไม่มีจุดใด Insert ต่อไปอีกเลย
--
-- ⚠️ ยืนยันก่อน Drop: ตารางนี้เป็น Ephemeral Working State ล้วนๆ (Pattern เดียวกับ
-- guided_buy_sessions/dca_reminder_setup_sessions) ทุกแถวถูกลบทิ้งเองอยู่แล้วทันทีที่
-- Flow จบ/หมดอายุ (TTL 5 นาที) — ไม่มีข้อมูลเชิงประวัติศาสตร์หลงเหลืออยู่ในตารางนี้เลย
-- ต่างจาก support_requests (Log ถาวร — ไม่ถูกแตะในนี้) การ Drop จึง "ไม่เสียข้อมูล
-- อะไรทั้งสิ้น" ปล่อยตารางว่างเปล่าไว้เฉยๆ จะสร้างความสับสนว่ายังใช้อยู่หรือไม่
-- มากกว่าจะมีประโยชน์ (ตัดสินใจร่วมกับผู้ใช้แล้ว)
--
-- Repository/Cron Job ที่เขียนตารางนี้ (supportRequestSession.repository.js,
-- supportRequestCleanup.job.js) ถูกลบพร้อมกันในรอบเดียวกัน — ดู Commit นี้
-- ═══════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS support_request_sessions;
