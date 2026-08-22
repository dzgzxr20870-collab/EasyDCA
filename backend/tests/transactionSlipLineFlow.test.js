// ═══════════════════════════════════════════════════════════════════════
// INTEGRATION — LINE: ถามหาสลิปหลังบันทึกด้วยการพิมพ์ (งานที่ 3)
// ═══════════════════════════════════════════════════════════════════════
// พิสูจน์ "การตัดสินว่ารูปที่ส่งเข้ามาจะเข้า OCR หรือเข้าการแนบสลิป" ซึ่งเป็นจุดที่
// พังแล้วเสียหายจริง 2 ทาง:
//   - ตัดสินผิดเป็น "แนบสลิป" ทั้งที่ผู้ใช้อยากให้ AI อ่าน → รูปถูกแนบเข้ารายการเก่า
//     เงียบๆ (หลักฐานผิดรายการ) และผู้ใช้ไม่ได้สิ่งที่ต้องการ
//   - ตัดสินผิดเป็น "OCR" ทั้งที่ผู้ใช้แค่จะแนบหลักฐาน → เสียโควตา/เสียเงินค่า Claude
//     ฟรีๆ ทุกครั้ง
jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/line.service');
jest.mock('../src/services/storage.service');
jest.mock('../src/services/payment.service');
jest.mock('../src/services/entitlement.service');
jest.mock('../src/services/slipOcr.service');
jest.mock('../src/services/slipOcrAccess.service');
jest.mock('../src/services/transactionSlipSession.service');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/lineWebhookEvent.repository');
// ⚠️ ต้อง Spread ของจริงเป็นฐานเสมอ (Pattern เดียวกับ webhook.controller.test.js):
// การ Mock config เป็น Object ที่เขียนเองล้วนจะทำให้ Module ที่อ่าน Key อื่นตอน Import
// (priceFeed อ่าน twelveData.rateLimit / supabase อ่าน supabase.url) พังทันทีตั้งแต่
// โหลด Suite — และจะพังเพิ่มทุกครั้งที่มีใครเพิ่ม Config ใหม่ในอนาคต
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    payment: { ...actual.payment, adminLineUserIds: [] },
  };
});

const userRepository = require('../src/repositories/user.repository');
const lineService = require('../src/services/line.service');
const storageService = require('../src/services/storage.service');
const paymentService = require('../src/services/payment.service');
const slipOcrService = require('../src/services/slipOcr.service');
const slipOcrAccess = require('../src/services/slipOcrAccess.service');
const transactionSlipSession = require('../src/services/transactionSlipSession.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');
const { handleEvent } = require('../src/controllers/webhook.controller');

const PREMIUM_USER = {
  id: 'user-1',
  lineUserId: 'U123',
  plan: 'premium',
  planExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  pdpaConsentedAt: '2026-07-01T00:00:00.000Z',
};

function imageEvent() {
  return {
    type: 'message',
    replyToken: 'reply-token-1',
    source: { userId: 'U123' },
    message: { type: 'image', id: 'img-1' },
    webhookEventId: `evt-${Math.random()}`,
  };
}

function lastReplyText() {
  const calls = lineService.replyMessage.mock.calls;
  if (calls.length === 0) return '';
  return JSON.stringify(calls[calls.length - 1][1]);
}

describe('LINE: รูปเข้า "แนบสลิป" หรือ "AI OCR"', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findByLineUserId.mockResolvedValue(PREMIUM_USER);
    lineWebhookEventRepository.claimEvent.mockResolvedValue(true);
    // ไม่มีคำขอชำระเงินค้าง (ไม่งั้นจะเข้าเส้นทางสลิปโอนเงิน Round 5 ก่อนเสมอ)
    paymentService.findPendingByUserId.mockResolvedValue(null);
    lineService.getMessageContent.mockResolvedValue({
      buffer: Buffer.from('img'),
      contentType: 'image/jpeg',
    });
    lineService.replyMessage.mockResolvedValue(undefined);
  });

  describe('มี Session รอสลิปอยู่ → แนบเข้ารายการนั้น (ไม่เรียก AI)', () => {
    beforeEach(() => {
      transactionSlipSession.getActiveSession.mockResolvedValue({
        userId: 'user-1',
        transactionId: 'tx-abc',
      });
      storageService.uploadTransactionSlip.mockResolvedValue({
        token: 'tok-1',
        path: 'user-1/tok-1.jpg',
      });
      transactionRepository.attachSlipImagePath.mockResolvedValue(undefined);
    });

    it('แนบรูปเข้ารายการที่ระบุ และไม่เรียก AI OCR เลย (ไม่เสียเงิน/ไม่กินโควตา)', async () => {
      await handleEvent(imageEvent());

      expect(transactionRepository.attachSlipImagePath).toHaveBeenCalledWith(
        'tx-abc',
        'user-1/tok-1.jpg',
        'user-1'
      );
      // หัวใจของ Test นี้: ต้องไม่แตะ AI เลย
      expect(slipOcrService.extractSlip).not.toHaveBeenCalled();
      expect(slipOcrAccess.checkAccess).not.toHaveBeenCalled();
      expect(lastReplyText()).toContain('แนบสลิป');
    });

    it('ปิด Session หลังแนบสำเร็จ (รูปใบถัดไปต้องไหลเข้า OCR ตามปกติ)', async () => {
      await handleEvent(imageEvent());

      expect(transactionSlipSession.stopWaiting).toHaveBeenCalledWith('user-1');
    });

    // ⚠️ ถ้าไม่ปิด Session ตอนล้มเหลว รูปใบถัดไปที่ผู้ใช้ตั้งใจส่งให้ AI อ่านจะโดนดูด
    // เข้ารายการเดิมซ้ำอีกจนกว่าจะครบ TTL — วนไม่จบ
    it('แนบไม่สำเร็จ → ยังต้องปิด Session + ลบไฟล์ที่อัปโหลดค้าง (Compensating Delete)', async () => {
      transactionRepository.attachSlipImagePath.mockRejectedValue(new Error('db down'));
      storageService.deleteTransactionSlip.mockResolvedValue(undefined);

      await handleEvent(imageEvent());

      expect(transactionSlipSession.stopWaiting).toHaveBeenCalledWith('user-1');
      expect(storageService.deleteTransactionSlip).toHaveBeenCalledWith('user-1/tok-1.jpg');
      // ต้องย้ำว่าธุรกรรมยังอยู่ ไม่ได้หายไปด้วย
      expect(lastReplyText()).toContain('บันทึกเรียบร้อยแล้ว');
    });

    it('ไฟล์ผิดชนิด/ใหญ่เกิน → ตอบข้อความที่บอกสาเหตุได้ตรง และปิด Session', async () => {
      const err = new Error('too large');
      err.name = 'StorageServiceError';
      err.code = 'SLIP_TOO_LARGE';
      storageService.uploadTransactionSlip.mockRejectedValue(err);

      await handleEvent(imageEvent());

      expect(lastReplyText()).toContain('10 MB');
      expect(transactionSlipSession.stopWaiting).toHaveBeenCalledWith('user-1');
    });
  });

  describe('ไม่มี Session → เข้า AI OCR เหมือนเดิมทุกประการ (Requirement ข้อ 2)', () => {
    beforeEach(() => {
      transactionSlipSession.getActiveSession.mockResolvedValue(null);
    });

    it('Premium: เรียก extractSlip ตามเส้นทางเดิม และไม่แตะการแนบสลิปเลย', async () => {
      slipOcrAccess.checkAccess.mockResolvedValue({ allowed: true, mode: 'premium' });
      slipOcrService.extractSlip.mockResolvedValue({
        symbol: 'BTC', side: 'buy', orderStatus: 'filled', quantity: 0.01,
        pricePerUnit: 3400000, amountThb: 34000, currency: 'THB',
        dateIso: null, confidence: 'high', remainingQuota: 49,
      });
      storageService.uploadTransactionSlip.mockResolvedValue({ token: 'tok-9', path: 'p/tok-9' });

      await handleEvent(imageEvent());

      expect(slipOcrService.extractSlip).toHaveBeenCalledTimes(1);
      expect(transactionRepository.attachSlipImagePath).not.toHaveBeenCalled();
    });

    it('ผู้ใช้ทดลองฟรี: อ่านได้ แต่ไม่เก็บรูป (ไม่อัปโหลดขึ้น Storage เลย)', async () => {
      slipOcrAccess.checkAccess.mockResolvedValue({
        allowed: true, mode: 'trial', trialRemaining: 3,
      });
      slipOcrService.extractSlip.mockResolvedValue({
        symbol: 'BTC', side: 'buy', orderStatus: 'filled', quantity: 0.01,
        pricePerUnit: 3400000, amountThb: 34000, currency: 'THB',
        dateIso: null, confidence: 'high', remainingQuota: 0,
      });

      await handleEvent(imageEvent());

      expect(slipOcrService.extractSlip).toHaveBeenCalledTimes(1);
      // "แนบสลิปเป็นหลักฐาน" เป็นสิทธิ์ Premium แยกต่างหาก
      expect(storageService.uploadTransactionSlip).not.toHaveBeenCalled();
    });

    it('ใช้สิทธิ์ทดลองครบแล้ว → ตอบชวนอัพเกรด และไม่เรียก Claude เลย', async () => {
      slipOcrAccess.checkAccess.mockResolvedValue({
        allowed: false, reason: 'TRIAL_EXHAUSTED', trialRemaining: 0,
      });

      await handleEvent(imageEvent());

      expect(slipOcrService.extractSlip).not.toHaveBeenCalled();
      expect(lastReplyText()).toContain('ทดลอง');
    });
  });
});
