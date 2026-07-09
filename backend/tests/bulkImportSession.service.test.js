jest.mock('../src/repositories/bulkImportSession.repository');

const sessionRepository = require('../src/repositories/bulkImportSession.repository');
const {
  BULK_IMPORT_SESSION_TTL_MINUTES,
  PURGE_RETENTION_MINUTES,
  startSession,
  getCurrentSession,
  clearSession,
  purgeStaleSessions,
} = require('../src/services/bulkImportSession.service');

const USER_ID = 'user-uuid-1';

function session(overrides = {}) {
  return {
    userId: USER_ID,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('startSession', () => {
  test('เรียก repository.upsert(userId) และคืน Session', async () => {
    sessionRepository.upsert.mockResolvedValue(session());

    const result = await startSession(USER_ID);

    expect(sessionRepository.upsert).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual(session());
  });
});

describe('getCurrentSession', () => {
  test('ส่ง cutoff (now - TTL) ให้ repository.findValidByUser แล้วคืนผลตรงๆ', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(session());

    const result = await getCurrentSession(USER_ID);

    expect(sessionRepository.findValidByUser).toHaveBeenCalledWith(USER_ID, expect.any(String));
    const [, cutoffIso] = sessionRepository.findValidByUser.mock.calls[0];
    const deltaMs = Date.now() - new Date(cutoffIso).getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(BULK_IMPORT_SESSION_TTL_MINUTES * 60 * 1000 - 1000);
    expect(deltaMs).toBeLessThanOrEqual(BULK_IMPORT_SESSION_TTL_MINUTES * 60 * 1000 + 1000);
    expect(result).toEqual(session());
  });

  test('ไม่มี Session ที่ยังไม่หมดอายุ → คืน null', async () => {
    sessionRepository.findValidByUser.mockResolvedValue(null);
    expect(await getCurrentSession(USER_ID)).toBeNull();
  });
});

describe('clearSession', () => {
  test('เรียก repository.deleteByUser(userId)', async () => {
    sessionRepository.deleteByUser.mockResolvedValue(undefined);
    await clearSession(USER_ID);
    expect(sessionRepository.deleteByUser).toHaveBeenCalledWith(USER_ID);
  });
});

describe('purgeStaleSessions', () => {
  test('ใช้ PURGE_RETENTION_MINUTES เป็น Default คำนวณ cutoff', async () => {
    sessionRepository.purgeStaleBefore.mockResolvedValue(3);

    const count = await purgeStaleSessions();

    expect(count).toBe(3);
    const [cutoffIso] = sessionRepository.purgeStaleBefore.mock.calls[0];
    const deltaMs = Date.now() - new Date(cutoffIso).getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(PURGE_RETENTION_MINUTES * 60 * 1000 - 1000);
  });

  test('รับ retentionMinutes กำหนดเองได้', async () => {
    sessionRepository.purgeStaleBefore.mockResolvedValue(0);
    await purgeStaleSessions(120);
    const [cutoffIso] = sessionRepository.purgeStaleBefore.mock.calls[0];
    const deltaMs = Date.now() - new Date(cutoffIso).getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(120 * 60 * 1000 - 1000);
  });
});
