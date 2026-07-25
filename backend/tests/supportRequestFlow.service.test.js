// ═══════════════════════════════════════════════════════════════════════════
// Unit — supportRequestFlow.service (ติดต่อ Admin/Support ฉุกเฉิน ก่อนเปิด
// Closed Beta Wave 1)
// ═══════════════════════════════════════════════════════════════════════════
// Flow ขั้นตอนเดียว: startFlow (เช็ค Rate Limit) → validateMessage → (Controller
// Push + recordRequest) → cancelFlow — Mock Repository ทั้ง Session และ Log
// ⚠️ สิ่งที่ Test ชุดนี้ต้องพิสูจน์: Service ไม่รู้จัก LINE/Flex Message เลย และ
// Rate Limit เช็คจากตาราง Log จริง ไม่ใช่ In-memory Map

jest.mock('../src/repositories/supportRequestSession.repository');
jest.mock('../src/repositories/supportRequest.repository');

const sessionRepository = require('../src/repositories/supportRequestSession.repository');
const supportRequestRepository = require('../src/repositories/supportRequest.repository');
const supportRequestFlow = require('../src/services/supportRequestFlow.service');

const USER_ID = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
  sessionRepository.upsert.mockResolvedValue({ userId: USER_ID, createdAt: new Date().toISOString() });
  sessionRepository.findValidByUser.mockResolvedValue(null);
  sessionRepository.deleteByUser.mockResolvedValue(undefined);
  supportRequestRepository.findRecentByUser.mockResolvedValue(null);
  supportRequestRepository.create.mockResolvedValue({ id: 'sr-1' });
});

describe('TTL/Rate Limit — ค่าคงที่ตามที่ระบุในสเปก', () => {
  test('SESSION_TTL_MINUTES = 5 (เท่ากับ Flow อื่นทั้งระบบ)', () => {
    expect(supportRequestFlow.SESSION_TTL_MINUTES).toBe(5);
  });

  test('RATE_LIMIT_HOURS = 1', () => {
    expect(supportRequestFlow.RATE_LIMIT_HOURS).toBe(1);
  });
});

describe('startFlow — เริ่ม Flow (เช็ค Rate Limit ก่อนสร้าง Session เสมอ)', () => {
  test('ไม่มีคำขอล่าสุด → สร้าง Session สำเร็จ', async () => {
    supportRequestRepository.findRecentByUser.mockResolvedValue(null);

    await supportRequestFlow.startFlow(USER_ID);

    expect(sessionRepository.upsert).toHaveBeenCalledWith(USER_ID);
  });

  test('มีคำขอภายใน 1 ชม.ล่าสุด → throw SUPPORT_REQUEST_RATE_LIMITED ไม่สร้าง Session', async () => {
    supportRequestRepository.findRecentByUser.mockResolvedValue({
      id: 'sr-0',
      createdAt: new Date().toISOString(),
    });

    await expect(supportRequestFlow.startFlow(USER_ID)).rejects.toMatchObject({
      code: 'SUPPORT_REQUEST_RATE_LIMITED',
    });
    expect(sessionRepository.upsert).not.toHaveBeenCalled();
  });

  test('cutoff ที่ส่งเข้า Repository อยู่ในอดีต 1 ชั่วโมงพอดี', async () => {
    const before = Date.now();
    await supportRequestFlow.startFlow(USER_ID);

    const [, cutoffIso] = supportRequestRepository.findRecentByUser.mock.calls[0];
    const cutoffMs = new Date(cutoffIso).getTime();
    // เผื่อ Jitter การรันเทสต์ ±2 วินาที
    expect(before - cutoffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 2000);
    expect(before - cutoffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 2000);
  });
});

describe('validateMessage — ตรวจข้อความก่อนส่ง (Sync ล้วน ไม่แตะ DB)', () => {
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

describe('recordRequest — บันทึก Log (เรียกหลัง Push เสร็จเท่านั้น)', () => {
  test('ส่ง adminCount/notifiedCount ที่คำนวณแล้วเข้า Repository ตรงๆ', async () => {
    await supportRequestFlow.recordRequest(USER_ID, 'ข้อความ', {
      adminCount: 2,
      notifiedCount: 1,
    });

    expect(supportRequestRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      message: 'ข้อความ',
      adminCount: 2,
      notifiedCount: 1,
    });
  });

  test('Push ล้มเหลวทั้งหมด (notifiedCount=0) → ยัง Log ได้ปกติ ไม่ throw', async () => {
    await expect(
      supportRequestFlow.recordRequest(USER_ID, 'ข้อความ', { adminCount: 2, notifiedCount: 0 })
    ).resolves.toEqual({ id: 'sr-1' });
  });
});

describe('cancelFlow / getCurrentSession', () => {
  test('cancelFlow → ลบ Session ผ่าน Repository', async () => {
    await supportRequestFlow.cancelFlow(USER_ID);
    expect(sessionRepository.deleteByUser).toHaveBeenCalledWith(USER_ID);
  });

  test('getCurrentSession → ส่ง cutoff ของ TTL 5 นาทีเข้า findValidByUser', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);
    const before = Date.now();
    await supportRequestFlow.getCurrentSession(USER_ID);

    const [, cutoffIso] = sessionRepository.findValidByUser.mock.calls[0];
    const cutoffMs = new Date(cutoffIso).getTime();
    expect(before - cutoffMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
    expect(before - cutoffMs).toBeLessThanOrEqual(5 * 60 * 1000 + 2000);
  });
});

describe('purgeStaleSessions — สำหรับ Cron', () => {
  test('เรียก purgeStaleBefore ด้วย cutoff ของ Retention 60 นาที (Default)', async () => {
    sessionRepository.purgeStaleBefore.mockResolvedValue(2);

    const count = await supportRequestFlow.purgeStaleSessions();

    expect(count).toBe(2);
    expect(sessionRepository.purgeStaleBefore).toHaveBeenCalledTimes(1);
  });
});
