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
