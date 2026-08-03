// ═══════════════════════════════════════════════════════════════════════════
// Free-tier Asset Limit Race — พิสูจน์ว่าสร้าง Asset เกินเพดาน Free Plan ไม่ได้อีกต่อไป
// ═══════════════════════════════════════════════════════════════════════════
// บั๊กเดิม: validateBuy อ่านจำนวน Asset Active ผ่าน countActiveByUser → เทียบเพดาน
// ในชั้น App → assetRepository.create() เป็น check-then-insert ที่ไม่ Atomic สอง
// คำสั่งซื้อ Symbol ใหม่คนละตัวที่เข้ามาพร้อมกันจะอ่านจำนวนชุดเดียวกัน (Stale Read)
// แล้วผ่านการตรวจทั้งคู่ → ได้ Asset เกินเพดาน 2 ตัวของ Free Plan
//
// migration 035 ย้ายด่านตัดสินไปไว้ที่ Postgres (Lock แถว users → นับ → Validate →
// INSERT ในธุรกรรมเดียว) — ไฟล์นี้จำลอง Semantics นั้นให้ตรงเป๊ะ (Pattern เดียวกับ
// tests/oversellRace.test.js ที่ทำกับ Oversell Race ก่อนหน้า) เพื่อทดสอบว่าโค้ดฝั่ง
// App ส่งต่อการปฏิเสธได้ถูกต้อง และไม่มีทางลัดไหนหลุดไปเขียน Asset เอง
//
// ⚠️ ขอบเขต: พิสูจน์ได้ว่าโค้ด App ตอบสนองถูกต้องเมื่อ DB ปฏิเสธ — ตัว SQL FOR UPDATE
// เองทำงานจริงไหม ทดสอบแยกกับ Postgres จริงบน Production แล้ว (verify035.js)

jest.mock('../src/config/supabase', () => ({
  supabaseAdmin: { rpc: jest.fn() },
}));
// คง create() ตัวจริงไว้ (ต้องการทดสอบการเรียก RPC + Map Error ของมันจริงๆ) Mock
// เฉพาะฟังก์ชันอ่านที่ปกติใช้ .from() — จำลอง Stale Read ของบั๊กเดิมได้ตรงเป๊ะ
jest.mock('../src/repositories/asset.repository', () => {
  const actual = jest.requireActual('../src/repositories/asset.repository');
  return {
    ...actual,
    findByUserAndSymbol: jest.fn(),
    countActiveByUser: jest.fn(),
  };
});
// Ledger ไม่ใช่จุดที่ทดสอบในไฟล์นี้ (มี oversellRace.test.js ทดสอบแยกแล้ว) — Mock
// ให้เขียนสำเร็จเสมอ เพื่อแยก Concern ให้ Test นี้ Focus เฉพาะ Asset Creation
jest.mock('../src/repositories/transaction.repository');

const { supabaseAdmin } = require('../src/config/supabase');
const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const transactionService = require('../src/services/transaction.service');

const USER_ID = 'user-1';
const FREE_LIMIT = 2;

// ── Fake Postgres: จำลอง create_asset_locked() ให้ตรง Semantics migration 035 ──
// state.activeCount = จำนวน Asset Active จริงฝั่ง "DB" (Source of Truth เดียวของ
// การทดสอบนี้) — ไม่มี await คั่นระหว่างเช็คกับเพิ่มค่า = Critical Section จริงแบบ
// เดียวกับที่ FOR UPDATE ให้ (JS Single-threaded)
const state = { activeCount: 0, rows: [] };

function installFakeRpc() {
  supabaseAdmin.rpc.mockImplementation(async (fnName, args) => {
    if (fnName !== 'create_asset_locked') throw new Error(`unexpected rpc: ${fnName}`);

    // ⬇⬇ Critical Section — ห้ามมี await คั่นตั้งแต่บรรทัดนี้จนจบ (= FOR UPDATE) ⬇⬇
    if (args.p_asset_limit !== null && state.activeCount >= args.p_asset_limit) {
      return {
        data: null,
        error: {
          message: 'ASSET_LIMIT_REACHED',
          details: `limit=${args.p_asset_limit};current=${state.activeCount}`,
        },
      };
    }
    state.activeCount += 1;
    const row = {
      id: `asset-${state.rows.length + 1}`,
      user_id: args.p_user_id,
      portfolio_id: args.p_portfolio_id,
      symbol: args.p_symbol,
      name: args.p_name,
      type: args.p_type,
      proj_id: args.p_proj_id,
      fund_class_name: args.p_fund_class_name,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.rows.push(row);
    // ⬆⬆ จบ Critical Section ⬆⬆
    return { data: [row], error: null };
  });
}

function buyNewSymbolParams(symbol) {
  return { symbol, name: symbol, quantity: 1, pricePerUnit: 100, type: 'crypto' };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.activeCount = 0;
  state.rows = [];
  installFakeRpc();
  // ทุก Symbol ที่ทดสอบเป็น "ใหม่เสมอ" (ยังไม่เคยมีในพอร์ต) — บังคับให้เข้า Path
  // สร้าง Asset ใหม่ทุกครั้ง ตรงกับสถานการณ์ Race ที่ Audit ระบุ
  assetRepository.findByUserAndSymbol.mockResolvedValue(null);
  transactionRepository.create.mockResolvedValue({
    id: 'tx-1',
    date: '2026-01-01',
    note: null,
    heldAfter: 1,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1) หัวใจของงานนี้ — ยิงขนานจริงด้วย Promise.all
// ═══════════════════════════════════════════════════════════════════════════

describe('processBuyCommand — Concurrent Buy สินทรัพย์ใหม่คนละตัว (Promise.all)', () => {
  test('🔒 มี 0 Asset (Free Limit=2) ยิงซื้อ Symbol ใหม่ 5 ตัวพร้อมกัน → สำเร็จได้แค่ 2 ตัว', async () => {
    // Pre-check ทุก Request อ่านจำนวนชุดเดียวกัน (0) = จำลอง Stale Read ของบั๊กเดิมเป๊ะ
    assetRepository.countActiveByUser.mockResolvedValue(0);

    const symbols = ['SYM0', 'SYM1', 'SYM2', 'SYM3', 'SYM4'];
    const results = await Promise.allSettled(
      symbols.map((s) =>
        transactionService.processBuyCommand(USER_ID, buyNewSymbolParams(s), { plan: 'free' })
      )
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(ok).toHaveLength(2); // เท่าเพดาน Free Plan เป๊ะ
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(transactionService.TransactionServiceError);
      expect(r.reason.code).toBe('ASSET_LIMIT_REACHED');
    }
    // 🔑 ข้อพิสูจน์หลัก: จำนวน Asset ที่สร้างจริงต้องไม่เกินเพดานเด็ดขาด
    expect(state.activeCount).toBe(2);
    expect(state.rows).toHaveLength(2);
  });

  test('🔒 มี 1 Asset อยู่แล้ว (เหลือโควตา 1) ยิงซื้อ Symbol ใหม่ 4 ตัวพร้อมกัน → สำเร็จได้แค่ 1 ตัว', async () => {
    state.activeCount = 1; // จำลองว่ามี Asset เดิมอยู่แล้ว 1 ตัวใน "DB"
    assetRepository.countActiveByUser.mockResolvedValue(1); // Pre-check เห็นค่าเดียวกัน

    const symbols = ['SYM0', 'SYM1', 'SYM2', 'SYM3'];
    const results = await Promise.allSettled(
      symbols.map((s) =>
        transactionService.processBuyCommand(USER_ID, buyNewSymbolParams(s), { plan: 'free' })
      )
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(state.activeCount).toBe(2); // 1 เดิม + 1 ที่สร้างสำเร็จ ไม่เกิน 2
  });

  test('🔒 Premium (assetLimit=null/ไม่จำกัด) ยิงซื้อ Symbol ใหม่ 5 ตัวพร้อมกัน → สำเร็จหมดทุกตัว', async () => {
    assetRepository.countActiveByUser.mockResolvedValue(0);

    const symbols = ['SYM0', 'SYM1', 'SYM2', 'SYM3', 'SYM4'];
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const results = await Promise.allSettled(
      symbols.map((s) =>
        transactionService.processBuyCommand(USER_ID, buyNewSymbolParams(s), {
          plan: 'premium',
          planExpiresAt: futureExpiry,
        })
      )
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(state.activeCount).toBe(5);
  });

  test('🔒 Property: สุ่มจำนวน Asset เดิม/จำนวน Request 20 รอบ (plan: free) — ไม่เคยเกินเพดาน 2 เลยสักครั้ง', async () => {
    for (let round = 0; round < 20; round += 1) {
      // เริ่มต้นไม่เกินเพดานเสมอ (0 หรือ 1) — จำลองสถานะ User ก่อนเกิด Race
      const existing = Math.floor(Math.random() * FREE_LIMIT);
      state.activeCount = existing;
      state.rows = [];
      assetRepository.countActiveByUser.mockResolvedValue(existing);

      const n = 2 + Math.floor(Math.random() * 6);
      const symbols = Array.from({ length: n }, (_, i) => `R${round}SYM${i}`);
      await Promise.allSettled(
        symbols.map((s) =>
          transactionService.processBuyCommand(USER_ID, buyNewSymbolParams(s), {
            plan: 'free',
          })
        )
      );

      expect(state.activeCount).toBeLessThanOrEqual(FREE_LIMIT);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) ทุก Path สร้าง Asset ผ่าน RPC จริง (ไม่มีใครแอบ .insert() ตรง)
// ═══════════════════════════════════════════════════════════════════════════

describe('assetRepository.create เรียก create_asset_locked เท่านั้น', () => {
  test('processBuyCommand (Asset ใหม่) → ส่ง p_asset_limit ตามที่ validateBuy คำนวณ', async () => {
    assetRepository.countActiveByUser.mockResolvedValue(0);

    await transactionService.processBuyCommand(USER_ID, buyNewSymbolParams('BTC'), {
      plan: 'free',
    });

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_asset_locked',
      expect.objectContaining({ p_user_id: USER_ID, p_symbol: 'BTC', p_asset_limit: 2 })
    );
  });

  test('Asset เดิมมีอยู่แล้ว (ไม่ใช่ Asset ใหม่) → ไม่เรียก RPC เลย (ไม่ต้อง Lock)', async () => {
    assetRepository.findByUserAndSymbol.mockResolvedValue({
      id: 'existing-asset',
      symbol: 'BTC',
      type: 'crypto',
    });

    await transactionService.processBuyCommand(USER_ID, buyNewSymbolParams('BTC'), {
      plan: 'free',
    });

    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(assetRepository.countActiveByUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) Error Contract เดิมต้องไม่เปลี่ยน (Regression)
// ═══════════════════════════════════════════════════════════════════════════

describe('Error Contract — Caller เดิมต้องไม่รู้ว่าถูกปฏิเสธจากด่านไหน', () => {
  test('Error จาก RPC เป็น TransactionServiceError จริง พร้อม Code เดิม ASSET_LIMIT_REACHED', async () => {
    // Pre-check เห็น 0 (Stale) แต่ DB จริงเต็มแล้ว (Race) — ปล่อยผ่านไปถึง RPC
    state.activeCount = 2;
    assetRepository.countActiveByUser.mockResolvedValue(0);

    await expect(
      transactionService.processBuyCommand(USER_ID, buyNewSymbolParams('NEWSYM'), {
        plan: 'free',
      })
    ).rejects.toMatchObject({
      code: 'ASSET_LIMIT_REACHED',
    });
  });

  test('details ใช้ยอดจริงจาก DB (ไม่ใช่ยอด Stale ที่ Pre-check อ่านมา)', async () => {
    state.activeCount = 2; // DB จริงเต็มแล้ว
    assetRepository.countActiveByUser.mockResolvedValue(0); // Pre-check เห็นค่าเก่า (Stale)

    await expect(
      transactionService.processBuyCommand(USER_ID, buyNewSymbolParams('NEWSYM'), {
        plan: 'free',
      })
    ).rejects.toMatchObject({
      code: 'ASSET_LIMIT_REACHED',
      details: { limit: 2, current: 2 },
    });
  });

  test('Symbol ซ้ำชนกันพอดี (Race) → ASSET_ALREADY_EXISTS ไม่ใช่ ASSET_LIMIT_REACHED', async () => {
    assetRepository.countActiveByUser.mockResolvedValue(0);
    supabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'ASSET_ALREADY_EXISTS' },
    });

    await expect(
      transactionService.processBuyCommand(USER_ID, buyNewSymbolParams('BTC'), { plan: 'free' })
    ).rejects.toMatchObject({
      code: 'ASSET_ALREADY_EXISTS',
    });
  });

  test('Error อื่นของ DB (ไม่ใช่เงื่อนไขธุรกิจ) ยังโยนต่อเป็น Error ทั่วไปเหมือนเดิม', async () => {
    assetRepository.countActiveByUser.mockResolvedValue(0);
    supabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection terminated' },
    });

    await expect(
      transactionService.processBuyCommand(USER_ID, buyNewSymbolParams('BTC'), { plan: 'free' })
    ).rejects.toThrow(/Failed to create asset/);
  });
});
