// storage.service.uploadReport — อัปโหลด Bucket 'reports' (Private) + Signed URL 15 นาที
jest.mock('../src/config/supabase', () => {
  const storageBucket = {
    upload: jest.fn(),
    getPublicUrl: jest.fn(),
    createSignedUrl: jest.fn(),
  };
  const supabaseAdmin = { storage: { from: jest.fn(() => storageBucket) } };
  return { supabaseAdmin, __storageBucket: storageBucket };
});

const { supabaseAdmin, __storageBucket } = require('../src/config/supabase');
const storageService = require('../src/services/storage.service');

const USER_ID = 'user-1';
const BUFFER = Buffer.from([1, 2, 3]);

beforeEach(() => {
  jest.clearAllMocks();
  __storageBucket.upload.mockResolvedValue({ data: { path: 'x' }, error: null });
  __storageBucket.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://cdn.supabase.test/reports/user-1-123.pdf?token=abc' },
    error: null,
  });
});

describe('uploadReport', () => {
  test('pdf → Bucket reports (Private) + Signed URL 900 วินาที (15 นาที)', async () => {
    const result = await storageService.uploadReport(USER_ID, BUFFER, 'pdf');

    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith('reports');
    expect(result.signedUrl).toBe('https://cdn.supabase.test/reports/user-1-123.pdf?token=abc');
    expect(result.expiresInSeconds).toBe(15 * 60);

    // ชื่อไฟล์ = {userId}-{timestamp}.pdf, upsert:false, contentType application/pdf
    const [path, buffer, options] = __storageBucket.upload.mock.calls[0];
    expect(path).toMatch(/^user-1-\d+\.pdf$/);
    expect(buffer).toBe(BUFFER);
    expect(options).toEqual({ contentType: 'application/pdf', upsert: false });

    // createSignedUrl เรียกด้วย path เดียวกับที่ upload + TTL 900 วินาที
    const [signPath, ttl] = __storageBucket.createSignedUrl.mock.calls[0];
    expect(signPath).toBe(path);
    expect(ttl).toBe(900);
  });

  test('excel → นามสกุล .xlsx + contentType spreadsheet', async () => {
    __storageBucket.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://cdn/reports/user-1-9.xlsx?t=z' },
      error: null,
    });
    await storageService.uploadReport(USER_ID, BUFFER, 'excel');

    const [path, , options] = __storageBucket.upload.mock.calls[0];
    expect(path).toMatch(/^user-1-\d+\.xlsx$/);
    expect(options.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  test('format ไม่รู้จัก → throw (ไม่ยิง Storage)', async () => {
    await expect(storageService.uploadReport(USER_ID, BUFFER, 'csv')).rejects.toThrow(
      /Unknown report format/
    );
    expect(__storageBucket.upload).not.toHaveBeenCalled();
  });

  test('upload ล้มเหลว → throw (Caller ห่อ try/catch เอง)', async () => {
    __storageBucket.upload.mockResolvedValue({ data: null, error: { message: 'bucket not found' } });
    await expect(storageService.uploadReport(USER_ID, BUFFER, 'pdf')).rejects.toThrow('bucket not found');
    expect(__storageBucket.createSignedUrl).not.toHaveBeenCalled();
  });

  test('createSignedUrl ล้มเหลว → throw', async () => {
    __storageBucket.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'sign fail' } });
    await expect(storageService.uploadReport(USER_ID, BUFFER, 'pdf')).rejects.toThrow(/sign fail/);
  });
});
