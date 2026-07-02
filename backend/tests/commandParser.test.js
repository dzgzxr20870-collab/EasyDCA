const { parseCommand, normalizeText, COMMANDS } = require('../src/services/commandParser.service');

describe('commandParser.service', () => {
  describe('BUY — ซื้อ [SYMBOL] [AMOUNT]', () => {
    test('Basic Case: "ซื้อ BTC 1000"', () => {
      expect(parseCommand('ซื้อ BTC 1000')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1000 },
      });
    });

    test('Whitespace เกิน: "ซื้อ  BTC   1000"', () => {
      expect(parseCommand('ซื้อ  BTC   1000')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1000 },
      });
    });

    test('พิมพ์เล็ก: "ซื้อ ptt 500" → เก็บ Symbol เป็นตัวพิมพ์ใหญ่', () => {
      expect(parseCommand('ซื้อ ptt 500')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'PTT', amountThb: 500 },
      });
    });

    test('เลขไทย: "ซื้อ BTC ๑๐๐๐" → 1000', () => {
      expect(parseCommand('ซื้อ BTC ๑๐๐๐')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1000 },
      });
    });

    test('มี Comma: "ซื้อ BTC 1,000" → 1000', () => {
      expect(parseCommand('ซื้อ BTC 1,000')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1000 },
      });
    });

    test('ทศนิยม: "ซื้อ BTC 1,250.50"', () => {
      expect(parseCommand('ซื้อ BTC 1,250.50')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1250.5 },
      });
    });

    test('มีคำว่า "บาท" ต่อท้าย: "ซื้อ BTC 1000 บาท"', () => {
      expect(parseCommand('ซื้อ BTC 1000 บาท')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1000 },
      });
    });

    test('รูปแบบระบุจำนวนหน่วย + ราคา: "ซื้อ PTT 50 หุ้น ราคา 34"', () => {
      expect(parseCommand('ซื้อ PTT 50 หุ้น ราคา 34')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
      });
    });
  });

  describe('SELL — ขาย', () => {
    test('รูปแบบระบุราคา: "ขาย PTT 50 หุ้น ราคา 34"', () => {
      expect(parseCommand('ขาย PTT 50 หุ้น ราคา 34')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
      });
    });

    test('รูปแบบจำนวนเงิน: "ขาย BTC 500"', () => {
      expect(parseCommand('ขาย BTC 500')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'BTC', amountThb: 500 },
      });
    });

    test('เลขไทย + Comma: "ขาย PTT ๕๐ หุ้น ราคา 1,234.5"', () => {
      expect(parseCommand('ขาย PTT ๕๐ หุ้น ราคา 1,234.5')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'PTT', quantity: 50, pricePerUnit: 1234.5 },
      });
    });
  });

  describe('PORTFOLIO — พอต / พอร์ต / portfolio', () => {
    test.each(['พอต', 'พอร์ต', 'พอร์ท', 'portfolio', 'PORTFOLIO', 'port'])(
      'คำพ้อง: "%s"',
      (input) => {
        expect(parseCommand(input)).toEqual({ command: COMMANDS.PORTFOLIO, params: {} });
      }
    );
  });

  describe('PROFIT — กำไร [SYMBOL]', () => {
    test('"กำไร BTC"', () => {
      expect(parseCommand('กำไร BTC')).toEqual({
        command: COMMANDS.PROFIT,
        params: { symbol: 'BTC' },
      });
    });

    test('พิมพ์เล็ก: "กำไร ptt"', () => {
      expect(parseCommand('กำไร ptt')).toEqual({
        command: COMMANDS.PROFIT,
        params: { symbol: 'PTT' },
      });
    });

    test('ไม่ระบุ Symbol: "กำไร" → UNKNOWN', () => {
      expect(parseCommand('กำไร').command).toBe(COMMANDS.UNKNOWN);
    });
  });

  describe('HISTORY — ประวัติ / history', () => {
    test.each(['ประวัติ', 'history', 'HISTORY'])('"%s"', (input) => {
      expect(parseCommand(input)).toEqual({ command: COMMANDS.HISTORY, params: {} });
    });
  });

  describe('UNDO_LAST — ยกเลิกล่าสุด / undo', () => {
    test.each(['ยกเลิกล่าสุด', 'ยกเลิกรายการล่าสุด', 'undo', 'UNDO'])('"%s"', (input) => {
      expect(parseCommand(input)).toEqual({ command: COMMANDS.UNDO_LAST, params: {} });
    });

    test('"ขาย BTC 1000" ยังเป็น SELL ไม่ถูก UNDO แย่ง', () => {
      expect(parseCommand('ขาย BTC 1000').command).toBe(COMMANDS.SELL);
    });
  });

  describe('SET_REMINDER — รายสัปดาห์ "ตั้งเตือน [SYMBOL] ทุกวัน[ชื่อวัน] [เงิน]"', () => {
    test.each([
      ['อาทิตย์', 0],
      ['จันทร์', 1],
      ['อังคาร', 2],
      ['พุธ', 3],
      ['พฤหัสบดี', 4],
      ['พฤหัส', 4], // Alias ย่อ
      ['ศุกร์', 5],
      ['เสาร์', 6],
    ])('ชื่อวัน "%s" → dayOfWeek %i', (dayName, dow) => {
      expect(parseCommand(`ตั้งเตือน BTC ทุกวัน${dayName} 1000`)).toEqual({
        command: COMMANDS.SET_REMINDER,
        params: { symbol: 'BTC', frequency: 'weekly', dayOfWeek: dow, amountThb: 1000 },
      });
    });

    test('Symbol พิมพ์เล็ก + Comma: "ตั้งเตือน btc ทุกวันจันทร์ 1,000"', () => {
      expect(parseCommand('ตั้งเตือน btc ทุกวันจันทร์ 1,000')).toEqual({
        command: COMMANDS.SET_REMINDER,
        params: { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 1, amountThb: 1000 },
      });
    });

    test('เลขไทย: "ตั้งเตือน BTC ทุกวันศุกร์ ๕๐๐"', () => {
      expect(parseCommand('ตั้งเตือน BTC ทุกวันศุกร์ ๕๐๐')).toEqual({
        command: COMMANDS.SET_REMINDER,
        params: { symbol: 'BTC', frequency: 'weekly', dayOfWeek: 5, amountThb: 500 },
      });
    });
  });

  describe('SET_REMINDER — รายเดือน "ตั้งเตือน [SYMBOL] ทุกวันที่ [1-31] [เงิน]"', () => {
    test('Basic: "ตั้งเตือน AAPL ทุกวันที่ 5 3000"', () => {
      expect(parseCommand('ตั้งเตือน AAPL ทุกวันที่ 5 3000')).toEqual({
        command: COMMANDS.SET_REMINDER,
        params: { symbol: 'AAPL', frequency: 'monthly', dayOfMonth: 5, amountThb: 3000 },
      });
    });

    test('วันสิ้นเดือน: "ตั้งเตือน BTC ทุกวันที่ 31 1000"', () => {
      expect(parseCommand('ตั้งเตือน BTC ทุกวันที่ 31 1000')).toEqual({
        command: COMMANDS.SET_REMINDER,
        params: { symbol: 'BTC', frequency: 'monthly', dayOfMonth: 31, amountThb: 1000 },
      });
    });

    test('Parser เป็นเชิงโครงสร้าง: วันที่นอกช่วง (45) ยัง Parse ได้ (ให้ service ตรวจช่วงเอง)', () => {
      expect(parseCommand('ตั้งเตือน BTC ทุกวันที่ 45 1000')).toEqual({
        command: COMMANDS.SET_REMINDER,
        params: { symbol: 'BTC', frequency: 'monthly', dayOfMonth: 45, amountThb: 1000 },
      });
    });

    test('"ทุกวันที่" ไม่ถูกตีความเป็นรายสัปดาห์ (ที่ ≠ ชื่อวัน)', () => {
      expect(parseCommand('ตั้งเตือน AAPL ทุกวันที่ 5 3000').params.frequency).toBe('monthly');
    });
  });

  describe('LIST_REMINDERS — ดูเตือน', () => {
    test('"ดูเตือน"', () => {
      expect(parseCommand('ดูเตือน')).toEqual({ command: COMMANDS.LIST_REMINDERS, params: {} });
    });
  });

  describe('DELETE_REMINDER — ลบเตือน [SYMBOL]', () => {
    test('"ลบเตือน BTC"', () => {
      expect(parseCommand('ลบเตือน BTC')).toEqual({
        command: COMMANDS.DELETE_REMINDER,
        params: { symbol: 'BTC' },
      });
    });

    test('พิมพ์เล็ก: "ลบเตือน aapl" → Symbol ตัวใหญ่', () => {
      expect(parseCommand('ลบเตือน aapl')).toEqual({
        command: COMMANDS.DELETE_REMINDER,
        params: { symbol: 'AAPL' },
      });
    });

    test('ไม่ระบุ Symbol: "ลบเตือน" → UNKNOWN', () => {
      expect(parseCommand('ลบเตือน').command).toBe(COMMANDS.UNKNOWN);
    });
  });

  describe('UNKNOWN — Parse ไม่สำเร็จ', () => {
    test('ไม่มี Symbol: "ซื้อ 1000"', () => {
      expect(parseCommand('ซื้อ 1000').command).toBe(COMMANDS.UNKNOWN);
    });

    test('ไม่มีจำนวนเงิน: "ซื้อ BTC"', () => {
      expect(parseCommand('ซื้อ BTC').command).toBe(COMMANDS.UNKNOWN);
    });

    test('พิมพ์ผิด: "ฃื้อ BTC 1000" → ไม่ตีความมั่ว', () => {
      expect(parseCommand('ฃื้อ BTC 1000').command).toBe(COMMANDS.UNKNOWN);
    });

    test('ข้อความสุ่มไม่เกี่ยวข้อง', () => {
      expect(parseCommand('ข้อความสุ่มไม่เกี่ยวข้อง').command).toBe(COMMANDS.UNKNOWN);
    });

    test('ตั้งเตือนแต่ Symbol เป็นตัวเลขล้วน → UNKNOWN (ไม่ใช่สินทรัพย์จริง)', () => {
      expect(parseCommand('ตั้งเตือน 1000 ทุกวันจันทร์ 500').command).toBe(COMMANDS.UNKNOWN);
    });

    test('ตั้งเตือนวันที่แต่ไม่ระบุจำนวนเงิน: "ตั้งเตือน BTC ทุกวันที่ 5" → UNKNOWN', () => {
      expect(parseCommand('ตั้งเตือน BTC ทุกวันที่ 5').command).toBe(COMMANDS.UNKNOWN);
    });

    test('ชื่อวันสะกดผิด: "ตั้งเตือน BTC ทุกวันจันทำ 500" → UNKNOWN (ไม่เดามั่ว)', () => {
      expect(parseCommand('ตั้งเตือน BTC ทุกวันจันทำ 500').command).toBe(COMMANDS.UNKNOWN);
    });

    test('ข้อความว่าง', () => {
      expect(parseCommand('').command).toBe(COMMANDS.UNKNOWN);
    });

    test('มีแต่ Whitespace', () => {
      expect(parseCommand('   ').command).toBe(COMMANDS.UNKNOWN);
    });

    test('Input ไม่ใช่ string (null) → ไม่ Crash', () => {
      expect(parseCommand(null).command).toBe(COMMANDS.UNKNOWN);
    });

    test('Input ไม่ใช่ string (undefined) → ไม่ Crash', () => {
      expect(parseCommand(undefined).command).toBe(COMMANDS.UNKNOWN);
    });
  });

  describe('normalizeText', () => {
    test('แปลงเลขไทยเป็นอารบิก', () => {
      expect(normalizeText('๑๒๓๔๕๖๗๘๙๐')).toBe('1234567890');
    });

    test('ยุบ Whitespace เกินและ Trim', () => {
      expect(normalizeText('  ซื้อ   BTC  ')).toBe('ซื้อ btc');
    });

    test('แปลงเป็น lowercase', () => {
      expect(normalizeText('Portfolio')).toBe('portfolio');
    });

    test('ค่าที่ไม่ใช่ string คืน empty string', () => {
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(42)).toBe('');
    });
  });
});
