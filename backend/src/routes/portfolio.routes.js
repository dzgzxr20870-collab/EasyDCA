const express = require('express');
const requireAuth = require('../middleware/auth.middleware');
const { requireConsent } = require('../middleware/auth.middleware');
const portfoliosController = require('../controllers/portfolios.controller');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/portfolio (เอกพจน์) — มุมมอง "ภาพรวมพอร์ต" ไม่ใช่ CRUD ของพอร์ต
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ แยกจาก /api/v1/portfolios (พหูพจน์) โดยเจตนา ตามที่ API.md § 14.2 วางไว้
// ตั้งแต่ Phase 0:
//   • /portfolio  (เอกพจน์) = อ่านภาพรวม/สัดส่วน — Free
//   • /portfolios (พหูพจน์) = CRUD ของพอร์ตย่อย — POST/PATCH/DELETE เป็น Premium
// Rate Limit ของ Path นี้ถูกกำหนดไว้แล้วที่ API.md § "GET /api/v1/portfolio/*"
router.use(requireAuth);
router.use(requireConsent);

// สัดส่วนพอร์ตสำหรับกราฟโดนัท (Design Doc § 4.3) — Free
// ทุกตัวเลข Reuse portfolio.service + portfolioSummary.priceHoldings ตัวเดิม
// ที่ /portfolio/summary ใช้อยู่ (กฎยืนข้อ 1 — ห้ามเขียนสูตรรวมมูลค่าใหม่)
router.get('/allocation', portfoliosController.getAllocation);

module.exports = router;
