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
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  app: {
    url: process.env.APP_URL,
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT || 3000,
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
};
