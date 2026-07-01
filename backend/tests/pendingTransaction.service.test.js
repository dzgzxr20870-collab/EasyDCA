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
      amounts: { quantity: 0.01, pricePerUnit: 3400000, amountThb: 34000 },
    });

    const parsed = {
      command: COMMANDS.BUY,
      params: { symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'crypto' },
    };
    await createPending(USER_ID, parsed, { plan: 'free' });

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
    transactionService.processBuyCommand.mockResolvedValue({ transactionId: 'tx-1', symbol: 'BTC' });

    const out = await confirmPending(PENDING_ID, { plan: 'free' });

    expect(transactionService.processBuyCommand).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ symbol: 'BTC', quantity: 0.01, pricePerUnit: 3400000, type: 'crypto', date: '2026-07-02' }),
      { plan: 'free' }
    );
    expect(pendingRepository.attachTransaction).toHaveBeenCalledWith(PENDING_ID, 'tx-1');
    expect(out).toMatchObject({ commandType: 'buy', result: { transactionId: 'tx-1' } });
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
