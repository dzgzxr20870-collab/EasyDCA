const symbolRegistry = require('../services/symbolRegistry.service');
const assetsService = require('../services/assets.service');
const brokerService = require('../services/broker.service');
const portfoliosService = require('../services/portfolios.service');

// ═══════════════════════════════════════════════════════════════════════════
// assets.controller — /api/v1/assets
// ═══════════════════════════════════════════════════════════════════════════
// Stage 8 (Design Doc § 4.4) เพิ่ม 2 Endpoint ต่อจาก /symbols เดิม:
//   GET   /api/v1/assets       — List + filter ตาม brokerId / sector / portfolioId
//   PATCH /api/v1/assets/{id}  — แก้ brokerId / sector / portfolioId
//
// ⚠️ userId มาจาก req.user.id (JWT) เท่านั้นเสมอ ห้ามรับจาก Body/Query

const WEB_ERROR_MESSAGES = {
  VALIDATION_ERROR: `ข้อมูลไม่ถูกต้อง — sector ต้องไม่เว้นว่างและยาวไม่เกิน ${assetsService.SECTOR_MAX_LENGTH} ตัวอักษร และสินทรัพย์ต้องสังกัดพอร์ตเสมอ`,
  ASSET_NOT_FOUND: 'ไม่พบสินทรัพย์ที่ต้องการ (อาจถูกลบไปแล้ว)',
  // ชน UNIQUE ของ migration 046 — ห้ามรวมสองแถวให้อัตโนมัติ (กระทบต้นทุนเฉลี่ย)
  ASSET_ALREADY_EXISTS:
    'มีสินทรัพย์ตัวนี้ที่โบรก/พอร์ตปลายทางอยู่แล้ว — การรวมสองรายการเข้าด้วยกันกระทบต้นทุนเฉลี่ย ระบบจึงไม่ทำให้อัตโนมัติ',
  BROKER_NOT_FOUND: 'ไม่พบโบรก/Exchange ที่เลือก (อาจถูกลบไปแล้ว)',
  PORTFOLIO_NOT_FOUND: 'ไม่พบพอร์ตที่เลือก (อาจถูกลบไปแล้ว)',
  // ⚠️ ต้องบอกทางออกที่ยังทำได้จริงให้ครบ (ดูเหตุผลเต็มใน portfolios.controller)
  PORTFOLIO_READ_ONLY:
    'พอร์ตปลายทางเพิ่มรายการใหม่ไม่ได้ เพราะแพ็กเกจ Premium หมดอายุแล้ว — แต่ยังย้ายสินทรัพย์ "ออก" ไปพอร์ตหลัก และบันทึกการขายได้ตามปกติ ข้อมูลเดิมอยู่ครบทุกรายการ',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  ASSET_NOT_FOUND: 404,
  BROKER_NOT_FOUND: 404,
  PORTFOLIO_NOT_FOUND: 404,
  PORTFOLIO_READ_ONLY: 403,
  ASSET_ALREADY_EXISTS: 409,
};

// Validate ก่อน Query กัน id ผิดรูปทำให้ Postgres throw 22P02 แล้วตกไป 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res, code, details = {}) {
  const status = ERROR_STATUS[code] ?? 500;
  return res.status(status).json({
    error: code,
    message: WEB_ERROR_MESSAGES[code] ?? WEB_ERROR_MESSAGES.INTERNAL_ERROR,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  });
}

// ไม่ส่ง userId ออกไป (Pattern เดียวกับ toPublicBroker/toPublicPortfolio)
function toPublicAsset(a) {
  return {
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    type: a.type,
    brokerId: a.brokerId ?? null,
    sector: a.sector ?? null,
    portfolioId: a.portfolioId ?? null,
    isActive: a.isActive,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function failFromServiceError(res, err, context) {
  // ทั้ง 3 Service โยน Error คนละ Class แต่ใช้ code ชุดเดียวกันที่ ERROR_STATUS
  // รู้จัก — เทียบด้วย code ไม่ใช่ instanceof เพื่อไม่ต้อง import Error Class
  // ของทุก Service เข้ามาเช็คทีละอัน
  if (err?.code && ERROR_STATUS[err.code] !== undefined) {
    return fail(res, err.code, err.details ?? {});
  }
  if (
    err instanceof assetsService.AssetServiceError ||
    err instanceof brokerService.BrokerServiceError ||
    err instanceof portfoliosService.PortfolioServiceError
  ) {
    return fail(res, 'VALIDATION_ERROR', err.details ?? {});
  }
  console.error(`[assets] ${context} unexpected error: ${err.message}`);
  return fail(res, 'INTERNAL_ERROR');
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/assets — สินทรัพย์ที่ถืออยู่ + filter (Free)
// ═══════════════════════════════════════════════════════════════════════════
// Query: ?brokerId=<uuid|none>&sector=<ชื่อ|none>&portfolioId=<uuid|none>
// 'none' = "แถวที่ไม่ได้ระบุค่ามิตินั้น" (NULL) — ต่างจากไม่ส่ง Key มาเลยที่แปลว่า
// "ไม่กรองมิตินี้" (Pattern เดียวกับ brokerId ของ GET /dashboard/profit)
async function listAssets(req, res) {
  const q = req.query ?? {};

  for (const key of ['brokerId', 'portfolioId']) {
    const v = q[key];
    if (v !== undefined && v !== 'none' && !UUID_RE.test(v)) {
      return fail(res, 'VALIDATION_ERROR', { field: key });
    }
  }

  try {
    const assets = await assetsService.listAssets(req.user.id, {
      ...(q.brokerId !== undefined ? { brokerId: q.brokerId } : {}),
      ...(q.sector !== undefined ? { sector: q.sector } : {}),
      ...(q.portfolioId !== undefined ? { portfolioId: q.portfolioId } : {}),
    });
    return res.status(200).json({ assets: assets.map(toPublicAsset) });
  } catch (err) {
    return failFromServiceError(res, err, 'listAssets');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/v1/assets/{id} — แก้ป้ายกำกับ (brokerId / sector / portfolioId)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ไม่รับ symbol / type / isActive เด็ดขาด (ดูเหตุผลใน assets.service) —
// Key พวกนั้นถูกเพิกเฉยเงียบๆ ไม่ได้ ต้องตอบ VALIDATION_ERROR ให้ผู้ใช้รู้ว่า
// สิ่งที่ส่งมาไม่ถูกบันทึก (Silent Ignore เป็น Anti-pattern แบบเดียวกับ Silent Default)
const PATCHABLE_FIELDS = ['brokerId', 'sector', 'portfolioId'];

async function updateAsset(req, res) {
  if (!UUID_RE.test(req.params.id ?? '')) {
    return fail(res, 'ASSET_NOT_FOUND', { assetId: req.params.id });
  }

  const body = req.body ?? {};

  const unknown = Object.keys(body).filter((k) => !PATCHABLE_FIELDS.includes(k));
  if (unknown.length > 0) {
    return fail(res, 'VALIDATION_ERROR', { unsupportedFields: unknown, allowed: PATCHABLE_FIELDS });
  }

  try {
    const asset = await assetsService.updateAssetMeta(
      req.user.id,
      req.params.id,
      body,
      req.userRecord
    );
    return res.status(200).json({ asset: toPublicAsset(asset) });
  } catch (err) {
    return failFromServiceError(res, err, 'updateAsset');
  }
}


// GET /api/v1/assets/symbols — รายการสินทรัพย์ทั้งหมดที่ระบบรองรับ สำหรับ Dropdown
// ค้นหาบนเว็บ
//
// Reuse symbolRegistry.listSymbols ตรงๆ — "ระบบรองรับ Symbol ใด" ตัดสินที่ Registry
// ที่เดียวเหมือนทุกจุดของระบบ (LINE/Bulk Import/OCR) จึงไม่มีทางที่ Dropdown จะโชว์
// สินทรัพย์ที่บันทึกจริงไม่ได้
//
// ข้อมูล Static (Hardcode ในโค้ด ไม่ได้มาจาก DB) — ไม่แตะฐานข้อมูลเลย และไม่มี
// ข้อมูลส่วนบุคคลใดๆ ผูกกับ User แต่ยัง Gate ด้วย requireAuth + requireConsent
// ตาม Pattern ของ dashboard.routes (Route ฝั่งเว็บทั้งหมดอยู่หลัง Login เสมอ)
function getSymbols(req, res) {
  try {
    const symbols = symbolRegistry.listSymbols();

    // Cache ที่ Browser 1 ชม. — private เพราะอยู่หลัง Authorization Header
    // (ห้าม public: Shared Cache/CDN ไม่ควรเก็บ Response ของ Route ที่ต้อง Login
    // แม้เนื้อหาจะเหมือนกันทุก User ก็ตาม — กันพลาดเชิงนโยบายไว้ก่อน)
    res.set('Cache-Control', 'private, max-age=3600');

    return res.status(200).json({ symbols });
  } catch (err) {
    console.error(`[assets] getSymbols failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { getSymbols, listAssets, updateAsset };
