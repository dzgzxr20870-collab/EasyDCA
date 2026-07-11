// slipOcr.service — อ่านสลิปด้วย Claude Vision (Round 9)
// Mock Repository (Quota) + global.fetch (Claude) ; ใช้ thaiDate.util จริง
jest.mock('../src/repositories/aiOcrUsage.repository');

const aiOcrUsageRepository = require('../src/repositories/aiOcrUsage.repository');
const slipOcr = require('../src/services/slipOcr.service');

const USER_ID = 'user-1';
const BUFFER = Buffer.from([1, 2, 3]);
const NOW = new Date('2026-07-10T06:00:00Z'); // Bangkok → 2026-07

// จำลอง Response สำเร็จของ Claude Messages API (content[0].text = JSON string)
function claudeOk(obj) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }),
  };
}

const VALID_SLIP = {
  is_slip: true,
  multiple_items: false,
  symbol: 'btc',
  side: 'buy',
  quantity: 0.5,
  price_per_unit: 1500000,
  amount_thb: 750000,
  date: '05/07/2026',
  confidence: 'high',
};

beforeEach(() => {
  jest.clearAllMocks();
  slipOcr.__clearRateLimit();
  process.env.CLAUDE_API_KEY = 'test-key';
  aiOcrUsageRepository.getUsageCount.mockResolvedValue(0);
  aiOcrUsageRepository.incrementUsage.mockResolvedValue(1);
  global.fetch = jest.fn().mockResolvedValue(claudeOk(VALID_SLIP));
});

describe('extractSlip — สำเร็จ', () => {
  test('อ่านได้ครบ → normalize + นับโควตา + คืนโควตาคงเหลือ', async () => {
    aiOcrUsageRepository.incrementUsage.mockResolvedValue(3);

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);

    // เรียก Claude ด้วย model haiku-4.5 + x-api-key + image block
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.messages[0].content[0].type).toBe('image');
    expect(global.fetch.mock.calls[0][1].headers['x-api-key']).toBe('test-key');

    // นับโควตาด้วย year_month ของ Bangkok (2026-07)
    expect(aiOcrUsageRepository.incrementUsage).toHaveBeenCalledWith(USER_ID, '2026-07');

    expect(result.symbol).toBe('BTC'); // upper-case
    expect(result.side).toBe('buy');
    expect(result.quantity).toBe(0.5);
    expect(result.pricePerUnit).toBe(1500000);
    expect(result.amountThb).toBe(750000);
    expect(result.date).toBe('05/07/2026');
    expect(result.dateIso).toBe('2026-07-05');
    expect(result.remainingQuota).toBe(47); // 50 - 3
    expect(result.quotaLimit).toBe(50);
  });

  test('side ไม่ชัด (null) → Default เป็น buy', async () => {
    global.fetch.mockResolvedValue(claudeOk({ ...VALID_SLIP, side: null }));
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBe('buy');
  });

  // ── Multi-Currency (Round 10) ────────────────────────────────────────────
  test('สลิปปกติไม่มี currency → Default เป็น THB (Backward Compat)', async () => {
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.currency).toBe('THB');
    expect(result.amountThb).toBe(750000);
  });

  test('สลิป USD (currency=USD, field ใหม่ "amount") → คืน currency USD + amountThb=ยอด USD', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({
        is_slip: true,
        multiple_items: false,
        symbol: 'aapl',
        side: 'buy',
        quantity: 2,
        price_per_unit: 190,
        amount: 380,
        currency: 'USD',
        date: '05/07/2026',
        confidence: 'high',
      })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.symbol).toBe('AAPL');
    expect(result.currency).toBe('USD');
    expect(result.quantity).toBe(2);
    expect(result.pricePerUnit).toBe(190);
    expect(result.amountThb).toBe(380); // ค่าเป็น USD ตาม currency (ชื่อ Key คงเดิม)
  });

  test('สลิปแบบมีแค่ยอดรวม (Dime! USD) → amount ถูกอ่านเป็น "จำนวนเงิน" ไม่ใช่ราคาต่อหน่วย', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({
        is_slip: true,
        multiple_items: false,
        symbol: 'nvda',
        side: 'buy',
        quantity: null,
        price_per_unit: null,
        amount: 1000,
        currency: 'USD',
        date: null,
        confidence: 'medium',
      })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.symbol).toBe('NVDA');
    expect(result.currency).toBe('USD');
    expect(result.quantity).toBeNull();
    expect(result.pricePerUnit).toBeNull();
    expect(result.amountThb).toBe(1000); // ยอดรวมเข้า amount ไม่ใช่ price_per_unit
  });

  test('SYSTEM_PROMPT + JSON schema มี field currency และ amount (คุมพฤติกรรม Model)', async () => {
    await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.system).toContain('currency');
    expect(body.system).toContain('"amount"');
  });

  test('Field บางตัวอ่านไม่ได้ (price null) → คืน null ไม่เดา, ยังนับโควตา (อ่านสำเร็จ)', async () => {
    global.fetch.mockResolvedValue(claudeOk({ ...VALID_SLIP, price_per_unit: null }));
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.pricePerUnit).toBeNull();
    expect(aiOcrUsageRepository.incrementUsage).toHaveBeenCalled();
  });

  test('increment ล้มเหลว → ไม่ Block, ยังคืน Preview (remaining จาก used+1)', async () => {
    aiOcrUsageRepository.getUsageCount.mockResolvedValue(4);
    aiOcrUsageRepository.incrementUsage.mockRejectedValue(new Error('db down'));
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.symbol).toBe('BTC');
    expect(result.remainingQuota).toBe(45); // 50 - (4+1)
  });
});

describe('extractSlip — ไม่นับโควตา (Error / ไม่ผ่าน)', () => {
  test('โควตาเต็ม (>=50) → OCR_QUOTA_EXCEEDED, ไม่เรียก Claude, ไม่นับ', async () => {
    aiOcrUsageRepository.getUsageCount.mockResolvedValue(50);

    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_QUOTA_EXCEEDED' })
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('ส่งถี่เกิน 1 ครั้ง/10 วินาที → OCR_RATE_LIMITED (ครั้งที่ 2)', async () => {
    await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    // ครั้งที่ 2 ห่างเพียง 5 วินาที
    const soon = new Date(NOW.getTime() + 5000);
    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', soon)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_RATE_LIMITED' })
    );
  });

  test('ไม่ใช่สลิป (is_slip=false) → OCR_NOT_A_SLIP, ไม่นับ', async () => {
    global.fetch.mockResolvedValue(claudeOk({ is_slip: false }));
    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_NOT_A_SLIP' })
    );
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('Symbol อ่านไม่ได้ (null) → OCR_NOT_A_SLIP, ไม่นับ', async () => {
    global.fetch.mockResolvedValue(claudeOk({ ...VALID_SLIP, symbol: null }));
    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_NOT_A_SLIP' })
    );
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('หลายรายการในรูป → OCR_MULTIPLE_ITEMS, ไม่นับ', async () => {
    global.fetch.mockResolvedValue(claudeOk({ ...VALID_SLIP, multiple_items: true }));
    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_MULTIPLE_ITEMS' })
    );
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('Claude ตอบ non-200 → OCR_FAILED, ไม่นับ', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_FAILED' })
    );
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('Claude ตอบไม่ใช่ JSON → OCR_FAILED, ไม่นับ', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ขอโทษครับ อ่านไม่ออก' }] }),
    });
    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_FAILED' })
    );
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('ไม่ได้ตั้ง CLAUDE_API_KEY → OCR_NOT_CONFIGURED, ไม่เรียก Claude, ไม่นับ', async () => {
    delete process.env.CLAUDE_API_KEY;
    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_NOT_CONFIGURED' })
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });
});
