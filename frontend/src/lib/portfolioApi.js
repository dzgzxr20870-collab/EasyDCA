import { apiGet, apiPost, apiPatch, apiDelete } from './api';

// ═══════════════════════════════════════════════════════════════════════════
// portfolioApi.js — ห่อ Endpoint ของ Stage 8 (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ **ไม่ใช่ API Client ใหม่** — ทุกฟังก์ชันเรียกผ่าน `lib/api.js` ตัวเดิมทั้งหมด
// (Token / 401 redirect / stashReturnTo / Error shape จัดการที่นั่นที่เดียว)
// ไฟล์นี้ทำแค่ 2 อย่าง: ประกอบ Path ให้ถูก และแปลง Response ให้ UI ใช้ง่าย
//
// ⚠️ ห้ามใส่ Logic สิทธิ์ใดๆ ที่นี่ — สิทธิ์อ่านจาก `canWrite` ที่ Backend ส่งมา
// (ดู lib/entitlements.js) ไฟล์นี้เป็นชั้นขนส่งข้อมูลล้วน

const BASE = '/api/v1';

// ── Portfolios ────────────────────────────────────────────────────────────

// GET /portfolios — Free · คืน portfolios[] พร้อมธง canWrite ต่อพอร์ต
export async function listPortfolios() {
  const data = await apiGet(`${BASE}/portfolios`);
  return data?.portfolios ?? [];
}

// POST /portfolios — Premium
// Error ที่ต้องรับมือ: 403 PORTFOLIO_LIMIT_REACHED · 409 PORTFOLIO_CAP_REACHED
export async function createPortfolio({ name, type }) {
  const data = await apiPost(`${BASE}/portfolios`, { name, type });
  return data?.portfolio ?? null;
}

// PATCH /portfolios/{id} — แก้ name / type
export async function updatePortfolio(id, patch) {
  const data = await apiPatch(`${BASE}/portfolios/${id}`, patch);
  return data?.portfolio ?? null;
}

// PATCH /portfolios/{id} { isDefault: true } — ตั้งเป็น "พอร์ตหลัก"
//
// ⭐ พอร์ตหลัก = พอร์ตที่ยังเขียนได้เสมอแม้ Premium หมดอายุ ผู้ใช้จึงต้องเลือกเองได้
// ไม่งั้นถูกขังอยู่กับพอร์ตที่ระบบ Backfill เลือกให้ (มติ Founder 24 ส.ค. 2569)
//
// ⚠️ ส่งได้เฉพาะ true — Backend ปฏิเสธ false เพราะต้องมีพอร์ตหลัก 1 อันเป๊ะเสมอ
export async function setDefaultPortfolio(id) {
  const data = await apiPatch(`${BASE}/portfolios/${id}`, { isDefault: true });
  return data?.portfolio ?? null;
}

// DELETE /portfolios/{id}
// คืน { deleted, movedAssetCount, movedToPortfolioId, message } — UI ต้องบอกผู้ใช้
// ว่าสินทรัพย์ถูก "ย้ายไปพอร์ตหลัก" กี่รายการ ไม่ใช่หายไปไหน
export async function deletePortfolio(id) {
  return apiDelete(`${BASE}/portfolios/${id}`);
}

// ── Allocation ────────────────────────────────────────────────────────────

// GET /portfolio/allocation — Free · groupBy = broker | sector | assetType
//
// ⚠️ Response มีธงที่ UI **ต้อง** รองรับ (Demo ไม่มีเลย):
//   fxUnavailableForUsd  → **ห้ามรวมยอดข้ามสกุลเงิน** ต้องเตือนผู้ใช้
//   fxStale              → เรตเก่า ต้องติดหมายเหตุ
//   priceUnavailableCount → กลุ่มนั้นตีมูลค่า "ที่ต้นทุน" ไม่ใช่ราคาตลาด
//   isEmpty              → ยังไม่มีสินทรัพย์ ต้องขึ้น Empty State ไม่ใช่กราฟว่าง
export async function getAllocation({ groupBy = 'assetType', portfolioId } = {}) {
  const params = new URLSearchParams({ groupBy });
  if (portfolioId) params.set('portfolioId', portfolioId);
  return apiGet(`${BASE}/portfolio/allocation?${params.toString()}`);
}

// ── Holdings + กำไร/ขาดทุนรายสินทรัพย์ (Stage 9 — หน้าพอร์ตแบบ 2 ระดับ) ────

// GET /dashboard/portfolio — คืน holdings[] ของ **ทุกพอร์ตรวมกัน** ในคำขอเดียว
//
// ⭐ ทำไมใช้ตัวนี้แทน GET /assets?portfolioId= สำหรับตารางสินทรัพย์รายพอร์ต:
//   1. แต่ละ holding **มี portfolioId ติดมาด้วยอยู่แล้ว** → กรองฝั่ง UI ได้ทันที
//      คำขอเดียวจึงใช้ได้กับทุกพอร์ต ไม่ต้องยิงซ้ำต่อพอร์ต
//   2. มี heldQuantity / totalInvested / averageCost / currency มาให้ครบ (มาจาก
//      สูตรเดียวกับคำสั่ง LINE "พอต" — portfolio.service.getPortfolioSummary)
//      ส่วน /assets คืนแค่ป้ายกำกับ (symbol/name/type/sector) ไม่มีตัวเลขเลย
//   3. ตัดสินทรัพย์ที่ขายหมดแล้ว (heldQuantity <= 0) ออกให้แล้ว — /assets ยังคืนมา
//      ซึ่งจะทำให้ยิง /profit แล้วได้ 404 NO_HOLDING_TO_CALCULATE_PROFIT เปล่าๆ
//
// ⚠️ **ไม่รองรับ ?portfolioId=** (ตรวจแล้วที่ dashboard.controller.getPortfolio —
// เรียก getPortfolioSummary(userId) ล้วน) การกรองจึงต้องทำฝั่ง UI ด้วย
// holding.portfolioId ที่ Backend ประทับมาให้ — เป็นการ "กรองแถว" ไม่ใช่คำนวณเงิน
export async function getPortfolioHoldings() {
  const data = await apiGet(`${BASE}/dashboard/portfolio`);
  return data ?? null;
}

// GET /dashboard/profit/:symbol — กำไร/ขาดทุนของสินทรัพย์ตัวเดียว (ต้องมีราคาสด)
//
// ⚠️ **ส่ง brokerId ไปด้วยเสมอเมื่อรู้** — ตั้งแต่ migration 046 ผู้ใช้ถือ Symbol
// เดียวกันได้หลายโบรก "symbol" จึงระบุแถวไม่ได้อีก ถ้าไม่ส่งจะได้ 409
// AMBIGUOUS_ASSET_BROKER แล้วแถวนั้น "ตกหล่นเงียบๆ" (ดูคำเตือนใน
// portfolio.service.getPortfolioSummary ที่ระบุเคสนี้ไว้ตรงๆ)
//   null → 'none' = "เจาะจงว่าไม่ระบุโบรก" ซึ่งคนละความหมายกับไม่ส่ง Key มาเลย
export async function getAssetProfit(symbol, { portfolioId, brokerId } = {}) {
  const params = new URLSearchParams();
  if (portfolioId) params.set('portfolioId', portfolioId);
  if (brokerId !== undefined) params.set('brokerId', brokerId === null ? 'none' : brokerId);

  const qs = params.toString();
  return apiGet(`${BASE}/dashboard/profit/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ''}`);
}

// ── Assets ────────────────────────────────────────────────────────────────

// GET /assets — Free · Filter brokerId / sector / portfolioId ('none' = ไม่ระบุ)
export async function listAssets({ brokerId, sector, portfolioId } = {}) {
  const params = new URLSearchParams();
  if (brokerId !== undefined) params.set('brokerId', brokerId);
  if (sector !== undefined) params.set('sector', sector);
  if (portfolioId !== undefined) params.set('portfolioId', portfolioId);

  const qs = params.toString();
  const data = await apiGet(`${BASE}/assets${qs ? `?${qs}` : ''}`);
  return data?.assets ?? [];
}

// PATCH /assets/{id} — แก้ได้เฉพาะ brokerId / sector / portfolioId
//
// ⚠️ ห้ามส่ง symbol / type / isActive มาเด็ดขาด — Backend ตอบ 400 พร้อม
// details.unsupportedFields (ไม่ได้เพิกเฉยเงียบๆ) เพราะ symbol/type คือตัวตนของ
// สินทรัพย์ที่ธุรกรรมทั้งกองผูกอยู่ ถ้าเปลี่ยนได้ต้นทุนเฉลี่ยจะผิดตัวทันที
export async function updateAsset(id, patch) {
  const data = await apiPatch(`${BASE}/assets/${id}`, patch);
  return data?.asset ?? null;
}

// ── Brokers (Stage 1 — มีอยู่แล้ว) ─────────────────────────────────────────

export async function listBrokers() {
  const data = await apiGet(`${BASE}/brokers`);
  return data?.brokers ?? [];
}

export async function createBroker(name) {
  const data = await apiPost(`${BASE}/brokers`, { name });
  return data?.broker ?? null;
}
