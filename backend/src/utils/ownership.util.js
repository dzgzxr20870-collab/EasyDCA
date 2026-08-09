// ═══════════════════════════════════════════════════════════════════════════
// Ownership Guard — บังคับว่า Query ข้อมูลของผู้ใช้ "ต้องมี userId เสมอ"
// ═══════════════════════════════════════════════════════════════════════════
// เกิดจาก Security Audit (Cross-User Isolation): EasyDCA ใช้ service_role key
// และไม่ได้เปิด RLS — Database ไม่ตรวจสิทธิ์ให้เลย ทุกการกันข้อมูลข้ามบัญชีอยู่ที่
// โค้ด Backend ล้วนๆ (กฎยืน PROJECT_STATUS.md ข้อ 3 "Backend คือ Security
// Boundary เดียว — ทุก Query กรอง userId")
//
// ปัญหาที่ Audit เจอ: ตาราง pending_transactions ถูก Query ด้วย `id` ที่มาจาก
// LINE Postback ตรงๆ โดยไม่เคยเทียบ user_id เลย — ผู้ใช้ที่ถือ pendingId ของคนอื่น
// สั่งยืนยัน/ยกเลิกธุรกรรมของคนอื่นได้ และรายละเอียดธุรกรรมของเหยื่อ (symbol,
// จำนวน, ยอดเงิน, ยอดคงเหลือในพอร์ต) ถูกตอบกลับไปในแชทของผู้โจมตี
//
// ⚠️ กฎเหล็กของไฟล์นี้: ห้าม Silent Default ทุกรูปแบบ — โดยเฉพาะ "ไม่มี userId
// = ดึงทั้งหมด" ซึ่งเป็นรูปแบบความผิดพลาดที่อันตรายที่สุด ถ้า userId ว่าง/null/
// undefined ต้อง "พัง" ทันทีและดังที่สุด ไม่ใช่เงียบแล้วคืนข้อมูลของทุกคน
//
// หมายเหตุขอบเขต: นี่คือ Guard ขั้นต่ำสำหรับจุดที่ Audit รอบนี้ปิด ไม่ใช่ Data
// Access Helper กลางเต็มรูปแบบ (Registry รายชื่อตาราง + queryForUser /
// queryAcrossUsers ที่บังคับใส่เหตุผล) ซึ่งตกลงกันว่าเป็นงานรอบถัดไป
class OwnershipError extends Error {
  constructor(message, context) {
    super(message);
    this.name = 'OwnershipError';
    this.code = 'MISSING_USER_ID';
    this.context = context;
  }
}

// คืน userId เดิมถ้าใช้ได้ / throw ถ้าไม่มีหรือไม่ใช่ String ที่มีเนื้อหา
//
// เช็คชนิดด้วย (ไม่ใช่แค่ Falsy) เพราะ userId ที่หลุดมาเป็น object/number จาก
// การ Refactor ผิดจุดจะทำให้ PostgREST เทียบ user_id ไม่ตรงกับใครเลยแล้ว "คืน
// ผลว่าง" อย่างเงียบๆ ซึ่งอ่านเหมือนไม่มีข้อมูลจริง — ปิดบังบั๊กแทนที่จะเปิดเผย
//
// context = ชื่อจุดที่เรียก (เช่น 'pendingTransaction.claimForConfirm') เพื่อให้
// Log/Stack ชี้ตรงไปที่ Query ที่ลืมใส่ ไม่ต้องไล่หาเอง
function requireUserId(userId, context) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new OwnershipError(
      `${context}: userId is required and must be a non-empty string ` +
        `(got ${userId === null ? 'null' : typeof userId}) — refusing to run an ` +
        'unscoped query on user-owned data',
      context
    );
  }

  return userId;
}

module.exports = { requireUserId, OwnershipError };
