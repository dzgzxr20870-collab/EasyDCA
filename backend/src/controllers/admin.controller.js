const userRepository = require('../repositories/user.repository');
const paymentRepository = require('../repositories/payment.repository');
const assetRepository = require('../repositories/asset.repository');
const entitlementService = require('../services/entitlement.service');
const broadcastService = require('../services/broadcast.service');
const { bangkokYearMonth } = require('../utils/thaiDate.util');

// สถานะ Payment ที่รับได้เป็น Query Param (ค่าจริงใน DB — "อนุมัติแล้ว" = 'confirmed'
// ไม่มี 'approved') กันค่าที่ไม่รู้จักหลุดไปเป็น .eq('status', ...) ที่ Query ได้ 0 แถวเงียบๆ
const VALID_PAYMENT_STATUSES = ['pending', 'confirmed', 'rejected', 'expired'];

// สถานะที่ถือว่า "จ่ายเงินสำเร็จ" (นับเป็นรายได้) — Round 4b นับเฉพาะ 'confirmed'
// (ไม่นับ pending/rejected/expired) ตาม Requirement
const REVENUE_STATUS = 'confirmed';

// GET /api/v1/admin/ping — Wiring Check ชั่วคราวของ Round 4a
// ผ่าน requireAuth + requireAdmin มาแล้ว จึงการันตีว่า req.user.role === 'admin'
function ping(req, res) {
  return res.status(200).json({ ok: true, role: req.user.role });
}

// GET /api/v1/admin/users — รายชื่อ User ทั้งหมด (Read-only)
// assetCount = จำนวน Symbol Active ที่ต่างกัน (ยิง Query เดียวรวมทุก User เลี่ยง N+1)
// isPremiumActive ตัดสินผ่าน entitlement.service เดิม (ไม่เทียบ plan === 'premium' เอง)
async function listUsers(req, res) {
  try {
    const [users, assetCounts] = await Promise.all([
      userRepository.findAll(),
      assetRepository.countActiveSymbolsGroupedByUser(),
    ]);

    const result = users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      plan: user.plan,
      planExpiresAt: user.planExpiresAt ?? null,
      isPremiumActive: entitlementService.isPremiumActive(user),
      assetCount: assetCounts[user.id] ?? 0,
      createdAt: user.createdAt,
    }));

    return res.status(200).json({ users: result });
  } catch (err) {
    console.error(`[admin] listUsers failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/v1/admin/payments?status=pending|confirmed|rejected|expired — Read-only
// ไม่ส่ง status = คืนทุกสถานะ | status ที่ไม่รู้จัก → 400 (ไม่เงียบคืน [] ให้เข้าใจผิด)
async function listPayments(req, res) {
  try {
    const { status } = req.query;

    if (status !== undefined && !VALID_PAYMENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'INVALID_STATUS' });
    }

    const payments = await paymentRepository.findAll({ status });

    const result = payments.map((p) => ({
      id: p.id,
      userId: p.userId,
      displayName: p.displayName ?? null,
      amountThb: p.amountThb,
      billingPeriod: p.billingPeriod,
      status: p.status,
      slipImageUrl: p.slipImageUrl ?? null,
      createdAt: p.createdAt,
      confirmedAt: p.confirmedAt ?? null,
      // Lock-Until-Resolved (migration 016) — Admin Dashboard (Frontend) ใช้ 4 Field
      // นี้แสดง QR+สลิปคู่กัน/Badge ความเร่งด่วน/ประวัติ Auto-release (ดู payment.
      // repository.toPayment — Passthrough ตรงๆ ไม่มี Query/Logic เปลี่ยนแปลง)
      baseAmountThb: p.baseAmountThb,
      satangTag: p.satangTag,
      amountReleasedAt: p.amountReleasedAt ?? null,
      confirmedBy: p.confirmedBy ?? null,
    }));

    return res.status(200).json({ payments: result });
  } catch (err) {
    console.error(`[admin] listPayments failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// GET /api/v1/admin/stats — ตัวเลขสรุป (Read-only)
//   - premiumUsers = User ที่ isPremiumActive จริง (ไม่ใช่แค่ plan==='premium' ที่หมดอายุ)
//   - totalRevenue / revenueThisMonth = ผลรวม amountThb ของ Payment status='confirmed'
//     เท่านั้น | revenueThisMonth กรอง confirmedAt อยู่ในเดือนปฏิทินปัจจุบัน (Asia/Bangkok)
async function getStats(req, res) {
  try {
    const [users, payments] = await Promise.all([
      userRepository.findAll(),
      paymentRepository.findAll(),
    ]);

    const totalUsers = users.length;
    const premiumUsers = users.filter((u) => entitlementService.isPremiumActive(u)).length;
    const freeUsers = totalUsers - premiumUsers;

    const currentMonth = bangkokYearMonth(new Date());
    let totalRevenue = 0;
    let revenueThisMonth = 0;

    for (const p of payments) {
      if (p.status !== REVENUE_STATUS) continue;
      totalRevenue += Number(p.amountThb) || 0;
      // confirmedAt คือเวลาที่อนุมัติ — payment 'confirmed' ควรมีค่าเสมอ แต่กัน null ไว้
      if (p.confirmedAt && bangkokYearMonth(p.confirmedAt) === currentMonth) {
        revenueThisMonth += Number(p.amountThb) || 0;
      }
    }

    return res.status(200).json({
      totalUsers,
      freeUsers,
      premiumUsers,
      totalRevenue,
      revenueThisMonth,
    });
  } catch (err) {
    console.error(`[admin] getStats failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// POST /api/v1/admin/broadcast — ส่งข้อความประชาสัมพันธ์ (Push) หากลุ่มเป้าหมาย
// ⚠️ ยิง Push หา User จริงจำนวนมาก — Validate เข้มก่อนเสมอ ห้าม Trust Body
// Body: { targetGroup, messageType, message }
// การส่งจริง (วน Push + Error Isolation + Rate Limit + บันทึก Log) อยู่ใน
// broadcast.service (Controller แค่ Validate + เรียก Service + คืนผลนับ)
async function broadcast(req, res) {
  const { targetGroup, messageType, message } = req.body || {};

  if (!broadcastService.TARGET_GROUPS.includes(targetGroup)) {
    return res.status(400).json({ error: 'INVALID_TARGET_GROUP' });
  }
  if (!broadcastService.MESSAGE_TYPES.includes(messageType)) {
    return res.status(400).json({ error: 'INVALID_MESSAGE_TYPE' });
  }
  if (typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'INVALID_MESSAGE' });
  }
  // String.length นับ UTF-16 code units ตรงกับที่ LINE นับ (ดู broadcast.service)
  if (message.length > broadcastService.MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'MESSAGE_TOO_LONG' });
  }

  try {
    // sentBy = LINE User ID ของ Admin ที่กดส่ง (req.user.lineUserId จาก requireAuth)
    const result = await broadcastService.sendBroadcast({
      targetGroup,
      messageType,
      message,
      sentBy: req.user.lineUserId,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error(`[admin] broadcast failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { ping, listUsers, listPayments, getStats, broadcast };
