// reports.controller.exportReport — Premium gate + Stream Buffer (Round 8)
// Mock Service/Repository | ใช้ entitlement.service จริง (Pure Logic)
jest.mock('../src/services/reportExport.service');
jest.mock('../src/repositories/user.repository');

const reportExportService = require('../src/services/reportExport.service');
const userRepository = require('../src/repositories/user.repository');
const reportsController = require('../src/controllers/reports.controller');

// ReportServiceError จริงต้องเป็น instanceof ได้ — สร้าง Class จำลองที่ตรง Pattern
class ReportServiceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
reportExportService.ReportServiceError = ReportServiceError;

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

function mockRes() {
  const res = { statusCode: null, body: null, headers: {}, sent: null };
  res.status = jest.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b) => {
    res.body = b;
    return res;
  });
  res.set = jest.fn((k, v) => {
    res.headers[k] = v;
    return res;
  });
  res.send = jest.fn((b) => {
    res.sent = b;
    return res;
  });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('exportReport — Premium gate', () => {
  test('ไม่ใช่ Premium → 403 EXPORT_PREMIUM_REQUIRED (ไม่เรียก generate)', async () => {
    userRepository.findById.mockResolvedValue({ id: 'u1', plan: 'free', planExpiresAt: null });
    const req = { user: { id: 'u1' }, query: { format: 'pdf', range: 'month' } };
    const res = mockRes();

    await reportsController.exportReport(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'EXPORT_PREMIUM_REQUIRED' });
    expect(reportExportService.generatePortfolioReport).not.toHaveBeenCalled();
  });

  test('ไม่พบ User → 404 USER_NOT_FOUND', async () => {
    userRepository.findById.mockResolvedValue(null);
    const req = { user: { id: 'u1' }, query: { format: 'pdf', range: 'month' } };
    const res = mockRes();

    await reportsController.exportReport(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('exportReport — Premium สำเร็จ', () => {
  beforeEach(() => {
    userRepository.findById.mockResolvedValue({ id: 'u1', plan: 'premium', planExpiresAt: FUTURE });
  });

  test('Stream Buffer + Header (Content-Type/Disposition/Cache-Control) ถูกต้อง', async () => {
    const buffer = Buffer.from('%PDF-fake');
    reportExportService.generatePortfolioReport.mockResolvedValue({
      buffer,
      filename: 'EasyDCA-Report-2026-07-01_2026-07-31.pdf',
      mimeType: 'application/pdf',
    });

    const req = { user: { id: 'u1' }, query: { format: 'pdf', range: 'month' } };
    const res = mockRes();

    await reportsController.exportReport(req, res);

    expect(reportExportService.generatePortfolioReport).toHaveBeenCalledWith('u1', {
      format: 'pdf',
      range: { range: 'month', from: undefined, to: undefined },
    });
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="EasyDCA-Report-2026-07-01_2026-07-31.pdf"'
    );
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.statusCode).toBe(200);
    expect(res.sent).toBe(buffer);
  });

  test('custom range → ส่ง from/to ต่อไปยัง Service', async () => {
    reportExportService.generatePortfolioReport.mockResolvedValue({
      buffer: Buffer.from('x'),
      filename: 'r.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const req = {
      user: { id: 'u1' },
      query: { format: 'excel', range: 'custom', from: '2026-01-01', to: '2026-06-30' },
    };
    const res = mockRes();

    await reportsController.exportReport(req, res);

    expect(reportExportService.generatePortfolioReport).toHaveBeenCalledWith('u1', {
      format: 'excel',
      range: { range: 'custom', from: '2026-01-01', to: '2026-06-30' },
    });
  });

  test('ReportServiceError EXPORT_INVALID_RANGE → 400', async () => {
    reportExportService.generatePortfolioReport.mockRejectedValue(
      new ReportServiceError('EXPORT_INVALID_RANGE')
    );
    const req = { user: { id: 'u1' }, query: { format: 'pdf', range: 'custom' } };
    const res = mockRes();

    await reportsController.exportReport(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'EXPORT_INVALID_RANGE' });
  });

  test('Error ไม่คาดคิด → 500 INTERNAL_ERROR', async () => {
    reportExportService.generatePortfolioReport.mockRejectedValue(new Error('boom'));
    const req = { user: { id: 'u1' }, query: { format: 'pdf', range: 'month' } };
    const res = mockRes();

    await reportsController.exportReport(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'INTERNAL_ERROR' });
  });
});
