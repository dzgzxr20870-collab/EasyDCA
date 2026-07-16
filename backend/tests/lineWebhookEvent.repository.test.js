// Mock Supabase Client เป็น Query Builder แบบ Chainable (Pattern เดียวกับ
// pendingTransaction.repository.test / transaction.repository.test)
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.upsert = jest.fn(() => query);
  query.delete = jest.fn(() => query);
  query.lt = jest.fn(() => query);
  query.select = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const lineWebhookEventRepository = require('../src/repositories/lineWebhookEvent.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('claimEvent — Atomic Claim ผ่าน upsert + ignoreDuplicates', () => {
  test('Event ใหม่ (ยังไม่เคยเห็น) → INSERT สำเร็จ คืน true', async () => {
    __query.select.mockResolvedValue({ data: [{ event_id: 'evt-1' }], error: null });

    const claimed = await lineWebhookEventRepository.claimEvent('evt-1');

    expect(claimed).toBe(true);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('line_webhook_events');
    expect(__query.upsert).toHaveBeenCalledWith(
      { event_id: 'evt-1' },
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
  });

  test('Event ซ้ำ (เคย Claim ไปแล้ว) → Conflict ทำให้ไม่มีแถวคืนมา → false ไม่ throw', async () => {
    // DO NOTHING ชนกับแถวเดิม → RETURNING ไม่มีแถวให้เลย (Array ว่าง) ไม่ใช่ Error
    __query.select.mockResolvedValue({ data: [], error: null });

    const claimed = await lineWebhookEventRepository.claimEvent('evt-1');

    expect(claimed).toBe(false);
  });

  test('Query ล้มเหลว → throw', async () => {
    __query.select.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(lineWebhookEventRepository.claimEvent('evt-1')).rejects.toThrow(
      /Failed to claim webhook event evt-1/
    );
  });
});

describe('purgeOlderThan', () => {
  test('ลบแถวที่ received_at เก่ากว่า Cutoff → คืนจำนวนที่ลบ', async () => {
    __query.select.mockResolvedValue({
      data: [{ event_id: 'evt-old-1' }, { event_id: 'evt-old-2' }],
      error: null,
    });

    const count = await lineWebhookEventRepository.purgeOlderThan('2026-07-01T00:00:00.000Z');

    expect(count).toBe(2);
    expect(__query.lt).toHaveBeenCalledWith('received_at', '2026-07-01T00:00:00.000Z');
  });

  test('ไม่มีแถวเก่า → คืน 0', async () => {
    __query.select.mockResolvedValue({ data: [], error: null });

    const count = await lineWebhookEventRepository.purgeOlderThan('2026-07-01T00:00:00.000Z');

    expect(count).toBe(0);
  });

  test('Query ล้มเหลว → throw', async () => {
    __query.select.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      lineWebhookEventRepository.purgeOlderThan('2026-07-01T00:00:00.000Z')
    ).rejects.toThrow(/Failed to purge old webhook events/);
  });
});
