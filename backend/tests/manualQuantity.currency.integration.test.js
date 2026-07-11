// ═══════════════════════════════════════════════════════════════════════
// Integration Test — Manual Quantity Fallback + USD (Round 10-B.2 Hotfix)
// ═══════════════════════════════════════════════════════════════════════
// ไล่ Flow เต็มจาก Text "ซื้อ EOSE 8 หุ้น รวม 30.43 USD" จนถึง Flex Preview โดย
// Mock "แค่ boundary" (supabaseAdmin/line/priceFeed/fxRate) — ไม่ Mock commandParser,
// transaction.service, pendingTransaction.service, pendingTransaction.repository,
// webhook.controller เพื่อจับ Bug เชิง Integration ที่ Unit Test แยกไฟล์ (Mock กันไว้)
// มองไม่เห็น โดยเฉพาะ Combo ใหม่ "Manual Quantity Fallback + USD"

// จับ payload ที่ถูก Insert ลง pending_transactions (Layer ปลายทางก่อนถึง DB จริง)
// นี่คือ "ค่าที่โค้ดยื่นให้ Supabase" — ถ้า currency หายตรงนี้แปลว่า Logic โค้ดหลุด
// (Root Cause จริงของ Bug 10-B.2: createPending เดิมไม่ส่ง currency → payload เป็น THB)
let capturedPendingInsert = null;

// Mock supabaseAdmin — Chainable Query Builder ที่ตอบตามตารางจริง (Repository รันจริง
// หมด: user.repository / asset.repository / pendingTransaction.repository → toPending)
jest.mock('../src/config/supabase', () => {
  const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const USER_ROW = {
    id: 'user-int-1',
    line_user_id: 'U123',
    display_name: 'Real Name', // ไม่ใช่ Fallback → resolveUser ไม่เรียก updateDisplayName
    picture_url: null,
    plan: 'premium', // Premium → validateBuy ข้าม countActiveByUser (ไม่ต้อง Mock count)
    plan_expires_at: FUTURE,
    is_locked: false,
  };

  function resolveResult(state) {
    if (state.table === 'users') return { data: USER_ROW, error: null };
    if (state.table === 'assets') return { data: null, error: null }; // Asset ใหม่ทุกครั้ง
    if (state.table === 'pending_transactions') {
      // Echo payload ที่ Insert กลับเป็น Row (จำลอง .select('*').single() ของจริง) —
      // toPending จะ Map row.currency → pending.currency ตามค่าที่ถูก Insert เข้ามาจริง
      capturedPendingInsert = state.insert;
      const row = {
        id: 'pending-int-1',
        status: 'pending',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        resolved_at: null,
        transaction_id: null,
        batch_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...state.insert,
      };
      return { data: row, error: null };
    }
    return { data: null, error: null };
  }

  function queryBuilder(table) {
    const state = { table, insert: null, update: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      is: () => chain,
      in: () => chain,
      gt: () => chain,
      gte: () => chain,
      lt: () => chain,
      lte: () => chain,
      not: () => chain,
      or: () => chain,
      filter: () => chain,
      ilike: () => chain,
      contains: () => chain,
      range: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (payload) => {
        state.insert = payload;
        return chain;
      },
      update: (payload) => {
        state.update = payload;
        return chain;
      },
      delete: () => chain,
      single: () => Promise.resolve(resolveResult(state)),
      maybeSingle: () => Promise.resolve(resolveResult(state)),
      then: (onF, onR) => Promise.resolve(resolveResult(state)).then(onF, onR),
    };
    return chain;
  }

  return { supabaseAdmin: { from: (t) => queryBuilder(t) } };
});

jest.mock('../src/config/env', () => {
  const actual = jest.requireActual('../src/config/env');
  return {
    ...actual,
    liff: { ...actual.liff, id: 'test-liff' },
    app: { ...actual.app, publicBaseUrl: 'https://api.test', frontendUrl: 'https://app.test' },
  };
});

jest.mock('../src/services/line.service');
jest.mock('../src/services/priceFeed.service');
jest.mock('../src/services/fxRate.service');

const lineService = require('../src/services/line.service');
const priceFeedService = require('../src/services/priceFeed.service');
const fxRateService = require('../src/services/fxRate.service');
const { parseCommand, COMMANDS } = require('../src/services/commandParser.service');
const { handleEvent } = require('../src/controllers/webhook.controller');

function textEvent(text) {
  return {
    type: 'message',
    replyToken: 'reply-token-int',
    source: { userId: 'U123' },
    message: { type: 'text', text },
  };
}

function lastReply() {
  const call = lineService.replyMessage.mock.calls.at(-1);
  return call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedPendingInsert = null;
  lineService.replyMessage.mockResolvedValue(undefined);
  lineService.getProfile.mockResolvedValue(null);
  // EOSE ไม่ใช่กองทุน → fetchFundMasterList คืน [] → resolveFundForBuy = not_found
  priceFeedService.fetchFundMasterList.mockResolvedValue([]);
  // Manual Quantity ไม่พึ่ง Price Feed เลย — ตั้ง null ไว้ยืนยันว่าไม่ถูกใช้
  priceFeedService.getCurrentPrice.mockResolvedValue(null);
  priceFeedService.getCurrentPriceUsd.mockResolvedValue(null);
  // FX เรตคืน null → ไม่แสดงบรรทัด "≈ บาท" (ทำให้ Assert "ไม่มีบาท" ชัดเจน) และไม่ Block
  fxRateService.getUsdThbRate.mockResolvedValue(null);
});

describe('Integration — Manual Quantity Fallback + USD คงหน่วยเป็น USD ตลอด Flow', () => {
  test('Layer 1: parseCommand → currency:USD (quantity+amountThb, ไม่มี pricePerUnit)', () => {
    expect(parseCommand('ซื้อ EOSE 8 หุ้น รวม 30.43 USD')).toEqual({
      command: COMMANDS.BUY,
      params: { symbol: 'EOSE', quantity: 8, amountThb: 30.43, currency: 'USD' },
    });
  });

  test('Layer 2-4: handleEvent → payload ที่ Insert ลง pending_transactions มี currency:USD', async () => {
    await handleEvent(textEvent('ซื้อ EOSE 8 หุ้น รวม 30.43 USD'));

    expect(capturedPendingInsert).not.toBeNull();
    expect(capturedPendingInsert.currency).toBe('USD');
    expect(capturedPendingInsert.asset_symbol).toBe('EOSE');
    expect(capturedPendingInsert.quantity).toBe(8);
    // ราคาต่อหน่วยคำนวณจาก 30.43 / 8 = 3.80375 (Manual branch, ไม่พึ่ง Price Feed)
    expect(capturedPendingInsert.price_per_unit).toBeCloseTo(3.80375, 5);
    expect(priceFeedService.getCurrentPriceUsd).not.toHaveBeenCalled();
  });

  test('Layer 5: Flex Preview แสดงหน่วย "USD" ทั้งราคาต่อหน่วยและมูลค่ารวม', async () => {
    await handleEvent(textEvent('ซื้อ EOSE 8 หุ้น รวม 30.43 USD'));

    const reply = JSON.stringify(lastReply());
    // ราคาต่อหน่วยและมูลค่ารวมติดหน่วย USD (ไม่ใช่ "บาท") — คือหัวใจของ Bug 10-B.2
    expect(reply).toContain('ราคาต่อหน่วย: 3.80375 USD');
    expect(reply).toContain('มูลค่ารวม: 30.43 USD');
    expect(reply).toContain('8 EOSE');
    // ราคาต่อหน่วย/มูลค่ารวม ต้อง "ไม่" ลงท้ายด้วย "บาท" (คำว่า บาท ที่เหลือมาจากบรรทัด
    // หมายเหตุ FX "ยังตีเป็นบาทไม่ได้" เท่านั้น ซึ่งเป็นพฤติกรรมถูกต้องของสกุล USD)
    expect(reply).not.toContain('3.80375 บาท');
    expect(reply).not.toContain('30.43 บาท');
  });

  test('Regression: THB (ไม่มีหน่วย) ยังแสดง "บาท" เหมือนเดิม', async () => {
    await handleEvent(textEvent('ซื้อ OKLO 5 หุ้น รวม 250'));

    expect(capturedPendingInsert.currency).toBe('THB');
    const reply = JSON.stringify(lastReply());
    expect(reply).toContain('บาท');
    expect(reply).not.toContain('USD');
  });

});

// ── หมายเหตุ Root Cause (Bug 10-B.2) ────────────────────────────────────────
// อาการ "การ์ด USD แสดงบาท" เกิดจาก pendingTransaction.service.createPending เวอร์ชัน
// ที่ Deploy อยู่ "ไม่ส่ง field currency" เข้า pendingRepository.create() → repository
// ทำ `currency: data.currency ?? 'THB'` ได้ undefined → INSERT payload เป็น 'THB'
// ตั้งแต่ต้น (พิสูจน์ด้วย `git stash` ไฟล์นั้นแล้วรัน test 'Layer 2-4' จะได้ Received:'THB')
// จึงเป็น Bug ระดับ Logic โค้ด ไม่ใช่ DB/Schema Cache — Test 'Layer 2-4' ด้านบนคือ Guard
// ที่ Fail บนโค้ดเดิมและ Pass เมื่อเติม currency กลับเข้า INSERT (ดู fix ใน createPending)
