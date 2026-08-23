const brokerService = require('../services/broker.service');

// ═══════════════════════════════════════════════════════════════════════════
// brokers.controller — /api/v1/brokers (Stage 1)
// ═══════════════════════════════════════════════════════════════════════════
// Spec: docs/API.md § 14.9 · Design Doc § 4.2
// ทุก Endpoint เป็น Free (โบรกเป็นแค่ป้ายกำกับสินทรัพย์ ไม่ใช่ฟีเจอร์ Premium)
//
// ⚠️ userId มาจาก req.user.id (JWT ที่ requireAuth Verify แล้ว) เท่านั้นเสมอ
// ห้ามรับ userId จาก Body/Query แม้แต่จุดเดียว
//
// Error Response Shape เหมือน dcaPlans/transactions.controller:
// { error: CODE, message: ไทย, details? } (Flat — Frontend อ่าน
// body.error/body.message ตรงๆ)

const WEB_ERROR_MESSAGES = {
  VALIDATION_ERROR: `ชื่อโบรกไม่ถูกต้อง — ต้องไม่เว้นว่างและยาวไม่เกิน ${brokerService.BROKER_NAME_MAX_LENGTH} ตัวอักษร`,
  BROKER_NAME_EXISTS: 'คุณมีโบรกชื่อนี้อยู่แล้ว (ระบบถือว่าตัวพิมพ์ใหญ่-เล็กเป็นชื่อเดียวกัน)',
  BROKER_NOT_FOUND: 'ไม่พบโบรกที่ต้องการ (อาจถูกลบไปแล้ว)',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  BROKER_NAME_EXISTS: 409,
  BROKER_NOT_FOUND: 404,
};

// ⚠️ คัดลอกรูปแบบมาจาก dcaPlans.controller.js:49 โดยตั้งใจให้ตรงกันเป๊ะ —
// Validate ก่อน Query กัน id ผิดรูปทำให้ Postgres throw 22P02 แล้วตกไป 500
// ทั้งที่ความหมายจริงคือ "ไม่พบโบรก" (404)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res, code, details = {}) {
  const status = ERROR_STATUS[code] ?? 500;
  return res.status(status).json({
    error: code,
    message: WEB_ERROR_MESSAGES[code] ?? WEB_ERROR_MESSAGES.INTERNAL_ERROR,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  });
}

function failFromServiceError(res, err, context) {
  if (err instanceof brokerService.BrokerServiceError) {
    return fail(res, err.code, err.details ?? {});
  }
  console.error(`[brokers] ${context} unexpected error: ${err.message}`);
  return fail(res, 'INTERNAL_ERROR');
}

// ตัดเฉพาะ Field ที่ต้องการเปิดเผยออกไปฝั่ง Client — ไม่ส่ง userId ออกไป
// (Client รู้อยู่แล้วว่าเป็นของตัวเอง การส่งกลับมีแต่จะเพิ่มพื้นที่รั่ว)
function toPublicBroker(broker) {
  return {
    id: broker.id,
    name: broker.name,
    createdAt: broker.createdAt,
    updatedAt: broker.updatedAt,
  };
}

// GET /api/v1/brokers — โบรกทั้งหมดของผู้ใช้ (เรียงตามชื่อ)
async function listBrokers(req, res) {
  try {
    const brokers = await brokerService.listBrokers(req.user.id);
    return res.status(200).json({ brokers: brokers.map(toPublicBroker) });
  } catch (err) {
    return failFromServiceError(res, err, 'listBrokers');
  }
}

// POST /api/v1/brokers — สร้างโบรกใหม่ Body { name }
async function createBroker(req, res) {
  const body = req.body ?? {};

  try {
    const broker = await brokerService.createBroker(req.user.id, body.name);
    return res.status(201).json({ broker: toPublicBroker(broker) });
  } catch (err) {
    return failFromServiceError(res, err, 'createBroker');
  }
}

// PATCH /api/v1/brokers/:id — เปลี่ยนชื่อโบรก Body { name }
async function updateBroker(req, res) {
  if (!UUID_RE.test(String(req.params.id))) {
    return fail(res, 'BROKER_NOT_FOUND');
  }

  const body = req.body ?? {};

  try {
    const broker = await brokerService.renameBroker(req.user.id, req.params.id, body.name);
    return res.status(200).json({ broker: toPublicBroker(broker) });
  } catch (err) {
    return failFromServiceError(res, err, 'updateBroker');
  }
}

// DELETE /api/v1/brokers/:id — ลบโบรก
//
// สินทรัพย์ที่ผูกอยู่ "ไม่ถูกลบตาม" (FK ON DELETE SET NULL) — ตอบกลับพร้อม
// ข้อความบอกผลลัพธ์ที่เกิดกับผู้ใช้ตรงๆ ว่าข้อมูลยังอยู่ครบ แค่กลับไปเป็น
// "ไม่ระบุโบรก" (หลักการของโปรเจกต์: บอกผลลัพธ์ที่เกิดกับผู้ใช้ก่อน)
async function deleteBroker(req, res) {
  if (!UUID_RE.test(String(req.params.id))) {
    return fail(res, 'BROKER_NOT_FOUND');
  }

  try {
    const result = await brokerService.deleteBroker(req.user.id, req.params.id);
    return res.status(200).json({
      deleted: { id: result.id },
      message: 'ลบโบรกแล้ว — สินทรัพย์ที่เคยผูกไว้ยังอยู่ครบทุกรายการ เปลี่ยนเป็น "ไม่ระบุโบรก"',
    });
  } catch (err) {
    return failFromServiceError(res, err, 'deleteBroker');
  }
}

module.exports = { listBrokers, createBroker, updateBroker, deleteBroker };
