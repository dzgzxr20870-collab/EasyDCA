const { createClient } = require('@supabase/supabase-js');
const config = require('./env');

// service_role key — Bypass RLS ทั้งหมด ใช้เฉพาะฝั่ง Backend เท่านั้น
// (ดู docs/DATABASE.md § 3 Row Level Security)
const supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = { supabaseAdmin };
