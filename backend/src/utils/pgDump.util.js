const { spawn } = require('child_process');
const zlib = require('zlib');

// pg_dump 17 + libpq.so.5 (+ Transitive Shared Lib ทั้งหมดที่ ldd รายงาน — libssl,
// libgssapi_krb5, libldap, libgnutls ฯลฯ) ถูก Vendor ไว้ที่นี่ตอน Build (ดู
// backend/railpack.json + scripts/copy-pg17-deps.sh) — "ไม่ใช่" Path ระบบ (/usr/bin)
// เพราะ Deploy Image ของ Railpack ดึงมาจาก Step "build" เฉพาะ Path ที่มันรู้จัก
// (/app, node_modules) เท่านั้น ไฟล์ที่ก็อปไว้นอก /app จะหายไปตอน Deploy จริง
// (ยืนยันจากการทดสอบจริงบน Railway Test Service ก่อน Apply เข้า Production)
//
// เหตุผลที่ต้อง pg_dump 17 (ไม่ใช่ 15 ที่ apt ของ Debian bookworm ให้มา Default):
// pg_dump ปฏิเสธ Dump จาก Server ที่ Major Version สูงกว่าตัวเองเสมอ (Supabase
// จริงรัน PostgreSQL 17.6) — ยืนยันจาก Error "aborting because of server version
// mismatch" ตอน Debug จริงบน Production
const PG_DUMP_BIN = '/app/vendor-pg17/pg_dump';
const PG_DUMP_LIB_DIR = '/app/vendor-pg17';

// รัน `pg_dump` ชี้ไปที่ DATABASE_URL แล้ว Pipe stdout ผ่าน gzip ทันที (Stream ต่อ
// Stream ไม่พักเป็นไฟล์ชั่วคราวบน Disk) คืน Buffer ที่บีบอัดแล้ว พร้อมอัปโหลดต่อ
//
// LD_LIBRARY_PATH ต้องชี้ไปที่ PG_DUMP_LIB_DIR เสมอ — libpq.so.5 ที่ Vendor ไว้
// "ไม่ได้" อยู่ใน Path ที่ Dynamic Linker ค้นหาโดย Default (/usr/lib/...) ถ้าไม่ตั้ง
// pg_dump จะ Error "error while loading shared libraries: libpq.so.5" ทันที
//
// --no-owner --no-privileges: ตัด Statement SET OWNER/GRANT ที่อ้างอิง Role เฉพาะ
// ของ Supabase Project ต้นทาง (ถ้า Restore เข้า Project อื่นที่ไม่มี Role เดียวกัน
// จะ Error) — Data + Schema ยังครบเหมือนเดิมทุกประการ ตัดแค่ Ownership Metadata
function runPgDump(databaseUrl) {
  return new Promise((resolve, reject) => {
    const pgDump = spawn(PG_DUMP_BIN, [databaseUrl, '--no-owner', '--no-privileges'], {
      env: { ...process.env, LD_LIBRARY_PATH: PG_DUMP_LIB_DIR },
    });
    const gzip = zlib.createGzip();
    const chunks = [];
    let stderr = '';
    let settled = false;

    // ⚠️ Bug ที่เจอจริงบน Production (แก้ในรอบนี้): Node รับประกันว่า Event
    // stdout 'end' ของ Child Process มาก่อน 'close' เสมอ — ถ้า pg_dump ล้มเหลว
    // "เร็ว" (เช่น ต่อ Database ไม่ได้ Exit ทันทีโดยไม่เขียน stdout เลย) การ Pipe
    // เข้า gzip จะจบและ Fire 'end' (Resolve เป็น Buffer ว่าง) ก่อนที่ 'close' จะรู้
    // ว่า Exit Code ไม่ใช่ 0 (Reject) เป็น Race Condition แบบ Deterministic ไม่ใช่
    // Flaky (พิสูจน์แล้วด้วย Repro Script รัน 20 รอบ Resolve ผิดครบ 20/20) ทำให้
    // Backup ที่ pg_dump Fail จริงถูกเข้าใจว่า "สำเร็จ" แล้วอัปโหลดไฟล์ว่างขึ้น R2
    //
    // แก้โดยรอทั้ง "รู้ Exit Code จริง" (closeInfo) และ "gzip จบจริง" (gzipEnded)
    // ก่อนตัดสิน Resolve/Reject เสมอ ไม่ว่า Event ไหนจะมาก่อนกัน
    let closeInfo = null;
    let gzipEnded = false;
    // ⚠️ แยกจาก settled โดยตั้งใจ: ต้องรู้ทันทีที่ 'close' บอกว่า Exit Code เป็น 0
    // (ก่อน gzip จะ Flush เสร็จด้วยซ้ำ) เพื่อกัน Error Event ที่มาทีหลังจาก Stream
    // ระดับต่ำ (หลัง Process ตายไปแล้วจริง) ทำให้ Backup ที่ "จริงๆ สำเร็จแล้ว"
    // กลายเป็น Fail ผิดๆ — ถ้าใช้ settled แทน จะมีช่วงเวลาที่ Close(0) มาแล้วแต่
    // gzip ยัง Flush ไม่เสร็จ (Async) ทำให้ Error ที่มาในช่วงนั้นหลุดไป Reject ได้
    let closedSuccessfully = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const maybeSettle = () => {
      if (settled || !closeInfo || !gzipEnded) return;
      if (closeInfo.code !== 0) {
        fail(new Error(`pg_dump exited with code ${closeInfo.code}: ${stderr}`));
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks));
    };

    pgDump.on('error', (err) => {
      if (closedSuccessfully) return;
      fail(new Error(`pg_dump spawn failed (binary missing from PATH?): ${err.message}`));
    });
    pgDump.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    pgDump.on('close', (code) => {
      closeInfo = { code };
      if (code === 0) closedSuccessfully = true;
      maybeSettle();
    });

    gzip.on('error', fail);
    gzip.on('data', (chunk) => chunks.push(chunk));
    gzip.on('end', () => {
      gzipEnded = true;
      maybeSettle();
    });

    pgDump.stdout.pipe(gzip);
  });
}

module.exports = { runPgDump };
