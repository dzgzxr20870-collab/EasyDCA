// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — IDOR End-to-End (Offensive Security Review Round 2 — Q1)
// ═══════════════════════════════════════════════════════════════════════════
// ที่มา: Review รอบ 2 ไล่อ่านโค้ดทุก Endpoint ที่รับ :id/:symbol จาก Client แล้วสรุปว่า
// "ไม่มีจุดไหนเจาะข้ามบัญชีได้" — แต่ข้อสรุปนั้นมาจากการ "อ่านโค้ด" ล้วนๆ ซึ่งเป็น
// หลักฐานที่อ่อนที่สุด (AI_WORK_POLICY § 2: ห้ามเชื่อว่า "ดูถูกต้อง" = "ถูกต้องจริง"
// และ CLAUDE.md เตือนไว้ตรงๆ ว่าเคยเขียนว่า "Ownership Filter ปิดครบ" ทั้งที่ยังมี
// ช่องโหว่ Cross-User จริงซ่อนอยู่ 6 จุดบนเส้นทางเงิน)
//
// ── ต่างจาก crossUserIsolation*.regression.test.js อย่างไร ────────────────────
// ไฟล์เดิมทดสอบที่ชั้น Service/Repository (เรียกฟังก์ชันตรงๆ) — ครอบ "ตรรกะการกรอง"
// ไฟล์นี้ทดสอบที่ชั้น HTTP จริง: ยก Express App ทั้งก้อนขึ้นมา (Middleware Stack ครบ
// ทั้ง helmet/rate limit/requireAuth/requireConsent/requireAdmin) แล้วยิงด้วย fetch
// จริงพร้อม JWT ที่เซ็นด้วย Secret ทดสอบ — ครอบ "เส้นทางทั้งเส้นตั้งแต่ Header ถึง DB"
//
// สิ่งที่ครอบเพิ่มและชั้น Service ครอบไม่ได้เลย:
//   - Route Mount ผิดตัว / ลืม Mount Middleware ที่ Router ตัวใดตัวหนึ่ง
//   - Controller ที่หยิบ id จาก req.params แต่ลืมส่ง req.user.id ต่อลงไป
//   - Middleware ที่เรียงผิดลำดับจน Auth ถูกข้าม
//
// ── กติกาของไฟล์นี้ ────────────────────────────────────────────────────────
// A = ผู้โจมตี (Token ของตัวเอง ถูกต้องสมบูรณ์) / B = เหยื่อ
// A ยิงทุก Endpoint ด้วย "id ของ B" → ต้องได้ 403/404 เสมอ ห้ามได้ 200 และห้ามมี
// ข้อมูลลับของ B หลุดออกมาใน Response แม้แต่ Field เดียว
//
// ⚠️ 404 ถือว่าถูกต้อง (ดีกว่า 403 ด้วยซ้ำ): ตอบ 404 เหมือนกันทั้งกรณี "ไม่มีจริง"
// และ "ไม่ใช่ของคุณ" ทำให้ผู้โจมตี Enumerate ไม่ได้ว่า id ไหนมีอยู่จริง
// ⚠️ ห้ามแก้เทสต์นี้ให้ยอมรับ 200 เด็ดขาด — ถ้าวันหนึ่งมันแดง แปลว่ามีช่องโหว่จริง
// ═══════════════════════════════════════════════════════════════════════════

// ── Env ต้องพร้อมก่อน require App (config/env Validate ตอน import) ───────────
process.env.LINE_CHANNEL_SECRET = 'test-line-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.JWT_SECRET = 'test-jwt-secret-for-idor-regression-suite';
// ADMIN_LINE_USER_IDS ต้องว่าง — A และ B ต้องไม่ใช่ Admin ทั้งคู่ (ถ้าเผลอเป็น Admin
// เทสต์จะเขียวเพราะ "มีสิทธิ์จริง" ไม่ใช่เพราะ Ownership Filter ทำงาน)
process.env.ADMIN_LINE_USER_IDS = '';
// index.js บังคับ FRONTEND_URL ตั้งแต่ Startup (ห้าม CORS Fallback เป็น Wildcard)
process.env.FRONTEND_URL = 'http://localhost:5173';

// ── Fake Supabase (In-memory, บังคับ .eq() จริง) ────────────────────────────
// ใช้ตัวเดียวกับ crossUserIsolation*.regression.test.js โดยเจตนา — ถ้าถอด
// .eq('user_id', ...) ออกจาก Query ไหน Fake จะคืนแถวของ B ให้ A จริงๆ แล้วเทสต์แดง
jest.mock('../src/config/supabase', () => {
  const { createClient } = require('./helpers/fakeSupabase');
  return { supabaseAdmin: createClient() };
});

// External I/O ที่ไม่เกี่ยวกับ Ownership — Mock ทิ้งเพื่อไม่ให้ยิงเน็ตจริง
jest.mock('../src/services/line.service');
jest.mock('../src/services/storage.service');
jest.mock('../src/services/priceFeed.service');

const { tables, resetTables } = require('./helpers/fakeSupabase');
const authTokenService = require('../src/services/authToken.service');
const storageService = require('../src/services/storage.service');
const app = require('../src/index');

// ── ผู้ใช้ทดสอบ ─────────────────────────────────────────────────────────────
const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'; // ผู้โจมตี
const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'; // เหยื่อ

// id ของ B ที่ A จะเอาไปยิง (UUID จริงทุกตัว — ถ้าใช้ id มั่วๆ จะได้ 404 จาก
// UUID Validate แทนที่จะพิสูจน์ Ownership Filter จริง ซึ่งเป็นการหลอกตัวเอง)
const B_TRANSACTION_ID = 'b1111111-0000-4000-8000-000000000001';
const B_PAYMENT_ID = 'b2222222-0000-4000-8000-000000000002';
const B_PLAN_ID = 'b3333333-0000-4000-8000-000000000003';
const B_FB_REQUEST_ID = 'b4444444-0000-4000-8000-000000000004';
// Stage 1/8 (migration 042-048) — Endpoint ชุดใหม่ที่ยังไม่เคยถูก Audit เป็นชุด
const B_ASSET_ID = 'b5555555-0000-4000-8000-000000000005';
const B_PORTFOLIO_ID = 'b6666666-0000-4000-8000-000000000006';
const B_BROKER_ID = 'b7777777-0000-4000-8000-000000000007';
// ของ A เอง — ใช้พิสูจน์ "id ที่มาทาง Body" (A เป็นเจ้าของ :id จริง แต่พยายาม
// ยัด id ของ B เข้ามาใน Body) ซึ่งเป็นช่องที่การ Grep `:id` ใน routes/ มองไม่เห็นเลย
const A_ASSET_ID = 'a5555555-0000-4000-8000-000000000005';
const A_PORTFOLIO_ID = 'a6666666-0000-4000-8000-000000000006';

// ค่าที่จำเพาะพอจะค้นเจอถ้าหลุดไปอยู่ใน Response ที่ A ได้รับ
const B_SECRETS = [
  'ZZSECRET', // symbol ของ B
  '424242.42', // ยอดเงินของ B
  'b-slip-secret-path.jpg', // path สลิปของ B
  'ความลับของ B', // ข้อความอิสระของ B
  'พอร์ตลับของ B', // ชื่อพอร์ตของ B (migration 044)
  'โบรกลับของ B', // ชื่อโบรกของ B (migration 042)
];

function userRow(id, lineUserId) {
  return {
    id,
    line_user_id: lineUserId,
    display_name: `user ${id.slice(0, 4)}`,
    picture_url: null,
    plan: 'premium',
    plan_expires_at: '2099-01-01T00:00:00.000Z',
    is_locked: false,
    locked_at: null,
    locked_by: null,
    lock_reason: null,
    // ต้อง Consent แล้วทั้งคู่ ไม่งั้นจะติด requireConsent (403 CONSENT_REQUIRED)
    // ซึ่งเป็น "เขียวด้วยเหตุผลผิด" — เราต้องการให้ Request เดินไปถึง Controller จริง
    pdpa_consented_at: '2026-01-01T00:00:00.000Z',
    anonymized_at: null,
    free_trial_claimed_at: null,
    facebook_like_granted_at: null,
    expiry_reminder_sent_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function seed() {
  resetTables({
    users: [userRow(USER_A, 'Uattacker'), userRow(USER_B, 'Uvictim')],

    // ธุรกรรมของ B (มีสลิปแนบ — เป้าหมายของ GET /dashboard/transactions/:id/slip)
    transactions: [
      {
        id: B_TRANSACTION_ID,
        user_id: USER_B,
        asset_symbol: 'ZZSECRET',
        asset_name: 'ความลับของ B',
        asset_type: 'crypto',
        type: 'buy',
        quantity: '13.37',
        price_per_unit: '424242.42',
        amount_thb: '424242.42',
        currency: 'THB',
        fee_thb: 0,
        txn_date: '2026-08-01',
        slip_image_path: 'b-slip-secret-path.jpg',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],

    // สินทรัพย์ของ B (เป้าหมายของ GET /dashboard/profit/:symbol + PATCH /assets/:id)
    // และของ A (ใช้เป็น :id ที่ถูกต้อง เพื่อทดสอบ id ที่ยัดมาทาง Body)
    assets: [
      {
        id: B_ASSET_ID,
        user_id: USER_B,
        symbol: 'ZZSECRET',
        name: 'ความลับของ B',
        asset_type: 'crypto',
        type: 'crypto',
        portfolio_id: B_PORTFOLIO_ID,
        broker_id: B_BROKER_ID,
        sector: null,
        total_quantity: '13.37',
        total_cost_thb: '424242.42',
        is_active: true,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        id: A_ASSET_ID,
        user_id: USER_A,
        symbol: 'AOWN',
        name: 'ของ A เอง',
        asset_type: 'crypto',
        type: 'crypto',
        portfolio_id: A_PORTFOLIO_ID,
        broker_id: null,
        sector: null,
        total_quantity: '1',
        total_cost_thb: '100',
        is_active: true,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],

    // พอร์ตของทั้งคู่ (migration 044) — A มีพอร์ตของตัวเองด้วย เพื่อให้ Control
    // Group พิสูจน์ได้ว่า A ใช้งานของตัวเองได้ปกติ ไม่ใช่ทุกอย่างพังเหมือนกันหมด
    portfolios: [
      {
        id: B_PORTFOLIO_ID,
        user_id: USER_B,
        name: 'พอร์ตลับของ B',
        type: 'custom',
        is_default: true,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        id: A_PORTFOLIO_ID,
        user_id: USER_A,
        name: 'พอร์ตของ A',
        type: 'custom',
        is_default: true,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],

    // โบรกของ B (migration 042)
    brokers: [
      {
        id: B_BROKER_ID,
        user_id: USER_B,
        name: 'โบรกลับของ B',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],

    // คำขอชำระเงินของ B (pending + มีสลิปแนบแล้ว)
    payments: [
      {
        id: B_PAYMENT_ID,
        user_id: USER_B,
        billing_period: 'monthly',
        base_amount_thb: 59,
        satang_tag: 42,
        amount_thb: '59.42',
        status: 'pending',
        slip_image_url: 'b-slip-secret-path.jpg',
        slip_hash: 'bhash',
        expires_at: '2099-01-01T00:00:00.000Z',
        amount_released_at: null,
        confirmed_at: null,
        confirmed_by: null,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],

    // แผน DCA ของ B
    dca_reminders: [
      {
        id: B_PLAN_ID,
        user_id: USER_B,
        symbol: 'ZZSECRET',
        name: 'ความลับของ B',
        amount_thb: '424242.42',
        currency: 'THB',
        frequency: 'monthly',
        day_of_month: 1,
        day_of_week: null,
        active: true,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],

    // คำขอ Premium ฟรีของ B (เป้าหมายของ Admin Endpoint — A ไม่ใช่ Admin)
    facebook_like_grant_requests: [
      {
        id: B_FB_REQUEST_ID,
        user_id: USER_B,
        screenshot_path: 'b-slip-secret-path.jpg',
        note: 'ความลับของ B',
        status: 'pending',
        reviewed_at: null,
        reviewed_by: null,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],

    ai_ocr_usage: [],
    premium_grant_logs: [],
    line_webhook_events: [],
    pending_transactions: [],
  });
}

let server;
let baseUrl;
let tokenA;

beforeAll(async () => {
  // Port 0 = ให้ OS เลือกให้ (index.js ไม่ listen เองแล้วเมื่อถูก require — ดู
  // require.main === module ในไฟล์นั้น)
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  tokenA = authTokenService.issueUserToken({
    id: USER_A,
    lineUserId: 'Uattacker',
    // ไม่ใช่ Admin — ยืนยันซ้ำอีกชั้นนอกเหนือจาก ADMIN_LINE_USER_IDS ที่ตั้งว่างไว้
    role: 'user',
  });
});

afterAll(async () => {
  // ⚠️ closeAllConnections() ต้องมาก่อน close() — global fetch (undici) เปิด Socket
  // แบบ keep-alive ค้างไว้ ทำให้ server.close() รอ Connection เหล่านั้นจนไม่จบ แล้ว
  // Jest เตือน "worker process failed to exit gracefully" ตอนรันทั้งชุดพร้อมกัน
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  jest.clearAllMocks();
  seed();
  // ถ้า Ownership พังจนโค้ดเดินไปถึงขั้นเซ็น URL จริง เราอยากให้ path ของ B โผล่ใน
  // Response ชัดๆ (จะได้จับได้) — ไม่ใช่คืน null เงียบๆ แล้วดูเหมือนปลอดภัย
  storageService.createTransactionSlipSignedUrl.mockImplementation(async (p) =>
    p ? `https://cdn.test/signed/${p}` : null
  );
  storageService.createPaymentSlipSignedUrl.mockImplementation(async (p) =>
    p ? `https://cdn.test/signed/${p}` : null
  );
});

// ── Helper ยิง Request ในนามของ A ──────────────────────────────────────────
async function asA(method, path, { body, contentType } = {}) {
  const headers = { authorization: `Bearer ${tokenA}` };
  let payload;

  if (body !== undefined) {
    if (contentType) {
      headers['content-type'] = contentType;
      payload = body;
    } else {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, text };
}

// ═══════════════════════════════════════════════════════════════════════════
// 14 Endpoint ที่รับ :id / :symbol จาก Client
// ═══════════════════════════════════════════════════════════════════════════
// รายการนี้มาจากการ Grep `router.(get|post|patch|delete)` ที่มี Path Parameter ใน
// src/routes/ ทั้งหมด — ถ้าเพิ่ม Endpoint ใหม่ที่รับ :id ต้องเพิ่มเข้ามาที่นี่ด้วย
const IDOR_CASES = [
  // ── ข้อมูลการลงทุนของ B ────────────────────────────────────────────────
  {
    name: 'GET /dashboard/profit/:symbol — ดูกำไร/ขาดทุนของสินทรัพย์ B',
    method: 'GET',
    path: '/api/v1/dashboard/profit/ZZSECRET',
    // ⚠️ Endpoint นี้รับ "symbol" ไม่ใช่ id — symbol ของ B ไม่ใช่ความลับในตัวมันเอง
    // (A เดา 'BTC' ได้อยู่แล้ว) สิ่งที่ต้องกันคือ "ตัวเลขของ B" ต้องไม่โผล่ออกมา
    // 404 = A ไม่มีสินทรัพย์ตัวนี้ ซึ่งถูกต้อง
    allow: [404, 403],
  },
  {
    name: 'GET /dashboard/transactions/:id/slip — เปิดรูปสลิปธุรกรรมของ B',
    method: 'GET',
    path: `/api/v1/dashboard/transactions/${B_TRANSACTION_ID}/slip`,
    allow: [404, 403],
  },
  {
    name: 'POST /transactions/:id/slip — แนบสลิปทับธุรกรรมของ B',
    method: 'POST',
    path: `/api/v1/transactions/${B_TRANSACTION_ID}/slip`,
    body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    contentType: 'image/jpeg',
    allow: [404, 403],
  },

  // ── แผน DCA ของ B ──────────────────────────────────────────────────────
  {
    name: 'PATCH /dca-plans/:id — แก้แผน DCA ของ B',
    method: 'PATCH',
    path: `/api/v1/dca-plans/${B_PLAN_ID}`,
    body: { amountTotal: 1 },
    allow: [404, 403],
  },
  {
    name: 'DELETE /dca-plans/:id — ลบแผน DCA ของ B',
    method: 'DELETE',
    path: `/api/v1/dca-plans/${B_PLAN_ID}`,
    allow: [404, 403],
  },

  // ── เส้นทางเงินของ B ───────────────────────────────────────────────────
  {
    name: 'POST /payment/:id/slip — แนบสลิปโอนเงินเข้าคำขอของ B',
    method: 'POST',
    path: `/api/v1/payment/${B_PAYMENT_ID}/slip`,
    body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    contentType: 'image/jpeg',
    allow: [404, 403],
  },
  {
    name: 'POST /payment/:id/notify — แจ้งชำระเงินแทนคำขอของ B',
    method: 'POST',
    path: `/api/v1/payment/${B_PAYMENT_ID}/notify`,
    allow: [404, 403],
  },

  // ── Admin Endpoint — A ไม่ใช่ Admin ต้องโดน 403 ทุกตัว ──────────────────
  // ด่านที่กันคือ requireAdmin (ไม่ใช่ Ownership Filter) แต่ต้องพิสูจน์ว่าด่านนั้น
  // ถูก Mount จริงบนทุก Route ของ Router ตัวนี้ ไม่ใช่แค่บางตัว
  {
    name: 'POST /admin/users/:id/grant-premium — แจก Premium ให้ตัวเอง/คนอื่น',
    method: 'POST',
    path: `/api/v1/admin/users/${USER_A}/grant-premium`,
    body: { billingPeriod: 'yearly' },
    allow: [403],
  },
  {
    name: 'POST /admin/users/:id/lock — ล็อกบัญชี B (F7)',
    method: 'POST',
    path: `/api/v1/admin/users/${USER_B}/lock`,
    body: { reason: 'hostile takeover' },
    allow: [403],
  },
  {
    name: 'POST /admin/users/:id/unlock — ปลดล็อกบัญชี (F7)',
    method: 'POST',
    path: `/api/v1/admin/users/${USER_B}/unlock`,
    allow: [403],
  },
  {
    name: 'POST /admin/facebook-like-requests/:id/approve — อนุมัติคำขอของ B',
    method: 'POST',
    path: `/api/v1/admin/facebook-like-requests/${B_FB_REQUEST_ID}/approve`,
    allow: [403],
  },
  {
    name: 'POST /admin/facebook-like-requests/:id/reject — ปฏิเสธคำขอของ B',
    method: 'POST',
    path: `/api/v1/admin/facebook-like-requests/${B_FB_REQUEST_ID}/reject`,
    body: { reason: 'nope' },
    allow: [403],
  },
  // ── Stage 1/8 — Endpoint ชุดใหม่ (migration 042-048) ────────────────────
  // ⚠️ ชุดนี้เพิ่มเข้ามาตอน Audit ก่อน Apply migration (27 ส.ค. 2569) — ก่อนหน้านั้น
  // Endpoint ทั้งหมดนี้ **ไม่เคยถูกครอบด้วยเทสต์ IDOR ระดับ HTTP เลยสักตัว**
  {
    name: 'GET /portfolios/:id — ดูพอร์ตของ B',
    method: 'GET',
    path: `/api/v1/portfolios/${B_PORTFOLIO_ID}`,
    allow: [403, 404],
  },
  {
    name: 'PATCH /portfolios/:id — เปลี่ยนชื่อพอร์ตของ B',
    method: 'PATCH',
    path: `/api/v1/portfolios/${B_PORTFOLIO_ID}`,
    body: { name: 'ถูกยึดแล้ว' },
    allow: [403, 404],
  },
  {
    name: 'PATCH /portfolios/:id — ยึดพอร์ตของ B มาเป็นพอร์ตหลักของ A',
    method: 'PATCH',
    path: `/api/v1/portfolios/${B_PORTFOLIO_ID}`,
    body: { isDefault: true },
    allow: [403, 404],
  },
  {
    name: 'DELETE /portfolios/:id — ลบพอร์ตของ B',
    method: 'DELETE',
    path: `/api/v1/portfolios/${B_PORTFOLIO_ID}`,
    allow: [403, 404],
  },
  {
    name: 'PATCH /assets/:id — แก้ป้ายกำกับสินทรัพย์ของ B',
    method: 'PATCH',
    path: `/api/v1/assets/${B_ASSET_ID}`,
    body: { sector: 'ถูกยึดแล้ว' },
    allow: [403, 404],
  },
  {
    name: 'PATCH /brokers/:id — เปลี่ยนชื่อโบรกของ B',
    method: 'PATCH',
    path: `/api/v1/brokers/${B_BROKER_ID}`,
    body: { name: 'ถูกยึดแล้ว' },
    allow: [403, 404],
  },
  {
    name: 'DELETE /brokers/:id — ลบโบรกของ B',
    method: 'DELETE',
    path: `/api/v1/brokers/${B_BROKER_ID}`,
    allow: [403, 404],
  },
  {
    name: 'POST /transactions/dividend — บันทึกปันผลเข้าสินทรัพย์ของ B',
    method: 'POST',
    path: '/api/v1/transactions/dividend',
    body: { assetId: B_ASSET_ID, amountThb: 100, quantity: 1, date: '2026-08-01' },
    allow: [400, 403, 404],
  },

  // ── ⭐ id ที่มาทาง Body — ช่องที่การ Grep `:id` ใน routes/ มองไม่เห็น ──────
  // A เป็นเจ้าของ :id จริง (ผ่าน Ownership ของ Resource หลักไปแล้ว) แล้วค่อยยัด
  // id ของ B เข้ามาใน Body — ถ้าชั้น Service ไม่ยืนยันเจ้าของของ **ทุก id ใน Body**
  // A จะผูกสินทรัพย์ตัวเองเข้ากับพอร์ต/โบรกของ B ได้สำเร็จโดยไม่มีอะไรเตือน
  {
    name: '⭐ PATCH /assets/:id (ของ A) — ย้ายเข้าพอร์ตของ B ผ่าน Body',
    method: 'PATCH',
    path: `/api/v1/assets/${A_ASSET_ID}`,
    body: { portfolioId: B_PORTFOLIO_ID },
    allow: [403, 404],
  },
  {
    name: '⭐ PATCH /assets/:id (ของ A) — ผูกโบรกของ B ผ่าน Body',
    method: 'PATCH',
    path: `/api/v1/assets/${A_ASSET_ID}`,
    body: { brokerId: B_BROKER_ID },
    allow: [403, 404],
  },

  {
    name: 'GET /admin/payments — รายการชำระเงินของทุกคน',
    method: 'GET',
    path: '/api/v1/admin/payments',
    allow: [403],
  },
  {
    name: 'GET /admin/users — รายชื่อผู้ใช้ทั้งหมด',
    method: 'GET',
    path: '/api/v1/admin/users',
    allow: [403],
  },
];

describe('IDOR End-to-End — A ยิงด้วย id ของ B ผ่าน HTTP จริง', () => {
  test('ครอบครบทุก Endpoint ที่รับ Path Parameter (กันลืมเพิ่มตอนมี Route ใหม่)', () => {
    // ⚠️ เพิ่ม Endpoint ใหม่ที่รับ id จาก Client (ทั้งทาง Path **และทาง Body**)
    // ต้องมาเพิ่มเคสที่นี่ด้วยเสมอ แล้วอัปเดตเลขนี้
    expect(IDOR_CASES).toHaveLength(24);
  });

  test.each(IDOR_CASES.map((c) => [c.name, c]))('%s', async (_name, c) => {
    const { status, text } = await asA(c.method, c.path, {
      body: c.body,
      contentType: c.contentType,
    });

    // 1) ห้าม 200 เด็ดขาด
    expect(status).not.toBe(200);
    // 2) ต้องเป็น Status ที่ตั้งใจปฏิเสธ ไม่ใช่ 500 (500 = หลุดไปถึง DB แล้วพัง
    //    ซึ่งแปลว่า Guard ไม่ได้ทำงานตั้งแต่ต้นทาง)
    expect(c.allow).toContain(status);
    // 3) ข้อมูลลับของ B ต้องไม่โผล่ใน Response แม้แต่ Field เดียว
    for (const secret of B_SECRETS) {
      expect(text).not.toContain(secret);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Control Group — พิสูจน์ว่าเทสต์ด้านบน "เขียวเพราะ Ownership Filter ทำงาน"
// ไม่ใช่เพราะ App พังจนทุก Request ตอบ Error เหมือนกันหมด
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ขาดส่วนนี้ไป เทสต์ทั้งไฟล์จะไร้ค่าทันที: ถ้า App โยน 500 ทุก Request (เช่น
// Fake Supabase เพี้ยน) เทสต์ด้านบนก็ยัง "ไม่ได้ 200" ครบทุกข้อเหมือนกัน
// ═══════════════════════════════════════════════════════════════════════════
// GET /portfolio/allocation?portfolioId=<ของ B> — เคสที่ "ตอบ 200 ได้อย่างถูกต้อง"
// ═══════════════════════════════════════════════════════════════════════════
// ต่างจากเคสอื่นตรงที่ Endpoint นี้ **ไม่ได้ assertOwned portfolioId โดยเจตนา** —
// allocation.service กรองจาก holdings ที่ getPortfolioSummary(userId) คืนมา ซึ่ง
// Scope ด้วย userId อยู่แล้ว การส่ง portfolioId ของคนอื่นมาจึงได้ผลลัพธ์ "ว่าง"
// ไม่ใช่ข้อมูลของคนอื่น (และ 200+ว่าง ปลอดภัยกว่า 404 ด้วยซ้ำ เพราะไม่ยืนยันว่า
// พอร์ตนั้นมีอยู่จริง)
//
// ⚠️ เทสต์นี้คือสิ่งที่พิสูจน์ว่า **คอมเมนต์ในโค้ดที่อ้างแบบนั้นเป็นความจริง**
// ไม่ใช่แค่ข้อความที่เขียนไว้แล้วไม่มีใครตรวจ (portfolios.controller.js § getAllocation)
describe('GET /portfolio/allocation — ส่ง portfolioId ของ B มาต้องได้ "ว่าง" ไม่ใช่ของ B', () => {
  test('⭐ ตอบได้ปกติ แต่ต้องไม่มีข้อมูลของ B หลุดออกมาแม้แต่ Field เดียว', async () => {
    const { status, text } = await asA(
      'GET',
      `/api/v1/portfolio/allocation?groupBy=assetType&portfolioId=${B_PORTFOLIO_ID}`
    );

    expect([200, 403, 404]).toContain(status);
    for (const secret of B_SECRETS) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('Control Group — A เข้าถึงของตัวเองได้ปกติ', () => {
  test('GET /dashboard/me ด้วย Token ของ A → 200 (App ทำงานจริง ไม่ได้พังทั้งก้อน)', async () => {
    const { status, text } = await asA('GET', '/api/v1/dashboard/me');
    expect(status).toBe(200);
    // และต้องเป็นข้อมูลของ A เท่านั้น ไม่ปนของ B
    for (const secret of B_SECRETS) {
      expect(text).not.toContain(secret);
    }
  });

  test('ไม่มี Token เลย → 401 (ไม่ใช่ 403/404 — แยกออกว่าเป็นคนละด่านกัน)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/me`);
    expect(res.status).toBe(401);
  });

  test('Token ปลอม (เซ็นด้วย Secret อื่น) → 401 INVALID_TOKEN', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ sub: USER_B, lineUserId: 'Uvictim' }, 'wrong-secret');
    const res = await fetch(`${baseUrl}/api/v1/dashboard/me`, {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('INVALID_TOKEN');
  });

  // ⚠️ เคสที่สำคัญที่สุดในกลุ่มนี้: Token ที่ "เซ็นถูกต้อง" แต่ sub ชี้ไปที่ B
  // ถ้าใครเผลอทำ Secret หลุด นี่คือสิ่งที่เกิดขึ้น — และเป็นเหตุผลที่ Ownership
  // Filter ต้องยึด req.user.id จาก Token เสมอ ห้ามรับ userId จาก Body/Query
  test('Token ของ B (เซ็นถูกต้อง) → เห็นได้แค่ข้อมูล B ไม่ใช่ของ A (Token = ขอบเขตสิทธิ์)', async () => {
    const tokenB = authTokenService.issueUserToken({
      id: USER_B,
      lineUserId: 'Uvictim',
      role: 'user',
    });
    const res = await fetch(
      `${baseUrl}/api/v1/dashboard/transactions/${B_TRANSACTION_ID}/slip`,
      { headers: { authorization: `Bearer ${tokenB}` } }
    );
    // B เปิดสลิปของ B เองได้ = Endpoint ทำงานได้จริง แปลว่า 404 ที่ A ได้รับด้านบน
    // มาจาก Ownership Filter จริงๆ ไม่ใช่เพราะ Endpoint นี้พังอยู่แล้ว
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('b-slip-secret-path.jpg');
  });
});
