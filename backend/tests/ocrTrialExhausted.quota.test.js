// ═══════════════════════════════════════════════════════════════════════
// ocrTrialExhausted.quota — OCR_TRIAL_EXHAUSTED ต้องอ้างอิงตัวเลขจาก MONTHLY_QUOTA
// จริง ไม่ Hardcode (fix/misleading-messages ข้อ 1)
// ═══════════════════════════════════════════════════════════════════════
// เดิมข้อความเขียนว่า "อัพเกรดเป็น Premium เพื่อใช้ต่อได้ไม่จำกัด" ซึ่งผิดข้อเท็จจริง
// — Premium จำกัดจริงที่ MONTHLY_QUOTA ครั้ง/เดือน (slipOcr.service.js) คนจ่ายเงิน
// แล้วเจอเพดานจะรู้สึกถูกหลอก Test ชุดนี้พิสูจน์ว่าข้อความ "อ้างอิง" ค่าคงที่จริง
// ไม่ใช่แค่ Hardcode เลข 50 ที่บังเอิญตรงกับค่าปัจจุบัน — เปลี่ยนค่าคงที่แล้ว Reload
// Module ใหม่ ข้อความต้องเปลี่ยนตามทันที
//
// Mock ที่ชั้น Repository เท่านั้น (Pattern เดียวกับ slipOcrCrossChannelQuota.test.js)
// ให้ slipOcrAccess.service ตัดสิน TRIAL_EXHAUSTED จริงจากข้อมูล ไม่ใช่ Mock คำตอบ

jest.mock('../src/repositories/aiOcrUsage.repository');
jest.mock('../src/services/storage.service');

const aiOcrUsageRepository = require('../src/repositories/aiOcrUsage.repository');
const transactionsController = require('../src/controllers/transactions.controller');
const slipOcrService = require('../src/services/slipOcr.service');

function mockReqRes({ isPremium = false } = {}) {
  const req = {
    user: { id: 'user-1' },
    userRecord: {
      id: 'user-1',
      plan: isPremium ? 'premium' : 'free',
      planExpiresAt: isPremium ? new Date(Date.now() + 86400000).toISOString() : null,
    },
    body: Buffer.from('fake-image-bytes'),
    get: () => 'image/jpeg',
  };
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('Free ใช้สิทธิ์ทดลองครบ 3 ครั้งแล้ว → ข้อความมีเลขโควตาจริง ไม่มีคำว่า "ไม่จำกัด"', async () => {
  aiOcrUsageRepository.getLifetimeUsage.mockResolvedValue({ count: 3, callCount: 3 });

  const { req, res } = mockReqRes({ isPremium: false });
  await transactionsController.scanSlipWithAi(req, res);

  expect(res.statusCode).toBe(403);
  expect(res.payload.error).toBe('OCR_TRIAL_EXHAUSTED');
  expect(res.payload.message).not.toContain('ไม่จำกัด');
  expect(res.payload.message).toContain(String(slipOcrService.MONTHLY_QUOTA));
});

// พิสูจน์ว่าเป็นการ "อ้างอิง" ค่าคงที่จริง ไม่ใช่ Hardcode เลข 50 ที่บังเอิญตรงกับ
// MONTHLY_QUOTA ปัจจุบัน — เปลี่ยนค่าคงที่ (Mock Module ใหม่) แล้ว Reload Controller
// ข้อความต้องเปลี่ยนตามทันทีโดยไม่ต้องแก้ transactions.controller.js เลย
test('เปลี่ยน MONTHLY_QUOTA แล้ว Reload Module → ข้อความเปลี่ยนตามค่าใหม่ทันที', async () => {
  let resolvedPayload;

  jest.isolateModules(() => {
    jest.doMock('../src/services/slipOcr.service', () => ({
      ...jest.requireActual('../src/services/slipOcr.service'),
      MONTHLY_QUOTA: 777,
    }));
    jest.doMock('../src/services/slipOcrAccess.service', () => ({
      checkAccess: jest.fn().mockResolvedValue({ allowed: false, reason: 'TRIAL_EXHAUSTED' }),
    }));

    const isolatedController = require('../src/controllers/transactions.controller');
    const { req, res } = mockReqRes({ isPremium: false });
    // isolateModules callback ต้อง Sync — เก็บ Promise ไว้อ่านผลนอก Block แทน
    resolvedPayload = isolatedController.scanSlipWithAi(req, res).then(() => res.payload);
  });

  const payload = await resolvedPayload;
  expect(payload.message).toContain('777');
  expect(payload.message).not.toContain('50 ครั้ง/เดือน');
});
