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
