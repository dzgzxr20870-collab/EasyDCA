// ═══════════════════════════════════════════════════════════════════════
// REGRESSION — โควตา AI ต้องเป็น "ถังเดียวกัน" ข้ามช่องทาง (เว็บ ↔ LINE)
// ═══════════════════════════════════════════════════════════════════════
// เหตุผลที่ต้องมี Test ชุดนี้ (AI_WORK_POLICY § 3 ข้อ 3 — Regression):
// ทุกครั้งที่เรียก Claude Vision = เงินจริง ถ้าเส้นทางเว็บที่เพิ่มใหม่รอบนี้เผลอ
// นับโควตาแยกจากฝั่ง LINE (เช่น สร้างตาราง/คอลัมน์ใหม่ หรือ Copy Logic โควตามาไว้
// ใน Controller เอง) ผู้ใช้ 1 คนจะยิงได้ 2 เท่าของเพดานที่ตั้งใจไว้ทันที
//
// Test นี้พิสูจน์ "ทางโครงสร้าง" ว่าทั้ง 2 ช่องทางลงเอยที่ตัวนับชุดเดียวกันจริง โดย
// Mock ที่ชั้น repository (จุดที่แตะ DB จริง) แล้วยืนยันว่า:
//   1) เว็บเรียก extractSlip ตัวเดียวกับ LINE (ไม่มี OCR Path คู่ขนาน)
//   2) การเรียกจากเว็บ Increment ตัวนับตัวเดียวกัน (increment_ai_ocr_* ของ
//      ai_ocr_usage) ด้วย userId เดียวกัน
//   3) โควตาที่ LINE อ่านได้หลังจากนั้น "ลดลงตาม" การใช้จากเว็บ
//
// ── วิธีพิสูจน์ Red-Green จริง (ทำแล้ว ดูรายงาน) ────────────────────────────
// ถอด Fix ออกชั่วคราวด้วยการให้ transactions.controller.scanSlipWithAi เรียก
// Claude เองโดยไม่ผ่าน slipOcrService.extractSlip (จำลองการเขียน Logic OCR ใหม่
// ตามที่ Requirement ห้าม) → Test "เว็บต้องนับเข้าถังเดียวกับ LINE" ต้องแดงทันที
// เพราะ incrementCallCount/incrementUsage จะไม่ถูกเรียกเลย
jest.mock('../src/repositories/aiOcrUsage.repository');
jest.mock('../src/services/storage.service');

const aiOcrUsageRepository = require('../src/repositories/aiOcrUsage.repository');
const storageService = require('../src/services/storage.service');
const slipOcrService = require('../src/services/slipOcr.service');
const transactionsController = require('../src/controllers/transactions.controller');

const VALID_OCR_RESPONSE = {
  is_slip: true,
  multiple_items: false,
  symbol: 'BTC',
  side: 'buy',
  side_evidence: 'ซื้อ BTC',
  order_status: 'filled',
  order_status_evidence: 'สำเร็จ',
  quantity: 0.01,
  price_per_unit: 3400000,
  amount: 34000,
  net_amount: null,
  currency: 'THB',
  date: null,
  confidence: 'high',
};

function mockClaudeOk() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(VALID_OCR_RESPONSE) }] }),
  });
}

// req/res ปลอมแบบเบาที่สุดที่ Controller ต้องใช้จริง
function mockReqRes({ userId = 'user-1', isPremium = true } = {}) {
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const req = {
    user: { id: userId },
    userRecord: {
      id: userId,
      plan: isPremium ? 'premium' : 'free',
      planExpiresAt: isPremium ? futureDate : null,
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

describe('REGRESSION: โควตา AI อ่านสลิปเป็นถังเดียวกันข้ามช่องทาง', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    slipOcrService.__clearRateLimit();
    process.env.CLAUDE_API_KEY = 'test-key';
    mockClaudeOk();
    storageService.uploadTransactionSlip.mockResolvedValue({ token: 'tok-1', path: 'p/tok-1' });
  });

  it('เว็บอ่านสลิป → Increment ตัวนับ ai_ocr_usage ชุดเดียวกับ LINE (userId เดียวกัน)', async () => {
    aiOcrUsageRepository.getUsageCount.mockResolvedValue(0);
    aiOcrUsageRepository.incrementCallCount.mockResolvedValue(1);
    aiOcrUsageRepository.incrementUsage.mockResolvedValue(1);

    const { req, res } = mockReqRes({ userId: 'user-cross', isPremium: true });
    await transactionsController.scanSlipWithAi(req, res);

    expect(res.statusCode).toBe(200);
    // นี่คือหัวใจ: ตัวนับที่ถูกแตะต้องเป็นของ ai_ocr_usage ตัวเดิม ด้วย userId เดียวกัน
    expect(aiOcrUsageRepository.incrementCallCount).toHaveBeenCalledWith(
      'user-cross',
      expect.any(String)
    );
    expect(aiOcrUsageRepository.incrementUsage).toHaveBeenCalledWith(
      'user-cross',
      expect.any(String)
    );
  });

  it('ใช้จากเว็บแล้ว โควตาที่ LINE เห็นต้องลดตาม (อ่านค่าจากตัวนับเดียวกัน)', async () => {
    // จำลอง State ของ DB จริง: ตัวนับเดียวที่ทั้ง 2 ช่องทางใช้ร่วมกัน
    let usageCount = 0;
    aiOcrUsageRepository.getUsageCount.mockImplementation(async () => usageCount);
    aiOcrUsageRepository.incrementUsage.mockImplementation(async () => {
      usageCount += 1;
      return usageCount;
    });
    aiOcrUsageRepository.incrementCallCount.mockResolvedValue(1);

    // 1) ใช้ผ่านเว็บ 1 ครั้ง
    const { req, res } = mockReqRes({ userId: 'user-shared', isPremium: true });
    await transactionsController.scanSlipWithAi(req, res);
    expect(res.statusCode).toBe(200);
    expect(usageCount).toBe(1);

    // 2) ฝั่ง LINE เรียก extractSlip ตรงๆ (เส้นทางเดิมทุกประการ) — ต้องเห็นว่าโควตา
    //    ถูกใช้ไปแล้ว 1 ครั้ง และ remainingQuota ลดลงตาม ไม่ใช่เริ่มนับใหม่ที่ 0
    slipOcrService.__clearRateLimit(); // Rate Limit เป็นคนละเรื่องกับโควตา
    const lineResult = await slipOcrService.extractSlip(
      'user-shared',
      Buffer.from('img'),
      'image/jpeg'
    );

    expect(usageCount).toBe(2);
    expect(lineResult.remainingQuota).toBe(slipOcrService.MONTHLY_QUOTA - 2);
  });

  it('ผู้ใช้ Free ที่ใช้สิทธิ์ทดลองครบแล้ว ถูกบล็อกฝั่งเว็บด้วย (ไม่ยิง Claude เลย)', async () => {
    // ใช้ครบ 3 ครั้งแล้ว (ไม่ว่าจะใช้จากช่องทางไหน — getLifetimeUsage รวมทุกเดือน)
    aiOcrUsageRepository.getLifetimeUsage.mockResolvedValue({ count: 3, callCount: 3 });

    const { req, res } = mockReqRes({ userId: 'user-free', isPremium: false });
    await transactionsController.scanSlipWithAi(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload.error).toBe('OCR_TRIAL_EXHAUSTED');
    // สำคัญที่สุด: ต้องไม่มีการยิง Claude เลยแม้แต่ครั้งเดียว (ไม่เสียเงิน)
    expect(global.fetch).not.toHaveBeenCalled();
    expect(aiOcrUsageRepository.incrementCallCount).not.toHaveBeenCalled();
  });

  it('ผู้ใช้ Free ที่ยังเหลือสิทธิ์ทดลอง อ่านได้ แต่ไม่ได้สิทธิ์เก็บรูป (slipToken = null)', async () => {
    aiOcrUsageRepository.getLifetimeUsage.mockResolvedValue({ count: 1, callCount: 1 });
    aiOcrUsageRepository.getUsageCount.mockResolvedValue(1);
    aiOcrUsageRepository.incrementCallCount.mockResolvedValue(2);
    aiOcrUsageRepository.incrementUsage.mockResolvedValue(2);

    const { req, res } = mockReqRes({ userId: 'user-trial', isPremium: false });
    await transactionsController.scanSlipWithAi(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.slip.symbol).toBe('BTC');
    // "แนบสลิปเป็นหลักฐาน" เป็นสิทธิ์ Premium แยกต่างหาก — ทดลองฟรีได้แค่ผลอ่าน
    expect(res.payload.slipToken).toBeNull();
    expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
    expect(res.payload.quota.mode).toBe('trial');
  });

  it('Premium อ่านสลิปบนเว็บ → ได้ slipToken ไว้แนบตอนยืนยัน', async () => {
    aiOcrUsageRepository.getUsageCount.mockResolvedValue(0);
    aiOcrUsageRepository.incrementCallCount.mockResolvedValue(1);
    aiOcrUsageRepository.incrementUsage.mockResolvedValue(1);

    const { req, res } = mockReqRes({ userId: 'user-prem', isPremium: true });
    await transactionsController.scanSlipWithAi(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.slipToken).toBe('tok-1');
    expect(res.payload.quota.mode).toBe('premium');
  });

  it('อัปโหลดรูปพลาด ต้องไม่ทำให้ผลอ่านที่จ่ายเงินไปแล้วสูญเปล่า (Fail Isolated)', async () => {
    aiOcrUsageRepository.getUsageCount.mockResolvedValue(0);
    aiOcrUsageRepository.incrementCallCount.mockResolvedValue(1);
    aiOcrUsageRepository.incrementUsage.mockResolvedValue(1);
    storageService.uploadTransactionSlip.mockRejectedValue(new Error('storage down'));

    const { req, res } = mockReqRes({ userId: 'user-prem2', isPremium: true });
    await transactionsController.scanSlipWithAi(req, res);

    // ยังต้องได้ผลอ่านครบ แค่ไม่มี token แนบ
    expect(res.statusCode).toBe(200);
    expect(res.payload.slip.symbol).toBe('BTC');
    expect(res.payload.slipToken).toBeNull();
  });
});
