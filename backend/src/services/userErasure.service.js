const userRepository = require('../repositories/user.repository');
const paymentRepository = require('../repositories/payment.repository');
// ป้ายกำกับที่ผู้ใช้ตั้งชื่อเอง — ต้องล้างชื่อตอน Erasure (มติ Founder 27 ส.ค. 2569)
const portfolioRepository = require('../repositories/portfolio.repository');
const brokerRepository = require('../repositories/broker.repository');
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
//   2c) ล้าง "ชื่อที่ผู้ใช้ตั้งเอง" ของ portfolios/brokers (มติ Founder 27 ส.ค. 2569)
//      — ทำ **ก่อน** Anonymize users ด้วยเหตุผลเดียวกับข้อ 2: ถ้าขั้นนี้ Fail ยัง
//      Retry ได้โดยไม่ต้องพึ่ง user_id เดิม (ซึ่งยังไม่ถูกล้าง)
//   3) Anonymize users Row (line_user_id/display_name/picture_url + anonymized_at)
//      — ไม่แตะ transactions/payments แถวจริงเด็ดขาด (Immutable Ledger)
//   4) บันทึก erasure_logs (Audit Trail — hadPendingPayment เผื่อ Admin สืบย้อนหลัง)
//
// ── ⚠️ อะไรถูกล้าง อะไรถูกเก็บ และทำไม (มติ Founder 27 ส.ค. 2569) ────────────
//   ล้าง: users (line_user_id/display_name/picture_url) · รูปสลิปทั้งหมดใน Storage
//         · **ชื่อ portfolios/brokers** ← เพิ่มรอบนี้
//   เก็บ: transactions/assets/payments แถวจริง (Immutable Ledger — เป็นหลักฐาน
//         ทางบัญชีและเป็นฐานของยอดเงินที่ผู้ใช้เคยตกลงไว้)
//
// เหตุผลที่ชื่อ portfolios/brokers **ไม่ได้รับเกราะ Immutable Ledger**: มันเป็น
// "ป้ายกำกับ" ที่ผู้ใช้พิมพ์เอง **ไม่เข้าสูตรคำนวณเงินสักสูตร** — ลบชื่อทิ้งแล้ว
// ตัวเลขทุกตัวในระบบยังเท่าเดิมเป๊ะ ต่างจาก transactions ที่ลบแล้วยอดเปลี่ยนทันที
//
// 📌 **Open Question ที่ยังไม่มีใครตัดสิน** — `transactions.note` ก็เป็นข้อความอิสระ
// ที่ผู้ใช้พิมพ์เองเหมือนกัน และการอ้าง Immutable Ledger เพื่อเก็บไว้หลังคำขอลบ
// ตาม PDPA เป็นฐานที่อ่อนกว่าที่คิด · **ห้ามแก้พฤติกรรมของ note เองเด็ดขาด**
// เป็นคำถามเชิงนโยบาย/กฎหมาย ไม่ใช่บั๊ก (ดู SECURITY.md § PDPA)
//
// คืน { paymentCount, deletedSlipCount, deletedTransactionSlipCount,
//       anonymizedPortfolioCount, anonymizedBrokerCount } ให้ Caller
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

  // Screenshot หลักฐาน Like Facebook (Bucket facebook-like-proofs — แคมเปญ Premium
  // ฟรี) — Error Isolated ด้วยเหตุผลเดียวกับสลิปธุรกรรมด้านบนทุกประการ
  // ⚠️ รูปพวกนี้เป็น Screenshot หน้า Facebook ที่มักติดชื่อจริง/รูปโปรไฟล์ของผู้ใช้
  // จึงต้องถูกลบตามคำขอ Erasure เช่นเดียวกับสลิป (แถวใน facebook_like_grant_requests
  // ยังอยู่ครบ — screenshot_path จะชี้ไปไฟล์ที่ไม่มีแล้ว ซึ่ง Signed URL คืน null เอง)
  let deletedFacebookProofCount = 0;
  try {
    deletedFacebookProofCount =
      await storageService.deleteAllFacebookLikeProofsForUser(userId);
  } catch (err) {
    logger.error('failed to delete facebook like proofs during erasure', {
      userId,
      error: err.message,
    });
  }

  // ── ล้างชื่อป้ายกำกับที่ผู้ใช้ตั้งเอง ─────────────────────────────────────
  // ⚠️ **ไม่ Error-Isolated โดยเจตนา** (ต่างจากการลบรูปสลิปด้านบน) — ถ้าล้างชื่อ
  // ไม่สำเร็จแล้วเราเดินหน้า Anonymize users ต่อ ผู้ใช้จะถูกบอกว่า "ลบข้อมูลแล้ว"
  // ทั้งที่ชื่อที่อาจมี PII ยังอยู่ครบใน DB = คำตอบที่ผิดต่อคำขอตาม PDPA
  // ปล่อยให้ throw แล้ว Retry ทั้ง Flow ได้ ดีกว่ารายงานผลลวง
  const anonymizedPortfolioCount = await portfolioRepository.anonymizeNamesForUser(userId);
  const anonymizedBrokerCount = await brokerRepository.anonymizeNamesForUser(userId);

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
    deletedFacebookProofCount,
    anonymizedPortfolioCount,
    anonymizedBrokerCount,
    hadPendingPayment,
  });

  return {
    paymentCount: paymentIds.length,
    deletedSlipCount,
    deletedTransactionSlipCount,
    deletedFacebookProofCount,
    anonymizedPortfolioCount,
    anonymizedBrokerCount,
  };
}

module.exports = { eraseUserData };
