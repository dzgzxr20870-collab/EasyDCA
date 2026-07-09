const { THAI_DAY_PATTERNS, dayNameToDow } = require('../utils/thaiDate.util');

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

  return unknown();
}

module.exports = {
  COMMANDS,
  normalizeText,
  parseCommand,
};
