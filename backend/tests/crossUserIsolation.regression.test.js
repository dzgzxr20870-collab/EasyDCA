// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — Cross-User Isolation (Security Audit, 9 ส.ค. 2026)
// ═══════════════════════════════════════════════════════════════════════════
// ที่มา: EasyDCA ใช้ Supabase ด้วย service_role key และ "ไม่ได้เปิด RLS" — Database
// ไม่ตรวจสิทธิ์ให้เลย ทุกการกันข้อมูลข้ามบัญชีอยู่ที่โค้ด Backend ล้วนๆ ถ้ามี Query
// ไหนลืมเงื่อนไข user_id แม้จุดเดียว ผู้ใช้เห็นข้อมูลคนอื่นได้ทันทีโดยไม่มีอะไรขวาง
//
// Audit พบว่าตาราง pending_transactions ถูกแตะด้วย `id`/`batch_id` ที่มาจาก LINE
// Postback (ค่าฝั่ง Client) โดยไม่เคยเทียบ user_id — ผู้ใช้ A ที่ถือ pendingId ของ B
// สั่ง "ยืนยัน" ธุรกรรมของ B ได้ (เขียนเข้า Ledger ของ B) และรายละเอียดธุรกรรมของ B
// (symbol / จำนวน / ยอดเงิน / ยอดคงเหลือในพอร์ต) ถูกตอบกลับไปในแชทของ A
//
// ── ทำไมต้อง Fake Supabase ที่ "บังคับ .eq() จริง" ─────────────────────────────
// ถ้า Mock Repository ทั้งชั้น (jest.mock) เทสต์จะพิสูจน์ได้แค่ว่า "โค้ดส่ง userId
// ลงไป" ไม่ได้พิสูจน์ว่า "Query กรอง user_id จริง" — Mock ที่เราเขียนเองจะเห็นด้วย
// กับ Fix ของเราเสมอ (Test หลอกแบบที่ AI_WORK_POLICY § 6 เตือนไว้: Assertion ที่
// ผ่านตลอดแม้บั๊กยังอยู่)
//
// ไฟล์นี้จึงใช้ Repository "ตัวจริง" ทับบน Fake ที่ Implement Semantics ของ
// PostgREST ตามจริง: ทุก .eq()/.gt()/.lt()/.neq() ถูกนำไปกรองแถวจริงในหน่วยความจำ
// ผลคือ **ถ้าถอด `.eq('user_id', userId)` ออกจาก Query ไหน เทสต์ในไฟล์นี้จะแดงทันที**
// (พิสูจน์ Red-Green จริงแล้ว — ดูผลใน Commit Message/รายงาน)
//
// ⚠️ ห้ามเปลี่ยน Fake ให้ "ยอมผ่าน" เพื่อให้เทสต์เขียว — Fake ตัวนี้คือสิ่งที่ทำให้
// เทสต์มีความหมาย ถ้า Fake ผิด Semantics ให้แก้ให้ตรง PostgREST มากขึ้นเท่านั้น
// ═══════════════════════════════════════════════════════════════════════════

// ── Fake Supabase (In-memory, บังคับ Filter ตามจริง — ดู tests/helpers) ─────
jest.mock('../src/config/supabase', () => {
  const { createClient } = require('./helpers/fakeSupabase');
  return { supabaseAdmin: createClient() };
});

jest.mock('../src/services/transaction.service');

const { tables, resetTables } = require('./helpers/fakeSupabase');

const pendingRepository = require('../src/repositories/pendingTransaction.repository');
const transactionService = require('../src/services/transaction.service');
const {
  confirmPending,
  cancelPending,
  confirmBatch,
  cancelBatch,
} = require('../src/services/pendingTransaction.service');

// ── ผู้ใช้ทดสอบ 2 คน ────────────────────────────────────────────────────────
const USER_A = 'user-a-attacker';
const USER_B = 'user-b-victim';

const FUTURE = '2099-01-01T00:00:00.000Z';

// ข้อมูลของ B ที่ "ห้ามหลุดแม้แต่ Field เดียว" — ค่าทุกตัวตั้งให้จำเพาะเจาะจงพอที่จะ
// ค้นเจอถ้ามันโผล่ไปอยู่ใน Response/Error ที่ A ได้รับ
const B_SECRETS = ['BTCSECRET', '13579.2468', '987654.321', 'batch-of-b'];

function seedBPending(overrides = {}) {
  const row = {
    id: 'pending-of-b',
    user_id: USER_B,
    portfolio_id: null,
    command_type: 'buy',
    asset_symbol: 'BTCSECRET',
    asset_name: 'Bitcoin ของ B',
    asset_type: 'crypto',
    quantity: '13579.2468',
    price_per_unit: '987654.321',
    amount_thb: '987654.321',
    currency: 'THB',
    fee_thb: 0,
    txn_date: '2026-08-01',
    batch_id: null,
    slip_token: null,
    proj_id: null,
    fund_class_name: null,
    status: 'pending',
    expires_at: FUTURE,
    resolved_at: null,
    transaction_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
  tables.pending_transactions.push(row);
  return row;
}

function bRow() {
  return tables.pending_transactions.find((r) => r.id === 'pending-of-b');
}

// ยืนยันว่าแถวของ B ยังไม่ถูกแตะเลย (สถานะ/เวลา resolve/transaction_id เดิมเป๊ะ)
function expectBUntouched() {
  expect(bRow()).toMatchObject({
    user_id: USER_B,
    status: 'pending',
    resolved_at: null,
    transaction_id: null,
  });
}

// ยืนยันว่าไม่มีข้อมูลของ B หลุดไปอยู่ในสิ่งที่ A ได้รับ (ตรวจทั้ง Object ที่คืน
// และข้อความ Error — รวม details ที่มักถูกลืมว่าเป็นช่องรั่ว)
function expectNoBDataLeaked(payload) {
  const serialised = JSON.stringify(payload ?? null);
  for (const secret of B_SECRETS) {
    expect(serialised).not.toContain(secret);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  resetTables({ pending_transactions: [] });
});

// ═════════════════════════════════════════════════════════════════════════
// 1) ชั้น Query — A ยิงด้วย id/batchId ของ B ทุกฟังก์ชันที่แตะแถวราย id
// ═════════════════════════════════════════════════════════════════════════
describe('ชั้น Repository — A ใช้ id ของ B ตรงๆ', () => {
  test('findByIdForUser: A ขอ pending ของ B → คืน null และไม่รั่ว Field ใดเลย', async () => {
    seedBPending();

    const result = await pendingRepository.findByIdForUser('pending-of-b', USER_A);

    expect(result).toBeNull();
    expectNoBDataLeaked(result);
    expectBUntouched();
  });

  test('claimForConfirm: A ยืนยันธุรกรรมของ B → Claim ไม่ได้ และแถวของ B ยัง pending', async () => {
    seedBPending();

    const claimed = await pendingRepository.claimForConfirm('pending-of-b', USER_A);

    expect(claimed).toBeNull();
    expectNoBDataLeaked(claimed);
    // ⚠️ ข้อสำคัญที่สุด: ธุรกรรมของ B ต้องไม่ถูกเปลี่ยนเป็น confirmed
    // (ถ้าหลุด = มีแถวเข้า Immutable Ledger ของ B ที่ B ไม่ได้สั่ง แก้คืนได้แค่ Reversal)
    expectBUntouched();
  });

  test('markCancelled: A ยกเลิกธุรกรรมของ B → ไม่สำเร็จ และแถวของ B ยัง pending', async () => {
    seedBPending();

    const cancelled = await pendingRepository.markCancelled('pending-of-b', USER_A);

    expect(cancelled).toBeNull();
    expectBUntouched();
  });

  test('markExpired: A บังคับ expire ธุรกรรมของ B → ไม่สำเร็จ', async () => {
    seedBPending();

    const expired = await pendingRepository.markExpired('pending-of-b', USER_A);

    expect(expired).toBeNull();
    expectBUntouched();
  });

  test('attachTransaction: A ผูก transaction_id เข้าแถวของ B → ไม่สำเร็จ', async () => {
    seedBPending();

    // .single() ของ PostgREST คืน Error เมื่อไม่ Match แถว → Repository throw
    await expect(
      pendingRepository.attachTransaction('pending-of-b', 'tx-of-a', USER_A)
    ).rejects.toThrow();

    expect(bRow().transaction_id).toBeNull();
  });

  test('findByBatchIdForUser: A ขอ Batch ของ B → คืน [] (ไม่ใช่แถวของ B)', async () => {
    seedBPending({ id: 'pending-of-b', batch_id: 'batch-of-b' });
    seedBPending({ id: 'pending-of-b-2', batch_id: 'batch-of-b', asset_symbol: 'BTCSECRET' });

    const rows = await pendingRepository.findByBatchIdForUser('batch-of-b', USER_A);

    expect(rows).toEqual([]);
    expectNoBDataLeaked(rows);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2) Positive Control — B ต้องทำของตัวเองได้ปกติ
// ═════════════════════════════════════════════════════════════════════════
// ถ้าไม่มีชุดนี้ เทสต์ด้านบนอาจเขียวเพราะ "พังหมดทุกคน" ไม่ใช่เพราะกันข้ามบัญชีถูก
describe('Positive Control — B ทำของตัวเองได้ (เทสต์ไม่ได้เขียวเพราะพังหมด)', () => {
  test('B ยืนยันธุรกรรมของตัวเอง → Claim สำเร็จ, สถานะเป็น confirmed', async () => {
    seedBPending();

    const claimed = await pendingRepository.claimForConfirm('pending-of-b', USER_B);

    expect(claimed).toMatchObject({ id: 'pending-of-b', userId: USER_B });
    expect(bRow().status).toBe('confirmed');
  });

  test('B ดึง pending ของตัวเองได้ครบ Field', async () => {
    seedBPending();

    const row = await pendingRepository.findByIdForUser('pending-of-b', USER_B);

    expect(row).toMatchObject({ id: 'pending-of-b', assetSymbol: 'BTCSECRET', userId: USER_B });
  });

  test('B ดึง Batch ของตัวเองได้', async () => {
    seedBPending({ id: 'pending-of-b', batch_id: 'batch-of-b' });

    const rows = await pendingRepository.findByBatchIdForUser('batch-of-b', USER_B);

    expect(rows).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3) ชั้น Service — A เรียกทุกทางเข้าที่ Postback ใช้ ด้วย id ของ B
// ═════════════════════════════════════════════════════════════════════════
describe('ชั้น Service — A เรียกด้วย id/batchId ของ B', () => {
  test('confirmPending: ได้ PENDING_NOT_FOUND (เหมือนกรณี id ไม่มีจริง) และไม่เขียน Ledger เลย', async () => {
    seedBPending();

    const err = await confirmPending('pending-of-b', USER_A).catch((e) => e);

    expect(err).toMatchObject({ code: 'PENDING_NOT_FOUND' });
    // ต้องไม่บอกใบ้ว่า id นี้มีอยู่จริงและเป็นของใคร + ห้ามรั่วข้อมูล B ผ่าน details
    expectNoBDataLeaked({ message: err.message, details: err.details });
    // ห้ามแตะ Ledger แม้แต่ครั้งเดียว (ทั้งของ A และของ B)
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
    expect(transactionService.processSellCommand).not.toHaveBeenCalled();
    expectBUntouched();
  });

  test('cancelPending: ได้ PENDING_NOT_FOUND และธุรกรรมของ B ยังอยู่', async () => {
    seedBPending();

    const err = await cancelPending('pending-of-b', USER_A).catch((e) => e);

    expect(err).toMatchObject({ code: 'PENDING_NOT_FOUND' });
    expectNoBDataLeaked({ message: err.message, details: err.details });
    expectBUntouched();
  });

  test('confirmBatch: ได้ BATCH_NOT_FOUND และไม่เขียน Ledger เลย', async () => {
    seedBPending({ id: 'pending-of-b', batch_id: 'batch-of-b' });

    const err = await confirmBatch('batch-of-b', USER_A).catch((e) => e);

    expect(err).toMatchObject({ code: 'BATCH_NOT_FOUND' });
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
    expectBUntouched();
  });

  test('cancelBatch: ได้ BATCH_NOT_FOUND และ Batch ของ B ยังไม่ถูกยกเลิก', async () => {
    seedBPending({ id: 'pending-of-b', batch_id: 'batch-of-b' });

    const err = await cancelBatch('batch-of-b', USER_A).catch((e) => e);

    expect(err).toMatchObject({ code: 'BATCH_NOT_FOUND' });
    expectBUntouched();
  });

  test('A ยืนยัน Batch ผสม (มีทั้งของ A และของ B) → ทำเฉพาะของ A, ของ B ไม่ถูกแตะ', async () => {
    // เคสร้ายที่สุด: batch_id เดียวกันแต่คนละเจ้าของ (ถ้า Query กรองแค่ batch_id
    // จะกวาดของ B มาทำด้วย) — ต้องได้เฉพาะแถวของ A เท่านั้น
    seedBPending({ id: 'pending-of-b', batch_id: 'shared-batch' });
    tables.pending_transactions.push({
      id: 'pending-of-a',
      user_id: USER_A,
      command_type: 'buy',
      asset_symbol: 'ETH',
      asset_name: 'Ethereum',
      asset_type: 'crypto',
      quantity: '1',
      price_per_unit: '100',
      amount_thb: '100',
      currency: 'THB',
      fee_thb: 0,
      txn_date: '2026-08-01',
      batch_id: 'shared-batch',
      status: 'pending',
      expires_at: FUTURE,
      resolved_at: null,
      transaction_id: null,
      portfolio_id: null,
    });
    transactionService.processBuyCommand.mockResolvedValue({ transactionId: 'tx-a', symbol: 'ETH' });

    const result = await confirmBatch('shared-batch', USER_A);

    expect(result.total).toBe(1);
    expect(transactionService.processBuyCommand).toHaveBeenCalledTimes(1);
    // เขียน Ledger ในนามของ A เท่านั้น ไม่ใช่ของ B
    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      USER_A,
      expect.anything(),
      expect.anything()
    );
    expectBUntouched();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4) ไม่มี userId เลย (ไม่ได้ Auth / ลืมส่ง) → ต้องพัง ห้ามดึงทั้งหมด
// ═════════════════════════════════════════════════════════════════════════
// นี่คือรูปแบบความผิดพลาดที่อันตรายที่สุดของงานนี้: "ไม่มี userId = ดึงทั้งหมด"
describe('ไม่มี userId → ต้อง throw ห้าม Fallback เป็นดึงทั้งหมด', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
  ])('confirmPending ด้วย userId = %s → throw MISSING_USER_ID ไม่แตะข้อมูลใคร', async (_l, bad) => {
    seedBPending();

    await expect(confirmPending('pending-of-b', bad)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
    expectBUntouched();
  });

  test('cancelPending ไม่มี userId → throw MISSING_USER_ID', async () => {
    seedBPending();

    await expect(cancelPending('pending-of-b', undefined)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
    expectBUntouched();
  });

  test('confirmBatch ไม่มี userId → throw MISSING_USER_ID (ไม่ใช่กวาดทุก Batch)', async () => {
    seedBPending({ id: 'pending-of-b', batch_id: 'batch-of-b' });

    await expect(confirmBatch('batch-of-b', undefined)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
    expectBUntouched();
  });
});
