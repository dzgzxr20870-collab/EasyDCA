const assetRepository = require('../repositories/asset.repository');
const brokerService = require('./broker.service');
const portfoliosService = require('./portfolios.service');

// ═══════════════════════════════════════════════════════════════════════════
// assets.service — จัดการ "ป้ายกำกับ" ของสินทรัพย์ (Stage 8 · Design Doc § 4.4)
// ═══════════════════════════════════════════════════════════════════════════
// GET   /api/v1/assets            — List + filter ตาม brokerId / sector
// PATCH /api/v1/assets/{id}       — แก้ brokerId / sector / portfolioId
//
// ⚠️ **ไฟล์นี้ไม่แตะสูตรเงินเลยแม้แต่บรรทัดเดียว** — สามคอลัมน์ที่เปิดให้แก้
// (broker_id / sector / portfolio_id) ล้วนเป็นมิติสำหรับจัดกลุ่ม/แสดงผล ไม่เข้า
// สูตรต้นทุนเฉลี่ย/P&L ใดๆ (ยืนยันไว้ใน DATABASE.md ของแต่ละคอลัมน์)
//
// ⚠️ ห้ามเปิดให้แก้ `symbol` / `type` / `is_active` ผ่าน Endpoint นี้เด็ดขาด:
//   • symbol/type = ตัวตนของสินทรัพย์ที่ธุรกรรมทั้งกองผูกอยู่ ถ้าเปลี่ยน ต้นทุน
//     เฉลี่ยและ P&L ที่คำนวณจากประวัติเดิมจะกลายเป็นของผิดตัวทันทีแบบเงียบๆ
//   • is_active = ตัวนับเพดาน Free Plan ซึ่งต้องผ่าน RPC ที่ Lock ไว้เท่านั้น
//
// ── Cross-User Isolation (กฎเหล็กข้อ 3) ────────────────────────────────────
// ทั้ง brokerId และ portfolioId มาจาก Request Body ที่ผู้ใช้กำหนดเองได้ 100%
// FK ระดับ DB ตรวจได้แค่ "แถวนั้นมีอยู่จริง" ไม่ได้ตรวจ "เป็นของใคร" →
// ต้องผ่านด่านยืนยันเจ้าของก่อนใช้เสมอ:
//   brokerId    → brokerService.assertOwnedBrokerId
//   portfolioId → portfoliosService.assertCanWriteToPortfolio
//                 (ทำสองหน้าที่: ยืนยันเจ้าของ **และ** เช็คสิทธิ์เขียนตอน Premium
//                  หมดอายุ — ย้ายสินทรัพย์เข้าพอร์ตที่อ่านได้อย่างเดียวไม่ได้)

class AssetServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AssetServiceError';
    this.code = code;
    this.details = details;
  }
}

// ตรงกับ CHECK ของ assets.sector (migration 043):
//   sector IS NULL OR (btrim(sector) <> '' AND char_length(sector) <= 60)
const SECTOR_MAX_LENGTH = 60;

// Normalize เหมือนโบรก/ชื่อพอร์ต: trim หัวท้าย + ยุบช่องว่างซ้ำ
// **คงตัวพิมพ์ตามที่ผู้ใช้พิมพ์** (มติ Founder § 8.2) — การจัดกลุ่มแบบไม่สนตัวพิมพ์
// เกิดที่ allocation.service ตอนอ่าน ไม่ใช่ตอนเขียน
//
// ⚠️ ห้ามทำ Title Case เด็ดขาด — จะทำให้ `SET50` → `Set50` และ `REIT` → `Reit`
// (บทเรียนตรงจาก Stage 2 ที่ตัด Title Case ของ Design Doc § 3.2 ออก)
function normalizeSector(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined; // undefined = ค่าใช้ไม่ได้
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (cleaned === '') return null; // สตริงว่าง = "ล้างค่า" ตรงกับ NULL ของ DB
  if (cleaned.length > SECTOR_MAX_LENGTH) return undefined;
  return cleaned;
}

// ═══════════════════════════════════════════════════════════════════════════
// listAssets — สินทรัพย์ที่ถืออยู่ + filter ตามมิติ (Design Doc § 4.4)
// ═══════════════════════════════════════════════════════════════════════════
// filters.brokerId: '<uuid>' = โบรกนั้น · 'none' = แถวที่ไม่ผูกโบรก (NULL)
// filters.sector:   '<ชื่อ>' = เทียบแบบไม่สนตัวพิมพ์ · 'none' = แถวที่ไม่ระบุ
//
// ⚠️ กรองในหน่วยความจำหลังดึงมาแล้ว (ไม่ใช่ใน SQL) โดยเจตนา — เพราะการเทียบ
// sector ต้อง Normalize ให้ตรงกับที่ allocation.service จัดกลุ่มเป๊ะ ถ้าเขียน
// เงื่อนไขซ้ำใน SQL ด้วยกฎที่ต่างกันแม้นิดเดียว รายการที่กรองได้จะไม่ตรงกับ
// กลุ่มบนกราฟโดนัท (ผู้ใช้กดกลุ่มบนกราฟแล้วเห็นรายการไม่ครบ)
// จำนวนสินทรัพย์ต่อผู้ใช้อยู่ในหลักสิบ ไม่ใช่หลักหมื่น จึงไม่มีปัญหาเรื่อง Scale
async function listAssets(userId, filters = {}) {
  const assets = await assetRepository.findActiveByUser(userId);

  let result = assets;

  if (filters.brokerId !== undefined) {
    const wanted = filters.brokerId === 'none' ? null : filters.brokerId;
    result = result.filter((a) => (a.brokerId ?? null) === wanted);
  }

  if (filters.sector !== undefined) {
    if (filters.sector === 'none') {
      result = result.filter((a) => normalizeSector(a.sector) === null);
    } else {
      const wanted = String(filters.sector).trim().replace(/\s+/g, ' ').toLowerCase();
      result = result.filter((a) => {
        const s = normalizeSector(a.sector);
        return s !== null && s !== undefined && s.toLowerCase() === wanted;
      });
    }
  }

  if (filters.portfolioId !== undefined) {
    const wanted = filters.portfolioId === 'none' ? null : filters.portfolioId;
    result = result.filter((a) => (a.portfolioId ?? null) === wanted);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// updateAssetMeta — แก้ brokerId / sector / portfolioId
// ═══════════════════════════════════════════════════════════════════════════
// patch แต่ละ Field เป็น Optional — ส่งมาเฉพาะที่จะแก้
//   brokerId:    '<uuid>' | null | 'none'  (null/'none' = ล้างโบรก)
//   sector:      '<ชื่อ>' | null | ''       (null/'' = ล้าง sector)
//   portfolioId: '<uuid>'                   (**ห้ามเป็น null** — ดูเหตุผลด้านล่าง)
async function updateAssetMeta(userId, assetId, patch, userRecord) {
  const asset = await assetRepository.findByIdForUser(assetId, userId);
  if (!asset) {
    throw new AssetServiceError('ASSET_NOT_FOUND', `Asset ${assetId} not found`, { assetId });
  }

  // ── สินทรัพย์ที่อยู่ในพอร์ต "อ่านได้ เขียนไม่ได้" ห้ามแก้ ───────────────────
  // ถ้าไม่เช็คตรงนี้ ผู้ใช้ที่ Premium หมดอายุจะยังแก้ป้ายกำกับของสินทรัพย์ใน
  // พอร์ตส่วนเกินได้ ซึ่งขัดกับกติกา "เขียนไม่ได้" (มติ Founder § 8.1 ก)
  await portfoliosService.assertCanWriteToPortfolio(userId, asset.portfolioId, userRecord);

  const update = {};

  if (patch.brokerId !== undefined) {
    // ⚠️ ด่านบังคับ — brokerId มาจาก Body ที่ผู้ใช้กำหนดเองได้ 100%
    const raw = patch.brokerId === 'none' || patch.brokerId === '' ? null : patch.brokerId;
    update.brokerId = await brokerService.assertOwnedBrokerId(userId, raw);
  }

  if (patch.sector !== undefined) {
    const sector = normalizeSector(patch.sector);
    if (sector === undefined) {
      throw new AssetServiceError('VALIDATION_ERROR', 'Invalid sector', {
        field: 'sector',
        maxLength: SECTOR_MAX_LENGTH,
      });
    }
    update.sector = sector;
  }

  if (patch.portfolioId !== undefined) {
    // ⚠️ ห้ามย้ายสินทรัพย์ออกไปเป็น "ไม่มีพอร์ต" เด็ดขาด — Invariant ของ
    // migration 044/045 บังคับว่า "สินทรัพย์ทุกแถวสังกัดพอร์ตเสมอ" ถ้าปล่อยให้
    // ตั้งเป็น NULL ได้ migration 045 ที่ใช้เป็น Health Check จะ RAISE EXCEPTION
    if (patch.portfolioId === null || patch.portfolioId === 'none' || patch.portfolioId === '') {
      throw new AssetServiceError(
        'VALIDATION_ERROR',
        'portfolioId cannot be cleared — every asset must belong to a portfolio',
        { field: 'portfolioId' }
      );
    }
    // ยืนยันเจ้าของ **และ** เช็คสิทธิ์เขียนของพอร์ตปลายทางด้วย (ย้ายเข้าพอร์ตที่
    // อ่านได้อย่างเดียวไม่ได้) — throw PORTFOLIO_NOT_FOUND / PORTFOLIO_READ_ONLY
    await portfoliosService.assertCanWriteToPortfolio(userId, patch.portfolioId, userRecord);
    update.portfolioId = patch.portfolioId;
  }

  if (Object.keys(update).length === 0) {
    throw new AssetServiceError('VALIDATION_ERROR', 'Nothing to update', {
      allowed: ['brokerId', 'sector', 'portfolioId'],
    });
  }

  try {
    const updated = await assetRepository.updateMetaByIdForUser(assetId, userId, update);
    if (!updated) {
      throw new AssetServiceError('ASSET_NOT_FOUND', `Asset ${assetId} not found`, { assetId });
    }
    return updated;
  } catch (err) {
    if (err instanceof assetRepository.AssetWriteError) {
      // ชน UNIQUE (user_id, symbol, portfolio_id, broker_id) ของ migration 046 —
      // เช่นย้าย BTC@Bitkub ไปพอร์ตที่มี BTC@Bitkub อยู่แล้ว
      // **ห้ามรวมสองแถวให้อัตโนมัติ** (กระทบต้นทุนเฉลี่ย = แตะเงินจริง)
      throw new AssetServiceError(err.code, err.message, err.details);
    }
    throw err;
  }
}

module.exports = {
  AssetServiceError,
  SECTOR_MAX_LENGTH,
  listAssets,
  updateAssetMeta,
};
