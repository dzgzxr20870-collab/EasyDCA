const brokerRepository = require('../repositories/broker.repository');

// ═══════════════════════════════════════════════════════════════════════════
// broker.service — โบรกเกอร์/Exchange ที่ผู้ใช้สร้างเอง (Stage 1, migration 042)
// ═══════════════════════════════════════════════════════════════════════════
// ผูกกับสินทรัพย์ที่ระดับ assets.broker_id เพื่อใช้จัดกลุ่ม "Broker Allocation"
// บนหน้า Portfolio ฝั่งเว็บ
//
// ⚠️ ไฟล์นี้ "ไม่แตะสูตรเงินใดๆ ทั้งสิ้น" — broker เป็น Metadata สำหรับจัดกลุ่ม
// แสดงผลเท่านั้น ไม่เข้าไปอยู่ในสูตร heldQty / costBasis / realizedPnL จุดไหนเลย
//
// ── หน้าที่สำคัญที่สุดของไฟล์นี้: assertOwnedBrokerId() ────────────────────────
// brokerId ที่มาจาก Request Body เป็น Input ที่ผู้ใช้กำหนดเองได้ 100% —
// FK ระดับ DB ตรวจได้แค่ "broker แถวนี้มีอยู่จริง" ไม่ได้ตรวจ "เป็นของใคร"
// ถ้าเขียน UPDATE assets SET broker_id = <body> ตรงๆ ผู้ใช้ A จะผูกสินทรัพย์
// ตัวเองเข้ากับโบรกของผู้ใช้ B ได้ทันที (Design Doc § 6.3)

class BrokerServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrokerServiceError';
    this.code = code;
    this.details = details;
  }
}

// ต้องตรงกับ CHECK constraint ใน migration 042 (char_length(name) <= 60)
// เลขนี้อยู่ 2 ที่โดยเจตนา: ที่นี่เพื่อบอกผู้ใช้เป็นภาษาไทยก่อนยิง DB / ที่ DB
// เพื่อเป็นด่านสุดท้ายที่ Path อื่นในอนาคตข้ามไม่ได้
const BROKER_NAME_MAX_LENGTH = 60;

// ═══════════════════════════════════════════════════════════════════════════
// normalizeBrokerName — จุดตัดสิน "ชื่อโบรกสองอันนี้คืออันเดียวกันไหม" ที่เดียว
// ═══════════════════════════════════════════════════════════════════════════
// Founder ตัดสิน (23 ส.ค. 2569): ให้ผู้ใช้พิมพ์ชื่อเอง แต่ต้อง Normalize ก่อน
// เก็บ/จัดกลุ่ม (trim + เทียบแบบไม่สนตัวพิมพ์) เพื่อไม่ให้ "Bitkub"/"bitkub"/
// "BITKUB" กลายเป็น 3 กลุ่มบนกราฟโดนัท
//
// คืน { display, key }:
//   display = ชื่อที่จะ "เก็บและแสดง" — trim หัวท้าย + ยุบช่องว่างซ้อนกันเหลือ
//             ช่องเดียว แต่ "คงตัวพิมพ์ตามที่ผู้ใช้ตั้งใจ" ("InnovestX" ต้องแสดง
//             เป็น "InnovestX" ไม่ใช่ "innovestx" — การบังคับ Title Case จะทำให้
//             ชื่อแบรนด์ที่มีตัวพิมพ์ใหญ่กลางคำเพี้ยนหมด)
//   key     = ชื่อที่ใช้ "เทียบ/จัดกลุ่ม" เท่านั้น (display.toLowerCase())
//             ห้ามเอา key ไปแสดงผลให้ผู้ใช้เห็นเด็ดขาด
//
// คืน null ถ้า Input ใช้ไม่ได้ (ไม่ใช่ String / ว่างหลัง trim / ยาวเกินเพดาน)
// — Caller ต้องแปลงเป็น VALIDATION_ERROR ห้าม Silent Default เป็นค่าอะไรก็ตาม
function normalizeBrokerName(raw) {
  if (typeof raw !== 'string') return null;

  // \s ครอบ Tab/Newline/NBSP ที่ติดมากับการ Copy-paste จากหน้าเว็บโบรกด้วย
  const display = raw.trim().replace(/\s+/g, ' ');

  if (display === '') return null;
  if (display.length > BROKER_NAME_MAX_LENGTH) return null;

  return { display, key: display.toLowerCase() };
}

// GET — โบรกทั้งหมดของผู้ใช้ (เรียงตามชื่อ)
async function listBrokers(userId) {
  return brokerRepository.findAllByUser(userId);
}

// POST — สร้างโบรกใหม่
//
// ⚠️ ตรวจชื่อซ้ำแบบไม่สนตัวพิมพ์ "ในชั้นนี้ด้วย" ทั้งที่ DB มี Unique Index
// อยู่แล้ว — ไม่ใช่ความซ้ำซ้อนที่ไร้ประโยชน์: ชั้นนี้ทำให้ตอบผู้ใช้ได้ว่า
// "คุณมีโบรกชื่อนี้อยู่แล้วในชื่อว่า X" (บอกชื่อเดิมที่สะกดต่างกันให้เห็นเลย)
// ส่วน Unique Index เป็นด่านที่ Race Condition ข้ามไม่ได้ (สอง Request ที่ส่ง
// "bitkub"/"Bitkub" พร้อมกันจะอ่านผลว่า "ยังไม่มี" ทั้งคู่แล้วผ่านทั้งคู่ ถ้ามี
// แค่ชั้นนี้ชั้นเดียว — บทเรียนเดียวกับ assetLimitRace / migration 035)
async function createBroker(userId, rawName) {
  const normalized = normalizeBrokerName(rawName);
  if (!normalized) {
    throw new BrokerServiceError('VALIDATION_ERROR', 'invalid broker name', {
      field: 'name',
      maxLength: BROKER_NAME_MAX_LENGTH,
    });
  }

  const existing = await findByKey(userId, normalized.key);
  if (existing) {
    throw new BrokerServiceError('BROKER_NAME_EXISTS', 'broker name already exists', {
      existingName: existing.name,
      existingId: existing.id,
    });
  }

  try {
    return await brokerRepository.create(userId, normalized.display);
  } catch (err) {
    throw toServiceError(err);
  }
}

// PATCH — เปลี่ยนชื่อโบรก
async function renameBroker(userId, brokerId, rawName) {
  const normalized = normalizeBrokerName(rawName);
  if (!normalized) {
    throw new BrokerServiceError('VALIDATION_ERROR', 'invalid broker name', {
      field: 'name',
      maxLength: BROKER_NAME_MAX_LENGTH,
    });
  }

  // ต้องยืนยันความเป็นเจ้าของก่อนเสมอ — ถ้าไม่เจอ = 404 (ไม่ใช่ 403) เพื่อไม่
  // ยืนยันการมีอยู่ของ resource ของผู้ใช้คนอื่น
  const current = await brokerRepository.findByIdForUser(brokerId, userId);
  if (!current) {
    throw new BrokerServiceError('BROKER_NOT_FOUND', 'broker not found', { brokerId });
  }

  // เปลี่ยนแค่ตัวพิมพ์ของชื่อตัวเอง (เช่น "bitkub" → "Bitkub") ต้องทำได้ ไม่ใช่
  // เด้ง BROKER_NAME_EXISTS ใส่ตัวเอง — จึงเทียบ key แล้วยกเว้น "แถวของตัวเอง"
  const clash = await findByKey(userId, normalized.key);
  if (clash && clash.id !== brokerId) {
    throw new BrokerServiceError('BROKER_NAME_EXISTS', 'broker name already exists', {
      existingName: clash.name,
      existingId: clash.id,
    });
  }

  try {
    const updated = await brokerRepository.updateName(brokerId, userId, normalized.display);
    if (!updated) {
      throw new BrokerServiceError('BROKER_NOT_FOUND', 'broker not found', { brokerId });
    }
    return updated;
  } catch (err) {
    throw toServiceError(err);
  }
}

// DELETE — ลบโบรก (สินทรัพย์ที่ผูกอยู่กลับเป็น "ไม่ระบุ" ด้วย FK ON DELETE SET NULL
// ไม่มีสินทรัพย์หรือธุรกรรมใดถูกลบตามแม้แถวเดียว — ดู migration 042)
async function deleteBroker(userId, brokerId) {
  const deleted = await brokerRepository.deleteByIdForUser(brokerId, userId);
  if (deleted === 0) {
    throw new BrokerServiceError('BROKER_NOT_FOUND', 'broker not found', { brokerId });
  }
  return { id: brokerId };
}

// ═══════════════════════════════════════════════════════════════════════════
// assertOwnedBrokerId — ด่านบังคับก่อน "เอา brokerId จาก Body ไปใช้" ทุกครั้ง
// ═══════════════════════════════════════════════════════════════════════════
// ── ผู้เรียกจริง ณ ตอนนี้ (ตรวจซ้ำได้ด้วย grep — คอมเมนต์ต้องไม่โกหก) ────────
//   assets.service.updateAssetMeta      → PATCH /assets/{id} (brokerId ใน Body)
//   transactions.controller             → POST /transactions (brokerId ใน Body)
//   dashboard.controller.getProfit      → GET /dashboard/profit/{symbol}?brokerId
//   webhook.controller.decodePickedBrokerId → LINE Postback ปุ่มเลือกโบรก
// ⚠️ เพิ่มจุดที่รับ brokerId จากผู้ใช้เมื่อไหร่ **ต้องมาต่อรายการนี้ด้วย**
// (Audit 27 ส.ค. 2569 พบว่ารายการเดิมเขียนไว้แค่ "assets PATCH" ทั้งที่มี 4 จุดแล้ว)
//
// รับ null/undefined ได้ (= "ล้างค่าโบรก" หรือ "ไม่ได้ส่งมา") → คืน null ทันที
// โดยไม่ยิง Query — แต่ค่าอื่นที่ไม่ใช่ String ต้องเป็น VALIDATION_ERROR ห้าม
// ตีความเป็น null เงียบๆ (ห้าม Silent Default)
async function assertOwnedBrokerId(userId, brokerId) {
  if (brokerId === null || brokerId === undefined) return null;

  if (typeof brokerId !== 'string' || brokerId.trim() === '') {
    throw new BrokerServiceError('VALIDATION_ERROR', 'invalid brokerId', { field: 'brokerId' });
  }

  const broker = await brokerRepository.findByIdForUser(brokerId, userId);
  if (!broker) {
    // 404 ไม่ใช่ 403 โดยเจตนา — ตอบ 403 เท่ากับบอกผู้โจมตีว่า "id นี้มีอยู่จริง
    // แต่เป็นของคนอื่น" ซึ่งเป็นการยืนยันการมีอยู่ของข้อมูลผู้ใช้รายอื่น
    throw new BrokerServiceError('BROKER_NOT_FOUND', 'broker not found', { brokerId });
  }

  return broker.id;
}

// ── ภายใน ────────────────────────────────────────────────────────────────
// หาโบรกของ user ที่ key ตรงกัน — ใช้ normalizeBrokerName ตัวเดียวกับตอนเขียน
// เป๊ะ จึงไม่มีทางที่ "กฎตอนเทียบ" กับ "กฎตอนเก็บ" จะเพี้ยนจากกันได้
async function findByKey(userId, key) {
  const brokers = await brokerRepository.findAllByUser(userId);
  return brokers.find((b) => normalizeBrokerName(b.name)?.key === key) ?? null;
}

// BrokerWriteError (ชั้น Repository) → BrokerServiceError (ชั้นโดเมนนี้)
// Error อื่นปล่อยผ่านตามเดิม = ระบบพังจริง ต้องกลายเป็น 500 ไม่ใช่ถูกกลบ
function toServiceError(err) {
  if (err instanceof BrokerServiceError) return err;
  if (err instanceof brokerRepository.BrokerWriteError) {
    if (err.code === 'BROKER_NAME_EXISTS') {
      return new BrokerServiceError('BROKER_NAME_EXISTS', err.message, err.details);
    }
    if (err.code === 'INVALID_BROKER_NAME') {
      return new BrokerServiceError('VALIDATION_ERROR', err.message, { field: 'name' });
    }
  }
  return err;
}

module.exports = {
  BrokerServiceError,
  BROKER_NAME_MAX_LENGTH,
  normalizeBrokerName,
  listBrokers,
  createBroker,
  renameBroker,
  deleteBroker,
  assertOwnedBrokerId,
};
