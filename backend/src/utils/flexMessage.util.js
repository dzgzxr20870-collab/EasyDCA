const { dowToDayName, THAI_DAY_NAMES } = require('./thaiDate.util');

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
};

// Postback data encoding สำหรับปุ่มในข้อความ Preview — Controller ถอดด้วย
// URLSearchParams รูปแบบ "action=<confirm|edit|cancel>&pendingId=<uuid>"
function postbackData(action, pendingId) {
  return `action=${action}&pendingId=${pendingId}`;
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

  return null;
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

  const body = [
    textLine(pending.assetSymbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    textLine(`จำนวน: ${formatNumber(pending.quantity)} ${pending.assetSymbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาต่อหน่วย: ${formatNumber(pending.pricePerUnit)} บาท`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่ารวม: ${formatNumber(pending.amountThb)} บาท`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine('ตรวจสอบแล้วกด "ยืนยัน" เพื่อบันทึก (รายการหมดอายุใน 5 นาที)', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
  ];

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

  return {
    type: 'flex',
    altText: `คำขอชำระเงินใหม่ ${formatNumber(payment.amountThb)} บาท`,
    contents: {
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
    },
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

module.exports = {
  ERROR_MESSAGES,
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
  buildErrorMessage,
  buildUnknownCommandMessage,
};
