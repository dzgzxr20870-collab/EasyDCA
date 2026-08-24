const portfoliosService = require('../services/portfolios.service');
const allocationService = require('../services/allocation.service');

// ═══════════════════════════════════════════════════════════════════════════
// portfolios.controller — /api/v1/portfolios (Stage 8)
// ═══════════════════════════════════════════════════════════════════════════
// Spec: docs/API.md § 14.2 · Design Doc § 4.1
//
// ⚠️ userId มาจาก req.user.id (JWT ที่ requireAuth Verify แล้ว) เท่านั้นเสมอ
// ห้ามรับ userId จาก Body/Query แม้แต่จุดเดียว
//
// ⚠️ **GET เป็น Free ไม่ใช่ Premium** (แก้ Spec เดิมของ § 14.2) — หลัง migration
// 044 ผู้ใช้ทุกคนรวม Free มีพอร์ต Default แล้ว ถ้า GET คืน 403 หน้า Dashboard
// ของ Free จะพังตั้งแต่โหลดหน้าแรก · ตัวคุมสิทธิ์จริงคือ POST
//
// Error Response Shape เหมือน brokers/dcaPlans/transactions.controller:
// { error: CODE, message: ไทย, details? }

const WEB_ERROR_MESSAGES = {
  VALIDATION_ERROR: `ข้อมูลพอร์ตไม่ถูกต้อง — ชื่อต้องไม่เว้นว่างและยาวไม่เกิน ${portfoliosService.PORTFOLIO_NAME_MAX_LENGTH} ตัวอักษร และประเภทต้องเป็นค่าที่ระบบรองรับ`,
  PORTFOLIO_NOT_FOUND: 'ไม่พบพอร์ตที่ต้องการ (อาจถูกลบไปแล้ว)',
  PORTFOLIO_LIMIT_REACHED:
    'แพ็กเกจ Free ใช้ได้ 1 พอร์ต หากต้องการแยกพอร์ตหลายอัน กรุณาอัปเกรดเป็น Premium',
  PORTFOLIO_CAP_REACHED:
    'จำนวนพอร์ตถึงขีดจำกัดของระบบแล้ว (50 พอร์ต) กรุณาลบพอร์ตที่ไม่ได้ใช้ก่อนสร้างใหม่',
  // Premium หมดอายุแต่มีพอร์ตเกินโควตา — ข้อมูลยังอยู่ครบ ไม่ได้ถูกลบ
  PORTFOLIO_READ_ONLY:
    'พอร์ตนี้อยู่ในโหมดอ่านอย่างเดียว เพราะแพ็กเกจ Premium หมดอายุแล้ว ข้อมูลเดิมยังอยู่ครบทุกรายการ — ต่ออายุแล้วกลับมาบันทึกเพิ่มได้ทันที',
  CANNOT_DELETE_DEFAULT_PORTFOLIO:
    'ลบพอร์ตเริ่มต้นไม่ได้ เพราะทุกสินทรัพย์ต้องมีพอร์ตสังกัดเสมอ (เปลี่ยนชื่อพอร์ตแทนได้)',
  PORTFOLIO_HAS_CONFLICTING_ASSETS:
    'ลบพอร์ตนี้ไม่ได้ เพราะมีสินทรัพย์ที่ซ้ำกับพอร์ตเริ่มต้น (สินทรัพย์เดียวกันที่โบรกเดียวกัน) การรวมสองรายการเข้าด้วยกันกระทบต้นทุนเฉลี่ย ระบบจึงไม่ทำให้อัตโนมัติ — กรุณาย้าย/จัดการรายการที่ซ้ำก่อน',
  DEFAULT_PORTFOLIO_MISSING: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
  DEFAULT_PORTFOLIO_CONFLICT: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
};

// groupBy ที่ไม่รองรับ ใช้ข้อความของตัวเองเพราะ VALIDATION_ERROR กลางพูดถึงชื่อ/ประเภทพอร์ต
const ALLOCATION_VALIDATION_MESSAGE = `groupBy ต้องเป็นค่าใดค่าหนึ่งใน: ${allocationService.GROUP_BY_OPTIONS.join(' / ')}`;

const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  PORTFOLIO_NOT_FOUND: 404,
  // 403 = "แพ็กเกจไม่ให้ทำ" ต่างจาก 409 ที่เป็น "ขัดกับสถานะข้อมูลปัจจุบัน"
  PORTFOLIO_LIMIT_REACHED: 403,
  PORTFOLIO_READ_ONLY: 403,
  PORTFOLIO_CAP_REACHED: 409,
  CANNOT_DELETE_DEFAULT_PORTFOLIO: 409,
  PORTFOLIO_HAS_CONFLICTING_ASSETS: 409,
  // Invariant ของ DB พัง = ระบบผิด ไม่ใช่ผู้ใช้ผิด
  DEFAULT_PORTFOLIO_MISSING: 500,
  DEFAULT_PORTFOLIO_CONFLICT: 500,
};

// Validate ก่อน Query กัน id ผิดรูปทำให้ Postgres throw 22P02 แล้วตกไป 500
// ทั้งที่ความหมายจริงคือ "ไม่พบพอร์ต" (404) — Pattern เดียวกับ brokers.controller
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
  if (err instanceof portfoliosService.PortfolioServiceError) {
    return fail(res, err.code, err.details ?? {});
  }
  console.error(`[portfolios] ${context} unexpected error: ${err.message}`);
  return fail(res, 'INTERNAL_ERROR');
}

// ไม่ส่ง userId ออกไป (Client รู้อยู่แล้วว่าเป็นของตัวเอง การส่งกลับมีแต่จะเพิ่ม
// พื้นที่รั่ว) — Pattern เดียวกับ toPublicBroker
function toPublicPortfolio(p) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    isDefault: p.isDefault,
    // ⭐ canWrite = "บันทึกสินทรัพย์/รายการใหม่เข้าพอร์ตนี้ได้ไหม ณ ตอนนี้"
    // Frontend ต้องใช้ธงนี้ตัดสินว่าจะ Disable ปุ่มบันทึกไหม — ห้ามเดาเองจาก
    // plan เพราะกติกา "พอร์ตแรกสุดยังเขียนได้" อยู่ที่ Backend ที่เดียว
    ...(p.canWrite === undefined ? {} : { canWrite: p.canWrite }),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// GET /api/v1/portfolios — Free (ทุกคนมีพอร์ต Default อย่างน้อย 1 อัน)
async function listPortfolios(req, res) {
  try {
    const portfolios = await portfoliosService.listPortfolios(req.user.id, req.userRecord);
    return res.status(200).json({ portfolios: portfolios.map(toPublicPortfolio) });
  } catch (err) {
    return failFromServiceError(res, err, 'listPortfolios');
  }
}

// GET /api/v1/portfolios/:id — Free
async function getPortfolio(req, res) {
  if (!UUID_RE.test(req.params.id ?? '')) {
    return fail(res, 'PORTFOLIO_NOT_FOUND', { portfolioId: req.params.id });
  }

  try {
    const portfolio = await portfoliosService.getPortfolio(
      req.user.id,
      req.params.id,
      req.userRecord
    );
    return res.status(200).json({ portfolio: toPublicPortfolio(portfolio) });
  } catch (err) {
    return failFromServiceError(res, err, 'getPortfolio');
  }
}

// POST /api/v1/portfolios — Premium (ตัวคุมสิทธิ์จริงของ Multi-portfolio)
async function createPortfolio(req, res) {
  const body = req.body ?? {};

  try {
    const portfolio = await portfoliosService.createPortfolio(
      req.user.id,
      { name: body.name, type: body.type },
      req.userRecord
    );
    return res.status(201).json({ portfolio: toPublicPortfolio(portfolio) });
  } catch (err) {
    return failFromServiceError(res, err, 'createPortfolio');
  }
}

// PATCH /api/v1/portfolios/:id — แก้ name / type
async function updatePortfolio(req, res) {
  if (!UUID_RE.test(req.params.id ?? '')) {
    return fail(res, 'PORTFOLIO_NOT_FOUND', { portfolioId: req.params.id });
  }

  const body = req.body ?? {};

  try {
    const portfolio = await portfoliosService.updatePortfolio(
      req.user.id,
      req.params.id,
      { name: body.name, type: body.type },
      req.userRecord
    );
    return res.status(200).json({ portfolio: toPublicPortfolio(portfolio) });
  } catch (err) {
    return failFromServiceError(res, err, 'updatePortfolio');
  }
}

// DELETE /api/v1/portfolios/:id — ลบ "กล่อง" ไม่ใช่ลบสินทรัพย์/ธุรกรรม
// สินทรัพย์ที่อยู่ข้างในถูกย้ายเข้าพอร์ตเริ่มต้น ไม่ได้หายไปไหน
async function deletePortfolio(req, res) {
  if (!UUID_RE.test(req.params.id ?? '')) {
    return fail(res, 'PORTFOLIO_NOT_FOUND', { portfolioId: req.params.id });
  }

  try {
    const result = await portfoliosService.deletePortfolio(
      req.user.id,
      req.params.id,
      req.userRecord
    );
    return res.status(200).json({
      deleted: true,
      movedAssetCount: result.movedAssetCount,
      movedToPortfolioId: result.movedTo,
      message:
        result.movedAssetCount > 0
          ? `ลบพอร์ตแล้ว — ย้ายสินทรัพย์ ${result.movedAssetCount} รายการเข้าพอร์ตเริ่มต้นเรียบร้อย (ประวัติธุรกรรมและต้นทุนไม่เปลี่ยนแปลง)`
          : 'ลบพอร์ตแล้ว',
    });
  } catch (err) {
    return failFromServiceError(res, err, 'deletePortfolio');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/portfolio/allocation — สัดส่วนพอร์ตตามมิติที่เลือก (Free)
// ═══════════════════════════════════════════════════════════════════════════
// Query: ?groupBy=broker|sector|assetType&portfolioId=<uuid>
//
// ⚠️ Free ทั้งหมดโดยเจตนา — นี่คือ "การดูพอร์ตของตัวเอง" ไม่ใช่ฟีเจอร์ Multi-portfolio
// (เหตุผลเดียวกับที่ GET /portfolios เป็น Free)
//
// ⚠️ portfolioId ที่ส่งมาไม่ต้อง assertOwned เพราะ allocation.service กรองจาก
// holdings ที่ getPortfolioSummary คืนมา ซึ่ง Scope ด้วย userId อยู่แล้ว —
// ส่ง portfolioId ของผู้ใช้คนอื่นมาจะได้ผลลัพธ์ว่าง ไม่ใช่ข้อมูลของเขา
// (ยืนยันด้วยเทสต์ใน portfolioAllocation.integration.test.js)
async function getAllocation(req, res) {
  const groupBy = req.query.groupBy ?? 'assetType';
  const rawPortfolioId = req.query.portfolioId;

  if (rawPortfolioId !== undefined && !UUID_RE.test(rawPortfolioId)) {
    return fail(res, 'PORTFOLIO_NOT_FOUND', { portfolioId: rawPortfolioId });
  }

  try {
    const allocation = await allocationService.getAllocation(req.user.id, {
      groupBy,
      portfolioId: rawPortfolioId ?? null,
    });
    return res.status(200).json(allocation);
  } catch (err) {
    if (err instanceof allocationService.AllocationServiceError) {
      return res.status(400).json({
        error: err.code,
        message: ALLOCATION_VALIDATION_MESSAGE,
        ...(err.details && Object.keys(err.details).length > 0 ? { details: err.details } : {}),
      });
    }
    return failFromServiceError(res, err, 'getAllocation');
  }
}

module.exports = {
  getAllocation,
  listPortfolios,
  getPortfolio,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
};
