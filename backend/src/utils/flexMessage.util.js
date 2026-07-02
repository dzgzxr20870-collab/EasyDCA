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
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่อีกครั้งในภายหลัง',
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
  if (priceSource !== 'coingecko') return null;
  return textLine('* ราคาอ้างอิงจาก CoinGecko อาจคลาดเคลื่อนจาก Exchange ที่คุณใช้เล็กน้อย', {
    size: 'xs',
    color: COLOR.textSecondary,
  });
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
  buildErrorMessage,
  buildUnknownCommandMessage,
};
