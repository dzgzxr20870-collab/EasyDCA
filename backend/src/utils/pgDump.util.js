const { spawn } = require('child_process');
const zlib = require('zlib');

// รัน `pg_dump` ชี้ไปที่ DATABASE_URL แล้ว Pipe stdout ผ่าน gzip ทันที (Stream ต่อ
// Stream ไม่พักเป็นไฟล์ชั่วคราวบน Disk) คืน Buffer ที่บีบอัดแล้ว พร้อมอัปโหลดต่อ
//
// ⚠️ ต้องมี Binary `pg_dump` อยู่ใน PATH ของ Environment ที่รัน (Railway Nixpacks
// Default ของ Node ไม่มีมาให้ — ต้องเพิ่ม nixpacks.toml ประกาศ nixPkgs ["postgresql"]
// ดู backend/nixpacks.toml) ถ้าไม่มี Binary จะ Reject ด้วย Error ที่บอกชัดเจนว่า
// เป็น spawn ENOENT ไม่ใช่ Error จากตัว pg_dump เอง (แยกแยะง่ายตอน Debug)
//
// --no-owner --no-privileges: ตัด Statement SET OWNER/GRANT ที่อ้างอิง Role เฉพาะ
// ของ Supabase Project ต้นทาง (ถ้า Restore เข้า Project อื่นที่ไม่มี Role เดียวกัน
// จะ Error) — Data + Schema ยังครบเหมือนเดิมทุกประการ ตัดแค่ Ownership Metadata
function runPgDump(databaseUrl) {
  return new Promise((resolve, reject) => {
    const pgDump = spawn('pg_dump', [databaseUrl, '--no-owner', '--no-privileges']);
    const gzip = zlib.createGzip();
    const chunks = [];
    let stderr = '';
    let settled = false;
    let closedSuccessfully = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    // ⚠️ ต้องเช็ค closedSuccessfully ก่อนเสมอ: ถ้า pg_dump ปิดด้วย Exit Code 0
    // ไปแล้ว (กำลังรอแค่ gzip Flush ให้จบ) 'error' ที่มาทีหลัง (เช่น Stream ระดับ
    // ต่ำ Error หลัง Process ตายแล้ว) ต้อง "ไม่" ทำให้ Backup ที่จริงๆ สำเร็จแล้ว
    // กลายเป็น Fail ผิดๆ — ต่างจาก 'error' ที่มาก่อน close (spawn ENOENT ฯลฯ) ซึ่ง
    // ยังต้อง Fail ตามปกติ
    pgDump.on('error', (err) => {
      if (closedSuccessfully) return;
      fail(new Error(`pg_dump spawn failed (binary missing from PATH?): ${err.message}`));
    });
    pgDump.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    pgDump.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`pg_dump exited with code ${code}: ${stderr}`));
        return;
      }
      closedSuccessfully = true;
      // รอ gzip Stream 'end' Event ตัดสิน resolve (stdout อาจยัง Flush ผ่าน gzip
      // ไม่หมดตอน Process ปิดพอดี)
    });

    gzip.on('error', fail);
    gzip.on('data', (chunk) => chunks.push(chunk));
    gzip.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    pgDump.stdout.pipe(gzip);
  });
}

module.exports = { runPgDump };
