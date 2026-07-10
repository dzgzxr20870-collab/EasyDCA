// commandParser — คำสั่ง "ส่งออกรายงาน" (Phase 3 Round 8)
const { parseCommand, COMMANDS } = require('../src/services/commandParser.service');

describe('EXPORT_REPORT — ส่งออกรายงาน [ช่วงเวลา]', () => {
  test('"ส่งออกรายงาน" เฉยๆ → Default เดือนนี้', () => {
    expect(parseCommand('ส่งออกรายงาน')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { range: 'month' },
    });
  });

  test('"ส่งออกรายงาน เดือนนี้" → month', () => {
    expect(parseCommand('ส่งออกรายงาน เดือนนี้')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { range: 'month' },
    });
  });

  test('"ส่งออกรายงาน ปีนี้" → year', () => {
    expect(parseCommand('ส่งออกรายงาน ปีนี้')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { range: 'year' },
    });
  });

  test('Custom Range พ.ศ. "01/01/2569 - 30/06/2569" → from/to เป็น ค.ศ. ISO', () => {
    expect(parseCommand('ส่งออกรายงาน 01/01/2569 - 30/06/2569')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { range: 'custom', from: '2026-01-01', to: '2026-06-30' },
    });
  });

  test('Custom Range ค.ศ. "01/01/2026 - 30/06/2026" → ISO ตรงตัว', () => {
    expect(parseCommand('ส่งออกรายงาน 01/01/2026 - 30/06/2026')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { range: 'custom', from: '2026-01-01', to: '2026-06-30' },
    });
  });

  test('Custom from > to → invalid (Controller ตอบวิธีใช้)', () => {
    expect(parseCommand('ส่งออกรายงาน 30/06/2026 - 01/01/2026')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { invalid: true },
    });
  });

  test('วันที่ไม่มีอยู่จริง (31/02) → invalid', () => {
    expect(parseCommand('ส่งออกรายงาน 31/02/2026 - 01/03/2026')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { invalid: true },
    });
  });

  test('ข้อความหลังคำสั่งไม่รู้จัก → invalid (ไม่ใช่ UNKNOWN)', () => {
    expect(parseCommand('ส่งออกรายงาน อาทิตย์นี้')).toEqual({
      command: COMMANDS.EXPORT_REPORT,
      params: { invalid: true },
    });
  });

  test('คำอื่นที่ไม่เกี่ยวข้อง → ยังเป็น UNKNOWN ไม่ถูกดักเป็น Export', () => {
    expect(parseCommand('รายงาน').command).toBe(COMMANDS.UNKNOWN);
  });
});
