// Mock Supabase Client เป็น Query Builder แบบ Chainable — select/eq คืน query เดิม
// ส่วน lt เป็น Terminal ที่ Resolve เป็น { data, error } (findExpiredPremiumUsers
// จบ Chain ที่ .lt('plan_expires_at', now))
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.lt = jest.fn();
  query.order = jest.fn(() => query);
  query.update = jest.fn(() => query);
  query.single = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const userRepository = require('../src/repositories/user.repository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findExpiredPremiumUsers', () => {
  test('กรอง plan=premium AND plan_expires_at < now แล้ว map เป็น user objects', async () => {
    const now = new Date('2026-07-04T00:00:00.000Z');
    __query.lt.mockResolvedValue({
      data: [
        {
          id: 'u1',
          line_user_id: 'U1',
          display_name: 'A',
          plan: 'premium',
          plan_expires_at: '2026-07-01T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const result = await userRepository.findExpiredPremiumUsers(now);

    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(__query.eq).toHaveBeenCalledWith('plan', 'premium');
    expect(__query.lt).toHaveBeenCalledWith('plan_expires_at', now.toISOString());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'u1', lineUserId: 'U1', plan: 'premium' });
  });

  test('ไม่มีใครหมดอายุ → คืน []', async () => {
    __query.lt.mockResolvedValue({ data: [], error: null });
    expect(await userRepository.findExpiredPremiumUsers(new Date())).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.lt.mockResolvedValue({ data: null, error: { message: 'db blip' } });
    await expect(userRepository.findExpiredPremiumUsers(new Date())).rejects.toThrow('db blip');
  });
});

describe('findAll', () => {
  test('คืน User ทั้งหมด (order created_at DESC) แล้ว map เป็น user objects', async () => {
    __query.order.mockResolvedValueOnce({
      data: [
        { id: 'u2', line_user_id: 'U2', display_name: 'B', plan: 'premium', created_at: '2026-07-02' },
        { id: 'u1', line_user_id: 'U1', display_name: 'A', plan: 'free', created_at: '2026-07-01' },
      ],
      error: null,
    });

    const result = await userRepository.findAll();

    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(__query.select).toHaveBeenCalledWith('*');
    expect(__query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'u2', lineUserId: 'U2', plan: 'premium' });
    expect(result[1]).toMatchObject({ id: 'u1', displayName: 'A', plan: 'free' });
  });

  test('ไม่มี User เลย (data = []) → คืน []', async () => {
    __query.order.mockResolvedValueOnce({ data: [], error: null });
    expect(await userRepository.findAll()).toEqual([]);
  });

  test('DB error → throw', async () => {
    __query.order.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    await expect(userRepository.findAll()).rejects.toThrow('db down');
  });
});

describe('updateDisplayName', () => {
  test('อัปเดต display_name/picture_url ด้วย id ที่ระบุ แล้ว map เป็น user object (Pattern เดียวกับ updatePlan)', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'u1',
        line_user_id: 'U1',
        display_name: 'สมชาย ใจดี',
        picture_url: 'https://profile.line-scdn.net/abc123',
        plan: 'free',
      },
      error: null,
    });

    const result = await userRepository.updateDisplayName(
      'u1',
      'สมชาย ใจดี',
      'https://profile.line-scdn.net/abc123'
    );

    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(__query.update).toHaveBeenCalledWith({
      display_name: 'สมชาย ใจดี',
      picture_url: 'https://profile.line-scdn.net/abc123',
    });
    expect(__query.eq).toHaveBeenCalledWith('id', 'u1');
    expect(result).toMatchObject({
      id: 'u1',
      lineUserId: 'U1',
      displayName: 'สมชาย ใจดี',
      pictureUrl: 'https://profile.line-scdn.net/abc123',
    });
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'db blip' } });
    await expect(userRepository.updateDisplayName('u1', 'x', null)).rejects.toThrow('db blip');
  });
});

// PDPA Compliance (migration 017) — Express Opt-in Consent
describe('setPdpaConsent', () => {
  test('อัปเดต pdpa_consented_at = now() ด้วย id ที่ระบุ แล้ว map เป็น user object', async () => {
    __query.single.mockResolvedValue({
      data: { id: 'u1', line_user_id: 'U1', pdpa_consented_at: '2026-07-17T00:00:00.000Z' },
      error: null,
    });

    const result = await userRepository.setPdpaConsent('u1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(__query.update).toHaveBeenCalledWith({ pdpa_consented_at: expect.any(String) });
    expect(__query.eq).toHaveBeenCalledWith('id', 'u1');
    expect(result).toMatchObject({ id: 'u1', pdpaConsentedAt: '2026-07-17T00:00:00.000Z' });
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'db blip' } });
    await expect(userRepository.setPdpaConsent('u1')).rejects.toThrow('db blip');
  });
});

// PDPA Self-Service Erasure (migration 018)
describe('anonymize', () => {
  test('ล้าง line_user_id/display_name/picture_url + ตั้ง anonymized_at แล้ว map เป็น user object', async () => {
    __query.single.mockResolvedValue({
      data: {
        id: 'u1',
        line_user_id: 'anonymized-u1',
        display_name: 'ผู้ใช้ที่ถูกลบข้อมูล',
        picture_url: null,
        anonymized_at: '2026-07-17T00:00:00.000Z',
      },
      error: null,
    });

    const result = await userRepository.anonymize('u1');

    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(__query.update).toHaveBeenCalledWith({
      line_user_id: 'anonymized-u1',
      display_name: 'ผู้ใช้ที่ถูกลบข้อมูล',
      picture_url: null,
      anonymized_at: expect.any(String),
    });
    expect(__query.eq).toHaveBeenCalledWith('id', 'u1');
    expect(result).toMatchObject({
      id: 'u1',
      lineUserId: 'anonymized-u1',
      displayName: 'ผู้ใช้ที่ถูกลบข้อมูล',
      pictureUrl: null,
      anonymizedAt: '2026-07-17T00:00:00.000Z',
    });
  });

  test('DB error → throw', async () => {
    __query.single.mockResolvedValue({ data: null, error: { message: 'db blip' } });
    await expect(userRepository.anonymize('u1')).rejects.toThrow('db blip');
  });
});

// toUser mapping — Field ใหม่จาก PDPA Compliance ต้อง Default เป็น null ถ้า DB ไม่มีค่า
describe('toUser mapping (ผ่าน findAll) — pdpaConsentedAt/anonymizedAt', () => {
  test('DB ไม่มีค่า (undefined) → map เป็น null (ไม่ใช่ undefined)', async () => {
    __query.order.mockResolvedValueOnce({
      data: [{ id: 'u1', line_user_id: 'U1', display_name: 'A', plan: 'free', created_at: '2026-07-01' }],
      error: null,
    });

    const result = await userRepository.findAll();

    expect(result[0].pdpaConsentedAt).toBeNull();
    expect(result[0].anonymizedAt).toBeNull();
  });

  test('DB มีค่าจริง → map ผ่านตรงๆ', async () => {
    __query.order.mockResolvedValueOnce({
      data: [{
        id: 'u1', line_user_id: 'U1', display_name: 'A', plan: 'free', created_at: '2026-07-01',
        pdpa_consented_at: '2026-07-01T00:00:00.000Z',
        anonymized_at: '2026-07-10T00:00:00.000Z',
      }],
      error: null,
    });

    const result = await userRepository.findAll();

    expect(result[0].pdpaConsentedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(result[0].anonymizedAt).toBe('2026-07-10T00:00:00.000Z');
  });
});
