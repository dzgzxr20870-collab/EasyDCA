// Mock Supabase Client — chain .from('users').select('id').limit(1) จบที่ limit()
// (Pattern เดียวกับ user.repository.test.js)
jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.limit = jest.fn();
  const supabaseAdmin = { from: jest.fn(() => query) };
  return { supabaseAdmin, __query: query };
});

jest.mock('../src/services/line.service');

// ADMIN_LINE_USER_IDS ถูก Mock ผ่าน config/env ทั้งไฟล์ (Pattern เดียวกับ
// webhook.controller.test.js) — คง Field อื่นจาก config จริงไว้ Override เฉพาะ
// payment.adminLineUserIds ให้ Deterministic
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    payment: { ...actual.payment, adminLineUserIds: ['Uadmin1', 'Uadmin2'] },
  };
});

const { supabaseAdmin, __query } = require('../src/config/supabase');
const lineService = require('../src/services/line.service');
const healthAlert = require('../src/services/healthAlert.service');

beforeEach(() => {
  jest.clearAllMocks();
  healthAlert.__resetDebounceStateForTest();
  lineService.pushMessage.mockResolvedValue(undefined);
});

describe('checkDatabaseHealthy', () => {
  test('Query สำเร็จ (ไม่มี error) → true', async () => {
    __query.limit.mockResolvedValue({ data: [{ id: 'u1' }], error: null });

    const healthy = await healthAlert.checkDatabaseHealthy();

    expect(supabaseAdmin.from).toHaveBeenCalledWith('users');
    expect(healthy).toBe(true);
  });

  test('Query คืน error object → false (ไม่ throw)', async () => {
    __query.limit.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const healthy = await healthAlert.checkDatabaseHealthy();

    expect(healthy).toBe(false);
  });

  test('Query throw จริง (Network Error) → false (ไม่ throw ทะลุออกไป)', async () => {
    __query.limit.mockRejectedValue(new Error('ECONNREFUSED'));

    const healthy = await healthAlert.checkDatabaseHealthy();

    expect(healthy).toBe(false);
  });
});

describe('pushAdminAlert', () => {
  test('มี Admin ตั้งไว้ → Push หาทุกคน', async () => {
    await healthAlert.pushAdminAlert('ทดสอบ');

    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin1', { type: 'text', text: 'ทดสอบ' });
    expect(lineService.pushMessage).toHaveBeenCalledWith('Uadmin2', { type: 'text', text: 'ทดสอบ' });
  });

  test('Admin คนหนึ่ง Push ไม่สำเร็จ (บล็อกบอท) → ไม่กระทบคนอื่น ไม่ throw', async () => {
    lineService.pushMessage.mockImplementation((to) =>
      to === 'Uadmin1' ? Promise.reject(new Error('blocked')) : Promise.resolve()
    );

    await expect(healthAlert.pushAdminAlert('ทดสอบ')).resolves.toBeUndefined();
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
  });
});

describe('checkAndAlert — Debounce (Push เฉพาะตอนเปลี่ยนสถานะ)', () => {
  test('ปกติต่อเนื่อง (healthy→healthy) → ไม่ Push เลย', async () => {
    __query.limit.mockResolvedValue({ data: [{ id: 'u1' }], error: null });

    await healthAlert.checkAndAlert();
    await healthAlert.checkAndAlert();

    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });

  test('ปกติ → ล่ม (ครั้งแรก) → Push แจ้งเตือน 1 ครั้ง', async () => {
    __query.limit.mockResolvedValue({ data: null, error: { message: 'down' } });

    const result = await healthAlert.checkAndAlert();

    expect(result).toEqual({ healthy: false });
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2); // 2 Admin
    expect(lineService.pushMessage.mock.calls[0][1].text).toContain('เชื่อมต่อ Database ไม่ได้');
  });

  test('ล่มต่อเนื่อง (ล่ม→ล่ม หลายรอบ) → Push แค่รอบแรก ไม่ Push ซ้ำ', async () => {
    __query.limit.mockResolvedValue({ data: null, error: { message: 'down' } });

    await healthAlert.checkAndAlert(); // รอบแรก: ปกติ→ล่ม → Push
    await healthAlert.checkAndAlert(); // รอบสอง: ล่ม→ล่ม → ไม่ Push ซ้ำ
    await healthAlert.checkAndAlert(); // รอบสาม: ล่ม→ล่ม → ไม่ Push ซ้ำ

    // 2 Admin x 1 รอบเท่านั้น = 2 ครั้งรวม (ไม่ใช่ 6)
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
  });

  test('ล่ม → กลับมาปกติ → Push แจ้งว่ากลับมาแล้ว 1 ครั้ง', async () => {
    __query.limit.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    __query.limit.mockResolvedValueOnce({ data: [{ id: 'u1' }], error: null });

    await healthAlert.checkAndAlert(); // ปกติ→ล่ม → Push (2 admin)
    lineService.pushMessage.mockClear();

    const result = await healthAlert.checkAndAlert(); // ล่ม→ปกติ → Push (2 admin)

    expect(result).toEqual({ healthy: true });
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
    expect(lineService.pushMessage.mock.calls[0][1].text).toContain('กลับมาเชื่อมต่อ Database ได้ปกติแล้ว');
  });
});
