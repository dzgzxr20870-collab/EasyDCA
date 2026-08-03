// ═══════════════════════════════════════════════════════════════════════════
// Oversell Race (HIGH-1) — พิสูจน์ว่าขายเกินยอดคงเหลือเป็นไปไม่ได้อีกต่อไป
// ═══════════════════════════════════════════════════════════════════════════
// บั๊กเดิม: validateSell อ่านประวัติ → คำนวณยอดคงเหลือในชั้น App → INSERT เป็น
// check-then-insert ที่ไม่ Atomic สองคำสั่งขาย Asset เดียวกันที่เข้ามาพร้อมกันจะ
// อ่านยอดชุดเดียวกัน (Stale Read) แล้วผ่านการตรวจทั้งคู่ → ยอดติดลบ
//
// migration 034 ย้ายด่านตัดสินไปไว้ที่ Postgres (Lock → คำนวณ → Validate → INSERT
// ในธุรกรรมเดียว) ไฟล์นี้จำลอง Semantics นั้นให้ตรงเป๊ะเพื่อทดสอบว่า "โค้ดฝั่ง App
// ส่งต่อการปฏิเสธได้ถูกต้อง และไม่มีทางลัดไหนหลุดไปเขียน Ledger เอง"
//
// ⚠️ ขอบเขตที่ไฟล์นี้พิสูจน์ได้/ไม่ได้ (ระบุให้ชัด ไม่กล่าวเกินจริง):
//   ✅ พิสูจน์ได้: เมื่อ DB ปฏิเสธ ผู้ใช้ได้ Error Code เดิมทุกประการ + มีแค่คำสั่ง
//      เดียวที่สำเร็จเมื่อยิงขนาน + ยอดคงเหลือไม่มีทางติดลบผ่าน Service ทุกตัว
//   ❌ พิสูจน์ไม่ได้ในไฟล์นี้: ตัว SQL FOR UPDATE เองทำงานจริงไหม — นั่นทดสอบกับ
//      Postgres จริงบน Production แล้วแยกต่างหาก (ยิง RPC ขนานตรงๆ ทั้งหมดถูกปฏิเสธ)
//
// การจำลอง Lock ที่นี่เที่ยงตรงเพราะ JS เป็น Single-threaded: ในฟังก์ชัน Fake ด้านล่าง
// ไม่มี await คั่นระหว่าง "อ่านยอด" กับ "เขียนยอด" ช่วงนั้นจึงเป็น Critical Section
// จริงแบบเดียวกับที่ FOR UPDATE ให้ — ส่วนโค้ด Service ที่เรียกมี await คั่นเต็มไปหมด
// (validateSell → findAllByAsset) จึงเกิด Interleaving แบบเดียวกับ Race ของจริง

jest.mock('../src/config/supabase', () => ({
  supabaseAdmin: { rpc: jest.fn() },
}));
// คง create() ตัวจริงไว้ (ต้องการทดสอบการ Map Error ของมันจริงๆ) Mock เฉพาะฟังก์ชัน
// อ่านที่ใช้ .from() ซึ่งไม่ได้ Fake ไว้ใน supabaseAdmin ข้างบน
jest.mock('../src/repositories/transaction.repository', () => {
  const actual = jest.requireActual('../src/repositories/transaction.repository');
  return {
    ...actual,
    findAllByAsset: jest.fn(),
    findRecentByUser: jest.fn(),
  };
});
jest.mock('../src/repositories/asset.repository');

const { supabaseAdmin } = require('../src/config/supabase');
const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const transactionService = require('../src/services/transaction.service');
const undoService = require('../src/services/undoTransaction.service');

const USER_ID = 'user-1';
const ASSET_ID = 'asset-1';

// ── Fake Postgres: จำลอง create_transaction_locked() ให้ตรง Semantics migration 034 ──
// state.held = ยอดคงเหลือจริงฝั่ง "DB" (Source of Truth เดียวของการทดสอบนี้)
const state = { held: 0, rows: [] };

function installFakeRpc() {
  supabaseAdmin.rpc.mockImplementation(async (fnName, args) => {
    if (fnName !== 'create_transaction_locked') throw new Error(`unexpected rpc: ${fnName}`);

    // ⬇⬇ Critical Section — ห้ามมี await คั่นตั้งแต่บรรทัดนี้จนจบ (= FOR UPDATE) ⬇⬇
    const qty = Number(args.p_quantity);
    if (args.p_type === 'sell' && qty > state.held) {
      return {
        data: null,
        error: {
          message: 'INSUFFICIENT_QUANTITY',
          details: `requested=${qty};held=${state.held}`,
          code: 'P0001',
        },
      };
    }
    state.held = args.p_type === 'buy' ? state.held + qty : state.held - qty;
    const row = {
      id: `tx-${state.rows.length + 1}`,
      user_id: args.p_user_id,
      asset_id: args.p_asset_id,
      type: args.p_type,
      amount_thb: args.p_amount_thb,
      price_per_unit: args.p_price_per_unit,
      quantity: qty,
      currency: args.p_currency,
      fee_thb: args.p_fee_thb,
      date: args.p_date,
      note: args.p_note,
      source: args.p_source,
      slip_image_path: null,
      created_at: new Date().toISOString(),
      held_after: state.held,
    };
    state.rows.push(row);
    // ⬆⬆ จบ Critical Section ⬆⬆
    return { data: [row], error: null };
  });
}

function sellParams(quantity) {
  return { symbol: 'BTC', quantity, pricePerUnit: 100 };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.held = 0;
  state.rows = [];
  installFakeRpc();
  assetRepository.findByUserAndSymbol.mockResolvedValue({ id: ASSET_ID, symbol: 'BTC' });
  assetRepository.findByIds.mockResolvedValue([{ id: ASSET_ID, symbol: 'BTC' }]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1) หัวใจของงานนี้ — ยิงขนานจริงด้วย Promise.all
// ═══════════════════════════════════════════════════════════════════════════

describe('processSellCommand — Concurrent Sell (Promise.all)', () => {
  test('🔒 ถือ 10 ยิงขาย 10 พร้อมกัน 5 Request → สำเร็จได้ใบเดียว ยอดคงเหลือเป็น 0 ไม่ติดลบ', async () => {
    state.held = 10;
    // ทุก Request อ่านประวัติ "ชุดเดียวกัน" (ยอด 10) = จำลอง Stale Read ของบั๊กเดิมเป๊ะ
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-seed', type: 'buy', quantity: 10, currency: 'THB' },
    ]);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => transactionService.processSellCommand(USER_ID, sellParams(10)))
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    // ทุกใบที่ถูกปฏิเสธต้องได้ Code เดิมที่ Caller เดิมรู้จัก (Contract ไม่เปลี่ยน)
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(transactionService.TransactionServiceError);
      expect(r.reason.code).toBe('INSUFFICIENT_QUANTITY');
    }
    // 🔑 ข้อพิสูจน์หลัก: ยอดคงเหลือฝั่ง DB ห้ามติดลบเด็ดขาด
    expect(state.held).toBe(0);
    expect(state.rows).toHaveLength(1);
  });

  test('🔒 ถือ 10 ยิงขายใบละ 4 พร้อมกัน 5 Request → สำเร็จ 2 ใบ (รวม 8) เหลือ 2 ไม่ติดลบ', async () => {
    state.held = 10;
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-seed', type: 'buy', quantity: 10, currency: 'THB' },
    ]);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => transactionService.processSellCommand(USER_ID, sellParams(4)))
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(2);
    expect(state.held).toBe(2);
    // ผลรวมที่ขายออกไปจริงต้องไม่เกินที่ถืออยู่ตั้งต้น
    const totalSold = state.rows.reduce((s, r) => s + Number(r.quantity), 0);
    expect(totalSold).toBeLessThanOrEqual(10);
  });

  test('🔒 Property: สุ่มจำนวน/ขนาดคำสั่งขาย 30 รอบ — ยอดคงเหลือไม่เคยติดลบเลยสักครั้ง', async () => {
    for (let round = 0; round < 30; round += 1) {
      const initial = 1 + Math.floor(Math.random() * 20);
      state.held = initial;
      state.rows = [];
      transactionRepository.findAllByAsset.mockResolvedValue([
        { id: 'tx-seed', type: 'buy', quantity: initial, currency: 'THB' },
      ]);

      const n = 2 + Math.floor(Math.random() * 6);
      await Promise.allSettled(
        Array.from({ length: n }, () =>
          transactionService.processSellCommand(
            USER_ID,
            sellParams(1 + Math.floor(Math.random() * initial))
          )
        )
      );

      expect(state.held).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) Undo — ช่องโหว่เดียวกัน คนละ Flow (Audit ระบุให้ครอบด้วย)
// ═══════════════════════════════════════════════════════════════════════════

describe('undoLastTransaction — Race กับคำสั่งขาย', () => {
  test('🔒 ย้อน buy ขณะที่ยอดถูกขายไปหมดแล้ว (Race) → CANNOT_UNDO_QUANTITY_MISMATCH ไม่ใช่ 500', async () => {
    // Pre-check ใน undo เห็นยอด 10 (Stale) แต่ DB จริงเหลือ 0 แล้ว
    state.held = 0;
    transactionRepository.findRecentByUser.mockResolvedValue([
      { id: 'tx-buy', assetId: ASSET_ID, type: 'buy', quantity: 10, amountThb: 1000, pricePerUnit: 100, currency: 'THB', note: null },
    ]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-buy', type: 'buy', quantity: 10, currency: 'THB' },
    ]);

    await expect(undoService.undoLastTransaction(USER_ID)).rejects.toMatchObject({
      code: 'CANNOT_UNDO_QUANTITY_MISMATCH',
    });
    expect(state.held).toBe(0);
    expect(state.rows).toHaveLength(0);
  });

  test('ย้อน buy ตามปกติ (ยอดพอ) → สร้าง Reversal สำเร็จ ยอดลดถูกต้อง', async () => {
    state.held = 10;
    transactionRepository.findRecentByUser.mockResolvedValue([
      { id: 'tx-buy', assetId: ASSET_ID, type: 'buy', quantity: 10, amountThb: 1000, pricePerUnit: 100, currency: 'THB', note: null },
    ]);
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-buy', type: 'buy', quantity: 10, currency: 'THB' },
    ]);

    const result = await undoService.undoLastTransaction(USER_ID);
    expect(result.reversalType).toBe('sell');
    expect(state.held).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) ทุก Path เขียน Ledger ผ่าน RPC จริง (ไม่มีใครแอบ .insert() ตรง)
// ═══════════════════════════════════════════════════════════════════════════

describe('ทุก Path เขียน Ledger ผ่าน create_transaction_locked เท่านั้น', () => {
  test('processBuyCommand → เรียก RPC (ไม่ใช่ .insert ตรง) และได้ Lock เหมือนกัน', async () => {
    transactionRepository.findAllByAsset.mockResolvedValue([]);
    assetRepository.findAllActiveByUser = jest.fn().mockResolvedValue([]);

    await transactionService.processBuyCommand(USER_ID, {
      symbol: 'BTC',
      quantity: 5,
      pricePerUnit: 100,
      type: 'crypto',
    });

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_transaction_locked',
      expect.objectContaining({ p_type: 'buy', p_quantity: 5 })
    );
    expect(state.held).toBe(5);
  });

  test('processSellCommand → เรียก RPC ด้วย Argument ครบทุกตัวที่ Function ต้องใช้', async () => {
    state.held = 10;
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-seed', type: 'buy', quantity: 10, currency: 'THB' },
    ]);

    await transactionService.processSellCommand(USER_ID, sellParams(3));

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_transaction_locked',
      expect.objectContaining({
        p_user_id: USER_ID,
        p_asset_id: ASSET_ID,
        p_type: 'sell',
        p_quantity: 3,
        p_currency: 'THB',
      })
    );
  });

  test('remainingQuantity มาจาก held_after ของ RPC (ยอดหลัง Lock จริง) ไม่ใช่คำนวณเองจาก Snapshot', async () => {
    state.held = 10;
    // Snapshot ที่ Service อ่านได้บอกว่ามี 10 → ถ้าคำนวณเองจะได้ 10-3=7
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-seed', type: 'buy', quantity: 10, currency: 'THB' },
    ]);
    // แต่ DB จริงมี 8 (มีคนขายไป 2 ระหว่างนั้น) → ยอดที่ถูกต้องคือ 8-3=5
    state.held = 8;

    const result = await transactionService.processSellCommand(USER_ID, sellParams(3));

    expect(result.remainingQuantity).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) Error Contract เดิมต้องไม่เปลี่ยน (Regression)
// ═══════════════════════════════════════════════════════════════════════════

describe('Error Contract — Caller เดิมต้องไม่รู้ว่าถูกปฏิเสธจากด่านไหน', () => {
  test('Error จาก RPC เป็น TransactionServiceError จริง (เว็บใช้ instanceof)', async () => {
    state.held = 0;
    // Pre-check เห็นยอด 10 (Stale) จึงปล่อยผ่านไปถึง RPC
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-seed', type: 'buy', quantity: 10, currency: 'THB' },
    ]);

    await expect(
      transactionService.processSellCommand(USER_ID, sellParams(10))
    ).rejects.toBeInstanceOf(transactionService.TransactionServiceError);
  });

  test('details ใช้ยอดจริงจาก DB (ไม่ใช่ยอด Stale ที่ Pre-check อ่านมา)', async () => {
    state.held = 2;
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-seed', type: 'buy', quantity: 10, currency: 'THB' },
    ]);

    await expect(
      transactionService.processSellCommand(USER_ID, sellParams(10))
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_QUANTITY',
      details: { requested: 10, held: 2 },
    });
  });

  test('Error อื่นของ DB (ไม่ใช่เงื่อนไขธุรกิจ) ยังโยนต่อเป็น Error ทั่วไปเหมือนเดิม', async () => {
    state.held = 10;
    transactionRepository.findAllByAsset.mockResolvedValue([
      { id: 'tx-seed', type: 'buy', quantity: 10, currency: 'THB' },
    ]);
    supabaseAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection terminated', code: '08006' },
    });

    await expect(transactionService.processSellCommand(USER_ID, sellParams(1))).rejects.toThrow(
      /Failed to create transaction/
    );
  });
});
