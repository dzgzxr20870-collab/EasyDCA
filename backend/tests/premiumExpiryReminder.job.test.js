// ═══════════════════════════════════════════════════════════════════════════
// premiumExpiryReminder.job — Push เตือนก่อน Premium หมดอายุ (AI_WORK_POLICY § 4.4)
// ═══════════════════════════════════════════════════════════════════════════
// เน้น 3 เรื่องที่ Cron พลาดแล้วเจ็บ: กันส่งซ้ำ, Error Isolation รายคน,
// และ "ใช้กับ Premium ทุกคนเท่ากัน" ไม่ว่าจะได้มาจากจ่ายเงินจริงหรือ Free Trial

jest.mock('../src/repositories/user.repository');
jest.mock('../src/services/line.service');
jest.mock('../src/utils/logger.util');
jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return { ...actual, app: { ...actual.app, frontendUrl: 'https://app.easydca.test' } };
});

const userRepository = require('../src/repositories/user.repository');
const lineService = require('../src/services/line.service');
const {
  runPremiumExpiryReminder,
  REMINDER_DAYS_BEFORE,
} = require('../src/jobs/premiumExpiryReminder.job');

const NOW = new Date('2026-08-01T00:00:00.000Z');

function premiumUser(overrides = {}) {
  return {
    id: 'user-1',
    lineUserId: 'U-line-1',
    plan: 'premium',
    // เหลือ 2 วัน (อยู่ในช่วงเตือน 3 วัน)
    planExpiresAt: '2026-08-03T00:00:00.000Z',
    expiryReminderSentAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  userRepository.findPremiumExpiringBefore.mockResolvedValue([]);
  userRepository.markExpiryReminderSent.mockResolvedValue(undefined);
  lineService.pushMessage.mockResolvedValue(undefined);
});

describe('runPremiumExpiryReminder — Query ช่วงเวลา', () => {
  test('ถามหาคนที่หมดอายุภายใน 3 วันข้างหน้า (cutoff = now + REMINDER_DAYS_BEFORE)', async () => {
    await runPremiumExpiryReminder(NOW);

    expect(REMINDER_DAYS_BEFORE).toBe(3);
    const [cutoff, now] = userRepository.findPremiumExpiringBefore.mock.calls[0];
    expect(cutoff.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    expect(now).toBe(NOW);
  });

  test('ไม่มีใครถึงกำหนดเตือน → ไม่ Push เลย ไม่ปั๊มอะไร', async () => {
    const sent = await runPremiumExpiryReminder(NOW);

    expect(sent).toBe(0);
    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(userRepository.markExpiryReminderSent).not.toHaveBeenCalled();
  });

  test('ดึงรายชื่อไม่ได้ (DB ล่ม) → คืน 0 ไม่ throw (Worker ต้องไม่ล่มทั้ง Process)', async () => {
    userRepository.findPremiumExpiringBefore.mockRejectedValue(new Error('DB down'));

    await expect(runPremiumExpiryReminder(NOW)).resolves.toBe(0);
    expect(lineService.pushMessage).not.toHaveBeenCalled();
  });
});

describe('runPremiumExpiryReminder — ส่งเตือน', () => {
  test('ส่ง Push + ปั๊ม expiry_reminder_sent_at (กันส่งซ้ำรอบถัดไป)', async () => {
    userRepository.findPremiumExpiringBefore.mockResolvedValue([premiumUser()]);

    const sent = await runPremiumExpiryReminder(NOW);

    expect(sent).toBe(1);
    expect(lineService.pushMessage).toHaveBeenCalledWith('U-line-1', expect.any(Object));
    expect(userRepository.markExpiryReminderSent).toHaveBeenCalledWith('user-1', NOW);
  });

  test('ข้อความมีจำนวนวันที่เหลือ + ปุ่มไปหน้า /premium ผ่าน Browser ภายนอก', async () => {
    userRepository.findPremiumExpiringBefore.mockResolvedValue([premiumUser()]);

    await runPremiumExpiryReminder(NOW);

    const [, message] = lineService.pushMessage.mock.calls[0];
    const json = JSON.stringify(message);
    expect(json).toContain('อีก 2 วัน');
    expect(json).toContain('https://app.easydca.test/premium?openExternalBrowser=1');
  });

  test('เหลือไม่ถึง 1 วัน → แสดง "อีก 1 วัน" (ไม่ใช่ 0 วันที่อ่านแล้วงง)', async () => {
    userRepository.findPremiumExpiringBefore.mockResolvedValue([
      premiumUser({ planExpiresAt: '2026-08-01T06:00:00.000Z' }), // เหลือ 6 ชั่วโมง
    ]);

    await runPremiumExpiryReminder(NOW);

    expect(JSON.stringify(lineService.pushMessage.mock.calls[0][1])).toContain('อีก 1 วัน');
  });

  test('ปั๊ม sent_at "หลัง" Push สำเร็จเท่านั้น — Push พังต้องไม่ปั๊ม (พรุ่งนี้ลองใหม่ได้)', async () => {
    userRepository.findPremiumExpiringBefore.mockResolvedValue([premiumUser()]);
    lineService.pushMessage.mockRejectedValue(new Error('LINE API down'));

    const sent = await runPremiumExpiryReminder(NOW);

    expect(sent).toBe(0);
    expect(userRepository.markExpiryReminderSent).not.toHaveBeenCalled();
  });

  test('ผู้ใช้ไม่มี lineUserId (ถูก Anonymize ตาม PDPA) → ข้ามเงียบๆ ไม่ Push ไม่นับพัง', async () => {
    userRepository.findPremiumExpiringBefore.mockResolvedValue([
      premiumUser({ id: 'user-anon', lineUserId: null }),
    ]);

    const sent = await runPremiumExpiryReminder(NOW);

    expect(sent).toBe(0);
    expect(lineService.pushMessage).not.toHaveBeenCalled();
    expect(userRepository.markExpiryReminderSent).not.toHaveBeenCalled();
  });
});

describe('runPremiumExpiryReminder — Error Isolation (§ 4.4)', () => {
  test('1 คนพัง ไม่กระทบคนอื่นในรอบเดียวกัน', async () => {
    userRepository.findPremiumExpiringBefore.mockResolvedValue([
      premiumUser({ id: 'user-1', lineUserId: 'U-1' }),
      premiumUser({ id: 'user-2', lineUserId: 'U-2' }),
      premiumUser({ id: 'user-3', lineUserId: 'U-3' }),
    ]);
    lineService.pushMessage.mockImplementation(async (lineUserId) => {
      if (lineUserId === 'U-2') throw new Error('blocked by user');
    });

    const sent = await runPremiumExpiryReminder(NOW);

    expect(sent).toBe(2);
    expect(lineService.pushMessage).toHaveBeenCalledTimes(3);
    // คนที่พังต้องไม่ถูกปั๊ม (จะได้ลองใหม่พรุ่งนี้) คนที่สำเร็จต้องถูกปั๊ม
    const stamped = userRepository.markExpiryReminderSent.mock.calls.map((c) => c[0]);
    expect(stamped).toEqual(['user-1', 'user-3']);
  });

  test('ปั๊ม sent_at พัง → ไม่ทำให้คนถัดไปหยุด (ยอมเสี่ยงเตือนซ้ำ 1 ใบดีกว่าหยุดทั้ง Batch)', async () => {
    userRepository.findPremiumExpiringBefore.mockResolvedValue([
      premiumUser({ id: 'user-1', lineUserId: 'U-1' }),
      premiumUser({ id: 'user-2', lineUserId: 'U-2' }),
    ]);
    userRepository.markExpiryReminderSent.mockImplementation(async (id) => {
      if (id === 'user-1') throw new Error('DB write failed');
    });

    const sent = await runPremiumExpiryReminder(NOW);

    expect(sent).toBe(1);
    expect(lineService.pushMessage).toHaveBeenCalledTimes(2);
  });
});

describe('Regression — ใช้กับ Premium ทุกคนเท่ากัน ไม่แยก Path', () => {
  test('คนที่ได้ Premium จาก Free Trial ถูกเตือนเหมือนคนจ่ายเงินจริงทุกประการ', async () => {
    // Job กรองจาก users.plan + plan_expires_at เท่านั้น ไม่เคยดูว่าได้ Premium มาจากไหน
    // — freeTrialClaimedAt มีค่า (มาจาก Free Trial) ต้องไม่ทำให้ถูกข้าม
    userRepository.findPremiumExpiringBefore.mockResolvedValue([
      premiumUser({ id: 'user-freetrial', freeTrialClaimedAt: '2026-07-03T00:00:00.000Z' }),
    ]);

    const sent = await runPremiumExpiryReminder(NOW);

    expect(sent).toBe(1);
    expect(userRepository.markExpiryReminderSent).toHaveBeenCalledWith('user-freetrial', NOW);
  });
});
