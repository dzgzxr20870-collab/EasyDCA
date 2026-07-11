// ═══════════════════════════════════════════════════════════════════════
// reportExport.service — Export รายงานสรุปพอร์ต DCA เป็น PDF / Excel (Round 8)
// ═══════════════════════════════════════════════════════════════════════
// Premium Feature — สร้าง "รายงานสรุปบัญชี" 2 ส่วนแบบ Bank Statement:
//   1) สรุปพอร์ตปัจจุบัน (ณ เวลาที่ Export — ไม่ถูกกรองตามช่วงเวลาเสมอ)
//   2) ประวัติธุรกรรมในช่วงเวลาที่เลือก (from–to)
//
// Reuse ทั้งหมด ไม่คำนวณเงินซ้ำ:
//   - portfolioService.getPortfolioSummary → holdings (heldQuantity/totalInvested/
//     averageCost ที่กรอง Asset ขายหมดออกแล้ว) + totalInvested รวม + isEmpty
//   - priceFeedService (getCurrentPrice / getMutualFundNav) → ราคาตลาดปัจจุบัน
//     (Fail Isolated ราย Asset — Pattern เดียวกับ portfolioSummary.service.js)
//   - transactionRepository.findByUserAndDateRange → ธุรกรรมกรองตามช่วงเวลา
//
// การสร้างไฟล์แยกเป็น buildPdfReport / buildExcelReport (Test อิสระจากกันได้)
// ใช้ Generation Logic ("รูปทรงข้อมูล" reportData) ชุดเดียวกันทั้ง LIFF และ LINE

const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const portfolioService = require('./portfolio.service');
const priceFeedService = require('./priceFeed.service');
const fxRateService = require('./fxRate.service');
const transactionRepository = require('../repositories/transaction.repository');
const userRepository = require('../repositories/user.repository');
const {
  THAI_MONTH_NAMES,
  formatThaiDate,
  lastDayOfMonthOf,
} = require('../utils/thaiDate.util');

// ฟอนต์ไทย (Sarabun — OFL, Bundle มากับ repo ที่ backend/assets/fonts) จำเป็นเพราะ
// ฟอนต์ Built-in ของ pdfkit (Helvetica/Times) แสดงอักษรไทยไม่ได้ (เป็นช่องว่าง)
const FONT_DIR = path.join(__dirname, '../../assets/fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'Sarabun-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'Sarabun-Bold.ttf');

// Error ที่มี code (Pattern เดียวกับ ProfitServiceError/PaymentServiceError) เพื่อให้
// Controller Map เป็น HTTP Status / ข้อความไทยได้ ไม่ปล่อย Error ดิบถึงผู้ใช้
class ReportServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReportServiceError';
    this.code = code;
    this.details = details;
  }
}

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// จำนวนเงินบาท: คั่น Comma ทศนิยม 2 ตำแหน่งเสมอ (ตัวเลขในรายงานอ้างอิงเงินจริง)
function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// Multi-Currency (Round 10): จำนวนเงินพร้อมหน่วยตามสกุล — THB ไม่ต่อหน่วย (คงรูปเดิม),
// USD ต่อ " USD" ท้ายตัวเลข เพื่อไม่ให้ Path THB เดิมเปลี่ยน (เทสต์ THB ล้วนคงผลเดิม)
function formatMoneyCur(value, currency) {
  const base = formatMoney(value);
  return currency === 'USD' ? `${base} USD` : base;
}

// จำนวนหน่วยถือครอง: รองรับทศนิยมสูงสุด 8 ตำแหน่ง (Crypto) ตัดศูนย์ท้ายทิ้ง
function formatQty(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(num);
}

// วันที่ปัจจุบันของไทย 'YYYY-MM-DD' (Asia/Bangkok) — ใช้กำหนดช่วง "เดือนนี้/ปีนี้"
// ให้ตรงเขตเวลาไทยไม่ผูกกับ Timezone ของเครื่องที่รัน
function bangkokTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}

// ── แปลง Options ช่วงเวลาที่ผู้ใช้เลือก → { from, to, label } (ISO 'YYYY-MM-DD') ──
// range: 'month' (เดือนนี้) | 'year' (ปีนี้) | 'custom' (ต้องมี from/to ที่ Parse แล้ว)
//   - month/year: คำนวณจากวันปัจจุบัน (Asia/Bangkok)
//   - custom: from/to เป็น ISO ที่ Caller Parse มาแล้ว (LINE ใช้ parseDateInput,
//     LIFF ส่ง Date Picker มาเป็น ISO อยู่แล้ว) — Validate รูปแบบ + from<=to อีกชั้น
// label เป็นภาษาไทย/พ.ศ. สำหรับแสดงหัวรายงาน
function resolveRange(options = {}, now = new Date()) {
  const range = options.range || 'month';
  const todayIso = bangkokTodayIso(now);
  const [year, month] = todayIso.split('-');

  if (range === 'month') {
    const from = `${year}-${month}-01`;
    const to = `${year}-${month}-${String(lastDayOfMonthOf(from)).padStart(2, '0')}`;
    return { from, to, label: `เดือน${THAI_MONTH_NAMES[Number(month) - 1]} ${Number(year) + 543}` };
  }

  if (range === 'year') {
    return {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: `ปี ${Number(year) + 543}`,
    };
  }

  if (range === 'custom') {
    const { from, to } = options;
    const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoPattern.test(from ?? '') || !isoPattern.test(to ?? '')) {
      throw new ReportServiceError('EXPORT_INVALID_RANGE', `Invalid custom range: ${from} - ${to}`, {
        from,
        to,
      });
    }
    if (from > to) {
      throw new ReportServiceError('EXPORT_INVALID_RANGE', `Custom range from > to: ${from} > ${to}`, {
        from,
        to,
      });
    }
    return { from, to, label: `${formatThaiDate(from)} - ${formatThaiDate(to)}` };
  }

  throw new ReportServiceError('EXPORT_INVALID_RANGE', `Unknown range type: ${range}`, { range });
}

// ดึงราคาปัจจุบันของ 1 Holding แบบ Fail Isolated (คืน null ถ้าดึงไม่ได้) — Pattern
// เดียวกับ portfolioSummary.service.js: กองทุนใช้ getMutualFundNav (proj_id+class),
// สินทรัพย์อื่นใช้ getCurrentPrice (คืน null เองอยู่แล้ว) ห่อ try/catch กันทั้งงานพัง
async function fetchHoldingPrice(holding) {
  try {
    if (holding.type === 'fund' && holding.projId && holding.fundClassName) {
      const nav = await priceFeedService.getMutualFundNav(holding.projId, holding.fundClassName);
      return nav.lastVal;
    }
    // Multi-Currency (Round 10) — สินทรัพย์สกุล USD ตีมูลค่าด้วยราคา USD ตามจริง
    // (ไม่ผ่าน THB) เพื่อให้ต้นทุน (USD) กับมูลค่า (USD) อยู่สกุลเดียวกัน
    if (holding.currency === 'USD') {
      return await priceFeedService.getCurrentPriceUsd(holding.symbol);
    }
    return await priceFeedService.getCurrentPrice(holding.symbol);
  } catch (err) {
    return null;
  }
}

// ประกอบ "รูปทรงข้อมูลรายงาน" (reportData) ที่ทั้ง PDF/Excel ใช้ร่วมกัน:
//   { user, generatedAt, range, holdings[], totals, transactions[] }
// holdings แต่ละแถวมี priceAvailable บอกว่าดึงราคาปัจจุบันได้ไหม (ราคาไม่ได้ →
// currentValue/profitLoss เป็น null แต่ยังโชว์แถวพร้อมหมายเหตุ — Requirement ข้อ 5)
async function buildReportData(userId, resolvedRange, now = new Date()) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ReportServiceError('EXPORT_USER_NOT_FOUND', `User ${userId} not found`, { userId });
  }

  const summary = await portfolioService.getPortfolioSummary(userId);

  const holdings = [];
  // Multi-Currency (Round 10): สะสมมูลค่า/เงินลงทุน "แยกสกุล" ไม่ถัวข้ามสกุล แล้วค่อย
  // แปลง USD → THB ด้วยเรตเดียวตอนท้ายเพื่อทำ "ยอดรวมเทียบบาท" (Grand Total)
  const currentValueByCur = { THB: 0, USD: 0 };
  const investedWithPriceByCur = { THB: 0, USD: 0 };
  let excludedCount = 0;

  for (const h of summary.holdings) {
    const currency = h.currency === 'USD' ? 'USD' : 'THB';
    const price = await fetchHoldingPrice(h);

    if (price === null || price === undefined) {
      excludedCount += 1;
      holdings.push({
        symbol: h.symbol,
        name: h.name,
        type: h.type,
        currency,
        heldQuantity: h.heldQuantity,
        averageCost: h.averageCost,
        totalInvested: h.totalInvested,
        currentValue: null,
        profitLoss: null,
        profitLossPercent: null,
        priceAvailable: false,
      });
      continue;
    }

    const currentValue = roundToTwo(h.heldQuantity * price);
    const profitLoss = roundToTwo(currentValue - h.totalInvested);
    const profitLossPercent =
      h.totalInvested > 0 ? roundToTwo((profitLoss / h.totalInvested) * 100) : null;

    currentValueByCur[currency] += currentValue;
    investedWithPriceByCur[currency] += h.totalInvested;

    holdings.push({
      symbol: h.symbol,
      name: h.name,
      type: h.type,
      currency,
      heldQuantity: h.heldQuantity,
      averageCost: h.averageCost,
      totalInvested: h.totalInvested,
      currentValue,
      profitLoss,
      profitLossPercent,
      priceAvailable: true,
    });
  }

  // เรต USD→THB (ดึงครั้งเดียว) — เฉพาะเมื่อมีสินทรัพย์ USD (พอร์ต THB ล้วนไม่เรียก FX)
  const invByCur = summary.investedByCurrency ?? { THB: summary.totalInvested, USD: 0 };
  const hasUsd =
    currentValueByCur.USD > 0 || investedWithPriceByCur.USD > 0 || (invByCur.USD ?? 0) > 0;
  const fx = hasUsd ? await fxRateService.getUsdThbRate() : null;
  const usdRate = fx ? fx.rate : null;
  const toThb = (thb, usd) => roundToTwo(thb + (usdRate !== null ? usd * usdRate : 0));

  // ยอดรวม "เทียบบาท": THB ตรงๆ + USD ที่แปลงแล้ว (พอร์ต THB ล้วน = ค่าเดิมทุกประการ)
  const totalInvested = toThb(invByCur.THB ?? summary.totalInvested, invByCur.USD ?? 0);
  const totalCurrentValue = toThb(currentValueByCur.THB, currentValueByCur.USD);
  const investedWithPrice = toThb(investedWithPriceByCur.THB, investedWithPriceByCur.USD);
  const totalProfitLoss = roundToTwo(totalCurrentValue - investedWithPrice);
  const totalProfitLossPercent =
    investedWithPrice > 0 ? roundToTwo((totalProfitLoss / investedWithPrice) * 100) : null;

  const transactions = await transactionRepository.findByUserAndDateRange(
    userId,
    resolvedRange.from,
    resolvedRange.to
  );

  return {
    user: { displayName: user.displayName },
    generatedAt: now,
    range: resolvedRange,
    holdings,
    totals: {
      totalInvested,
      totalCurrentValue,
      totalProfitLoss,
      totalProfitLossPercent,
      excludedCount,
      // Multi-Currency (Round 10) — ยอดแยกสกุล + เรตที่ใช้แปลง (ยอดหลักด้านบน = เทียบบาท)
      byCurrency: {
        THB: {
          invested: roundToTwo(invByCur.THB ?? summary.totalInvested),
          currentValue: roundToTwo(currentValueByCur.THB),
        },
        USD: {
          invested: roundToTwo(invByCur.USD ?? 0),
          currentValue: roundToTwo(currentValueByCur.USD),
        },
      },
      fxRate: usdRate,
      fxAsOf: fx ? fx.asOf : null,
      fxStale: fx ? fx.stale : false,
      fxUnavailableForUsd: hasUsd && usdRate === null,
    },
    transactions,
  };
}

// ── PDF ────────────────────────────────────────────────────────────────
const PDF_COLOR = {
  text: '#1E293B',
  muted: '#64748B',
  profit: '#16A34A',
  loss: '#DC2626',
  headerBg: '#06C755',
  rowLine: '#E2E8F0',
};

const PAGE_MARGIN = 40;
const A4_WIDTH = 595.28;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2; // ≈ 515

function plColorPdf(value) {
  if (value === null || value === undefined) return PDF_COLOR.muted;
  return value >= 0 ? PDF_COLOR.profit : PDF_COLOR.loss;
}

function signed(value, formatter) {
  if (value === null || value === undefined) return '-';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatter(Math.abs(value))}`;
}

// วาดหัวตาราง 1 แถว (พื้นเขียว ตัวหนาสีขาว) ที่ตำแหน่ง y — คืน y ของแถวถัดไป
function drawTableHeader(doc, columns, y) {
  const rowH = 22;
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowH).fill(PDF_COLOR.headerBg);
  doc.font('TH-Bold').fontSize(9).fillColor('#FFFFFF');

  let x = PAGE_MARGIN;
  for (const col of columns) {
    doc.text(col.label, x + 4, y + 6, {
      width: col.width - 8,
      align: col.align || 'left',
      lineBreak: false,
    });
    x += col.width;
  }
  return y + rowH;
}

// วาดข้อมูล 1 แถว — cells = [{ text, align, color, bold }] เรียงตาม columns
// จัดการขึ้นหน้าใหม่อัตโนมัติ (วาดหัวตารางซ้ำ) คืน y ของแถวถัดไป
function drawTableRow(doc, columns, cells, y, redrawHeader) {
  const rowH = 20;
  const bottom = doc.page.height - PAGE_MARGIN - 30; // เผื่อ Footer

  if (y + rowH > bottom) {
    doc.addPage();
    y = redrawHeader(PAGE_MARGIN);
  }

  let x = PAGE_MARGIN;
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    const cell = cells[i] || {};
    doc
      .font(cell.bold ? 'TH-Bold' : 'TH')
      .fontSize(9)
      .fillColor(cell.color || PDF_COLOR.text)
      .text(cell.text ?? '', x + 4, y + 5, {
        width: (cell.span ? sumSpan(columns, i, cell.span) : col.width) - 8,
        align: cell.align || col.align || 'left',
        lineBreak: false,
      });
    x += col.width;
    if (cell.span) i += cell.span - 1; // ข้ามคอลัมน์ที่ถูก span รวมไปแล้ว
  }

  doc
    .moveTo(PAGE_MARGIN, y + rowH)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y + rowH)
    .strokeColor(PDF_COLOR.rowLine)
    .lineWidth(0.5)
    .stroke();

  return y + rowH;
}

function sumSpan(columns, startIndex, span) {
  let total = 0;
  for (let i = startIndex; i < startIndex + span && i < columns.length; i += 1) {
    total += columns[i].width;
  }
  return total;
}

function sectionTitle(doc, text, y) {
  doc.font('TH-Bold').fontSize(13).fillColor(PDF_COLOR.text).text(text, PAGE_MARGIN, y);
  return doc.y + 4;
}

// สร้าง PDF Buffer จาก reportData — คืน Promise<Buffer>
function buildPdfReport(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
      doc.registerFont('TH', FONT_REGULAR);
      doc.registerFont('TH-Bold', FONT_BOLD);

      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // ── หัวรายงาน ────────────────────────────────────────────────────
      doc.font('TH-Bold').fontSize(24).fillColor(PDF_COLOR.headerBg).text('EasyDCA');
      doc.font('TH-Bold').fontSize(14).fillColor(PDF_COLOR.text).text('รายงานสรุปพอร์ตการลงทุน');
      doc.moveDown(0.5);
      doc.font('TH').fontSize(10).fillColor(PDF_COLOR.muted);
      doc.text(`ผู้ใช้: ${data.user.displayName ?? '-'}`);
      doc.text(`ช่วงเวลาที่รายงาน (ประวัติธุรกรรม): ${data.range.label}`);
      doc.text(`วันที่สร้างรายงาน: ${formatThaiDate(data.generatedAt)}`);

      doc.moveDown(1);

      // ── ส่วนที่ 1: สรุปพอร์ตปัจจุบัน ──────────────────────────────────
      let y = sectionTitle(doc, '1. สรุปพอร์ตปัจจุบัน (ณ วันที่สร้างรายงาน)', doc.y);

      const holdingCols = [
        { label: 'สินทรัพย์', width: 90, align: 'left' },
        { label: 'จำนวนถือ', width: 85, align: 'right' },
        { label: 'ต้นทุนเฉลี่ย', width: 85, align: 'right' },
        { label: 'เงินลงทุน', width: 85, align: 'right' },
        { label: 'มูลค่าปัจจุบัน', width: 90, align: 'right' },
        { label: 'กำไร/ขาดทุน', width: 80, align: 'right' },
      ];
      const redrawHoldingHeader = (yy) => drawTableHeader(doc, holdingCols, yy);

      if (data.holdings.length === 0) {
        y = drawTableHeader(doc, holdingCols, y);
        y = drawTableRow(
          doc,
          holdingCols,
          [{ text: 'ยังไม่มีสินทรัพย์ในพอร์ต', align: 'left', color: PDF_COLOR.muted, span: 6 }],
          y,
          redrawHoldingHeader
        );
      } else {
        y = drawTableHeader(doc, holdingCols, y);
        for (const h of data.holdings) {
          if (h.priceAvailable) {
            y = drawTableRow(
              doc,
              holdingCols,
              [
                { text: h.symbol, bold: true },
                { text: formatQty(h.heldQuantity), align: 'right' },
                { text: h.averageCost === null ? '-' : formatMoneyCur(h.averageCost, h.currency), align: 'right' },
                { text: formatMoneyCur(h.totalInvested, h.currency), align: 'right' },
                { text: formatMoneyCur(h.currentValue, h.currency), align: 'right' },
                {
                  text: `${signed(h.profitLoss, (v) => formatMoneyCur(v, h.currency))} (${signed(h.profitLossPercent, (v) => formatMoney(v))}%)`,
                  align: 'right',
                  color: plColorPdf(h.profitLoss),
                },
              ],
              y,
              redrawHoldingHeader
            );
          } else {
            y = drawTableRow(
              doc,
              holdingCols,
              [
                { text: h.symbol, bold: true },
                { text: formatQty(h.heldQuantity), align: 'right' },
                { text: h.averageCost === null ? '-' : formatMoneyCur(h.averageCost, h.currency), align: 'right' },
                { text: formatMoneyCur(h.totalInvested, h.currency), align: 'right' },
                { text: 'ราคาไม่พร้อมใช้งาน', align: 'right', color: PDF_COLOR.muted, span: 2 },
              ],
              y,
              redrawHoldingHeader
            );
          }
        }

        // แถวสรุปรวม — ยอดเป็น "เทียบบาท" (แปลง USD ด้วยเรตล่าสุด) ถ้าพอร์ตมี USD
        const hasUsdHoldings = (data.totals.byCurrency?.USD?.invested ?? 0) > 0 ||
          (data.totals.byCurrency?.USD?.currentValue ?? 0) > 0;
        y = drawTableRow(
          doc,
          holdingCols,
          [
            { text: hasUsdHoldings ? 'รวมทั้งพอร์ต (เทียบบาท)' : 'รวมทั้งพอร์ต', bold: true },
            { text: '', align: 'right' },
            { text: '', align: 'right' },
            { text: formatMoney(data.totals.totalInvested), align: 'right', bold: true },
            { text: formatMoney(data.totals.totalCurrentValue), align: 'right', bold: true },
            {
              text: `${signed(data.totals.totalProfitLoss, formatMoney)} (${signed(data.totals.totalProfitLossPercent, (v) => formatMoney(v))}%)`,
              align: 'right',
              bold: true,
              color: plColorPdf(data.totals.totalProfitLoss),
            },
          ],
          y,
          redrawHoldingHeader
        );
      }

      if (data.totals.excludedCount > 0) {
        doc.font('TH').fontSize(8).fillColor(PDF_COLOR.muted);
        doc.text(
          `* ไม่รวม ${data.totals.excludedCount} สินทรัพย์ที่ยังไม่มีราคาตลาด (เช่น หุ้นไทย) มูลค่าปัจจุบัน/กำไรขาดทุนรวมจึงไม่ใช่ทั้งพอร์ต`,
          PAGE_MARGIN,
          y + 6,
          { width: CONTENT_WIDTH }
        );
        y = doc.y;
      }

      // Multi-Currency (Round 10) — ยอดแยกตามสกุล + เรตที่ใช้แปลงเป็นบาท (เฉพาะพอร์ตที่มี USD)
      const bc = data.totals.byCurrency;
      const portfolioHasUsd = bc && ((bc.USD.invested ?? 0) > 0 || (bc.USD.currentValue ?? 0) > 0);
      if (portfolioHasUsd) {
        doc.font('TH').fontSize(8).fillColor(PDF_COLOR.muted);
        doc.text(
          `ยอดแยกสกุล — THB: ลงทุน ${formatMoney(bc.THB.invested)} / มูลค่า ${formatMoney(bc.THB.currentValue)} บาท • ` +
            `USD: ลงทุน ${formatMoney(bc.USD.invested)} / มูลค่า ${formatMoney(bc.USD.currentValue)} USD`,
          PAGE_MARGIN,
          y + 6,
          { width: CONTENT_WIDTH }
        );
        const fxNote = data.totals.fxRate !== null
          ? `ยอดรวมด้านบนแปลง USD เป็นบาทที่อัตรา 1 USD = ${formatMoney(data.totals.fxRate)} บาท` +
            `${data.totals.fxAsOf ? ` (ณ ${data.totals.fxAsOf})` : ''}${data.totals.fxStale ? ' [เรตล่าสุดที่มี]' : ''}`
          : '* ดึงอัตราแลกเปลี่ยนไม่สำเร็จ — ยอดรวมเทียบบาทยังไม่รวมส่วนที่เป็น USD';
        doc.text(fxNote, PAGE_MARGIN, doc.y + 2, { width: CONTENT_WIDTH });
        y = doc.y;
      }

      // ── ส่วนที่ 2: ประวัติธุรกรรม ────────────────────────────────────
      doc.moveDown(1.5);
      y = sectionTitle(doc, `2. ประวัติธุรกรรม (${data.range.label})`, doc.y);

      const txCols = [
        { label: 'วันที่', width: 80, align: 'left' },
        { label: 'สินทรัพย์', width: 75, align: 'left' },
        { label: 'ประเภท', width: 55, align: 'left' },
        { label: 'จำนวน', width: 100, align: 'right' },
        { label: 'ราคา/หน่วย', width: 100, align: 'right' },
        { label: 'มูลค่า (บาท)', width: 105, align: 'right' },
      ];
      const redrawTxHeader = (yy) => drawTableHeader(doc, txCols, yy);

      y = drawTableHeader(doc, txCols, y);

      if (data.transactions.length === 0) {
        y = drawTableRow(
          doc,
          txCols,
          [{ text: 'ไม่มีรายการในช่วงเวลานี้', align: 'left', color: PDF_COLOR.muted, span: 6 }],
          y,
          redrawTxHeader
        );
      } else {
        for (const tx of data.transactions) {
          const isBuy = tx.type === 'buy';
          y = drawTableRow(
            doc,
            txCols,
            [
              { text: tx.date },
              { text: tx.symbol ?? '-' },
              { text: isBuy ? 'ซื้อ' : 'ขาย', color: isBuy ? PDF_COLOR.profit : PDF_COLOR.loss },
              { text: formatQty(tx.quantity), align: 'right' },
              { text: formatMoneyCur(tx.pricePerUnit, tx.currency), align: 'right' },
              { text: formatMoneyCur(tx.amountThb, tx.currency), align: 'right' },
            ],
            y,
            redrawTxHeader
          );
        }
      }

      // ── Footer: เลขหน้า + Disclaimer (ทุกหน้า) ───────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        doc.font('TH').fontSize(8).fillColor(PDF_COLOR.muted).text(
          `EasyDCA • รายงานนี้สร้างจากข้อมูลที่คุณบันทึกไว้ ไม่ใช่คำแนะนำการลงทุน • หน้า ${i + 1}/${range.count}`,
          PAGE_MARGIN,
          doc.page.height - PAGE_MARGIN - 12,
          { width: CONTENT_WIDTH, align: 'center' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Excel ──────────────────────────────────────────────────────────────
const XLSX_MONEY_FMT = '#,##0.00';
const XLSX_QTY_FMT = '#,##0.########';

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF06C755' } };
    cell.alignment = { vertical: 'middle' };
  });
}

// สร้าง Excel Buffer จาก reportData — 2 Sheet (สรุปพอร์ต + ประวัติธุรกรรม)
async function buildExcelReport(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EasyDCA';
  wb.created = data.generatedAt;

  // ── Sheet 1: สรุปพอร์ต ────────────────────────────────────────────
  const s1 = wb.addWorksheet('สรุปพอร์ต');
  s1.addRow(['EasyDCA — รายงานสรุปพอร์ตการลงทุน']);
  s1.getRow(1).font = { bold: true, size: 14 };
  s1.addRow([`ผู้ใช้: ${data.user.displayName ?? '-'}`]);
  s1.addRow([`ช่วงเวลาที่รายงาน (ประวัติธุรกรรม): ${data.range.label}`]);
  s1.addRow([`วันที่สร้างรายงาน: ${formatThaiDate(data.generatedAt)}`]);
  s1.addRow([]);

  const s1HeaderRowNumber = s1.rowCount + 1;
  const s1Header = s1.addRow([
    'สินทรัพย์',
    'ประเภท',
    'จำนวนที่ถือ',
    'ต้นทุนเฉลี่ย (บาท)',
    'เงินลงทุน (บาท)',
    'มูลค่าปัจจุบัน (บาท)',
    'กำไร/ขาดทุน (บาท)',
    'กำไร/ขาดทุน (%)',
  ]);
  styleHeaderRow(s1Header);

  for (const h of data.holdings) {
    const row = s1.addRow([
      h.symbol,
      // Multi-Currency (Round 10) — กำกับสกุล USD ที่คอลัมน์ประเภท (THB คงเดิม) เพื่อไม่
      // เปลี่ยนคอลัมน์ตัวเลข (คงความเป็น Number ที่ Filter/คำนวณต่อได้) และไม่ขยับ Index
      h.currency === 'USD' ? `${h.type} · USD` : h.type,
      h.heldQuantity,
      h.averageCost,
      h.totalInvested,
      h.priceAvailable ? h.currentValue : 'ราคาไม่พร้อมใช้งาน',
      h.priceAvailable ? h.profitLoss : null,
      h.priceAvailable ? h.profitLossPercent : null,
    ]);
    row.getCell(3).numFmt = XLSX_QTY_FMT;
    row.getCell(4).numFmt = XLSX_MONEY_FMT;
    row.getCell(5).numFmt = XLSX_MONEY_FMT;
    if (h.priceAvailable) {
      row.getCell(6).numFmt = XLSX_MONEY_FMT;
      row.getCell(7).numFmt = XLSX_MONEY_FMT;
      row.getCell(8).numFmt = XLSX_MONEY_FMT;
    }
  }

  const totalRow = s1.addRow([
    'รวมทั้งพอร์ต',
    '',
    '',
    '',
    data.totals.totalInvested,
    data.totals.totalCurrentValue,
    data.totals.totalProfitLoss,
    data.totals.totalProfitLossPercent,
  ]);
  totalRow.font = { bold: true };
  totalRow.getCell(5).numFmt = XLSX_MONEY_FMT;
  totalRow.getCell(6).numFmt = XLSX_MONEY_FMT;
  totalRow.getCell(7).numFmt = XLSX_MONEY_FMT;
  totalRow.getCell(8).numFmt = XLSX_MONEY_FMT;

  if (data.totals.excludedCount > 0) {
    s1.addRow([]);
    s1.addRow([
      `* ไม่รวม ${data.totals.excludedCount} สินทรัพย์ที่ยังไม่มีราคาตลาด (เช่น หุ้นไทย) มูลค่า/กำไรขาดทุนรวมจึงไม่ใช่ทั้งพอร์ต`,
    ]);
  }

  // Multi-Currency (Round 10) — แถวสรุปยอดแยกสกุล + เรตที่ใช้แปลง (เฉพาะพอร์ตที่มี USD)
  const bcx = data.totals.byCurrency;
  if (bcx && ((bcx.USD.invested ?? 0) > 0 || (bcx.USD.currentValue ?? 0) > 0)) {
    s1.addRow([]);
    s1.addRow([`ยอดแยกสกุล (THB): ลงทุน ${formatMoney(bcx.THB.invested)} / มูลค่า ${formatMoney(bcx.THB.currentValue)} บาท`]);
    s1.addRow([`ยอดแยกสกุล (USD): ลงทุน ${formatMoney(bcx.USD.invested)} / มูลค่า ${formatMoney(bcx.USD.currentValue)} USD`]);
    s1.addRow([
      data.totals.fxRate !== null
        ? `ยอดรวม "รวมทั้งพอร์ต" ด้านบนแปลง USD เป็นบาทที่ 1 USD = ${formatMoney(data.totals.fxRate)} บาท${data.totals.fxAsOf ? ` (ณ ${data.totals.fxAsOf})` : ''}${data.totals.fxStale ? ' [เรตล่าสุดที่มี]' : ''}`
        : '* ดึงอัตราแลกเปลี่ยนไม่สำเร็จ — ยอดรวมเทียบบาทยังไม่รวมส่วนที่เป็น USD',
    ]);
  }

  s1.columns = [
    { width: 16 },
    { width: 12 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
    { width: 18 },
    { width: 16 },
  ];
  s1.views = [{ state: 'frozen', ySplit: s1HeaderRowNumber }];

  // ── Sheet 2: ประวัติธุรกรรม ───────────────────────────────────────
  const s2 = wb.addWorksheet('ประวัติธุรกรรม');
  const s2Header = s2.addRow([
    'วันที่',
    'สินทรัพย์',
    'ประเภท',
    'จำนวน',
    'ราคาต่อหน่วย (บาท)',
    'มูลค่า (บาท)',
  ]);
  styleHeaderRow(s2Header);

  if (data.transactions.length === 0) {
    s2.addRow(['ไม่มีรายการในช่วงเวลานี้']);
  } else {
    for (const tx of data.transactions) {
      const row = s2.addRow([
        tx.date,
        tx.symbol ?? '-',
        // Multi-Currency (Round 10) — กำกับสกุล USD ที่คอลัมน์ประเภท (THB คงเดิม)
        tx.currency === 'USD'
          ? `${tx.type === 'buy' ? 'ซื้อ' : 'ขาย'} · USD`
          : tx.type === 'buy' ? 'ซื้อ' : 'ขาย',
        tx.quantity,
        tx.pricePerUnit,
        tx.amountThb,
      ]);
      row.getCell(4).numFmt = XLSX_QTY_FMT;
      row.getCell(5).numFmt = XLSX_MONEY_FMT;
      row.getCell(6).numFmt = XLSX_MONEY_FMT;
    }
  }

  s2.columns = [
    { width: 14 },
    { width: 14 },
    { width: 10 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];
  s2.views = [{ state: 'frozen', ySplit: 1 }];

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

const MIME = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const FILE_EXT = { pdf: 'pdf', excel: 'xlsx' };

// Entry point — สร้างรายงานพอร์ตของ userId ตาม { format, range }
//   format: 'pdf' | 'excel'
//   range : { range: 'month'|'year'|'custom', from?, to? } (from/to เป็น ISO สำหรับ custom)
// คืน { buffer, filename, mimeType } ให้ Controller Stream กลับ / อัปโหลด Storage
async function generatePortfolioReport(userId, { format, range } = {}, now = new Date()) {
  if (format !== 'pdf' && format !== 'excel') {
    throw new ReportServiceError('EXPORT_INVALID_FORMAT', `Invalid format: ${format}`, { format });
  }

  const resolvedRange = resolveRange(range, now);
  const data = await buildReportData(userId, resolvedRange, now);

  const buffer = format === 'pdf' ? await buildPdfReport(data) : await buildExcelReport(data);
  const filename = `EasyDCA-Report-${resolvedRange.from}_${resolvedRange.to}.${FILE_EXT[format]}`;

  return { buffer, filename, mimeType: MIME[format] };
}

module.exports = {
  ReportServiceError,
  resolveRange,
  buildReportData,
  buildPdfReport,
  buildExcelReport,
  generatePortfolioReport,
};
