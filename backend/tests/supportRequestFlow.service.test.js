// ═══════════════════════════════════════════════════════════════════════════
// Unit — supportRequestFlow.service (ติดต่อ Admin/Support ก่อนเปิด Closed Beta
// Wave 1 — Pivot ไปหน้าเว็บ /support)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ไม่มี Session/TTL/Cron อีกต่อไป (Migration 027 Drop ตาราง support_request_
// sessions ทิ้งแล้ว) — Service นี้เหลือแค่: validateMessage/validateCategory (Sync
// ล้วน) → checkRateLimit (Query ตาราง Log จริง) → pushSupportRequestToAdmins (Push
// LINE) → recordRequest (บันทึก Log) ให้ Controller (Web/LINE) เรียกประกอบกันเอง

jest.mock('../src/repositories/supportRequest.repository');
jest.mock('../src/services/line.service');
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return { ...actual, payment: { ...actual.payment, adminLineUserIds: ['Uadmin1', 'Uadmin2'] } };
});

const supportRequestRepository = require('../src/repositories/supportRequest.repository');
const lineService = require('../src/services/line.service');
const supportRequestFlow = require('../src/services/supportRequestFlow.service');

const USER = { id: 'user-1', lineUserId: 'U123', displayName: 'สมชาย ใจดี' };

beforeEach(() => {
  jest.clearAllMocks();
  supportRequestRepository.findRecentByUser.mockResolvedValue(null);
  supportRequestRepository.create.mockResolvedValue({ id: 'sr-1' });
  lineService.pushMessage.mockResolvedValue(undefined);
});

describe('ค่าคงที่', () => {
  test('RATE_LIMIT_HOURS = 1', () => {
    expect(supportRequestFlow.RATE_LIMIT_HOURS).toBe(1);
  });

  test('CATEGORIES ครบ 4 หมวดตรงกับ Dropdown บนเว็บ', () => {
    expect(supportRequestFlow.CATEGORIES).toEqual([
      'payment_premium',
      'ocr',
      'portfolio_ledger',
      'other',
    ]);
  });
});

describe('checkRateLimit — เช็คจากตาราง Log จริง (ไม่ใช้ In-memory Map)', () => {
  test('ไม่มีคำขอล่าสุด → ผ่าน ไม่ throw', async () => {
    supportRequestRepository.findRecentByUser.mockResolvedValue(null);
    await expect(supportRequestFlow.checkRateLimit(USER.id)).resolves.toBeUndefined();
  });

  test('มีคำขอภายใน 1 ชม.ล่าสุด → throw SUPPORT_REQUEST_RATE_LIMITED', async () => {
    supportRequestRepository.findRecentByUser.mockResolvedValue({
      id: 'sr-0',
      createdAt: new Date().toISOString(),
    });

    await expect(supportRequestFlow.checkRateLimit(USER.id)).rejects.toMatchObject({
      code: 'SUPPORT_REQUEST_RATE_LIMITED',
    });
  });

  test('cutoff ที่ส่งเข้า Repository อยู่ในอดีต 1 ชั่วโมงพอดี', async () => {
    const before = Date.now();
    await supportRequestFlow.checkRateLimit(USER.id);

    const [, cutoffIso] = supportRequestRepository.findRecentByUser.mock.calls[0];
    const cutoffMs = new Date(cutoffIso).getTime();
    // เผื่อ Jitter การรันเทสต์ ±2 วินาที
    expect(before - cutoffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 2000);
    expect(before - cutoffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 2000);
  });
});

describe('validateMessage — Sync ล้วน ไม่แตะ DB', () => {
  test('ข้อความปกติ → คืนค่าที่ Trim แล้ว', () => {
    expect(supportRequestFlow.validateMessage('  จ่ายเงินแล้วไม่ได้ Premium  ')).toBe(
      'จ่ายเงินแล้วไม่ได้ Premium'
    );
  });

  test.each([[''], ['   '], [null], [undefined]])(
    'ข้อความว่าง/ช่องว่างล้วน (%j) → throw SUPPORT_REQUEST_EMPTY_MESSAGE',
    (raw) => {
      expect(() => supportRequestFlow.validateMessage(raw)).toThrow(
        expect.objectContaining({ code: 'SUPPORT_REQUEST_EMPTY_MESSAGE' })
      );
    }
  );

  test('ยาวเกิน MAX_MESSAGE_LENGTH → throw SUPPORT_REQUEST_MESSAGE_TOO_LONG', () => {
    const tooLong = 'ก'.repeat(supportRequestFlow.MAX_MESSAGE_LENGTH + 1);
    expect(() => supportRequestFlow.validateMessage(tooLong)).toThrow(
      expect.objectContaining({ code: 'SUPPORT_REQUEST_MESSAGE_TOO_LONG' })
    );
  });

  test('พอดี MAX_MESSAGE_LENGTH เป๊ะ → ผ่าน (Boundary ไม่ปัดผิดด้าน)', () => {
    const exact = 'ก'.repeat(supportRequestFlow.MAX_MESSAGE_LENGTH);
    expect(supportRequestFlow.validateMessage(exact)).toBe(exact);
  });
});

describe('validateCategory — Backend ไม่เชื่อ Client เสมอ', () => {
  test.each(supportRequestFlow.CATEGORIES)('%s → ผ่าน คืนค่าเดิม', (category) => {
    expect(supportRequestFlow.validateCategory(category)).toBe(category);
  });

  test.each([['unknown_category'], [''], [null], [undefined]])(
    'ค่านอกเหนือ CATEGORIES (%j) → throw SUPPORT_REQUEST_INVALID_CATEGORY',
    (raw) => {
      expect(() => supportRequestFlow.validateCategory(raw)).toThrow(
        expect.objectContaining({ code: 'SUPPORT_REQUEST_INVALID_CATEGORY' })
      );
    }
  );
});

describe('pushSupportRequestToAdmins — Best-effort Push ทีละคน', () => {
  test('Push สำเร็จทั้ง 2 Admin → คืน 2', async () => {
    const count = await supportRequestFlow.pushSupportRequestToAdmins(USER, 'ข้อความ', 'other');

    expect(count).toBe(2);
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin1', expect.any(Object));
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin2', expect.any(Object));
  });

  test('Push ล้มเหลว 1 ใน 2 คน → คืน 1 (Best-effort ไม่กระทบคนอื่น)', async () => {
    lineService.pushMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('blocked'));

    const count = await supportRequestFlow.pushSupportRequestToAdmins(USER, 'ข้อความ', 'other');

    expect(count).toBe(1);
  });

  test('Push ล้มเหลวทั้งหมด → คืน 0 ไม่ throw', async () => {
    lineService.pushMessage.mockRejectedValue(new Error('down'));

    await expect(
      supportRequestFlow.pushSupportRequestToAdmins(USER, 'ข้อความ', 'other')
    ).resolves.toBe(0);
  });

  test('category = null (ไม่ระบุ) → ยัง Push ได้ปกติ', async () => {
    const count = await supportRequestFlow.pushSupportRequestToAdmins(USER, 'ข้อความ');
    expect(count).toBe(2);
  });
});

describe('recordRequest — บันทึก Log (เรียกหลัง Push เสร็จเท่านั้น)', () => {
  test('ส่ง adminCount/notifiedCount/category/source ที่คำนวณแล้วเข้า Repository ตรงๆ', async () => {
    await supportRequestFlow.recordRequest(USER.id, 'ข้อความ', {
      adminCount: 2,
      notifiedCount: 1,
      category: 'ocr',
      source: 'web',
    });

    expect(supportRequestRepository.create).toHaveBeenCalledWith({
      userId: USER.id,
      message: 'ข้อความ',
      adminCount: 2,
      notifiedCount: 1,
      category: 'ocr',
      source: 'web',
    });
  });

  test('Push ล้มเหลวทั้งหมด (notifiedCount=0) → ยัง Log ได้ปกติ ไม่ throw', async () => {
    await expect(
      supportRequestFlow.recordRequest(USER.id, 'ข้อความ', {
        adminCount: 2,
        notifiedCount: 0,
        category: 'other',
        source: 'web',
      })
    ).resolves.toEqual({ id: 'sr-1' });
  });
});
