const reportExportService = require('../services/reportExport.service');
const userRepository = require('../repositories/user.repository');
const entitlementService = require('../services/entitlement.service');

// Map ReportServiceError.code → HTTP Status (Pattern เดียวกับ payment.controller
// ที่ Map PaymentServiceError → Status) code ที่ไม่อยู่ในตารางถือเป็น 500
const STATUS_BY_CODE = {
  EXPORT_INVALID_FORMAT: 400,
  EXPORT_INVALID_RANGE: 400,
  EXPORT_USER_NOT_FOUND: 404,
};

// GET /api/v1/reports/export?format=pdf|excel&range=month|year|custom&from=&to=
// (requireAuth) — Premium Feature: เช็ค isPremiumActive ก่อนเสมอ ถ้าไม่ใช่ → 403
// สร้างไฟล์แล้ว Stream กลับเป็น attachment (Frontend รับ Blob แล้ว Trigger download)
async function exportReport(req, res) {
  // ── เช็ค Premium (Reuse entitlement.service — Single Source of Truth) ──────
  let user;
  try {
    user = await userRepository.findById(req.user.id);
  } catch (err) {
    console.error(`[reports] exportReport: failed to load user: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }

  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND' });
  }

  if (!entitlementService.isPremiumActive(user)) {
    return res.status(403).json({ error: 'EXPORT_PREMIUM_REQUIRED' });
  }

  const format = req.query.format;
  const range = {
    range: req.query.range,
    from: req.query.from,
    to: req.query.to,
  };

  try {
    const { buffer, filename, mimeType } = await reportExportService.generatePortfolioReport(
      req.user.id,
      { format, range }
    );

    res.set('Content-Type', mimeType);
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    // ไฟล์รายงานมีข้อมูลการเงิน — ห้าม Cache ที่ Proxy/Browser
    res.set('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (err) {
    if (err instanceof reportExportService.ReportServiceError) {
      const status = STATUS_BY_CODE[err.code];
      if (status) {
        return res.status(status).json({ error: err.code });
      }
    }

    console.error(`[reports] exportReport failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { exportReport };
