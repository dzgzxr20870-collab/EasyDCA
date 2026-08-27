const assetRepository = require('../repositories/asset.repository');
// Stage 8-fix — ด่าน "เพิ่มของใหม่เข้าพอร์ตนี้ได้ไหม" (มติ Founder 24 ส.ค. 2569)
const portfoliosService = require('./portfolios.service');
const transactionRepository = require('../repositories/transaction.repository');
const { calculateHeldQuantity, todayInBangkok } = require('./transaction.service');
const { dividendSign } = require('../utils/transactionType.util');

// ═══════════════════════════════════════════════════════════════════════════
// dividend.service — บันทึก "เงินปันผลรับ" เข้า Ledger (Stage 6b / migration 047)
// ═══════════════════════════════════════════════════════════════════════════
// ออกแบบไว้ที่ docs/DESIGN_MULTI_PORTFOLIO_BROKER_SECTOR.md § 4.5 + § 5
//
// ── กฎการคำนวณ (Design Doc § 5.3 — ห้ามเปลี่ยนโดยไม่ได้รับอนุมัติ) ───────────
//   heldQty      ไม่เปลี่ยน  ปันผล "เงินสด" ไม่ได้ทำให้ถือหุ้นเพิ่ม
//   costBasis    ไม่เปลี่ยน  ตัดต้นทุนจะทำให้ ROI ของสินทรัพย์เพี้ยน
//   realizedPnL  ไม่รวม      ปันผลเป็น "รายได้" คนละก้อนกับกำไรจากส่วนต่างราคา
//   totalDividendThb  +amount   แสดงแยกเป็นบรรทัดของตัวเองบน Dashboard
//
// ทั้งหมดนี้บังคับใช้ผ่าน utils/transactionType.util.js ที่เดียว (Stage 6a)
// ไฟล์นี้ **ไม่มี if/else ตาม type เองเลยแม้แต่บรรทัดเดียว** โดยตั้งใจ
//
// ── ทำไมแยก Service/Endpoint ออกจาก transaction.service ────────────────────
// Design Doc § 4.5: Payload ของ dividend ต่างกันเชิงความหมาย (ไม่มีราคาต่อหน่วย
// ที่ผู้ใช้กรอก, ไม่มีทิศทาง buy/sell, ไม่แตะ Price Feed เลย) การยัดเข้า
// processBuyCommand/processSellCommand จะทำให้ Validation กลายเป็น if-else ตาม
// type ซึ่งเป็นจุดที่พลาดง่ายที่สุดบนเส้นทางเงิน

class DividendServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DividendServiceError';
    this.code = code;
    this.details = details;
  }
}

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundToEight(value) {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

// ═══════════════════════════════════════════════════════════════════════════
// heldQuantityAsOf — ยอดถือ ณ "สิ้นวันที่ระบุ" (ไม่ใช่ยอดถือวันนี้)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ต้องคิด ณ วันที่ได้ปันผล ไม่ใช่วันนี้ — เคสจริงที่พังถ้าใช้ยอดวันนี้:
// ผู้ใช้ได้ปันผลวันที่ 10 แล้วขายหุ้นหมดวันที่ 20 พอมาบันทึกย้อนหลังวันที่ 25
// ยอดถือ "วันนี้" = 0 → ระบบจะปฏิเสธว่า NOTHING_TO_RECEIVE_DIVIDEND ทั้งที่
// วันที่ 10 เขาถืออยู่จริงและได้ปันผลจริง (การบันทึกย้อนหลังคือ Use Case ปกติ
// ของฟีเจอร์นี้ เพราะปันผลเข้าบัญชีก่อนคนจะมานั่งบันทึกเสมอ)
//
// เทียบ date แบบ String ได้เพราะ transactions.date เป็น DATE รูปแบบ 'YYYY-MM-DD'
// (เรียงตามพจนานุกรม = เรียงตามเวลา) และเป็นวันตามปฏิทินไทยทั้งคู่
// ใช้ <= (รวมวันนั้นด้วย) เพราะการซื้อในวันเดียวกับที่ขึ้น XD ก็ยังได้ปันผลงวดนั้น
function heldQuantityAsOf(transactions, asOfDate) {
  const upTo = transactions.filter((tx) => typeof tx.date === 'string' && tx.date <= asOfDate);
  // Reuse calculateHeldQuantity ตัวเดิม — สูตร "ยอดถือ" มีที่เดียวของทั้งระบบ
  // (ห้ามเขียน reduce เองที่นี่ ไม่งั้น dividend จะกลายเป็น type ที่ 8 ที่คำนวณ
  //  ยอดถือด้วยกฎของตัวเอง ซึ่งเป็นบั๊กแบบเดียวกับที่ Stage 6a เพิ่งไล่แก้ไป)
  return calculateHeldQuantity(upTo);
}

// ═══════════════════════════════════════════════════════════════════════════
// totalDividendThb — ยอดเงินปันผลสะสม (Design Doc § 5.2 ขั้น [6])
// ═══════════════════════════════════════════════════════════════════════════
// = Σ(amount ที่ type='dividend') − Σ(amount ที่ type='dividend_reversal')
//
// ⚠️ ห้ามใช้ excludeUndoneTransactions ของ undoTransaction.service ที่นี่ —
// ตัวนั้นสำหรับ "สถิติการนับครั้ง" (จำนวนครั้ง DCA/Streak) ที่ต้องตัดคู่หักล้างทิ้ง
// ส่วนที่นี่เป็นยอดเงินซึ่งต้อง Replay ทุกแถวรวม Reversal ตามหลัก Immutable Ledger
// (ผลลัพธ์เท่ากันพอดีในเคสปกติ แต่คนละเหตุผล และต่างกันทันทีถ้า Reversal มาโดยไม่มี
//  คู่ต้นฉบับอยู่ในชุดข้อมูลที่ส่งเข้ามา เช่นดูย้อนหลังแบบจำกัดช่วงวัน)
//
// ไม่มี if ตาม type — ถาม dividendSign() ที่เดียว (buy/sell คืน 0 อยู่แล้ว
// และ type ที่ไม่รู้จักจะ throw ทันทีแทนที่จะเงียบ)
function calculateTotalDividend(transactions) {
  const total = transactions.reduce((sum, tx) => {
    const sign = dividendSign(tx.type, 'dividend.calculateTotalDividend');
    return sign === 0 ? sum : sum + sign * Number(tx.amountThb);
  }, 0);

  return roundToTwo(total);
}

// ═══════════════════════════════════════════════════════════════════════════
// recordDividend — บันทึกเงินปันผลรับ 1 รายการ
// ═══════════════════════════════════════════════════════════════════════════
// params: { assetId, amountThb, quantity, date?, note? }
//   quantity = **บังคับ** (มติ Founder 24 ส.ค. 2569 — ดูเหตุผลที่บล็อกคำนวณด้านล่าง)
//
// อาจ throw: ASSET_NOT_FOUND (404) · VALIDATION_ERROR (400) ·
//            NOTHING_TO_RECEIVE_DIVIDEND (403)
async function recordDividend(userId, params, options = {}) {
  const amountThb = Number(params.amountThb);
  if (!Number.isFinite(amountThb) || amountThb <= 0) {
    throw new DividendServiceError('VALIDATION_ERROR', 'amountThb must be a positive number', {
      field: 'amountThb',
    });
  }

  // ── Cross-User Isolation (กฎเหล็กข้อ 3) ────────────────────────────────────
  // ⚠️ assetId มาจาก Request Body ของ Client — FK ตรวจได้แค่ "asset นี้มีอยู่จริง"
  // ไม่ได้ตรวจ "เป็นของใคร" ถ้าไม่ยืนยันเจ้าของที่นี่ ผู้ใช้ A จะยัดรายการปันผล
  // เข้าสินทรัพย์ของผู้ใช้ B ได้ (บทเรียนตรงจาก Cross-User Isolation Audit 9 ส.ค.)
  //
  // findByIds ผ่าน queryForUser ซึ่งบังคับ .eq('user_id', userId) ให้เสมอ —
  // ห้ามเปลี่ยนไปใช้ Query ที่ไม่ผ่าน Helper นี้เด็ดขาด
  //
  // RPC create_transaction_locked ตรวจซ้ำอีกชั้นด้วย (migration 036: Lock แถว
  // asset ในเงื่อนไข user_id เดียวกัน) — สองชั้นโดยตั้งใจ ชั้นนี้เพื่อตอบ 404 ที่
  // อ่านรู้เรื่อง ชั้น DB เพื่อกัน Race/Path ที่ยังไม่มีในวันนี้
  const [asset] = await assetRepository.findByIds([params.assetId], userId);
  if (!asset) {
    throw new DividendServiceError('ASSET_NOT_FOUND', `Asset ${params.assetId} not found for this user`, {
      assetId: params.assetId,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ ด่าน "อ่านได้ เขียนไม่ได้" ของพอร์ตส่วนเกิน (Stage 8-fix)
  // ═══════════════════════════════════════════════════════════════════════
  // ปันผลคือ "เพิ่มของใหม่" (รายได้เข้า Ledger) จึงถูกบล็อกเหมือนการซื้อ —
  // ต่างจากการขาย/Undo ที่ต้องทำได้เสมอ (มติ Founder 24 ส.ค. 2569)
  //
  // ⚠️ ต้องเรียกที่นี่แยกต่างหาก **ไม่ได้ผ่าน validateBuy** เพราะ Design Doc § 4.5
  // แยก Endpoint ปันผลออกจาก POST /transactions โดยตั้งใจ (Payload ต่างกันเชิง
  // ความหมายทั้งชุด) จึงไม่ได้ใช้คอขวดเดียวกับการซื้อ
  //
  // ตรวจพอร์ตของสินทรัพย์ที่ปันผลจะถูกผูกเข้าไป (ปลายทางจริงของรายการนี้)
  await portfoliosService.assertCanAddToPortfolio(
    userId,
    asset.portfolioId ?? null,
    options.userRecord ?? { plan: options.plan, planExpiresAt: options.planExpiresAt }
  );

  const date = params.date ?? todayInBangkok();

  const history = await transactionRepository.findAllByAsset(asset.id, userId);
  const heldAtDate = heldQuantityAsOf(history, date);

  // ── จำนวนหน่วยที่ได้ปันผลนี้ — **บังคับกรอกเสมอ** ───────────────────────────
  // ⚠️ ห้ามเติมค่าให้เองเมื่อผู้ใช้ไม่ส่งมาเด็ดขาด (เดิมเคย Fallback เป็นยอดถือ
  // ณ วันนั้น — ถูกถอดออกตามมติ Founder 24 ส.ค. 2569)
  //
  // เหตุผล — **กฎยืนข้อ 11: Silent Default เป็น Anti-pattern เสมอ**
  // จำนวนหน่วยที่ "ระบบรู้" กับที่ "ได้ปันผลจริง" ไม่จำเป็นต้องเท่ากันเลย:
  // ปันผลจ่ายตามจำนวนหน่วย ณ วัน XD ซึ่งมักเป็นคนละวันกับวันที่เงินเข้า และผู้ใช้
  // จำนวนมากเพิ่งเริ่มบันทึกกลางทาง (ระบบจึงเห็นประวัติไม่ครบ) การเดาแทนผู้ใช้
  // ที่นี่ = เขียนตัวเลขที่ผู้ใช้ไม่เคยยืนยันลง Ledger ถาวร แล้วมันจะไหลต่อไปเป็น
  // DPS (price_per_unit) ที่ผู้ใช้เอาไปเทียบข้ามงวดจริง — ผิดแบบเงียบสนิท
  //
  // ⚠️ ห้าม "ปรับปรุง" กลับไปเป็น Optional เพราะคิดว่าสะดวกกว่า — ความสะดวก
  // ตรงนี้แลกมาด้วยตัวเลขเงินที่ไม่มีใครยืนยัน
  if (params.quantity === undefined || params.quantity === null || params.quantity === '') {
    throw new DividendServiceError('VALIDATION_ERROR', 'quantity is required', {
      field: 'quantity',
    });
  }
  const quantity = Number(params.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new DividendServiceError('VALIDATION_ERROR', 'quantity must be a positive number', {
      field: 'quantity',
    });
  }

  // ── ไม่ได้ถือสินทรัพย์นี้ ณ วันที่ระบุ → ปฏิเสธ (Design Doc § 4.5) ───────────
  // ⚠️ เช็คจาก heldAtDate เสมอ **ไม่ใช่จาก quantity ที่ผู้ใช้กรอก** — ไม่งั้นผู้ใช้
  // กรอก quantity มาเองก็จะข้ามด่านนี้ได้ทุกครั้ง (บันทึกปันผลของหุ้นที่ไม่เคยถือ)
  //
  // ⚠️ ยิ่งบังคับกรอก quantity แล้ว ด่านนี้ยิ่งห้ามหายไป — heldQuantityAsOf คือ
  // "ของจริงที่ระบบยืนยันได้" ส่วน quantity คือ "สิ่งที่ผู้ใช้อ้าง" คนละบทบาทกัน
  // และต้องคิด ณ วันที่ได้ปันผล ไม่ใช่วันนี้ เพราะบันทึกย้อนหลังคือ Use Case ปกติ
  // (ได้ปันผล 10 มี.ค. → ขายหมด 20 มี.ค. → มาบันทึก 25 มี.ค. ต้องทำได้)
  if (heldAtDate <= 0) {
    throw new DividendServiceError(
      'NOTHING_TO_RECEIVE_DIVIDEND',
      `No holding of this asset as of ${date} to receive a dividend`,
      { assetId: asset.id, symbol: asset.symbol, date, held: heldAtDate }
    );
  }

  // ── price_per_unit = เงินปันผลต่อหน่วย (DPS) ────────────────────────────────
  // ⚠️ ไม่ใช่ค่าหลอกเพื่อให้ผ่าน CHECK (price_per_unit > 0) — เป็นตัวเลขที่นักลงทุน
  // ใช้จริง (เทียบ DPS ข้ามงวดได้ทันที) เหตุผลเต็มอยู่ในหัวข้อ "[ทำไม dividend
  // ยังต้องมี quantity > 0 และ price_per_unit > 0]" ของ migration 047
  //
  // roundToEight ให้ตรงกับ NUMERIC(20,8) ของคอลัมน์ · ปันผลก้อนเล็กมากกับจำนวน
  // หน่วยเยอะมากอาจปัดลงเหลือ 0 ซึ่งจะชน CHECK — กันด้วยพื้นล่าง 1e-8 (หน่วยเล็ก
  // ที่สุดที่คอลัมน์เก็บได้) แทนที่จะปล่อยให้ DB ปฏิเสธด้วย Error ดิบที่อ่านไม่รู้เรื่อง
  const pricePerUnit = Math.max(roundToEight(amountThb / quantity), 1e-8);

  // Multi-Currency: ปันผลของสินทรัพย์ USD ก็เป็น USD — สกุลต้องตามสินทรัพย์
  // ห้าม Hardcode 'THB' (แถวจะติดป้ายสกุลผิดแบบเดียวกับบั๊ก Reversal USD เดิม)
  const currency = history.some((tx) => tx.currency === 'USD') ? 'USD' : 'THB';

  const transaction = await transactionRepository.create({
    userId,
    assetId: asset.id,
    type: 'dividend',
    amountThb: roundToTwo(amountThb),
    pricePerUnit,
    quantity: roundToEight(quantity),
    currency,
    // ปันผลรับไม่มีค่าธรรมเนียมฝั่งเรา (ภาษีหัก ณ ที่จ่ายเป็นคนละเรื่องและยังไม่รองรับ
    // ในรอบนี้) — ส่ง NULL = "ไม่รู้" ตามความหมายของ migration 041 ไม่ใช่ 0
    feeThb: null,
    date,
    note: params.note ?? null,
    source: options.source ?? 'web',
  });

  return {
    transaction,
    symbol: asset.symbol,
    // ยอดถือต้อง "เท่าเดิมเป๊ะ" หลังบันทึกปันผล — heldAfter มาจาก RPC ที่คำนวณ
    // ใต้ Lock จริง (migration 047) ส่งกลับไปให้ Caller/เทสต์ยืนยันได้ตรงๆ
    heldQuantity: Number(transaction.heldAfter),
    dividendPerUnit: pricePerUnit,
  };
}

module.exports = {
  DividendServiceError,
  recordDividend,
  calculateTotalDividend,
  heldQuantityAsOf,
};
