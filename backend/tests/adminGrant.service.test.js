jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/premiumGrantLog.repository');
// entitlement.service ไม่ Mock (Pure Logic — computeRenewalExpiry ตัวจริง) เพื่อยืนยัน
// ว่า Grant ใช้ Stacking Logic เดียวกับ payment จริง ไม่ได้เขียนคู่ขนานใหม่
// logger ไม่ Mock (เขียน console เฉยๆ ไม่มี Side-effect ต่อ Assertion)

const userRepository = require('../src/repositories/user.repository');
const premiumGrantLogRepository = require('../src/repositories/premiumGrantLog.repository');
const { grantPremium, AdminGrantError } = require('../src/services/adminGrant.service');

const USER_ID = 'user-uuid-1';
const ADMIN_LINE_ID = 'Uadmin1';

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.updatePlan.mockImplementation(async (id, plan, expiresAt) => ({
    id,
    plan,
    planExpiresAt: expiresAt,
  }));
  premiumGrantLogRepository.create.mockResolvedValue({ id: 'log-1' });
});

describe('adminGrant.grantPremium — Validation', () => {
  test('billingPeriod ไม่ถูกต้อง → VALIDATION_ERROR (ไม่แตะ user/plan)', async () => {
    await expect(grantPremium(USER_ID, 'weekly', ADMIN_LINE_ID)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
    expect(premiumGrantLogRepository.create).not.toHaveBeenCalled();
  });

  test('ไม่พบผู้ใช้ → USER_NOT_FOUND (ไม่ updatePlan/ไม่บันทึก Log)', async () => {
    userRepository.findById.mockResolvedValue(null);
    await expect(grantPremium(USER_ID, 'monthly', ADMIN_LINE_ID)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    expect(userRepository.updatePlan).not.toHaveBeenCalled();
    expect(premiumGrantLogRepository.create).not.toHaveBeenCalled();
  });

  test('Error เป็น instance ของ AdminGrantError', async () => {
    userRepository.findById.mockResolvedValue(null);
    await expect(grantPremium(USER_ID, 'monthly', ADMIN_LINE_ID)).rejects.toBeInstanceOf(
      AdminGrantError
    );
  });
});

describe('adminGrant.grantPremium — Stacking (Reuse entitlement.computeRenewalExpiry)', () => {
  test('Free (ไม่มีวันหมดอายุ) grant monthly → เริ่มนับจาก now + 1 เดือน + เขียน plan=premium', async () => {
    userRepository.findById.mockResolvedValue({ id: USER_ID, plan: 'free', planExpiresAt: null });

    const before = Date.now();
    const { user, newExpiry } = await grantPremium(USER_ID, 'monthly', ADMIN_LINE_ID);

    // เขียน users.plan = premium (ไม่ผ่าน payments เลย)
    expect(userRepository.updatePlan).toHaveBeenCalledWith(USER_ID, 'premium', newExpiry);
    expect(user.plan).toBe('premium');
    // ~1 เดือนจากตอนนี้ (ไม่ใช่จากอดีต) — ตรวจว่าอยู่ในอนาคต 25-35 วัน
    const days = (newExpiry.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(25);
    expect(days).toBeLessThan(40);
  });

  test('Premium ยังไม่หมด grant monthly → ต่อจากวันหมดอายุเดิม (ไม่เสียวันที่เหลือ)', async () => {
    // เหลืออีก ~60 วัน
    const currentExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    userRepository.findById.mockResolvedValue({
      id: USER_ID,
      plan: 'premium',
      planExpiresAt: currentExpiry.toISOString(),
    });

    const { newExpiry } = await grantPremium(USER_ID, 'monthly', ADMIN_LINE_ID);

    // ต่อจากวันหมดอายุเดิม +1 เดือน → มากกว่าวันหมดอายุเดิมเสมอ (Stacking)
    expect(newExpiry.getTime()).toBeGreaterThan(currentExpiry.getTime());
    // อยู่ราวๆ 88-92 วันจากตอนนี้ (60 + ~30)
    const days = (newExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(85);
    expect(days).toBeLessThan(95);
  });

  test('Premium หมดอายุแล้ว grant → เริ่มนับจาก now (ไม่ต่อจากอดีต)', async () => {
    const pastExpiry = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    userRepository.findById.mockResolvedValue({
      id: USER_ID,
      plan: 'premium',
      planExpiresAt: pastExpiry.toISOString(),
    });

    const { newExpiry } = await grantPremium(USER_ID, 'yearly', ADMIN_LINE_ID);

    // ปีละ → ~365 วันจากตอนนี้ (ไม่ใช่จากอดีตที่หมดไปแล้ว)
    const days = (newExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });
});

describe('adminGrant.grantPremium — Audit Trail (ไม่นับเป็นรายได้)', () => {
  test('บันทึก premium_grant_logs (ไม่ใช่ payments) — ใคร/ให้ใคร/รอบบิล/วันหมดอายุใหม่', async () => {
    userRepository.findById.mockResolvedValue({ id: USER_ID, plan: 'free', planExpiresAt: null });

    const { newExpiry } = await grantPremium(USER_ID, 'monthly', ADMIN_LINE_ID);

    expect(premiumGrantLogRepository.create).toHaveBeenCalledTimes(1);
    expect(premiumGrantLogRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      grantedBy: ADMIN_LINE_ID,
      billingPeriod: 'monthly',
      newExpiresAt: newExpiry,
    });
  });

  // Partial-Success Guard (Best-effort Log) — updatePlan สำเร็จแต่เขียน Log พลาด ต้อง
  // "ไม่" throw (User ได้ Premium จริงแล้ว) แค่ console.error ไว้สืบย้อนหลัง — กัน Controller
  // ตอบ 500 หลอก Admin ว่าล้มเหลวทั้งหมดแล้วกดซ้ำจน Stacking ซ้อนเกินตั้งใจ
  test('updatePlan สำเร็จ แต่เขียน Log ล้มเหลว → ยังคืนผลสำเร็จ (ไม่ throw) + console.error', async () => {
    userRepository.findById.mockResolvedValue({ id: USER_ID, plan: 'free', planExpiresAt: null });
    premiumGrantLogRepository.create.mockRejectedValue(new Error('logs table down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // ต้องไม่ throw — Grant ถือว่าสำเร็จเพราะ Plan อัพเกรดจริงไปแล้ว
    const { user, newExpiry } = await grantPremium(USER_ID, 'monthly', ADMIN_LINE_ID);

    // Plan ถูกอัพเกรดจริง (Action หลักสำเร็จ)
    expect(userRepository.updatePlan).toHaveBeenCalledWith(USER_ID, 'premium', newExpiry);
    expect(user.plan).toBe('premium');
    // ความล้มเหลวของ Log ถูกบันทึกไว้สืบย้อนหลัง (ไม่กลืนเงียบ)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to write premium_grant_logs'));

    errSpy.mockRestore();
  });
});
