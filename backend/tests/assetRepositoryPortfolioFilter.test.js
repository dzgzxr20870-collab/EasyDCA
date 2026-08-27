// ═══════════════════════════════════════════════════════════════════════════
// findAllByUserAndSymbol — การกรอง portfolio_id ต้องแยก 3 ทาง (Stage 8-fix)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ **ทำไมต้องมีไฟล์นี้แยกจาก portfolioResolution.regression.test.js**
//
// ไฟล์นั้นทดสอบ "เส้นทางเงินตั้งแต่ validateBuy ลงมา" แต่มัน `jest.mock` ทั้ง
// asset.repository ทิ้ง → **ตัวฟังก์ชันกรองจริงไม่เคยถูกรันเลยแม้แต่ครั้งเดียว**
// ตรวจแล้วด้วยการทดลอง: ย้อน findAllByUserAndSymbol กลับเป็น ternary 2 ทาง
// (ต้นตอของบั๊ก) แล้วรันไฟล์นั้น → **เขียว 15/15 ทั้งที่บั๊กกลับมาแล้ว**
//
// นี่คือบทเรียนเดียวกับ POSTMORTEM_AMOUNT_CONSISTENCY เป๊ะ ("Mock ที่รอยต่อทำให้
// เทสต์เขียวสนิททั้งที่บั๊คมีอยู่จริง") — ไฟล์นี้จึงใช้ **Repository ตัวจริง**
// แล้ว Mock แค่ Supabase Query Builder เพื่อดูว่ามันเรียก .eq() / .is() ถูกไหม
//
// กติกาที่ต้องคงไว้ตลอดไป:
//   undefined → ไม่แตะ portfolio_id เลย (ไม่เรียกทั้ง .eq และ .is)
//   null      → .is('portfolio_id', null)
//   '<uuid>'  → .eq('portfolio_id', uuid)

jest.mock('../src/config/supabase', () => {
  const query = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.order = jest.fn(() => Promise.resolve({ data: [], error: null }));
  const supabaseAdmin = { from: jest.fn(() => query), rpc: jest.fn() };
  return { supabaseAdmin, __query: query };
});

const { __query } = require('../src/config/supabase');
const assetRepository = require('../src/repositories/asset.repository');

const USER_ID = '11111111-2222-4333-8444-555555555555';
const PORTFOLIO_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

// .eq() ถูกใช้ทั้งกับ user_id (จาก queryForUser) · symbol · portfolio_id
// จึงต้องดูเฉพาะครั้งที่เป็นคอลัมน์ portfolio_id
const portfolioEqCalls = () => __query.eq.mock.calls.filter(([col]) => col === 'portfolio_id');
const portfolioIsCalls = () => __query.is.mock.calls.filter(([col]) => col === 'portfolio_id');

beforeEach(() => {
  jest.clearAllMocks();
  __query.order.mockResolvedValue({ data: [], error: null });
});

describe('findAllByUserAndSymbol — กติกา portfolioId 3 ทาง', () => {
  // ⭐ เคสที่บั๊กเดิมทำผิด และเป็นเคสที่เกิดขึ้นจริงบน Production ทุกคำสั่งซื้อ/ขาย
  // (เว็บไม่อ่าน portfolioId จาก Body · LINE ไม่มีคอนเซ็ปต์พอร์ตเลย → undefined เสมอ)
  test('⭐ undefined → **ไม่กรอง portfolio_id เลย** (ไม่เรียกทั้ง .eq และ .is)', async () => {
    await assetRepository.findAllByUserAndSymbol(USER_ID, 'BTC', undefined);

    expect(portfolioEqCalls()).toHaveLength(0);
    expect(portfolioIsCalls()).toHaveLength(0);
  });

  test('⭐ ไม่ส่ง Argument ที่ 3 มาเลย → เท่ากับ undefined (ไม่กรอง)', async () => {
    await assetRepository.findAllByUserAndSymbol(USER_ID, 'BTC');

    expect(portfolioEqCalls()).toHaveLength(0);
    expect(portfolioIsCalls()).toHaveLength(0);
  });

  test('null → .is(\'portfolio_id\', null) (เจาะจงว่าไม่มีพอร์ต)', async () => {
    await assetRepository.findAllByUserAndSymbol(USER_ID, 'BTC', null);

    expect(portfolioIsCalls()).toEqual([['portfolio_id', null]]);
    expect(portfolioEqCalls()).toHaveLength(0);
  });

  test('uuid → .eq(\'portfolio_id\', uuid) (เจาะจงพอร์ตนั้น)', async () => {
    await assetRepository.findAllByUserAndSymbol(USER_ID, 'BTC', PORTFOLIO_ID);

    expect(portfolioEqCalls()).toEqual([['portfolio_id', PORTFOLIO_ID]]);
    expect(portfolioIsCalls()).toHaveLength(0);
  });

  // ⚠️ เคสนี้กันการยุบ 3 ทางเหลือ 2 ทางโดยตรง — ternary แบบ
  // `portfolioId ? .eq(...) : .is(..., null)` จะทำให้ undefined กับ null
  // ให้ผลเหมือนกัน ซึ่งคือบั๊กที่บล็อกการ Apply migration 044
  test('⚠️ undefined กับ null ต้องให้ผล **ต่างกัน** (ห้ามยุบเหลือ ternary 2 ทาง)', async () => {
    await assetRepository.findAllByUserAndSymbol(USER_ID, 'BTC', undefined);
    const undefinedTouched = portfolioEqCalls().length + portfolioIsCalls().length;

    jest.clearAllMocks();
    __query.order.mockResolvedValue({ data: [], error: null });

    await assetRepository.findAllByUserAndSymbol(USER_ID, 'BTC', null);
    const nullTouched = portfolioEqCalls().length + portfolioIsCalls().length;

    expect(undefinedTouched).toBe(0);
    expect(nullTouched).toBe(1);
    expect(undefinedTouched).not.toBe(nullTouched);
  });

  test('symbol ยังถูกกรองเสมอไม่ว่าพอร์ตจะเป็นค่าใด', async () => {
    await assetRepository.findAllByUserAndSymbol(USER_ID, 'BTC', undefined);

    expect(__query.eq.mock.calls).toContainEqual(['symbol', 'BTC']);
  });
});
