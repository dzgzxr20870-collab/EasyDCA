// ═══════════════════════════════════════════════════════════════════════
// transactionSlipSession.service — "รอรูปสลิปของรายการที่เพิ่งบันทึก" (LINE)
// ═══════════════════════════════════════════════════════════════════════
// ตอบโจทย์: ผู้ใช้ที่ "พิมพ์เอง" (ซื้อ ASTS 5000 → กดยืนยัน) ไม่เคยมีโอกาสแนบสลิปเลย
// เพราะระบบแนบให้อัตโนมัติเฉพาะเส้นทาง AI OCR (ที่มีรูปอยู่ในมือตั้งแต่แรก)
//
// Flow: กดยืนยัน → บันทึกสำเร็จ → เปิด Session (10 นาที) + ถามว่าจะแนบสลิปไหม
//       → ผู้ใช้ส่งรูป → handleImage เห็น Session → แนบเข้ารายการนั้น (ไม่เรียก AI)
//       → ลบ Session
//
// ── คำตอบของ 3 คำถามที่ Requirement บังคับให้ตอบ ────────────────────────────
// 1) "ถ้าผู้ใช้ไม่ส่งรูป (เงียบไป) ต้องไม่ค้างสถานะจนรูปถัดไปโดนแนบผิดรายการ"
//    → TTL 10 นาที บังคับที่ "ชั้นอ่าน" เสมอ (findValidByUser กรอง updated_at ด้วย
//      cutoff ทุกครั้ง) ไม่ใช่พึ่ง Cron ลบให้ — แปลว่าต่อให้ Cron ไม่ทำงานเลย แถวที่
//      ค้างก็ "ไม่มีผล" อยู่ดี รูปถัดไปจะไหลเข้า AI OCR ตามปกติ Cron เป็นแค่การเก็บ
//      กวาดพื้นที่ ไม่ใช่กลไกความถูกต้อง (Pattern เดียวกับ guidedBuyFlow)
//
// 2) "ถ้าผู้ใช้ส่งรูปมาโดยไม่ได้อยู่ในสถานะนี้ ต้องยังเข้า OCR เหมือนเดิมทุกประการ"
//    → getActiveSession คืน null → handleImage เดินเส้นทางเดิมเป๊ะ (ไม่มีการแก้
//      handleAssetSlipImage เลยแม้แต่บรรทัดเดียวในส่วนนี้)
//
// 3) "ผู้ใช้ Free ที่ไม่มีสิทธิ์แนบสลิป ควรเจออะไร"
//    → ไม่ถามเลยตั้งแต่แรก (webhook.controller เช็ค isPremiumActive ก่อนเปิด Session)
//      — ถามแล้วปฏิเสธทีหลังคือสิ่งที่ Requirement ห้ามตรงๆ ("ใจร้าย")
//
// ⚠️ ทุกฟังก์ชันในไฟล์นี้ถูกเรียก "หลังธุรกรรมถูก Commit ลง DB แล้ว" จึงต้อง Fail
// Isolated เต็มรูปแบบ: ห้าม throw ออกไปเด็ดขาด (เหตุผลเดียวกับ attachSlipBestEffort
// ใน webhook.controller) — ธุรกรรมสำเร็จแล้ว การเปิด/ปิด Session พลาดต้องไม่ทำให้
// ผู้ใช้เห็นข้อความ "ผิดพลาด" จนกดซ้ำแล้วเข้าใจผิดว่ายังไม่บันทึก
const transactionSlipSessionRepository = require('../repositories/transactionSlipSession.repository');

// TTL 10 นาที — ยาวพอให้ผู้ใช้ออกไปเปิดแอปธนาคาร/แคปหน้าจอมาส่งทัน แต่สั้นพอที่
// รูป "รอบถัดไป" จะไม่โดนดูดเข้ารายการเดิม (ดูเหตุผลเต็มใน migration 040)
const SESSION_TTL_MS = 10 * 60 * 1000;

function cutoffIso(now = new Date()) {
  return new Date(now.getTime() - SESSION_TTL_MS).toISOString();
}

// เปิด Session รอสลิป — Best-effort (Log แล้วเดินต่อถ้าพลาด)
// คืน true เมื่อเปิดสำเร็จ (ผู้เรียกใช้ตัดสินว่าจะถามผู้ใช้เรื่องสลิปไหม — ถ้าเปิด
// Session ไม่สำเร็จก็ไม่ควรถาม เพราะส่งรูปมาแล้วจะไม่มีอะไรรับ)
async function startWaiting(userId, transactionId) {
  if (!userId || !transactionId) return false;

  try {
    await transactionSlipSessionRepository.upsert(userId, transactionId);
    return true;
  } catch (err) {
    console.error(
      `[transactionSlipSession] startWaiting failed AFTER commit ` +
        `(transactionId=${transactionId}): ${err.message} — transaction is already persisted; ` +
        'user simply will not be asked to attach a slip'
    );
    return false;
  }
}

// คืน Session ที่ยังไม่หมดอายุ | null — null แปลว่า "รูปนี้ไม่เกี่ยวกับ Flow นี้"
// ให้ผู้เรียกเดินเส้นทาง AI OCR เดิมต่อ
//
// ⚠️ Fail-open โดยเจตนา (ต่างจาก slipOcrAccess ที่ Fail-closed): ถ้าอ่าน Session
// ไม่ได้ (DB ล่ม) ให้ถือว่า "ไม่มี Session" แล้วปล่อยรูปไหลเข้า OCR ตามเดิม —
// พฤติกรรมที่แย่ที่สุดคือผู้ใช้เสียโควตา OCR 1 ครั้งโดยไม่ตั้งใจ ซึ่งเบากว่าการทำให้
// ส่งรูปไม่ได้เลยทั้งระบบเพราะตารางเสริมตัวเดียวมีปัญหา
async function getActiveSession(userId, now = new Date()) {
  try {
    return await transactionSlipSessionRepository.findValidByUser(userId, cutoffIso(now));
  } catch (err) {
    console.error(`[transactionSlipSession] getActiveSession failed for ${userId}: ${err.message}`);
    return null;
  }
}

// ปิด Session (แนบสำเร็จ/ผู้ใช้กดไม่แนบ/แนบไม่สำเร็จก็ตาม) — Best-effort
//
// ⚠️ ต้องปิดแม้ในเคสแนบไม่สำเร็จด้วย: ถ้าปล่อยค้าง ผู้ใช้ที่ส่งรูปใหม่อีกใบ (ตั้งใจ
// ให้ AI อ่าน) จะโดนดูดเข้ารายการเดิมซ้ำอีกรอบ — วนไม่จบจนกว่าจะครบ TTL
async function stopWaiting(userId) {
  try {
    await transactionSlipSessionRepository.deleteByUser(userId);
  } catch (err) {
    console.error(`[transactionSlipSession] stopWaiting failed for ${userId}: ${err.message}`);
  }
}

// สำหรับ Cron Purge (worker) — ลบแถวที่เลย TTL ไปนานแล้ว คืนจำนวนที่ลบ
// ⚠️ ตัวนี้ "ไม่" Swallow Error: ถูกเรียกจาก Job ไม่ใช่จาก Flow ของผู้ใช้ — Job มี
// Error Isolation ของตัวเองและควรเห็น Error จริงเพื่อ Alert ได้
async function purgeStale(now = new Date()) {
  return transactionSlipSessionRepository.purgeStaleBefore(cutoffIso(now));
}

module.exports = {
  SESSION_TTL_MS,
  startWaiting,
  getActiveSession,
  stopWaiting,
  purgeStale,
};
