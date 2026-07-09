jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/payment.repository');
jest.mock('../src/repositories/asset.repository');
// entitlement.service + thaiDate.util ไม่ Mock (Pure Logic ไม่มี DB Call) — ใช้ตัวจริง
// เพื่อยืนยันว่า Controller เรียก isPremiumActive/bangkokYearMonth จริง ไม่คำนวณเอง
// (Pattern เดียวกับ dashboard.controller.test ที่ใช้ entitlement ตัวจริง)

const userRepository = require('../src/repositories/user.repository');
const paymentRepository = require('../src/repositories/payment.repository');
const assetRepository = require('../src/repositories/asset.repository');
const { ping, listUsers, listPayments, getStats } = require('../src/controllers/admin.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Helper สร้าง user แบบต่างๆ ให้ entitlement.isPremiumActive ตัดสิน
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('admin.controller.ping', () => {
  test('คืน 200 { ok: true, role } สะท้อน role จาก req.user (requireAdmin การันตี admin แล้ว)', () => {
    const req = { user: { id: 'admin-1', lineUserId: 'Uadmin1', role: 'admin' } };
    const res = mockRes();

    ping(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, role: 'admin' });
  });
});

describe('listUsers', () => {
  test('map ครบทุก Field + isPremiumActive (real entitlement) + assetCount จาก grouped (default 0)', async () => {
    userRepository.findAll.mockResolvedValue([
      { id: 'u1', displayName: 'พรีเมียม Active', plan: 'premium', planExpiresAt: FUTURE, createdAt: '2026-07-01' },
      { id: 'u2', displayName: 'พรีเมียมหมดอายุ', plan: 'premium', planExpiresAt: PAST, createdAt: '2026-06-01' },
      { id: 'u3', displayName: 'ฟรี', plan: 'free', planExpiresAt: null, createdAt: '2026-05-01' },
    ]);
    assetRepository.countActiveSymbolsGroupedByUser.mockResolvedValue({ u1: 3 }); // u2/u3 ไม่มี key

    const res = mockRes();
    await listUsers({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.users).toEqual([
      { id: 'u1', displayName: 'พรีเมียม Active', plan: 'premium', planExpiresAt: FUTURE, isPremiumActive: true, assetCount: 3, createdAt: '2026-07-01' },
      { id: 'u2', displayName: 'พรีเมียมหมดอายุ', plan: 'premium', planExpiresAt: PAST, isPremiumActive: false, assetCount: 0, createdAt: '2026-06-01' },
      { id: 'u3', displayName: 'ฟรี', plan: 'free', planExpiresAt: null, isPremiumActive: false, assetCount: 0, createdAt: '2026-05-01' },
    ]);
  });

  test('ไม่มี User เลย → { users: [] }', async () => {
    userRepository.findAll.mockResolvedValue([]);
    assetRepository.countActiveSymbolsGroupedByUser.mockResolvedValue({});

    const res = mockRes();
    await listUsers({}, res);

    expect(res.json).toHaveBeenCalledWith({ users: [] });
  });

  test('Repository throw → 500 INTERNAL_ERROR', async () => {
    userRepository.findAll.mockRejectedValue(new Error('db down'));
    assetRepository.countActiveSymbolsGroupedByUser.mockResolvedValue({});

    const res = mockRes();
    await listUsers({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});

describe('listPayments', () => {
  test('ไม่ส่ง status → เรียก findAll({ status: undefined }) แล้ว map fields', async () => {
    paymentRepository.findAll.mockResolvedValue([
      {
        id: 'p1', userId: 'u1', displayName: 'สมชาย', amountThb: 59.17,
        billingPeriod: 'monthly', status: 'pending',
        createdAt: '2026-07-01', confirmedAt: null,
      },
    ]);

    const res = mockRes();
    await listPayments({ query: {} }, res);

    expect(paymentRepository.findAll).toHaveBeenCalledWith({ status: undefined });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].payments[0]).toEqual({
      id: 'p1', userId: 'u1', displayName: 'สมชาย', amountThb: 59.17,
      billingPeriod: 'monthly', status: 'pending', createdAt: '2026-07-01', confirmedAt: null,
    });
  });

  test('status=confirmed (ค่าจริงใน DB) → ส่งต่อให้ Repository', async () => {
    paymentRepository.findAll.mockResolvedValue([]);

    const res = mockRes();
    await listPayments({ query: { status: 'confirmed' } }, res);

    expect(paymentRepository.findAll).toHaveBeenCalledWith({ status: 'confirmed' });
    expect(res.json).toHaveBeenCalledWith({ payments: [] });
  });

  test('status ที่ไม่รู้จัก (เช่น approved) → 400 INVALID_STATUS, ไม่แตะ Repository', async () => {
    const res = mockRes();
    await listPayments({ query: { status: 'approved' } }, res);

    expect(paymentRepository.findAll).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_STATUS' });
  });

  test('Filter status ที่ถูกต้องแต่ไม่มี Payment ตรงเงื่อนไข → { payments: [] }', async () => {
    paymentRepository.findAll.mockResolvedValue([]);

    const res = mockRes();
    await listPayments({ query: { status: 'rejected' } }, res);

    expect(res.json).toHaveBeenCalledWith({ payments: [] });
  });

  test('Repository throw → 500 INTERNAL_ERROR', async () => {
    paymentRepository.findAll.mockRejectedValue(new Error('boom'));

    const res = mockRes();
    await listPayments({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});

describe('getStats', () => {
  test('นับ premium(active)/free + รายได้เฉพาะ confirmed + revenueThisMonth ตามเดือนไทย', async () => {
    userRepository.findAll.mockResolvedValue([
      { id: 'u1', plan: 'premium', planExpiresAt: FUTURE }, // active
      { id: 'u2', plan: 'premium', planExpiresAt: PAST }, // หมดอายุ → นับเป็น free
      { id: 'u3', plan: 'free', planExpiresAt: null },
    ]);
    paymentRepository.findAll.mockResolvedValue([
      // confirmed เดือนนี้ (confirmedAt = now) → นับทั้ง total และ thisMonth
      { status: 'confirmed', amountThb: 100, confirmedAt: new Date().toISOString() },
      // confirmed เดือน/ปีอื่น → นับเฉพาะ total ไม่นับ thisMonth
      { status: 'confirmed', amountThb: 50, confirmedAt: '2020-01-15T00:00:00.000Z' },
      // pending/rejected/expired → ไม่นับเป็นรายได้เลย
      { status: 'pending', amountThb: 999, confirmedAt: null },
      { status: 'rejected', amountThb: 999, confirmedAt: '2020-01-15T00:00:00.000Z' },
      { status: 'expired', amountThb: 999, confirmedAt: null },
    ]);

    const res = mockRes();
    await getStats({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      totalUsers: 3,
      freeUsers: 2, // u2 (หมดอายุ) + u3
      premiumUsers: 1, // u1 เท่านั้น
      totalRevenue: 150, // 100 + 50 (เฉพาะ confirmed)
      revenueThisMonth: 100, // เฉพาะรายการ confirmed เดือนนี้
    });
  });

  test('ไม่มี User และไม่มี Payment เลย → ทุกค่าเป็น 0', async () => {
    userRepository.findAll.mockResolvedValue([]);
    paymentRepository.findAll.mockResolvedValue([]);

    const res = mockRes();
    await getStats({}, res);

    expect(res.json).toHaveBeenCalledWith({
      totalUsers: 0,
      freeUsers: 0,
      premiumUsers: 0,
      totalRevenue: 0,
      revenueThisMonth: 0,
    });
  });

  test('Repository throw → 500 INTERNAL_ERROR', async () => {
    userRepository.findAll.mockRejectedValue(new Error('db down'));
    paymentRepository.findAll.mockResolvedValue([]);

    const res = mockRes();
    await getStats({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' });
  });
});
