const COMMANDS = {
  BUY: 'BUY',
  SELL: 'SELL',
  PORTFOLIO: 'PORTFOLIO',
  PROFIT: 'PROFIT',
  HISTORY: 'HISTORY',
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

const DETAILED_BUY = new RegExp(`^(?:ซื้อ|buy)\\s+${SYMBOL}\\s+${NUMBER}\\s*หุ้น\\s*ราคา\\s*${NUMBER}$`);
const SIMPLE_BUY = new RegExp(`^(?:ซื้อ|buy)\\s+${SYMBOL}\\s+${NUMBER}\\s*(?:บาท)?$`);
const DETAILED_SELL = new RegExp(`^(?:ขาย|sell)\\s+${SYMBOL}\\s+${NUMBER}\\s*หุ้น\\s*ราคา\\s*${NUMBER}$`);
const SIMPLE_SELL = new RegExp(`^(?:ขาย|sell)\\s+${SYMBOL}\\s+${NUMBER}\\s*(?:บาท)?$`);
const PORTFOLIO = /^(?:พอต|พอร์ต|พอร์ท|portfolio|port)$/;
const PROFIT = new RegExp(`^(?:กำไร|profit)\\s+${SYMBOL}$`);
const HISTORY = /^(?:ประวัติ|history)$/;

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

  return unknown();
}

module.exports = {
  COMMANDS,
  normalizeText,
  parseCommand,
};
