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

  // PDPA Self-Service Erasure — คำสั่งเดียว ไม่มี Alias (ตั้งใจ ป้องกัน Match กว้างเกินไป)
  describe('ERASE_DATA_REQUEST — ลบข้อมูล', () => {
    test('"ลบข้อมูล" → ERASE_DATA_REQUEST', () => {
      expect(parseCommand('ลบข้อมูล')).toEqual({ command: COMMANDS.ERASE_DATA_REQUEST, params: {} });
    });

    test('ไม่ Match คำสั่งใกล้เคียงอื่นที่มีคำว่า "ลบ" (เช่น "ลบเตือน BTC")', () => {
      expect(parseCommand('ลบเตือน BTC').command).toBe(COMMANDS.DELETE_REMINDER);
    });

    test('มีคำอื่นต่อท้าย/นำหน้า (ไม่ตรงคำเป๊ะ) → UNKNOWN ไม่ Match แบบหลวมๆ', () => {
      expect(parseCommand('ลบข้อมูลที').command).toBe(COMMANDS.UNKNOWN);
      expect(parseCommand('กรุณาลบข้อมูล').command).toBe(COMMANDS.UNKNOWN);
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

  // ── Round 2: "ขายทั้งหมด" + ราคาเป็น USD ──────────────────────────────────
  describe('SELL ALL — ขาย [SYMBOL] ทั้งหมด', () => {
    test('"ขาย NVDA ทั้งหมด" → SELL + sellAll:true (ไม่มี quantity/amountThb)', () => {
      expect(parseCommand('ขาย NVDA ทั้งหมด')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'NVDA', sellAll: true },
      });
    });

    test('พิมพ์เล็ก + Whitespace เกิน: "ขาย  btc   ทั้งหมด"', () => {
      expect(parseCommand('ขาย  btc   ทั้งหมด')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'BTC', sellAll: true },
      });
    });

    test('รองรับ "sell BTC ทั้งหมด" (คำสั่งอังกฤษ)', () => {
      expect(parseCommand('sell BTC ทั้งหมด')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'BTC', sellAll: true },
      });
    });
  });

  describe('สกุลเงิน USD (Round 10) — รูปแบบจำนวนหุ้น+ราคา', () => {
    test('"ซื้อ MSFT 2 หุ้น ราคา 300 USD" → currency:USD', () => {
      expect(parseCommand('ซื้อ MSFT 2 หุ้น ราคา 300 USD')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'MSFT', quantity: 2, pricePerUnit: 300, currency: 'USD' },
      });
    });

    test('ใช้กับคำสั่งขายได้: "ขาย NVDA 1 หุ้น ราคา 900 USD"', () => {
      expect(parseCommand('ขาย NVDA 1 หุ้น ราคา 900 USD')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'NVDA', quantity: 1, pricePerUnit: 900, currency: 'USD' },
      });
    });

    test('Case-insensitive: "usd" ตัวเล็กก็ได้', () => {
      expect(parseCommand('ซื้อ MSFT 2 หุ้น ราคา 300 usd')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'MSFT', quantity: 2, pricePerUnit: 300, currency: 'USD' },
      });
    });

    test('ไม่ระบุหน่วย → ไม่มี Key currency (Default THB, Shape เดิม)', () => {
      expect(parseCommand('ซื้อ PTT 50 หุ้น ราคา 34')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
      });
    });

    test('ระบุ "บาท" ท้ายราคา → ยังคง Default THB (ไม่ใส่ currency)', () => {
      expect(parseCommand('ซื้อ PTT 50 หุ้น ราคา 34 บาท')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
      });
    });
  });

  describe('สกุลเงิน USD (Round 10) — รูปแบบจำนวนเงินรวม', () => {
    test('"ซื้อ MSFT 500 USD" → amountThb=500 (เป็น USD) + currency:USD', () => {
      expect(parseCommand('ซื้อ MSFT 500 USD')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'MSFT', amountThb: 500, currency: 'USD' },
      });
    });

    test('คำสั่งขายจำนวนเงินรวม USD: "ขาย NVDA 900 usd"', () => {
      expect(parseCommand('ขาย NVDA 900 usd')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'NVDA', amountThb: 900, currency: 'USD' },
      });
    });

    test('ไม่ระบุหน่วย → Default THB (Shape เดิม ไม่มี currency)', () => {
      expect(parseCommand('ซื้อ BTC 1000')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1000 },
      });
    });

    test('"ซื้อ BTC 1000 บาท" → Default THB (ไม่ใส่ currency)', () => {
      expect(parseCommand('ซื้อ BTC 1000 บาท')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'BTC', amountThb: 1000 },
      });
    });
  });

  describe('Manual Quantity Fallback (Round 10-B) — "จำนวนหุ้น + ยอดรวม" (คำว่า "รวม")', () => {
    test('"ซื้อ EOSE 10 หุ้น รวม 1000 usd" → quantity+amountThb (ไม่มี pricePerUnit) + USD', () => {
      expect(parseCommand('ซื้อ EOSE 10 หุ้น รวม 1000 usd')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'EOSE', quantity: 10, amountThb: 1000, currency: 'USD' },
      });
    });

    test('THB (ไม่ใส่หน่วย): "ซื้อ PTT 50 หุ้น รวม 1700" → ไม่มี currency', () => {
      expect(parseCommand('ซื้อ PTT 50 หุ้น รวม 1700')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'PTT', quantity: 50, amountThb: 1700 },
      });
    });

    test('ขาย: "ขาย EOSE 5 หุ้น รวม 600 usd" → SELL + quantity+amountThb', () => {
      expect(parseCommand('ขาย EOSE 5 หุ้น รวม 600 usd')).toEqual({
        command: COMMANDS.SELL,
        params: { symbol: 'EOSE', quantity: 5, amountThb: 600, currency: 'USD' },
      });
    });

    test('ทศนิยม + Comma: "ซื้อ EOSE 2.5 หุ้น รวม 1,250.50"', () => {
      expect(parseCommand('ซื้อ EOSE 2.5 หุ้น รวม 1,250.50')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'EOSE', quantity: 2.5, amountThb: 1250.5 },
      });
    });

    test('ไม่ชนกับรูปแบบ "ราคา" เดิม: "ซื้อ PTT 50 หุ้น ราคา 34" ยังเป็น qty+price', () => {
      expect(parseCommand('ซื้อ PTT 50 หุ้น ราคา 34')).toEqual({
        command: COMMANDS.BUY,
        params: { symbol: 'PTT', quantity: 50, pricePerUnit: 34 },
      });
    });
  });
});

describe('IMPORT_PORTFOLIO — เข้าโหมดนำเข้าพอร์ต', () => {
  test('"นำเข้าพอร์ต" → COMMANDS.IMPORT_PORTFOLIO', () => {
    expect(parseCommand('นำเข้าพอร์ต')).toEqual({ command: COMMANDS.IMPORT_PORTFOLIO, params: {} });
  });

  test('Alias "นำเข้าพอต" / "import" → เหมือนกัน', () => {
    expect(parseCommand('นำเข้าพอต')).toEqual({ command: COMMANDS.IMPORT_PORTFOLIO, params: {} });
    expect(parseCommand('import')).toEqual({ command: COMMANDS.IMPORT_PORTFOLIO, params: {} });
  });

  test('มีข้อความอื่นต่อท้าย → ไม่ Match (ต้องพิมพ์คำสั่งเดี่ยวๆ)', () => {
    expect(parseCommand('นำเข้าพอร์ต BTC')).toEqual({ command: COMMANDS.UNKNOWN, params: {} });
  });
});

describe('parseBulkImportLines — Batch นำเข้าพอร์ตหลายบรรทัด (Phase 3 Round 6)', () => {
  const { parseBulkImportLines } = require('../src/services/commandParser.service');

  test('ทุกบรรทัดผ่าน (THB + USD ปนกัน, มีวันที่ + ไม่มีวันที่ปนกัน)', () => {
    const text = [
      'BTC 0.5 ต้นทุน 1500000',
      'ETH 2 ต้นทุน 80000 วันที่ 01/03/2569',
      'MSFT 3 ต้นทุน 300 USD',
    ].join('\n');

    const result = parseBulkImportLines(text);

    expect(result.ok).toBe(true);
    expect(result.empty).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      { line: 1, symbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000 },
      { line: 2, symbol: 'ETH', quantity: 2, pricePerUnit: 80000, date: '2026-03-01' },
      { line: 3, symbol: 'MSFT', quantity: 3, pricePerUnit: 300, currency: 'USD' },
    ]);
  });

  test('1 บรรทัดผิด Format จาก 3 บรรทัด → Reject ทั้ง Batch ระบุเลขบรรทัดถูกต้อง', () => {
    const text = ['BTC 0.5 ต้นทุน 1500000', 'ETH สอง ต้นทุน 80000', 'MSFT 3 ต้นทุน 300'].join('\n');

    const result = parseBulkImportLines(text);

    expect(result.ok).toBe(false);
    expect(result.empty).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
  });

  test('มีบรรทัดผิดมากกว่า 1 บรรทัดพร้อมกัน → ระบุครบทุกบรรทัดที่ผิด ไม่ใช่แค่บรรทัดแรก', () => {
    const text = ['BTC สอง ต้นทุน 100', 'ETH 2 ต้นทุน 80000', 'MSFT 3 ต้นทุน ไม่ใช่ตัวเลข'].join('\n');

    const result = parseBulkImportLines(text);

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.line)).toEqual([1, 3]);
  });

  test('วันที่รูปแบบผิด (32/13/2569) → Error ระบุบรรทัดพร้อมเหตุผลเรื่องวันที่', () => {
    const result = parseBulkImportLines('BTC 0.5 ต้นทุน 1500000 วันที่ 32/13/2569');

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ line: 1, reason: expect.stringContaining('วันที่') }]);
  });

  test('จำนวนหรือต้นทุนเป็น 0 หรือติดลบ → Error', () => {
    const result = parseBulkImportLines('BTC 0 ต้นทุน 1500000');
    expect(result.ok).toBe(false);
    expect(result.errors[0].line).toBe(1);
  });

  test('Batch ว่างเปล่า (string ว่าง) → empty:true, ไม่ใช่ errors', () => {
    const result = parseBulkImportLines('');
    expect(result).toEqual({ ok: false, empty: true, errors: [], items: [] });
  });

  test('Batch มีแต่บรรทัดว่าง/Whitespace → empty:true', () => {
    const result = parseBulkImportLines('\n   \n\t\n');
    expect(result.ok).toBe(false);
    expect(result.empty).toBe(true);
  });

  test('บรรทัดว่างคั่นกลางระหว่างรายการ → ข้ามเงียบๆ ไม่นับเป็น Error, เลขบรรทัดยังถูกต้อง', () => {
    const text = ['BTC 0.5 ต้นทุน 1500000', '', 'ETH 2 ต้นทุน 80000'].join('\n');
    const result = parseBulkImportLines(text);

    expect(result.ok).toBe(true);
    expect(result.items).toEqual([
      { line: 1, symbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000 },
      { line: 3, symbol: 'ETH', quantity: 2, pricePerUnit: 80000 },
    ]);
  });

  test('เลขไทย + Comma ในบรรทัด Batch → Parse ได้เหมือนคำสั่งเดี่ยว', () => {
    const result = parseBulkImportLines('BTC ๐.๕ ต้นทุน 1,500,000');
    expect(result.ok).toBe(true);
    expect(result.items[0]).toEqual({ line: 1, symbol: 'BTC', quantity: 0.5, pricePerUnit: 1500000 });
  });

  test('rawText ไม่ใช่ string → empty:true (ไม่ throw)', () => {
    expect(parseBulkImportLines(null)).toEqual({ ok: false, empty: true, errors: [], items: [] });
    expect(parseBulkImportLines(undefined)).toEqual({ ok: false, empty: true, errors: [], items: [] });
  });
});
