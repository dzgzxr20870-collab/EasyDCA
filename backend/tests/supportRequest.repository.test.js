// Mock Supabase Client เป็น Query Builder แบบ Chainable — insert/select คืน query เดิม
// ส่วน single/maybeSingle เป็น Terminal ที่ Resolve เป็น { data, error } เหมือน
// PostgREST จริง (Pattern เดียวกับ broadcastLog.repository.test.js)
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.insert = jest.fn(() => query);
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.gte = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.single = jest.fn();
  query.maybeSingle = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const supportRequestRepository = require('../src/repositories/supportRequest.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('supportRequest.repository.create', () => {
  test('Insert แบบ snake_case แล้ว map กลับเป็น camelCase (toSupportRequest)', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'sr-1',
        user_id: 'user-1',
        message: 'จ่ายเงินแล้วไม่ได้ Premium',
        admin_count: 2,
        notified_count: 1,
        created_at: '2026-07-26T00:00:00.000Z',
      },
      error: null,
    });

    const result = await supportRequestRepository.create({
      userId: 'user-1',
      message: 'จ่ายเงินแล้วไม่ได้ Premium',
      adminCount: 2,
      notifiedCount: 1,
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith('support_requests');
    expect(__query.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      message: 'จ่ายเงินแล้วไม่ได้ Premium',
      admin_count: 2,
      notified_count: 1,
    });
    expect(result).toMatchObject({
      id: 'sr-1',
      userId: 'user-1',
      message: 'จ่ายเงินแล้วไม่ได้ Premium',
      adminCount: 2,
      notifiedCount: 1,
    });
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(
      supportRequestRepository.create({
        userId: 'user-1',
        message: 'x',
        adminCount: 0,
        notifiedCount: 0,
      })
    ).rejects.toThrow('db down');
  });

  // ── Migration 026 — category/source (Pivot ไปหน้าเว็บ /support) ──────────────
  test('ส่ง category/source มาด้วย → Insert เข้าไปด้วย', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'sr-2',
        user_id: 'user-1',
        message: 'x',
        admin_count: 2,
        notified_count: 2,
        category: 'ocr',
        source: 'web',
        created_at: '2026-07-26T00:00:00.000Z',
      },
      error: null,
    });

    const result = await supportRequestRepository.create({
      userId: 'user-1',
      message: 'x',
      adminCount: 2,
      notifiedCount: 2,
      category: 'ocr',
      source: 'web',
    });

    expect(__query.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      message: 'x',
      admin_count: 2,
      notified_count: 2,
      category: 'ocr',
      source: 'web',
    });
    expect(result).toMatchObject({ category: 'ocr', source: 'web' });
  });

  // ⚠️ ไม่ส่ง category/source เลย (เช่น Flow เก่าก่อน Migration 026 ถ้ายังมี Caller
  // เดิมหลงเหลือ) → "ไม่ใส่ Key เข้า insert()" ให้ DB Default ('line') ทำงานแทน ไม่ใช่
  // ส่ง undefined ทับ Default โดยไม่ตั้งใจ (บั๊กเงียบที่เจอได้ถ้าใช้ ?? 'line' ฝั่ง JS
  // แทนที่จะปล่อยให้ DB จัดการ)
  test('ไม่ส่ง category/source มา → insert() ไม่มี Key เหล่านี้เลย (ให้ DB Default ทำงาน)', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'sr-3',
        user_id: 'user-1',
        message: 'x',
        admin_count: 1,
        notified_count: 1,
        category: null,
        source: 'line',
        created_at: '2026-07-26T00:00:00.000Z',
      },
      error: null,
    });

    await supportRequestRepository.create({
      userId: 'user-1',
      message: 'x',
      adminCount: 1,
      notifiedCount: 1,
    });

    const insertPayload = __query.insert.mock.calls[0][0];
    expect(insertPayload).not.toHaveProperty('category');
    expect(insertPayload).not.toHaveProperty('source');
  });

  test('toSupportRequest map category=null (แถวเก่าก่อน Migration 026) → คืน null ไม่ใช่ undefined', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'sr-4',
        user_id: 'user-1',
        message: 'x',
        admin_count: 0,
        notified_count: 0,
        category: null,
        source: 'line',
        created_at: '2026-07-26T00:00:00.000Z',
      },
      error: null,
    });

    const result = await supportRequestRepository.create({
      userId: 'user-1',
      message: 'x',
      adminCount: 0,
      notifiedCount: 0,
    });

    expect(result.category).toBeNull();
    expect(result.source).toBe('line');
  });
});

describe('supportRequest.repository.findRecentByUser', () => {
  test('มีแถวภายใน cutoff → คืน Object ที่ Map แล้ว', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: {
        id: 'sr-1',
        user_id: 'user-1',
        message: 'x',
        admin_count: 1,
        notified_count: 1,
        created_at: '2026-07-26T00:00:00.000Z',
      },
      error: null,
    });

    const result = await supportRequestRepository.findRecentByUser('user-1', '2026-07-25T00:00:00.000Z');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('support_requests');
    expect(__query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(__query.gte).toHaveBeenCalledWith('created_at', '2026-07-25T00:00:00.000Z');
    expect(result).toMatchObject({ id: 'sr-1', userId: 'user-1' });
  });

  test('ไม่มีแถวภายใน cutoff → คืน null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await supportRequestRepository.findRecentByUser('user-1', '2026-07-25T00:00:00.000Z');

    expect(result).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await expect(
      supportRequestRepository.findRecentByUser('user-1', '2026-07-25T00:00:00.000Z')
    ).rejects.toThrow('db down');
  });
});
