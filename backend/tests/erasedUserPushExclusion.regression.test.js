// Regression (ผลตรวจระบบ 21 ต.ค. 2569 ข้อ 2) — ผู้ใช้ที่ขอลบข้อมูล (PDPA Erasure) ต้อง
// ไม่ถูกส่งข้อความหาอีก ไม่ว่าจาก Job ไหน
//
// ต้นเหตุ: userRepository.anonymize() ตั้ง line_user_id = `anonymized-<id>` (ไม่ใช่ null
// เพราะคอลัมน์เป็น NOT NULL + UNIQUE) แต่ทุก Job เช็คแค่ `!lineUserId` โดยเข้าใจว่าบัญชี
// ที่ถูกลบจะไม่มี lineUserId — ค่าสังเคราะห์จึงหลุดผ่านไปถึง LINE Push API ทุกวัน
// (Production Log: `LINE Push API failed: 400 'to' invalid` จาก cron:dca-reminder)
//
// ⚠️ Seam Test ตาม AI_WORK_POLICY § 3.1 ข้อ 4/5 — รัน "Job จริง + Service จริง +
// Repository จริง" Mock เฉพาะขอบนอกสุด 2 จุด: Supabase Query Builder กับ LINE Push
// Fixture ของ Supabase คืนแถว "ปน" ทั้งคนปกติและคนที่ถูกลบเสมอ (ไม่สนใจ Filter ใน Query
// เหมือนที่ DB จริงจะไม่กรอง anonymized_at ให้เองถ้าโค้ดไม่ขอ) — ถ้าตัวกรองหายไปจาก
// Repository/Service เมื่อไหร่ Test นี้ต้องแดงทันที
jest.mock('../src/config/supabase', () => {
  const fixtures = {};
  const calls = [];

  function builder(table) {
    const state = { table, op: 'select', args: [] };
    const q = {};
    for (const m of ['select', 'eq', 'neq', 'gt', 'lt', 'lte', 'is', 'or', 'order', 'in']) {
      q[m] = jest.fn((...args) => {
        state.args.push([m, ...args]);
        return q;
      });
    }
    q.update = jest.fn((patch) => {
      state.op = 'update';
      state.patch = patch;
      return q;
    });
    const resolve = () => {
      calls.push(state);
      if (state.op === 'update') return { data: null, error: null };
      return { data: fixtures[table] ?? [], error: null };
    };
    q.then = (onFulfilled, onRejected) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
    q.single = jest.fn(async () => resolve());
    q.maybeSingle = jest.fn(async () => resolve());
    return q;
  }

  const supabaseAdmin = { from: jest.fn((table) => builder(table)) };
  return { supabaseAdmin, __fixtures: fixtures, __calls: calls };
});

jest.mock('../src/services/line.service', () => ({
  pushMessage: jest.fn(async () => ({})),
}));

// สรุปพอร์ตรายสัปดาห์คำนวณจากราคาตลาด (ยิง API ภายนอก) — ไม่ใช่ประเด็นของ Test นี้
// Mock เฉพาะ "เนื้อหา" สรุป ส่วนการเลือกผู้รับยังเป็น Job + Repository จริงทั้งหมด
jest.mock('../src/services/portfolioSummary.service', () => ({
  buildSummaryForUser: jest.fn(async (userId) => ({ userId, holdings: [] })),
}));
jest.mock('../src/utils/flexMessage.util', () => {
  const actual = jest.requireActual('../src/utils/flexMessage.util');
  return {
    ...actual,
    buildPortfolioSummaryPushMessage: jest.fn(() => ({ type: 'text', text: 'summary' })),
  };
});

const { __fixtures, __calls } = require('../src/config/supabase');
const lineService = require('../src/services/line.service');
const { runReminderPush } = require('../src/jobs/dcaReminder.job');
const { runWeeklySummaryPush } = require('../src/jobs/portfolioSummary.job');
const { runPremiumExpiryReminder } = require('../src/jobs/premiumExpiryReminder.job');
const { runPlanDowngrade } = require('../src/jobs/planDowngrade.job');
const broadcastService = require('../src/services/broadcast.service');
const { todayInBangkok } = require('../src/services/transaction.service');
const { dayOfWeekOf } = require('../src/utils/thaiDate.util');

const LIVE_LINE_ID = 'U_live_user';
const ERASED_USER_ID = 'u-erased';
const ERASED_LINE_ID = `anonymized-${ERASED_USER_ID}`; // ค่าที่ anonymize() เขียนจริง
const ERASED_AT = '2026-10-01T00:00:00.000Z';

const NOW = new Date();
const EXPIRES_SOON = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

function userRow(id, lineUserId, anonymizedAt) {
  return {
    id,
    line_user_id: lineUserId,
    plan: 'premium',
    plan_expires_at: EXPIRES_SOON,
    anonymized_at: anonymizedAt,
    expiry_reminder_sent_at: null,
  };
}

function reminderRow(id, userId, users) {
  return {
    id,
    user_id: userId,
    symbol: 'BTC',
    frequency: 'weekly',
    day_of_week: dayOfWeekOf(todayInBangkok()), // ครบกำหนดวันนี้เสมอ
    day_of_month: null,
    amount_thb: 1000,
    currency: 'THB',
    active: true,
    last_notified_date: null,
    users,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  __calls.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  __fixtures.users = [
    userRow('u-live', LIVE_LINE_ID, null),
    userRow(ERASED_USER_ID, ERASED_LINE_ID, ERASED_AT),
  ];
  __fixtures.dca_reminders = [
    reminderRow('r-live', 'u-live', { line_user_id: LIVE_LINE_ID, anonymized_at: null }),
    reminderRow('r-erased', ERASED_USER_ID, {
      line_user_id: ERASED_LINE_ID,
      anonymized_at: ERASED_AT,
    }),
  ];
  __fixtures.assets = [
    { user_id: 'u-live', users: { line_user_id: LIVE_LINE_ID, anonymized_at: null } },
    { user_id: ERASED_USER_ID, users: { line_user_id: ERASED_LINE_ID, anonymized_at: ERASED_AT } },
  ];
  __fixtures.broadcast_logs = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pushedTo() {
  return lineService.pushMessage.mock.calls.map(([to]) => to);
}

describe('ผู้ใช้ที่ถูกลบข้อมูล (anonymized) ต้องไม่ถูก Push จาก Job ใดๆ', () => {
  test('เตือน DCA (cron:dca-reminder)', async () => {
    await runReminderPush();

    expect(pushedTo()).toEqual([LIVE_LINE_ID]);
  });

  test('สรุปพอร์ตรายสัปดาห์/เดือน (cron:portfolio-summary)', async () => {
    await runWeeklySummaryPush();

    expect(pushedTo()).toEqual([LIVE_LINE_ID]);
  });

  test('เตือน Premium ใกล้หมดอายุ (cron:premium-expiry-reminder)', async () => {
    await runPremiumExpiryReminder(NOW);

    expect(pushedTo()).toEqual([LIVE_LINE_ID]);
  });

  test('Broadcast จาก Admin (กลุ่ม all) — ไม่นับคนที่ถูกลบเป็นผู้รับด้วย', async () => {
    const result = await broadcastService.sendBroadcast(
      { targetGroup: 'all', messageType: 'news', message: 'hello', sentBy: 'U_admin' },
      { delayMs: 0 }
    );

    expect(pushedTo()).toEqual([LIVE_LINE_ID]);
    // ไม่ใช่แค่ "Push แล้วล้มเหลว" — ต้องไม่ถูกนับเป็นผู้รับตั้งแต่แรก (สถิติ Admin ถูกต้อง)
    expect(result).toEqual({ totalRecipients: 1, successCount: 1, failureCount: 0 });
  });

  test('Broadcast กลุ่ม premium — คนที่ถูกลบแต่ Premium ยังไม่หมดอายุก็ต้องไม่ได้รับ', async () => {
    await broadcastService.sendBroadcast(
      { targetGroup: 'premium', messageType: 'news', message: 'hello', sentBy: 'U_admin' },
      { delayMs: 0 }
    );

    expect(pushedTo()).toEqual([LIVE_LINE_ID]);
  });

  test('Premium หมดอายุ (cron:plan-downgrade) — ลดชั้นใน DB ครบทุกคน แต่ไม่ Push หาคนที่ถูกลบ', async () => {
    const downgraded = await runPlanDowngrade(NOW);

    expect(pushedTo()).toEqual([LIVE_LINE_ID]);
    // การลดชั้นสิทธิ์คือ Source of Truth — คนที่ถูกลบข้อมูลก็ต้องถูกลดชั้นตามปกติ
    expect(downgraded).toBe(2);
    const downgradedIds = __calls
      .filter((c) => c.table === 'users' && c.op === 'update' && c.patch.plan === 'free')
      .map((c) => c.args.find(([m, col]) => m === 'eq' && col === 'id')[2]);
    expect(downgradedIds).toEqual(['u-live', ERASED_USER_ID]);
  });
});
