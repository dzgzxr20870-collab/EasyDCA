require('dotenv').config();

// รายชื่อตัวแปรที่จำเป็น (จาก docs/ENV_VARIABLES.md คอลัมน์ "จำเป็น = ✅")
// ไม่รวม CLAUDE_API_KEY เพราะยังไม่ต้องใช้จนถึง Phase 4
const REQUIRED_ENV_VARS = [
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_NOTIFY_TOKEN',
  'LIFF_ID',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'JWT_SECRET',
  'APP_URL',
  'NODE_ENV',
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
};
