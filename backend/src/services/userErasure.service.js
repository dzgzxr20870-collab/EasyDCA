const userRepository = require('../repositories/user.repository');
const paymentRepository = require('../repositories/payment.repository');
const storageService = require('../services/storage.service');
const erasureLogRepository = require('../repositories/erasureLog.repository');
const logger = require('../utils/logger.util');

// PDPA Self-Service Erasure — orchestrate ทั้ง Flow หลัง User ยืนยัน 2-Step Confirm
// ใน LINE Chat แล้ว (webhook.controller case 'confirm_erase_data') ลำดับตั้งใจ:
//   1) หา Payment ทั้งหมดของ User (ทุกสถานะ) เพื่อรู้ paymentId ที่ต้องลบสลิป
//   2) ลบรูปสลิปชำระเงินออกจาก Storage จริง (Hard Delete — ก่อน Anonymize User เสมอ
//      เผื่อขั้นตอนนี้ Fail จะได้ยัง Retry ได้โดยไม่ต้องพึ่ง user_id เดิมที่ถูกล้างไปแล้ว)
//   2b) ลบรูปสลิปธุรกรรม (S8 — Bucket transaction-slips) แบบ Error Isolated: ถ้าลบไม่
//      สำเร็จ Log แล้วไปต่อ ไม่ Block การ Anonymize (รูปไม่ใช่ Ledger ทางบัญชี)
//   3) Anonymize users Row (line_user_id/display_name/picture_url + anonymized_at)
//      — ไม่แตะ transactions/payments แถวจริงเด็ดขาด (Immutable Ledger)
//   4) บันทึก erasure_logs (Audit Trail — hadPendingPayment เผื่อ Admin สืบย้อนหลัง)
//
// คืน { paymentCount, deletedSlipCount, deletedTransactionSlipCount } ให้ Caller
// Log/ตรวจสอบเพิ่มได้ถ้าต้องการ
async function eraseUserData(userId, { hadPendingPayment = false } = {}) {
  const payments = await paymentRepository.findAllByUserId(userId);
  const paymentIds = payments.map((p) => p.id);

  const deletedSlipCount = await storageService.deleteAllSlipsForUser(paymentIds);

  // สลิปธุรกรรม (S8 — Bucket transaction-slips คนละถังกับ payment-slips ด้านบน)
  // ต่างจากการลบสลิปชำระเงินตรงที่ "Error Isolated": ถ้า Storage ลบไม่สำเร็จ ต้องไม่
  // ทำให้ทั้ง Flow ล้ม — ผู้ใช้ยังต้องได้รับการ Anonymize สำเร็จตาม PDPA ต่อให้ไฟล์รูป
  // บางไฟล์ค้าง (Log ไว้พอให้ Admin ตามเก็บทีหลังได้) รูปสลิปไม่ใช่ Ledger ทางบัญชี
  // การลบพลาดบางไฟล์จึงไม่ควร Block สิทธิ์ลบข้อมูลของผู้ใช้ทั้งคำขอ
  let deletedTransactionSlipCount = 0;
  try {
    deletedTransactionSlipCount =
      await storageService.deleteAllTransactionSlipsForUser(userId);
  } catch (err) {
    logger.error('failed to delete transaction slips during erasure', {
      userId,
      error: err.message,
    });
  }

  await userRepository.anonymize(userId);

  try {
    await erasureLogRepository.create({ userId, hadPendingPayment });
  } catch (err) {
    // Log เขียนไม่สำเร็จ "หลัง" Anonymize จริงไปแล้ว — ไม่ Throw ย้อนกลับ (User ข้อมูล
    // ถูกลบไปแล้วจริง จะ Fail ทั้ง Flow เพราะ Log พังไม่ได้ ยอมให้ Log หายดีกว่า
    // หลอกว่า Erasure ล้มเหลวทั้งที่ทำสำเร็จแล้ว — Pattern เดียวกับ broadcast.service)
    logger.error('failed to write erasure_logs', { userId, error: err.message });
  }

  logger.info('user data erased (PDPA)', {
    userId,
    paymentCount: paymentIds.length,
    deletedSlipCount,
    deletedTransactionSlipCount,
    hadPendingPayment,
  });

  return { paymentCount: paymentIds.length, deletedSlipCount, deletedTransactionSlipCount };
}

module.exports = { eraseUserData };
