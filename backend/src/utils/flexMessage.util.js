const { dowToDayName, THAI_DAY_NAMES, formatThaiDate } = require('./thaiDate.util');

// Flex Message Builders ตาม Design System ใน UI_UX.md § 1, § 3
// สีอ้างอิงจาก UI_UX.md § 1.1 (Financial Status Colors)
const COLOR = {
  profit: '#16A34A',
  profitBg: '#E6F4EA',
  loss: '#DC2626',
  lossBg: '#FEE2E2',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  info: '#2563EB',
  textPrimary: '#1E293B',
  textSecondary: '#64748B',
};

// แปล Error Code (API.md § 5) เป็นข้อความไทยที่ผู้ใช้เข้าใจง่าย
// ห้ามโชว์ Code ดิบให้ผู้ใช้เห็น
const ERROR_MESSAGES = {
  ASSET_LIMIT_REACHED:
    'คุณใช้ครบ 2 สินทรัพย์ตามแพ็กเกจ Free แล้ว หากต้องการเพิ่มสินทรัพย์ใหม่ กรุณาอัพเกรดเป็น Premium',
  ASSET_NOT_FOUND: 'ไม่พบสินทรัพย์นี้ในพอร์ตของคุณ ลองบันทึกรายการซื้อก่อนนะครับ',
  INSUFFICIENT_QUANTITY:
    'จำนวนที่ต้องการขายมากกว่าที่คุณถือครองอยู่ กรุณาตรวจสอบยอดคงเหลืออีกครั้ง',
  NO_HOLDING_TO_CALCULATE_PROFIT:
    'ไม่มีการถือครองสินทรัพย์นี้อยู่ในขณะนี้ จึงยังคำนวณกำไร/ขาดทุนไม่ได้ ลองพิมพ์ "พอต" เพื่อดูสินทรัพย์ที่คุณถืออยู่',
  PRICE_FEED_NOT_IMPLEMENTED:
    'การบันทึกด้วยจำนวนเงินรองรับเฉพาะบางสินทรัพย์ (เช่น Crypto อย่าง BTC/ETH) เท่านั้น สำหรับสินทรัพย์อื่นกรุณาระบุจำนวนหน่วยและราคา เช่น "ซื้อ PTT 50 หุ้น ราคา 34"',
  // ทองคำ (Phase 3 Round 7) — ดึงราคาจากสมาคมค้าทองคำฯ (Community API) ไม่สำเร็จ
  // หรือราคายังว่าง (เช่นก่อนตลาดเปิด) — ไม่เดาราคา ให้ผู้ใช้ลองใหม่/ระบุราคาเอง
  GOLD_PRICE_UNAVAILABLE:
    'ดึงราคาทองคำปัจจุบันไม่ได้ในขณะนี้ (ราคายังไม่อัพเดตหรือระบบราคาขัดข้องชั่วคราว) กรุณาลองใหม่ภายหลัง หรือระบุราคาต้นทุนเองตอนซื้อ เช่น "ซื้อ GOLD 1 หุ้น ราคา 71000"',
  // กองทุนรวมไทย (Round 7 — SEC Open Data API)
  MUTUAL_FUND_NAV_UNAVAILABLE:
    'ดึงราคา NAV ของกองทุนนี้ไม่ได้ในขณะนี้ (NAV ยังไม่อัพเดตหรือระบบ ก.ล.ต. ขัดข้องชั่วคราว) กรุณาลองใหม่ภายหลัง หรือระบุราคาต้นทุนเองตอนซื้อ',
  MUTUAL_FUND_LIST_UNAVAILABLE:
    'ค้นหารายชื่อกองทุนไม่ได้ในขณะนี้ (ระบบข้อมูลกองทุนขัดข้องชั่วคราว) กรุณาลองใหม่อีกครั้งภายหลัง',
  FUND_CLASS_NOT_FOUND:
    'ไม่พบชนิดหน่วยลงทุนที่เลือก อาจมีการเปลี่ยนแปลงข้อมูล กรุณาพิมพ์คำสั่งซื้อกองทุนใหม่อีกครั้ง',
  // ยังไม่ได้ตั้งค่า SEC_API_SUBSCRIPTION_KEY / SEC_FUND_MASTER_LIST_PATH (Config ไม่พร้อม)
  SEC_NOT_CONFIGURED:
    'ระบบข้อมูลกองทุนรวมยังไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลังหรือติดต่อทีมงาน',
  // "ขาย <SYMBOL> ทั้งหมด" — Asset ยังมีอยู่แต่ยอดคงเหลือเป็น 0 (ขายไปหมดแล้ว)
  NOTHING_TO_SELL:
    'สินทรัพย์นี้ถูกขายไปหมดแล้ว ไม่มียอดคงเหลือให้ขายเพิ่ม ลองพิมพ์ "พอต" เพื่อดูสินทรัพย์ที่คุณถืออยู่',
  // "ขาย <SYMBOL> ทั้งหมด" — ดึงราคาตลาดปัจจุบันไม่ได้ (หุ้นไทยยังไม่มี Price Feed
  // หรือระบบราคาขัดข้องชั่วคราว) — ไม่เดาราคาให้
  MARKET_PRICE_UNAVAILABLE:
    'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ (อาจเป็นสินทรัพย์ที่ยังไม่มีราคาตลาด เช่นหุ้นไทย หรือระบบราคาขัดข้องชั่วคราว) กรุณาลองใหม่อีกครั้งภายหลัง',
  // ราคาที่พิมพ์เป็น USD แต่แปลงเป็นบาทไม่ได้ (ระบบอัตราแลกเปลี่ยนขัดข้อง) — ไม่เดาเรต
  FX_RATE_UNAVAILABLE:
    'แปลงราคาจาก USD เป็นบาทไม่ได้ในขณะนี้ (ระบบอัตราแลกเปลี่ยนขัดข้องชั่วคราว) กรุณาลองใหม่ภายหลัง หรือระบุราคาเป็นบาทโดยตรง',
  VALIDATION_ERROR:
    'ไม่รู้จักสินทรัพย์นี้ กรุณาติดต่อทีมงานเพื่อเพิ่มในระบบ หรือตรวจสอบว่าพิมพ์ชื่อย่อถูกต้องแล้ว',
  // Confirm Flow (SRS.md § 2.3 [5-7]) — Postback มาช้า/ซ้ำ/ไม่พบ pending record
  PENDING_EXPIRED: 'รายการหมดเวลายืนยันแล้ว (เกิน 5 นาที) กรุณาพิมพ์คำสั่งใหม่อีกครั้ง',
  PENDING_NOT_FOUND: 'ไม่พบรายการที่รอยืนยัน อาจหมดอายุหรือถูกยกเลิกไปแล้ว กรุณาพิมพ์คำสั่งใหม่',
  PENDING_ALREADY_RESOLVED: 'รายการนี้ถูกดำเนินการไปแล้ว ไม่สามารถทำซ้ำได้',
  // Command History — คำสั่ง "ยกเลิกล่าสุด" (undoTransaction.service)
  NO_TRANSACTION_TO_UNDO: 'ยังไม่มีรายการให้ยกเลิก ลองบันทึกรายการซื้อ/ขายก่อนนะครับ',
  ALREADY_UNDONE: 'รายการล่าสุดถูกยกเลิกไปแล้ว ไม่สามารถยกเลิกซ้ำได้',
  CANNOT_UNDO_QUANTITY_MISMATCH:
    'ยกเลิกรายการล่าสุดไม่ได้ เพราะยอดคงเหลือปัจจุบันน้อยกว่าจำนวนในรายการนั้น (อาจมีการขายไปแล้วบางส่วน)',
  // DCA Reminder (dcaReminder.service) — ตั้ง/ลบเตือน
  REMINDER_NOT_FOUND:
    'ไม่พบการตั้งเตือนของสินทรัพย์นี้ที่กำลังใช้งานอยู่ ลองพิมพ์ "ดูเตือน" เพื่อดูรายการที่ตั้งไว้',
  INVALID_REMINDER:
    'ตั้งเตือนไม่สำเร็จ กรุณาตรวจสอบรูปแบบ เช่น "ตั้งเตือน BTC ทุกวันจันทร์ 1000" หรือ "ตั้งเตือน AAPL ทุกวันที่ 5 3000"',
  // DCA Reminder Setup Flow (reminderSetupFlow.service) — สนทนาแบบเลือกปุ่มหลายขั้น
  SETUP_SESSION_NOT_FOUND:
    'ไม่พบขั้นตอนการตั้งเตือนที่ค้างอยู่ (อาจหมดเวลา 5 นาทีแล้ว) กรุณากดปุ่ม "⏰ ตั้งเตือน DCA" ที่เมนูเพื่อเริ่มใหม่',
  WRONG_STEP:
    'ปุ่มนี้ไม่ตรงกับขั้นตอนปัจจุบัน (อาจกดปุ่มเก่าซ้ำ) กรุณาทำตามปุ่มล่าสุดที่ระบบส่งให้ หรือกด "ยกเลิก" แล้วเริ่มใหม่',
  PORTFOLIO_EMPTY_FOR_REMINDER:
    'คุณยังไม่มีสินทรัพย์ในพอร์ต จึงยังตั้งเตือน DCA ไม่ได้ ลองบันทึกการซื้อครั้งแรกก่อน เช่น "ซื้อ BTC 1000"',
  INVALID_AMOUNT: 'จำนวนเงินไม่ถูกต้อง กรุณาพิมพ์เป็นตัวเลขที่มากกว่า 0 (เช่น 1000) อีกครั้ง',
  INVALID_DAY:
    'วันที่ไม่ถูกต้อง สำหรับรายเดือนกรุณาพิมพ์เลข 1-31 หรือเลือกจากปุ่มที่ระบบส่งให้',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่อีกครั้งในภายหลัง',
  // Payment Admin Postback (payment.service) — อนุมัติ/ปฏิเสธผ่านปุ่มใน LINE
  // NOT_AUTHORIZED: ตอบสั้นๆ ไม่บอกรายละเอียดเพิ่ม (กัน Enumerate ว่าใครเป็น Admin)
  NOT_AUTHORIZED: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  ALREADY_RESOLVED: 'รายการนี้ถูกดำเนินการไปแล้ว',
  // Payment User Postback (Premium Menu / request_payment / notify_payment)
  PAYMENT_NOT_FOUND: 'ไม่พบคำขอชำระเงินนี้ อาจหมดอายุหรือถูกดำเนินการไปแล้ว กรุณากดเมนู "Premium" เพื่อเริ่มใหม่',
  PAYMENT_NOT_PENDING: 'คำขอชำระเงินนี้ถูกดำเนินการไปแล้ว ไม่ต้องแจ้งซ้ำ หากยังไม่ได้รับสิทธิ์ Premium กรุณาติดต่อทีมงาน',
  PAYMENT_NOT_CONFIGURED: 'ระบบชำระเงินยังไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลังหรือติดต่อทีมงาน',
  SATANG_POOL_EXHAUSTED: 'ขณะนี้มีผู้ทำรายการพร้อมกันจำนวนมาก กรุณาลองกดอีกครั้งในอีกสักครู่',
  ALLOCATION_CONFLICT: 'ขณะนี้มีผู้ทำรายการพร้อมกันจำนวนมาก กรุณาลองกดอีกครั้งในอีกสักครู่',
  // Bulk Import (bulkImport.service / pendingTransaction.service — Phase 3 Round 6)
  BATCH_NOT_FOUND:
    'ไม่พบรายการนำเข้าพอร์ตนี้ อาจหมดอายุหรือถูกดำเนินการไปแล้ว กรุณาพิมพ์ "นำเข้าพอร์ต" เพื่อเริ่มใหม่',
  // Export รายงาน (Phase 3 Round 8 — reportExport.service)
  EXPORT_INVALID_RANGE:
    'ช่วงเวลาที่ระบุไม่ถูกต้อง กรุณาพิมพ์เช่น "ส่งออกรายงาน เดือนนี้", "ส่งออกรายงาน ปีนี้" หรือ "ส่งออกรายงาน 01/01/2569 - 30/06/2569"',
  EXPORT_INVALID_FORMAT: 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาเลือก PDF หรือ Excel จากปุ่มที่ระบบส่งให้',
  EXPORT_USER_NOT_FOUND: 'ไม่พบบัญชีผู้ใช้ของคุณ กรุณาลองใหม่อีกครั้งภายหลัง',
  EXPORT_GENERATION_FAILED:
    'สร้างรายงานไม่สำเร็จในขณะนี้ กรุณาลองใหม่อีกครั้งภายหลัง หากยังไม่ได้ให้ติดต่อทีมงาน',
};

// Postback data encoding สำหรับปุ่มในข้อความ Preview — Controller ถอดด้วย
// URLSearchParams รูปแบบ "action=<confirm|edit|cancel>&pendingId=<uuid>"
function postbackData(action, pendingId) {
  return `action=${action}&pendingId=${pendingId}`;
}

// Postback data สำหรับปุ่มยืนยัน/ยกเลิก Bulk Import Batch ทั้งก้อน (Phase 3 Round 6)
// พก batchId ตัวเดียวแทน pendingId หลายตัว (กันเกิน Limit ความยาว Postback data
// ของ LINE เมื่อ Batch มีหลายรายการ — ดู migration 008)
function postbackDataBatch(action, batchId) {
  return `action=${action}&batchId=${batchId}`;
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(num);
}

function textLine(text, options = {}) {
  return { type: 'text', text, wrap: true, ...options };
}

// เตือนที่มาของราคาเมื่อมาจาก Price Feed Service (CoinGecko) ไม่ใช่ราคาที่
// User ระบุเอง — CoinGecko เป็น Price Aggregator จึงต่างจาก Exchange ที่ User
// ใช้จริงได้เล็กน้อย (~0.1-0.3%) เป็นเรื่องปกติ แต่ต้องแจ้งไม่ให้เข้าใจผิดว่า
// ระบบมีปัญหา — priceSource === 'user' หรือไม่มี Field นี้ (Backward
// Compatible กับ Caller เดิม) ไม่ต้องแสดงข้อความนี้
function priceSourceNote(priceSource) {
  if (priceSource === 'coingecko') {
    return textLine('* ราคาอ้างอิงจาก CoinGecko อาจคลาดเคลื่อนจาก Exchange ที่คุณใช้เล็กน้อย', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  // Twelve Data (หุ้นสหรัฐ) — Pattern เดียวกับ CoinGecko ข้างต้น
  if (priceSource === 'twelvedata') {
    return textLine('* ราคาอ้างอิงจาก Twelve Data อาจคลาดเคลื่อนจาก Exchange ที่คุณใช้เล็กน้อย', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  // ทองคำ (Phase 3 Round 7) — ราคาอ้างอิงจากสมาคมค้าทองคำฯ ผ่าน API ชุมชน
  // (ไม่ใช่ API ทางการ) อาจล่าช้า/คลาดเคลื่อนจากหน้าร้านได้เล็กน้อย
  if (priceSource === 'thaigold') {
    return textLine('* ราคาอ้างอิงจากสมาคมค้าทองคำฯ (ผ่าน API ชุมชน) อาจคลาดเคลื่อน/ล่าช้าจากหน้าร้านเล็กน้อย', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  // กองทุนรวม (Round 7) — NAV จาก ก.ล.ต. (SEC) อัปเดตวันละครั้ง ราคาที่ใช้อาจเป็น
  // ของวันทำการก่อนหน้า (NAV วันนี้ประกาศตอนเย็น/วันถัดไป)
  if (priceSource === 'secnav') {
    return textLine('* ราคา NAV อ้างอิงจาก ก.ล.ต. (SEC) ล่าสุด อาจเป็นราคาของวันทำการก่อนหน้า', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  return null;
}

// บรรทัดแสดงราคาอ้างอิง USD ของทอง (Phase 3 Round 7) — ใช้ทั้งใน Preview (goldUsd จาก
// transaction.service) และหน้ากำไร (usd จาก profit.service) รูปแบบ Field ต่างกันเล็กน้อย
// จึงรับเป็น Argument ตรงๆ คืน [] ถ้าไม่มีข้อมูล (เพื่อ Spread เข้า body ได้เสมอ)
function goldUsdLines({ usdThbRate, pricePerUnitUsd, currentPriceUsd, currentValueUsd }) {
  const lines = [];
  const priceUsd = pricePerUnitUsd ?? currentPriceUsd;
  if (priceUsd !== undefined && priceUsd !== null) {
    lines.push(
      textLine(`≈ ${formatNumber(priceUsd)} USD/บาททองคำ (เรต 1 USD = ${formatNumber(usdThbRate)} บาท)`, {
        size: 'xs',
        color: COLOR.textSecondary,
      })
    );
  }
  if (currentValueUsd !== undefined && currentValueUsd !== null) {
    lines.push(
      textLine(`มูลค่าปัจจุบัน ≈ ${formatNumber(currentValueUsd)} USD`, {
        size: 'xs',
        color: COLOR.textSecondary,
      })
    );
  }
  return lines;
}

function bubble({ headerText, headerColor, headerBg, bodyContents }) {
  return {
    type: 'flex',
    altText: headerText,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBg,
        paddingAll: '12px',
        contents: [textLine(headerText, { weight: 'bold', color: headerColor })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: bodyContents,
      },
    },
  };
}

function buildBuyConfirmMessage(result) {
  const body = [
    textLine(result.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    textLine(`จำนวน: ${formatNumber(result.quantity)} ${result.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาต่อหน่วย: ${formatNumber(result.pricePerUnit)} บาท`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่ารวม: ${formatNumber(result.amountThb)} บาท`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
  ];

  if (result.newAssetCreated) {
    body.push(textLine('✨ เพิ่มสินทรัพย์ใหม่เข้าพอร์ตแล้ว', { size: 'xs', color: COLOR.info }));
  }

  const note = priceSourceNote(result.priceSource);
  if (note) body.push(note);

  return bubble({
    headerText: '🟢 ยืนยันรายการซื้อ',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: body,
  });
}

function buildSellConfirmMessage(result) {
  const body = [
    textLine(result.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    textLine(`จำนวน: ${formatNumber(result.quantity)} ${result.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาต่อหน่วย: ${formatNumber(result.pricePerUnit)} บาท`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่ารวม: ${formatNumber(result.amountThb)} บาท`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(`คงเหลือ: ${formatNumber(result.remainingQuantity)} ${result.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
  ];

  const note = priceSourceNote(result.priceSource);
  if (note) body.push(note);

  return bubble({
    headerText: '🔴 ยืนยันรายการขาย',
    headerColor: COLOR.loss,
    headerBg: COLOR.lossBg,
    bodyContents: body,
  });
}

// ข้อความผลกำไร/ขาดทุนของสินทรัพย์ 1 ตัว (คำสั่ง "กำไร") จาก profit.service
// สีเขียว/แดงตามผลกำไร-ขาดทุน (Pattern เดียวกับ Buy/Sell Confirm)
function buildProfitMessage(profit) {
  const isProfit = profit.profitLoss >= 0;
  const plColor = isProfit ? COLOR.profit : COLOR.loss;
  const sign = isProfit ? '+' : '-';
  const plAbs = Math.abs(profit.profitLoss);
  const percentAbs = Math.abs(profit.profitLossPercent);

  const body = [
    textLine(profit.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    // กองทุนรวม (Round 7) — ระบุ Class + วันที่ NAV ที่ใช้คำนวณ (null สำหรับสินทรัพย์อื่น)
    ...(profit.fundClassName
      ? [textLine(`ชนิดหน่วยลงทุน: ${profit.fundClassName}`, { size: 'sm', color: COLOR.info })]
      : []),
    textLine(`จำนวนที่ถือ: ${formatNumber(profit.heldQuantity)} ${profit.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ต้นทุนเฉลี่ย: ${formatNumber(profit.averageCost)} บาท/หน่วย`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`เงินลงทุน: ${formatNumber(profit.totalInvested)} บาท`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาปัจจุบัน: ${formatNumber(profit.currentPrice)} บาท/หน่วย`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่าปัจจุบัน: ${formatNumber(profit.currentValue)} บาท`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(
      `กำไร/ขาดทุน: ${sign}${formatNumber(plAbs)} บาท (${sign}${formatNumber(percentAbs)}%)`,
      { size: 'md', weight: 'bold', color: plColor }
    ),
  ];

  // ทอง (Phase 3 Round 7): แสดงราคา/มูลค่าปัจจุบันเป็น USD คู่กับ THB (profit.usd
  // จาก profit.service — null ถ้าไม่ใช่ทองหรือดึงเรต FX ไม่ได้ → ไม่แสดงบรรทัด USD)
  if (profit.usd) {
    body.push(...goldUsdLines(profit.usd));
  }

  const note = priceSourceNote(profit.priceSource);
  if (note) body.push(note);

  return bubble({
    headerText: isProfit ? '📈 กำไร' : '📉 ขาดทุน',
    headerColor: plColor,
    headerBg: isProfit ? COLOR.profitBg : COLOR.lossBg,
    bodyContents: body,
  });
}

function buildErrorMessage(code) {
  const message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;

  return bubble({
    headerText: '⚠️ ไม่สำเร็จ',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [textLine(message, { size: 'sm', color: COLOR.textPrimary })],
  });
}

// เส้นคั่นบางๆ ระหว่างรายการสินทรัพย์กับสรุปรวม
function separator() {
  return { type: 'separator', margin: 'md' };
}

function buildPortfolioMessage(summary) {
  // พอร์ตว่าง (ไม่มี Asset ที่ยังถืออยู่เลย) — แนะนำให้เริ่มบันทึกรายการแรก
  if (summary.isEmpty) {
    return bubble({
      headerText: '📊 พอร์ตของคุณ',
      headerColor: COLOR.info,
      headerBg: COLOR.profitBg,
      bodyContents: [
        textLine('พอร์ตของคุณยังว่างอยู่', {
          size: 'md',
          weight: 'bold',
          color: COLOR.textPrimary,
        }),
        textLine('เริ่มบันทึกรายการแรกได้เลย เช่น "ซื้อ PTT 50 หุ้น ราคา 34"', {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
      ],
    });
  }

  const body = [];

  summary.holdings.forEach((h) => {
    body.push(textLine(h.symbol, { size: 'md', weight: 'bold', color: COLOR.textPrimary }));
    body.push(
      textLine(`จำนวน: ${formatNumber(h.heldQuantity)} ${h.symbol}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(
      textLine(
        `ต้นทุนเฉลี่ย: ${h.averageCost === null ? '-' : formatNumber(h.averageCost)} บาท/หน่วย`,
        { size: 'sm', color: COLOR.textSecondary }
      )
    );
    body.push(
      textLine(`เงินลงทุน: ${formatNumber(h.totalInvested)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(separator());
  });

  body.push(
    textLine(`รวมเงินลงทุนทั้งพอร์ต: ${formatNumber(summary.totalInvested)} บาท`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    })
  );

  // ระบุชัดเจนว่ายังไม่มี Current Value / กำไร-ขาดทุน (ไม่มี Price Feed)
  body.push(
    textLine('* ยังไม่รองรับราคาตลาดปัจจุบัน (Current Value/กำไร-ขาดทุน จะเพิ่มเมื่อมี Price Feed)', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  return bubble({
    headerText: '📊 พอร์ตของคุณ',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: body,
  });
}

function buildHistoryMessage(transactions) {
  // ไม่มีประวัติเลย — แนะนำให้เริ่มบันทึกรายการแรก
  if (transactions.length === 0) {
    return bubble({
      headerText: '🕒 ประวัติล่าสุด',
      headerColor: COLOR.info,
      headerBg: COLOR.profitBg,
      bodyContents: [
        textLine('ยังไม่มีประวัติธุรกรรม', { size: 'md', weight: 'bold', color: COLOR.textPrimary }),
        textLine('เริ่มบันทึกรายการแรกได้เลย เช่น "ซื้อ PTT 50 หุ้น ราคา 34"', {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
      ],
    });
  }

  const body = [];

  transactions.forEach((tx) => {
    const isBuy = tx.type === 'buy';
    const label = isBuy ? '🟢 ซื้อ' : '🔴 ขาย';
    const color = isBuy ? COLOR.profit : COLOR.loss;

    body.push(
      textLine(`${label} ${tx.symbol}`, { size: 'md', weight: 'bold', color })
    );
    body.push(
      textLine(
        `จำนวน: ${formatNumber(tx.quantity)} ${tx.symbol} @ ${formatNumber(tx.pricePerUnit)} บาท`,
        { size: 'sm', color: COLOR.textSecondary }
      )
    );
    body.push(
      textLine(`มูลค่ารวม: ${formatNumber(tx.amountThb)} บาท • ${tx.date}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(separator());
  });

  return bubble({
    headerText: '🕒 ประวัติล่าสุด',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: body,
  });
}

// ข้อความ Preview พร้อมปุ่ม [ยืนยัน]/[แก้ไข]/[ยกเลิก] (SRS.md § 2.3 [4])
// รับ pending record จาก pendingTransaction.service.createPending
function buildPreviewMessage(pending) {
  const isBuy = pending.commandType === 'buy';
  const headerText = isBuy ? '🟢 ยืนยันการซื้อ' : '🔴 ยืนยันการขาย';
  const headerColor = isBuy ? COLOR.profit : COLOR.loss;
  const headerBg = isBuy ? COLOR.profitBg : COLOR.lossBg;

  // คำสั่งที่พิมพ์ราคาเป็น USD — โชว์ทั้งยอด USD ที่พิมพ์และเรตที่ใช้ เพื่อไม่ให้
  // ผู้ใช้งงว่าทำไมยอดในพอร์ต (บาท) ไม่ตรงกับตัวเลขที่พิมพ์ (pending.fx จาก
  // resolveQuantityAndPrice — ไม่ได้ Persist ใน DB)
  const isUsd = Boolean(pending.fx && pending.fx.currency === 'USD');

  const body = [
    textLine(pending.assetSymbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
  ];

  // กองทุนรวม (Round 7) — ระบุชนิดหน่วยลงทุน (Class) ให้ชัด ไม่ใช่แค่ชื่อย่อดิบ
  if (pending.fundClassName) {
    body.push(
      textLine(`ชนิดหน่วยลงทุน: ${pending.fundClassName}`, { size: 'sm', color: COLOR.info })
    );
  }

  body.push(
    textLine(`จำนวน: ${formatNumber(pending.quantity)} ${pending.assetSymbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    })
  );

  if (isUsd) {
    body.push(
      textLine(`ราคาที่พิมพ์: ${formatNumber(pending.fx.pricePerUnitOriginal)} USD/หน่วย`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine(`ยอดรวมที่พิมพ์: ${formatNumber(pending.fx.amountOriginal)} USD`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine(`อัตราแลกเปลี่ยน: 1 USD = ${formatNumber(pending.fx.rate)} บาท`, {
        size: 'xs',
        color: COLOR.textSecondary,
      })
    );
  }

  body.push(
    textLine(`ราคาต่อหน่วย: ${formatNumber(pending.pricePerUnit)} บาท${isUsd ? ' (แปลงแล้ว)' : ''}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    })
  );

  // ทอง (Phase 3 Round 7): แสดงราคาต้นทุนอ้างอิงเป็น USD คู่กับ THB (pending.goldUsd
  // จาก transaction.service — null ถ้าไม่ใช่ทองหรือดึงเรต FX ไม่ได้ → ไม่แสดง)
  if (pending.goldUsd) {
    body.push(...goldUsdLines(pending.goldUsd));
  }

  body.push(
    textLine(`มูลค่ารวม: ${formatNumber(pending.amountThb)} บาท${isUsd ? ' (แปลงแล้ว)' : ''}`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine('ตรวจสอบแล้วกด "ยืนยัน" เพื่อบันทึก (รายการหมดอายุใน 5 นาที)', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  const note = priceSourceNote(pending.priceSource);
  if (note) body.push(note);

  // ปุ่ม action:postback — data ถูกถอดที่ Controller (routePostback)
  // displayText = ข้อความที่แสดงในแชทเสมือนผู้ใช้พิมพ์เอง เมื่อกดปุ่ม
  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: headerColor,
      action: {
        type: 'postback',
        label: '✅ ยืนยัน',
        data: postbackData('confirm', pending.id),
        displayText: 'ยืนยันรายการ',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '✏️ แก้ไข',
        data: postbackData('edit', pending.id),
        displayText: 'แก้ไขรายการ',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ยกเลิก',
        data: postbackData('cancel', pending.id),
        displayText: 'ยกเลิกรายการ',
      },
    },
  ];

  return {
    type: 'flex',
    altText: headerText,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBg,
        paddingAll: '12px',
        contents: [textLine(headerText, { weight: 'bold', color: headerColor })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: body,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerButtons,
      },
    },
  };
}

// ตอบกลับเมื่อผู้ใช้กด "ยกเลิก"
function buildCancelledMessage() {
  return bubble({
    headerText: '❌ ยกเลิกรายการแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('รายการนี้ถูกยกเลิก ไม่มีการบันทึกลงพอร์ตของคุณ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
    ],
  });
}

// ตอบกลับเมื่อผู้ใช้กด "แก้ไข" — Phase นี้ยังไม่มี Stateful Edit Flow จึงให้
// ยกเลิกรายการเดิมแล้วแนะนำให้พิมพ์คำสั่งใหม่พร้อมข้อมูลที่ถูกต้อง
function buildEditHintMessage() {
  return bubble({
    headerText: '✏️ แก้ไขรายการ',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ยกเลิกรายการเดิมแล้ว กรุณาพิมพ์คำสั่งใหม่พร้อมข้อมูลที่ถูกต้อง', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('เช่น "ซื้อ PTT 50 หุ้น ราคา 34"', { size: 'sm', color: COLOR.textSecondary }),
    ],
  });
}

// ตอบกลับคำสั่ง "ยกเลิกล่าสุด" (Command History) — แจ้งว่าย้อนรายการเดิมแล้ว
// โดยระบุว่าเป็นการสร้างรายการตรงข้ามชดเชย (ไม่ได้ลบของเดิม) ตาม DATABASE.md § 8
function buildUndoMessage(result) {
  const wasBuy = result.originalType === 'buy';
  const originalLabel = wasBuy ? 'ซื้อ' : 'ขาย';
  const symbol = result.symbol ?? '';

  return bubble({
    headerText: '↩️ ยกเลิกรายการล่าสุดแล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`ย้อนรายการ${originalLabel} ${symbol}`.trim(), {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine(`จำนวน: ${formatNumber(result.quantity)} ${symbol}`.trimEnd(), {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine(`มูลค่ารวม: ${formatNumber(result.amountThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine('* สร้างรายการตรงข้ามเพื่อชดเชย ประวัติเดิมยังถูกเก็บไว้ครบถ้วน', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// อธิบายรอบเตือนเป็นข้อความไทย: weekly → "ทุกวันจันทร์", monthly → "ทุกวันที่ 5"
function describeSchedule(reminder) {
  if (reminder.frequency === 'weekly') {
    const dayName = dowToDayName(Number(reminder.dayOfWeek));
    return `ทุกวัน${dayName ?? ''}`.trim();
  }
  return `ทุกวันที่ ${reminder.dayOfMonth}`;
}

// ยืนยันว่าตั้งเตือนสำเร็จ — ย้ำว่าเป็นการเตือนให้มาซื้อเอง ไม่ซื้อให้อัตโนมัติ
// (PROJECT_BRIEF § 17 — ระบบไม่ตัดสินใจ/ทำธุรกรรมลงทุนแทนผู้ใช้)
function buildReminderSetMessage(reminder) {
  return bubble({
    headerText: '⏰ ตั้งเตือน DCA แล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine(reminder.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
      textLine(`รอบเตือน: ${describeSchedule(reminder)}`, { size: 'sm', color: COLOR.textSecondary }),
      textLine(`จำนวนที่ตั้งใจ: ${formatNumber(reminder.amountThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine('* ระบบจะเตือนให้คุณมาพิมพ์คำสั่งซื้อเอง ไม่ได้ซื้อหรือบันทึกให้อัตโนมัติ', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// แสดงรายการเตือนที่ Active — ถ้าไม่มีเลยแนะนำให้เริ่มตั้ง
function buildReminderListMessage(reminders) {
  if (!reminders || reminders.length === 0) {
    return bubble({
      headerText: '⏰ การเตือน DCA',
      headerColor: COLOR.info,
      headerBg: COLOR.profitBg,
      bodyContents: [
        textLine('ยังไม่มีการตั้งเตือน', { size: 'md', weight: 'bold', color: COLOR.textPrimary }),
        textLine('เริ่มตั้งได้เลย เช่น "ตั้งเตือน BTC ทุกวันจันทร์ 1000"', {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
      ],
    });
  }

  const body = [];
  reminders.forEach((reminder) => {
    body.push(textLine(reminder.symbol, { size: 'md', weight: 'bold', color: COLOR.textPrimary }));
    body.push(
      textLine(`${describeSchedule(reminder)} • ${formatNumber(reminder.amountThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(separator());
  });
  body.push(
    textLine('พิมพ์ "ลบเตือน <ชื่อย่อ>" เพื่อปิดการเตือน', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  return bubble({
    headerText: '⏰ การเตือน DCA',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: body,
  });
}

// ยืนยันว่าปิด/ลบเตือนสำเร็จ (Soft-delete — ประวัติเดิมยังอยู่)
function buildReminderDeletedMessage(symbol) {
  return bubble({
    headerText: '🔕 ปิดการเตือนแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`ปิดการเตือน DCA ของ ${symbol} เรียบร้อยแล้ว`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('* ประวัติการตั้งเตือนเดิมยังถูกเก็บไว้ (ปิดการใช้งานเท่านั้น)', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ข้อความที่ Push จริงตอน Cron ครบกำหนด — bubble() คืน Flex Message Object แบบ
// เดียวกับที่ LINE Push API รับได้ (โครงเดียวกับ Reply) เชิญชวนให้พิมพ์คำสั่งซื้อ
// เอง ไม่มีการซื้ออัตโนมัติ
function buildReminderPushMessage(reminder) {
  return bubble({
    headerText: '⏰ ถึงรอบ DCA แล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine(reminder.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
      textLine(`วันนี้ถึงรอบที่คุณตั้งใจ DCA ${reminder.symbol}`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(`จำนวนที่ตั้งใจ: ${formatNumber(reminder.amountThb)} บาท`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine(
        `ถ้าซื้อแล้วพิมพ์บันทึกเองได้เลย เช่น "ซื้อ ${reminder.symbol} ${formatNumber(reminder.amountThb)}"`,
        { size: 'sm', color: COLOR.textSecondary }
      ),
      textLine('* นี่เป็นเพียงการแจ้งเตือน ระบบไม่ได้ซื้อหรือบันทึกรายการให้อัตโนมัติ', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════
// DCA Reminder Setup Flow — Quick Reply (แถบปุ่มด้านล่างจอ) หลายขั้นตอน
// ทุกข้อความแนบปุ่ม "❌ ยกเลิก" (Postback action=cancel_reminder_setup) เสมอ
// ให้ผู้ใช้เลิก Flow กลางทางได้ (Requirement ข้อ 5-6)
// ═══════════════════════════════════════════════════════════════════════

// 1 Quick Reply Item แบบ Postback — data ถอดที่ Controller ด้วย URLSearchParams
function quickReplyPostback(label, data, displayText) {
  return {
    type: 'action',
    action: { type: 'postback', label, data, displayText },
  };
}

// ปุ่มยกเลิกที่แนบไปทุกขั้นตอน
function cancelSetupItem() {
  return quickReplyPostback('❌ ยกเลิก', 'action=cancel_reminder_setup', 'ยกเลิกการตั้งเตือน');
}

// ข้อความ Text + Quick Reply — ผนวกปุ่มยกเลิกต่อท้ายเสมอ (LINE จำกัด 13 items/ข้อความ)
function textWithQuickReply(text, items = []) {
  return {
    type: 'text',
    text,
    quickReply: { items: [...items, cancelSetupItem()] },
  };
}

// ── กองทุนรวม (Round 7): เลือกชนิดหน่วยลงทุน (Fund Class) ──────────────────
// Postback พก projId + class + พารามิเตอร์ซื้อเดิม (amt หรือ qty+price) เพื่อให้
// Handler สร้าง Pending ได้โดยไม่ต้องเก็บ Session (LINE Postback ≤ 300 ตัวอักษร
// พอสำหรับ projId + class + ยอด) — Encode ด้วย URLSearchParams (Controller ถอด
// ด้วย URLSearchParams เดียวกัน) รองรับ Class ที่มี "(", ")" ในชื่อ
function fundBuyPostback(action, projId, fundClassName, buy = {}) {
  const p = new URLSearchParams();
  p.set('action', action);
  p.set('projId', projId);
  if (fundClassName) p.set('class', fundClassName);
  if (buy.amountThb !== undefined && buy.amountThb !== null) p.set('amt', String(buy.amountThb));
  if (buy.quantity !== undefined && buy.quantity !== null) p.set('qty', String(buy.quantity));
  if (buy.pricePerUnit !== undefined && buy.pricePerUnit !== null) p.set('price', String(buy.pricePerUnit));
  return p.toString();
}

// project = { projId, projAbbrName, classes: [{ fundClassName, fundClassDetail }] }
// buy = { amountThb } หรือ { quantity, pricePerUnit } (พารามิเตอร์ซื้อจากคำสั่งเดิม)
// แสดงทุก Class + fund_class_detail ประกอบ และปุ่ม "ไม่แน่ใจ / เลือกให้อัตโนมัติ"
// เป็นตัวเลือกสุดท้ายเสมอ (Scope ข้อ 3)
function buildFundClassPickerMessage(project, buy = {}) {
  const classes = (project.classes ?? []).slice(0, 12);

  const items = classes.map((c) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: String(c.fundClassName).slice(0, 20), // LINE label ≤ 20 ตัวอักษร
      data: fundBuyPostback('fund_buy', project.projId, c.fundClassName, buy),
      displayText: `เลือก ${c.fundClassName}`,
    },
  }));

  // ปุ่ม "ไม่แน่ใจ" ท้ายสุด — Handler Auto-select ตาม Priority (ดู mutualFund.service)
  items.push({
    type: 'action',
    action: {
      type: 'postback',
      label: '🤖 ไม่แน่ใจ เลือกให้',
      data: fundBuyPostback('fund_buy_auto', project.projId, null, buy),
      displayText: 'เลือกชนิดหน่วยลงทุนให้อัตโนมัติ',
    },
  });

  const lines = classes
    .map((c) => `• ${c.fundClassName}${c.fundClassDetail ? ` — ${c.fundClassDetail}` : ''}`)
    .join('\n');
  const text =
    `กองทุน ${project.projAbbrName} มีหลายชนิดหน่วยลงทุน กรุณาเลือกชนิดที่ต้องการบันทึกครับ:\n${lines}`;

  return { type: 'text', text, quickReply: { items } };
}

// ไม่พบกองทุนที่ค้นหา (Scope ข้อ 4) — ไม่ทำ Did-you-mean
function buildFundNotFoundMessage(query) {
  return bubble({
    headerText: '🔍 ไม่พบกองทุน',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`ไม่พบกองทุนชื่อย่อ "${query}" ในระบบ`, { size: 'sm', color: COLOR.textPrimary }),
      textLine('กรุณาตรวจสอบชื่อย่อกองทุนให้ถูกต้องอีกครั้ง (เช่น K-SELECT, SCBRM)', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── ขั้น 1: เลือก Symbol ที่ถืออยู่ในพอร์ต ────────────────────────────────
// LINE จำกัด 13 items/ข้อความ (รวมปุ่มยกเลิก) — จำกัด Symbol ไว้ 12 ตัว
function buildSymbolQuickReply(symbols) {
  const items = (symbols ?? [])
    .slice(0, 12)
    .map((symbol) =>
      quickReplyPostback(symbol, `action=reminder_symbol&symbol=${symbol}`, symbol)
    );

  return textWithQuickReply('จะตั้งเตือน DCA ให้สินทรัพย์ไหนดีครับ? เลือกจากพอร์ตของคุณได้เลย', items);
}

// ── ขั้น 2: เลือกความถี่ ──────────────────────────────────────────────────
function buildFrequencyQuickReply() {
  const items = [
    quickReplyPostback('รายสัปดาห์', 'action=reminder_freq&frequency=weekly', 'รายสัปดาห์'),
    quickReplyPostback('รายเดือน', 'action=reminder_freq&frequency=monthly', 'รายเดือน'),
  ];

  return textWithQuickReply('ต้องการให้เตือนบ่อยแค่ไหนครับ?', items);
}

// ── ขั้น 3a: เลือกวันในสัปดาห์ (รายสัปดาห์) — 7 วัน ────────────────────────
function buildDayOfWeekQuickReply() {
  const items = THAI_DAY_NAMES.map((dayName, dow) =>
    quickReplyPostback(dayName, `action=reminder_day&dayOfWeek=${dow}`, `วัน${dayName}`)
  );

  return textWithQuickReply('เตือนทุกวันอะไรของสัปดาห์ดีครับ?', items);
}

// ── ขั้น 3b: เลือกวันของเดือน (รายเดือน) — ปุ่มวันยอดนิยม + พิมพ์เองได้ ──────
function buildDayOfMonthQuickReply() {
  const items = [1, 5, 10, 15, 20, 25].map((day) =>
    quickReplyPostback(`วันที่ ${day}`, `action=reminder_day&dayOfMonth=${day}`, `วันที่ ${day}`)
  );

  return textWithQuickReply(
    'เตือนทุกวันที่เท่าไรของเดือนดีครับ? เลือกจากปุ่ม หรือพิมพ์ตัวเลข 1-31 เองก็ได้',
    items
  );
}

// ── ขั้น 4: ขอจำนวนเงิน (พิมพ์เอง — เดาไม่ได้ จึงไม่มีปุ่มตัวเลือก มีแต่ยกเลิก) ─
function buildAskAmountMessage(symbol) {
  return textWithQuickReply(
    `ตั้งใจ DCA ${symbol} ครั้งละกี่บาทครับ? พิมพ์จำนวนเงินมาได้เลย (เช่น 1000)`
  );
}

// ยืนยันว่ายกเลิก Flow ตั้งเตือนแล้ว (กดปุ่มยกเลิกกลางทาง)
function buildReminderSetupCancelledMessage() {
  return bubble({
    headerText: '❌ ยกเลิกการตั้งเตือนแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ยกเลิกขั้นตอนการตั้งเตือน DCA แล้ว ยังไม่มีการบันทึกการเตือนใดๆ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('อยากเริ่มใหม่กดปุ่ม "⏰ ตั้งเตือน DCA" ที่เมนูได้เลย', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ข้อความ Push สรุปพอร์ตรายสัปดาห์/รายเดือน (portfolioSummary.job) — bubble()
// คืน Flex Message Object แบบเดียวกับที่ LINE Push API รับได้ ใช้ Pattern สี
// เขียว/แดงตามกำไร-ขาดทุนเหมือน buildProfitMessage
function buildPortfolioSummaryPushMessage(summary) {
  const isMonthly = summary.periodLabel === 'monthly';
  const headerText = isMonthly ? '📊 สรุปพอร์ตประจำเดือน' : '📊 สรุปพอร์ตประจำสัปดาห์';

  const isProfit = summary.totalProfitLoss >= 0;
  const plColor = isProfit ? COLOR.profit : COLOR.loss;
  const sign = isProfit ? '+' : '-';
  const plAbs = Math.abs(summary.totalProfitLoss);

  // percent เป็น null เมื่อไม่มี Asset ที่มีราคาเลย (หารด้วยศูนย์) → แสดงเฉพาะจำนวนเงิน
  const plText =
    summary.totalProfitLossPercent === null
      ? `กำไร/ขาดทุนรวม: ${sign}${formatNumber(plAbs)} บาท`
      : `กำไร/ขาดทุนรวม: ${sign}${formatNumber(plAbs)} บาท (${sign}${formatNumber(
          Math.abs(summary.totalProfitLossPercent)
        )}%)`;

  const body = [
    textLine(`เงินลงทุนรวมทั้งพอร์ต: ${formatNumber(summary.totalInvestedAllAssets)} บาท`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่าปัจจุบันรวม: ${formatNumber(summary.totalCurrentValue)} บาท`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(plText, { size: 'md', weight: 'bold', color: plColor }),
  ];

  // มี Asset ที่ยังไม่มีราคาตลาด (เช่นหุ้นไทย) — บอกชัดว่าตัวเลขกำไร/ขาดทุน
  // ไม่ได้รวมทั้งพอร์ต เพื่อไม่ให้ User เข้าใจผิด
  if (summary.excludedCount > 0) {
    body.push(
      textLine(
        `* ไม่รวม ${summary.excludedCount} สินทรัพย์ที่ยังไม่มีราคาตลาด (เช่น หุ้นไทย) ตัวเลขนี้จึงไม่ใช่ทั้งพอร์ต`,
        { size: 'xs', color: COLOR.textSecondary }
      )
    );
  }

  return bubble({
    headerText,
    headerColor: plColor,
    headerBg: isProfit ? COLOR.profitBg : COLOR.lossBg,
    bodyContents: body,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Payment (Phase 2 Step 3 — Premium ผ่าน PromptPay QR + Admin Approval)
// ═══════════════════════════════════════════════════════════════════════

// รอบบิลเป็นข้อความไทย
function billingLabel(billingPeriod) {
  return billingPeriod === 'yearly' ? 'รายปี' : 'รายเดือน';
}

// จัดรูปวันหมดอายุเป็น YYYY-MM-DD ตามเขตเวลา Asia/Bangkok (Pattern เดียวกับ
// todayInBangkok ใน transaction.service) — รับได้ทั้ง Date และ ISO string
function formatDateBangkok(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(value));
}

// ── Push หา Admin: มีคำขอชำระเงินใหม่ พร้อมปุ่มอนุมัติ/ปฏิเสธ ────────────────
// ปุ่ม Postback encode paymentId (คนละ Key กับ pendingId ของ Flow ซื้อ/ขาย)
// Controller (routePostback) ถอดด้วย URLSearchParams action=approve_payment/reject_payment
function buildAdminPaymentRequestMessage(payment, userDisplayName) {
  const body = [
    textLine(`ผู้ใช้: ${userDisplayName ?? '-'}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`แพ็กเกจ: Premium (${billingLabel(payment.billingPeriod)})`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ยอดที่ต้องได้รับ: ${formatNumber(payment.amountThb)} บาท`, {
      size: 'lg',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine('* ตรวจยอดในบัญชีให้ตรงเป๊ะ (รวมเศษสตางค์) ก่อนกดอนุมัติ', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
  ];

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: '✅ อนุมัติ',
        data: `action=approve_payment&paymentId=${payment.id}`,
        displayText: 'อนุมัติการชำระเงิน',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ปฏิเสธ',
        data: `action=reject_payment&paymentId=${payment.id}`,
        displayText: 'ปฏิเสธการชำระเงิน',
      },
    },
  ];

  const contents = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: COLOR.warningBg,
      paddingAll: '12px',
      contents: [textLine('💰 คำขอชำระเงินใหม่', { weight: 'bold', color: COLOR.warning })],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
  };

  // แนบรูปสลิปเป็น Hero ถ้าผู้ใช้ส่งมาแล้ว (slip_image_url ถูกเซฟจาก Image Handler) —
  // แตะรูปเพื่อเปิดเต็มใน Browser ได้ (uri action) ช่วย Admin ตรวจยอดก่อนกดอนุมัติ
  // ถ้ายังไม่มีสลิป (ผู้ใช้กดแจ้งชำระก่อนส่งรูป) ก็ไม่แนบ Hero — Flow เดิมทำงานปกติ
  if (payment.slipImageUrl) {
    contents.hero = {
      type: 'image',
      url: payment.slipImageUrl,
      size: 'full',
      aspectMode: 'fit',
      aspectRatio: '3:4',
      action: { type: 'uri', label: 'ดูสลิป', uri: payment.slipImageUrl },
    };
  }

  return {
    type: 'flex',
    altText: `คำขอชำระเงินใหม่ ${formatNumber(payment.amountThb)} บาท`,
    contents,
  };
}

// ── Reply ยืนยันกับ Admin หลังอนุมัติสำเร็จ ───────────────────────────────
function buildAdminApproveAckMessage(payment, newExpiry) {
  return bubble({
    headerText: '✅ อนุมัติแล้ว',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine(`ยอด ${formatNumber(payment.amountThb)} บาท (${billingLabel(payment.billingPeriod)})`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(`ต่ออายุ Premium ให้ผู้ใช้ถึง ${formatDateBangkok(newExpiry)} แล้ว`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── Reply ยืนยันกับ Admin หลังปฏิเสธสำเร็จ ─────────────────────────────────
function buildAdminRejectAckMessage(payment) {
  return bubble({
    headerText: '❌ ปฏิเสธแล้ว',
    headerColor: COLOR.loss,
    headerBg: COLOR.lossBg,
    bodyContents: [
      textLine(`ปฏิเสธคำขอยอด ${formatNumber(payment.amountThb)} บาทแล้ว`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('ไม่มีการเปลี่ยนแปลงสิทธิ์ของผู้ใช้', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── Push หาผู้ใช้: อนุมัติสำเร็จ Premium ใช้งานได้ ─────────────────────────
function buildPaymentApprovedMessage(payment, newExpiry) {
  return bubble({
    headerText: '🎉 อัพเกรด Premium สำเร็จ',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ขอบคุณที่สนับสนุน EasyDCA! บัญชีของคุณเป็น Premium แล้ว', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(`ใช้งาน Premium ได้ถึง: ${formatDateBangkok(newExpiry)}`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine('* บันทึกสินทรัพย์ได้ไม่จำกัดแล้ว', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── Push หาผู้ใช้: คำขอถูกปฏิเสธ ───────────────────────────────────────────
function buildPaymentRejectedMessage(payment) {
  return bubble({
    headerText: '⚠️ คำขอชำระเงินไม่ผ่าน',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`คำขอ Premium (${billingLabel(payment.billingPeriod)}) ยอด ${formatNumber(payment.amountThb)} บาท ไม่ผ่านการตรวจสอบ`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('อาจเกิดจากยอดโอนไม่ตรงหรือสลิปไม่ชัด กรุณาลองทำรายการใหม่อีกครั้ง หากคิดว่าผิดพลาดติดต่อทีมงานได้เลย', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ยอดเงินบาททศนิยม 2 ตำแหน่งเป๊ะเสมอ (เช่น 59.17 / 590.05) — ยอดชำระมีเศษ
// สตางค์เฉพาะ (satang tag) ที่ต้องโอนให้ตรงทุกหลัก ต่างจาก formatNumber ที่ตัด
// ศูนย์ท้าย (59.10 → "59.1") ซึ่งอาจทำให้ผู้ใช้โอนยอดผิด
function formatThb2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// ── ปุ่มเสนอแพ็กเกจ Premium (รายเดือน/รายปี) — ใช้ร่วมทั้งเคสยังไม่ Premium และ
// เคสต่ออายุ (Postback request_payment เดียวกัน paymentService.requestPayment
// ใช้ Stacking Logic ต่อจากวันหมดอายุเดิมให้เองอยู่แล้ว) ────────────────────
function premiumPeriodButtons(monthlyLabel, yearlyLabel) {
  return [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.info,
      action: {
        type: 'postback',
        label: monthlyLabel,
        data: 'action=request_payment&period=monthly',
        displayText: monthlyLabel,
      },
    },
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: yearlyLabel,
        data: 'action=request_payment&period=yearly',
        displayText: yearlyLabel,
      },
    },
  ];
}

// เคส 1: ยังไม่ใช่ Premium และไม่มีคำขอค้าง — เสนอ 2 แพ็กเกจให้เลือก
function buildPremiumOfferMessage() {
  const body = [
    textLine('อัพเกรดเป็น Premium 👑', { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    textLine('บันทึกสินทรัพย์ได้ไม่จำกัด + ดู Dashboard เต็มรูปแบบ', {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    separator(),
    textLine('เลือกแพ็กเกจที่ต้องการ แล้วระบบจะสร้าง QR PromptPay ให้โอน', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
  ];

  return {
    type: 'flex',
    altText: 'อัพเกรดเป็น Premium',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('👑 Premium', { weight: 'bold', color: COLOR.profit })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: premiumPeriodButtons('รายเดือน 59 บาท', 'รายปี 590 บาท'),
      },
    },
  };
}

// เคส 2: เป็น Premium Active อยู่แล้ว — แสดงวันหมดอายุ (ไทย/พ.ศ.) + ปุ่มต่ออายุ
function buildPremiumStatusMessage(expiresAt) {
  const body = [
    textLine('คุณเป็นสมาชิก Premium อยู่แล้ว ✅', {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(`หมดอายุวันที่ ${formatThaiDate(expiresAt)}`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.info,
    }),
    textLine('* ต่ออายุล่วงหน้าได้ ระบบจะบวกเวลาต่อจากวันหมดอายุเดิมให้ ไม่เสียวันที่เหลือ', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
  ];

  return {
    type: 'flex',
    altText: 'สถานะ Premium',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('👑 Premium ของคุณ', { weight: 'bold', color: COLOR.profit })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: premiumPeriodButtons('ต่ออายุรายเดือน 59 บาท', 'ต่ออายุรายปี 590 บาท'),
      },
    },
  };
}

// เคส 3 + หลังกด request_payment: แสดงรูป QR PromptPay ให้สแกนโอน พร้อมยอดเป๊ะ
// (2 ตำแหน่งทศนิยม) เวลาหมดอายุ และปุ่ม "แจ้งชำระแล้ว"
// payment ต้องมี { id, amountThb, billingPeriod, expiresAt } | qrImageUrl = URL
// รูป PNG ที่ LINE Fetch ได้ (Endpoint GET /api/v1/payment/:id/qr.png)
function buildPaymentQrMessage(payment, qrImageUrl) {
  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: '📤 แจ้งชำระแล้ว',
        data: `action=notify_payment&paymentId=${payment.id}`,
        displayText: 'แจ้งชำระเงินแล้ว',
      },
    },
  ];

  return {
    type: 'flex',
    altText: `สแกนจ่าย Premium ${formatThb2(payment.amountThb)} บาท`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('💳 สแกนจ่ายผ่าน PromptPay', { weight: 'bold', color: COLOR.profit })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'image',
            url: qrImageUrl,
            size: 'full',
            aspectMode: 'fit',
            aspectRatio: '1:1',
          },
          textLine(`ยอดที่ต้องโอน: ${formatThb2(payment.amountThb)} บาท`, {
            size: 'lg',
            weight: 'bold',
            color: COLOR.textPrimary,
          }),
          textLine(`แพ็กเกจ: Premium (${billingLabel(payment.billingPeriod)})`, {
            size: 'sm',
            color: COLOR.textSecondary,
          }),
          textLine(`กรุณาโอนภายใน: ${formatDateBangkok(payment.expiresAt)} (คำขอมีอายุ 24 ชม.)`, {
            size: 'sm',
            color: COLOR.textSecondary,
          }),
          textLine('⚠️ โอนยอดให้ตรงทุกหลักรวมเศษสตางค์ เพื่อให้ระบบจับคู่รายการได้', {
            size: 'xs',
            color: COLOR.warning,
          }),
          textLine('โอนแล้วกด "แจ้งชำระแล้ว" เพื่อให้ทีมงานตรวจสอบ', {
            size: 'xs',
            color: COLOR.textSecondary,
          }),
        ],
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
    },
  };
}

// ตอบผู้ใช้หลังกด "แจ้งชำระแล้ว" — คำขอถูกส่งให้ Admin ตรวจสอบแล้ว
function buildPaymentNotifySubmittedMessage() {
  return bubble({
    headerText: '📤 แจ้งชำระเงินแล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ได้รับแจ้งการชำระเงินแล้ว กำลังรอ Admin ตรวจสอบ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('เมื่ออนุมัติแล้วระบบจะแจ้งเตือนและเปิดสิทธิ์ Premium ให้ทันที', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ตอบผู้ใช้เมื่อได้รับรูปสลิปและผูกเข้ากับคำขอ pending สำเร็จ (Image Handler ใน Webhook)
function buildSlipReceivedMessage() {
  return bubble({
    headerText: '🧾 ได้รับสลิปแล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ได้รับรูปสลิปการโอนเงินแล้ว กำลังรอ Admin ตรวจสอบ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('เมื่ออนุมัติแล้วระบบจะแจ้งเตือนและเปิดสิทธิ์ Premium ให้ทันที', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── ปุ่มเปิด Web Dashboard (LIFF) — action type uri (เปิดใน LINE In-App Browser)
function buildDashboardLinkMessage(dashboardUrl) {
  return {
    type: 'flex',
    altText: 'เปิด Dashboard',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('📊 Web Dashboard', { weight: 'bold', color: COLOR.info })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          textLine('ดูพอร์ต กราฟ และประวัติแบบเต็มรูปแบบบนหน้าเว็บ', {
            size: 'sm',
            color: COLOR.textPrimary,
          }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLOR.info,
            action: { type: 'uri', label: '📊 เปิด Dashboard', uri: dashboardUrl },
          },
        ],
      },
    },
  };
}

// ── Push หาผู้ใช้เมื่อ Premium หมดอายุ (planDowngrade.job) — กลับเป็น Free ────
function buildPlanDowngradedMessage() {
  return bubble({
    headerText: '⚠️ Premium หมดอายุแล้ว',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('แพ็กเกจ Premium ของคุณหมดอายุแล้ว บัญชีกลับเป็น Free (จำกัด 2 สินทรัพย์)', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('ข้อมูลเดิมทั้งหมดยังอยู่ครบ ต่ออายุได้ทุกเมื่อผ่านเมนู "Premium"', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ตอบกลับปุ่ม Rich Menu "เพิ่มรายการ" (Postback action=add_guide) — สอนวิธีพิมพ์
// คำสั่งซื้อ/ขายตรงๆ ทันที ไม่มีปุ่มกด (แค่ข้อความสอน) Pattern Header/สีเดียวกับ
// buildUnknownCommandMessage ด้านล่าง | Syntax ตัวอย่างตรงกับ commandParser.service.js
// (DETAILED_BUY/DETAILED_SELL) เป๊ะ ห้ามเดาเอง
function buildAddGuideMessage() {
  return bubble({
    headerText: '📝 วิธีเพิ่มรายการซื้อ/ขาย',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('พิมพ์ข้อความตามรูปแบบด้านล่างได้เลย', { size: 'sm', color: COLOR.textPrimary }),
      textLine('• ซื้อ BTC 0.01 หุ้น ราคา 3400000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ขาย PTT 50 หุ้น ราคา 34', { size: 'sm', color: COLOR.textSecondary }),
    ],
  });
}

function buildUnknownCommandMessage() {
  return bubble({
    headerText: '🤔 ไม่เข้าใจคำสั่งนี้',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ลองพิมพ์คำสั่งเหล่านี้ดูนะครับ', { size: 'sm', color: COLOR.textPrimary }),
      textLine('• ซื้อ BTC 0.01 หุ้น ราคา 3400000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ขาย PTT 50 หุ้น ราคา 34', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• พอต', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• กำไร BTC', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ประวัติ', { size: 'sm', color: COLOR.textSecondary }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Bulk Import (Phase 3 Round 6 — นำเข้าพอร์ตแบบ Multi-line)
// ═══════════════════════════════════════════════════════════════════════

// ข้อความที่ 1 ของ Flow — ตอบทันทีที่พิมพ์ "นำเข้าพอร์ต" อธิบาย Format + ตัวอย่าง
// (bulkImportSession Service เป็นผู้เริ่ม Session รอรับ Batch คู่กับข้อความนี้)
function buildBulkImportInstructionsMessage() {
  return bubble({
    headerText: '📥 นำเข้าพอร์ต',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('พิมพ์รายการที่ต้องการนำเข้า บรรทัดละ 1 รายการ ส่งเป็นข้อความเดียว', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('รูปแบบ: SYMBOL จำนวน ต้นทุน ราคาต่อหน่วย [วันที่ DD/MM/YYYY]', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
      separator(),
      textLine('BTC 0.5 ต้นทุน 1500000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('ETH 2 ต้นทุน 80000 วันที่ 01/03/2569', { size: 'sm', color: COLOR.textSecondary }),
      textLine('MSFT 3 ต้นทุน 300 USD', { size: 'sm', color: COLOR.textSecondary }),
      separator(),
      textLine('ไม่ระบุวันที่ = ใช้วันนี้ • ระบุ USD ท้ายราคาได้ถ้าซื้อเป็นดอลลาร์', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
      textLine('ส่งภายใน 5 นาทีหลังพิมพ์คำสั่งนี้ มิฉะนั้นต้องเริ่มใหม่', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// Batch ว่างเปล่า (ผู้ใช้ส่งข้อความว่าง/มีแต่ Whitespace หลังพิมพ์ "นำเข้าพอร์ต")
function buildBulkImportEmptyMessage() {
  return bubble({
    headerText: '⚠️ ไม่พบรายการ',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ไม่พบรายการในข้อความนี้เลย กรุณาพิมพ์อย่างน้อย 1 บรรทัด', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('เช่น: BTC 0.5 ต้นทุน 1500000', { size: 'xs', color: COLOR.textSecondary }),
    ],
  });
}

// แปล Error 1 รายการของ Batch เป็นข้อความไทย — รองรับ 2 รูปแบบปนกันได้:
//  - Parse-level (commandParser.parseBulkImportLines): { line, reason } (reason
//    เป็นข้อความไทยสำเร็จรูปแล้ว)
//  - Business-level (bulkImport.service.validateItems): { line, symbol, code }
//    (code ต้องแปลผ่าน ERROR_MESSAGES ที่นี่ — Service Layer ไม่รู้จัก Map นี้)
//  - Aggregate Asset Limit ทั้ง Batch: { line: null, code } (ไม่ผูกกับบรรทัดใด)
function describeBulkImportError(error) {
  const message = error.reason ?? ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
  const prefix = error.symbol ? `${error.symbol}: ` : '';

  if (error.line === null || error.line === undefined) {
    return `${prefix}${message}`;
  }
  return `บรรทัด ${error.line}: ${prefix}${message}`;
}

// Batch ถูกปฏิเสธทั้งก้อน (Parse หรือ Business Validation ไม่ผ่านอย่างน้อย 1 บรรทัด)
// — แสดงทุกบรรทัดที่ผิดพร้อมเหตุผล (ไม่ใช่แค่บรรทัดแรก) ไม่มีอะไรถูกบันทึกลง DB เลย
function buildBulkImportRejectedMessage(errors) {
  const body = [
    textLine('พบข้อผิดพลาดในรายการที่ส่งมา กรุณาแก้ไขแล้วส่งใหม่ทั้งก้อน', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
    separator(),
    ...errors.map((error) =>
      textLine(`• ${describeBulkImportError(error)}`, { size: 'sm', color: COLOR.loss })
    ),
  ];

  return bubble({
    headerText: '❌ นำเข้าพอร์ตไม่สำเร็จ',
    headerColor: COLOR.loss,
    headerBg: COLOR.lossBg,
    bodyContents: body,
  });
}

// Preview ก่อนบันทึกจริง (Batch Parse+Validate ผ่านหมดแล้ว) — ตารางรายการ +
// ยอดรวม + ปุ่มยืนยัน/ยกเลิก (Postback พก batchId เดียว ไม่ใช่ pendingId ทีละตัว)
function buildBulkImportPreviewMessage(batch) {
  const body = [
    textLine(`พบ ${batch.items.length} รายการ ตรวจสอบก่อนกด "ยืนยัน"`, {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
    separator(),
  ];

  batch.items.forEach((item) => {
    // รายการที่พิมพ์ราคาเป็น USD — โชว์ยอด USD ต้นฉบับ + เรตที่ใช้ เหมือน
    // buildPreviewMessage (Parity กับคำสั่งซื้อเดี่ยว) ไม่ให้ผู้ใช้งงว่าทำไม
    // ยอดบาทไม่ตรงกับตัวเลขที่พิมพ์ — item.fx มาจาก pendingTransaction.service.
    // createBatch (Enrich ต่อจาก resolveQuantityAndPrice เดิม ไม่ได้ Persist ใน DB)
    const isUsd = Boolean(item.fx && item.fx.currency === 'USD');

    body.push(
      textLine(item.assetSymbol, { weight: 'bold', color: COLOR.textPrimary }),
      textLine(
        `จำนวน: ${formatNumber(item.quantity)} ${item.assetSymbol} @ ${formatNumber(item.pricePerUnit)} บาท`,
        { size: 'sm', color: COLOR.textSecondary }
      )
    );

    if (isUsd) {
      body.push(
        textLine(`ราคาที่พิมพ์: ${formatNumber(item.fx.pricePerUnitOriginal)} USD/หน่วย`, {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
        textLine(`อัตราแลกเปลี่ยน: 1 USD = ${formatNumber(item.fx.rate)} บาท`, {
          size: 'xs',
          color: COLOR.textSecondary,
        })
      );
    }

    body.push(
      textLine(`มูลค่า: ${formatNumber(item.amountThb)} บาท • ${item.txnDate}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      separator()
    );
  });

  body.push(
    textLine(`รวมทั้งหมด: ${formatNumber(batch.totalAmountThb)} บาท (${batch.items.length} รายการ)`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine('ตรวจสอบแล้วกด "ยืนยัน" เพื่อบันทึกทุกรายการ (หมดอายุใน 5 นาที)', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: '✅ ยืนยันทั้งหมด',
        data: postbackDataBatch('confirm_bulk_import', batch.batchId),
        displayText: 'ยืนยันนำเข้าพอร์ต',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ยกเลิก',
        data: postbackDataBatch('cancel_bulk_import', batch.batchId),
        displayText: 'ยกเลิกนำเข้าพอร์ต',
      },
    },
  ];

  return {
    type: 'flex',
    altText: `นำเข้าพอร์ต ${batch.items.length} รายการ รวม ${formatNumber(batch.totalAmountThb)} บาท`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('📥 ตรวจสอบก่อนนำเข้า', { weight: 'bold', color: COLOR.info })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
    },
  };
}

// หลังกด "ยืนยันทั้งหมด" — ผลลัพธ์ Best-effort จาก pendingTransactionService.confirmBatch
// (result: { total, succeeded, failed }) แสดงจำนวนสำเร็จเสมอ และรายการที่ล้มเหลว
// (ถ้ามี) พร้อมเหตุผล ไม่ทำให้ผู้ใช้เข้าใจผิดว่าทุกอย่างสำเร็จเมื่อมีบางรายการพลาด
function buildBulkImportConfirmedMessage(result) {
  const allSucceeded = result.failed.length === 0;

  const body = [
    textLine(`บันทึกสำเร็จ ${result.succeeded.length}/${result.total} รายการ`, {
      size: 'md',
      weight: 'bold',
      color: allSucceeded ? COLOR.profit : COLOR.warning,
    }),
  ];

  if (!allSucceeded) {
    body.push(
      separator(),
      textLine('รายการที่ไม่สำเร็จ (ลองพิมพ์ "ซื้อ" รายการนี้เพิ่มเองภายหลัง):', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      ...result.failed.map((f) =>
        textLine(`• ${f.symbol ?? '-'}: ${ERROR_MESSAGES[f.code] ?? ERROR_MESSAGES.INTERNAL_ERROR}`, {
          size: 'xs',
          color: COLOR.loss,
        })
      )
    );
  }

  return bubble({
    headerText: allSucceeded ? '✅ นำเข้าพอร์ตสำเร็จ' : '⚠️ นำเข้าพอร์ตสำเร็จบางส่วน',
    headerColor: allSucceeded ? COLOR.profit : COLOR.warning,
    headerBg: allSucceeded ? COLOR.profitBg : COLOR.warningBg,
    bodyContents: body,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Export รายงาน PDF/Excel (Phase 3 Round 8 — Premium Feature)
// ═══════════════════════════════════════════════════════════════════════

// Postback data ของปุ่มเลือกรูปแบบไฟล์ — พก range type (rt) + from/to (เฉพาะ custom)
// เพื่อให้ Handler Regenerate ได้โดยไม่ต้องเก็บ Session (LINE Postback ≤ 300 ตัวอักษร
// พอสำหรับ format + วันที่) rt=month/year → Handler Re-resolve ช่วงตามวันปัจจุบันเอง
function exportPostback(format, params) {
  const base =
    params.range === 'custom'
      ? `rt=custom&from=${params.from}&to=${params.to}`
      : `rt=${params.range}`;
  return `action=export_report&format=${format}&${base}`;
}

// Quick Reply ให้เลือก PDF/Excel หลังพิมพ์ "ส่งออกรายงาน [ช่วงเวลา]" (Premium ผ่านแล้ว)
// label = ข้อความช่วงเวลาไทยจาก reportExport.resolveRange (แสดงให้ผู้ใช้ยืนยันช่วงที่เลือก)
function buildExportFormatQuickReply(params, label) {
  const items = [
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '📄 PDF',
        data: exportPostback('pdf', params),
        displayText: 'ส่งออกรายงานเป็น PDF',
      },
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '📊 Excel',
        data: exportPostback('excel', params),
        displayText: 'ส่งออกรายงานเป็น Excel',
      },
    },
  ];

  return {
    type: 'text',
    text: `จะส่งออกรายงานช่วง "${label}" เป็นไฟล์แบบไหนดีครับ?`,
    quickReply: { items },
  };
}

// การ์ดแจ้งลิงก์ดาวน์โหลดรายงาน (หลังสร้างไฟล์ + อัปโหลด Storage + Signed URL สำเร็จ)
// ปุ่ม "ดาวน์โหลดรายงาน" = uri action ชี้ไป Signed URL + คำเตือนหมดอายุตาม TTL จริง
// arg = { signedUrl, format ('pdf'|'excel'), rangeLabel, expiresMinutes }
function buildReportReadyMessage({ signedUrl, format, rangeLabel, expiresMinutes }) {
  const formatLabel = format === 'excel' ? 'Excel (.xlsx)' : 'PDF (.pdf)';

  return {
    type: 'flex',
    altText: 'รายงานพร้อมดาวน์โหลดแล้ว',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('📑 รายงานพร้อมแล้ว', { weight: 'bold', color: COLOR.profit })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          textLine(`ช่วงเวลา: ${rangeLabel}`, { size: 'sm', color: COLOR.textPrimary }),
          textLine(`รูปแบบไฟล์: ${formatLabel}`, { size: 'sm', color: COLOR.textSecondary }),
          textLine(`⚠️ ลิงก์นี้จะหมดอายุใน ${expiresMinutes} นาที กรุณาดาวน์โหลดทันที`, {
            size: 'xs',
            color: COLOR.warning,
          }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLOR.profit,
            action: { type: 'uri', label: '⬇️ ดาวน์โหลดรายงาน', uri: signedUrl },
          },
        ],
      },
    },
  };
}

// ข้อความแจ้งว่า Export เป็นฟีเจอร์ Premium พร้อม CTA อัพเกรด (Reuse ปุ่มแพ็กเกจเดิม)
function buildExportPremiumRequiredMessage() {
  const body = [
    textLine('Export รายงานเป็นฟีเจอร์สมาชิก Premium 👑', {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine('อัพเกรดเป็น Premium เพื่อส่งออกรายงานสรุปพอร์ต + ประวัติธุรกรรมเป็น PDF/Excel ได้', {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    separator(),
    textLine('เลือกแพ็กเกจด้านล่างเพื่ออัพเกรดได้เลย', { size: 'sm', color: COLOR.textPrimary }),
  ];

  return {
    type: 'flex',
    altText: 'Export รายงานเป็นฟีเจอร์ Premium',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.warningBg,
        paddingAll: '12px',
        contents: [textLine('👑 ฟีเจอร์ Premium', { weight: 'bold', color: COLOR.warning })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: premiumPeriodButtons('รายเดือน 59 บาท', 'รายปี 590 บาท'),
      },
    },
  };
}

// อธิบายรูปแบบคำสั่งที่ถูกต้องเมื่อ Parse ช่วงเวลาไม่ได้ (ไม่ปล่อย Error ดิบ)
function buildExportFormatHelpMessage() {
  return bubble({
    headerText: '📑 ส่งออกรายงาน',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('พิมพ์คำสั่งส่งออกรายงานตามรูปแบบด้านล่างได้เลย', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('• ส่งออกรายงาน  (ค่าเริ่มต้น = เดือนนี้)', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ส่งออกรายงาน เดือนนี้', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ส่งออกรายงาน ปีนี้', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ส่งออกรายงาน 01/01/2569 - 30/06/2569', {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

module.exports = {
  ERROR_MESSAGES,
  buildExportFormatQuickReply,
  buildReportReadyMessage,
  buildExportPremiumRequiredMessage,
  buildExportFormatHelpMessage,
  buildBuyConfirmMessage,
  buildSellConfirmMessage,
  buildProfitMessage,
  buildPreviewMessage,
  buildCancelledMessage,
  buildEditHintMessage,
  buildPortfolioMessage,
  buildHistoryMessage,
  buildUndoMessage,
  buildReminderSetMessage,
  buildReminderListMessage,
  buildReminderDeletedMessage,
  buildReminderPushMessage,
  buildPortfolioSummaryPushMessage,
  buildSymbolQuickReply,
  buildFrequencyQuickReply,
  buildDayOfWeekQuickReply,
  buildDayOfMonthQuickReply,
  buildAskAmountMessage,
  buildReminderSetupCancelledMessage,
  buildAdminPaymentRequestMessage,
  buildAdminApproveAckMessage,
  buildAdminRejectAckMessage,
  buildPaymentApprovedMessage,
  buildPaymentRejectedMessage,
  buildPremiumOfferMessage,
  buildPremiumStatusMessage,
  buildPaymentQrMessage,
  buildPaymentNotifySubmittedMessage,
  buildSlipReceivedMessage,
  buildBulkImportInstructionsMessage,
  buildBulkImportEmptyMessage,
  buildBulkImportRejectedMessage,
  buildBulkImportPreviewMessage,
  buildBulkImportConfirmedMessage,
  buildFundClassPickerMessage,
  buildFundNotFoundMessage,
  buildDashboardLinkMessage,
  buildPlanDowngradedMessage,
  buildErrorMessage,
  buildAddGuideMessage,
  buildUnknownCommandMessage,
};
