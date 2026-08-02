// ═══════════════════════════════════════════════════════════════════════════
// Integration — Endpoint แคมเปญ Like Facebook ทะลุถึง Service จริง (Mock แค่ Repo)
// ═══════════════════════════════════════════════════════════════════════════
// ต่างจาก facebookLikeGrant.service.test.js (Unit — Mock Service Dependency): ไฟล์นี้
// ใช้ facebookLikeGrant.service "ตัวจริง" เพื่อพิสูจน์ว่า Controller ต่อกับ Service ถูก
// และ Map HTTP Status/ข้อความไทยครบทุก Error Code (ไม่มี Code ไหนหลุดไปเป็น 500)
//
// ครอบคลุมทั้ง 2 ฝั่ง: ผู้ใช้ส่งคำขอ (support.controller) + Admin ตรวจ (admin.controller)

jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/payment.repository');
jest.mock('../src/repositories/premiumGrantLog.repository');
jest.mock('../src/repositories/facebookLikeGrantRequest.repository');
jest.mock('../src/services/storage.service');
jest.mock('../src/services/line.service');
jest.mock('../src/utils/logger.util');
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    payment: {
      ...actual.payment,
      facebookLikeGrantEnabled: true,
      adminLineUserIds: ['U-admin-1'],
    },
    app: { ...actual.app, frontendUrl: 'https://app.easydca.test' },
  };
});

const config = require('../src/config/env');
const userRepository = require('../src/repositories/user.repository');
const paymentRepository = require('../src/repositories/payment.repository');
const premiumGrantLogRepository = require('../src/repositories/premiumGrantLog.repository');
const requestRepository = require('../src/repositories/facebookLikeGrantRequest.repository');
const storageService = require('../src/services/storage.service');
const lineService = require('../src/services/line.service');
const supportController = require('../src/controllers/support.controller');
const adminController = require('../src/controllers/admin.controller');

const USER_ID = 'user-uuid-1';
const REQUEST_ID = 'req-uuid-1';
const SCREENSHOT_PATH = `${USER_ID}-1754006400000.jpg`;

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
    displayName: 'Somchai',
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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
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
  requestRepository.listByStatus.mockResolvedValue([pendingRequest()]);
  storageService.uploadFacebookLikeProof.mockResolvedValue(SCREENSHOT_PATH);
  storageService.createFacebookLikeProofSignedUrl.mockResolvedValue('https://signed.test/x.jpg');
  lineService.pushMessage.mockResolvedValue(undefined);
});

describe('GET /support/facebook-like — เช็คสิทธิ์', () => {
  test('มีสิทธิ์ → 200 { enabled:true, eligible:true }', async () => {
    const res = mockRes();
    await supportController.getFacebookLikeStatus({ user: { id: USER_ID } }, res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res)).toMatchObject({ enabled: true, eligible: true, reason: null });
  });

  test('ไม่มีสิทธิ์ → ยัง 200 พร้อมเหตุผลไทย (เป็นการถามสถานะ ไม่ใช่ Error)', async () => {
    userRepository.findById.mockResolvedValue(
      eligibleUser({ freeTrialClaimedAt: '2026-07-01T00:00:00.000Z' })
    );

    const res = mockRes();
    await supportController.getFacebookLikeStatus({ user: { id: USER_ID } }, res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).reason).toBe('ALREADY_USED_FREE_TRIAL');
    expect(typeof jsonOf(res).message).toBe('string');
    expect(jsonOf(res).message.length).toBeGreaterThan(0);
  });

  test('Flag ปิด → enabled:false (Frontend ใช้ซ่อน Category ทั้งตัวเลือก)', async () => {
    config.payment.facebookLikeGrantEnabled = false;

    const res = mockRes();
    await supportController.getFacebookLikeStatus({ user: { id: USER_ID } }, res);

    expect(jsonOf(res)).toMatchObject({ enabled: false, eligible: false, reason: 'FEATURE_DISABLED' });
  });
});

describe('POST /support/facebook-like/screenshot — อัปโหลดรูป', () => {
  function uploadReq(overrides = {}) {
    return {
      user: { id: USER_ID, lineUserId: 'U-line-1' },
      body: Buffer.from('fake-image-bytes'),
      get: () => 'image/jpeg',
      ...overrides,
    };
  }

  test('สำเร็จ → 200 คืน screenshotPath ที่ขึ้นต้นด้วย userId', async () => {
    const res = mockRes();
    await supportController.uploadFacebookLikeScreenshot(uploadReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).screenshotPath).toBe(SCREENSHOT_PATH);
    expect(storageService.uploadFacebookLikeProof).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Buffer),
      'image/jpeg'
    );
  });

  test('Body ว่าง → 400 EMPTY_BODY ไม่ยิง Storage', async () => {
    const res = mockRes();
    await supportController.uploadFacebookLikeScreenshot(uploadReq({ body: Buffer.alloc(0) }), res);

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('EMPTY_BODY');
    expect(storageService.uploadFacebookLikeProof).not.toHaveBeenCalled();
  });

  test('🔒 ไม่มีสิทธิ์ → ปฏิเสธ "ก่อน" อัปโหลดขึ้น Storage (ไม่เปลืองพื้นที่)', async () => {
    userRepository.findById.mockResolvedValue(
      eligibleUser({ facebookLikeGrantedAt: '2026-07-01T00:00:00.000Z' })
    );

    const res = mockRes();
    await supportController.uploadFacebookLikeScreenshot(uploadReq(), res);

    expect(statusOf(res)).toBe(403);
    expect(jsonOf(res).error).toBe('ALREADY_GRANTED');
    expect(storageService.uploadFacebookLikeProof).not.toHaveBeenCalled();
  });

  test('ไฟล์ไม่ใช่รูป (StorageServiceError) → 415 พร้อมข้อความไทย ไม่ใช่ 500', async () => {
    const storageErr = new Error('bad type');
    storageErr.name = 'StorageServiceError';
    storageErr.code = 'INVALID_SLIP_CONTENT_TYPE';
    storageService.uploadFacebookLikeProof.mockRejectedValue(storageErr);

    const res = mockRes();
    await supportController.uploadFacebookLikeScreenshot(uploadReq(), res);

    expect(statusOf(res)).toBe(415);
    expect(typeof jsonOf(res).message).toBe('string');
  });
});

describe('POST /support/facebook-like — ส่งคำขอ', () => {
  function submitReq(body = {}) {
    return {
      user: { id: USER_ID, lineUserId: 'U-line-1' },
      body: { screenshotPath: SCREENSHOT_PATH, ...body },
    };
  }

  test('สำเร็จ → 200 + Push แจ้ง Admin', async () => {
    const res = mockRes();
    await supportController.submitFacebookLikeRequest(submitReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res)).toMatchObject({ status: 'submitted', requestId: REQUEST_ID, notified: true });
    expect(lineService.pushMessage).toHaveBeenCalledWith('U-admin-1', expect.any(Object));
  });

  test('🔒 ส่ง screenshotPath ของคนอื่น → 400 (Path ต้องขึ้นต้นด้วย userId ของตัวเอง)', async () => {
    const res = mockRes();
    await supportController.submitFacebookLikeRequest(
      submitReq({ screenshotPath: 'someone-else-uuid-123.jpg' }),
      res
    );

    expect(statusOf(res)).toBe(400);
    expect(jsonOf(res).error).toBe('SCREENSHOT_REQUIRED');
    expect(requestRepository.create).not.toHaveBeenCalled();
  });

  test('มีคำขอค้างอยู่แล้ว → 409 REQUEST_ALREADY_PENDING (ไม่ใช่ 403/500)', async () => {
    requestRepository.findPendingByUserId.mockResolvedValue(pendingRequest());

    const res = mockRes();
    await supportController.submitFacebookLikeRequest(submitReq(), res);

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('REQUEST_ALREADY_PENDING');
  });

  test('Push หา Admin ล้มเหลว → คำขอยังบันทึกสำเร็จ ตอบ 200 (notified:false)', async () => {
    lineService.pushMessage.mockRejectedValue(new Error('LINE down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = mockRes();
    await supportController.submitFacebookLikeRequest(submitReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).notified).toBe(false);
    expect(requestRepository.create).toHaveBeenCalledTimes(1);
    console.error.mockRestore();
  });

  // ลำดับใน Tuple: [code, httpStatus, userOverride] — ให้ %s/%i ใน Title ตรงกับ 2 ตัวแรก
  // (ถ้าเอา Object ไว้ตัวที่ 2 จะได้ Title ว่า "NaN" เพราะ %i ไปรับ Object เข้าไป)
  test.each([
    ['ALREADY_GRANTED', 403, { facebookLikeGrantedAt: '2026-07-01T00:00:00.000Z' }],
    ['ALREADY_USED_FREE_TRIAL', 403, { freeTrialClaimedAt: '2026-07-01T00:00:00.000Z' }],
    ['ALREADY_PREMIUM', 403, { plan: 'premium', planExpiresAt: '2099-01-01T00:00:00.000Z' }],
    ['ACCOUNT_NOT_ELIGIBLE', 403, { isLocked: true }],
  ])('%s → HTTP %i พร้อมข้อความไทย ไม่ใช่ 500', async (expectedCode, expectedStatus, userOverride) => {
    userRepository.findById.mockResolvedValue(eligibleUser(userOverride));

    const res = mockRes();
    await supportController.submitFacebookLikeRequest(submitReq(), res);

    expect(statusOf(res)).toBe(expectedStatus);
    expect(jsonOf(res).error).toBe(expectedCode);
    expect(typeof jsonOf(res).message).toBe('string');
    expect(requestRepository.create).not.toHaveBeenCalled();
  });
});

describe('Admin — ตรวจคำขอ', () => {
  const adminReq = (overrides = {}) => ({
    user: { id: 'admin-uuid', lineUserId: 'U-admin-1' },
    params: { id: REQUEST_ID },
    query: {},
    body: {},
    ...overrides,
  });

  test('GET list → 200 พร้อม Signed URL ของรูป + ชื่อผู้ใช้', async () => {
    const res = mockRes();
    await adminController.listFacebookLikeRequests(adminReq(), res);

    expect(statusOf(res)).toBe(200);
    const { requests } = jsonOf(res);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id: REQUEST_ID,
      displayName: 'Somchai',
      screenshotUrl: 'https://signed.test/x.jpg',
    });
  });

  test('GET list — Sign รูปไม่สำเร็จ → ยังคืนรายการได้ (screenshotUrl:null) ไม่พังทั้ง Endpoint', async () => {
    storageService.createFacebookLikeProofSignedUrl.mockResolvedValue(null);

    const res = mockRes();
    await adminController.listFacebookLikeRequests(adminReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).requests[0].screenshotUrl).toBeNull();
  });

  test('GET list — status ไม่ถูกต้อง → 400', async () => {
    const res = mockRes();
    await adminController.listFacebookLikeRequests(adminReq({ query: { status: 'bogus' } }), res);

    expect(statusOf(res)).toBe(400);
  });

  test('Approve → 200 + ผู้ใช้ได้ Premium 1 เดือน + Push แจ้งผู้ใช้', async () => {
    const res = mockRes();
    await adminController.approveFacebookLikeRequest(adminReq(), res);

    expect(statusOf(res)).toBe(200);
    const body = jsonOf(res);
    expect(body.status).toBe('approved');
    expect(body.plan).toBe('premium');

    const diffDays = (new Date(body.planExpiresAt) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(27);
    expect(diffDays).toBeLessThan(32);

    expect(lineService.pushMessage).toHaveBeenCalledWith('U-line-1', expect.any(Object));
  });

  test('Approve — Push หาผู้ใช้ล้มเหลว → ยังตอบ 200 (สิทธิ์ให้ไปแล้วจริง ห้าม Rollback)', async () => {
    lineService.pushMessage.mockRejectedValue(new Error('blocked by user'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = mockRes();
    await adminController.approveFacebookLikeRequest(adminReq(), res);

    expect(statusOf(res)).toBe(200);
    expect(userRepository.grantFacebookLikePremium).toHaveBeenCalledTimes(1);
    console.error.mockRestore();
  });

  test('Approve ซ้ำ (ถูก Resolve ไปแล้ว) → 409 ALREADY_RESOLVED ไม่ Grant ซ้ำ', async () => {
    requestRepository.claimForReview.mockResolvedValue(null);

    const res = mockRes();
    await adminController.approveFacebookLikeRequest(adminReq(), res);

    expect(statusOf(res)).toBe(409);
    expect(jsonOf(res).error).toBe('ALREADY_RESOLVED');
    expect(userRepository.grantFacebookLikePremium).not.toHaveBeenCalled();
  });

  test('Reject → 200 + Push แจ้งผู้ใช้ + ไม่แตะสิทธิ์เลย', async () => {
    const res = mockRes();
    await adminController.rejectFacebookLikeRequest(adminReq({ body: { reason: 'รูปไม่ชัด' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(jsonOf(res).status).toBe('rejected');
    expect(userRepository.grantFacebookLikePremium).not.toHaveBeenCalled();
    expect(lineService.pushMessage).toHaveBeenCalledWith('U-line-1', expect.any(Object));
  });

  test('ไม่พบคำขอ → 404 REQUEST_NOT_FOUND', async () => {
    requestRepository.findById.mockResolvedValue(null);

    const res = mockRes();
    await adminController.approveFacebookLikeRequest(adminReq(), res);

    expect(statusOf(res)).toBe(404);
    expect(jsonOf(res).error).toBe('REQUEST_NOT_FOUND');
  });
});
