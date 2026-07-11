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

const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
// Claude Haiku 4.5 — รุ่นล่าสุดที่รองรับ Vision ณ ตอนเขียน (ต้นทุน ~$0.004-0.005/รูป
// ถูกพอที่จะไม่ต้องมี Sonnet Fallback — ตัดสินใจแล้ว) ID ตรงตาม Anthropic Model Catalog
const CLAUDE_MODEL = 'claude-haiku-4-5';
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
  '- side = "buy" (ซื้อ) หรือ "sell" (ขาย) ถ้าไม่ชัดเจนให้ null',
  '- date รูปแบบ DD/MM/YYYY (ปี ค.ศ. หรือ พ.ศ. ตามที่เห็นในสลิป) ถ้าไม่มีให้ null',
  '- quantity = จำนวนหน่วย (เช่น จำนวนหุ้น/เหรียญ), price_per_unit = ราคาต่อหน่วย,',
  '  amount = ยอดเงินรวมของรายการ (ตัวเลขล้วน ไม่มี comma)',
  '- ⚠️ สำคัญ: ถ้าสลิปแสดง "เฉพาะมูลค่า/ยอดเงินรวม" โดยไม่มีจำนวนหน่วยและไม่มีราคาต่อหน่วย',
  '  (เช่น แอปหุ้นต่างประเทศอย่าง Dime! ที่ซื้อเป็นจำนวนเงิน) ให้ใส่ตัวเลขนั้นใน amount เท่านั้น',
  '  และให้ quantity = null, price_per_unit = null (ห้ามเอายอดรวมไปใส่เป็น price_per_unit)',
  '- currency = สกุลเงินของตัวเลขในสลิป: "USD" ถ้าเห็นสัญลักษณ์ $ หรือ USD ชัดเจน,',
  '  มิฉะนั้น (รวมถึงกรณีไม่ชัดเจน) ให้เป็น "THB"',
  '',
  'ตอบกลับเป็น JSON object เดียวเท่านั้น ห้ามมีข้อความอื่น ห้ามใส่ markdown code fence รูปแบบ:',
  '{"is_slip":boolean,"multiple_items":boolean,"symbol":string|null,"side":"buy"|"sell"|null,"quantity":number|null,"price_per_unit":number|null,"amount":number|null,"currency":"THB"|"USD","date":string|null,"confidence":"high"|"medium"|"low"}',
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
  const dateIso = dateRaw ? parseDateInput(dateRaw) : null; // null ถ้าวันที่ไม่มีจริง

  return {
    symbol,
    side: raw.side === 'sell' ? 'sell' : 'buy', // Default "buy" (Use Case หลัก = บันทึกการซื้อ DCA)
    quantity: positiveNumberOrNull(raw.quantity),
    pricePerUnit: positiveNumberOrNull(raw.price_per_unit),
    // ยอดเงินรวม: อ่าน field ใหม่ 'amount' ก่อน (รองรับ 'amount_thb' เดิมเผื่อ Model
    // ยังตอบชื่อเก่า) — ชื่อ Key ผลลัพธ์คง amountThb เพื่อไม่ให้ Controller เดิมพัง
    // (ค่าเป็นสกุลตาม currency ด้านล่าง — ไม่จำเป็นต้องเป็นบาทเสมอไปแล้ว)
    amountThb: positiveNumberOrNull(raw.amount ?? raw.amount_thb),
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
  SlipOcrError,
  MONTHLY_QUOTA,
  RATE_LIMIT_MS,
  extractSlip,
  __clearRateLimit,
};
