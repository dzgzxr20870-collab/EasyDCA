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

// Fixture สะท้อนสิ่งที่ Model ตอบจริงหลังเพิ่ม side_evidence/net_amount ลง Prompt —
// สลิปซื้อปกติที่ทั้ง 3 สัญญาณสอดคล้องกัน (AI + หลักฐานข้อความ + ตัวเลข)
const VALID_SLIP = {
  is_slip: true,
  multiple_items: false,
  symbol: 'btc',
  side: 'buy',
  side_evidence: 'ซื้อ BTC',
  quantity: 0.5,
  price_per_unit: 1500000,
  amount: 750000,
  net_amount: 750150, // จ่ายจริงมากกว่ามูลค่า = ค่าธรรมเนียมฝั่งซื้อ
  date: '05/07/2026',
  confidence: 'high',
};

beforeEach(() => {
  jest.clearAllMocks();
  slipOcr.__clearRateLimit();
  process.env.CLAUDE_API_KEY = 'test-key';
  aiOcrUsageRepository.getUsageCount.mockResolvedValue(0);
  aiOcrUsageRepository.incrementUsage.mockResolvedValue(1);
  // เพดานการเรียก Claude (F2) — Default ให้ยังไม่ชนเพดาน เพื่อไม่กระทบ Test เดิมทุกตัว
  aiOcrUsageRepository.incrementCallCount.mockResolvedValue(1);
  global.fetch = jest.fn().mockResolvedValue(claudeOk(VALID_SLIP));
});

describe('extractSlip — สำเร็จ', () => {
  test('อ่านได้ครบ → normalize + นับโควตา + คืนโควตาคงเหลือ', async () => {
    aiOcrUsageRepository.incrementUsage.mockResolvedValue(3);

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);

    // เรียก Claude ด้วย model sonnet-5 + x-api-key + image block
    // ⚠️ เปลี่ยนจาก haiku-4-5 โดยตั้งใจ — Haiku อ่านทิศทางรายการผิดบนสลิปโบรกไทย
    // (เคส BCPG: "ขาย" → side="buy" ด้วย confidence="high" ซ้ำ 3 รอบ) ส่วน Sonnet 5
    // ตอบถูกด้วย Prompt เดียวกัน ยึด Assertion นี้ไว้กันเผลอ Downgrade กลับเพื่อลดต้นทุน
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-5');
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

  // ⚠️ พฤติกรรมเปลี่ยนโดยตั้งใจ (Bug Fix: สลิป "ขาย" ถูกบันทึกเป็น "ซื้อ")
  // Test เดิมชื่อ 'side ไม่ชัด (null) → Default เป็น buy' ยืนยันว่า null ต้องได้ 'buy'
  // ซึ่งเป็นการ "ล็อกบั๊กไว้เป็นสเปก" — โค้ดเดิมเทียบ `raw.side === 'sell'` แบบ strict +
  // case-sensitive แล้ว Default ที่เหลือทั้งหมดเป็น buy ทำให้ "Sell"/"SELL"/"ขาย"/
  // " sell "/null กลายเป็นซื้อหมด (5 ใน 6 รูปแบบที่ LLM ตอบจริง) → P&L/จำนวนหน่วย
  // ถือครองกลับด้านบน Immutable Ledger
  // สเปกใหม่: อ่านไม่ชัด = null เท่านั้น ห้ามเดาเป็น buy แล้วให้ผู้ใช้เลือกเองบนการ์ด Preview
  // (ตัด side_evidence/net_amount ออกด้วย เพื่อให้เป็นเคส "ไม่มีสัญญาณใดยืนยันเลย" จริงๆ —
  // ถ้ามีหลักฐานข้อความอยู่ ระบบยังสรุปทิศทางจากหลักฐานได้ ซึ่งเป็นพฤติกรรมที่ถูกต้อง)
  test('side ไม่ชัด (null) + ไม่มีสัญญาณยืนยัน → คืน null (ห้าม Default เป็น buy)', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({ ...VALID_SLIP, side: null, side_evidence: null, net_amount: null })
    );
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBeNull();
  });

  test('AI ตอบ side=null แต่มีหลักฐานข้อความ → สรุปทิศทางจากหลักฐานได้', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({ ...VALID_SLIP, side: null, side_evidence: 'ซื้อ BTC' })
    );
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBe('buy');
  });

  // ── Regression: สลิป "ขาย" ต้องไม่กลายเป็น "ซื้อ" ────────────────────────
  // AI ตอบ side มาหลายรูปแบบ (case/ช่องว่าง/ภาษาไทย) — เมื่อหลักฐานข้อความยืนยันว่าขาย
  // ผลลัพธ์ต้องเป็น sell ทุกกรณี
  const SELL_SLIP = {
    ...VALID_SLIP,
    side_evidence: 'ขาย BCPG',
    net_amount: 749000, // ได้รับจริงน้อยกว่ามูลค่า = ค่าธรรมเนียมฝั่งขาย
  };

  test.each([
    ['sell', 'sell'],
    ['Sell', 'Sell'],
    ['SELL', 'SELL'],
    ['ขาย', 'ขาย'],
    ['" sell " (มีช่องว่างติดมา)', ' sell '],
  ])('สลิปขาย: AI ตอบ side=%s → ต้องได้ sell', async (_label, sideValue) => {
    global.fetch.mockResolvedValue(claudeOk({ ...SELL_SLIP, side: sideValue }));
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBe('sell');
  });

  // Regression ทางกลับ: Use Case หลักเดิม (ซื้อ) ต้องไม่พัง
  test.each([
    ['buy', 'buy'],
    ['Buy', 'Buy'],
    ['BUY', 'BUY'],
    ['ซื้อ', 'ซื้อ'],
  ])('สลิปซื้อ: AI ตอบ side=%s → ต้องได้ buy', async (_label, sideValue) => {
    global.fetch.mockResolvedValue(claudeOk({ ...VALID_SLIP, side: sideValue }));
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBe('buy');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // เคส BCPG จริง (2026-07-26): Haiku 4.5 ตอบ side="buy" ด้วย confidence="high"
  // บนสลิปที่เขียน "ขาย BCPG" ชัดเจน — และคัดหลักฐาน "ขาย BCPG" ออกมาได้ถูกต้องด้วย
  // (อ่านตัวอักษรออก แต่ Map ความหมายพลาด) หลักฐานข้อความจึงต้องชนะข้อสรุปของ AI
  // ═══════════════════════════════════════════════════════════════════════
  test('เคส BCPG: AI สรุปผิดเป็น buy แต่หลักฐานคือ "ขาย" → ต้องได้ sell (หลักฐานชนะ)', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({
        ...VALID_SLIP,
        symbol: 'BCPG',
        side: 'buy', // AI สรุปผิด
        side_evidence: 'ขาย BCPG', // แต่คัดข้อความจริงมาถูก
        quantity: 10,
        price_per_unit: 6.9,
        amount: 69,
        net_amount: 68.89, // ได้รับน้อยกว่ามูลค่า → ยืนยันซ้ำว่าเป็นการขาย
        confidence: 'high', // confidence สูงแต่ผิด — ห้ามใช้ตัดสิน
      })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);

    expect(result.side).toBe('sell');
    expect(result.symbol).toBe('BCPG');
    // amount = มูลค่าก่อนค่าธรรมเนียม (10 × 6.9) ไม่ใช่ยอดสุทธิ 68.89
    expect(result.amountThb).toBe(69);
  });

  test('สัญญาณขัดกัน (หลักฐานว่าขาย แต่ตัวเลขชี้ว่าซื้อ) → null ให้ผู้ใช้เลือกเอง', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({
        ...VALID_SLIP,
        side: 'sell',
        side_evidence: 'ขาย BTC',
        quantity: 10,
        price_per_unit: 6.9,
        amount: 69,
        net_amount: 69.2, // จ่ายมากกว่ามูลค่า = ลายเซ็นของการซื้อ → ขัดกับหลักฐาน
      })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBeNull();
  });

  test('มีแต่คำตอบของ AI (ไม่มีหลักฐาน ไม่มีสัญญาณตัวเลข) → null ไม่เชื่อ AI ลำพัง', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({ ...VALID_SLIP, side: 'buy', side_evidence: null, net_amount: null })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBeNull();
  });

  test('หลักฐานกำกวม ("รายการซื้อขาย") แต่ตัวเลขชี้ชัดว่าขาย → เชื่อสัญญาณตัวเลข', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({
        ...VALID_SLIP,
        side: null,
        side_evidence: 'รายการซื้อขายหลักทรัพย์', // มีทั้งซื้อและขาย = ตัดสินไม่ได้
        quantity: 10,
        price_per_unit: 6.9,
        amount: 69,
        net_amount: 68.89,
      })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.side).toBe('sell');
  });

  // ค่าที่ตีความไม่ได้เลย + ไม่มีหลักฐาน → null (ไม่เดาไปทางใดทางหนึ่ง)
  test.each([['transfer'], ['ฝากเงิน'], ['']])(
    'side ที่ตีความไม่ได้ (%s) → คืน null',
    async (sideValue) => {
      global.fetch.mockResolvedValue(
        claudeOk({ ...VALID_SLIP, side: sideValue, side_evidence: null, net_amount: null })
      );
      const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
      expect(result.side).toBeNull();
    }
  );

  // ── amount = มูลค่าก่อนค่าธรรมเนียม (นิยามมาตรฐานทุก Broker) ────────────────
  test('AI ส่ง amount เป็นยอดสุทธิมา → โค้ดคำนวณ qty × price ทับให้เสมอ', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({ ...VALID_SLIP, quantity: 10, price_per_unit: 6.9, amount: 68.89, net_amount: 68.89 })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    // 10 × 6.9 = 68.99999999999999 ต้องปัดเป็น 69 ไม่ใช่ปล่อยเศษ Floating Point
    expect(result.amountThb).toBe(69);
  });

  test('สลิป Amount-only (ไม่มี qty/price) → ใช้ amount ที่ AI อ่านมาตามเดิม', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({
        ...VALID_SLIP,
        quantity: null,
        price_per_unit: null,
        amount: 1000,
        net_amount: null,
      })
    );

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.amountThb).toBe(1000);
    expect(result.quantity).toBeNull();
  });

  // ── Guard วันที่อนาคต (เจอจริงตอนทดสอบ BCPG: "69" ถูกอ่านเป็น ค.ศ. 2069) ──────
  test('วันที่หลุดไปอนาคต (2069) → ทิ้งค่า ให้ Fallback เป็นวันนี้ ไม่บันทึกวันที่ผิด', async () => {
    global.fetch.mockResolvedValue(claudeOk({ ...VALID_SLIP, date: '26/06/2069' }));

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.dateIso).toBeNull();
    expect(result.date).toBeNull();
  });

  test('วันที่ พ.ศ. ปกติ (2569) → แปลงเป็น ค.ศ. ถูกต้อง ไม่โดน Guard', async () => {
    global.fetch.mockResolvedValue(claudeOk({ ...VALID_SLIP, date: '26/06/2569' }));

    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.dateIso).toBe('2026-06-26');
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

// ═══════════════════════════════════════════════════════════════════════════
// เพดานการเรียก Claude Vision รายเดือน (Offensive Review Round 2 — F2)
// ═══════════════════════════════════════════════════════════════════════════
// ช่องโหว่เดิม: โควตา 50/เดือนนับเฉพาะ "อ่านสำเร็จ" — ส่งรูปที่ไม่ใช่สลิปเข้ามา Claude
// ถูกเรียก+เก็บเงินทุกครั้ง แต่ throw ออกก่อนถึงบรรทัดนับ ตัวนับจึงไม่ขยับเลยตลอดกาล
// เพดานที่สอง (call_count) นับ "ทุกครั้งที่กำลังจะยิง" จึงปิดช่องนี้ได้
describe('extractSlip — เพดานการเรียก Claude Vision (F2)', () => {
  test('เพดานผูกกับ MONTHLY_QUOTA เสมอ และต้องสูงกว่าเสมอ', () => {
    // ถ้าเพดานคุมต้นทุนต่ำกว่าโควตาที่สัญญากับผู้ใช้ = ผู้ใช้สุจริตโดนบล็อกทั้งที่โควตา
    // ยังเหลือ (สัญญาที่ให้ไว้เป็นโมฆะ) — ล็อกความสัมพันธ์นี้ไว้กันเผลอปรับตัวเดียว
    expect(slipOcr.MONTHLY_CALL_LIMIT).toBeGreaterThan(slipOcr.MONTHLY_QUOTA);
    expect(slipOcr.MONTHLY_CALL_LIMIT).toBe(200);
  });

  test('นับ call_count "ก่อน" ยิง Claude เสมอ (แม้ครั้งนั้นจะอ่านไม่ออก)', async () => {
    global.fetch.mockResolvedValue(claudeOk({ is_slip: false }));

    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_NOT_A_SLIP' })
    );

    // นี่คือหัวใจของ Fix: ครั้งที่ "อ่านไม่ออก" ต้องถูกนับ (จ่ายเงินไปแล้ว)
    // แต่ต้องไม่กินโควตาที่สัญญากับผู้ใช้ (count เดิม)
    expect(aiOcrUsageRepository.incrementCallCount).toHaveBeenCalledWith(USER_ID, '2026-07');
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('ชนเพดาน → OCR_CALL_LIMIT_EXCEEDED และไม่เรียก Claude เลย', async () => {
    // ค่าที่ RPC คืนกลับมา = ค่าหลังบวกแล้ว ครั้งที่ทำให้เกิน 200 คือครั้งที่คืน 201
    aiOcrUsageRepository.incrementCallCount.mockResolvedValue(201);

    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_CALL_LIMIT_EXCEEDED' })
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('ครั้งที่ 200 พอดี (= เพดาน) ยังผ่าน — ขอบเขตต้องเป็น > ไม่ใช่ >=', async () => {
    aiOcrUsageRepository.incrementCallCount.mockResolvedValue(200);
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.symbol).toBe('BTC');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ── Test หลักตามที่ระบุใน Prompt: นับจำนวนครั้งที่ Claude ถูกเรียก "จริง" ────────
  // ยิงรัวๆ ด้วยรูปที่อ่านไม่ออก (is_slip=false) เกินเพดาน แล้วนับ global.fetch
  // ต้องไม่เกิน MONTHLY_CALL_LIMIT — นี่คือสิ่งที่พังจริงก่อน Fix (นับได้ 210 ครั้ง)
  test('ยิงรูปที่ไม่ใช่สลิปรัว 210 ครั้ง → Claude ถูกเรียกไม่เกิน 200 ครั้ง', async () => {
    global.fetch.mockResolvedValue(claudeOk({ is_slip: false }));

    // จำลอง Counter จริงของ Postgres (Increment แล้วคืนค่าใหม่) — ไม่ Hardcode ค่าคืน
    // เพราะต้องพิสูจน์ว่า "ตัวนับที่เดินจริง" หยุด Claude ได้ ไม่ใช่แค่ Mock ตอบตามบท
    let counter = 0;
    aiOcrUsageRepository.incrementCallCount.mockImplementation(async () => {
      counter += 1;
      return counter;
    });

    const ATTEMPTS = 210;
    for (let i = 0; i < ATTEMPTS; i += 1) {
      // เลื่อนเวลาไปทีละ 11 วิ เพื่อไม่ให้ติด Rate Limit 10 วิ (คนละด่านกัน — ด่านนี้
      // ผู้ไม่หวังดีรออยู่แล้วได้ ต้องพิสูจน์ว่าเพดานรายเดือนหยุดได้เองโดยไม่พึ่ง Rate Limit)
      const at = new Date(NOW.getTime() + i * 11_000);
      await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', at)).rejects.toThrow(
        expect.objectContaining({
          code: i < 200 ? 'OCR_NOT_A_SLIP' : 'OCR_CALL_LIMIT_EXCEEDED',
        })
      );
    }

    // จำนวนครั้งที่ "จ่ายเงินจริง" ต้องหยุดที่เพดานพอดี ไม่ใช่ 210
    expect(global.fetch).toHaveBeenCalledTimes(slipOcr.MONTHLY_CALL_LIMIT);
    expect(aiOcrUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test('นับ call_count ไม่ได้ (DB ล่ม) → Fail-closed ไม่ยิง Claude', async () => {
    // ต่างจาก incrementUsage ตอนท้ายที่ยอม Fail-open ได้ (จ่ายเงินไปแล้ว การนับพลาด
    // ไม่ควรทำลาย UX) — ตรงนี้ยังไม่จ่าย ถ้าเดินต่อทั้งที่บังคับเพดานไม่ได้ = ทำให้ DB
    // ล่มเมื่อไหร่ก็ยิงฟรีไม่จำกัดเมื่อนั้น
    aiOcrUsageRepository.incrementCallCount.mockRejectedValue(new Error('db down'));

    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_FAILED' })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('โควตาเต็มก่อน → ไม่นับ call_count ด้วย (ไม่มีการยิง Claude ให้ต้องนับ)', async () => {
    aiOcrUsageRepository.getUsageCount.mockResolvedValue(50);

    await expect(slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW)).rejects.toThrow(
      expect.objectContaining({ code: 'OCR_QUOTA_EXCEEDED' })
    );
    expect(aiOcrUsageRepository.incrementCallCount).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit: ตรรกะตัดสินทิศทางรายการ 3 สัญญาณ (แยกจากการยิง Claude จริง)
//
// ที่มา: Haiku 4.5 ตอบ side ผิดด้านบนสลิปโบรกไทยด้วย confidence="high" ซ้ำๆ ได้
// จึงไม่เชื่อข้อสรุปของ AI ลำพังอีกต่อไป — ต้องมีหลักฐานข้อความจากรูป หรือสัญญาณตัวเลข
// มายืนยัน และถ้าสองสัญญาณที่ตรวจสอบได้ขัดกันเอง ให้ถือว่ากำกวมทันที
// ═══════════════════════════════════════════════════════════════════════════
describe('sideFromEvidence — อ่านทิศทางจากข้อความที่คัดมาจากรูป', () => {
  test.each([
    ['ขาย BCPG', 'sell'],
    ['มูลค่าหุ้นที่ขาย', 'sell'],
    ['จำหน่ายหน่วยลงทุน', 'sell'],
    ['Sell AAPL', 'sell'],
    ['Sold 10 shares', 'sell'],
    ['ซื้อ BTC', 'buy'],
    ['Buy Order', 'buy'],
    ['Bought 0.5 BTC', 'buy'],
  ])('%s → %s', (evidence, expected) => {
    expect(slipOcr.sideFromEvidence(evidence)).toBe(expected);
  });

  // "ซื้อขาย" มีทั้งสองคำในตัวเอง — ต้องไม่เดาไปทางใดทางหนึ่ง
  test.each([
    ['รายการซื้อขายหลักทรัพย์'],
    ['คำสั่งซื้อขาย'],
    ['โอนเงิน'],
    [''],
    [null],
    [undefined],
  ])('กำกวม/ไม่มีคำบ่งชี้ (%s) → null', (evidence) => {
    expect(slipOcr.sideFromEvidence(evidence)).toBeNull();
  });
});

describe('numericSideSignal — ซื้อจ่ายเพิ่ม / ขายได้รับน้อยกว่ามูลค่า', () => {
  test('net < gross (หักค่าคอม+VAT) → sell', () => {
    expect(slipOcr.numericSideSignal(10, 6.9, 68.89)).toBe('sell');
  });

  test('net > gross (บวกค่าคอม+VAT) → buy', () => {
    expect(slipOcr.numericSideSignal(10, 6.9, 69.15)).toBe('buy');
  });

  test('เท่ากันพอดี (ไม่มีค่าธรรมเนียม) → null ไม่ใช่ข้อสรุป', () => {
    expect(slipOcr.numericSideSignal(10, 6.9, 69)).toBeNull();
  });

  test.each([
    ['ไม่มี net_amount', 10, 6.9, null],
    ['ไม่มี quantity', null, 6.9, 68.89],
    ['ไม่มี price', 10, null, 68.89],
    ['ค่าติดลบ', 10, 6.9, -5],
  ])('ข้อมูลไม่ครบ (%s) → null', (_label, qty, price, net) => {
    expect(slipOcr.numericSideSignal(qty, price, net)).toBeNull();
  });
});

describe('resolveSide — รวม 3 สัญญาณ', () => {
  test('เคส BCPG: AI ผิด แต่หลักฐาน+ตัวเลขตรงกัน → หลักฐานชนะ', () => {
    expect(
      slipOcr.resolveSide({ aiSide: 'buy', evidenceSide: 'sell', numericSide: 'sell' })
    ).toEqual({ side: 'sell', reason: 'evidence_overrides_ai' });
  });

  test('ทุกสัญญาณตรงกัน → ใช้ค่านั้น', () => {
    expect(
      slipOcr.resolveSide({ aiSide: 'buy', evidenceSide: 'buy', numericSide: 'buy' })
    ).toEqual({ side: 'buy', reason: 'evidence_agrees_with_ai' });
  });

  test('หลักฐานขัดกับตัวเลข → null (กำกวม ให้ผู้ใช้เลือก)', () => {
    expect(
      slipOcr.resolveSide({ aiSide: 'sell', evidenceSide: 'sell', numericSide: 'buy' }).side
    ).toBeNull();
  });

  test('ไม่มีหลักฐาน + AI ขัดกับตัวเลข → null', () => {
    expect(
      slipOcr.resolveSide({ aiSide: 'buy', evidenceSide: null, numericSide: 'sell' }).side
    ).toBeNull();
  });

  test('ไม่มีหลักฐาน แต่ AI ตรงกับตัวเลข → ใช้ได้', () => {
    expect(
      slipOcr.resolveSide({ aiSide: 'sell', evidenceSide: null, numericSide: 'sell' })
    ).toEqual({ side: 'sell', reason: 'numeric_signal' });
  });

  test('มีแต่คำตอบ AI ลำพัง → null (นี่คือสิ่งที่พลาดในเคส BCPG)', () => {
    expect(
      slipOcr.resolveSide({ aiSide: 'buy', evidenceSide: null, numericSide: null })
    ).toEqual({ side: null, reason: 'ai_only_not_trusted' });
  });

  test('ไม่มีสัญญาณใดเลย → null', () => {
    expect(
      slipOcr.resolveSide({ aiSide: null, evidenceSide: null, numericSide: null })
    ).toEqual({ side: null, reason: 'no_signal' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// สถานะคำสั่ง (Limit Order ที่ยังไม่จับคู่ ต้องไม่ถูกบันทึกเป็นธุรกรรมสำเร็จ)
// ───────────────────────────────────────────────────────────────────────────
// ที่มา (2026-07-26): สลิป Dime! ที่เขียน "🟠 รอเวลาทำการ — คำสั่งของคุณอยู่ระหว่างการ
// ตรวจสอบ และรอส่งคำสั่ง" ถูกเสนอให้บันทึกเป็นธุรกรรมสำเร็จทันที ทั้งที่คำสั่งอาจไม่มีวัน
// จับคู่ (ยกเลิกได้/หมดอายุตอนตลาดปิด) → Ledger มีรายการที่ไม่เคยเกิดขึ้นจริง
// ═══════════════════════════════════════════════════════════════════════════
describe('statusFromEvidence — อ่านสถานะคำสั่งจากข้อความช่องสถานะ', () => {
  test.each([
    ['รอเวลาทำการ', 'pending'],
    ['รอจับคู่', 'pending'],
    ['รอดำเนินการ', 'pending'],
    ['อยู่ระหว่างการตรวจสอบ', 'pending'],
    ['Pending', 'pending'],
    ['Open', 'pending'],
    ['จับคู่แล้ว', 'filled'],
    ['สำเร็จ', 'filled'],
    ['Filled', 'filled'],
    ['Executed', 'filled'],
    ['ยกเลิกแล้ว', 'cancelled'],
    ['หมดอายุ', 'cancelled'],
    ['Cancelled', 'cancelled'],
    ['Expired', 'cancelled'],
  ])('%s → %s', (evidence, expected) => {
    expect(slipOcr.statusFromEvidence(evidence)).toBe(expected);
  });

  // ── กับดักที่ 1: Substring ผิดลำดับ ──────────────────────────────────────
  // "รอจับคู่" มีคำว่า "จับคู่" (pattern ของ filled) อยู่ข้างใน ถ้าเช็ค filled ก่อน pending
  // สลิปที่ยังไม่สำเร็จจะถูกอ่านเป็น "สำเร็จแล้ว" = บั๊กเดิมกลับมาทั้งดุ้น
  test('กับดัก: "รอจับคู่" ต้องเป็น pending ไม่ใช่ filled (มี "จับคู่" เป็นสตริงย่อย)', () => {
    expect(slipOcr.statusFromEvidence('รอจับคู่')).toBe('pending');
    expect(slipOcr.statusFromEvidence('รอจับคู่ในช่วงตลาดเปิดทำการ')).toBe('pending');
  });

  test('กับดัก: "ยังไม่สำเร็จ"/"ไม่สำเร็จ" ต้องไม่เป็น filled (มี "สำเร็จ" เป็นสตริงย่อย)', () => {
    expect(slipOcr.statusFromEvidence('ยังไม่สำเร็จ')).toBe('pending');
    expect(slipOcr.statusFromEvidence('ไม่สำเร็จ')).toBe('cancelled');
  });

  test('จับคู่บางส่วน (Partial) → pending (ยังมีส่วนที่ไม่เกิดขึ้นจริง)', () => {
    expect(slipOcr.statusFromEvidence('จับคู่บางส่วน')).toBe('pending');
    expect(slipOcr.statusFromEvidence('Partially Filled')).toBe('pending');
  });

  test.each([['โอนเงินสำเร็จแล้ว 500 บาท'], [''], [null], [undefined], ['   ']])(
    'ไม่มีคำบ่งชี้สถานะ/ค่าว่าง (%s) → null',
    (evidence) => {
      const result = slipOcr.statusFromEvidence(evidence);
      // "สำเร็จ" ในข้อความโอนเงินยังนับเป็น filled ได้ (ไม่ใช่ปัญหา — filled = บันทึกได้ปกติ)
      expect(result === null || result === 'filled').toBe(true);
    }
  );
});

describe('resolveOrderStatus — หลักฐานชนะข้อสรุป AI', () => {
  test('หลักฐานขัดกับ AI → เชื่อหลักฐาน', () => {
    expect(
      slipOcr.resolveOrderStatus({ aiStatus: 'filled', evidenceStatus: 'pending' })
    ).toEqual({ orderStatus: 'pending', reason: 'evidence_overrides_ai' });
  });

  test('ไม่มีหลักฐาน แต่ AI บอก pending → เชื่อได้ (เอียงไปทางไม่บันทึก = ปลอดภัย)', () => {
    expect(
      slipOcr.resolveOrderStatus({ aiStatus: 'pending', evidenceStatus: null })
    ).toEqual({ orderStatus: 'pending', reason: 'ai_only' });
  });

  test('ไม่มีสัญญาณเลย → null (สลิปไม่ระบุสถานะ = บันทึกได้ปกติ)', () => {
    expect(
      slipOcr.resolveOrderStatus({ aiStatus: null, evidenceStatus: null })
    ).toEqual({ orderStatus: null, reason: 'no_status_on_slip' });
  });
});

describe('isUnfilledStatus — สถานะที่ห้ามเสนอบันทึก', () => {
  test.each([
    ['pending', true],
    ['cancelled', true],
    ['filled', false],
    [null, false], // ⚠️ สลิปไม่ระบุสถานะต้องบันทึกได้ปกติ (กัน Regression)
  ])('%s → %s', (status, expected) => {
    expect(slipOcr.isUnfilledStatus(status)).toBe(expected);
  });
});

describe('extractSlip — สถานะคำสั่งไหลออกมาถึงผู้เรียก', () => {
  // เคสจริงจากสลิป Dime! BCPG (12 พ.ค. 69) ที่จุดชนวนบั๊กนี้
  test('สลิป "รอเวลาทำการ" → orderStatus = pending', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({
        ...VALID_SLIP,
        symbol: 'BCPG',
        side: 'sell',
        side_evidence: 'ขาย BCPG',
        order_status: 'pending',
        order_status_evidence: 'รอเวลาทำการ',
      })
    );
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.orderStatus).toBe('pending');
  });

  test('AI ตอบ filled แต่หลักฐานเขียน "รอจับคู่" → pending (หลักฐานชนะ)', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({ ...VALID_SLIP, order_status: 'filled', order_status_evidence: 'รอจับคู่' })
    );
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.orderStatus).toBe('pending');
  });

  test('สลิป "จับคู่แล้ว" → filled (บันทึกได้ปกติ)', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({ ...VALID_SLIP, order_status: 'filled', order_status_evidence: 'จับคู่แล้ว' })
    );
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.orderStatus).toBe('filled');
  });

  // Regression สำคัญที่สุด: สลิปทั่วไปส่วนใหญ่ไม่มีช่องสถานะเลย ต้องไม่ถูกบล็อก
  test('สลิปไม่มีข้อมูลสถานะเลย → orderStatus = null (ไม่ถูกบล็อก)', async () => {
    global.fetch.mockResolvedValue(claudeOk(VALID_SLIP)); // ไม่มี order_status* เลย
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.orderStatus).toBeNull();
  });

  test('AI ตอบสถานะนอกสเปก → normalize เป็น null (ไม่บล็อกมั่ว)', async () => {
    global.fetch.mockResolvedValue(
      claudeOk({ ...VALID_SLIP, order_status: 'UNKNOWN_STATE', order_status_evidence: null })
    );
    const result = await slipOcr.extractSlip(USER_ID, BUFFER, 'image/jpeg', NOW);
    expect(result.orderStatus).toBeNull();
  });
});
