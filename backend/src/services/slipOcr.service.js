// ═══════════════════════════════════════════════════════════════════════
// slipOcr.service — อ่านรูปสลิปการซื้อ/ขายสินทรัพย์ด้วย Claude Vision (Round 9)
// ═══════════════════════════════════════════════════════════════════════
// Premium Feature: ผู้ใช้ส่งรูปสลิป (Bitkub/Binance/Settrade ฯลฯ) → ส่งให้ Claude
// อ่านข้อมูล (Symbol/จำนวน/ราคา/วันที่/ทิศทาง) แล้วคืน Object ให้ Controller สร้าง
// Preview ให้ผู้ใช้ตรวจสอบ + ยืนยันก่อนบันทึกเสมอ (ไม่มีทางที่ข้อมูลจาก AI ถูกบันทึก
// ลง DB โดยไม่ผ่านการยืนยัน — ดู webhook.controller / pendingTransaction.service)
//
// ⚠️ กฎเหล็ก (PROJECT_BRIEF): AI อ่านข้อมูลจากรูปเท่านั้น ห้ามแนะนำ/ชี้นำการลงทุน
//
// โควตา 50 ครั้ง/เดือน/user (Asia/Bangkok) นับเฉพาะ "อ่านสำเร็จ + จะส่ง Preview"
// เท่านั้น — Error/ไม่ใช่สลิป/หลายรายการ/Rate Limit ไม่นับ (จุดตัด = อ่านสำเร็จ)
//
// หมายเหตุ Env: ใช้ CLAUDE_API_KEY เดิมที่โปรเจกต์เตรียมไว้แล้ว (config.claude.apiKey)
// — ไม่เพิ่ม ANTHROPIC_API_KEY ใหม่ (ตัดสินใจร่วมกับ Product Owner แล้ว) อ่านจาก
// process.env โดยตรงแบบเดียวกับ priceFeed.service (เลี่ยง import config ที่มี Side Effect)

const aiOcrUsageRepository = require('../repositories/aiOcrUsage.repository');
const { bangkokYearMonth, parseDateInput } = require('../utils/thaiDate.util');
const logger = require('../utils/logger.util');

const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
// ⚠️ Claude Sonnet 5 — เปลี่ยนจาก Haiku 4.5 เพราะ Haiku "อ่านทิศทางรายการผิด" บนสลิป
// โบรกไทย: สลิป Dime! ที่เขียน "ขาย BCPG" ตัวแดงชัดเจน Haiku ตอบ side="buy" ด้วย
// confidence="high" ซ้ำกันทั้ง 3 รอบ — และเมื่อบังคับให้อ้างหลักฐาน มันคัดคำว่า "ขาย"
// ออกมาได้ถูกต้อง แต่ยังสรุปเป็น buy อยู่ดี (อ่านตัวอักษรออก แต่ Map ความหมายพลาด)
// Sonnet 5 ตอบ "sell" ถูกต้องด้วย Prompt เดียวกันโดยไม่ต้องแก้อะไร
//
// ต้นทุนสูงขึ้น ~2-3 เท่า แต่ Quota 50 รูป/เดือน/user ทำให้ส่วนต่างอยู่ราว 20-25 บาท/
// เดือน/คน — ถูกกว่าความเสียหายของ Ledger ที่บันทึกกลับด้าน (P&L/จำนวนหน่วยผิด และ
// เป็น Immutable Ledger ที่ต้องแก้ด้วย Reversal) มาก (ตัดสินใจร่วมกับ Product Owner)
const CLAUDE_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

const MONTHLY_QUOTA = 50;
// Abuse Guard: ไม่เกิน 1 ครั้ง/10 วินาที/user (กันส่งรูปรัวๆ โดยไม่ตั้งใจ/ทดสอบ)
const RATE_LIMIT_MS = 10 * 1000;
// Vision อาจใช้เวลานานกว่า Text API — ตั้ง Timeout สูงกว่า priceFeed (5s) เป็น 20s
const REQUEST_TIMEOUT_MS = 20 * 1000;

// In-memory Rate Limit ระดับ Process (Map<userId, lastTimestampMs>) — Pattern เดียวกับ
// priceFeed cache ⚠️ ผูกกับ Process เดียว ถ้า Scale หลาย Instance ต้องย้ายไป Redis
const lastCallByUser = new Map();

// Error ที่มี code เฉพาะ (Pattern เดียวกับ TransactionServiceError) เพื่อให้ Controller
// Map เป็นข้อความไทยได้ ไม่ปล่อย Error ดิบถึงผู้ใช้
class SlipOcrError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SlipOcrError';
    this.code = code;
    this.details = details;
  }
}

// อ่าน CLAUDE_API_KEY จาก Env — คืน null ถ้าไม่ได้ตั้ง (ไม่ยิง Request ด้วย Key ว่าง)
function getApiKey() {
  const key = process.env.CLAUDE_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

// LINE ส่ง Content-Type ของรูปมา — Map เป็น media_type ที่ Claude รองรับ (jpeg/png/gif/webp)
// Fallback เป็น jpeg (สลิปส่วนใหญ่เป็น JPEG)
function mediaTypeFromContentType(contentType) {
  if (typeof contentType !== 'string') return 'image/jpeg';
  const c = contentType.toLowerCase();
  if (c.includes('png')) return 'image/png';
  if (c.includes('gif')) return 'image/gif';
  if (c.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

// Prompt สั่งให้ Claude คืน JSON เท่านั้น (ไม่มี Markdown/ข้อความอื่น) + ย้ำกฎห้ามแนะนำ
const SYSTEM_PROMPT = [
  'คุณคือระบบอ่านข้อมูลจากรูปสลิปการซื้อ/ขายสินทรัพย์ (คริปโต หุ้นไทย/ต่างประเทศ กองทุน ทองคำ ฯลฯ)',
  'หน้าที่ของคุณคือ "อ่านข้อมูลที่ปรากฏในรูปเท่านั้น" ห้ามแนะนำ ห้ามชี้นำการซื้อขาย ห้ามให้ความเห็นการลงทุนใดๆ',
  'กติกา:',
  '- อ่านเฉพาะข้อมูลที่เห็นจริงในรูป ถ้าไม่มีหรือไม่มั่นใจใน field ใด ให้ใส่ค่า null สำหรับ field นั้น (ห้ามเดา ห้ามคำนวณเติมเอง)',
  '- ถ้ารูปไม่ใช่สลิปการซื้อ/ขายสินทรัพย์ (เช่น รูปคน วิว มีม เอกสารทั่วไป) ให้ is_slip = false',
  '- ถ้าในรูปมีมากกว่า 1 รายการธุรกรรม (เช่น Statement เต็มหน้า หลายแถว) ให้ multiple_items = true',
  '- symbol ให้เป็นชื่อย่อสินทรัพย์เป็นตัวพิมพ์ใหญ่ (เช่น BTC, PTT, AAPL) ถ้าอ่านไม่ได้ให้ null',
  // ⚠️ ทิศทางรายการเป็น Field ที่ผิดแล้วกระทบเงินผู้ใช้โดยตรง (P&L/จำนวนหน่วยถือครอง
  // กลับด้าน) จึงอธิบายละเอียดกว่า Field อื่น + ย้ำ lowercase เป็น Defense-in-depth
  // ควบคู่กับ normalizeSide() ที่ Normalize ซ้ำอีกชั้นฝั่งโค้ด (ห้ามพึ่ง Prompt อย่างเดียว)
  '- side = ทิศทางของรายการ ต้องเป็น "buy" หรือ "sell" ตัวพิมพ์เล็กเท่านั้น',
  '  ให้ "sell" เมื่อเห็นคำบ่งชี้การขาย เช่น ขาย, ขายออก, จำหน่าย, Sell, Sold, SELL,',
  '  หรือรายการที่เงินเข้าบัญชีจากการลดสถานะถือครอง',
  '  ให้ "buy" เมื่อเห็นคำบ่งชี้การซื้อ เช่น ซื้อ, Buy, Bought, BUY',
  '  ⚠️ ห้ามเดาว่าเป็น "buy" เมื่อไม่เห็นคำบ่งชี้ชัดเจน — กรณีกำกวมให้ null เท่านั้น',
  // side_evidence: บังคับให้ "คัดข้อความจริง" ที่ใช้ตัดสินใจออกมา เพื่อให้ฝั่งโค้ดตรวจสอบ
  // ซ้ำได้เอง (sideFromEvidence) แทนที่จะเชื่อข้อสรุป side ของ AI ล้วนๆ — เคส BCPG พิสูจน์
  // แล้วว่า Model อาจคัดคำว่า "ขาย" ออกมาถูก แต่สรุป side เป็น buy ผิด การเทียบ 2 ค่านี้
  // จึงจับความขัดแย้งได้โดยไม่ต้องเชื่อ Model
  '- side_evidence = ข้อความที่ปรากฏในรูป "คำต่อคำ" ที่คุณใช้ตัดสิน side (คัดลอกมาตรงๆ',
  '  ห้ามแต่งขึ้นเอง ห้ามแปล) เช่น "ขาย BCPG" หรือ "ซื้อ BTC" ถ้าหาไม่เจอให้ null',
  '- date รูปแบบ DD/MM/YYYY (ปี ค.ศ. หรือ พ.ศ. ตามที่เห็นในสลิป) ถ้าไม่มีให้ null',
  '  ⚠️ ระวังชื่อเดือนไทยแบบย่อ: ม.ค.=01 ก.พ.=02 มี.ค.=03 เม.ย.=04 พ.ค.=05 มิ.ย.=06',
  '  ก.ค.=07 ส.ค.=08 ก.ย.=09 ต.ค.=10 พ.ย.=11 ธ.ค.=12',
  '  ⚠️ ปีบนสลิปไทยที่เขียนย่อ 2 หลัก (เช่น "26 มิ.ย. 69") คือ พ.ศ. ย่อ ให้เติมเป็น 2569',
  '  (ห้ามตีความเป็น ค.ศ. 2069 หรือ 1969)',
  '- quantity = จำนวนหน่วย (เช่น จำนวนหุ้น/เหรียญ), price_per_unit = ราคาต่อหน่วย',
  // นิยาม amount ต้องเป็น "มูลค่าซื้อขายก่อนค่าธรรมเนียม" เสมอ เพื่อให้ต้นทุน/กำไรของทุก
  // Broker คำนวณบนฐานเดียวกัน (สลิปไทยมักโชว์ทั้งมูลค่าหุ้นและยอดสุทธิหลังหักค่าคอม+VAT)
  '- amount = มูลค่าซื้อขาย "ก่อนหักค่าธรรมเนียม" = quantity × price_per_unit',
  '  (ตัวเลขล้วน ไม่มี comma) ถ้าสลิปแสดงทั้ง "มูลค่าหุ้น" และ "ยอดสุทธิ" ให้ใช้มูลค่าหุ้น',
  // net_amount แยกออกมาเพื่อใช้เป็น Numeric Cross-check ฝั่งโค้ด (ดู numericSideSignal):
  // ซื้อ → จ่ายจริง "มากกว่า" มูลค่าหุ้น (บวกค่าคอม+VAT) / ขาย → ได้รับจริง "น้อยกว่า"
  // เป็นสัญญาณ Deterministic ที่ไม่ต้องเชื่อการตีความของ AI เลย
  '- net_amount = ยอดสุทธิที่จ่ายจริง/ได้รับจริงตามที่สลิประบุ (หลังหักหรือรวมค่าธรรมเนียม',
  '  แล้ว เช่น "ยอดที่จะได้รับคืนโดยประมาณ" หรือ "ยอดชำระทั้งสิ้น") ถ้าไม่มีให้ null',
  '  ⚠️ ห้ามคำนวณเอง ให้ใส่เฉพาะตัวเลขที่พิมพ์อยู่ในสลิปจริงเท่านั้น',
  '- ⚠️ สำคัญ: ถ้าสลิปแสดง "เฉพาะมูลค่า/ยอดเงินรวม" โดยไม่มีจำนวนหน่วยและไม่มีราคาต่อหน่วย',
  '  (เช่น แอปหุ้นต่างประเทศอย่าง Dime! ที่ซื้อเป็นจำนวนเงิน) ให้ใส่ตัวเลขนั้นใน amount เท่านั้น',
  '  และให้ quantity = null, price_per_unit = null (ห้ามเอายอดรวมไปใส่เป็น price_per_unit)',
  '- currency = สกุลเงินของตัวเลขในสลิป: "USD" ถ้าเห็นสัญลักษณ์ $ หรือ USD ชัดเจน,',
  '  มิฉะนั้น (รวมถึงกรณีไม่ชัดเจน) ให้เป็น "THB"',
  '',
  'ตอบกลับเป็น JSON object เดียวเท่านั้น ห้ามมีข้อความอื่น ห้ามใส่ markdown code fence รูปแบบ:',
  '{"is_slip":boolean,"multiple_items":boolean,"symbol":string|null,"side":"buy"|"sell"|null,"side_evidence":string|null,"quantity":number|null,"price_per_unit":number|null,"amount":number|null,"net_amount":number|null,"currency":"THB"|"USD","date":string|null,"confidence":"high"|"medium"|"low"}',
].join('\n');

// แปลง Text ที่ Claude ตอบ → Object (เผื่อเผลอห่อ ```json ... ``` ก็ถอดออกก่อน Parse)
function parseOcrJson(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new SlipOcrError('OCR_FAILED', `Claude returned non-JSON output: ${err.message}`);
  }
}

// ยิง Claude Vision (Messages API) แบบ raw fetch (ตาม Convention โปรเจกต์ที่ใช้ fetch
// กับทุก External API — line/coingecko/twelvedata/sec — ไม่เพิ่ม SDK Dependency)
// คืน Object ที่ Parse แล้ว | throw SlipOcrError('OCR_FAILED'/'OCR_NOT_CONFIGURED')
async function callClaudeVision(base64, mediaType) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new SlipOcrError('OCR_NOT_CONFIGURED', 'CLAUDE_API_KEY is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(CLAUDE_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: 'อ่านสลิปนี้แล้วตอบกลับเป็น JSON ตามรูปแบบที่กำหนด' },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new SlipOcrError('OCR_FAILED', `Claude API failed: ${response.status} ${detail}`);
    }

    const data = await response.json();
    const textBlock = Array.isArray(data?.content)
      ? data.content.find((b) => b?.type === 'text')
      : null;
    if (!textBlock?.text) {
      throw new SlipOcrError('OCR_FAILED', 'Claude API returned no text block');
    }

    return parseOcrJson(textBlock.text);
  } catch (err) {
    if (err instanceof SlipOcrError) throw err;
    // Network/Timeout (AbortError) ฯลฯ → OCR_FAILED (ไม่นับโควตา)
    throw new SlipOcrError('OCR_FAILED', `Claude request error: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// รับค่าตัวเลขบวกเท่านั้น (กัน 0/ติดลบ/ไม่ใช่ตัวเลข) — คืน null ถ้าไม่ผ่าน
function positiveNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── ทิศทางรายการ (buy/sell) ──────────────────────────────────────────────
// ⚠️ เคยเป็นบั๊กความถูกต้องทางการเงิน: โค้ดเดิมเขียน `raw.side === 'sell' ? 'sell' : 'buy'`
// ซึ่งเทียบแบบ strict + case-sensitive แล้ว "Default เป็น buy เงียบๆ" ทุกกรณีที่ไม่ตรงเป๊ะ
// → สลิป "ขาย" ถูกบันทึกเป็น "ซื้อ" (P&L/จำนวนหน่วยถือครองผิดทันที และเป็น Immutable
// Ledger ที่แก้ทีหลังต้องใช้ Reversal) รูปแบบที่ LLM ตอบจริงแล้วหลุด: "Sell" / "SELL" /
// "ขาย" / " sell " (มีช่องว่าง) / null — 5 ใน 6 แบบกลายเป็น buy หมด
//
// กติกาใหม่: normalize ก่อนเทียบเสมอ และ "ห้าม Default เป็น buy" — ถ้าตีความไม่ได้ให้
// คืน null แล้วให้ผู้ใช้เลือกเองบนการ์ด Preview (ดู flexMessage.buildOcrPreviewMessage)
// เดาผิดทางการเงินแย่กว่าถามผู้ใช้เพิ่ม 1 คลิก
const SIDE_ALIASES = new Map([
  ['buy', 'buy'],
  ['ซื้อ', 'buy'],
  ['sell', 'sell'],
  ['ขาย', 'sell'],
  ['จำหน่าย', 'sell'],
  ['ขายออก', 'sell'],
]);

// คืน 'buy' | 'sell' | null (null = อ่านไม่ชัด ต้องให้ผู้ใช้ยืนยันทิศทางเอง)
function normalizeSide(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return SIDE_ALIASES.get(normalized) ?? null;
}

// วันนี้ตามเขตเวลาไทยในรูปแบบ 'YYYY-MM-DD' — ใช้เทียบกันวันที่จากสลิปหลุดไปอนาคต
// (en-CA ให้รูปแบบ YYYY-MM-DD ตรงกับที่ parseDateInput คืน จึงเทียบด้วย String ได้)
function todayIsoInBangkok(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// มูลค่าซื้อขาย "ก่อนหักค่าธรรมเนียม" — มีจำนวน+ราคาต่อหน่วยเมื่อไหร่ให้คำนวณเองเสมอ
// (Deterministic) ไม่มีค่อย Fallback ไปใช้ตัวเลขที่ AI อ่านมา เช่นสลิป Amount-only ของ
// หุ้นต่างประเทศที่ซื้อเป็นจำนวนเงิน (ไม่มี quantity/price_per_unit ให้คำนวณ)
function grossAmount(quantity, pricePerUnit, fallback) {
  if (quantity > 0 && pricePerUnit > 0) {
    return Math.round(quantity * pricePerUnit * 100) / 100;
  }
  return positiveNumberOrNull(fallback);
}

// ── สัญญาณที่ 2: หลักฐานข้อความจริงจากสลิป (side_evidence) ────────────────
// สแกนหาคำบ่งชี้ใน "ข้อความที่ AI คัดมาจากรูป" แทนที่จะเชื่อข้อสรุป side ของ AI
// เคส BCPG: AI คัด "ขาย BCPG" ออกมาถูก แต่สรุป side="buy" — ตัวนี้จับได้ทันที
//
// ต้องหาคำขายก่อนคำซื้อเสมอ เพราะสลิปขายมักมีคำว่า "ซื้อขาย"/"คำสั่งซื้อขาย" ปนอยู่
// ถ้าเช็ค "ซื้อ" ก่อนจะ Match ผิดทาง
const SELL_EVIDENCE_PATTERNS = [/ขาย/, /จำหน่าย/, /\bsell\b/i, /\bsold\b/i];
const BUY_EVIDENCE_PATTERNS = [/ซื้อ/, /\bbuy\b/i, /\bbought\b/i, /\bpurchase/i];

function sideFromEvidence(evidence) {
  if (typeof evidence !== 'string' || !evidence.trim()) return null;
  const text = evidence.trim();

  const hasSell = SELL_EVIDENCE_PATTERNS.some((re) => re.test(text));
  const hasBuy = BUY_EVIDENCE_PATTERNS.some((re) => re.test(text));

  // เจอทั้งสองฝั่งในข้อความเดียว (เช่น "รายการซื้อขาย") = ตัดสินไม่ได้ ต้องถามผู้ใช้
  if (hasSell && hasBuy) return null;
  if (hasSell) return 'sell';
  if (hasBuy) return 'buy';
  return null;
}

// ── สัญญาณที่ 3: Numeric Cross-check (Deterministic ไม่ต้องเชื่อ AI เลย) ────
// ซื้อ  → จ่ายจริง (net) "มากกว่า" มูลค่าซื้อขาย (gross) เพราะบวกค่าคอม + VAT
// ขาย   → ได้รับจริง (net) "น้อยกว่า" มูลค่าซื้อขาย เพราะหักค่าคอม + VAT
// เท่ากัน/ข้อมูลไม่ครบ → null (ไม่มีสัญญาณ ไม่ใช่ข้อสรุป)
//
// ใช้ Threshold 0.01 (1 สตางค์) กันปัดเศษ — ค่าธรรมเนียมจริงมักมากกว่านี้เสมอ
// (เคส BCPG: gross 69.00 vs net 68.89 = ต่าง 0.11 → ชี้ว่าเป็นการขาย)
const NET_GROSS_EPSILON = 0.01;

function numericSideSignal(quantity, pricePerUnit, netAmount) {
  if (!(quantity > 0) || !(pricePerUnit > 0) || !(netAmount > 0)) return null;

  const gross = quantity * pricePerUnit;
  const diff = netAmount - gross;

  if (Math.abs(diff) < NET_GROSS_EPSILON) return null;
  return diff > 0 ? 'buy' : 'sell';
}

// ── รวม 3 สัญญาณเป็นข้อสรุปเดียว ─────────────────────────────────────────
// กติกา (ตัดสินใจร่วมกับ Product Owner): "ห้ามเชื่อ side ที่ AI สรุปมาเพียงลำพัง"
// และ "ถ้าสัญญาณขัดกันเอง ให้ถือว่ากำกวมทันที" — เดาผิดด้านการเงินแย่กว่าถามเพิ่ม 1 คลิก
//
// ⚠️ ห้ามใช้ raw.confidence ของ AI มาตัดสินตรงนี้ — เคส BCPG ตอบผิดด้วย confidence
// "high" ทั้ง 3 รอบ พิสูจน์แล้วว่าเป็นค่าที่เชื่อไม่ได้ (เก็บไว้แสดงผลเท่านั้น)
//
// คืน { side, reason } — reason ไว้ Log ให้ Debug ย้อนหลังได้ว่าตัดสินจากอะไร
function resolveSide({ aiSide, evidenceSide, numericSide }) {
  // สัญญาณที่ตรวจสอบได้จริง 2 ตัวขัดกัน → กำกวม
  if (evidenceSide && numericSide && evidenceSide !== numericSide) {
    return { side: null, reason: 'evidence_vs_numeric_conflict' };
  }

  // หลักฐานข้อความคือสัญญาณที่หนักแน่นที่สุด (คัดมาจากรูปตรงๆ ตรวจสอบซ้ำได้)
  if (evidenceSide) {
    return {
      side: evidenceSide,
      reason: evidenceSide === aiSide ? 'evidence_agrees_with_ai' : 'evidence_overrides_ai',
    };
  }

  // ไม่มีหลักฐานข้อความ → ยอมใช้ Numeric ได้ถ้าไม่ขัดกับ AI
  if (numericSide) {
    if (aiSide && aiSide !== numericSide) {
      return { side: null, reason: 'ai_vs_numeric_conflict' };
    }
    return { side: numericSide, reason: 'numeric_signal' };
  }

  // เหลือแค่คำตอบของ AI ล้วนๆ ซึ่งเป็นสิ่งที่พลาดมาแล้วในเคส BCPG → ไม่เชื่อ ให้ผู้ใช้เลือก
  return { side: null, reason: aiSide ? 'ai_only_not_trusted' : 'no_signal' };
}

// ── Entry point ──────────────────────────────────────────────────────────
// extractSlip(userId, buffer, contentType) → Object ข้อมูลที่อ่านได้ + โควตาคงเหลือ
// ลำดับ: Rate Limit → Quota Check (ก่อนเรียก Claude) → Claude Vision → Validate →
//        นับโควตา (เฉพาะอ่านสำเร็จ) → คืนผล
// throw SlipOcrError codes: OCR_RATE_LIMITED / OCR_QUOTA_EXCEEDED / OCR_NOT_A_SLIP /
//        OCR_MULTIPLE_ITEMS / OCR_FAILED / OCR_NOT_CONFIGURED (ทุก Error = "ไม่นับโควตา")
async function extractSlip(userId, buffer, contentType, now = new Date()) {
  // 1) Rate Limit (in-memory) — ไม่นับโควตา, ไม่เรียก Claude
  const nowMs = now.getTime();
  const last = lastCallByUser.get(userId) ?? 0;
  if (nowMs - last < RATE_LIMIT_MS) {
    throw new SlipOcrError('OCR_RATE_LIMITED', 'Too many OCR requests in a short period', {
      retryAfterMs: RATE_LIMIT_MS - (nowMs - last),
    });
  }
  lastCallByUser.set(userId, nowMs);

  // 2) Quota Check ก่อนเรียก Claude (กันเสียเงินเมื่อโควตาเต็ม) — ไม่นับเพิ่ม
  const yearMonth = bangkokYearMonth(now);
  const used = await aiOcrUsageRepository.getUsageCount(userId, yearMonth);
  if (used >= MONTHLY_QUOTA) {
    throw new SlipOcrError('OCR_QUOTA_EXCEEDED', `Monthly OCR quota (${MONTHLY_QUOTA}) reached`, {
      used,
      limit: MONTHLY_QUOTA,
    });
  }

  // 3) เรียก Claude Vision
  const base64 = Buffer.isBuffer(buffer)
    ? buffer.toString('base64')
    : Buffer.from(buffer).toString('base64');
  const raw = await callClaudeVision(base64, mediaTypeFromContentType(contentType));

  // 4) Validate ผลลัพธ์ (ทุกกรณีที่ไม่ผ่าน = throw โดยยังไม่นับโควตา)
  if (!raw || raw.is_slip !== true) {
    throw new SlipOcrError('OCR_NOT_A_SLIP', 'Image is not a trade slip');
  }
  if (raw.multiple_items === true) {
    throw new SlipOcrError('OCR_MULTIPLE_ITEMS', 'Slip contains multiple items');
  }
  const symbol =
    typeof raw.symbol === 'string' && raw.symbol.trim() ? raw.symbol.trim().toUpperCase() : null;
  // Field สำคัญ (Symbol) อ่านไม่ได้เลย → ถือเป็น "อ่านไม่ออก" ไม่สร้าง Preview เปล่าๆ
  if (!symbol) {
    throw new SlipOcrError('OCR_NOT_A_SLIP', 'Symbol not readable from slip');
  }

  // 5) นับโควตา (อ่านสำเร็จ + จะส่ง Preview) — Increment ล้มเหลวไม่ควร Block UX
  // (ผู้ใช้ไม่ควรเสียประสบการณ์เพราะระบบนับพลาด) จึง Log แล้วเดินต่อด้วย best-effort count
  let newCount = used + 1;
  try {
    newCount = await aiOcrUsageRepository.incrementUsage(userId, yearMonth);
  } catch (err) {
    console.error(`[slipOcr] incrementUsage failed for ${userId}: ${err.message}`);
  }

  const dateRaw =
    typeof raw.date === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw.date.trim())
      ? raw.date.trim()
      : null;
  let dateIso = dateRaw ? parseDateInput(dateRaw) : null; // null ถ้าวันที่ไม่มีจริง

  // ⚠️ Guard วันที่อนาคต: สลิปที่เกิดขึ้นแล้วเป็นไปไม่ได้ที่จะลงวันที่ในอนาคต
  // เจอจริงตอนทดสอบ BCPG — Model อ่าน "26 มิ.ย. 69" (พ.ศ. ย่อ) เป็น ค.ศ. 2069 บ้าง
  // (2 ใน 3 รอบ) ซึ่ง parseDateInput ปล่อยผ่านเพราะ 2069 < BUDDHIST_ERA_THRESHOLD (2100)
  // จึงได้ธุรกรรมลงวันที่ล่วงหน้า 43 ปีแบบเงียบๆ — ทิ้งค่าแล้วให้ Fallback เป็น "วันนี้"
  // (createPending ใช้วันนี้เมื่อ dateIso เป็น null) ดีกว่าบันทึกวันที่ผิดลง Ledger
  if (dateIso && dateIso > todayIsoInBangkok(now)) {
    logger.warn('slip ocr date in the future — discarded', {
      userId,
      symbol,
      rawDate: raw.date ?? null,
      parsedDate: dateIso,
    });
    dateIso = null;
  }

  const quantity = positiveNumberOrNull(raw.quantity);
  const pricePerUnit = positiveNumberOrNull(raw.price_per_unit);
  const netAmount = positiveNumberOrNull(raw.net_amount);

  // ── ตัดสินทิศทางรายการจาก 3 สัญญาณ (ห้ามเชื่อ AI ลำพัง ดู resolveSide) ──────
  const aiSide = normalizeSide(raw.side);
  const evidenceSide = sideFromEvidence(raw.side_evidence);
  const numericSide = numericSideSignal(quantity, pricePerUnit, netAmount);
  const { side, reason } = resolveSide({ aiSide, evidenceSide, numericSide });

  // ⚠️ Log ทุกครั้งที่อ่านสลิป — ตอนสืบเคส BCPG ต้องดาวน์โหลดรูปจาก Storage มา Replay
  // ผ่าน Claude ใหม่เพียงเพื่อตอบว่า "AI ตอบ side อะไรมา" ซึ่งไม่ควรต้องทำอีก
  // (ไม่ Log ตัวเลขเงิน/รูป — เก็บเฉพาะที่จำเป็นต่อการวินิจฉัยทิศทางรายการ)
  logger.info('slip ocr side resolved', {
    userId,
    symbol,
    rawSide: raw.side ?? null,
    sideEvidence: typeof raw.side_evidence === 'string' ? raw.side_evidence.slice(0, 80) : null,
    aiSide,
    evidenceSide,
    numericSide,
    resolvedSide: side,
    reason,
    aiConfidence: raw.confidence ?? null, // แสดงผลเท่านั้น ไม่ได้ใช้ตัดสิน (ดู resolveSide)
  });

  return {
    symbol,
    // 'buy' | 'sell' | null — null = อ่านไม่ชัด/สัญญาณขัดกัน ให้ผู้ใช้เลือกเองบนการ์ด
    side,
    quantity,
    pricePerUnit,
    // ยอดเงินรวม — ชื่อ Key คง amountThb เพื่อไม่ให้ Controller เดิมพัง (ค่าเป็นสกุลตาม
    // currency ด้านล่าง ไม่จำเป็นต้องเป็นบาทเสมอไปแล้ว)
    //
    // นิยาม: "มูลค่าซื้อขายก่อนหักค่าธรรมเนียม" เสมอ — ถ้ามีทั้งจำนวนและราคาต่อหน่วย ให้
    // คำนวณเองแบบ Deterministic ไม่พึ่งว่า AI จะทำตาม Prompt (สลิปไทยโชว์ทั้งมูลค่าหุ้น
    // และยอดสุทธิ Model แต่ละตัวหยิบคนละค่า: เคส BCPG Haiku หยิบ 68.89 (สุทธิ) ส่วน
    // Sonnet หยิบ 69.00 (มูลค่าหุ้น) → ต้นทุน/กำไรจะเพี้ยนตาม Broker ถ้าไม่บังคับนิยาม)
    // ปัดทศนิยม 2 ตำแหน่งกัน Floating Point (10 × 6.9 = 68.99999999999999)
    amountThb: grossAmount(quantity, pricePerUnit, raw.amount ?? raw.amount_thb),
    // Multi-Currency (Round 10) — สกุลเงินที่อ่านจากสลิป (Default 'THB' ถ้าไม่ใช่ USD ชัดเจน)
    currency: raw.currency === 'USD' ? 'USD' : 'THB',
    date: dateIso ? dateRaw : null, // แสดง DD/MM/YYYY เฉพาะเมื่อ Parse เป็นวันที่จริงได้
    dateIso, // ISO 'YYYY-MM-DD' สำหรับส่งเข้า createPending (null = ใช้วันนี้)
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
    remainingQuota: Math.max(0, MONTHLY_QUOTA - newCount),
    quotaLimit: MONTHLY_QUOTA,
  };
}

// ล้าง Rate Limit state (สำหรับ Test เท่านั้น — Production ไม่เรียก)
function __clearRateLimit() {
  lastCallByUser.clear();
}

module.exports = {
  // Export เพื่อ Unit Test ตรรกะตัดสินทิศทางแยกจากการยิง Claude จริง
  sideFromEvidence,
  numericSideSignal,
  resolveSide,
  SlipOcrError,
  MONTHLY_QUOTA,
  RATE_LIMIT_MS,
  extractSlip,
  __clearRateLimit,
};
