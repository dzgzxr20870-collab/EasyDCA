require('dotenv').config();

// รายชื่อตัวแปรที่ "จำเป็นจริง" ต่อการทำงานของ Backend ใน Phase 1 เท่านั้น
// บังคับแค่ 4 ตัวนี้เพราะเป็นตัวเดียวที่โค้ดปัจจุบันเรียกใช้แล้วขาดไม่ได้:
//   - LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN → Webhook + ส่งข้อความ LINE
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY        → เชื่อมต่อฐานข้อมูล
//
// ตัวแปรอื่นถูกถอดออกจาก required (แต่ยังคง key ไว้ใน config ที่ export ด้านล่าง)
// เพราะยังไม่ได้ถูกใช้จริงใน Phase 1 — การบังคับจะทำให้ Deploy บน Railway crash โดยไม่จำเป็น:
//   - LINE_NOTIFY_TOKEN → LINE Notify ปิดบริการแล้ว ขอ Token ใหม่ไม่ได้
//   - LIFF_ID, JWT_SECRET, APP_URL → รอ Phase 2 (Web UI / LIFF Login)
//   - SUPABASE_ANON_KEY, DATABASE_URL → Backend ใช้ Service Role Key ตรงอยู่แล้ว
//   - NODE_ENV → Railway มักเซ็ต production ให้เอง การไม่บังคับปลอดภัยกว่า
//   - CLAUDE_API_KEY, TWELVE_DATA_API_KEY → optional ตามเดิม (Fallback คืน null ถ้าไม่มี)
const REQUIRED_ENV_VARS = [
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}\n` +
        'ดูรายละเอียดตัวแปรที่ต้องตั้งค่าที่ docs/ENV_VARIABLES.md'
    );
  }
}

validateEnv();

module.exports = {
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    notifyToken: process.env.LINE_NOTIFY_TOKEN,
    liffId: process.env.LIFF_ID,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: process.env.DATABASE_URL,
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    // Default ย่นจาก 7d → 24h (S6 Part A, ก่อน Beta Launch) — จำกัด Blast Radius ถ้า
    // Token หลุด/ถูกขโมย โดยไม่กระทบ UX มาก เพราะ Re-auth ของ LIFF (liffAuth.service)
    // เป็น Handshake อัตโนมัติเกือบทั้งหมด: Frontend (api.js) เจอ 401 แล้ว Redirect ไป
    // '/' ทันที ซึ่ง Login.jsx เช็ค liff.isLoggedIn() แล้วขอ Token ใหม่ให้เองโดยไม่ต้อง
    // ให้ User กดอะไรเพิ่ม ตราบใดที่ยัง Login LINE ค้างอยู่ (กรณีปกติเกือบทั้งหมดเมื่อเปิด
    // ผ่าน LINE App) — ยังคง Override ผ่าน ENV ได้ตามเดิม ไม่ Hardcode
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  // LIFF (Phase 2 — LIFF Login) — ยังไม่บังคับ (ไม่อยู่ใน REQUIRED_ENV_VARS)
  // เหมือน TWELVE_DATA_API_KEY เพราะยังเป็น Phase 2 ที่กำลังพัฒนา
  //   - LIFF_ID: มีค่าจริงแล้วบน Railway (2010586158-DO9yzmaP)
  //   - LIFF_CHANNEL_ID: ⚠️ ต้องเพิ่ม Environment Variable ใหม่นี้บน Railway
  //     ด้วยค่า "2010586158" (Channel ID ของ LINE Login Channel สำหรับ LIFF App นี้)
  //     ก่อน Deploy — liffAuth.service ใช้ตรวจ client_id ของ Access Token ให้ตรง
  //     Channel (กัน Token จาก LIFF App อื่นมาสวมสิทธิ์) ถ้าไม่ตั้งจะ Verify ไม่ผ่าน
  liff: {
    id: process.env.LIFF_ID || null,
    channelId: process.env.LIFF_CHANNEL_ID || null,
  },
  app: {
    url: process.env.APP_URL,
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT || 3000,
    // Frontend URL จริง (React App บน Vercel/Railway ฯลฯ) — ใช้จำกัด CORS Origin
    // ยังไม่บังคับเพราะยังไม่รู้ URL จนกว่าจะ Deploy Frontend สำเร็จ (ดู index.js)
    frontendUrl: process.env.FRONTEND_URL || null,
    // Base URL ของ Backend ตัวนี้ (Public) — ใช้ประกอบ URL รูป QR ที่ LINE ต้อง
    // Fetch ได้จากภายนอก (Image component ใน Flex Message ต้องเป็น https ที่เข้าถึง
    // ได้จริง) Phase 2 Step 3 รอบ 3 | ตั้ง PUBLIC_BASE_URL บน Railway ให้เป็น URL
    // ของ Service นี้ (เช่น https://easydca-backend.up.railway.app) — Fallback ไป
    // APP_URL ถ้ามี มิฉะนั้น null (จะประกอบ URL ไม่ได้ ต้องตั้งค่าก่อนใช้ปุ่ม Premium)
    publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.APP_URL || null,
  },
  claude: {
    apiKey: process.env.CLAUDE_API_KEY || null,
  },
  // Twelve Data — Price Feed หุ้นสหรัฐ (stock_us) + อัตราแลกเปลี่ยน USD/THB
  // ยังไม่บังคับ (ไม่อยู่ใน REQUIRED_ENV_VARS) เพราะยังไม่มี Key จริง — ถ้าไม่ตั้ง
  // ค่า priceFeed.service จะคืน null สำหรับหุ้นสหรัฐ (Fallback ตามเดิม ไม่ Crash)
  twelveData: {
    apiKey: process.env.TWELVE_DATA_API_KEY || null,
  },
  // SEC Open Data API — Price Feed กองทุนรวมไทย (Round 7)
  // ⚠️ ไม่บังคับใน REQUIRED_ENV_VARS — ถ้าไม่ตั้งค่า priceFeed/mutualFund service จะ
  // Fail Gracefully (โยน SEC_NOT_CONFIGURED โดยไม่ยิง Request) ไม่ Crash ทั้งระบบ
  //   - SEC_API_SUBSCRIPTION_KEY: Ocp-Apim-Subscription-Key (Product Owner ขอจาก Portal)
  //   - SEC_FUND_MASTER_LIST_PATH: ⚠️ Path ของ Endpoint 2 (Fund Master List) ยัง
  //     "UNVERIFIED" — ต้อง Copy Path เต็มจริงจาก SEC Portal มาใส่ก่อนใช้งาน Production
  //     (Endpoint 1 NAV Path ยืนยันแล้ว Hardcode ใน priceFeed.service ได้; เฉพาะ
  //     Endpoint 2 ที่ยังไม่ยืนยันจึงทำเป็น Env Override เต็ม)
  sec: {
    subscriptionKey: process.env.SEC_API_SUBSCRIPTION_KEY || null,
    fundMasterListPath: process.env.SEC_FUND_MASTER_LIST_PATH || null,
  },
  // Payment (Phase 2 Step 3 — Premium ผ่าน PromptPay QR + ต่ออายุเอง)
  // ⚠️ ไม่บังคับใน REQUIRED_ENV_VARS (ตามบทเรียน Audit — บังคับเฉพาะ 4 ตัวที่ boot
  // ต้องใช้จริง) ตัวเหล่านี้ค่อย Validate ตอนเรียกใช้จริงในรอบ 2 (สร้าง QR/อนุมัติ)
  //   - PROMPTPAY_ID: เบอร์พร้อมเพย์/เลขบัตรที่รับเงิน (ยังไม่มีค่า = null)
  //   - ADMIN_LINE_USER_IDS: line_user_id ของ Admin ที่อนุมัติได้ (คั่นด้วย ',')
  //   - PREMIUM_PRICE_MONTHLY/YEARLY: ราคา Default 59 / 590 บาท
  payment: {
    promptpayId: process.env.PROMPTPAY_ID || null,
    adminLineUserIds: (process.env.ADMIN_LINE_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    premiumPriceMonthly: Number(process.env.PREMIUM_PRICE_MONTHLY || 59),
    premiumPriceYearly: Number(process.env.PREMIUM_PRICE_YEARLY || 590),
  },
};
