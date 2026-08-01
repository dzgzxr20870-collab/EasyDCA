// ═══════════════════════════════════════════════════════════════════════════
// Integration — Endpoint Free Trial ทะลุถึง Service จริง (Mock แค่ Repository)
// ═══════════════════════════════════════════════════════════════════════════
// ต่างจาก freeTrial.service.test.js (Unit — Mock Service Dependency): ไฟล์นี้ใช้
// freeTrial.service "ตัวจริง" เพื่อพิสูจน์ว่า Controller ต่อกับ Service ถูก และ Map
// HTTP Status/ข้อความไทยครบทุก Error Code ที่ Service โยนได้จริง (ไม่มี Code ไหนหลุด
// ไปเป็น 500 "เกิดข้อผิดพลาดภายในระบบ" ทั้งที่ผู้ใช้แก้เองได้)

jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/payment.repository');
jest.mock('../src/repositories/premiumGrantLog.repository');
jest.mock('../src/services/line.service');
jest.mock('../src/utils/logger.util');
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    payment: { ...actual.payment, freeTrialEnabled: true },
    app: { ...actual.app, frontendUrl: 'https://app.easydca.test' },
  };
});

const config = require('../src/config/env');
const userRepository = require('../src/repositories/user.repository');
const paymentRepository = require('../src/repositories/payment.repository');
const premiumGrantLogRepository = require('../src/repositories/premiumGrantLog.repository');
const lineService = require('../src/services/line.service');
const paymentController = require('../src/controllers/payment.controller');

const USER_ID = 'user-uuid-1';

function mockReq() {
  return { user: { id: USER_ID }, body: {} };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const jsonOf = (res) => res.json.mock.calls[0][0];
const statusOf = (res) => res.status.mock.calls[0][0];

function eligibleUser(overrides = {}) {
  return {
    id: USER_ID,
    lineUserId: 'U-line-1',
    plan: 'free',
    planExpiresAt: null,
    isLocked: false,
    anonymizedAt: null,
    freeTrialClaimedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  config.payment.freeTrialEnabled = true;

  userRepository.findById.mockResolvedValue(eligibleUser());
  userRepository.claimFreeTrial.mockImplementation(async (id, expiresAt, now) => ({
    ...eligibleUser(),
    id,
    plan: 'premium',
    planExpiresAt: expiresAt,
    freeTrialClaimedAt: now,
  }));
  paymentRepository.findAllByUserId.mockResolvedValue([]);
  premiumGrantLogRepository.findAllByUserId.mockResolvedValue([]);
  premiumGrantLogRepository.create.mockResolvedValue({ id: 'log-1' });
  lineService.pushMessage.mockResolvedValue(undefined);
});

describe('GET /payment/free-trial — เช็คสิทธิ์', () => {
  test('มีสิทธิ์ → 200 { enabled:true, eligible:true }', async () => {
    const res = mockRes();
    await paymentController.getFreeTrialStatus(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res)).toMatchObject({ enabled: true, eligible: true, reason: null });
  });

  test('ไม่มีสิทธิ์ → ยัง 200 (ไม่ใช่ Error — เป็นการ "ถามสถานะ") พร้อมเหตุผลไทย', async () => {
    userRepository.findById.mockResolvedValue(
      eligibleUser({ freeTrialClaimedAt: '2026-06-01T00:00:00.000Z' })
    );

    const res = mockRes();
    await paymentController.getFreeTrialStatus(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res)).toMatchObject({
      eligible: false,
      reason: 'ALREADY_CLAIMED',
      claimedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(jsonOf(res).message).toMatch(/ใช้สิทธิ์.*ไปแล้ว/);
  });

  test('Flag ปิด → enabled:false (Frontend ใช้ซ่อน Banner ทั้งก้อน)', async () => {
    config.payment.freeTrialEnabled = false;

    const res = mockRes();
    await paymentController.getFreeTrialStatus(mockReq(), res);

    expect(jsonOf(res)).toMatchObject({ enabled: false, eligible: false, reason: 'FEATURE_DISABLED' });
  });

  test('ไม่โชว์ Error Code ดิบให้ผู้ใช้ — ทุกเหตุผลมีข้อความไทยกำกับ', async () => {
    const cases = [
      [eligibleUser({ isLocked: true }), 'ACCOUNT_NOT_ELIGIBLE'],
      [eligibleUser({ plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' }), 'ALREADY_PREMIUM'],
    ];
    for (const [user, expectedReason] of cases) {
      jest.clearAllMocks();
      userRepository.findById.mockResolvedValue(user);
      paymentRepository.findAllByUserId.mockResolvedValue([]);
      premiumGrantLogRepository.findAllByUserId.mockResolvedValue([]);

      const res = mockRes();
      await paymentController.getFreeTrialStatus(mockReq(), res);

      expect(jsonOf(res).reason).toBe(expectedReason);
      expect(typeof jsonOf(res).message).toBe('string');
      expect(jsonOf(res).message.length).toBeGreaterThan(0);
    }
  });
});

describe('POST /payment/free-trial/claim — กดรับ', () => {
  test('สำเร็จ → 200 + plan=premium + วันหมดอายุ 1 เดือนข้างหน้า', async () => {
    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    const body = jsonOf(res);
    expect(body.status).toBe('claimed');
    expect(body.plan).toBe('premium');

    // ~1 เดือนจากตอนนี้ (เทียบหยาบระดับวัน กัน Flaky จากเวลาที่รัน Test)
    const diffDays = (new Date(body.planExpiresAt) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(27);
    expect(diffDays).toBeLessThan(32);
  });

  test('userId มาจาก JWT เท่านั้น — ส่ง userId ปลอมใน Body ต้องไม่มีผล', async () => {
    const req = { user: { id: USER_ID }, body: { userId: 'someone-else-uuid' } };

    const res = mockRes();
    await paymentController.claimFreeTrial(req, res);

    expect(userRepository.claimFreeTrial).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Date),
      expect.any(Date)
    );
  });

  test.each([
    ['ALREADY_CLAIMED', () => userRepository.findById.mockResolvedValue(
      eligibleUser({ freeTrialClaimedAt: '2026-06-01T00:00:00.000Z' })
    )],
    ['ALREADY_PAID_BEFORE', () => paymentRepository.findAllByUserId.mockResolvedValue([
      { status: 'confirmed' },
    ])],
    ['ALREADY_GRANTED_BEFORE', () => premiumGrantLogRepository.findAllByUserId.mockResolvedValue([
      { id: 'log-1' },
    ])],
    ['ALREADY_PREMIUM', () => userRepository.findById.mockResolvedValue(
      eligibleUser({ plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' })
    )],
    ['ACCOUNT_NOT_ELIGIBLE', () => userRepository.findById.mockResolvedValue(
      eligibleUser({ isLocked: true })
    )],
  ])('%s → 403 + ข้อความไทย (ไม่ใช่ 500) และไม่ให้สิทธิ์', async (expectedCode, setup) => {
    setup();

    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe(expectedCode);
    expect(typeof jsonOf(res).message).toBe('string');
    expect(userRepository.claimFreeTrial).not.toHaveBeenCalled();
  });

  test('Flag ปิด → 403 FEATURE_DISABLED (แคมเปญปิดแล้วกดไม่ได้)', async () => {
    config.payment.freeTrialEnabled = false;

    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('FEATURE_DISABLED');
    expect(userRepository.claimFreeTrial).not.toHaveBeenCalled();
  });

  test('🔒 กดรัวพร้อมกัน (Atomic Claim คืน null) → 403 ALREADY_CLAIMED ไม่ใช่ 500', async () => {
    userRepository.claimFreeTrial.mockResolvedValue(null);

    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('ALREADY_CLAIMED');
  });

  test('Error ที่ไม่คาดคิด → 500 โดยไม่หลุด Error ดิบถึง Client', async () => {
    userRepository.claimFreeTrial.mockRejectedValue(new Error('boom: secret internals'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(500);
    expect(JSON.stringify(jsonOf(res))).not.toMatch(/secret internals/);
    console.error.mockRestore();
  });
});

describe('POST /payment/free-trial/claim — LINE Push แจ้งหลังกดรับสำเร็จ', () => {
  test('Push สำเร็จ → ส่งหา lineUserId ของผู้ใช้ พร้อมวันเริ่ม/วันหมดอายุตรงกับที่ Claim จริง', async () => {
    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    const body = jsonOf(res);

    expect(lineService.pushMessage).toHaveBeenCalledTimes(1);
    const [toLineUserId, message] = lineService.pushMessage.mock.calls[0];
    expect(toLineUserId).toBe('U-line-1');

    // ดึงข้อความจาก Flex ไปเทียบว่าไม่ได้เพี้ยนจากค่าที่ตอบ Client (วันเดียวกันเป๊ะ)
    // ใช้ Intl แปลง Asia/Bangkok เดียวกับที่ flexMessage.util ใช้จริง — ห้ามเทียบด้วย
    // slice(0,10) ตรงๆ กับ ISO UTC เพราะช่วง 17:00-23:59 UTC จะข้ามวันกัน (Flaky)
    const expectedExpiryDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
    }).format(new Date(body.planExpiresAt));
    const flexText = JSON.stringify(message);
    expect(flexText).toContain('รับ Premium ฟรี 1 เดือนสำเร็จ');
    expect(flexText).toContain(expectedExpiryDate);
    // มีปุ่มลิงก์ External Browser ไปหน้า /premium (Reuse externalUrl.util)
    expect(flexText).toContain('https://app.easydca.test/premium');
    expect(flexText).toContain('openExternalBrowser=1');
  });

  test('ไม่มี lineUserId (ถูก Anonymize) → ข้ามการ Push เงียบๆ ไม่กระทบ Claim', async () => {
    userRepository.findById.mockResolvedValue(eligibleUser({ lineUserId: null }));
    userRepository.claimFreeTrial.mockImplementation(async (id, expiresAt, now) => ({
      ...eligibleUser({ lineUserId: null }),
      id,
      plan: 'premium',
      planExpiresAt: expiresAt,
      freeTrialClaimedAt: now,
    }));

    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });

  test('Push ล้มเหลว (LINE API Error) → Claim ยัง Commit สำเร็จ ตอบ 200 ตามปกติ (Push เป็น Side Effect ไม่ใช่ Ledger หลัก)', async () => {
    lineService.pushMessage.mockRejectedValue(new Error('LINE API down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).status).toBe('claimed');
    expect(userRepository.claimFreeTrial).toHaveBeenCalledTimes(1);
    console.error.mockRestore();
  });
});

// ── Regression: Payment Flow จริง (QR จ่ายเงิน) ต้องไม่ถูกกระทบ ────────────────
describe('Regression — Free Trial ไม่แตะ Payment Flow จริง', () => {
  test('การกดรับฟรี "ไม่สร้าง/ไม่แก้" แถวใน payments เลย (รายได้ /admin/stats ไม่ขยับ)', async () => {
    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(statusOf(res)).toBe(200);
    // อ่าน payments ได้ (ใช้เช็คว่าเคยจ่ายไหม) แต่ห้ามเขียนใดๆ
    expect(paymentRepository.create).not.toHaveBeenCalled();
    expect(paymentRepository.claimForApproval).not.toHaveBeenCalled();
    expect(paymentRepository.claimForRejection).not.toHaveBeenCalled();
    expect(paymentRepository.markExpired).not.toHaveBeenCalled();
  });

  test('ให้สิทธิ์ผ่าน claimFreeTrial (Atomic) เท่านั้น — ไม่เรียก updatePlan ที่ Payment ใช้', async () => {
    // updatePlan เป็นทางของ payment.approvePayment/adminGrant — Free Trial ต้องใช้
    // ทางของตัวเองที่มี Guard Atomic ติดมาด้วย ไม่งั้นจะกันกดซ้ำไม่ได้
    const res = mockRes();
    await paymentController.claimFreeTrial(mockReq(), res);

    expect(userRepository.claimFreeTrial).toHaveBeenCalledTimes(1);
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
  });
});
