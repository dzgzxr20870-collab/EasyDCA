const { THAI_DAY_PATTERNS, dayNameToDow, parseDateInput } = require('../utils/thaiDate.util');

const COMMANDS = {
  BUY: 'BUY',
  SELL: 'SELL',
  PORTFOLIO: 'PORTFOLIO',
  PROFIT: 'PROFIT',
  HISTORY: 'HISTORY',
  UNDO_LAST: 'UNDO_LAST',
  SET_REMINDER: 'SET_REMINDER',
  LIST_REMINDERS: 'LIST_REMINDERS',
  DELETE_REMINDER: 'DELETE_REMINDER',
  // Phase 3 Round 6 — เข้าสู่โหมดนำเข้าพอร์ตแบบ Multi-line (2 ข้อความ: คำสั่งนี้
  // ก่อน แล้ว Batch หลายบรรทัดเป็นข้อความถัดไป — ดู bulkImportSession.service)
  IMPORT_PORTFOLIO: 'IMPORT_PORTFOLIO',
  UNKNOWN: 'UNKNOWN',
};

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

// LINE ผู้ใช้ไทยพิมพ์เลขไทยได้ (เช่น "๑๐๐๐") — ต้องแปลงเป็นเลขอารบิก
// ก่อน Parse เสมอ ตาม TEST_PLAN.md § 3
function normalizeText(text) {
  if (typeof text !== 'string') return '';

  return text
    .replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseNumber(raw) {
  return Number.parseFloat(raw.replace(/,/g, ''));
}

// Symbol ล้วนตัวเลข (เช่น "ซื้อ 1000 500") ไม่ใช่สินทรัพย์จริง — ปฏิเสธ
function isValidSymbol(symbol) {
  return !/^[\d,.]+$/.test(symbol);
}

const NUMBER = '([\\d,]+(?:\\.\\d+)?)';
const SYMBOL = '(\\S+)';
// หน่วยสกุลเงินท้ายราคาต่อหน่วย (ไม่บังคับ) — รองรับ "usd" (ให้ transaction.service
// แปลงเป็นบาทด้วย FX Rate) และ "บาท" (Default เดิม) หลัง normalizeText ทำ
// toLowerCase ให้แล้ว "USD"→"usd" เป็นกลุ่มจับ (Capturing) เพิ่มเป็น match ตำแหน่งที่
// 4 ของ DETAILED_BUY/SELL — match[1..3] เดิม (symbol/qty/price) จึงไม่ขยับ
const PRICE_UNIT = '(?:\\s*(usd|บาท))?';

const DETAILED_BUY = new RegExp(`^(?:ซื้อ|buy)\\s+${SYMBOL}\\s+${NUMBER}\\s*หุ้น\\s*ราคา\\s*${NUMBER}${PRICE_UNIT}$`);
const SIMPLE_BUY = new RegExp(`^(?:ซื้อ|buy)\\s+${SYMBOL}\\s+${NUMBER}\\s*(?:บาท)?$`);
const DETAILED_SELL = new RegExp(`^(?:ขาย|sell)\\s+${SYMBOL}\\s+${NUMBER}\\s*หุ้น\\s*ราคา\\s*${NUMBER}${PRICE_UNIT}$`);
const SIMPLE_SELL = new RegExp(`^(?:ขาย|sell)\\s+${SYMBOL}\\s+${NUMBER}\\s*(?:บาท)?$`);
// "ขาย NVDA ทั้งหมด" — ขายยอดคงเหลือทั้งหมดตามราคาตลาดปัจจุบัน (transaction.service
// เติมจำนวน=ยอดคงเหลือ + ราคา=ราคาตลาด) ไม่ชนกับ SIMPLE_SELL เพราะ "ทั้งหมด"
// ไม่ใช่ตัวเลข จึงไม่ Match รูปแบบจำนวนเงิน
const SELL_ALL = new RegExp(`^(?:ขาย|sell)\\s+${SYMBOL}\\s+ทั้งหมด$`);
const PORTFOLIO = /^(?:พอต|พอร์ต|พอร์ท|portfolio|port)$/;
const PROFIT = new RegExp(`^(?:กำไร|profit)\\s+${SYMBOL}$`);
const HISTORY = /^(?:ประวัติ|history)$/;
// Command History (PRD.md — "ยกเลิกรายการล่าสุด") ต่างจากปุ่ม Postback ยกเลิก
// (ที่ยกเลิกได้เฉพาะตอนยังไม่ Confirm) — คำสั่งนี้ย้อนรายการที่ Commit แล้ว
// Full-match anchored จึงไม่ชนกับ SELL ("ขาย...") / คำสั่งอื่น
const UNDO_LAST = /^(?:ยกเลิกล่าสุด|ยกเลิกรายการล่าสุด|undo)$/;

// ── DCA Reminder (ฟีเจอร์ตั้งเตือนให้มาซื้อเอง — ไม่ซื้ออัตโนมัติ) ──────────
// ชื่อวันไทยเรียงยาว→สั้น (พฤหัสบดี ก่อน พฤหัส) กัน Match ครึ่งคำ
const THAI_DAY_ALT = THAI_DAY_PATTERNS.join('|');
// "ตั้งเตือน BTC ทุกวันจันทร์ 1000" (รายสัปดาห์) — day มาจากชื่อวัน, เงินหนึ่งจำนวน
const REMINDER_WEEKLY = new RegExp(
  `^ตั้งเตือน\\s+${SYMBOL}\\s+ทุกวัน(${THAI_DAY_ALT})\\s+${NUMBER}$`
);
// "ตั้งเตือน AAPL ทุกวันที่ 5 3000" (รายเดือน) — วันที่ 1-31 แล้วตามด้วยจำนวนเงิน
// ตรวจก่อน WEEKLY เสมอ: "ทุกวันที่" ขึ้นต้นด้วย "ทุกวัน" เหมือนกัน แต่ตามด้วย "ที่"
// (ไม่ใช่ชื่อวัน) จึงไม่ชนกัน แต่จัดลำดับให้ชัดเจนไว้ก่อน
const REMINDER_MONTHLY = new RegExp(
  `^ตั้งเตือน\\s+${SYMBOL}\\s+ทุกวันที่\\s+${NUMBER}\\s+${NUMBER}$`
);
const LIST_REMINDERS = /^ดูเตือน$/;
const DELETE_REMINDER = new RegExp(`^ลบเตือน\\s+${SYMBOL}$`);

// ── Bulk Import (Phase 3 Round 6 — นำเข้าพอร์ตแบบ Multi-line) ───────────────
// คำสั่งเข้าโหมด (ข้อความที่ 1 ของ Flow 2 ข้อความ) — Pattern การรับหลาย Alias
// เดียวกับ PORTFOLIO ด้านบน (ชื่อไทยเต็ม/ย่อ + English)
const IMPORT_PORTFOLIO = /^(?:นำเข้าพอร์ต|นำเข้าพอต|import)$/;

// รูปแบบ 1 บรรทัดของ Batch: "SYMBOL QTY ต้นทุน PRICE[หน่วยเงิน] [วันที่ DD/MM/YYYY]"
// ทั้ง "หน่วยเงิน" และ "วันที่" ไม่บังคับ — ไม่มีคำสั่ง "ซื้อ"/"หุ้น"/"ราคา" นำหน้า
// เหมือนคำสั่งซื้อเดี่ยว เพราะ Batch เป็นรูปแบบคล้าย Spreadsheet ไม่ใช่ประโยคคำสั่ง
// Reuse Group เดิม: SYMBOL/NUMBER/PRICE_UNIT (เหมือน DETAILED_BUY ทุกประการ)
const BULK_IMPORT_DATE = '(?:\\s*วันที่\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{4}))?';
const BULK_IMPORT_LINE = new RegExp(
  `^${SYMBOL}\\s+${NUMBER}\\s*ต้นทุน\\s*${NUMBER}${PRICE_UNIT}${BULK_IMPORT_DATE}$`
);

// Parse 1 บรรทัดของ Batch (หลัง Trim แล้ว ไม่ใช่บรรทัดว่าง) — คืน
// { ok:true, item } หรือ { ok:false, reason } (เหตุผลเป็นภาษาไทยพร้อมแสดงผู้ใช้ตรงๆ
// เพราะ Error ระดับ Parse ไม่มี Error Code ให้แปลที่ flexMessage.util เหมือน
// TransactionServiceError)
function parseBulkImportLine(trimmedRawLine) {
  const text = normalizeText(trimmedRawLine);

  const match = text.match(BULK_IMPORT_LINE);
  if (!match || !isValidSymbol(match[1])) {
    return {
      ok: false,
      reason: 'รูปแบบไม่ถูกต้อง (ตัวอย่าง: BTC 0.5 ต้นทุน 1500000)',
    };
  }

  const quantity = parseNumber(match[2]);
  const pricePerUnit = parseNumber(match[3]);
  if (!(quantity > 0) || !(pricePerUnit > 0)) {
    return { ok: false, reason: 'จำนวนหรือต้นทุนต้องมากกว่า 0' };
  }

  let date = null;
  if (match[5]) {
    date = parseDateInput(match[5]);
    if (!date) {
      return { ok: false, reason: `วันที่ไม่ถูกต้อง (${match[5]})` };
    }
  }

  return {
    ok: true,
    item: {
      symbol: match[1].toUpperCase(),
      quantity,
      pricePerUnit,
      ...(match[4] === 'usd' ? { priceCurrency: 'USD' } : {}),
      ...(date ? { date } : {}),
    },
  };
}

// Parse Batch หลายบรรทัดทั้งก้อน (ข้อความที่ 2 ของ Flow) — ห้ามใช้ normalizeText
// กับทั้งก้อนก่อน Split เพราะ normalizeText ยุบ \s+ (รวม Newline) เป็นช่องว่างเดียว
// ซึ่งจะทำลายขอบเขตบรรทัดที่ต้องใช้ระบุเลขบรรทัดที่ผิด — Split ด้วย Regex ขึ้นบรรทัด
// ใหม่ตรงๆ ก่อน แล้วค่อย normalizeText ทีละบรรทัดใน parseBulkImportLine
//
// คืนผลลัพธ์ 3 แบบ:
//  - { ok:false, empty:true }              → ทุกบรรทัดว่างเปล่า/ไม่มีเนื้อหาเลย
//  - { ok:false, empty:false, errors }      → มีอย่างน้อย 1 บรรทัด Parse ไม่ผ่าน
//    (errors รวมทุกบรรทัดที่ผิด ไม่ใช่แค่บรรทัดแรก) — ปฏิเสธทั้ง Batch ไม่คืน items
//  - { ok:true, empty:false, items }        → ทุกบรรทัดผ่านหมด
function parseBulkImportLines(rawText) {
  if (typeof rawText !== 'string') {
    return { ok: false, empty: true, errors: [], items: [] };
  }

  const rawLines = rawText.split(/\r\n|\r|\n/);
  const items = [];
  const errors = [];
  let hasContent = false;

  rawLines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return; // บรรทัดว่าง — ข้ามเงียบๆ ไม่นับเป็น Error

    hasContent = true;
    const lineNumber = index + 1;
    const result = parseBulkImportLine(trimmed);

    if (!result.ok) {
      errors.push({ line: lineNumber, reason: result.reason });
    } else {
      items.push({ line: lineNumber, ...result.item });
    }
  });

  if (!hasContent) {
    return { ok: false, empty: true, errors: [], items: [] };
  }

  if (errors.length > 0) {
    return { ok: false, empty: false, errors, items: [] };
  }

  return { ok: true, empty: false, errors: [], items };
}

const unknown = () => ({ command: COMMANDS.UNKNOWN, params: {} });

function parseCommand(rawText) {
  const text = normalizeText(rawText);
  if (!text) return unknown();

  // ตรวจรูปแบบ "ระบุจำนวนหน่วย + ราคา" ก่อนรูปแบบ "จำนวนเงิน" เสมอ
  // เพราะรูปแบบเงินเป็น Subset ที่ Match กว้างกว่า
  let match = text.match(DETAILED_BUY);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.BUY,
      params: {
        symbol: match[1].toUpperCase(),
        quantity: parseNumber(match[2]),
        pricePerUnit: parseNumber(match[3]),
        // ใส่ priceCurrency เฉพาะเมื่อพิมพ์ "usd" — ไม่ใส่ Key ตอน Default (บาท)
        // เพื่อคง Shape params เดิม (เทสต์เดิมใช้ toEqual เทียบ Object ตรงๆ)
        ...(match[4] === 'usd' ? { priceCurrency: 'USD' } : {}),
      },
    };
  }

  match = text.match(SIMPLE_BUY);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.BUY,
      params: {
        symbol: match[1].toUpperCase(),
        amountThb: parseNumber(match[2]),
      },
    };
  }

  match = text.match(DETAILED_SELL);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.SELL,
      params: {
        symbol: match[1].toUpperCase(),
        quantity: parseNumber(match[2]),
        pricePerUnit: parseNumber(match[3]),
        // ใส่ priceCurrency เฉพาะเมื่อพิมพ์ "usd" (เช่นเดียวกับ DETAILED_BUY)
        ...(match[4] === 'usd' ? { priceCurrency: 'USD' } : {}),
      },
    };
  }

  match = text.match(SIMPLE_SELL);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.SELL,
      params: {
        symbol: match[1].toUpperCase(),
        amountThb: parseNumber(match[2]),
      },
    };
  }

  // ตรวจ SELL_ALL หลัง SIMPLE_SELL — "ขาย <SYMBOL> ทั้งหมด" ไม่ Match รูปแบบขายอื่น
  // (ไม่มีตัวเลขจำนวน/ราคา) จึงมาถึงตรงนี้ได้โดยไม่ถูกดักไปก่อน
  match = text.match(SELL_ALL);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.SELL,
      params: {
        symbol: match[1].toUpperCase(),
        sellAll: true,
      },
    };
  }

  if (PORTFOLIO.test(text)) {
    return { command: COMMANDS.PORTFOLIO, params: {} };
  }

  match = text.match(PROFIT);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.PROFIT,
      params: { symbol: match[1].toUpperCase() },
    };
  }

  if (HISTORY.test(text)) {
    return { command: COMMANDS.HISTORY, params: {} };
  }

  if (UNDO_LAST.test(text)) {
    return { command: COMMANDS.UNDO_LAST, params: {} };
  }

  // รายเดือนก่อนรายสัปดาห์: ทั้งคู่ขึ้นต้น "ตั้งเตือน ... ทุกวัน" — รูปแบบ "ทุกวันที่ <เลข>"
  // เจาะจงกว่า ตรวจก่อนกัน Ambiguity (Range 1-31 ตรวจจริงที่ dcaReminder.service)
  match = text.match(REMINDER_MONTHLY);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.SET_REMINDER,
      params: {
        symbol: match[1].toUpperCase(),
        frequency: 'monthly',
        dayOfMonth: parseNumber(match[2]),
        amountThb: parseNumber(match[3]),
      },
    };
  }

  match = text.match(REMINDER_WEEKLY);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.SET_REMINDER,
      params: {
        symbol: match[1].toUpperCase(),
        frequency: 'weekly',
        dayOfWeek: dayNameToDow(match[2]),
        amountThb: parseNumber(match[3]),
      },
    };
  }

  if (LIST_REMINDERS.test(text)) {
    return { command: COMMANDS.LIST_REMINDERS, params: {} };
  }

  match = text.match(DELETE_REMINDER);
  if (match && isValidSymbol(match[1])) {
    return {
      command: COMMANDS.DELETE_REMINDER,
      params: { symbol: match[1].toUpperCase() },
    };
  }

  if (IMPORT_PORTFOLIO.test(text)) {
    return { command: COMMANDS.IMPORT_PORTFOLIO, params: {} };
  }

  return unknown();
}

module.exports = {
  COMMANDS,
  normalizeText,
  parseCommand,
  parseBulkImportLines,
};
