// ═══════════════════════════════════════════════════════════════════════════
// facebookLikeGrant.service — Premium ฟรี 1 เดือน แลกกด Like Facebook (§ 4.2)
// ═══════════════════════════════════════════════════════════════════════════
// เน้นพิสูจน์ 4 เรื่องที่พลาดแล้วเสียรายได้จริง:
//   1) Guard ทุกชั้นทำงาน (เคยได้แคมเปญนี้/เคยกด Free Trial/เคยจ่ายเงิน/เป็น Premium
//      อยู่/เคยได้ Grant/มีคำขอค้าง/Flag ปิด)
//   2) ได้ Premium "1 เดือนเป๊ะ" ไม่ Stack ทบวันเก่าไม่ว่ากรณีใด
//   3) กัน Race ทั้ง 2 ชั้น (Claim คำขอ + Atomic Grant) — Admin กดพร้อมกันได้สิทธิ์ครั้งเดียว
//   4) ไม่แตะตาราง payments เลย (ตัวเลขรายได้ใน /admin/stats ต้องไม่ขยับ)

jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/payment.repository');
jest.mock('../src/repositories/premiumGrantLog.repository');
jest.mock('../src/repositories/facebookLikeGrantRequest.repository');
jest.mock('../src/utils/logger.util');
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return { ...actual, payment: { ...actual.payment, facebookLikeGrantEnabled: true } };
});
// entitlement.service จงใจ "ไม่" Mock — Pure Logic ตัวจริง เพื่อยืนยันว่าแคมเปญนี้ใช้
// computeRenewalExpiry ตัวเดียวกับ Payment จริง ไม่ได้เขียนสูตรวันหมดอายุคู่ขนานใหม่

const config = require('../src/config/env');
const userRepository = require('../src/repositories/user.repository');
const paymentRepository = require('../src/repositories/payment.repository');
const premiumGrantLogRepository = require('../src/repositories/premiumGrantLog.repository');
const requestRepository = require('../src/repositories/facebookLikeGrantRequest.repository');
const service = require('../src/services/facebookLikeGrant.service');

const USER_ID = 'user-uuid-1';
const REQUEST_ID = 'req-uuid-1';
const ADMIN_LINE_ID = 'U-admin-1';
const NOW = new Date('2026-08-01T00:00:00.000Z');
const EXPECTED_EXPIRY_ISO = '2026-09-01T00:00:00.000Z';
const SCREENSHOT_PATH = `${USER_ID}-1754006400000.jpg`;

function eligibleUser(overrides = {}) {
  return {
    id: USER_ID,
    lineUserId: 'U-line-1',
    plan: 'free',
    planExpiresAt: null,
    isLocked: false,
    anonymizedAt: null,
    freeTrialClaimedAt: null,
    facebookLikeGrantedAt: null,
    ...overrides,
  };
}

function pendingRequest(overrides = {}) {
  return {
    id: REQUEST_ID,
    userId: USER_ID,
    screenshotPath: SCREENSHOT_PATH,
    message: null,
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  config.payment.facebookLikeGrantEnabled = true;

  userRepository.findById.mockResolvedValue(eligibleUser());
  userRepository.grantFacebookLikePremium.mockImplementation(async (id, expiresAt, now) => ({
    ...eligibleUser(),
    id,
    plan: 'premium',
    planExpiresAt: expiresAt,
    facebookLikeGrantedAt: now,
  }));
  paymentRepository.findAllByUserId.mockResolvedValue([]);
  premiumGrantLogRepository.findAllByUserId.mockResolvedValue([]);
  premiumGrantLogRepository.create.mockResolvedValue({ id: 'log-1' });
  requestRepository.findPendingByUserId.mockResolvedValue(null);
  requestRepository.findById.mockResolvedValue(pendingRequest());
  requestRepository.create.mockImplementation(async (d) => pendingRequest({ message: d.message }));
  requestRepository.claimForReview.mockImplementation(async (id, opts) =>
    pendingRequest({ id, status: opts.status, reviewedBy: opts.reviewedBy, rejectReason: opts.rejectReason ?? null })
  );
});

describe('checkEligibility — Guard ทุกชั้น', () => {
  test('ผู้ใช้ปกติที่ยังไม่เคยได้อะไร → eligible', async () => {
    await expect(service.checkEligibility(eligibleUser())).resolves.toEqual({ eligible: true });
  });

  test('Flag ปิด → FEATURE_DISABLED และไม่แตะ DB เลย', async () => {
    config.payment.facebookLikeGrantEnabled = false;

    const result = await service.checkEligibility(eligibleUser());

    expect(result).toEqual({ eligible: false, reason: 'FEATURE_DISABLED' });
    expect(paymentRepository.findAllByUserId).not.toHaveBeenCalled();
    expect(premiumGrantLogRepository.findAllByUserId).not.toHaveBeenCalled();
  });

  test('เคยได้สิทธิ์แคมเปญนี้แล้ว → ALREADY_GRANTED (Guard หลัก คอลัมน์เดียวกับ Atomic Grant)', async () => {
    const result = await service.checkEligibility(
      eligibleUser({ facebookLikeGrantedAt: '2026-07-01T00:00:00.000Z' })
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ALREADY_GRANTED');
  });

  test('🔒 กันข้ามแคมเปญ: เคยกด Free Trial แล้ว → ALREADY_USED_FREE_TRIAL (ไม่ให้ได้ฟรี 2 เดือน)', async () => {
    const result = await service.checkEligibility(
      eligibleUser({ freeTrialClaimedAt: '2026-07-01T00:00:00.000Z' })
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ALREADY_USED_FREE_TRIAL');
  });

  test('เป็น Premium อยู่แล้ว → ALREADY_PREMIUM (ไม่แจกฟรีให้คนที่มีอยู่แล้ว)', async () => {
    const result = await service.checkEligibility(
      eligibleUser({ plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' })
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ALREADY_PREMIUM');
  });

  test('เคยจ่ายเงินสำเร็จมาก่อน → ALREADY_PAID_BEFORE', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([{ status: 'confirmed' }]);

    const result = await service.checkEligibility(eligibleUser());

    expect(result.reason).toBe('ALREADY_PAID_BEFORE');
  });

  test('เคยได้ Admin Grant มาก่อน → ALREADY_GRANTED_BEFORE', async () => {
    premiumGrantLogRepository.findAllByUserId.mockResolvedValue([{ id: 'log-x' }]);

    const result = await service.checkEligibility(eligibleUser());

    expect(result.reason).toBe('ALREADY_GRANTED_BEFORE');
  });

  test('มีคำขอค้างรอตรวจอยู่ → REQUEST_ALREADY_PENDING พร้อม requestId', async () => {
    requestRepository.findPendingByUserId.mockResolvedValue(pendingRequest());

    const result = await service.checkEligibility(eligibleUser());

    expect(result.reason).toBe('REQUEST_ALREADY_PENDING');
    expect(result.requestId).toBe(REQUEST_ID);
  });

  test('บัญชีถูกล็อก/Anonymize → ACCOUNT_NOT_ELIGIBLE', async () => {
    await expect(service.checkEligibility(eligibleUser({ isLocked: true }))).resolves.toMatchObject({
      reason: 'ACCOUNT_NOT_ELIGIBLE',
    });
    await expect(
      service.checkEligibility(eligibleUser({ anonymizedAt: '2026-07-01T00:00:00.000Z' }))
    ).resolves.toMatchObject({ reason: 'ACCOUNT_NOT_ELIGIBLE' });
  });
});

describe('submitRequest — ผู้ใช้ส่งคำขอ', () => {
  test('สำเร็จ → สร้างแถว pending พร้อม screenshotPath', async () => {
    const request = await service.submitRequest(USER_ID, SCREENSHOT_PATH, 'ไลก์ด้วยชื่อ FB: Somchai');

    expect(requestRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      screenshotPath: SCREENSHOT_PATH,
      message: 'ไลก์ด้วยชื่อ FB: Somchai',
    });
    expect(request.status).toBe('pending');
  });

  test('ไม่มี screenshotPath → SCREENSHOT_REQUIRED (ไม่แตะ DB)', async () => {
    await expect(service.submitRequest(USER_ID, null)).rejects.toMatchObject({
      code: 'SCREENSHOT_REQUIRED',
    });
    expect(requestRepository.create).not.toHaveBeenCalled();
  });

  test('ข้อความยาวเกิน → MESSAGE_TOO_LONG', async () => {
    const tooLong = 'ก'.repeat(service.MAX_MESSAGE_LENGTH + 1);

    await expect(service.submitRequest(USER_ID, SCREENSHOT_PATH, tooLong)).rejects.toMatchObject({
      code: 'MESSAGE_TOO_LONG',
    });
    expect(requestRepository.create).not.toHaveBeenCalled();
  });

  test('ไม่ผ่าน Guard (เคยได้แล้ว) → โยน Error ไม่สร้างแถว', async () => {
    userRepository.findById.mockResolvedValue(
      eligibleUser({ facebookLikeGrantedAt: '2026-07-01T00:00:00.000Z' })
    );

    await expect(service.submitRequest(USER_ID, SCREENSHOT_PATH)).rejects.toMatchObject({
      code: 'ALREADY_GRANTED',
    });
    expect(requestRepository.create).not.toHaveBeenCalled();
  });

  test('🔒 Race: ชน Partial Unique Index (23505) → REQUEST_ALREADY_PENDING ไม่ใช่ 500', async () => {
    const dbErr = new Error('duplicate key value violates unique constraint');
    dbErr.code = '23505';
    requestRepository.create.mockRejectedValue(dbErr);

    await expect(service.submitRequest(USER_ID, SCREENSHOT_PATH)).rejects.toMatchObject({
      code: 'REQUEST_ALREADY_PENDING',
    });
  });
});

describe('approveRequest — Admin อนุมัติ → ให้ Premium 1 เดือน', () => {
  test('สำเร็จ → ได้ 1 เดือนเป๊ะ + Claim คำขอ + เขียน Audit Log', async () => {
    const result = await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    // 1 เดือนเป๊ะจาก now
    expect(result.newExpiry.toISOString()).toBe(EXPECTED_EXPIRY_ISO);
    // Claim คำขอด้วยสถานะ approved
    expect(requestRepository.claimForReview).toHaveBeenCalledWith(
      REQUEST_ID,
      expect.objectContaining({ status: 'approved', reviewedBy: ADMIN_LINE_ID })
    );
    // Atomic Grant ด้วยคอลัมน์ของแคมเปญนี้
    expect(userRepository.grantFacebookLikePremium).toHaveBeenCalledWith(USER_ID, expect.any(Date), NOW);
    expect(result.user.plan).toBe('premium');
  });

  test('🔒 ไม่ Stack: ผู้ใช้ที่ยังมีวันเหลือ ก็ยังได้ 1 เดือนจาก now เท่านั้น', async () => {
    // ยังมี Premium เหลือถึงสิ้นปี แต่ Guard ALREADY_PREMIUM ถูกข้ามมา (จำลอง Guard หลุด)
    // — computeRenewalExpiry ต้องถูกเรียกด้วย null เสมอ ไม่ใช่ planExpiresAt เดิม
    userRepository.findById.mockResolvedValue(
      eligibleUser({ plan: 'free', planExpiresAt: '2026-12-31T00:00:00.000Z' })
    );

    const result = await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    // ถ้า Stack จะได้ 2027-01-31 — ต้องเป็น 1 เดือนจาก now เท่านั้น
    expect(result.newExpiry.toISOString()).toBe(EXPECTED_EXPIRY_ISO);
  });

  test('Audit Log เขียนลง premium_grant_logs ด้วย granted_by ที่ระบุแคมเปญ + Admin', async () => {
    await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    expect(premiumGrantLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        grantedBy: `${service.GRANTED_BY_PREFIX}:${ADMIN_LINE_ID}`,
        billingPeriod: 'monthly',
      })
    );
  });

  test('Audit Log ล้มเหลว → ยังถือว่า Approve สำเร็จ (ไม่ Rollback สิทธิ์ที่ให้ไปแล้ว)', async () => {
    premiumGrantLogRepository.create.mockRejectedValue(new Error('log table down'));

    const result = await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    expect(result.user.plan).toBe('premium');
    expect(result.newExpiry.toISOString()).toBe(EXPECTED_EXPIRY_ISO);
  });

  test('🔒 Race: Admin สองคนกดพร้อมกัน (claimForReview คืน null) → ALREADY_RESOLVED ไม่ Grant ซ้ำ', async () => {
    requestRepository.claimForReview.mockResolvedValue(null);

    await expect(service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW)).rejects.toMatchObject({
      code: 'ALREADY_RESOLVED',
    });
    expect(userRepository.grantFacebookLikePremium).not.toHaveBeenCalled();
  });

  test('🔒 Race ชั้นสอง: Atomic Grant คืน null (คอลัมน์ Guard ไม่ NULL แล้ว) → ALREADY_GRANTED', async () => {
    userRepository.grantFacebookLikePremium.mockResolvedValue(null);

    await expect(service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW)).rejects.toMatchObject({
      code: 'ALREADY_GRANTED',
    });
  });

  test('ผู้ใช้ไปจ่ายเงินจริงระหว่างรอตรวจ → ปฏิเสธการอนุมัติ (ตรวจสิทธิ์ซ้ำ ณ เวลาที่กด)', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([{ status: 'confirmed' }]);

    await expect(service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW)).rejects.toMatchObject({
      code: 'ALREADY_PAID_BEFORE',
    });
    expect(userRepository.grantFacebookLikePremium).not.toHaveBeenCalled();
  });

  test('คำขอที่กำลังอนุมัติเองไม่ถูกนับเป็น REQUEST_ALREADY_PENDING (ไม่งั้นอนุมัติไม่ได้เลยสักใบ)', async () => {
    // จำลองสถานการณ์จริง: คำขอใบนี้ค้าง pending อยู่ (ซึ่งเป็นเรื่องปกติตอน Admin กด)
    requestRepository.findPendingByUserId.mockResolvedValue(pendingRequest());

    const result = await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    expect(result.user.plan).toBe('premium');
  });

  test('ไม่พบคำขอ → REQUEST_NOT_FOUND', async () => {
    requestRepository.findById.mockResolvedValue(null);

    await expect(service.approveRequest('nope', ADMIN_LINE_ID, NOW)).rejects.toMatchObject({
      code: 'REQUEST_NOT_FOUND',
    });
  });
});

describe('rejectRequest — Admin ปฏิเสธ', () => {
  test('สำเร็จ → Claim เป็น rejected พร้อมเหตุผล และไม่แตะสิทธิ์ผู้ใช้เลย', async () => {
    const result = await service.rejectRequest(REQUEST_ID, ADMIN_LINE_ID, 'รูปไม่ชัด');

    expect(requestRepository.claimForReview).toHaveBeenCalledWith(
      REQUEST_ID,
      expect.objectContaining({ status: 'rejected', reviewedBy: ADMIN_LINE_ID, rejectReason: 'รูปไม่ชัด' })
    );
    expect(result.request.status).toBe('rejected');
    // ห้ามแตะ plan/สิทธิ์
    expect(userRepository.grantFacebookLikePremium).not.toHaveBeenCalled();
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
  });

  test('คำขอถูก Resolve ไปแล้ว → ALREADY_RESOLVED', async () => {
    requestRepository.claimForReview.mockResolvedValue(null);
    requestRepository.findById.mockResolvedValue(pendingRequest({ status: 'approved' }));

    await expect(service.rejectRequest(REQUEST_ID, ADMIN_LINE_ID)).rejects.toMatchObject({
      code: 'ALREADY_RESOLVED',
    });
  });

  test('ไม่พบคำขอ → REQUEST_NOT_FOUND', async () => {
    requestRepository.claimForReview.mockResolvedValue(null);
    requestRepository.findById.mockResolvedValue(null);

    await expect(service.rejectRequest('nope', ADMIN_LINE_ID)).rejects.toMatchObject({
      code: 'REQUEST_NOT_FOUND',
    });
  });
});

// ── Regression: ต้องไม่กระทบ Payment Flow จริง / Free Trial เดิม ────────────────
describe('Regression — ไม่แตะรายได้และแคมเปญเดิม', () => {
  test('การอนุมัติ "ไม่สร้าง/ไม่แก้" แถวใน payments เลย (/admin/stats รายได้ไม่ขยับ)', async () => {
    await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    expect(paymentRepository.create).not.toHaveBeenCalled();
    expect(paymentRepository.claimForApproval).not.toHaveBeenCalled();
    expect(paymentRepository.claimForRejection).not.toHaveBeenCalled();
    expect(paymentRepository.markExpired).not.toHaveBeenCalled();
  });

  test('ให้สิทธิ์ผ่าน grantFacebookLikePremium เท่านั้น — ไม่เรียก updatePlan/claimFreeTrial', async () => {
    await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    expect(userRepository.grantFacebookLikePremium).toHaveBeenCalledTimes(1);
    // updatePlan = ทางของ payment/adminGrant | claimFreeTrial = ทางของแคมเปญอื่น
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
    expect(userRepository.claimFreeTrial).not.toHaveBeenCalled();
  });

  test('เขียน premium_grant_logs ด้วย → ทำให้ Free Trial เดิมบล็อกคนนี้เองอัตโนมัติ (Cross-campaign)', async () => {
    // แคมเปญนี้เขียน Log ลงตารางเดียวกับที่ freeTrial Guard ข้อ 6 อ่าน — จึงไม่ต้องแก้
    // freeTrial.service เลย นี่คือกลไกที่ทำให้ "ได้แคมเปญนี้แล้วกด Free Trial ไม่ได้"
    await service.approveRequest(REQUEST_ID, ADMIN_LINE_ID, NOW);

    expect(premiumGrantLogRepository.create).toHaveBeenCalledTimes(1);
  });
});
