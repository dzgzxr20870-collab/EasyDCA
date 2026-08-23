// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 (migration 046) — "โบรกที่ผู้ใช้เลือกต้องรอดข้าม Preview → Confirm"
// ═══════════════════════════════════════════════════════════════════════════
// เทสต์ชุดนี้เขียนตามบทเรียนตรงจาก POSTMORTEM_AMOUNT_CONSISTENCY.md:
//
//   บั๊ก "ยอดที่แสดง ≠ ยอดที่บันทึก" อยู่ที่ **รอยต่อ** ระหว่าง
//   pendingTransaction.service กับ transaction.service พอดี ซึ่งเป็นจุดบอดของ
//   Mock ทั้งสองฝั่ง (ฝั่งหนึ่ง Mock อีกฝั่งทั้งก้อน / อีกฝั่งไม่รู้จัก pending เลย)
//   → เทสต์เขียวสนิทตลอดเวลาที่บั๊กมีอยู่จริงบน Production
//
//   กฎที่ได้จากเคสนั้น: งานที่แตะ 2 Service ต่อกันบนเส้นทางเงิน ต้องมีเทสต์ที่ใช้
//   **ของจริงทั้งสองฝั่ง** อย่างน้อย 1 ตัว (Mock เฉพาะ Repository/External API)
//
// Stage 5 พก "ตัวตนของสินทรัพย์" (brokerId) ข้ามรอยต่อเดียวกันนี้ จึงต้องมีเทสต์
// แบบเดียวกัน — ถ้า brokerId ตกหล่นระหว่างทาง ตอนกดยืนยันจะไปสร้างสินทรัพย์
// "ไม่ระบุโบรก" ขึ้นมาใหม่อีกแถว = ประวัติแตกคนละ asset_id ซึ่งคือบั๊กเดียวกับที่
// migration 014 เคยแก้เป๊ะ (ต้นทุนเฉลี่ย/P&L ผิดแบบเงียบๆ)
//
// ── RED-GREEN ──────────────────────────────────────────────────────────────
//   • ถอด `brokerId: pending.brokerId ?? null` ออกจาก toCommitParams → แดง
//   • ถอด `brokerId` ออกจาก pendingRepository.create({...}) → แดง
//   • เปลี่ยน validateBuy ให้คืน `params.brokerId` (ค่าดิบ) แทนค่าที่ Resolve ได้
//     → แดงที่เคส "ไม่ได้พิมพ์โบรกมา แต่ถืออยู่ที่โบรกเดียว"

jest.mock('../src/repositories/asset.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/pendingTransaction.repository');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const assetRepository = require('../src/repositories/asset.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const pendingRepository = require('../src/repositories/pendingTransaction.repository');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');

const { createPending, confirmPending } = require('../src/services/pendingTransaction.service');
const { COMMANDS } = require('../src/services/commandParser.service');

const USER_ID = 'user-uuid-1';
const PENDING_ID = 'pending-uuid-1';
const BROKER_A = 'broker-aaaa-1111';
const BROKER_B = 'broker-bbbb-2222';

const BTC_AT_A = { id: 'asset-btc-a', userId: USER_ID, symbol: 'BTC', type: 'crypto', brokerId: BROKER_A };
const BTC_AT_B = { id: 'asset-btc-b', userId: USER_ID, symbol: 'BTC', type: 'crypto', brokerId: BROKER_B };

let stored = null;

beforeEach(() => {
  jest.clearAllMocks();
  stored = null;

  assetRepository.create.mockResolvedValue({ ...BTC_AT_A });
  transactionRepository.create.mockResolvedValue({ id: 'tx-uuid-1' });
  transactionRepository.findAllByAsset.mockResolvedValue([]);
  priceFeedService.getCurrentPrice.mockResolvedValue(null);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  fxRateService.getUsdThbRate.mockResolvedValue({ rate: 35, asOf: '2026-08-24', stale: false });

  // จำลอง DB จริง: create เก็บแถวไว้ แล้ว claimForConfirm อ่านแถวเดิมกลับมา
  // (จุดสำคัญคือ "ค่าที่ Snapshot ตอน Preview" ต้องเดินทางถึงตอนบันทึกจริงครบ)
  pendingRepository.create.mockImplementation(async (data) => {
    stored = { id: PENDING_ID, status: 'pending', ...data };
    return stored;
  });
  pendingRepository.claimForConfirm.mockImplementation(async () => stored);
  pendingRepository.attachTransaction.mockResolvedValue(undefined);
});

const buyParsed = (params) => ({
  command: COMMANDS.BUY,
  params: { symbol: 'BTC', type: 'crypto', quantity: 1, pricePerUnit: 100, ...params },
});

describe('Preview → Confirm ต้องบันทึกเข้า "สินทรัพย์แถวเดิม" ที่ Preview อ้างถึง', () => {
  test('⚠️ เลือกโบรก B ตอน Preview → Ledger ต้องผูกกับ asset ของโบรก B (ไม่ใช่ A ไม่ใช่แถวใหม่)', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A, BTC_AT_B]);

    await createPending(USER_ID, buyParsed({ brokerId: BROKER_B }), { plan: 'premium' });

    // Snapshot ลง DB ตั้งแต่ตอน Preview
    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ brokerId: BROKER_B })
    );

    await confirmPending(PENDING_ID, USER_ID, { plan: 'premium' });

    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: BTC_AT_B.id })
    );
  });

  // เคสที่บั๊กจะซ่อนตัวได้เนียนที่สุด: ผู้ใช้ไม่ได้ระบุโบรกเลย (ถือโบรกเดียวจึงไม่ถูกถาม)
  // ถ้า validateBuy คืนค่าดิบ (undefined) แทนโบรกของแถวที่เจอ pending จะเก็บ NULL
  // แล้วตอน Confirm จะไปสร้างสินทรัพย์ "ไม่ระบุโบรก" ขึ้นมาใหม่อีกแถว
  test('⚠️ ไม่ได้พิมพ์โบรกมา แต่ถืออยู่ที่โบรก A เดียว → pending ต้องเก็บ A ไม่ใช่ NULL', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([BTC_AT_A]);

    await createPending(USER_ID, buyParsed(), { plan: 'premium' });

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ brokerId: BROKER_A })
    );

    await confirmPending(PENDING_ID, USER_ID, { plan: 'premium' });

    // ต้องไม่สร้างสินทรัพย์ซ้ำแถวใหม่ (บั๊กเดิมของ migration 014)
    expect(assetRepository.create).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: BTC_AT_A.id })
    );
  });

  test('สินทรัพย์ใหม่ที่ผูกโบรก → Confirm สร้างแถวใหม่พร้อม broker_id ที่เลือกไว้', async () => {
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([]);
    assetRepository.findActiveSymbolsByUser.mockResolvedValue([]);
    assetRepository.create.mockResolvedValue({ ...BTC_AT_B });

    await createPending(USER_ID, buyParsed({ brokerId: BROKER_B }), { plan: 'free' });
    await confirmPending(PENDING_ID, USER_ID, { plan: 'free' });

    expect(assetRepository.create.mock.calls[0][7]).toBe(BROKER_B);
  });

  test('ไม่มีโบรกเลย (ระบบเดิมทั้งหมดวันนี้) → brokerId เป็น null ตลอดเส้นทาง ไม่พัง', async () => {
    const btcPlain = { id: 'asset-btc', userId: USER_ID, symbol: 'BTC', type: 'crypto', brokerId: null };
    assetRepository.findAllByUserAndSymbol.mockResolvedValue([btcPlain]);

    await createPending(USER_ID, buyParsed(), { plan: 'premium' });

    expect(pendingRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ brokerId: null })
    );

    const result = await confirmPending(PENDING_ID, USER_ID, { plan: 'premium' });

    expect(result.commandType).toBe('buy');
    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-btc' })
    );
  });
});
