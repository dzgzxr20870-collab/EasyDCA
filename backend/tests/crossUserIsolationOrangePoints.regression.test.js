// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — Cross-User Isolation, จุดสีส้ม 8 จุด (Security Audit รอบ 2)
// ═══════════════════════════════════════════════════════════════════════════
// ต่อจาก tests/crossUserIsolation.regression.test.js (รอบแรก — pending_transactions
// 6 จุดแดง) — ไฟล์นี้ครอบ 8 จุดสีส้มที่เหลือ ซึ่งตอนนี้แก้ผ่าน queryForUser/
// queryAcrossUsers (utils/ownership.util.js) แล้วทั้งหมด
//
// 5 จุดที่ใช้ queryForUser (User-owned) คือ "True Isolation" ที่ต้องป้องกันจริง —
// ทดสอบแบบ A-vs-B Adversarial เหมือน pending_transactions: A พยายามอ่าน/แก้ข้อมูล
// ของ B ด้วยวิธีต่างๆ ต้องไม่มีข้อมูลของ B รั่วออกมาแม้แต่ Field เดียว
//   1. transaction.findAllByAsset(assetId, userId)
//   2. transaction.attachSlipImagePath(id, path, userId)
//   3. asset.findByIds(assetIds, userId)
//   4. payment.findByIdForUser(id, userId)
//   5. payment.updateSlipImageUrl(id, url, hash, userId)
//
// 3 จุดที่ใช้ queryAcrossUsers (payment.findConfirmedBySlipHash,
// facebookLikeGrantRequest.findById/claimForReview) "ตั้งใจ" ข้าม User โดยเจตนา
// (Fraud-check / Admin) — ไม่ใช่ Isolation ที่ต้องป้องกัน จึงไม่ทำ Adversarial Test
// ที่นี่ (มี Test แยกอยู่แล้วใน payment.repository.test.js /
// facebookLikeGrantRequest.repository.test.js ที่ยืนยันว่า Cross-user ทำงานถูก
// ตามเจตนา + reason validation ทำงานจริง)
//
// ⚠️ เหตุผลที่ใช้ Fake Supabase (ไม่ใช่ jest.mock Repository): เพื่อพิสูจน์ว่า
// Query กรอง user_id "จริง" ไม่ใช่แค่ "ส่ง userId ลงไป" — Mock ที่เขียนเองจะเห็น
// ด้วยกับ Fix เสมอ (ดูเหตุผลเต็มในไฟล์รอบแรก)

jest.mock('../src/config/supabase', () => {
  const { createClient } = require('./helpers/fakeSupabase');
  return { supabaseAdmin: createClient() };
});

const { tables, resetTables } = require('./helpers/fakeSupabase');
const transactionRepository = require('../src/repositories/transaction.repository');
const assetRepository = require('../src/repositories/asset.repository');
const paymentRepository = require('../src/repositories/payment.repository');

const USER_A = 'user-a-attacker';
const USER_B = 'user-b-victim';

// ข้อมูลของ B ที่ห้ามหลุดแม้แต่ Field เดียว
const B_SECRET_SYMBOL = 'ETHSECRET';
const B_SECRET_SLIP_PATH = 'slip/of-b-secret.jpg';
const B_SECRET_AMOUNT = 918273.645;

function seedTables() {
  resetTables({
    transactions: [
      {
        id: 'tx-of-b',
        user_id: USER_B,
        asset_id: 'asset-of-b',
        type: 'buy',
        amount_thb: B_SECRET_AMOUNT,
        price_per_unit: 100,
        quantity: 1,
        currency: 'THB',
        fee_thb: 0,
        date: '2026-08-01',
        note: null,
        source: 'line',
        slip_image_path: null,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ],
    assets: [
      {
        id: 'asset-of-b',
        user_id: USER_B,
        portfolio_id: null,
        symbol: B_SECRET_SYMBOL,
        name: 'Ethereum ของ B',
        type: 'crypto',
        is_active: true,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ],
    payments: [
      {
        id: 'pay-of-b',
        user_id: USER_B,
        billing_period: 'monthly',
        base_amount_thb: 59,
        satang_tag: 17,
        amount_thb: 59.17,
        status: 'pending',
        slip_image_url: null,
        slip_hash: null,
        amount_released_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ],
  });
}

function expectNoBDataLeaked(payload) {
  const serialised = JSON.stringify(payload ?? null);
  expect(serialised).not.toContain(B_SECRET_SYMBOL);
  expect(serialised).not.toContain(B_SECRET_SLIP_PATH);
  expect(serialised).not.toContain(String(B_SECRET_AMOUNT));
}

beforeEach(() => {
  seedTables();
});

describe('1) transaction.findAllByAsset — A ใช้ assetId ของ B', () => {
  test('A ขอประวัติ asset ของ B ด้วย userId ของตัวเอง → ไม่เห็นข้อมูลของ B เลย', async () => {
    const result = await transactionRepository.findAllByAsset('asset-of-b', USER_A);

    expect(result).toEqual([]);
    expectNoBDataLeaked(result);
  });

  test('Positive Control: B ขอประวัติ asset ของตัวเอง → เห็นข้อมูลปกติ', async () => {
    const result = await transactionRepository.findAllByAsset('asset-of-b', USER_B);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'tx-of-b', amountThb: B_SECRET_AMOUNT });
  });
});

describe('2) transaction.attachSlipImagePath — A พยายามแนบสลิปเข้าธุรกรรมของ B', () => {
  test('A แนบสลิปเข้า tx-of-b ด้วย userId ของตัวเอง → ไม่สำเร็จ, ธุรกรรมของ B ไม่ถูกแตะ', async () => {
    const result = await transactionRepository.attachSlipImagePath(
      'tx-of-b',
      'slip/of-a-malicious.jpg',
      USER_A
    );

    expect(result).toBeNull();
    // ยืนยันว่า slip_image_path ของ B ยังเป็น null เหมือนเดิม ไม่ถูก A เขียนทับ
    expect(tables.transactions.find((t) => t.id === 'tx-of-b').slip_image_path).toBeNull();
  });

  test('Positive Control: B แนบสลิปเข้าธุรกรรมของตัวเอง → สำเร็จ', async () => {
    const result = await transactionRepository.attachSlipImagePath(
      'tx-of-b',
      B_SECRET_SLIP_PATH,
      USER_B
    );

    expect(result).toMatchObject({ id: 'tx-of-b', slipImagePath: B_SECRET_SLIP_PATH });
  });
});

describe('3) asset.findByIds — A ใช้ assetId ของ B', () => {
  test('A ขอ asset ของ B ตรงๆ ผ่าน findByIds → คืน [] ไม่รั่ว Symbol ของ B', async () => {
    const result = await assetRepository.findByIds(['asset-of-b'], USER_A);

    expect(result).toEqual([]);
    expectNoBDataLeaked(result);
  });

  test('Positive Control: B ขอ asset ของตัวเอง → เห็นปกติ', async () => {
    const result = await assetRepository.findByIds(['asset-of-b'], USER_B);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ symbol: B_SECRET_SYMBOL });
  });
});

describe('4) payment.findByIdForUser — A ใช้ paymentId ของ B', () => {
  test('A ขอ Payment ของ B ตรงๆ → คืน null (เหมือนกรณีไม่มีจริง)', async () => {
    const result = await paymentRepository.findByIdForUser('pay-of-b', USER_A);

    expect(result).toBeNull();
    expectNoBDataLeaked(result);
  });

  test('Positive Control: B ขอ Payment ของตัวเอง → เห็นปกติ', async () => {
    const result = await paymentRepository.findByIdForUser('pay-of-b', USER_B);
    expect(result).toMatchObject({ id: 'pay-of-b', userId: USER_B });
  });
});

describe('5) payment.updateSlipImageUrl — A พยายามแก้สลิปของ Payment ของ B', () => {
  test('A แนบ URL สลิปเข้า Payment ของ B → ไม่สำเร็จ, Payment ของ B ไม่ถูกแตะ', async () => {
    const result = await paymentRepository.updateSlipImageUrl(
      'pay-of-b',
      'https://cdn.test/malicious-from-a.jpg',
      'hash-from-a',
      USER_A
    );

    expect(result).toBeNull();
    expect(tables.payments.find((p) => p.id === 'pay-of-b').slip_image_url).toBeNull();
  });

  test('Positive Control: B แนบสลิปเข้า Payment ของตัวเอง → สำเร็จ', async () => {
    const result = await paymentRepository.updateSlipImageUrl(
      'pay-of-b',
      'https://cdn.test/own-slip.jpg',
      'hash-own',
      USER_B
    );

    expect(result).toMatchObject({ id: 'pay-of-b', slipImageUrl: 'https://cdn.test/own-slip.jpg' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ไม่มี userId เลย → ต้อง throw ทุกจุด ห้าม Fallback เป็นดึงทั้งหมด (ทวนกฎเหล็ก)
// ═══════════════════════════════════════════════════════════════════════════
describe('ไม่มี userId → throw MISSING_USER_ID ทุกจุด (จุดสีส้มทั้ง 5)', () => {
  test('findAllByAsset', async () => {
    await expect(transactionRepository.findAllByAsset('asset-of-b', undefined)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
  });

  test('attachSlipImagePath', async () => {
    await expect(
      transactionRepository.attachSlipImagePath('tx-of-b', 'x.jpg', undefined)
    ).rejects.toMatchObject({ code: 'MISSING_USER_ID' });
  });

  test('asset.findByIds', async () => {
    await expect(assetRepository.findByIds(['asset-of-b'], undefined)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
  });

  test('payment.findByIdForUser', async () => {
    await expect(paymentRepository.findByIdForUser('pay-of-b', undefined)).rejects.toMatchObject({
      code: 'MISSING_USER_ID',
    });
  });

  test('payment.updateSlipImageUrl', async () => {
    await expect(
      paymentRepository.updateSlipImageUrl('pay-of-b', 'x.jpg', undefined, undefined)
    ).rejects.toMatchObject({ code: 'MISSING_USER_ID' });
  });
});
