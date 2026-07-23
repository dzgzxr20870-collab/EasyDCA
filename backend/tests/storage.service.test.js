// Mock Supabase Storage Client — from() คืน object ที่มี upload/getPublicUrl
// (ไม่เรียก Storage จริง) Pattern ตาม repository test อื่น ๆ ที่ Mock config/supabase
jest.mock('../src/config/supabase', () => {
  const storageBucket = {
    upload: jest.fn(),
    getPublicUrl: jest.fn(),
    list: jest.fn(),
    remove: jest.fn(),
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

  test('Content-Type ไม่รู้จัก/ว่าง (undefined) → Reject ก่อนอัปโหลด (ไม่ Fallback เงียบๆ อีกต่อไป — Payment Beta Hardening)', async () => {
    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, undefined)
    ).rejects.toMatchObject({ code: 'INVALID_SLIP_CONTENT_TYPE' });
    expect(__storageBucket.upload).not.toHaveBeenCalled();
  });

  // ── Payment Beta Hardening — MIME Type + ขนาดไฟล์ ────────────────────────
  test('Content-Type ไม่อยู่ใน Allowlist (application/pdf) → Reject ก่อนอัปโหลด', async () => {
    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'application/pdf')
    ).rejects.toMatchObject({ code: 'INVALID_SLIP_CONTENT_TYPE' });
    expect(__storageBucket.upload).not.toHaveBeenCalled();
  });

  test('Content-Type ไม่อยู่ใน Allowlist (text/html) → Reject ก่อนอัปโหลด', async () => {
    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'text/html')
    ).rejects.toMatchObject({ code: 'INVALID_SLIP_CONTENT_TYPE' });
    expect(__storageBucket.upload).not.toHaveBeenCalled();
  });

  test('image/webp และ image/gif (อยู่ใน Allowlist) → อัปโหลดสำเร็จตามปกติ', async () => {
    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'image/webp')
    ).resolves.toBe('https://cdn.supabase.test/payment-slips/pay-1-123.jpg');
    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, BUFFER, 'image/gif')
    ).resolves.toBe('https://cdn.supabase.test/payment-slips/pay-1-123.jpg');
    expect(__storageBucket.upload).toHaveBeenCalledTimes(2);
  });

  test('Buffer เกินขนาดสูงสุด (MAX_SLIP_SIZE_BYTES) → Reject ก่อนอัปโหลด', async () => {
    const oversizedBuffer = Buffer.alloc(storageService.MAX_SLIP_SIZE_BYTES + 1);

    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, oversizedBuffer, 'image/jpeg')
    ).rejects.toMatchObject({ code: 'SLIP_TOO_LARGE' });
    expect(__storageBucket.upload).not.toHaveBeenCalled();
  });

  test('Buffer พอดีขนาดสูงสุด (MAX_SLIP_SIZE_BYTES เป๊ะ) → ยังอัปโหลดได้ (Boundary ไม่ Reject)', async () => {
    const boundaryBuffer = Buffer.alloc(storageService.MAX_SLIP_SIZE_BYTES);

    await expect(
      storageService.uploadPaymentSlip(PAYMENT_ID, boundaryBuffer, 'image/jpeg')
    ).resolves.toBe('https://cdn.supabase.test/payment-slips/pay-1-123.jpg');
    expect(__storageBucket.upload).toHaveBeenCalledTimes(1);
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

// PDPA Self-Service Erasure (userErasure.service) — ลบรูปสลิปทั้งหมดของ User จริง
describe('deleteAllSlipsForUser', () => {
  test('List Bucket แล้ว Filter เฉพาะไฟล์ที่ขึ้นต้นด้วย Prefix ของ paymentId ที่ส่งมา', async () => {
    __storageBucket.list.mockResolvedValue({
      data: [
        { name: 'pay-1-1000.jpg' },
        { name: 'pay-1-2000.png' },
        { name: 'pay-2-3000.jpg' }, // paymentId อื่น ไม่เกี่ยว ไม่ควรถูกลบ
        { name: 'pay-9-4000.jpg' }, // paymentId อื่น ไม่เกี่ยว ไม่ควรถูกลบ
      ],
      error: null,
    });
    __storageBucket.remove.mockResolvedValue({ data: [], error: null });

    const count = await storageService.deleteAllSlipsForUser(['pay-1']);

    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith('payment-slips');
    expect(__storageBucket.remove).toHaveBeenCalledWith(['pay-1-1000.jpg', 'pay-1-2000.png']);
    expect(count).toBe(2);
  });

  test('User มีหลาย Payment → รวมไฟล์ทุก paymentId ที่ส่งมาในครั้งเดียว', async () => {
    __storageBucket.list.mockResolvedValue({
      data: [{ name: 'pay-1-1000.jpg' }, { name: 'pay-2-2000.jpg' }, { name: 'pay-3-3000.jpg' }],
      error: null,
    });
    __storageBucket.remove.mockResolvedValue({ data: [], error: null });

    const count = await storageService.deleteAllSlipsForUser(['pay-1', 'pay-2']);

    expect(__storageBucket.remove).toHaveBeenCalledWith(['pay-1-1000.jpg', 'pay-2-2000.jpg']);
    expect(count).toBe(2);
  });

  test('ไม่มี paymentIds เลย (Array ว่าง) → คืน 0 ไม่เรียก List/Remove เลย', async () => {
    const count = await storageService.deleteAllSlipsForUser([]);

    expect(count).toBe(0);
    expect(__storageBucket.list).not.toHaveBeenCalled();
    expect(__storageBucket.remove).not.toHaveBeenCalled();
  });

  test('มี paymentIds แต่ไม่มีไฟล์ตรง Prefix เลยใน Bucket → คืน 0 ไม่เรียก Remove', async () => {
    __storageBucket.list.mockResolvedValue({
      data: [{ name: 'pay-9-9999.jpg' }],
      error: null,
    });

    const count = await storageService.deleteAllSlipsForUser(['pay-1']);

    expect(count).toBe(0);
    expect(__storageBucket.remove).not.toHaveBeenCalled();
  });

  test('List ล้มเหลว (error) → throw', async () => {
    __storageBucket.list.mockResolvedValue({ data: null, error: { message: 'list failed' } });
    await expect(storageService.deleteAllSlipsForUser(['pay-1'])).rejects.toThrow('list failed');
  });

  test('Remove ล้มเหลว (error) → throw', async () => {
    __storageBucket.list.mockResolvedValue({ data: [{ name: 'pay-1-1000.jpg' }], error: null });
    __storageBucket.remove.mockResolvedValue({ data: null, error: { message: 'remove failed' } });
    await expect(storageService.deleteAllSlipsForUser(['pay-1'])).rejects.toThrow('remove failed');
  });
});

// PDPA Self-Service Erasure (userErasure.service) — ลบรูปสลิปธุรกรรมทั้งหมดของ User
// ออกจาก Bucket transaction-slips จริง (List by Prefix "{userId}-" ครอบคลุมไฟล์ Orphan
// ที่ OCR อัปโหลดไว้ก่อนผู้ใช้ยืนยันด้วย ต่างจากการ Query slip_image_path ที่จะพลาดไป)
describe('deleteAllTransactionSlipsForUser', () => {
  const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const OTHER_ID = 'ffffffff-1111-2222-3333-444444444444';

  test('List Bucket (search=userId) แล้ว Filter เฉพาะไฟล์ที่ขึ้นต้นด้วย Prefix "{userId}-"', async () => {
    __storageBucket.list.mockResolvedValue({
      data: [
        { name: `${USER_ID}-1000.jpg` },
        { name: `${USER_ID}-2000.png` }, // Orphan (ยังไม่ผูก transaction) ก็ต้องลบ
        { name: `${OTHER_ID}-3000.jpg` }, // ของ User อื่น — ไม่ควรถูกลบ (กันหลุดมากับ search)
      ],
      error: null,
    });
    __storageBucket.remove.mockResolvedValue({ data: [], error: null });

    const count = await storageService.deleteAllTransactionSlipsForUser(USER_ID);

    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith('transaction-slips');
    expect(__storageBucket.list).toHaveBeenCalledWith('', { search: USER_ID });
    expect(__storageBucket.remove).toHaveBeenCalledWith([
      `${USER_ID}-1000.jpg`,
      `${USER_ID}-2000.png`,
    ]);
    expect(count).toBe(2);
  });

  test('userId ว่าง/undefined → คืน 0 ไม่เรียก List/Remove เลย', async () => {
    const count = await storageService.deleteAllTransactionSlipsForUser(undefined);

    expect(count).toBe(0);
    expect(__storageBucket.list).not.toHaveBeenCalled();
    expect(__storageBucket.remove).not.toHaveBeenCalled();
  });

  test('ไม่มีไฟล์ตรง Prefix เลยใน Bucket → คืน 0 ไม่เรียก Remove (User ไม่เคยส่งสลิปธุรกรรม)', async () => {
    __storageBucket.list.mockResolvedValue({
      data: [{ name: `${OTHER_ID}-9999.jpg` }],
      error: null,
    });

    const count = await storageService.deleteAllTransactionSlipsForUser(USER_ID);

    expect(count).toBe(0);
    expect(__storageBucket.remove).not.toHaveBeenCalled();
  });

  test('List คืน data ว่าง (null) → คืน 0 ไม่ throw', async () => {
    __storageBucket.list.mockResolvedValue({ data: null, error: null });

    const count = await storageService.deleteAllTransactionSlipsForUser(USER_ID);

    expect(count).toBe(0);
    expect(__storageBucket.remove).not.toHaveBeenCalled();
  });

  test('List ล้มเหลว (error) → throw (ให้ Caller Isolate เอง)', async () => {
    __storageBucket.list.mockResolvedValue({ data: null, error: { message: 'list failed' } });
    await expect(storageService.deleteAllTransactionSlipsForUser(USER_ID)).rejects.toThrow(
      'list failed'
    );
  });

  test('Remove ล้มเหลว (error) → throw', async () => {
    __storageBucket.list.mockResolvedValue({
      data: [{ name: `${USER_ID}-1000.jpg` }],
      error: null,
    });
    __storageBucket.remove.mockResolvedValue({ data: null, error: { message: 'remove failed' } });
    await expect(storageService.deleteAllTransactionSlipsForUser(USER_ID)).rejects.toThrow(
      'remove failed'
    );
  });
});
