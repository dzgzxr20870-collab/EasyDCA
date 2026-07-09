const config = require('../config/env');

// เช็คว่า LINE User ID เป็น Admin ที่ได้รับอนุญาตหรือไม่ — อ่านจาก
// config.payment.adminLineUserIds (Parse จาก ADMIN_LINE_USER_IDS แล้วในชั้น config/env:
// split ',' + trim + filter Boolean) เป็น Source of Truth เดียวกับ
// payment.service.assertAdmin เพื่อไม่ให้มี "รายชื่อ Admin" กระจายหลายที่
//
// สำคัญด้านความปลอดภัย: Role ของผู้ใช้ถูกตัดสินจากฟังก์ชันนี้ฝั่ง Backend เท่านั้น
// (ตอนออก JWT) ห้าม Trust ค่า role ที่ส่งมาจาก Client เด็ดขาด
function isAdminLineUserId(lineUserId) {
  if (!lineUserId) return false;
  return config.payment.adminLineUserIds.includes(lineUserId);
}

module.exports = { isAdminLineUserId };
