// ═══════════════════════════════════════════════════════════════════════════
// freeTrial.service — กดรับ Premium ฟรี 1 เดือนเอง (แตะ Entitlement/รายได้ § 4.2)
// ═══════════════════════════════════════════════════════════════════════════
// เน้นพิสูจน์ 3 เรื่องที่พลาดแล้วเสียรายได้จริง:
//   1) Guard ทุกชั้นทำงาน (กดซ้ำ/เคยจ่ายเงิน/เคยได้ Grant/เป็น Premium อยู่/Flag ปิด)
//   2) ได้ Premium "1 เดือนเป๊ะ" ไม่ Stack ทบวันเก่าไม่ว่ากรณีใด
//   3) ไม่แตะตาราง payments เลย (ตัวเลขรายได้ใน /admin/stats ต้องไม่ขยับ)

jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/payment.repository');
jest.mock('../src/repositories/premiumGrantLog.repository');
jest.mock('../src/utils/logger.util');
// config/env Mock เพื่อคุม Feature Flag ให้ Deterministic (ไม่พึ่ง .env จริงในเครื่อง)
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return { ...actual, payment: { ...actual.payment, freeTrialEnabled: true } };
});
// entitlement.service จงใจ "ไม่" Mock — Pure Logic ตัวจริง เพื่อยืนยันว่า Free Trial
// ใช้ computeRenewalExpiry ตัวเดียวกับ Payment จริง ไม่ได้เขียนสูตรวันหมดอายุคู่ขนานใหม่

const config = require('../src/config/env');
const userRepository = require('../src/repositories/user.repository');
const paymentRepository = require('../src/repositories/payment.repository');
const premiumGrantLogRepository = require('../src/repositories/premiumGrantLog.repository');
const freeTrialService = require('../src/services/freeTrial.service');

const USER_ID = 'user-uuid-1';
const NOW = new Date('2026-08-01T00:00:00.000Z');
// computeRenewalExpiry(null,'monthly', NOW) → UTC +1 เดือนพอดี
const EXPECTED_EXPIRY_ISO = '2026-09-01T00:00:00.000Z';

// ผู้ใช้ที่ "มีสิทธิ์เต็ม" (ยังไม่เคยรับ / ไม่เคยจ่าย / เป็น Free อยู่) — เคสฐาน
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
  // Atomic Claim สำเร็จ (คืน user ที่อัปเดตแล้ว) — เคสที่ไม่มีใครชิงไปก่อน
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
});

describe('checkEligibility — Guard ทีละชั้น', () => {
  test('ผู้ใช้ใหม่ที่ยังไม่เคยมี Premium เลย → eligible', async () => {
    await expect(freeTrialService.checkEligibility(eligibleUser())).resolves.toEqual({
      eligible: true,
    });
  });

  test('Feature Flag ปิด → FEATURE_DISABLED (ไม่แตะ DB เลยสักครั้ง)', async () => {
    config.payment.freeTrialEnabled = false;

    const result = await freeTrialService.checkEligibility(eligibleUser());

    expect(result).toEqual({ eligible: false, reason: 'FEATURE_DISABLED' });
    expect(paymentRepository.findAllByUserId).not.toHaveBeenCalled();
    expect(premiumGrantLogRepository.findAllByUserId).not.toHaveBeenCalled();
  });

  test.each([
    ['บัญชีถูกล็อก', { isLocked: true }],
    ['บัญชีถูกลบข้อมูลตาม PDPA', { anonymizedAt: '2026-07-01T00:00:00.000Z' }],
  ])('%s → ACCOUNT_NOT_ELIGIBLE', async (_label, overrides) => {
    const result = await freeTrialService.checkEligibility(eligibleUser(overrides));
    expect(result.reason).toBe('ACCOUNT_NOT_ELIGIBLE');
  });

  test('เคยกดรับไปแล้ว → ALREADY_CLAIMED + บอกวันที่เคยรับ', async () => {
    const claimedAt = '2026-06-01T00:00:00.000Z';

    const result = await freeTrialService.checkEligibility(
      eligibleUser({ freeTrialClaimedAt: claimedAt })
    );

    expect(result).toEqual({ eligible: false, reason: 'ALREADY_CLAIMED', claimedAt });
  });

  test('เคยกดรับแล้วและ Premium หมดอายุไปแล้ว → ยัง ALREADY_CLAIMED (ครั้งเดียวตลอดชีพ)', async () => {
    // เคสสำคัญที่สุดของข้อกำหนด: หมดอายุแล้วต้องกดซ้ำไม่ได้ ต้องไปจ่ายเงินจริงเท่านั้น
    const result = await freeTrialService.checkEligibility(
      eligibleUser({
        plan: 'free',
        planExpiresAt: null,
        freeTrialClaimedAt: '2026-06-01T00:00:00.000Z',
      })
    );

    expect(result.reason).toBe('ALREADY_CLAIMED');
  });

  test('ตอนนี้เป็น Premium อยู่ → ALREADY_PREMIUM (ไม่ให้ซ้อนทบวัน)', async () => {
    const result = await freeTrialService.checkEligibility(
      eligibleUser({ plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' })
    );

    expect(result.reason).toBe('ALREADY_PREMIUM');
  });

  test('เคยจ่ายเงินสำเร็จมาก่อน (confirmed) → ALREADY_PAID_BEFORE', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([
      { id: 'pay-1', status: 'confirmed', amountThb: 59 },
    ]);

    const result = await freeTrialService.checkEligibility(eligibleUser());

    expect(result.reason).toBe('ALREADY_PAID_BEFORE');
  });

  test('เคยมีคำขอจ่ายเงินแต่ไม่สำเร็จ (pending/expired/rejected) → ยังกดรับได้', async () => {
    // คนที่เคยกดสร้าง QR แล้วไม่จ่าย ยังไม่เคยเป็นลูกค้าจริง จึงยังมีสิทธิ์
    paymentRepository.findAllByUserId.mockResolvedValue([
      { id: 'pay-1', status: 'pending' },
      { id: 'pay-2', status: 'expired' },
      { id: 'pay-3', status: 'rejected' },
    ]);

    await expect(freeTrialService.checkEligibility(eligibleUser())).resolves.toEqual({
      eligible: true,
    });
  });

  test('เคยได้ Premium ฟรีจาก Admin มาก่อน → ALREADY_GRANTED_BEFORE', async () => {
    premiumGrantLogRepository.findAllByUserId.mockResolvedValue([
      { id: 'log-1', grantedBy: 'Uadmin1', billingPeriod: 'monthly' },
    ]);

    const result = await freeTrialService.checkEligibility(eligibleUser());

    expect(result.reason).toBe('ALREADY_GRANTED_BEFORE');
  });

  test('user เป็น null → USER_NOT_FOUND', async () => {
    const result = await freeTrialService.checkEligibility(null);
    expect(result.reason).toBe('USER_NOT_FOUND');
  });
});

describe('claimFreeTrial — กดรับสำเร็จ', () => {
  test('ได้ Premium 1 เดือนเป๊ะ (now + 1 เดือน) ผ่าน Atomic Claim', async () => {
    const { user, newExpiry } = await freeTrialService.claimFreeTrial(USER_ID, NOW);

    expect(newExpiry.toISOString()).toBe(EXPECTED_EXPIRY_ISO);
    expect(user.plan).toBe('premium');
    expect(userRepository.claimFreeTrial).toHaveBeenCalledWith(USER_ID, newExpiry, NOW);
  });

  test('⚠️ ไม่ Stack ทบวันเดิมเด็ดขาด — แม้ผู้ใช้ยังมี planExpiresAt ค้างในอนาคต', async () => {
    // Defense in Depth: ต่อให้ Guard ALREADY_PREMIUM หลุด (เช่นถูกแก้ในอนาคต) จำนวนวัน
    // ที่ได้ต้องเป็น 1 เดือนนับจาก now เสมอ ไม่ใช่ต่อท้ายวันเดิม
    userRepository.findById.mockResolvedValue(
      // plan='free' (ผ่าน isPremiumActive) แต่มี planExpiresAt ค้างในอนาคต
      eligibleUser({ plan: 'free', planExpiresAt: '2099-01-01T00:00:00.000Z' })
    );

    const { newExpiry } = await freeTrialService.claimFreeTrial(USER_ID, NOW);

    expect(newExpiry.toISOString()).toBe(EXPECTED_EXPIRY_ISO);
    expect(newExpiry.getUTCFullYear()).toBe(2026);
  });

  test('บันทึก Audit Log ด้วย granted_by = self_service_free_trial (แยกจาก Admin Grant)', async () => {
    await freeTrialService.claimFreeTrial(USER_ID, NOW);

    expect(premiumGrantLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        grantedBy: 'self_service_free_trial',
        billingPeriod: 'monthly',
      })
    );
  });

  test('เขียน Audit Log พลาด → ยังถือว่าสำเร็จ (สิทธิ์ให้ไปแล้วจริง ห้ามตอบ Error)', async () => {
    premiumGrantLogRepository.create.mockRejectedValue(new Error('DB down'));

    await expect(freeTrialService.claimFreeTrial(USER_ID, NOW)).resolves.toMatchObject({
      newExpiry: expect.any(Date),
    });
  });

  test('🚩 ไม่แตะตาราง payments เลย — ตัวเลขรายได้ใน /admin/stats ต้องไม่ขยับ', async () => {
    await freeTrialService.claimFreeTrial(USER_ID, NOW);

    // อ่านได้ (ใช้เช็คว่าเคยจ่ายไหม) แต่ต้องไม่มีการ "เขียน" ใดๆ
    expect(paymentRepository.create).not.toHaveBeenCalled();
    expect(paymentRepository.claimForApproval).not.toHaveBeenCalled();
  });
});

describe('claimFreeTrial — ถูก Block', () => {
  // ลำดับ Element สำคัญ: [label, expectedCode, setup] — jest แทน %s ตามตำแหน่ง Argument
  // ถ้าเอา setup ไว้ตัวที่ 2 ชื่อ Test จะกลายเป็น Source Code ของฟังก์ชันทั้งก้อน
  test.each([
    ['Flag ปิด', 'FEATURE_DISABLED', () => { config.payment.freeTrialEnabled = false; }],
    [
      'เคยกดรับแล้ว',
      'ALREADY_CLAIMED',
      () => userRepository.findById.mockResolvedValue(
        eligibleUser({ freeTrialClaimedAt: '2026-06-01T00:00:00.000Z' })
      ),
    ],
    [
      'เคยจ่ายเงินสำเร็จ',
      'ALREADY_PAID_BEFORE',
      () => paymentRepository.findAllByUserId.mockResolvedValue([{ status: 'confirmed' }]),
    ],
    [
      'เคยได้ Admin Grant',
      'ALREADY_GRANTED_BEFORE',
      () => premiumGrantLogRepository.findAllByUserId.mockResolvedValue([{ id: 'log-1' }]),
    ],
    [
      'เป็น Premium อยู่แล้ว',
      'ALREADY_PREMIUM',
      () => userRepository.findById.mockResolvedValue(
        eligibleUser({ plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' })
      ),
    ],
    [
      'บัญชีถูกล็อก',
      'ACCOUNT_NOT_ELIGIBLE',
      () => userRepository.findById.mockResolvedValue(eligibleUser({ isLocked: true })),
    ],
  ])('%s → โยน %s และ "ไม่แตะสิทธิ์ผู้ใช้เลย"', async (_label, expectedCode, setup) => {
    setup();

    await expect(freeTrialService.claimFreeTrial(USER_ID, NOW)).rejects.toMatchObject({
      code: expectedCode,
    });

    // สำคัญ: ต้องไม่มีการเขียนสิทธิ์/Log ใดๆ เมื่อถูก Block
    expect(userRepository.claimFreeTrial).not.toHaveBeenCalled();
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
    expect(premiumGrantLogRepository.create).not.toHaveBeenCalled();
  });

  test('🔒 Race: Atomic Claim คืน null (มีคนชิงไปเสี้ยววินาที) → ALREADY_CLAIMED', async () => {
    // จำลองเคสกดรัว 2 ครั้งพร้อมกัน: ทั้งคู่ผ่าน Guard อ่านๆ แต่ UPDATE ... WHERE
    // free_trial_claimed_at IS NULL มีแค่ตัวเดียวที่ Match — อีกตัวได้ null กลับมา
    userRepository.claimFreeTrial.mockResolvedValue(null);

    await expect(freeTrialService.claimFreeTrial(USER_ID, NOW)).rejects.toMatchObject({
      code: 'ALREADY_CLAIMED',
    });
    // ต้องไม่เขียน Audit Log ให้ Request ที่แพ้ Race (ไม่งั้น Log จะมี 2 แถวทั้งที่
    // ให้สิทธิ์ครั้งเดียว)
    expect(premiumGrantLogRepository.create).not.toHaveBeenCalled();
  });
});
