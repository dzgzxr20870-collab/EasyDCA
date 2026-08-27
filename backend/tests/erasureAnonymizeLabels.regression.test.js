// ═══════════════════════════════════════════════════════════════════════════
// PDPA Erasure — ต้องล้าง "ชื่อที่ผู้ใช้ตั้งเอง" ของ portfolios/brokers ด้วย
// ═══════════════════════════════════════════════════════════════════════════
// มติ Founder 27 ส.ค. 2569: `portfolios.name` / `brokers.name` เป็นข้อความที่ผู้ใช้
// พิมพ์เอง อาจมี PII จริง (เช่น "พอร์ตของสมชาย") และเป็น **ป้ายกำกับล้วน ไม่เข้า
// สูตรคำนวณเงินสักสูตร** → เกราะ "Immutable Ledger" ที่ปกป้อง transactions ไม่ครอบ
//
// ── 🔴 กับดักที่ไฟล์นี้มีไว้ดักโดยเฉพาะ ──────────────────────────────────────
// `brokers` มี **uniq_brokers_user_name_ci ON (user_id, lower(name))** (migration 042)
// ถ้าเปลี่ยนชื่อโบรกทุกตัวเป็นค่าเดียวกัน (เช่น "โบรก") ผู้ใช้ที่มี 3 โบรกจะ
// **ชน UNIQUE → Erasure ล้มทั้งก้อน** แล้วคนที่ยื่นคำขอลบข้อมูลตาม PDPA จะลบไม่ได้เลย
//
// ⚠️ เทสต์ผู้ใช้ที่มีโบรกเดียวจับกับดักนี้ไม่ได้เลย — ไฟล์นี้จึงจำลอง
// **ผู้ใช้ที่มี 3 พอร์ต + 3 โบรก** เป็นหัวใจ
//
// ⚠️ Fake Supabase ไม่ได้บังคับ UNIQUE Index จริง (ไม่มี Postgres ให้รัน) — เทสต์นี้
// จึง assert **คุณสมบัติที่ Index นั้นบังคับ** ตรงๆ แทน: ชื่อที่ได้ต้องไม่ซ้ำกันเลย
// เมื่อเทียบแบบไม่สนตัวพิมพ์ (`lower(name)`) ซึ่งเป็นเงื่อนไขเดียวกับที่ DB ตรวจ
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • เปลี่ยนชื่อเป็นค่าคงที่เหมือนกันทุกแถว → เคส "ชื่อต้องไม่ซ้ำ" แดง
//   • ถอด anonymizeNamesForUser ออกจาก userErasure → เคส "ชื่อถูกล้าง" แดง
//   • เปลี่ยนเป็น DELETE แทน UPDATE → เคส "โครงสร้างยังอยู่ครบ" แดง

process.env.LINE_CHANNEL_SECRET = 'test-line-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// ⚠️ ใช้ Fake Supabase ตัวเดียวกับชุด Cross-User โดยเจตนา — มันบังคับ .eq() จริง
// ถ้าลืม Scope ด้วย user_id ที่ไหน ชื่อของผู้ใช้คนอื่นจะถูกล้างไปด้วยแล้วเทสต์แดง
jest.mock('../src/config/supabase', () => {
  const { createClient } = require('./helpers/fakeSupabase');
  return { supabaseAdmin: createClient() };
});
jest.mock('../src/services/storage.service');

const { tables, resetTables } = require('./helpers/fakeSupabase');
const storageService = require('../src/services/storage.service');
const userErasureService = require('../src/services/userErasure.service');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const brokerRepository = require('../src/repositories/broker.repository');

const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'; // ผู้ขอลบข้อมูล
const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'; // ผู้ใช้คนอื่น ต้องไม่ถูกแตะ

// ชื่อที่ "มี PII จริง" — ถ้าค่าเหล่านี้ยังอยู่ใน DB หลัง Erasure = ล้างไม่สำเร็จ
const A_PORTFOLIO_NAMES = ['พอร์ตของสมชาย', 'เกษียณสมชาย 2570', 'ของลูกสาว'];
const A_BROKER_NAMES = ['Bitkub ของสมชาย', 'Binance สมชาย', 'พอร์ตพ่อ'];

function seed() {
  resetTables({
    users: [
      {
        id: USER_A,
        line_user_id: 'Uerase',
        display_name: 'สมชาย',
        picture_url: 'https://x/pic.jpg',
        plan: 'free',
        plan_expires_at: null,
        pdpa_consented_at: '2026-01-01T00:00:00.000Z',
        anonymized_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: USER_B,
        line_user_id: 'Uother',
        display_name: 'คนอื่น',
        picture_url: null,
        plan: 'free',
        plan_expires_at: null,
        pdpa_consented_at: '2026-01-01T00:00:00.000Z',
        anonymized_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],

    // ⭐ 3 พอร์ต + 3 โบรก — จำนวนคือหัวใจ (โบรกเดียวจับกับดัก UNIQUE ไม่ได้)
    portfolios: A_PORTFOLIO_NAMES.map((name, i) => ({
      id: `pa${i}00000-0000-4000-8000-00000000000${i}`,
      user_id: USER_A,
      name,
      type: 'custom',
      is_default: i === 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })).concat([
      {
        id: 'pb000000-0000-4000-8000-000000000009',
        user_id: USER_B,
        name: 'พอร์ตของคนอื่น',
        type: 'custom',
        is_default: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]),

    brokers: A_BROKER_NAMES.map((name, i) => ({
      id: `ba${i}00000-0000-4000-8000-00000000000${i}`,
      user_id: USER_A,
      name,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })).concat([
      {
        id: 'bb000000-0000-4000-8000-000000000009',
        user_id: USER_B,
        name: 'โบรกของคนอื่น',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]),

    // Ledger ของ A — ต้องไม่ถูกแตะแม้แต่แถวเดียว
    assets: [
      {
        id: 'as000000-0000-4000-8000-000000000001',
        user_id: USER_A,
        symbol: 'BTC',
        name: 'Bitcoin',
        asset_type: 'crypto',
        portfolio_id: 'pa000000-0000-4000-8000-000000000000',
        broker_id: 'ba000000-0000-4000-8000-000000000000',
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    transactions: [
      {
        id: 'tx000000-0000-4000-8000-000000000001',
        user_id: USER_A,
        asset_id: 'as000000-0000-4000-8000-000000000001',
        type: 'buy',
        amount_thb: '1000.00',
        price_per_unit: '1000',
        quantity: '1',
        currency: 'THB',
        fee_thb: 0,
        date: '2026-01-05',
        note: 'บันทึกโดยสมชาย',
        created_at: '2026-01-05T00:00:00.000Z',
        updated_at: '2026-01-05T00:00:00.000Z',
      },
    ],

    payments: [],
    erasure_logs: [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  seed();
  storageService.deleteAllSlipsForUser.mockResolvedValue(0);
  storageService.deleteAllTransactionSlipsForUser.mockResolvedValue(0);
  storageService.deleteAllFacebookLikeProofsForUser.mockResolvedValue(0);
});

const rowsOf = (table, userId) => tables[table].filter((r) => r.user_id === userId);

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ ล้างชื่อ portfolios / brokers ตอน Erasure', () => {
  test('⭐ ชื่อที่ผู้ใช้ตั้งเอง (มี PII) ต้องไม่เหลืออยู่ใน DB เลยแม้แต่ตัวเดียว', async () => {
    await userErasureService.eraseUserData(USER_A);

    const names = [
      ...rowsOf('portfolios', USER_A).map((r) => r.name),
      ...rowsOf('brokers', USER_A).map((r) => r.name),
    ];

    for (const original of [...A_PORTFOLIO_NAMES, ...A_BROKER_NAMES]) {
      expect(names).not.toContain(original);
    }
    // และต้องไม่มีคำว่า "สมชาย" หลงเหลืออยู่ใน Field ไหนของสองตารางนี้เลย
    expect(JSON.stringify([...rowsOf('portfolios', USER_A), ...rowsOf('brokers', USER_A)]))
      .not.toContain('สมชาย');
  });

  // ⭐⭐ เคสสำคัญที่สุดของไฟล์นี้ — กับดัก uniq_brokers_user_name_ci
  test('⭐ ชื่อโบรกหลังล้างต้องไม่ซ้ำกันเลย (ไม่งั้นชน UNIQUE → Erasure ล้มทั้งก้อน)', async () => {
    await userErasureService.eraseUserData(USER_A);

    const keys = rowsOf('brokers', USER_A).map((r) => String(r.name).toLowerCase());

    expect(keys).toHaveLength(3);
    // เงื่อนไขเดียวกับที่ uniq_brokers_user_name_ci ON (user_id, lower(name)) บังคับ
    expect(new Set(keys).size).toBe(3);
  });

  test('ชื่อพอร์ตหลังล้างก็ต้องไม่ซ้ำกัน (กันไว้เผื่อวันหนึ่งมีคนเพิ่ม UNIQUE)', async () => {
    await userErasureService.eraseUserData(USER_A);

    const keys = rowsOf('portfolios', USER_A).map((r) => String(r.name).toLowerCase());

    expect(new Set(keys).size).toBe(3);
  });

  // ⚠️ Anonymize ไม่ใช่ DELETE — ลบแถวจะทำให้ assets.portfolio_id/broker_id เป็น NULL
  // (FK ON DELETE SET NULL) ซึ่งเท่ากับแก้ข้อมูลการลงทุน และละเมิด Invariant ของ 044/045
  test('⭐ โครงสร้างต้องอยู่ครบ — จำนวนแถวเท่าเดิม และสินทรัพย์ยังผูกอยู่ที่เดิม', async () => {
    await userErasureService.eraseUserData(USER_A);

    expect(rowsOf('portfolios', USER_A)).toHaveLength(3);
    expect(rowsOf('brokers', USER_A)).toHaveLength(3);

    const asset = tables.assets[0];
    expect(asset.portfolio_id).toBe('pa000000-0000-4000-8000-000000000000');
    expect(asset.broker_id).toBe('ba000000-0000-4000-8000-000000000000');
  });

  // กฎเหล็กข้อ 2 — Immutable Ledger ต้องไม่ถูกแตะแม้แต่แถวเดียว
  test('⚠️ transactions / assets ต้องไม่ถูกแตะเลย (Immutable Ledger)', async () => {
    const before = JSON.stringify(tables.transactions);

    await userErasureService.eraseUserData(USER_A);

    expect(JSON.stringify(tables.transactions)).toBe(before);
    expect(tables.assets).toHaveLength(1);
  });

  // ⚠️ Fake Supabase บังคับ .eq() จริง — ถ้าลืม Scope ด้วย user_id ที่ไหน เคสนี้แดง
  test('🔒 ชื่อของผู้ใช้คนอื่นต้องไม่ถูกแตะแม้แต่ตัวอักษรเดียว', async () => {
    await userErasureService.eraseUserData(USER_A);

    expect(rowsOf('portfolios', USER_B)[0].name).toBe('พอร์ตของคนอื่น');
    expect(rowsOf('brokers', USER_B)[0].name).toBe('โบรกของคนอื่น');
  });

  test('คืนจำนวนที่ล้างไปให้ Caller ตรวจสอบได้', async () => {
    const result = await userErasureService.eraseUserData(USER_A);

    expect(result.anonymizedPortfolioCount).toBe(3);
    expect(result.anonymizedBrokerCount).toBe(3);
  });

  // ผู้ใช้ที่ไม่มีพอร์ต/โบรกเลย (สภาพก่อน Backfill ของ 044) ต้องไม่พัง
  test('ไม่มีพอร์ต/โบรกเลย → ไม่พัง คืน 0 ทั้งคู่', async () => {
    resetTables({
      users: tables.users,
      portfolios: [],
      brokers: [],
      assets: [],
      transactions: [],
      payments: [],
      erasure_logs: [],
    });

    const result = await userErasureService.eraseUserData(USER_A);

    expect(result.anonymizedPortfolioCount).toBe(0);
    expect(result.anonymizedBrokerCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ลำดับการทำงาน — ล้างชื่อก่อน Anonymize users', () => {
  // ⚠️ ต้องทำก่อน Anonymize users เพราะถ้าขั้นนี้ Fail ยัง Retry ได้โดยไม่ต้องพึ่ง
  // user_id เดิม (Pattern เดียวกับการลบรูปสลิปที่ทำก่อนอยู่แล้ว)
  test('ล้างชื่อสำเร็จก่อน แล้ว users ถึงถูก Anonymize', async () => {
    await userErasureService.eraseUserData(USER_A);

    const userA = tables.users.find((u) => u.id === USER_A);

    expect(userA.anonymized_at).not.toBeNull();
    expect(rowsOf('brokers', USER_A).map((r) => r.name)).not.toContain('Bitkub ของสมชาย');
  });

  // ⚠️ **ไม่ Error-Isolated โดยเจตนา** — ถ้าล้างชื่อไม่สำเร็จแล้วยัง Anonymize ต่อ
  // ผู้ใช้จะถูกบอกว่า "ลบข้อมูลแล้ว" ทั้งที่ชื่อที่มี PII ยังอยู่ครบ = คำตอบที่ผิด
  // ต่อคำขอตาม PDPA · ต้อง throw ให้ Retry ได้ ดีกว่ารายงานผลลวง
  test('⚠️ ล้างชื่อไม่สำเร็จ → ต้อง throw ไม่ใช่เดินหน้า Anonymize แล้วบอกว่าสำเร็จ', async () => {
    const spy = jest
      .spyOn(brokerRepository, 'anonymizeNamesForUser')
      .mockRejectedValue(new Error('db down'));

    await expect(userErasureService.eraseUserData(USER_A)).rejects.toThrow('db down');

    const userA = tables.users.find((u) => u.id === USER_A);
    expect(userA.anonymized_at).toBeNull();

    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Repository — ใช้ได้เดี่ยวๆ และ Scope ด้วย user_id เสมอ', () => {
  test('portfolio.anonymizeNamesForUser คืนจำนวนแถวที่ล้างจริง', async () => {
    expect(await portfolioRepository.anonymizeNamesForUser(USER_A)).toBe(3);
    expect(rowsOf('portfolios', USER_B)[0].name).toBe('พอร์ตของคนอื่น');
  });

  test('broker.anonymizeNamesForUser คืนจำนวนแถวที่ล้างจริง', async () => {
    expect(await brokerRepository.anonymizeNamesForUser(USER_A)).toBe(3);
    expect(rowsOf('brokers', USER_B)[0].name).toBe('โบรกของคนอื่น');
  });

  // requireUserId — ลืมส่ง userId ต้องพังทันที ไม่ใช่กลายเป็น Query ข้ามบัญชี
  test('⚠️ ไม่ส่ง userId → throw ทันที (ห้ามกลายเป็นการล้างชื่อทั้งระบบ)', async () => {
    await expect(portfolioRepository.anonymizeNamesForUser(undefined)).rejects.toThrow();
    await expect(brokerRepository.anonymizeNamesForUser(undefined)).rejects.toThrow();
  });
});
