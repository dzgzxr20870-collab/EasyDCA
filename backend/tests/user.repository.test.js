// Mock Supabase Client เป็น Query Builder แบบ Chainable — select/eq คืน query เดิม
// ส่วน lt เป็น Terminal ที่ Resolve เป็น { data, error } (findExpiredPremiumUsers
// จบ Chain ที่ .lt('plan_expires_at', now))
// migration 029 เพิ่ม 3 Method ใน Chain: .is() (Atomic Claim + กรองยังไม่เคยเตือน),
// .gt()/.lte() (ช่วงเวลาของ Cron เตือนก่อนหมดอายุ) และ .maybeSingle() (Atomic Claim
// ต้องรับ "0 แถว" ได้โดยไม่ throw ต่างจาก .single())
//
// ⚠️ .eq/.is เป็นได้ทั้ง "ตัวกลาง Chain" และ "Terminal" แล้วแต่ Query — mockReturnValue
// ให้คืน query เป็น Default (Chain ต่อได้) แล้วให้แต่ละ Test Override ด้วย
// mockResolvedValue/mockResolvedValueOnce เมื่อต้องการให้ตัวนั้นเป็น Terminal
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.lt = jest.fn();
  query.gt = jest.fn(() => query);
  query.lte = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.update = jest.fn(() => query);
  query.single = jest.fn();
  query.maybeSingle = jest.fn();
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

// ═══════════════════════════════════════════════════════════════════════════
// Atomic Claim + Reminder Query (migration 029) — แตะสิทธิ์/รายได้โดยตรง
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ทำไมต้องมีเทสต์ชั้นนี้ทั้งที่มี freeTrial.service.test.js อยู่แล้ว:
// เทสต์ Service ทั้งหมด Mock userRepository ทิ้ง → บรรทัด .is('free_trial_claimed_at',
// null) ซึ่งเป็น "หัวใจเดียว" ที่กันกดรับซ้ำ ไม่มีใครคุ้มกันเลย พิสูจน์แล้วด้วย
// Red-Green: ถอดบรรทัดนั้นออก เทสต์ทั้ง 39 เคสยังเขียวหมด (= สิทธิ์รั่วโดยไม่มีใครรู้)
// เทสต์ชุดนี้จึงตรวจ "Query ที่ยิงจริง" ไม่ใช่แค่ผลลัพธ์ที่ Mock คืนมา

describe('claimFreeTrial — Atomic Claim (กดรับ Premium ฟรีครั้งเดียวตลอดชีพ)', () => {
  const USER_ID = 'u-free-1';
  const EXPIRES = new Date('2026-09-01T00:00:00.000Z');
  const NOW = new Date('2026-08-01T00:00:00.000Z');

  test('🔒 ต้องมี .is(free_trial_claimed_at, null) ใน UPDATE เสมอ (Guard กันกดซ้ำ)', async () => {
    __query.maybeSingle.mockResolvedValue({ data: { id: USER_ID, plan: 'premium' }, error: null });

    await userRepository.claimFreeTrial(USER_ID, EXPIRES, NOW);

    // ถ้าบรรทัดนี้หลุดหายไป = ผู้ใช้กดรับซ้ำได้ไม่จำกัด (เสียรายได้) — เทสต์นี้คือ
    // ตัวเดียวที่จับได้ ห้ามลบ
    expect(__query.is).toHaveBeenCalledWith('free_trial_claimed_at', null);
    expect(__query.eq).toHaveBeenCalledWith('id', USER_ID);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
  });

  test('เขียน plan/plan_expires_at/free_trial_claimed_at ใน UPDATE เดียวกัน (Atomic)', async () => {
    __query.maybeSingle.mockResolvedValue({ data: { id: USER_ID, plan: 'premium' }, error: null });

    await userRepository.claimFreeTrial(USER_ID, EXPIRES, NOW);

    // แยกเป็น 2 Statement เมื่อไหร่ = มีช่องให้ 2 Request ผ่าน Guard พร้อมกัน
    expect(__query.update).toHaveBeenCalledTimes(1);
    expect(__query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'premium',
        plan_expires_at: EXPIRES.toISOString(),
        free_trial_claimed_at: NOW.toISOString(),
      })
    );
  });

  test('Claim สำเร็จ → คืน user object ที่ map แล้ว', async () => {
    __query.maybeSingle.mockResolvedValue({
      data: { id: USER_ID, line_user_id: 'U1', plan: 'premium', free_trial_claimed_at: NOW.toISOString() },
      error: null,
    });

    const result = await userRepository.claimFreeTrial(USER_ID, EXPIRES, NOW);

    expect(result).toMatchObject({ id: USER_ID, plan: 'premium' });
    expect(result.freeTrialClaimedAt).toBe(NOW.toISOString());
  });

  test('🔒 0 แถว Match (เคยกดรับแล้ว/แพ้ Race) → คืน null ไม่ใช่ throw', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(userRepository.claimFreeTrial(USER_ID, EXPIRES, NOW)).resolves.toBeNull();
  });

  test('DB error → throw (Caller ต้องรู้ว่าเขียนไม่สำเร็จ ไม่ใช่เข้าใจผิดว่ากดซ้ำ)', async () => {
    __query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection lost' } });

    await expect(userRepository.claimFreeTrial(USER_ID, EXPIRES, NOW)).rejects.toThrow(/connection lost/);
  });

  test('รับ expiresAt เป็น String ได้ด้วย (ไม่บังคับต้องเป็น Date)', async () => {
    __query.maybeSingle.mockResolvedValue({ data: { id: USER_ID }, error: null });

    await userRepository.claimFreeTrial(USER_ID, '2026-09-01T00:00:00.000Z', NOW);

    expect(__query.update).toHaveBeenCalledWith(
      expect.objectContaining({ plan_expires_at: '2026-09-01T00:00:00.000Z' })
    );
  });
});

describe('toUser mapping — free_trial_claimed_at (migration 029)', () => {
  test('DB ไม่มีค่า → map เป็น null', async () => {
    __query.order.mockResolvedValueOnce({
      data: [{ id: 'u1', line_user_id: 'U1', plan: 'free', created_at: '2026-08-01' }],
      error: null,
    });

    const result = await userRepository.findAll();

    expect(result[0].freeTrialClaimedAt).toBeNull();
  });

  test('DB มีค่าจริง → map ผ่านตรงๆ (Guard ใน freeTrial.service อ่านค่านี้)', async () => {
    __query.order.mockResolvedValueOnce({
      data: [{
        id: 'u1', line_user_id: 'U1', plan: 'premium', created_at: '2026-08-01',
        free_trial_claimed_at: '2026-08-01T00:00:00.000Z',
      }],
      error: null,
    });

    const result = await userRepository.findAll();

    expect(result[0].freeTrialClaimedAt).toBe('2026-08-01T00:00:00.000Z');
  });
});
