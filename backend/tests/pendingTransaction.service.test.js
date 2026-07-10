jest.mock('../src/repositories/pendingTransaction.repository');
jest.mock('../src/services/transaction.service');

const pendingRepository = require('../src/repositories/pendingTransaction.repository');
const transactionService = require('../src/services/transaction.service');
const commandParser = require('../src/services/commandParser.service');
const {
  createPending,
  confirmPending,
  cancelPending,
  expireOverduePending,
  purgeOldPending,
  createBatch,
  confirmBatch,
  cancelBatch,
  PendingTransactionError,
} = require('../src/services/pendingTransaction.service');

const { COMMANDS } = commandParser;
const USER_ID = 'user-uuid-1';
const PENDING_ID = 'pending-uuid-1';

beforeEach(() => {
  jest.clearAllMocks();
  transactionService.todayInBangkok.mockReturnValue('2026-07-02');
  pendingRepository.create.mockImplementation(async (data) => ({ id: PENDING_ID, ...data }));
});

describe('createPending — BUY', () => {
  test('Asset ใหม่ → เก็บ asset_type ที่ได้จาก validateBuy', async () => {
    transactionService.validateBuy.mockResolvedValue({
      asset: null,
      assetType: 'crypto',
      newAsset: true,
      amounts: { quantity: 0.01, pricePerUnit: 3400000, amountThb: 34000, priceSource: 'user' },
    });

    const parsed = {
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'crypto' },
    };
    const pending = await createPending(USER_ID, parsed, { plan: 'free' });

    expect(transactionService.validateBuy).toHaveBeenCalledWith(USER_ID, parsed.params, {
      plan: 'free',
    });
    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        commandType: 'buy',
        assetSymbol: 'BTC',
        assetType: 'crypto',
        quantity: 0.01,
        pricePerUnit: 3400000,
        amountThb: 34000,
        txnDate: '2026-07-02',
      })
    );
    // priceSource ไม่มี Column รองรับใน pending_transactions — ต้องไม่ถูกส่งเข้า
    // Insert Payload ของ Repository เลย (Enrich กลับเข้า Object คืนค่าเท่านั้น)
    expect(pendingRepository.create.mock.calls[0][0]).not.toHaveProperty('priceSource');
    // Controller ต้องได้ priceSource ติดมากับ Object ที่คืน เพื่อสร้าง Preview Message
    expect(pending).toMatchObject({ id: PENDING_ID, priceSource: 'user' });
  });

  test('ทอง (Phase 3 Round 7) → goldUsd จาก amounts Enrich เข้า Object ที่คืน (ไม่ Persist ลง DB)', async () => {
    transactionService.validateBuy.mockResolvedValue({
      asset: { id: 'a-gold', type: 'gold_bar' },
      assetType: 'gold_bar',
      newAsset: false,
      amounts: {
        quantity: 1,
        pricePerUnit: 71150,
        amountThb: 71150,
        priceSource: 'thaigold',
        goldUsd: { usdThbRate: 35, pricePerUnitUsd: 2032.86 },
      },
    });

    const pending = await createPending(USER_ID, {
      command: COMMANDS.BUY,
      params: { symbol: 'GOLD', amountThb: 71150 },
    });

    // goldUsd ไม่ถูกส่งเข้า Insert Payload (ไม่มี Column) แต่ติดกลับมาใน Object ที่คืน
    expect(pendingRepository.create.mock.calls[0][0]).not.toHaveProperty('goldUsd');
    expect(pending).toMatchObject({
      id: PENDING_ID,
      priceSource: 'thaigold',
      goldUsd: { usdThbRate: 35, pricePerUnitUsd: 2032.86 },
    });
  });

  test('สินทรัพย์ปกติ (ไม่มี goldUsd ใน amounts) → goldUsd = null ใน Object ที่คืน', async () => {
    transactionService.validateBuy.mockResolvedValue({
      asset: { id: 'a-ptt', type: 'stock_th' },
      assetType: 'stock_th',
      newAsset: false,
      amounts: { quantity: 50, pricePerUnit: 34, amountThb: 1700, priceSource: 'user' },
    });

    const pending = await createPending(USER_ID, {
      command: COMMANDS.BUY,
      params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
    });

    expect(pending.goldUsd).toBeNull();
  });

  test('BUY ด้วย amountThb (Price Feed) → priceSource "coingecko" Enrich เข้า Object ที่คืน ไม่ Persist ลง DB', async () => {
    transactionService.validateBuy.mockResolvedValue({
      asset: { id: 'a-btc', type: 'crypto' },
      assetType: 'crypto',
      newAsset: false,
      amounts: { quantity: 0.0005, pricePerUnit: 2000000, amountThb: 1000, priceSource: 'coingecko' },
    });

    const pending = await createPending(USER_ID, {
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', amountThb: 1000 },
    });

    expect(pendingRepository.create.mock.calls[0][0]).not.toHaveProperty('priceSource');
    expect(pending).toMatchObject({ id: PENDING_ID, priceSource: 'coingecko' });
  });

  test('Asset เดิม → asset_type = null (รู้ type ตอน Confirm อยู่แล้ว)', async () => {
    transactionService.validateBuy.mockResolvedValue({
      asset: { id: 'a-ptt', type: 'stock_th' },
      assetType: 'stock_th',
      newAsset: false,
      amounts: { quantity: 50, pricePerUnit: 34, amountThb: 1700 },
    });

    await createPending(USER_ID, {
      command: COMMANDS.BUY,
      params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
    });

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'buy', assetSymbol: 'PTT', assetType: null })
    );
  });

  test('validateBuy throw (ASSET_LIMIT_REACHED) → ไม่สร้าง Pending, โยน Error ต่อ', async () => {
    const err = new Error('limit');
    err.code = 'ASSET_LIMIT_REACHED';
    transactionService.validateBuy.mockRejectedValue(err);

    await expect(
      createPending(USER_ID, {
        command: COMMANDS.BUY,
        params: { symbol: 'ETH', quantity: 1, pricePerUnit: 1000, type: 'crypto' },
      })
    ).rejects.toMatchObject({ code: 'ASSET_LIMIT_REACHED' });

    expect(pendingRepository.create).not.toHaveBeenCalled();
  });
});

describe('createPending — SELL', () => {
  test('เก็บ commandType = sell, asset_type = null', async () => {
    transactionService.validateSell.mockResolvedValue({
      asset: { id: 'a-ptt' },
      amounts: { quantity: 10, pricePerUnit: 40, amountThb: 400 },
      heldQuantity: 40,
    });

    await createPending(USER_ID, {
      command: COMMANDS.SELL,
      params: { symbol: 'PTT', quantity: 10, pricePerUnit: 40 },
    });

    expect(transactionService.validateSell).toHaveBeenCalledWith(USER_ID, {
      symbol: 'PTT',
      quantity: 10,
      pricePerUnit: 40,
    });
    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'sell', assetSymbol: 'PTT', assetType: null, amountThb: 400 })
    );
  });
});

describe('createPending — คำสั่งที่ไม่รองรับ', () => {
  test('PORTFOLIO → UNSUPPORTED_COMMAND, ไม่แตะ validate/repo', async () => {
    await expect(
      createPending(USER_ID, { command: COMMANDS.PORTFOLIO, params: {} })
    ).rejects.toBeInstanceOf(PendingTransactionError);

    expect(transactionService.validateBuy).not.toHaveBeenCalled();
    expect(transactionService.validateSell).not.toHaveBeenCalled();
    expect(pendingRepository.create).not.toHaveBeenCalled();
  });
});

describe('confirmPending — สำเร็จ', () => {
  test('BUY → Execute processBuyCommand แล้วผูก transaction_id', async () => {
    pendingRepository.claimForConfirm.mockResolvedValue({
      id: PENDING_ID,
      userId: USER_ID,
      commandType: 'buy',
      assetSymbol: 'BTC',
      assetType: 'crypto',
      quantity: 0.01,
      pricePerUnit: 3400000,
      feeThb: 0,
      txnDate: '2026-07-02',
      portfolioId: null,
    });
    transactionService.processBuyCommand.mockResolvedValue({
      transactionId: 'tx-1',
      symbol: 'BTC',
      priceSource: 'user',
    });

    const out = await confirmPending(PENDING_ID, { plan: 'free' });

    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'crypto', date: '2026-07-02' }),
      { plan: 'free' }
    );
    expect(pendingRepository.attachTransaction).toHaveBeenCalledWith(PENDING_ID, 'tx-1');
    // priceSource มาจาก result ของ processBuyCommand โดยตรง (คำนวณใหม่ตอน Commit)
    // ไม่ได้อ่านจาก Pending record ใน DB
    expect(out).toMatchObject({ commandType: 'buy', result: { transactionId: 'tx-1', priceSource: 'user' } });
  });

  test('SELL → Execute processSellCommand', async () => {
    pendingRepository.claimForConfirm.mockResolvedValue({
      id: PENDING_ID,
      userId: USER_ID,
      commandType: 'sell',
      assetSymbol: 'PTT',
      assetType: null,
      quantity: 10,
      pricePerUnit: 40,
      feeThb: 0,
      txnDate: '2026-07-02',
      portfolioId: null,
    });
    transactionService.processSellCommand.mockResolvedValue({ transactionId: 'tx-2' });

    await confirmPending(PENDING_ID);

    expect(transactionService.processSellCommand).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ symbol: 'PTT', quantity: 10, pricePerUnit: 40 })
    );
    expect(pendingRepository.attachTransaction).toHaveBeenCalledWith(PENDING_ID, 'tx-2');
  });
});

describe('confirmPending — Claim ไม่ได้', () => {
  test('ไม่พบ Pending (ถูก Purge/ไม่มีจริง) → PENDING_NOT_FOUND', async () => {
    pendingRepository.claimForConfirm.mockResolvedValue(null);
    pendingRepository.findById.mockResolvedValue(null);

    await expect(confirmPending(PENDING_ID)).rejects.toMatchObject({ code: 'PENDING_NOT_FOUND' });
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
  });

  test('ยัง pending แต่ Claim ไม่ได้ = หมดอายุ → markExpired + PENDING_EXPIRED', async () => {
    pendingRepository.claimForConfirm.mockResolvedValue(null);
    pendingRepository.findById.mockResolvedValue({ id: PENDING_ID, status: 'pending' });

    await expect(confirmPending(PENDING_ID)).rejects.toMatchObject({ code: 'PENDING_EXPIRED' });
    expect(pendingRepository.markExpired).toHaveBeenCalledWith(PENDING_ID);
  });

  test('resolve ไปแล้ว (กดยืนยันซ้ำ) → PENDING_ALREADY_RESOLVED พร้อม status เดิม', async () => {
    pendingRepository.claimForConfirm.mockResolvedValue(null);
    pendingRepository.findById.mockResolvedValue({ id: PENDING_ID, status: 'confirmed' });

    await expect(confirmPending(PENDING_ID)).rejects.toMatchObject({
      code: 'PENDING_ALREADY_RESOLVED',
      details: { status: 'confirmed' },
    });
    expect(pendingRepository.markExpired).not.toHaveBeenCalled();
  });
});

describe('confirmPending — Execute ล้มเหลวหลัง Claim', () => {
  test('processSellCommand throw (INSUFFICIENT) → โยน Error ต่อ, ไม่ผูก transaction_id', async () => {
    pendingRepository.claimForConfirm.mockResolvedValue({
      id: PENDING_ID,
      userId: USER_ID,
      commandType: 'sell',
      assetSymbol: 'PTT',
      quantity: 999,
      pricePerUnit: 40,
      feeThb: 0,
      txnDate: '2026-07-02',
      portfolioId: null,
    });
    const err = new Error('insufficient');
    err.code = 'INSUFFICIENT_QUANTITY';
    transactionService.processSellCommand.mockRejectedValue(err);

    await expect(confirmPending(PENDING_ID)).rejects.toMatchObject({ code: 'INSUFFICIENT_QUANTITY' });
    expect(pendingRepository.attachTransaction).not.toHaveBeenCalled();
  });
});

describe('confirmPending — attachTransaction พังหลัง Commit (GAP)', () => {
  test('Transaction ถูกสร้างสำเร็จแล้วแต่ attachTransaction throw → ยังคืน result สำเร็จ (ไม่ Retry)', async () => {
    pendingRepository.claimForConfirm.mockResolvedValue({
      id: PENDING_ID,
      userId: USER_ID,
      commandType: 'buy',
      assetSymbol: 'PTT',
      assetType: 'stock_th',
      quantity: 50,
      pricePerUnit: 34,
      feeThb: 0,
      txnDate: '2026-07-02',
      portfolioId: null,
    });
    // Transaction จริงสำเร็จ (Source of Truth บันทึกแล้ว)
    transactionService.processBuyCommand.mockResolvedValue({ transactionId: 'tx-1', symbol: 'PTT' });
    // แต่การผูก transaction_id กลับเข้า pending พัง (เช่น Network Error)
    pendingRepository.attachTransaction.mockRejectedValue(new Error('network down'));

    // ต้องไม่ throw — ผู้ใช้ต้องเห็นว่าสำเร็จเพราะ Transaction เกิดขึ้นจริงแล้ว
    const out = await confirmPending(PENDING_ID, { plan: 'free' });

    expect(out).toMatchObject({ commandType: 'buy', result: { transactionId: 'tx-1' } });
    // processBuyCommand ถูกเรียกครั้งเดียว — ไม่ Retry สร้าง Transaction ซ้ำ
    expect(transactionService.processBuyCommand).toHaveBeenCalledTimes(1);
  });
});

describe('cancelPending', () => {
  test('ยกเลิกสำเร็จ (ยัง pending) → คืน record', async () => {
    pendingRepository.markCancelled.mockResolvedValue({ id: PENDING_ID, status: 'cancelled' });

    const out = await cancelPending(PENDING_ID);

    expect(out).toMatchObject({ status: 'cancelled' });
  });

  test('ไม่พบ Pending → PENDING_NOT_FOUND', async () => {
    pendingRepository.markCancelled.mockResolvedValue(null);
    pendingRepository.findById.mockResolvedValue(null);

    await expect(cancelPending(PENDING_ID)).rejects.toMatchObject({ code: 'PENDING_NOT_FOUND' });
  });

  test('resolve ไปแล้ว → PENDING_ALREADY_RESOLVED', async () => {
    pendingRepository.markCancelled.mockResolvedValue(null);
    pendingRepository.findById.mockResolvedValue({ id: PENDING_ID, status: 'confirmed' });

    await expect(cancelPending(PENDING_ID)).rejects.toMatchObject({
      code: 'PENDING_ALREADY_RESOLVED',
      details: { status: 'confirmed' },
    });
  });
});

describe('Cron helpers', () => {
  test('expireOverduePending → ส่งต่อจำนวนจาก repository', async () => {
    pendingRepository.expireOverdue.mockResolvedValue(3);
    await expect(expireOverduePending()).resolves.toBe(3);
  });

  test('purgeOldPending → เรียก purgeResolvedBefore ด้วย cutoff ก่อนหน้าปัจจุบัน', async () => {
    pendingRepository.purgeResolvedBefore.mockResolvedValue(5);

    const before = Date.now();
    const count = await purgeOldPending(24);

    expect(count).toBe(5);
    expect(pendingRepository.purgeResolvedBefore).toHaveBeenCalledTimes(1);
    const cutoffIso = pendingRepository.purgeResolvedBefore.mock.calls[0][0];
    const cutoffMs = new Date(cutoffIso).getTime();
    // cutoff ต้องอยู่ราว 24 ชม. ก่อนหน้า (น้อยกว่าเวลาปัจจุบันแน่นอน)
    expect(cutoffMs).toBeLessThan(before);
    expect(before - cutoffMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5000);
  });
});

describe('createBatch (Phase 3 Round 6 — Bulk Import)', () => {
  test('Insert หลายแถวพร้อมกัน ผูก batch_id เดียวกันทุกแถว (commandType เสมอ = buy)', async () => {
    const validatedItems = [
      {
        params: { symbol: 'BTC', date: '2026-07-10' },
        amounts: { quantity: 0.5, pricePerUnit: 1500000, amountThb: 750000, priceSource: 'user' },
        assetType: 'crypto',
      },
      {
        params: { symbol: 'ETH', date: '2026-03-01' },
        amounts: { quantity: 2, pricePerUnit: 80000, amountThb: 160000, priceSource: 'user' },
        assetType: null,
      },
    ];

    const result = await createBatch(USER_ID, validatedItems);

    expect(pendingRepository.create).toHaveBeenCalledTimes(2);
    const [call1, call2] = pendingRepository.create.mock.calls;
    expect(call1[0]).toMatchObject({
      userId: USER_ID,
      commandType: 'buy',
      assetSymbol: 'BTC',
      assetType: 'crypto',
      quantity: 0.5,
      txnDate: '2026-07-10',
      batchId: result.batchId,
    });
    expect(call2[0]).toMatchObject({
      assetSymbol: 'ETH',
      assetType: null,
      txnDate: '2026-03-01',
      batchId: result.batchId,
    });
    // ทั้งสองแถวใช้ batch_id เดียวกัน
    expect(call1[0].batchId).toBe(call2[0].batchId);
    expect(result.pendings).toHaveLength(2);
  });

  test('ไม่ระบุวันที่ในบรรทัด → ใช้ todayInBangkok() ของ transactionService (Reuse เดิม)', async () => {
    await createBatch(USER_ID, [
      {
        params: { symbol: 'BTC' },
        amounts: { quantity: 1, pricePerUnit: 100, amountThb: 100 },
        assetType: 'crypto',
      },
    ]);

    expect(pendingRepository.create.mock.calls[0][0].txnDate).toBe('2026-07-02');
  });
});

describe('confirmBatch (Phase 3 Round 6 — Best-effort)', () => {
  const BATCH_ID = 'batch-uuid-1';

  test('ทุกแถวสำเร็จ → succeeded ครบ, failed ว่าง', async () => {
    pendingRepository.findByBatchId.mockResolvedValue([
      { id: 'p1', assetSymbol: 'BTC', status: 'pending', commandType: 'buy' },
      { id: 'p2', assetSymbol: 'ETH', status: 'pending', commandType: 'buy' },
    ]);
    pendingRepository.claimForConfirm.mockImplementation(async (id) => ({
      id,
      commandType: 'buy',
      userId: USER_ID,
      assetSymbol: id === 'p1' ? 'BTC' : 'ETH',
      quantity: 1,
      pricePerUnit: 100,
      feeThb: 0,
      txnDate: '2026-07-10',
      portfolioId: null,
    }));
    transactionService.processBuyCommand.mockResolvedValue({ transactionId: 'tx-x', symbol: 'BTC' });

    const result = await confirmBatch(BATCH_ID);

    expect(pendingRepository.findByBatchId).toHaveBeenCalledWith(BATCH_ID);
    expect(result.total).toBe(2);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toEqual([]);
  });

  test('1 แถวล้มเหลว (DB Error ชั่วคราว) → แถวอื่นยังสำเร็จต่อ ไม่หยุดทั้ง Batch', async () => {
    pendingRepository.findByBatchId.mockResolvedValue([
      { id: 'p1', assetSymbol: 'BTC', status: 'pending', commandType: 'buy' },
      { id: 'p2', assetSymbol: 'ETH', status: 'pending', commandType: 'buy' },
    ]);
    pendingRepository.claimForConfirm.mockImplementation(async (id) => ({
      id,
      commandType: 'buy',
      userId: USER_ID,
      assetSymbol: id === 'p1' ? 'BTC' : 'ETH',
      quantity: 1,
      pricePerUnit: 100,
      feeThb: 0,
      txnDate: '2026-07-10',
      portfolioId: null,
    }));
    transactionService.processBuyCommand
      .mockRejectedValueOnce(Object.assign(new Error('db blip'), { code: 'INTERNAL_ERROR' }))
      .mockResolvedValueOnce({ transactionId: 'tx-2', symbol: 'ETH' });

    const result = await confirmBatch(BATCH_ID);

    expect(result.total).toBe(2);
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toEqual([{ symbol: 'BTC', code: 'INTERNAL_ERROR', message: 'db blip' }]);
  });

  test('batchId ไม่พบแถวใดเลย → throw BATCH_NOT_FOUND', async () => {
    pendingRepository.findByBatchId.mockResolvedValue([]);

    await expect(confirmBatch(BATCH_ID)).rejects.toMatchObject({ code: 'BATCH_NOT_FOUND' });
  });

  // ── Bug Fix: confirmBatch ต้อง Thread options (plan/planExpiresAt) ให้ทุกแถว ──
  // ก่อนแก้: confirmBatch(batchId) ไม่รับ options เลย → confirmPending(row.id) ทุกแถว
  // ได้ options={} (Default) → transactionService เห็น plan ว่างเสมอ → Fallback
  // เป็น 'free' (Fail-closed Default ของ validateBuy) ทำให้ Premium โดนเช็ค Asset
  // Limit เป็น Free ผิดๆ ตอน Confirm (ทั้งที่ Preview ผ่านเพราะ previewBatch ส่ง
  // options ถูกทางอยู่แล้ว คนละ Call Chain กัน) — จำลอง Business Rule จริงด้วย
  // processBuyCommand Mock ที่เช็ค options.plan เอง (transactionService ถูก Mock
  // ทั้งไฟล์อยู่แล้วในเทสต์นี้ จึงต้องจำลองพฤติกรรม validateBuy ตรงนี้)
  describe('Bug Fix: Thread options ให้ทุกแถวใน Batch (ไม่ใช่แค่แถวแรก)', () => {
    const ROWS = [
      { id: 'p1', assetSymbol: 'BTC', status: 'pending', commandType: 'buy' },
      { id: 'p2', assetSymbol: 'ETH', status: 'pending', commandType: 'buy' },
      { id: 'p3', assetSymbol: 'MSFT', status: 'pending', commandType: 'buy' },
    ];

    beforeEach(() => {
      pendingRepository.findByBatchId.mockResolvedValue(ROWS);
      pendingRepository.claimForConfirm.mockImplementation(async (id) => ({
        id,
        commandType: 'buy',
        userId: USER_ID,
        assetSymbol: ROWS.find((r) => r.id === id).assetSymbol,
        quantity: 1,
        pricePerUnit: 100,
        feeThb: 0,
        txnDate: '2026-07-10',
        portfolioId: null,
      }));
      // จำลอง validateBuy จริง: Reject ด้วย ASSET_LIMIT_REACHED ถ้า options.plan
      // ไม่ใช่ 'premium' (คือพฤติกรรมจริงของ Free Plan ที่ Asset ใหม่เกิน 2 ตัว)
      transactionService.processBuyCommand.mockImplementation(async (userId, params, options) => {
        if (options?.plan !== 'premium') {
          const err = new Error('Free plan is limited to 2 active assets');
          err.code = 'ASSET_LIMIT_REACHED';
          throw err;
        }
        return { transactionId: `tx-${params.symbol}`, symbol: params.symbol };
      });
    });

    test('Premium (options.plan=premium ส่งเข้ามาจริง) + 3 Asset ใหม่ → สำเร็จหมด ไม่โดน ASSET_LIMIT_REACHED', async () => {
      const result = await confirmBatch(BATCH_ID, {
        plan: 'premium',
        planExpiresAt: '2026-08-04T00:00:00.000Z',
      });

      expect(result.total).toBe(3);
      expect(result.succeeded).toHaveLength(3);
      expect(result.failed).toEqual([]);

      // ยืนยันว่า options ถูกส่งถึง processBuyCommand ของ "ทุกแถว" ไม่ใช่แค่แถวแรก
      expect(transactionService.processBuyCommand).toHaveBeenCalledTimes(3);
      transactionService.processBuyCommand.mock.calls.forEach((call) => {
        expect(call[2]).toEqual({ plan: 'premium', planExpiresAt: '2026-08-04T00:00:00.000Z' });
      });
    });

    test('Free plan (Regression) → ยังโดน ASSET_LIMIT_REACHED เหมือนเดิม ไม่ใช่ผ่านหมดเพราะแก้บั๊กผิดจุด', async () => {
      const result = await confirmBatch(BATCH_ID, { plan: 'free', planExpiresAt: null });

      expect(result.total).toBe(3);
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toEqual([
        { symbol: 'BTC', code: 'ASSET_LIMIT_REACHED', message: 'Free plan is limited to 2 active assets' },
        { symbol: 'ETH', code: 'ASSET_LIMIT_REACHED', message: 'Free plan is limited to 2 active assets' },
        { symbol: 'MSFT', code: 'ASSET_LIMIT_REACHED', message: 'Free plan is limited to 2 active assets' },
      ]);
    });

    test('ไม่ส่ง options มาเลย (Caller เก่า/ลืมส่ง) → Default {} → เห็นเหมือน Free ทุกแถว (ยืนยัน Fail-closed Default เดิมยังทำงาน)', async () => {
      const result = await confirmBatch(BATCH_ID);

      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(3);
      transactionService.processBuyCommand.mock.calls.forEach((call) => {
        expect(call[2]).toEqual({});
      });
    });
  });
});

describe('cancelBatch (Phase 3 Round 6)', () => {
  const BATCH_ID = 'batch-uuid-1';

  test('ยกเลิกทุกแถวในก้อน → cancelled ครบ, ไม่บันทึกอะไรลงพอร์ต', async () => {
    pendingRepository.findByBatchId.mockResolvedValue([
      { id: 'p1', status: 'pending' },
      { id: 'p2', status: 'pending' },
    ]);
    pendingRepository.markCancelled.mockResolvedValue({ status: 'cancelled' });

    const result = await cancelBatch(BATCH_ID);

    expect(pendingRepository.markCancelled).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ total: 2, cancelled: 2, failed: [] });
    expect(transactionService.processBuyCommand).not.toHaveBeenCalled();
  });

  test('batchId ไม่พบแถวใดเลย → throw BATCH_NOT_FOUND', async () => {
    pendingRepository.findByBatchId.mockResolvedValue([]);
    await expect(cancelBatch(BATCH_ID)).rejects.toMatchObject({ code: 'BATCH_NOT_FOUND' });
  });
});
