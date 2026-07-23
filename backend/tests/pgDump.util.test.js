const { EventEmitter } = require('events');
const zlib = require('zlib');

jest.mock('child_process');
const { spawn } = require('child_process');
const { runPgDump } = require('../src/utils/pgDump.util');

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
    expect(spawn).toHaveBeenCalledWith('pg_dump', ['postgresql://fake', '--no-owner', '--no-privileges']);
  });

  test('pg_dump Exit Code ไม่ใช่ 0 → Reject พร้อม stderr ที่รวบรวมไว้', async () => {
    const proc = fakeChildProcess();
    spawn.mockReturnValue(proc);

    const promise = runPgDump('postgresql://fake');
    proc.stderr.emit('data', Buffer.from('pg_dump: error: connection failed'));
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
});
