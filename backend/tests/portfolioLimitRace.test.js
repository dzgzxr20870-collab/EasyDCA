// ═══════════════════════════════════════════════════════════════════════════
// Portfolio Limit Race — พิสูจน์ว่าสร้างพอร์ตเกินเพดานไม่ได้อีกต่อไป
// ═══════════════════════════════════════════════════════════════════════════
// บั๊กเดิม (พบตอนรีวิวโค้ด Stage 8 — 24 ส.ค. 2569): createPortfolio อ่านจำนวน
// พอร์ตผ่าน countByUser → เทียบเพดานในชั้น App → create() เป็น check-then-insert
// ที่ไม่ Atomic · ผู้ใช้ Free กดสร้างพอร์ตสองแท็บพร้อมกันจะอ่านได้ current = 1
// ทั้งคู่ (Stale Read) → ผ่านการตรวจทั้งคู่ → **ได้ 2 พอร์ต ทะลุเพดาน Free**
//
// migration 048 ย้ายด่านตัดสินไปไว้ที่ Postgres (Lock แถว users → นับ → Validate
// → INSERT ในธุรกรรมเดียว) ตาม Pattern ของ migration 035 เป๊ะ — ไฟล์นี้จำลอง
// Semantics นั้นให้ตรง (Pattern เดียวกับ tests/assetLimitRace.test.js)
//
// ⚠️ ขอบเขต: พิสูจน์ได้ว่าโค้ด App ตอบสนองถูกต้องเมื่อ DB ปฏิเสธ และไม่มีทางลัด
// ไหนหลุดไปเขียนพอร์ตเอง — ตัว SQL FOR UPDATE เองทำงานจริงไหมต้องรันบน Postgres
// จริง (Script RED-GREEN อยู่ท้าย migrations/048 · **ยังไม่ได้รัน** เพราะเครื่องนี้
// ไม่มี Docker/psql)

jest.mock('../src/config/supabase', () => ({
  supabaseAdmin: { rpc: jest.fn() },
}));
// คง create()/setDefaultForUser() ตัวจริงไว้ (ต้องการทดสอบการเรียก RPC + Map Error
// ของมันจริงๆ) Mock เฉพาะฟังก์ชันอ่านที่ปกติใช้ .from() — จำลอง Stale Read ได้ตรง
jest.mock('../src/repositories/portfolio.repository', () => {
  const actual = jest.requireActual('../src/repositories/portfolio.repository');
  return {
    ...actual,
    findAllByUser: jest.fn(),
    findByIdForUser: jest.fn(),
    findDefaultByUser: jest.fn(),
    countByUser: jest.fn(),
  };
});

const { supabaseAdmin } = require('../src/config/supabase');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const portfoliosService = require('../src/services/portfolios.service');

const USER_ID = 'user-1';
const FREE_LIMIT = 1;
const PREMIUM_CAP = 50;

const FREE_USER = { id: USER_ID, plan: 'free', planExpiresAt: null };
const PREMIUM_USER = {
  id: USER_ID,
  plan: 'premium',
  planExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
};

const EXISTING_DEFAULT = {
  id: 'p-default',
  userId: USER_ID,
  name: 'พอร์ตหลัก',
  type: 'custom',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// จำลอง RPC ของ migration 048: นับ "ของจริงในฐาน" ใต้ Lock แล้วตัดสิน
// (ไม่ใช่ตัวเลขที่ Caller อ่านมาก่อนหน้า ซึ่งอาจ Stale ไปแล้ว)
function mockRpcWithRealCount(getRealCount) {
  supabaseAdmin.rpc.mockImplementation(async (fn, args) => {
    if (fn !== 'create_portfolio_locked') throw new Error(`unexpected rpc: ${fn}`);

    const current = getRealCount();
    if (args.p_portfolio_limit !== null && current >= args.p_portfolio_limit) {
      return {
        data: null,
        error: {
          code: 'P0001',
          message: 'PORTFOLIO_LIMIT_REACHED',
          details: `limit=${args.p_portfolio_limit};current=${current}`,
        },
      };
    }
    return {
      data: [
        {
          id: `p-new-${current}`,
          user_id: args.p_user_id,
          name: args.p_name,
          type: args.p_type,
          is_default: false,
          created_at: '2026-08-24T00:00:00.000Z',
          updated_at: '2026-08-24T00:00:00.000Z',
        },
      ],
      error: null,
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  portfolioRepository.findAllByUser.mockResolvedValue([EXISTING_DEFAULT]);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ Race Condition — สองแท็บสร้างพอร์ตพร้อมกัน', () => {
  // ⭐ หัวใจของ migration 048 — Pre-check ฝั่ง JS เห็น current = 0 ทั้งสองครั้ง
  // (Stale Read) แต่ RPC นับของจริงใต้ Lock จึงปฏิเสธครั้งที่ 2
  test('⚠️ Free: Pre-check เห็น 0 ทั้งคู่ (Stale) → RPC ต้องปฏิเสธครั้งที่ 2', async () => {
    let realCount = 0;
    // Pre-check อ่านค่าเดิม (0) ทั้งสองครั้ง = จำลอง Stale Read ของบั๊กเดิมเป๊ะ
    portfolioRepository.countByUser.mockResolvedValue(0);
    mockRpcWithRealCount(() => realCount);

    const first = await portfoliosService.createPortfolio(
      USER_ID,
      { name: 'พอร์ต A', type: 'custom' },
      FREE_USER
    );
    expect(first.id).toBe('p-new-0');
    realCount = 1; // แท็บแรก Commit แล้ว

    // แท็บที่สองยังถือ Pre-check เดิม (0) อยู่ → ถ้าไม่มีด่านที่ DB จะผ่านไปได้
    await expect(
      portfoliosService.createPortfolio(USER_ID, { name: 'พอร์ต B', type: 'custom' }, FREE_USER)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_LIMIT_REACHED' });
  });

  test('⚠️ Premium: Stale Read ที่ Cap 50 → RPC ปฏิเสธ และต้องเป็น CAP ไม่ใช่ LIMIT', async () => {
    portfolioRepository.countByUser.mockResolvedValue(49); // Stale
    mockRpcWithRealCount(() => 50); // ของจริงเต็มแล้ว

    // ⭐ Premium ที่จ่ายเงินอยู่แล้วห้ามเห็นข้อความชวนอัปเกรด — ตรรกะแยก Code
    // ต้องทำงานบนเส้นทาง RPC ด้วย ไม่ใช่เฉพาะเส้นทาง Pre-check
    await expect(
      portfoliosService.createPortfolio(USER_ID, { name: 'พอร์ต 51', type: 'custom' }, PREMIUM_USER)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_CAP_REACHED' });
  });

  test('ส่ง p_portfolio_limit ลง RPC เสมอ — SQL ไม่ Hardcode ตัวเลข', async () => {
    portfolioRepository.countByUser.mockResolvedValue(0);
    mockRpcWithRealCount(() => 0);

    await portfoliosService.createPortfolio(
      USER_ID,
      { name: 'พอร์ต A', type: 'custom' },
      FREE_USER
    );

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('create_portfolio_locked', {
      p_user_id: USER_ID,
      p_name: 'พอร์ต A',
      p_type: 'custom',
      p_portfolio_limit: FREE_LIMIT,
    });
  });

  test('Premium ส่ง Cap 50 ลง RPC (ไม่ใช่ null = ไม่จำกัด)', async () => {
    portfolioRepository.countByUser.mockResolvedValue(0);
    mockRpcWithRealCount(() => 0);

    await portfoliosService.createPortfolio(
      USER_ID,
      { name: 'พอร์ต A', type: 'custom' },
      PREMIUM_USER
    );

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_portfolio_locked',
      expect.objectContaining({ p_portfolio_limit: PREMIUM_CAP })
    );
  });

  // ⚠️ Invariant ของ migration 044/045 — พอร์ตที่สร้างใหม่ต้องไม่ใช่ Default
  test('⚠️ พอร์ตที่ RPC สร้างต้องเป็น is_default = false เสมอ', async () => {
    portfolioRepository.countByUser.mockResolvedValue(0);
    mockRpcWithRealCount(() => 0);

    const created = await portfoliosService.createPortfolio(
      USER_ID,
      { name: 'พอร์ต A', type: 'custom' },
      PREMIUM_USER
    );

    expect(created.isDefault).toBe(false);
  });

  test('Pre-check ฝั่ง JS ยังทำงาน — เต็มเพดานชัดเจนตั้งแต่ต้นก็ไม่ต้องยิง RPC', async () => {
    portfolioRepository.countByUser.mockResolvedValue(1);

    await expect(
      portfoliosService.createPortfolio(USER_ID, { name: 'พอร์ต B', type: 'custom' }, FREE_USER)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_LIMIT_REACHED' });

    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('setDefaultPortfolio — ผู้ใช้เลือกพอร์ตหลักเองได้ (มติ 24 ส.ค. 2569)', () => {
  const SECOND = {
    id: 'p-second',
    userId: USER_ID,
    name: 'พอร์ตคริปโต',
    type: 'crypto',
    isDefault: false,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  const EXPIRED_PREMIUM = {
    id: USER_ID,
    plan: 'premium',
    planExpiresAt: new Date(Date.now() - 864e5).toISOString(),
  };

  beforeEach(() => {
    portfolioRepository.findAllByUser.mockResolvedValue([EXISTING_DEFAULT, SECOND]);
    supabaseAdmin.rpc.mockImplementation(async (fn, args) => {
      if (fn !== 'set_default_portfolio_locked') throw new Error(`unexpected rpc: ${fn}`);
      return {
        data: [
          {
            id: args.p_portfolio_id,
            user_id: args.p_user_id,
            name: SECOND.name,
            type: SECOND.type,
            is_default: true,
            created_at: SECOND.createdAt,
            updated_at: '2026-08-24T00:00:00.000Z',
          },
        ],
        error: null,
      };
    });
  });

  test('สลับพอร์ตหลักได้ → ผ่าน RPC ตัวเดียว (Atomic)', async () => {
    const result = await portfoliosService.setDefaultPortfolio(USER_ID, SECOND.id, PREMIUM_USER);

    expect(result.isDefault).toBe(true);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('set_default_portfolio_locked', {
      p_user_id: USER_ID,
      p_portfolio_id: SECOND.id,
    });
  });

  // ⭐ สำคัญที่สุดในกลุ่มนี้ — ถ้า Gate ด้วย isPremiumActive ตรงๆ ผู้ใช้ที่
  // Premium หมดอายุจะเปลี่ยนพอร์ตหลักไม่ได้ = ถูกขังอยู่กับพอร์ตที่ Backfill
  // เลือกให้ ทั้งที่พอร์ตที่เขาใช้จริงถูกล็อก (กับดักแบบเดียวกับที่มติ 24 ส.ค.
  // ตั้งใจกำจัด — การล็อก = โตต่อไม่ได้ ไม่ใช่ออกไม่ได้)
  test('⭐ Premium หมดอายุก็ยังเปลี่ยนพอร์ตหลักได้ (ไม่งั้นถูกขัง)', async () => {
    const result = await portfoliosService.setDefaultPortfolio(USER_ID, SECOND.id, EXPIRED_PREMIUM);

    expect(result.isDefault).toBe(true);
  });

  test('⚠️ พอร์ตของผู้ใช้คนอื่น → PORTFOLIO_NOT_FOUND และไม่ยิง RPC เลย', async () => {
    await expect(
      portfoliosService.setDefaultPortfolio(USER_ID, 'p-of-someone-else', PREMIUM_USER)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_NOT_FOUND' });

    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  test('มีพอร์ตเดียว (Free) → VALIDATION_ERROR ไม่ใช่ยิง RPC ทิ้งเปล่า', async () => {
    portfolioRepository.findAllByUser.mockResolvedValue([{ ...SECOND, isDefault: false }]);

    await expect(
      portfoliosService.setDefaultPortfolio(USER_ID, SECOND.id, FREE_USER)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  test('เป็นพอร์ตหลักอยู่แล้ว → Idempotent คืนค่าเดิม ไม่ยิง RPC', async () => {
    const result = await portfoliosService.setDefaultPortfolio(
      USER_ID,
      EXISTING_DEFAULT.id,
      PREMIUM_USER
    );

    expect(result.id).toBe(EXISTING_DEFAULT.id);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  test('RPC ปฏิเสธ (Cross-User ที่หลุดมาถึง DB) → แปลงเป็น PORTFOLIO_NOT_FOUND', async () => {
    supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'PORTFOLIO_NOT_FOUND', details: 'portfolio_id=x' },
    });

    await expect(
      portfoliosService.setDefaultPortfolio(USER_ID, SECOND.id, PREMIUM_USER)
    ).rejects.toMatchObject({ code: 'PORTFOLIO_NOT_FOUND' });
  });
});
