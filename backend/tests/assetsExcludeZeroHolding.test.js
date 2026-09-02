// ═══════════════════════════════════════════════════════════════════════════
// assets.service.listAssets — filters.excludeZeroHolding (E2E Chrome Test —
// บั๊กที่ 1 ตามจริง, มติ Founder)
// ═══════════════════════════════════════════════════════════════════════════
// Root Cause เดิม: GET /assets ไม่เคยกรอง heldQuantity ≤ 0 ออกเลย ต่างจากตาราง
// Holdings (portfolio.service.getPortfolioSummary ที่กรองอยู่แล้ว) — สินทรัพย์
// ที่ขายหมดแล้วจึงยังโผล่เป็นตัวเลือก/Default ใน Dropdown ขาย/ปันผลได้
//
// ⚠️ Reuse calculateHeldQuantity ตัวเดียวกับ portfolio.service ตรงๆ (ไม่คิดสูตร
// ใหม่) — Pattern การ Mock เดียวกับ costBasisConsistency.test.js
jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const assetsService = require('../src/services/assets.service');

const USER_ID = 'user-exclude-zero-1';

const ASSET_BTC = { id: 'asset-btc', symbol: 'BTC', name: 'BTC', brokerId: null, portfolioId: 'pf-1' };
const ASSET_EOSE = { id: 'asset-eose', symbol: 'EOSE', name: 'EOSE', brokerId: 'br-1', portfolioId: 'pf-1' };
const ASSET_NVDA = { id: 'asset-nvda', symbol: 'NVDA', name: 'NVDA', brokerId: null, portfolioId: 'pf-1' };

beforeEach(() => {
  jest.clearAllMocks();

  assetRepository.findActiveByUser.mockResolvedValue([ASSET_BTC, ASSET_EOSE, ASSET_NVDA]);

  transactionRepository.findAllByAsset.mockImplementation(async (assetId) => {
    if (assetId === 'asset-btc') {
      // ถืออยู่จริง 1 หน่วย
      return [{ type: 'buy', quantity: 1, amountThb: 100, date: '2026-08-01' }];
    }
    if (assetId === 'asset-eose') {
      // ซื้อแล้วขายหมด — heldQuantity = 0 (นี่คือเคสตรงตัวของบั๊กที่เจอ: "EOSE — Weblue")
      return [
        { type: 'buy', quantity: 1, amountThb: 129, date: '2026-08-01' },
        { type: 'sell', quantity: 1, amountThb: 129, date: '2026-08-30' },
      ];
    }
    // NVDA: ไม่เคยมีธุรกรรมเลย (สินทรัพย์ที่ถูกสร้าง Row ไว้แต่ยังไม่ได้ซื้อจริง)
    return [];
  });
});

describe('⭐⭐ listAssets — excludeZeroHolding: true (โหมดขาย/ปันผล)', () => {
  test('⭐ ตัดสินทรัพย์ที่ heldQuantity = 0 ออกทั้งหมด (ทั้งขายหมดแล้ว และไม่เคยซื้อเลย)', async () => {
    const result = await assetsService.listAssets(USER_ID, { excludeZeroHolding: true });

    expect(result.map((a) => a.symbol)).toEqual(['BTC']);
  });

  test('⭐⭐ EOSE ที่ขายหมดแล้ว (Case ตรงตัวจากบั๊กที่เจอจริง) ต้องไม่โผล่เลย', async () => {
    const result = await assetsService.listAssets(USER_ID, { excludeZeroHolding: true });

    expect(result.some((a) => a.symbol === 'EOSE')).toBe(false);
  });

  test('ทำงานร่วมกับ Filter อื่นได้ (portfolioId) — กรอง Filter อื่นก่อน ค่อยเช็ค heldQuantity เฉพาะแถวที่เหลือ', async () => {
    const result = await assetsService.listAssets(USER_ID, {
      portfolioId: 'pf-1',
      excludeZeroHolding: true,
    });

    expect(result.map((a) => a.symbol)).toEqual(['BTC']);
    // ต้องไม่ยิง Transactions ของแถวที่ถูก Filter อื่นตัดทิ้งไปแล้ว (EOSE/NVDA
    // ผ่าน portfolioId filter มาแล้วทั้งคู่ในเคสนี้ จึงยังถูกเช็คอยู่ — แค่ยืนยัน
    // ว่าผลลัพธ์ถูกต้อง ไม่ได้ยืนยันจำนวนครั้งที่เรียกในเคสนี้)
    expect(transactionRepository.findAllByAsset).toHaveBeenCalled();
  });
});

describe('⭐⭐ listAssets — excludeZeroHolding ไม่ได้ส่งมา/false (โหมดซื้อ) — Regression', () => {
  test('⭐⭐ ไม่ส่ง excludeZeroHolding เลย → เห็นสินทรัพย์ 0 หน่วยได้ปกติ (ซื้อกลับเข้าแถวเดิมได้)', async () => {
    const result = await assetsService.listAssets(USER_ID, {});

    expect(result.map((a) => a.symbol).sort()).toEqual(['BTC', 'EOSE', 'NVDA']);
    // ⚠️ ต้องไม่ยิง Transactions เลยเมื่อไม่ได้ขอกรอง heldQuantity (ประหยัด Query
    // โดยไม่จำเป็น — พฤติกรรมเดิมก่อนมีบั๊กนี้)
    expect(transactionRepository.findAllByAsset).not.toHaveBeenCalled();
  });

  test('excludeZeroHolding: false ตรงๆ → พฤติกรรมเหมือนไม่ส่งมาเลย (ไม่กรอง)', async () => {
    const result = await assetsService.listAssets(USER_ID, { excludeZeroHolding: false });

    expect(result.map((a) => a.symbol).sort()).toEqual(['BTC', 'EOSE', 'NVDA']);
  });

  test('ไม่มี Filter ใดๆ เลย (Argument เปล่า) → เห็นทุกสินทรัพย์เหมือน Behavior เดิมก่อนมีบั๊กนี้', async () => {
    const result = await assetsService.listAssets(USER_ID);

    expect(result).toHaveLength(3);
  });
});
