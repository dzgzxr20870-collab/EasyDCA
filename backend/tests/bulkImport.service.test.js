jest.mock('../src/repositories/asset.repository');
jest.mock('../src/services/entitlement.service');
jest.mock('../src/services/symbolRegistry.service');
jest.mock('../src/services/transaction.service');
jest.mock('../src/services/pendingTransaction.service');
// คง parseBulkImportLines จริงไม่ได้ (ต้องคุมผลลัพธ์ให้ Deterministic เพื่อแยกทดสอบ
// เฉพาะ Logic ของ bulkImport.service เอง — parseBulkImportLines มี Test ของตัวเอง
// อยู่แล้วใน commandParser.test.js) Mock เฉพาะฟังก์ชันนี้
jest.mock('../src/services/commandParser.service', () => ({
  parseBulkImportLines: jest.fn(),
}));

const assetRepository = require('../src/repositories/asset.repository');
const entitlement = require('../src/services/entitlement.service');
const symbolRegistry = require('../src/services/symbolRegistry.service');
const transactionService = require('../src/services/transaction.service');
const commandParser = require('../src/services/commandParser.service');
const pendingTransactionService = require('../src/services/pendingTransaction.service');
const bulkImportService = require('../src/services/bulkImport.service');

const USER_ID = 'user-uuid-1';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: Premium Active (ไม่จำกัด) — Test เรื่อง Limit จะ Override เอง
  entitlement.getActiveAssetLimit.mockReturnValue(null);
  symbolRegistry.lookupType.mockReturnValue(null);
});

describe('previewBatch — Batch ว่างเปล่า', () => {
  test('parseBulkImportLines คืน empty:true → ok:false, empty:true, ไม่แตะ validate/persist', async () => {
    commandParser.parseBulkImportLines.mockReturnValue({ ok: false, empty: true, errors: [], items: [] });

    const result = await bulkImportService.previewBatch(USER_ID, '   ');

    expect(result).toEqual({ ok: false, empty: true, errors: [] });
    expect(transactionService.validateBuy).not.toHaveBeenCalled();
    expect(pendingTransactionService.createBatch).not.toHaveBeenCalled();
  });
});

describe('previewBatch — Parse ไม่ผ่าน (Format Error)', () => {
  test('1 บรรทัดผิดจาก parseBulkImportLines → ส่งต่อ errors ตรงๆ ไม่แตะ validate/persist', async () => {
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: false,
      empty: false,
      errors: [{ line: 2, reason: 'รูปแบบไม่ถูกต้อง' }],
      items: [],
    });

    const result = await bulkImportService.previewBatch(USER_ID, 'text');

    expect(result).toEqual({ ok: false, empty: false, errors: [{ line: 2, reason: 'รูปแบบไม่ถูกต้อง' }] });
    expect(transactionService.validateBuy).not.toHaveBeenCalled();
    expect(pendingTransactionService.createBatch).not.toHaveBeenCalled();
  });

  test('หลายบรรทัดผิดพร้อมกัน → errors ครบทุกบรรทัด', async () => {
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: false,
      empty: false,
      errors: [
        { line: 1, reason: 'รูปแบบไม่ถูกต้อง' },
        { line: 3, reason: 'วันที่ไม่ถูกต้อง' },
      ],
      items: [],
    });

    const result = await bulkImportService.previewBatch(USER_ID, 'text');

    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.line)).toEqual([1, 3]);
  });
});

describe('previewBatch — Aggregate Asset Limit (Free Plan)', () => {
  test('existingCount + Symbol ใหม่ในก้อนเกิน Limit → Reject ทั้ง Batch, ไม่เขียน DB', async () => {
    entitlement.getActiveAssetLimit.mockReturnValue(2);
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: true,
      empty: false,
      errors: [],
      items: [
        { line: 1, symbol: 'BTC', quantity: 1, pricePerUnit: 100 },
        { line: 2, symbol: 'ETH', quantity: 1, pricePerUnit: 100 },
        { line: 3, symbol: 'SOL', quantity: 1, pricePerUnit: 100 },
      ],
    });
    assetRepository.countActiveByUser.mockResolvedValue(1); // มี 1 Asset อยู่แล้ว
    assetRepository.findByUserAndSymbol.mockResolvedValue(null); // ทั้ง 3 เป็น Symbol ใหม่หมด

    const result = await bulkImportService.previewBatch(USER_ID, 'text', { plan: 'free' });

    // 1 (เดิม) + 3 (ใหม่ในก้อน) = 4 > Limit 2 → Reject
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ line: null, code: 'ASSET_LIMIT_REACHED' }),
    ]);
    expect(transactionService.validateBuy).not.toHaveBeenCalled();
    expect(pendingTransactionService.createBatch).not.toHaveBeenCalled();
  });

  test('Symbol ซ้ำกันหลายบรรทัดในก้อนเดียว → นับเป็น Asset ใหม่แค่ 1 ตัว (ไม่ Double-count)', async () => {
    entitlement.getActiveAssetLimit.mockReturnValue(2);
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: true,
      empty: false,
      errors: [],
      items: [
        { line: 1, symbol: 'BTC', quantity: 1, pricePerUnit: 100 },
        { line: 2, symbol: 'BTC', quantity: 2, pricePerUnit: 200 },
      ],
    });
    assetRepository.countActiveByUser.mockResolvedValue(1);
    assetRepository.findByUserAndSymbol.mockResolvedValue(null);
    transactionService.validateBuy.mockResolvedValue({
      amounts: { quantity: 1, pricePerUnit: 100, amountThb: 100 },
      assetType: 'crypto',
      newAsset: true,
    });
    pendingTransactionService.createBatch.mockResolvedValue({ batchId: 'b1', pendings: [] });

    // 1 (เดิม) + 1 (BTC ใหม่ นับครั้งเดียว) = 2 ไม่เกิน Limit 2 → ผ่าน
    const result = await bulkImportService.previewBatch(USER_ID, 'text', { plan: 'free' });
    expect(result.ok).toBe(true);
  });

  test('Symbol มีอยู่แล้วในพอร์ต (ไม่ใช่ Asset ใหม่) → ไม่นับเพิ่ม แม้ Free Plan เต็ม Limit พอดี', async () => {
    entitlement.getActiveAssetLimit.mockReturnValue(2);
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: true,
      empty: false,
      errors: [],
      items: [{ line: 1, symbol: 'BTC', quantity: 1, pricePerUnit: 100 }],
    });
    assetRepository.countActiveByUser.mockResolvedValue(2); // เต็ม Limit แล้ว
    assetRepository.findByUserAndSymbol.mockResolvedValue({ id: 'a-btc', type: 'crypto' }); // แต่ BTC มีอยู่แล้ว
    transactionService.validateBuy.mockResolvedValue({
      amounts: { quantity: 1, pricePerUnit: 100, amountThb: 100 },
      assetType: 'crypto',
      newAsset: false,
    });
    pendingTransactionService.createBatch.mockResolvedValue({ batchId: 'b1', pendings: [] });

    const result = await bulkImportService.previewBatch(USER_ID, 'text', { plan: 'free' });
    expect(result.ok).toBe(true);
  });
});

describe('previewBatch — Business Validation (transactionService.validateBuy)', () => {
  test('validateBuy throw สำหรับ 1 บรรทัด → Reject ทั้ง Batch, ไม่เขียน DB', async () => {
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: true,
      empty: false,
      errors: [],
      items: [
        { line: 1, symbol: 'BTC', quantity: 1, pricePerUnit: 100 },
        { line: 2, symbol: 'AAAA', quantity: 1, pricePerUnit: 100 },
      ],
    });
    transactionService.validateBuy
      .mockResolvedValueOnce({
        amounts: { quantity: 1, pricePerUnit: 100, amountThb: 100 },
        assetType: 'crypto',
        newAsset: true,
      })
      .mockRejectedValueOnce(Object.assign(new Error('unknown symbol'), { code: 'VALIDATION_ERROR' }));

    const result = await bulkImportService.previewBatch(USER_ID, 'text');

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ line: 2, symbol: 'AAAA', code: 'VALIDATION_ERROR' }]);
    expect(pendingTransactionService.createBatch).not.toHaveBeenCalled();
  });

  test('หลายบรรทัด Business Error พร้อมกัน → รวบรวมครบทุกบรรทัด ไม่หยุดที่บรรทัดแรก', async () => {
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: true,
      empty: false,
      errors: [],
      items: [
        { line: 1, symbol: 'AAAA', quantity: 1, pricePerUnit: 100 },
        { line: 2, symbol: 'BTC', quantity: 1, pricePerUnit: 100 },
        { line: 3, symbol: 'BBBB', quantity: 1, pricePerUnit: 100 },
      ],
    });
    transactionService.validateBuy
      .mockRejectedValueOnce(Object.assign(new Error('bad'), { code: 'VALIDATION_ERROR' }))
      .mockResolvedValueOnce({
        amounts: { quantity: 1, pricePerUnit: 100, amountThb: 100 },
        assetType: null,
        newAsset: false,
      })
      .mockRejectedValueOnce(Object.assign(new Error('bad2'), { code: 'VALIDATION_ERROR' }));

    const result = await bulkImportService.previewBatch(USER_ID, 'text');

    expect(result.errors.map((e) => e.line)).toEqual([1, 3]);
  });
});

describe('previewBatch — สำเร็จทั้ง Batch', () => {
  test('Parse+Validate ผ่านหมด → เรียก createBatch แล้วคืน batchId/items/totalAmountThb', async () => {
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: true,
      empty: false,
      errors: [],
      items: [
        { line: 1, symbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000 },
        { line: 2, symbol: 'ETH', quantity: 2, pricePerUnit: 80000, date: '2026-03-01' },
        { line: 3, symbol: 'MSFT', quantity: 3, pricePerUnit: 300, currency: 'USD' },
      ],
    });
    transactionService.validateBuy.mockImplementation(async (userId, params) => ({
      amounts: { quantity: params.quantity, pricePerUnit: params.pricePerUnit, amountThb: params.quantity * params.pricePerUnit },
      assetType: 'crypto',
      newAsset: true,
    }));
    pendingTransactionService.createBatch.mockResolvedValue({
      batchId: 'batch-1',
      pendings: [
        { id: 'p1', assetSymbol: 'BTC', amountThb: 750000 },
        { id: 'p2', assetSymbol: 'ETH', amountThb: 160000 },
        { id: 'p3', assetSymbol: 'MSFT', amountThb: 90000 },
      ],
    });

    const result = await bulkImportService.previewBatch(USER_ID, 'text');

    expect(pendingTransactionService.createBatch).toHaveBeenCalledWith(
      USER_ID,
      expect.arrayContaining([
        expect.objectContaining({ line: 1, symbol: 'BTC' }),
        expect.objectContaining({ line: 2, symbol: 'ETH' }),
        expect.objectContaining({ line: 3, symbol: 'MSFT' }),
      ])
    );
    // ตรวจว่า params ที่ส่งต่อให้ validateBuy มี currency/date เฉพาะรายการที่ระบุ
    expect(transactionService.validateBuy.mock.calls[1][1]).toMatchObject({ date: '2026-03-01' });
    expect(transactionService.validateBuy.mock.calls[2][1]).toMatchObject({ currency: 'USD' });
    expect(transactionService.validateBuy.mock.calls[0][1]).not.toHaveProperty('date');
    expect(transactionService.validateBuy.mock.calls[0][1]).not.toHaveProperty('currency');

    expect(result).toEqual({
      ok: true,
      batchId: 'batch-1',
      items: [
        { id: 'p1', assetSymbol: 'BTC', amountThb: 750000 },
        { id: 'p2', assetSymbol: 'ETH', amountThb: 160000 },
        { id: 'p3', assetSymbol: 'MSFT', amountThb: 90000 },
      ],
      totalAmountThb: 1000000,
    });
  });

  test('Asset ใหม่ที่ไม่มี type → Enrich จาก symbolRegistry.lookupType ก่อนส่งเข้า validateBuy', async () => {
    commandParser.parseBulkImportLines.mockReturnValue({
      ok: true,
      empty: false,
      errors: [],
      items: [{ line: 1, symbol: 'BTC', quantity: 1, pricePerUnit: 100 }],
    });
    symbolRegistry.lookupType.mockReturnValue('crypto');
    transactionService.validateBuy.mockResolvedValue({
      amounts: { quantity: 1, pricePerUnit: 100, amountThb: 100 },
      assetType: 'crypto',
      newAsset: true,
    });
    pendingTransactionService.createBatch.mockResolvedValue({ batchId: 'b1', pendings: [] });

    await bulkImportService.previewBatch(USER_ID, 'text');

    expect(symbolRegistry.lookupType).toHaveBeenCalledWith('BTC');
    expect(transactionService.validateBuy.mock.calls[0][1]).toMatchObject({ type: 'crypto' });
  });
});

describe('confirmBatch / cancelBatch — Wrapper บาง ๆ', () => {
  test('confirmBatch ส่งต่อ batchId + options ให้ pendingTransactionService.confirmBatch (Bug Fix: Thread options)', async () => {
    pendingTransactionService.confirmBatch.mockResolvedValue({ total: 2, succeeded: [], failed: [] });

    const result = await bulkImportService.confirmBatch('batch-1', {
      plan: 'premium',
      planExpiresAt: '2026-08-04T00:00:00.000Z',
    });

    expect(pendingTransactionService.confirmBatch).toHaveBeenCalledWith('batch-1', {
      plan: 'premium',
      planExpiresAt: '2026-08-04T00:00:00.000Z',
    });
    expect(result).toEqual({ total: 2, succeeded: [], failed: [] });
  });

  test('confirmBatch ไม่ส่ง options มา → ส่งต่อ {} (Default) ไม่ throw', async () => {
    pendingTransactionService.confirmBatch.mockResolvedValue({ total: 1, succeeded: [], failed: [] });

    await bulkImportService.confirmBatch('batch-2');

    expect(pendingTransactionService.confirmBatch).toHaveBeenCalledWith('batch-2', {});
  });

  test('cancelBatch ส่งต่อให้ pendingTransactionService.cancelBatch', async () => {
    pendingTransactionService.cancelBatch.mockResolvedValue({ total: 2, cancelled: 2, failed: [] });
    const result = await bulkImportService.cancelBatch('batch-1');
    expect(pendingTransactionService.cancelBatch).toHaveBeenCalledWith('batch-1');
    expect(result).toEqual({ total: 2, cancelled: 2, failed: [] });
  });
});
