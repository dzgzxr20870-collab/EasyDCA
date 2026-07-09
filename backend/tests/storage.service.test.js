// Mock Supabase Storage Client — from() คืน object ที่มี upload/getPublicUrl
// (ไม่เรียก Storage จริง) Pattern ตาม repository test อื่น ๆ ที่ Mock config/supabase
jest.mock('../src/config/supabase', () => {
  const storageBucket = {
    upload: jest.fn(),
    getPublicUrl: jest.fn(),
  };
  const supabaseAdmin = {
    storage: { from: jest.fn(() => storageBucket) },
  };
  return { supabaseAdmin, __storageBucket: storageBucket };
});

const { supabaseAdmin, __storageBucket } = require('../src/config/supabase');
const storageService = require('../src/services/storage.service');

const PAYMENT_ID = 'pay-1';
const BUFFER = Buffer.from([1, 2, 3]);

beforeEach(() => {
  jest.clearAllMocks();
  // Default: upload สำเร็จ + คืน Public URL
  __storageBucket.upload.mockResolvedValue({ data: { path: 'x' }, error: null });
  __storageBucket.getPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://cdn.supabase.test/payment-slips/pay-1-123.jpg' },
  });
});

describe('uploadPaymentSlip', () => {
  test('อัปโหลดสำเร็จ → คืน Public URL, ใช้ Bucket payment-slips + ตั้ง contentType', async () => {
    const url = await storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'image/jpeg');

    expect(url).toBe('https://cdn.supabase.test/payment-slips/pay-1-123.jpg');
    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith('payment-slips');
    // ชื่อไฟล์ขึ้นต้นด้วย paymentId และลงท้าย .jpg (image/jpeg)
    const [path, buffer, options] = __storageBucket.upload.mock.calls[0];
    expect(path).toMatch(/^pay-1-\d+\.jpg$/);
    expect(buffer).toBe(BUFFER);
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: false });
  });

  test('Content-Type image/png → นามสกุลไฟล์เป็น .png', async () => {
    await storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'image/png');
    expect(__storageBucket.upload.mock.calls[0][0]).toMatch(/^pay-1-\d+\.png$/);
  });

  test('Content-Type ไม่รู้จัก/ว่าง → Fallback นามสกุล .jpg', async () => {
    await storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, undefined);
    expect(__storageBucket.upload.mock.calls[0][0]).toMatch(/^pay-1-\d+\.jpg$/);
  });

  test('Storage upload ล้มเหลว (error) → throw (ให้ Caller ห่อ try/catch เอง)', async () => {
    __storageBucket.upload.mockResolvedValue({ data: null, error: { message: 'bucket not found' } });

    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'image/jpeg')
    ).rejects.toThrow('bucket not found');
  });

  test('ส่งรูปซ้ำ 2 ครั้ง → ชื่อไฟล์ไม่ซ้ำกัน (timestamp ต่างกัน, ไม่ Overwrite)', async () => {
    await storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'image/jpeg');
    // ขยับเวลาให้ Date.now() ต่างจากครั้งแรกแน่นอน
    const realNow = Date.now;
    Date.now = jest.fn(() => realNow() + 5000);
    await storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'image/jpeg');
    Date.now = realNow;

    const path1 = __storageBucket.upload.mock.calls[0][0];
    const path2 = __storageBucket.upload.mock.calls[1][0];
    expect(path1).not.toBe(path2);
    // ทั้งคู่ upsert:false → ไม่ทับไฟล์เดิม
    expect(__storageBucket.upload.mock.calls[0][2].upsert).toBe(false);
    expect(__storageBucket.upload.mock.calls[1][2].upsert).toBe(false);
  });
});
