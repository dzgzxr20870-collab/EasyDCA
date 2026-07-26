const { EventEmitter } = require('events');
const zlib = require('zlib');

jest.mock('child_process');
const { spawn } = require('child_process');
const { runPgDump } = require('../src/utils/pgDump.util');

const PG_DUMP_BIN = '/app/vendor-pg17/pg_dump';
const PG_DUMP_LIB_DIR = '/app/vendor-pg17';

// จำลอง Child Process ของ pg_dump — stdout/stderr เป็น Readable-like EventEmitter
// เพียงพอสำหรับ .pipe()/.on('data') ที่ pgDump.util ใช้จริง (ไม่ต้อง Mock ทั้ง Stream
// API เต็มรูปแบบ)
function fakeChildProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdout.pipe = jest.fn((dest) => {
    proc.stdout.on('data', (chunk) => dest.write(chunk));
    proc.stdout.on('end', () => dest.end());
    return dest;
  });
  proc.stderr = new EventEmitter();
  return proc;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runPgDump', () => {
  test('สำเร็จ: stdout → gzip → resolve เป็น Buffer ที่ gunzip กลับมาได้ตรงเนื้อหาเดิม', async () => {
    const proc = fakeChildProcess();
    spawn.mockReturnValue(proc);

    const promise = runPgDump('postgresql://fake');
    proc.stdout.emit('data', Buffer.from('-- SQL dump content --'));
    proc.stdout.emit('end');
    proc.emit('close', 0);

    const gzipped = await promise;
    const original = zlib.gunzipSync(gzipped).toString('utf-8');
    expect(original).toBe('-- SQL dump content --');
  });

  // pg_dump 17 + libpq.so.5 (+ Shared Lib ที่ ldd รายงานทั้งหมด) ถูก Vendor ไว้ที่
  // /app/vendor-pg17 ตอน Build (ดู backend/railpack.json) — Path นี้ "ไม่ใช่" Path
  // ระบบ (/usr/bin) เพราะ Deploy Image ของ Railpack ดึงมาจาก Step "build" เฉพาะ Path
  // ที่มันรู้จัก (/app) เท่านั้น ไฟล์ที่ก็อปไว้นอก /app จะหายไปตอน Deploy จริง — พิสูจน์
  // แล้วจากการทดสอบจริงบน Railway Test Service ก่อน Apply เข้า Production
  //
  // LD_LIBRARY_PATH ต้องชี้ไปที่โฟลเดอร์เดียวกัน — libpq.so.5 ที่ Vendor ไว้ไม่ได้อยู่
  // ใน Path ที่ Dynamic Linker ค้นหาโดย Default ถ้าไม่ตั้งจะ Error หา Shared Library
  // ไม่เจอทันที (ยืนยันจาก Error จริงตอนทดสอบ: "error while loading shared libraries")
  test('เรียก Binary ที่ Vendor ไว้ (/app/vendor-pg17/pg_dump) พร้อม LD_LIBRARY_PATH ชี้ไปที่โฟลเดอร์เดียวกัน', async () => {
    const proc = fakeChildProcess();
    spawn.mockReturnValue(proc);

    const promise = runPgDump('postgresql://fake');
    proc.stdout.emit('end');
    proc.emit('close', 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      PG_DUMP_BIN,
      ['postgresql://fake', '--no-owner', '--no-privileges'],
      expect.objectContaining({ env: expect.objectContaining({ LD_LIBRARY_PATH: PG_DUMP_LIB_DIR }) })
    );
  });

  test('pg_dump Exit Code ไม่ใช่ 0 → Reject พร้อม stderr ที่รวบรวมไว้', async () => {
    const proc = fakeChildProcess();
    spawn.mockReturnValue(proc);

    const promise = runPgDump('postgresql://fake');
    proc.stderr.emit('data', Buffer.from('pg_dump: error: connection failed'));
    // stdout ต้อง 'end' เสมอเมื่อ Process ปิด (Node รับประกันเช่นนี้จริง — แม้
    // Process จะไม่เขียนอะไรลง stdout เลยก็ตาม) จำลองให้ตรงพฤติกรรมจริง
    proc.stdout.emit('end');
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow(/exited with code 1.*connection failed/s);
  });

  test('Binary หาไม่เจอ (spawn ENOENT) → Reject ด้วยข้อความบอกชัดว่า Binary หาย', async () => {
    const proc = fakeChildProcess();
    spawn.mockReturnValue(proc);

    const promise = runPgDump('postgresql://fake');
    const enoent = new Error('spawn pg_dump ENOENT');
    proc.emit('error', enoent);

    await expect(promise).rejects.toThrow(/binary missing from PATH/);
  });

  test('Exit Code 0 แต่ Error เกิดหลังจากนั้น (Error Event ซ้ำ) → ไม่ Resolve/Reject ซ้ำ (Settled Guard)', async () => {
    const proc = fakeChildProcess();
    spawn.mockReturnValue(proc);

    const promise = runPgDump('postgresql://fake');
    proc.stdout.emit('data', Buffer.from('ok'));
    proc.stdout.emit('end');
    proc.emit('close', 0);
    // ยิง Error ซ้ำหลัง Settled แล้ว — ต้องไม่ทำให้ Promise เปลี่ยนสถานะหรือ Throw ออกมา
    proc.emit('error', new Error('late error, should be ignored'));

    await expect(promise).resolves.toBeInstanceOf(Buffer);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Race Condition (บั๊กจริงจาก Production — พบระหว่างสืบเรื่อง Backup 53 ไบต์):
  // pg_dump ที่ล้มเหลว "เร็ว" (Exit ก่อนเขียน stdout อะไรเลย เช่น DATABASE_URL ผิด/
  // ต่อ Database ไม่ได้) ทำให้ Job คิดว่า Backup สำเร็จ (Resolve เป็น Buffer ว่าง)
  // ทั้งที่ pg_dump Fail จริง เพราะ Node รับประกันว่า stdout 'end' มาก่อน Process
  // 'close' เสมอ — โค้ดเดิม Resolve ทันทีตอน gzip 'end' โดยไม่รอรู้ Exit Code จริงก่อน
  //
  // Repro แยก (Node Script นอก Test Suite) ยืนยันแล้วว่า Bug เดิม Resolve ผิด 20/20
  // รอบ — Test ชุดนี้จำลอง Event Order เดียวกันเป๊ะ (stdout end มาก่อน close) เพื่อ
  // พิสูจน์ว่าโค้ดใหม่ "รอทั้งสอง Signal" ก่อนตัดสินเสมอ ไม่ว่า Event ไหนมาก่อนกัน
  // ═══════════════════════════════════════════════════════════════════════
  describe('Race Condition — stdout \'end\' มาก่อน process \'close\' (Fail เร็ว ไม่เขียน stdout)', () => {
    test('stdout end ก่อน close(1) → ต้อง Reject ไม่ใช่ Resolve เป็น Buffer ว่าง', async () => {
      const proc = fakeChildProcess();
      spawn.mockReturnValue(proc);

      const promise = runPgDump('postgresql://fake');
      // จำลองบั๊กเดิม: stdout จบ (0 byte) "ก่อน" close จะรู้ Exit Code
      proc.stdout.emit('end');
      proc.stderr.emit('data', Buffer.from('connection to server failed'));
      proc.emit('close', 1);

      await expect(promise).rejects.toThrow(/exited with code 1.*connection to server failed/s);
    });

    test('stdout end ก่อน close(0) (ปกติ) → ยัง Resolve ถูกต้องเหมือนเดิม (ไม่ Regression)', async () => {
      const proc = fakeChildProcess();
      spawn.mockReturnValue(proc);

      const promise = runPgDump('postgresql://fake');
      proc.stdout.emit('data', Buffer.from('data'));
      proc.stdout.emit('end');
      proc.emit('close', 0);

      await expect(promise).resolves.toBeInstanceOf(Buffer);
    });

    test('spawn ENOENT ก่อน stdout end ใดๆ → ยัง Reject ทันทีเหมือนเดิม (ไม่ต้องรอ gzip)', async () => {
      const proc = fakeChildProcess();
      spawn.mockReturnValue(proc);

      const promise = runPgDump('postgresql://fake');
      proc.emit('error', new Error('spawn pg_dump ENOENT'));

      await expect(promise).rejects.toThrow(/binary missing from PATH/);
    });
  });
});
