jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.upsert = jest.fn(() => query);
  query.delete = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.gte = jest.fn(() => query);
  query.lt = jest.fn(() => query);
  query.single = jest.fn();
  query.maybeSingle = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const bulkImportSessionRepository = require('../src/repositories/bulkImportSession.repository');

const USER_ID = 'user-uuid-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('upsert', () => {
  test('UPSERT บน user_id → คืน Session', async () => {
    __query.single.mockResolvedValue({
      data: { user_id: USER_ID, created_at: '2026-07-10T00:00:00.000Z', updated_at: '2026-07-10T00:00:00.000Z' },
      error: null,
    });

    const result = await bulkImportSessionRepository.upsert(USER_ID);

    expect(supabaseAdmin.from).toHaveBeenCalledWith('bulk_import_sessions');
    expect(__query.upsert).toHaveBeenCalledWith({ user_id: USER_ID }, { onConflict: 'user_id' });
    expect(result).toEqual({
      userId: USER_ID,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    });
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(bulkImportSessionRepository.upsert(USER_ID)).rejects.toThrow('boom');
  });
});

describe('findValidByUser', () => {
  test('มี Session ยังไม่หมดอายุ → คืน Session', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: { user_id: USER_ID, created_at: '2026-07-10T00:00:00.000Z', updated_at: '2026-07-10T00:00:00.000Z' },
      error: null,
    });

    const result = await bulkImportSessionRepository.findValidByUser(USER_ID, '2026-07-10T00:00:00.000Z');

    expect(__query.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(__query.gte).toHaveBeenCalledWith('updated_at', '2026-07-10T00:00:00.000Z');
    expect(result.userId).toBe(USER_ID);
  });

  test('ไม่มี/หมดอายุ → null', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await bulkImportSessionRepository.findValidByUser(USER_ID, 'cutoff')).toBeNull();
  });

  test('DB error → throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(bulkImportSessionRepository.findValidByUser(USER_ID, 'cutoff')).rejects.toThrow('boom');
  });
});

describe('deleteByUser', () => {
  test('ลบ Session ตาม user_id', async () => {
    __query.eq.mockResolvedValueOnce({ error: null });
    await bulkImportSessionRepository.deleteByUser(USER_ID);
    expect(__query.delete).toHaveBeenCalled();
    expect(__query.eq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  test('DB error → throw', async () => {
    __query.eq.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(bulkImportSessionRepository.deleteByUser(USER_ID)).rejects.toThrow('boom');
  });
});

describe('purgeStaleBefore', () => {
  test('ลบ Session ที่ updated_at เก่ากว่า cutoff → คืนจำนวนที่ลบ', async () => {
    __query.select.mockResolvedValueOnce({
      data: [{ user_id: 'u1' }, { user_id: 'u2' }],
      error: null,
    });

    const count = await bulkImportSessionRepository.purgeStaleBefore('2026-07-01T00:00:00.000Z');

    expect(__query.delete).toHaveBeenCalled();
    expect(__query.lt).toHaveBeenCalledWith('updated_at', '2026-07-01T00:00:00.000Z');
    expect(count).toBe(2);
  });

  test('ไม่มีแถวถูกลบ → 0', async () => {
    __query.select.mockResolvedValueOnce({ data: [], error: null });
    expect(await bulkImportSessionRepository.purgeStaleBefore('cutoff')).toBe(0);
  });

  test('DB error → throw', async () => {
    __query.select.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(bulkImportSessionRepository.purgeStaleBefore('cutoff')).rejects.toThrow('boom');
  });
});
