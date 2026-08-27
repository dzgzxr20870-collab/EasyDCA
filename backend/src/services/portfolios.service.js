const portfolioRepository = require('../repositories/portfolio.repository');
const assetRepository = require('../repositories/asset.repository');
const entitlement = require('./entitlement.service');

// ═══════════════════════════════════════════════════════════════════════════
// portfolios.service — CRUD ของพอร์ต + กติกาสิทธิ์ (Stage 8)
// ═══════════════════════════════════════════════════════════════════════════
// Spec: docs/API.md § 14.2 · Design Doc § 4.1
//
// ⚠️ ชื่อไฟล์เป็น portfolios.service (พหูพจน์) โดยเจตนา เพื่อไม่ให้สับสนกับ
// portfolio.service.js (เอกพจน์) ที่มีอยู่แล้วและทำคนละเรื่องกันสิ้นเชิง —
// ตัวนั้นคือ "สูตรคำนวณมูลค่า/ต้นทุนพอร์ต" (แตะเงิน) ส่วนไฟล์นี้คือ "CRUD ของ
// กล่องจัดหมวด" (ไม่แตะเงินเลย) การรวมสองเรื่องนี้ไว้ไฟล์เดียวจะทำให้ไฟล์ที่
// อยู่ในหมวดเสี่ยงสูงสุด (AI_WORK_POLICY § 4.1) บวมด้วยโค้ดที่ไม่เกี่ยวกับเงิน
//
// ── กติกาสิทธิ์ (มติ Founder 23 ส.ค. 2569 § 8.1 — ห้ามเปลี่ยนเอง) ────────────
//   • Free = 1 พอร์ตเท่านั้น · Premium = Sanity Cap 50
//   • Premium หมดอายุแต่มีหลายพอร์ต = **"อ่านได้ เขียนไม่ได้"** ห้ามลบข้อมูล
//     พอร์ตส่วนเกินเปิดดูย้อนหลังได้ปกติ ต่ออายุแล้วกลับมาเขียนได้ทันที
//   • "พอร์ตไหนคือส่วนเกิน" ต้อง Deterministic — เรียงตาม created_at
//     พอร์ตแรกสุด = ยังเขียนได้ (ดู entitlement.getWritablePortfolioIds)
//
// ── ⚠️ GET เป็น Free ไม่ใช่ Premium ────────────────────────────────────────
// API.md § 14.2 เดิมเขียน GET เป็น Premium ซึ่ง **ผิด** หลัง migration 044:
// ผู้ใช้ทุกคนรวม Free มีพอร์ต Default แล้ว ถ้า GET คืน 403 หน้า Dashboard ของ
// Free จะพังทันทีตั้งแต่โหลดหน้าแรก — ตัวคุมสิทธิ์ที่แท้จริงคือ POST (สร้างพอร์ต
// ที่ 2 ไม่ได้) ไม่ใช่ GET · แก้ Spec ใน API.md แล้วใน Stage 8

class PortfolioServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PortfolioServiceError';
    this.code = code;
    this.details = details;
  }
}

const PORTFOLIO_NAME_MAX_LENGTH = 60;

// ต้องตรงกับ CHECK ของ portfolios.type เป๊ะ (docs/DATABASE.md)
// ⚠️ 'mixed' **ไม่มีจริง** — Design Doc เคยเขียนผิดไว้ และ migration 044 แก้เป็น
// 'custom' แล้ว (ดู CHANGELOG Stage 3) ห้ามเติมกลับเข้ามา
const PORTFOLIO_TYPES = Object.freeze([
  'crypto',
  'stock_th',
  'stock_us',
  'etf',
  'fund',
  'custom',
]);

// Normalize ชื่อพอร์ตแบบเดียวกับโบรก: trim หัวท้าย + ยุบช่องว่างซ้ำ
// (เก็บรูปแบบตัวพิมพ์ตามที่ผู้ใช้พิมพ์ ไม่บังคับเป็นตัวพิมพ์เล็ก — มติ Founder § 8.2)
function normalizeName(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (cleaned === '' || cleaned.length > PORTFOLIO_NAME_MAX_LENGTH) return null;
  return cleaned;
}

function assertValidType(type) {
  if (!PORTFOLIO_TYPES.includes(type)) {
    throw new PortfolioServiceError('VALIDATION_ERROR', `Invalid portfolio type: ${type}`, {
      field: 'type',
      allowed: PORTFOLIO_TYPES,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// listPortfolios — พอร์ตทั้งหมด + ธง canWrite ต่อพอร์ต (Free)
// ═══════════════════════════════════════════════════════════════════════════
// canWrite ถูกคำนวณสดทุกครั้งจาก plan ปัจจุบัน ไม่เก็บลง DB โดยเจตนา —
// ต่ออายุ Premium แล้วต้องกลับมาเขียนได้ "ทันที" โดยไม่ต้องมี Job ไปไล่อัปเดตแถว
// (ถ้าเก็บลง DB จะมีช่วงเวลาที่ข้อมูลไม่ตรงกับสิทธิ์จริง ซึ่งดีบั๊กยากมาก)
async function listPortfolios(userId, userRecord) {
  const portfolios = await portfolioRepository.findAllByUser(userId);
  const writable = entitlement.getWritablePortfolioIds(userRecord, portfolios);

  return portfolios.map((p) => ({ ...p, canWrite: writable.has(p.id) }));
}

// หาพอร์ตเดียว + ธง canWrite — 404 ถ้าไม่ใช่ของ user (ห้ามแยก 403/404 ให้เห็น)
async function getPortfolio(userId, portfolioId, userRecord) {
  const portfolio = await portfolioRepository.findByIdForUser(portfolioId, userId);
  if (!portfolio) {
    throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
      portfolioId,
    });
  }

  const all = await portfolioRepository.findAllByUser(userId);
  const writable = entitlement.getWritablePortfolioIds(userRecord, all);

  return { ...portfolio, canWrite: writable.has(portfolio.id) };
}

// ═══════════════════════════════════════════════════════════════════════════
// assertCanAddToPortfolio — ด่านกลางของ "เพิ่มของใหม่เข้าพอร์ตนี้ได้ไหม"
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ มติ Founder 24 ส.ค. 2569 — "เขียน" ต้องแยกเป็น 2 ชนิด ซึ่ง § 8.1(ก) เดิม
// ไม่ได้แยกไว้ และการไม่แยกทำให้เกิดปัญหาที่ร้ายแรงกว่าที่ Gate ตั้งใจกัน:
//
//   ✅ ด่านนี้บล็อก — "เพิ่มของใหม่" (= ใช้ฟีเจอร์ Multi-portfolio ต่อโดยไม่จ่าย)
//        ซื้อ · เพิ่มสินทรัพย์ · บันทึกปันผล · Bulk Import · ย้ายสินทรัพย์ **เข้า**
//
//   ❌ ด่านนี้ **ต้องไม่แตะ** — "ลดของเดิม / แก้ให้ตรงความจริง"
//        ขาย · ย้อนรายการล่าสุด (Undo) · ย้ายสินทรัพย์ **ออก** ไปพอร์ตหลัก
//
// ── ทำไมการขาย/Undo ต้องทำได้เสมอ (สำคัญกว่าที่คิด) ─────────────────────────
// ผู้ใช้ขายหุ้นจริงไปแล้วในโลกจริง ถ้าบันทึกไม่ได้ **พอร์ตจะโชว์ตัวเลขผิดถาวร**
// ("ยังถือ BTC 0.5 อยู่" ทั้งที่ขายไปแล้ว) → กำไร/ขาดทุนที่เขาเห็นผิดตลอดไป
// ซึ่งขัดกับจุดยืนทั้งหมดของผลิตภัณฑ์ (บันทึกให้ตรงความจริง) และเท่ากับ
// "เอาข้อมูลผู้ใช้เป็นตัวประกันค่าสมาชิก" ซึ่งอยู่คนละเรื่องกับการจำกัดฟีเจอร์
//
//   **การล็อกต้องหมายถึง "โตต่อไม่ได้" ไม่ใช่ "ออกไม่ได้"**
//
// ── กฎการเลือกพอร์ตที่ตรวจ: ตรวจ "ปลายทางของของใหม่" เสมอ ──────────────────
// ไม่ใช่ตรวจพอร์ตต้นทาง — กฎข้อเดียวนี้ให้ผลถูกทุกเคสพร้อมกัน:
//   ย้ายออกไปพอร์ตหลัก → ปลายทาง = พอร์ตหลัก (เขียนได้) → ✅ ผ่าน
//   ย้ายเข้าพอร์ตส่วนเกิน → ปลายทาง = พอร์ตส่วนเกิน       → ❌ บล็อก
//   ซื้อเข้าพอร์ตส่วนเกิน → ปลายทาง = พอร์ตส่วนเกิน       → ❌ บล็อก
//
// portfolioId = null/undefined → คืน null โดยไม่ยิง Query เลย (ไม่ระบุพอร์ต =
// ไม่มีอะไรให้ตรวจ) — ทำให้เส้นทางของผู้ใช้ Free ซึ่งไม่เคยส่ง portfolioId มา
// **ไม่มี Query เพิ่มแม้แต่ครั้งเดียว** (กฎยืนข้อ 10 — ห้ามเพิ่ม Latency บน
// Live Path โดยไม่จำเป็น · ผู้ใช้ Free คือคนส่วนใหญ่ของระบบวันนี้)
//
// ⚠️ ทำสองหน้าที่พร้อมกันโดยเจตนา: (1) ยืนยันความเป็นเจ้าของ (2) ตรวจสิทธิ์เขียน
// เพราะถ้าแยกกัน Caller มีโอกาสเรียกแค่ข้อใดข้อหนึ่งแล้วคิดว่าครบ
//
// ── ผู้เรียกจริง ณ ตอนนี้ (ตรวจซ้ำได้ด้วย grep — คอมเมนต์ต้องไม่โกหก) ────────
//   transaction.service.validateBuy   → ครอบ ซื้อ ทุกช่องทางในจุดเดียว
//                                        (เว็บ → processBuyCommand → validateBuy ·
//                                         LINE → createPending/confirmPending → validateBuy ·
//                                         Bulk Import → validateBuy ต่อรายการ)
//   dividend.service.recordDividend   → ปันผล (แยก Endpoint ตาม Design Doc § 4.5)
//   assets.service.updateAssetMeta    → ย้ายสินทรัพย์ (ตรวจปลายทาง)
//   portfolios.service (ในไฟล์นี้เอง)  → update/delete พอร์ต
//
// ⚠️ **ไม่ได้ถูกเรียกจาก validateSell / undoTransaction โดยเจตนา** — สองทางนั้น
// คือ "ลดของเดิม/แก้ให้ตรงความจริง" ที่ต้องทำได้เสมอ (ดูตารางด้านบน)
// ถ้ามีใครเผลอเพิ่มด่านเข้าไป เทสต์ใน portfolioWriteGate.regression.test.js จะแดง
async function assertCanAddToPortfolio(userId, portfolioId, userRecord) {
  if (portfolioId === null || portfolioId === undefined) return null;

  const portfolio = await portfolioRepository.findByIdForUser(portfolioId, userId);
  if (!portfolio) {
    throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
      portfolioId,
    });
  }

  const all = await portfolioRepository.findAllByUser(userId);
  const writable = entitlement.getWritablePortfolioIds(userRecord, all);

  if (!writable.has(portfolio.id)) {
    throw new PortfolioServiceError(
      'PORTFOLIO_READ_ONLY',
      `Portfolio ${portfolioId} is read-only under the current plan`,
      {
        portfolioId,
        limit: entitlement.getActivePortfolioLimit(userRecord),
      }
    );
  }

  return portfolio;
}

// ═══════════════════════════════════════════════════════════════════════════
// assertOwnedPortfolioId — ด่านบังคับก่อน "เอา portfolioId จาก Input ไปใช้"
// ═══════════════════════════════════════════════════════════════════════════
// คู่แฝดของ broker.service.assertOwnedBrokerId เป๊ะ (กฎยืนข้อ 4: id ทุกตัวจาก
// Request ต้องยืนยันเจ้าของก่อนใช้) — ใช้กับ portfolioId ที่มาจาก **LINE Postback**
// ซึ่งเป็นค่าจากฝั่ง Client 100% แม้ปุ่มจะถูกสร้างโดยระบบเองก็ตาม
//
// ⚠️ ต่างจาก assertCanAddToPortfolio ตรงที่ **ไม่ตรวจสิทธิ์เขียน** — เพราะการ
// "ขาย" ของพอร์ตที่ถูกล็อกต้องทำได้เสมอ (มติ Founder 24 ส.ค. 2569) ด่านเขียนจริง
// ยังอยู่ที่ validateBuy → assertCanAddToPortfolio ตามเดิม ที่นี่ยืนยันแค่ความเป็น
// เจ้าของอย่างเดียว
//
// null/undefined → คืน null ทันทีโดยไม่ยิง Query (= "ไม่ระบุพอร์ต" ซึ่งเป็นคำตอบ
// ที่ถูกต้องพอๆ กับพอร์ตจริง สำหรับแถวที่ portfolio_id IS NULL ในโลกก่อน 044)
async function assertOwnedPortfolioId(userId, portfolioId) {
  if (portfolioId === null || portfolioId === undefined) return null;

  if (typeof portfolioId !== 'string' || portfolioId.trim() === '') {
    throw new PortfolioServiceError('VALIDATION_ERROR', 'invalid portfolioId', {
      field: 'portfolioId',
    });
  }

  const portfolio = await portfolioRepository.findByIdForUser(portfolioId, userId);
  if (!portfolio) {
    // 404 ไม่ใช่ 403 โดยเจตนา — ตอบ 403 เท่ากับยืนยันให้ผู้โจมตีรู้ว่า id นี้
    // มีอยู่จริงแต่เป็นของคนอื่น (เหตุผลเดียวกับ assertOwnedBrokerId)
    throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
      portfolioId,
    });
  }

  return portfolio.id;
}

// ═══════════════════════════════════════════════════════════════════════════
// createPortfolio — Premium เท่านั้น (ตัวคุมสิทธิ์จริงของ Multi-portfolio)
// ═══════════════════════════════════════════════════════════════════════════
// Free มีพอร์ต Default อยู่แล้ว 1 อันจาก Backfill → นับได้ 1 ซึ่งชนเพดานพอดี
// จึงถูกปฏิเสธที่นี่เสมอโดยไม่ต้องมี Branch "ถ้าเป็น Free" แยกต่างหาก
async function createPortfolio(userId, params, userRecord) {
  const name = normalizeName(params.name);
  if (name === null) {
    throw new PortfolioServiceError('VALIDATION_ERROR', 'Invalid portfolio name', {
      field: 'name',
      maxLength: PORTFOLIO_NAME_MAX_LENGTH,
    });
  }
  assertValidType(params.type);

  const limit = entitlement.getActivePortfolioLimit(userRecord);
  const current = await portfolioRepository.countByUser(userId);

  if (current >= limit) {
    // แยก Error Code ตามสาเหตุจริง เพื่อให้ข้อความที่ผู้ใช้เห็นตรงกับสิ่งที่ทำได้:
    // Free ต้องเห็น "อัปเกรดสิ" ส่วน Premium ที่ชน Cap 50 ต้องเห็น "เยอะเกินไปแล้ว"
    // (ถ้าใช้ Code เดียวกัน Premium จะโดนชวนอัปเกรดทั้งที่จ่ายเงินอยู่แล้ว)
    const isPremium = entitlement.isPremiumActive(userRecord);
    throw new PortfolioServiceError(
      isPremium ? 'PORTFOLIO_CAP_REACHED' : 'PORTFOLIO_LIMIT_REACHED',
      `Portfolio limit reached (${current}/${limit})`,
      { limit, current }
    );
  }

  try {
    // ⚠️ ส่ง limit ลงไปให้ RPC ตัดสินซ้ำใต้ Lock — Pre-check ด้านบนตอบผู้ใช้ได้เร็ว
    // และแยกข้อความ Free/Premium ได้ ส่วน **ด่านจริงที่ Race Condition ข้ามไม่ได้
    // อยู่ใน create_portfolio_locked** (migration 048) ความสัมพันธ์เดียวกับ
    // validateBuy ↔ create_asset_locked ทุกประการ
    return await portfolioRepository.create(userId, {
      name,
      type: params.type,
      portfolioLimit: limit,
    });
  } catch (err) {
    if (err instanceof portfolioRepository.PortfolioWriteError) {
      // ⚠️ RPC รู้แค่ว่า "ชนเพดาน" ไม่รู้ว่าเป็น Free หรือ Premium — การแยก
      // Error Code ต้องทำที่นี่เหมือน Pre-check ด้านบนเป๊ะ ไม่งั้น Premium ที่
      // จ่ายเงินอยู่แล้วจะโดนชวนอัปเกรดเมื่อชน Sanity Cap 50 (ผ่านเส้นทาง Race)
      if (err.code === 'PORTFOLIO_LIMIT_REACHED') {
        const isPremium = entitlement.isPremiumActive(userRecord);
        throw new PortfolioServiceError(
          isPremium ? 'PORTFOLIO_CAP_REACHED' : 'PORTFOLIO_LIMIT_REACHED',
          `Portfolio limit reached (enforced under lock, limit=${limit})`,
          { limit }
        );
      }
      throw new PortfolioServiceError(err.code, err.message, err.details);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// setDefaultPortfolio — ผู้ใช้เลือก "พอร์ตหลัก" ของตัวเอง (มติ Founder 24 ส.ค.)
// ═══════════════════════════════════════════════════════════════════════════
// พอร์ตหลัก = พอร์ตที่ยังเขียนได้เสมอแม้ Premium หมดอายุ (ดู
// entitlement.getWritablePortfolioIds) → ผู้ใช้ต้องเลือกเองได้ ไม่งั้นจะถูกขัง
// อยู่กับพอร์ตที่ migration 044 Backfill สร้างให้ ซึ่งมักแทบว่างเปล่า
//
// ⚠️ **ไม่ Gate ด้วย Premium Active โดยเจตนา** (ต่างจาก create/update):
// Prompt เดิมระบุ "Premium เท่านั้น เพราะ Free มีพอร์ตเดียวอยู่แล้ว" ซึ่งเหตุผล
// คือ "Free ทำแล้วไม่มีความหมาย" ไม่ใช่ "ห้ามทำ" — ถ้า Gate ด้วย isPremiumActive
// ตรงๆ ผู้ใช้ **Premium ที่หมดอายุ** จะเปลี่ยนพอร์ตหลักไม่ได้ = ถูกขังอยู่กับ
// พอร์ตเดิมทั้งที่พอร์ตที่เขาใช้จริงถูกล็อก ซึ่งเป็น "กับดัก" แบบเดียวกับที่
// มติ 24 ส.ค. ตั้งใจกำจัด (การล็อก = โตต่อไม่ได้ ไม่ใช่ออกไม่ได้)
//
// ตัวคุมสิทธิ์จริงคือ "มีพอร์ตมากกว่า 1 อันไหม" ซึ่งมีได้เฉพาะคนที่เคยเป็น
// Premium อยู่แล้ว → ได้ผลเดียวกับ "Premium เท่านั้น" โดยไม่สร้างกับดัก
async function setDefaultPortfolio(userId, portfolioId, userRecord) {
  const portfolios = await portfolioRepository.findAllByUser(userId);

  const target = portfolios.find((p) => p.id === portfolioId);
  if (!target) {
    throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
      portfolioId,
    });
  }

  if (target.isDefault) {
    // เป็นพอร์ตหลักอยู่แล้ว — ไม่ต้องยิง RPC ให้เปลืองและไม่ต้อง Error
    // (Idempotent: กดซ้ำได้ผลลัพธ์เดิม)
    return target;
  }

  if (portfolios.length < 2) {
    throw new PortfolioServiceError(
      'VALIDATION_ERROR',
      'Cannot change the default portfolio when only one portfolio exists',
      { field: 'isDefault', portfolioCount: portfolios.length }
    );
  }

  try {
    const updated = await portfolioRepository.setDefaultForUser(userId, portfolioId);
    if (!updated) {
      throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
        portfolioId,
      });
    }
    return updated;
  } catch (err) {
    if (err instanceof portfolioRepository.PortfolioWriteError) {
      throw new PortfolioServiceError(err.code, err.message, err.details);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// updatePortfolio — แก้ชื่อ/ประเภท (ต้องเป็นพอร์ตที่เขียนได้)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ พอร์ต Default แก้ชื่อ/ประเภทได้ปกติ — ที่ห้ามคือ "ลบ" เท่านั้น
// (Invariant บอกว่าต้องมี Default หนึ่งอันเป๊ะ ไม่ได้บอกว่าห้ามเปลี่ยนชื่อ)
async function updatePortfolio(userId, portfolioId, patch, userRecord) {
  await assertCanAddToPortfolio(userId, portfolioId, userRecord);

  const update = {};
  if (patch.name !== undefined) {
    const name = normalizeName(patch.name);
    if (name === null) {
      throw new PortfolioServiceError('VALIDATION_ERROR', 'Invalid portfolio name', {
        field: 'name',
        maxLength: PORTFOLIO_NAME_MAX_LENGTH,
      });
    }
    update.name = name;
  }
  if (patch.type !== undefined) {
    assertValidType(patch.type);
    update.type = patch.type;
  }

  if (Object.keys(update).length === 0) {
    throw new PortfolioServiceError('VALIDATION_ERROR', 'Nothing to update', {
      allowed: ['name', 'type'],
    });
  }

  try {
    const updated = await portfolioRepository.updateByIdForUser(portfolioId, userId, update);
    if (!updated) {
      throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
        portfolioId,
      });
    }
    return updated;
  } catch (err) {
    if (err instanceof portfolioRepository.PortfolioWriteError) {
      throw new PortfolioServiceError(err.code, err.message, err.details);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// deletePortfolio — ลบ "กล่อง" ไม่ใช่ลบสินทรัพย์/ธุรกรรม
// ═══════════════════════════════════════════════════════════════════════════
// ลำดับบังคับ (ห้ามสลับ):
//   1) ห้ามลบพอร์ต Default        → 409 CANNOT_DELETE_DEFAULT_PORTFOLIO
//   2) ตรวจว่าย้ายสินทรัพย์เข้า Default แล้วจะชน UNIQUE ไหม → 409 ถ้าชน
//   3) ย้ายสินทรัพย์เข้าพอร์ต Default
//   4) ค่อยลบแถวพอร์ต
//
// ⚠️ ข้อ 3 สำคัญมากและ **ห้ามข้ามไปพึ่ง ON DELETE SET NULL ของ FK**:
// ถ้าปล่อยให้ FK ทำงาน สินทรัพย์จะกลายเป็น portfolio_id = NULL ซึ่งทำ Invariant
// ของ migration 044/045 พังทันที ("สินทรัพย์ทุกแถวสังกัดพอร์ตเสมอ") แล้ว
// migration 045 ที่ใช้เป็น Health Check จะ RAISE EXCEPTION
//
// ⚠️ ข้อ 2 คือเคสเดียวกับที่ migration 044 STEP 6 ดักไว้เป๊ะ: ถ้าพอร์ตที่จะลบมี
// BTC@Bitkub และพอร์ต Default ก็มี BTC@Bitkub อยู่แล้ว การย้ายจะชน
// UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id) —
// **การรวมสองแถวเข้าด้วยกันกระทบต้นทุนเฉลี่ย = แตะเงินจริง ห้ามทำอัตโนมัติ**
// ต้องปฏิเสธพร้อมบอกว่าตัวไหนชน ให้ผู้ใช้จัดการเองก่อน
async function deletePortfolio(userId, portfolioId, userRecord) {
  // ⚠️ **ไม่ผ่าน assertCanAddToPortfolio โดยเจตนา** — การลบพอร์ตส่วนเกินคือการ
  // "ย้ายสินทรัพย์ออกไปรวมกับพอร์ตหลัก" ซึ่งเป็นทางออกจากพอร์ตที่ถูกล็อก
  // (มติ Founder 24 ส.ค. 2569: การล็อกต้องหมายถึง "โตต่อไม่ได้" ไม่ใช่ "ออกไม่ได้")
  // ถ้าบล็อกที่นี่ด้วย ผู้ใช้ที่ Premium หมดอายุจะรวมพอร์ตของตัวเองไม่ได้เลย
  // ปลายทางของสินทรัพย์คือพอร์ต Default ซึ่งเขียนได้เสมออยู่แล้ว
  const portfolio = await portfolioRepository.findByIdForUser(portfolioId, userId);
  if (!portfolio) {
    throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
      portfolioId,
    });
  }

  if (portfolio.isDefault) {
    throw new PortfolioServiceError(
      'CANNOT_DELETE_DEFAULT_PORTFOLIO',
      'The default portfolio cannot be deleted',
      { portfolioId }
    );
  }

  const defaultPortfolio = await portfolioRepository.findDefaultByUser(userId);
  if (!defaultPortfolio) {
    // Invariant พัง — ไม่ใช่ความผิดของผู้ใช้ และเดินต่อไม่ได้อย่างปลอดภัย
    // (ไม่มีที่ให้ย้ายสินทรัพย์ไป) ต้องดังให้รู้ ไม่ใช่ลบทิ้งแล้วปล่อยเป็น NULL
    throw new PortfolioServiceError(
      'DEFAULT_PORTFOLIO_MISSING',
      'User has no default portfolio (migration 044/045 invariant is broken)',
      { userId }
    );
  }

  const moving = await assetRepository.findByPortfolio(userId, portfolioId);

  if (moving.length > 0) {
    const existing = await assetRepository.findByPortfolio(userId, defaultPortfolio.id);
    // เทียบด้วยกุญแจชุดเดียวกับ UNIQUE ของ migration 046 เป๊ะ (symbol + broker)
    // broker_id ที่เป็น NULL ถือว่าเท่ากันตาม NULLS NOT DISTINCT → ใช้ '∅' แทน
    const keyOf = (a) => `${a.symbol} ${a.brokerId ?? '∅'}`;
    const taken = new Set(existing.map(keyOf));
    const conflicts = moving.filter((a) => taken.has(keyOf(a)));

    if (conflicts.length > 0) {
      throw new PortfolioServiceError(
        'PORTFOLIO_HAS_CONFLICTING_ASSETS',
        'Moving these assets into the default portfolio would violate the unique constraint',
        {
          portfolioId,
          targetPortfolioId: defaultPortfolio.id,
          conflicts: conflicts.map((a) => ({
            assetId: a.id,
            symbol: a.symbol,
            brokerId: a.brokerId ?? null,
          })),
        }
      );
    }

    // ⚠️ **รู้ตัวว่าสองก้าวนี้ไม่ Atomic และยอมรับโดยตั้งใจ** (งานที่ 2.5 ของ
    // รีวิว 24 ส.ค. 2569 — ไม่ใช่การมองข้าม):
    // ถ้าพังระหว่าง reassign กับ delete จะได้ "สินทรัพย์ย้ายไปพอร์ต Default แล้ว
    // แต่พอร์ตเก่ายังอยู่" ซึ่ง **ไม่อันตราย**:
    //   • Invariant ของ migration 044/045 ยังจริง (สินทรัพย์ทุกแถวยังสังกัดพอร์ต
    //     และพอร์ต Default ยังมีอันเดียว) → migration 045 ยังผ่าน
    //   • ผู้ใช้กดลบซ้ำได้ผลลัพธ์เดิม = **Idempotent โดยธรรมชาติ** (รอบสองจะเจอ
    //     พอร์ตว่าง ไม่มีอะไรให้ย้าย แล้วลบสำเร็จ)
    //   • ไม่มีข้อมูลใดสูญหาย — reassign เป็น UPDATE ไม่ใช่ DELETE
    // ต่างจากเพดานพอร์ต (migration 048) ที่ต้องเป็น RPC เพราะ Failure mode ตรงนั้น
    // คือ "ทะลุเพดานถาวร" ซึ่งกู้เองไม่ได้ — ที่นี่แค่กดซ้ำก็จบ จึงไม่คุ้มกับ
    // ความซับซ้อนของ RPC เพิ่มอีกตัว
    await assetRepository.reassignPortfolio(userId, portfolioId, defaultPortfolio.id);
  }

  const deleted = await portfolioRepository.deleteByIdForUser(portfolioId, userId);
  if (deleted === 0) {
    throw new PortfolioServiceError('PORTFOLIO_NOT_FOUND', `Portfolio ${portfolioId} not found`, {
      portfolioId,
    });
  }

  return { deletedId: portfolioId, movedAssetCount: moving.length, movedTo: defaultPortfolio.id };
}

module.exports = {
  PortfolioServiceError,
  PORTFOLIO_NAME_MAX_LENGTH,
  PORTFOLIO_TYPES,
  listPortfolios,
  getPortfolio,
  assertCanAddToPortfolio,
  assertOwnedPortfolioId,
  createPortfolio,
  setDefaultPortfolio,
  updatePortfolio,
  deletePortfolio,
};
