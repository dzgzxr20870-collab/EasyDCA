// ═══════════════════════════════════════════════════════════════════════════
// Security Hardening (จาก Security Audit) — Path Traversal + Rate Limit
// ═══════════════════════════════════════════════════════════════════════════
// ครอบ 2 ช่องโหว่ที่ Audit เจอ:
//   MEDIUM-2 Path Traversal — screenshotPath ที่ Client ส่งมาเคยถูกเช็คแค่ startsWith
//     ทำให้ "{userId}-../../../reports/{เหยื่อ}.pdf" ผ่าน Guard แล้วถูกเก็บลง DB
//     ตอน Admin เปิดหน้า /admin ระบบเอา path ไปต่อเป็น URL ให้ createSignedUrl ซึ่ง
//     WHATWG URL ยุบ '..' ให้อัตโนมัติ → Signed URL หลุดไปชี้ถัง reports (รายงาน
//     การเงินของผู้ใช้คนอื่น) — Payload ในไฟล์นี้คือตัวที่ยืนยันแล้วว่าหลุดจริง
//   MEDIUM-3 Rate Limit — Endpoint อัปโหลดรูป 10MB ไม่เคยมีเพดานต่อผู้ใช้เลย

jest.mock('../src/services/supportRequestFlow.service', () => {
  const actual = jest.requireActual('../src/services/supportRequestFlow.service');
  return {
    SupportRequestError: actual.SupportRequestError,
    RATE_LIMIT_HOURS: actual.RATE_LIMIT_HOURS,
    checkRateLimit: jest.fn(),
    validateMessage: jest.fn(),
    validateCategory: jest.fn(),
    pushSupportRequestToAdmins: jest.fn(),
    recordRequest: jest.fn(),
  };
});
jest.mock('../src/services/facebookLikeGrant.service', () => {
  const actual = jest.requireActual('../src/services/facebookLikeGrant.service');
  return {
    FacebookLikeGrantError: actual.FacebookLikeGrantError,
    MAX_MESSAGE_LENGTH: actual.MAX_MESSAGE_LENGTH,
    checkEligibility: jest.fn(),
    submitRequest: jest.fn(),
  };
});
jest.mock('../src/services/line.service');
jest.mock('../src/repositories/user.repository');
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    payment: { ...actual.payment, adminLineUserIds: ['Uadmin1'] },
    app: { ...actual.app, frontendUrl: 'https://app.easydca.test' },
  };
});

const express = require('express');
const facebookLikeGrantService = require('../src/services/facebookLikeGrant.service');
const userRepository = require('../src/repositories/user.repository');
const lineService = require('../src/services/line.service');
const supportController = require('../src/controllers/support.controller');

const USER_ID = '11111111-2222-3333-4444-555555555555';

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function mockReq(screenshotPath, userId = USER_ID) {
  return {
    user: { id: userId, lineUserId: 'U123' },
    body: { screenshotPath, message: null },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findById.mockResolvedValue({ id: USER_ID, displayName: 'Tester' });
  facebookLikeGrantService.submitRequest.mockResolvedValue({ id: 'req-1', message: null });
  // Push หา Admin เป็น Best-effort ที่ Controller เรียกต่อหลังบันทึกคำขอสำเร็จ
  lineService.pushMessage.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// MEDIUM-2 — Path Traversal
// ═══════════════════════════════════════════════════════════════════════════

describe('isOwnedProofPath — Pure Function', () => {
  test('path ปกติที่ uploadFacebookLikeProof สร้างเอง → ผ่าน', () => {
    expect(supportController.isOwnedProofPath(USER_ID, `${USER_ID}-1754123456789.jpg`)).toBe(true);
    expect(supportController.isOwnedProofPath(USER_ID, `${USER_ID}-1754123456789.png`)).toBe(true);
    expect(supportController.isOwnedProofPath(USER_ID, `${USER_ID}-1754123456789.webp`)).toBe(true);
    expect(supportController.isOwnedProofPath(USER_ID, `${USER_ID}-1754123456789.gif`)).toBe(true);
  });

  test('🔒 Payload ที่ยืนยันแล้วว่าหลุดถัง reports ได้จริง → ต้องถูกปฏิเสธ', () => {
    // ../../../ = จำนวน .. ที่ทำให้ URL Normalization กินจนหลุด bucket จริง
    expect(
      supportController.isOwnedProofPath(USER_ID, `${USER_ID}-../../../reports/victim-1.pdf`)
    ).toBe(false);
  });

  test('🔒 Traversal รูปแบบอื่นที่ startsWith เดิมปล่อยผ่านทั้งหมด → ถูกปฏิเสธ', () => {
    const payloads = [
      `${USER_ID}-../../reports/v.pdf`,
      `${USER_ID}-../1754123456789.jpg`,
      `${USER_ID}-/../../reports/v.pdf`,
      `${USER_ID}-subdir/1754123456789.jpg`,
      `${USER_ID}-1754123456789.jpg/../../../reports/v.pdf`,
      `${USER_ID}-1754123456789.pdf`, // นามสกุลนอก Allowlist
      `${USER_ID}-123.jpg`, // timestamp สั้นเกิน (ไม่ใช่รูปแบบที่ระบบสร้าง)
      `${USER_ID}-.jpg`,
      `${USER_ID}-`,
    ];
    for (const p of payloads) {
      expect(supportController.isOwnedProofPath(USER_ID, p)).toBe(false);
    }
  });

  test('🔒 ไฟล์ของผู้ใช้คนอื่น (รูปแบบถูกต้องทุกอย่าง) → ถูกปฏิเสธ', () => {
    const otherId = '99999999-8888-7777-6666-555555555555';
    expect(supportController.isOwnedProofPath(USER_ID, `${otherId}-1754123456789.jpg`)).toBe(false);
  });

  test('ค่าที่ไม่ใช่ String / userId ว่าง → ถูกปฏิเสธ ไม่ throw', () => {
    expect(supportController.isOwnedProofPath(USER_ID, undefined)).toBe(false);
    expect(supportController.isOwnedProofPath(USER_ID, null)).toBe(false);
    expect(supportController.isOwnedProofPath(USER_ID, { toString: () => 'x' })).toBe(false);
    expect(supportController.isOwnedProofPath(null, `${USER_ID}-1754123456789.jpg`)).toBe(false);
  });
});

describe('submitFacebookLikeRequest — Guard ระดับ HTTP', () => {
  test('🔒 Path Traversal → 400 และ "ไม่แตะ Service เลย" (ไม่มีแถวลง DB)', async () => {
    const res = mockRes();
    await supportController.submitFacebookLikeRequest(
      mockReq(`${USER_ID}-../../../reports/victim-1.pdf`),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'SCREENSHOT_REQUIRED' })
    );
    // สำคัญกว่า Status Code: ต้องไม่มีทางที่ path พิษถูกเก็บลง DB
    expect(facebookLikeGrantService.submitRequest).not.toHaveBeenCalled();
  });

  test('path ถูกต้อง → ส่งต่อเข้า Service ตามปกติ (ไม่ Regress ของเดิม)', async () => {
    const goodPath = `${USER_ID}-1754123456789.jpg`;
    const res = mockRes();
    await supportController.submitFacebookLikeRequest(mockReq(goodPath), res);

    expect(facebookLikeGrantService.submitRequest).toHaveBeenCalledWith(USER_ID, goodPath, null);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MEDIUM-3 — Rate Limit (1 ครั้ง/ชม./User) บน Endpoint อัปโหลดรูป
// ═══════════════════════════════════════════════════════════════════════════
// ทดสอบกับ Express App จริง + ยิงผ่าน fetch จริง (ไม่ Mock Middleware) เพราะสิ่งที่
// ต้องพิสูจน์คือ "Config ของ Limiter ตัวที่ Mount อยู่จริง" ไม่ใช่ Logic ที่เขียนซ้ำ
// ในเทสต์ — ใช้ Limiter ตัวเดียวกับที่ support.routes.js Mount เข้า Route จริง

describe('screenshotUploadLimiter — 1 ครั้ง/ชม./User', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { screenshotUploadLimiter } = require('../src/routes/support.routes');

    const app = express();
    // จำลอง requireAuth: Limiter จริงอยู่หลัง requireAuth เสมอ จึงมี req.user แน่นอน
    app.use((req, res, next) => {
      req.user = { id: req.get('x-test-user') };
      next();
    });
    app.post('/upload', screenshotUploadLimiter, (req, res) => res.status(200).json({ ok: true }));

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    // closeAllConnections() ต้องมาก่อน close() — global fetch (undici) เปิด Socket
    // keep-alive ค้างไว้ ทำให้ close() รอไม่จบ แล้ว Jest เตือน worker force exited
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  const upload = (userId) =>
    fetch(`${baseUrl}/upload`, { method: 'POST', headers: { 'x-test-user': userId } });

  test('ครั้งแรกผ่าน (200) — ครั้งที่ 2 ในชั่วโมงเดียวกันโดน 429', async () => {
    const first = await upload('user-A');
    expect(first.status).toBe(200);

    const second = await upload('user-A');
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual(
      expect.objectContaining({ error: 'SCREENSHOT_UPLOAD_RATE_LIMITED' })
    );
  });

  test('ยิงรัวต่อ (ครั้งที่ 3-5) ยังโดน 429 ทุกครั้ง ไม่มีหลุด', async () => {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await upload('user-A')).status);
    }
    expect(statuses).toEqual([429, 429, 429]);
  });

  test('🔑 นับแยกรายบัญชี — User อื่นไม่ถูกเหมารวม (Key = user.id ไม่ใช่ IP)', async () => {
    // ทั้ง 2 Request มาจาก 127.0.0.1 เดียวกัน ถ้า Key เป็น IP จะโดน 429 ทันที
    expect((await upload('user-B')).status).toBe(200);
    expect((await upload('user-C')).status).toBe(200);
    // แต่ละคนยังมีเพดานของตัวเองครบ
    expect((await upload('user-B')).status).toBe(429);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F3 (Offensive Review Round 2) — Rate Limit บนการอัปโหลดสลิปชำระเงิน
// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/payment/:id/slip ไม่มีเพดานจำนวนครั้งเลย และ storage.service ตั้งชื่อ
// ไฟล์ใหม่ทุกครั้ง (upsert: false — เก็บทุกรูปกัน Race โดยเจตนา) ผู้ใช้ที่มีคำขอ pending
// 1 ใบจึงยัดรูป 10MB เข้า Storage ได้ไม่จำกัดจำนวนครั้ง ทั้งที่มีแค่รูปล่าสุดใบเดียวที่
// ถูกอ้างถึงจริง — ใช้ Limiter โครงเดียวกับ screenshotUploadLimiter ทุกประการ
//
// ทดสอบกับ Express App จริง + Limiter "ตัวที่ Mount อยู่จริง" (ไม่เขียน Config ซ้ำในเทสต์)
describe('slipUploadLimiter — 1 ครั้ง/ชม./User (F3)', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { slipUploadLimiter } = require('../src/routes/payment.routes');

    const app = express();
    // จำลอง requireAuth: Limiter จริงอยู่หลัง requireAuth เสมอ จึงมี req.user แน่นอน
    app.use((req, res, next) => {
      req.user = { id: req.get('x-test-user') };
      next();
    });
    app.post('/slip', slipUploadLimiter, (req, res) => res.status(200).json({ ok: true }));

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    // closeAllConnections() ต้องมาก่อน close() — global fetch (undici) เปิด Socket
    // keep-alive ค้างไว้ ทำให้ close() รอไม่จบ แล้ว Jest เตือน worker force exited
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  const uploadSlip = (userId) =>
    fetch(`${baseUrl}/slip`, { method: 'POST', headers: { 'x-test-user': userId } });

  test('ครั้งแรกผ่าน (200) — ครั้งที่ 2 ในชั่วโมงเดียวกันโดน 429', async () => {
    expect((await uploadSlip('slip-user-A')).status).toBe(200);

    const second = await uploadSlip('slip-user-A');
    expect(second.status).toBe(429);
    // Error Code แยกของตัวเอง ไม่ปนกับ Endpoint อัปโหลด Screenshot
    expect(await second.json()).toEqual(
      expect.objectContaining({ error: 'SLIP_UPLOAD_RATE_LIMITED' })
    );
  });

  test('ยิงรัวต่อ (ครั้งที่ 3-5) ยังโดน 429 ทุกครั้ง ไม่มีหลุด', async () => {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await uploadSlip('slip-user-A')).status);
    }
    expect(statuses).toEqual([429, 429, 429]);
  });

  test('🔑 นับแยกรายบัญชี — ผูกกับ user.id ไม่ใช่ IP', async () => {
    // ทั้งหมดมาจาก 127.0.0.1 เดียวกัน ถ้า Key เป็น IP จะโดน 429 ทันที
    expect((await uploadSlip('slip-user-B')).status).toBe(200);
    expect((await uploadSlip('slip-user-C')).status).toBe(200);
    expect((await uploadSlip('slip-user-B')).status).toBe(429);
  });
});
