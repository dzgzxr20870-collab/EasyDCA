import { useMemo, useState } from 'react';
import { apiDownload, apiGet, apiUpload } from '../../lib/api.js';
import { formatTransactionNote, isReversalNote } from '../../lib/transactionNote.js';
import { slipUploadErrorMessage } from '../../lib/dcaErrors.js';

// ═══════════════════════════════════════════════════════════════════════════
// PortfolioDetailSection — ฟีเจอร์ที่ย้ายมาจาก Dashboard.jsx เดิม (S8 R3 รอบ 2)
// ═══════════════════════════════════════════════════════════════════════════
// หลักการ: "Re-skin ไม่ใช่ออกแบบใหม่" — Logic ทั้งหมดในไฟล์นี้ Copy ตรงจาก
// Dashboard.jsx (Production-verified อยู่แล้ว) เปลี่ยนแค่ JSX/Class ให้เข้ากับ
// Design System ใหม่ (.dh-*) ไม่มีการคำนวณเงินใหม่ใดๆ ในไฟล์นี้เลย
//
// ⚠️ ตั้งใจ "ไม่" ย้าย 3 อย่างจาก Tab "ภาพรวม" เดิมของ Dashboard.jsx:
//   1. การ์ดสรุป 4 ใบ (มูลค่าพอตรวม/เงินต้นรวม/กำไรขาดทุน/ออมเดือนนี้)
//   2. กราฟการเติบโต (Growth Chart, Cumulative Principal ผ่าน portfolioMath)
//   3. Donut สัดส่วนรายสินทรัพย์ + กราฟเงินออมรายเดือน 6 เดือน
// เพราะทั้ง 3 อย่างถูก "แทนที่แล้ว" ด้วยฟีเจอร์ใน Dashboard ใหม่ที่ทำหน้าที่เดียวกัน
// แต่คำนวณจาก Backend ล้วน (StatCards, AllocationCard, InvestedChart) — การย้าย
// ของเดิม (ที่คำนวณฝั่ง Client ผ่าน portfolioMath) มาแปะคู่กันจะ (ก) ซ้ำซ้อนกับ
// กราฟที่มีอยู่แล้ว (ข) เสี่ยงโชว์ตัวเลข "ดูเหมือนเดียวกันแต่ค่าไม่ตรงกัน" เพราะคนละ
// วิธีคำนวณ (ค) ขัดหลัก "ห้ามคำนวณเงินเองที่ Frontend" ของหน้าใหม่ทั้งหน้า
// ดู Report รอบนี้สำหรับรายละเอียดการตัดสินใจ
//
// ที่ย้ายมาจริง (Reuse Logic 100%): ตาราง P&L รายสินทรัพย์ / Export PDF-Excel
// (เพิ่ม Preview ก่อนยืนยัน 1 จังหวะตาม Requirement ใหม่) / ประวัติ+Filter /
// วิธีใช้งาน LINE

const TABS = [
  { id: 'portfolio', label: '💼 พอร์ตของฉัน' },
  { id: 'history', label: '📋 ประวัติรายการ' },
  { id: 'howto', label: '💬 วิธีใช้งาน' },
];

// ── Formatter (Copy ตรงจาก Dashboard.jsx — Presentation ล้วน ไม่ใช่การคำนวณเงิน) ──
function formatNumber(value, maxDecimals = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDecimals }).format(num);
}
function currencyUnit(currency) {
  return currency === 'USD' ? 'USD' : 'บาท';
}
function formatMoneyCur(value, currency, decimals) {
  return `${formatNumber(value, decimals)} ${currencyUnit(currency)}`;
}

// props:
//   portfolio: ผลลัพธ์จาก GET /api/v1/dashboard/portfolio (Shape เดิมของ Dashboard.jsx
//     — ต่างจาก overview.portfolio ของหน้าใหม่ — ใช้เฉพาะในไฟล์นี้เท่านั้น)
//   profitBySymbol: { [symbol]: profit | null } จาก GET /dashboard/profit/:symbol
//   transactions: array จาก GET /dashboard/history?limit=1000
//   loadError: string | null — ถ้าโหลด 3 อย่างข้างต้นไม่สำเร็จ (แยก Error จาก
//     หน้าใหม่หลัก — ไม่บล็อกฟอร์มบันทึก DCA/สถิติด้านบนที่ไม่พึ่งข้อมูลชุดนี้เลย)
//   activeTab / onTabChange: Lift State ขึ้นไปที่ DashboardHome เพื่อให้ Sidebar/
//     Bottom-nav "พอร์ตของฉัน"/"ประวัติรายการ" สลับแท็บ + Scroll มาที่นี่ได้พร้อมกัน
//   isPremiumActive: ใช้ตัดสินว่าจะโชว์ปุ่ม "แนบสลิป" ในตารางประวัติไหม (งานที่ 2.1)
//     — เป็นแค่ UX Gate เท่านั้น Security Boundary จริงอยู่ที่ Backend ซึ่งเช็ค
//     entitlement.isPremiumActive เองอีกชั้นเสมอ (transactions.controller)
function PortfolioDetailSection({ portfolio, profitBySymbol, transactions, loadError, activeTab, onTabChange, onUpgrade, isPremiumActive = false }) {
  const [symbolFilter, setSymbolFilter] = useState('all');

  // Export (Round 8 เดิม) + Preview ก่อนยืนยัน (Requirement ใหม่รอบนี้)
  const [showExport, setShowExport] = useState(false);
  const [exportRange, setExportRange] = useState('month');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  // Export Gate — เมื่อ Backend ตอบ EXPORT_PREMIUM_REQUIRED (403) โชว์ปุ่มลิงก์ไปหน้า
  // อัพเกรด Premium บนเว็บ (/premium) แทนที่จะบอกให้ไปทำใน LINE
  const [exportUpgrade, setExportUpgrade] = useState(false);
  // exportStep: 'choose' (เลือกช่วง+รูปแบบ) → 'preview' (สรุป Read-only ก่อนยืนยัน)
  // ผู้ใช้แก้ไขข้อมูลใน Preview ไม่ได้ (ไม่ใช่ฟอร์ม) กด "← แก้ไข" เพื่อกลับไปเลือกใหม่
  const [exportStep, setExportStep] = useState('choose');
  const [pendingFormat, setPendingFormat] = useState(null);

  // ── ดูรูปสลิปต้นฉบับ (S8) ────────────────────────────────────────────────
  // Bucket เป็น Private → ไม่มี URL ถาวรให้ใส่ใน <a href> ตรงๆ ต้องขอ Signed URL
  // อายุสั้นผ่าน apiGet (ที่แนบ Bearer Token ให้) ตอนผู้ใช้กดดูเท่านั้น แล้วแสดงใน
  // Modal — เลือก Modal แทน window.open เพราะ Popup Blocker มักบล็อกการเปิดแท็บ
  // ใหม่ที่เกิด "หลัง await" (ไม่นับเป็น User Gesture โดยตรงในบางเบราว์เซอร์)
  const [slipUrl, setSlipUrl] = useState(null);
  const [slipLoadingId, setSlipLoadingId] = useState(null);
  const [slipError, setSlipError] = useState(null);

  async function openSlip(txId) {
    setSlipError(null);
    setSlipLoadingId(txId);
    try {
      const { signedUrl } = await apiGet(`/api/v1/dashboard/transactions/${txId}/slip`);
      setSlipUrl(signedUrl);
    } catch (err) {
      setSlipError(
        err.message === 'SLIP_NOT_FOUND' ? 'ไม่พบรูปสลิปของรายการนี้' : 'เปิดรูปสลิปไม่สำเร็จ'
      );
    } finally {
      setSlipLoadingId(null);
    }
  }

  // ── แนบสลิปเข้ารายการที่บันทึกไปแล้ว (งานที่ 2.1) ─────────────────────────
  // เรียก POST /api/v1/transactions/:id/slip ที่ "มีอยู่แล้ว" ตั้งแต่ S8 (Premium Gate +
  // Ownership + บล็อกแถว Reversal + Compensating Delete ครบในตัว) — รอบนี้จึงเป็นงาน
  // ฝั่ง UI ล้วน ไม่แตะ Backend เลยแม้แต่บรรทัดเดียว
  //
  // ⚠️ ไม่แตะพฤติกรรม "ดูสลิป" เดิม (openSlip ด้านบน) — รายการที่มีสลิปอยู่แล้วยังคง
  // แสดงปุ่มดูเหมือนเดิมทุกประการ ปุ่มแนบจะโผล่เฉพาะแถวที่ยังไม่มีสลิปเท่านั้น
  // (Backend เองก็ Reject SLIP_ALREADY_ATTACHED อยู่แล้ว — UI แค่ไม่ล่อให้กด)
  const [attachingId, setAttachingId] = useState(null);
  const [attachError, setAttachError] = useState(null);
  // เก็บ id ที่แนบสำเร็จในรอบนี้ไว้ใน State — transactions เป็น Props ที่ Parent Fetch
  // มาตอนโหลดหน้า การแนบสำเร็จจึงไม่ทำให้ hasSlip ใน Props เปลี่ยนเองจนกว่าจะรีเฟรช
  // (ไม่บังคับ Parent Refetch ทั้งชุด เพราะ /history?limit=1000 หนักเกินไปสำหรับการ
  // อัปเดตแถวเดียว — Optimistic ที่ระดับแถวพอ)
  const [justAttachedIds, setJustAttachedIds] = useState(() => new Set());

  async function handleAttachSlip(txId, file) {
    if (!file) return;
    setAttachError(null);
    setAttachingId(txId);
    try {
      await apiUpload(`/api/v1/transactions/${txId}/slip`, file);
      setJustAttachedIds((prev) => new Set(prev).add(txId));
    } catch (err) {
      setAttachError(`แนบสลิปไม่สำเร็จ: ${slipUploadErrorMessage(err.message)}`);
    } finally {
      setAttachingId(null);
    }
  }

  const excludedCount = useMemo(() => {
    if (!portfolio) return 0;
    return portfolio.holdings.filter((h) => !profitBySymbol[h.symbol]).length;
  }, [portfolio, profitBySymbol]);

  const filteredTransactions = useMemo(() => {
    if (symbolFilter === 'all') return transactions;
    return transactions.filter((tx) => tx.symbol === symbolFilter);
  }, [transactions, symbolFilter]);

  function openExportModal() {
    setExportError(null);
    setExportStep('choose');
    setPendingFormat(null);
    setShowExport(true);
  }

  function closeExportModal() {
    if (exporting) return;
    setShowExport(false);
  }

  // ขั้น 1 → 2: ตรวจช่วงเวลาเหมือนเดิมทุกประการ แล้วแค่ "เปลี่ยนหน้าจอ" เป็น Preview
  // (ยังไม่ยิง Export จริง) — เก็บ format ที่กดไว้รอกดยืนยันในขั้นถัดไป
  function goToPreview(format) {
    setExportError(null);
    if (exportRange === 'custom' && (!exportFrom || !exportTo)) {
      setExportError('กรุณาเลือกวันเริ่มต้นและวันสิ้นสุด');
      return;
    }
    if (exportRange === 'custom' && exportFrom > exportTo) {
      setExportError('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
      return;
    }
    setPendingFormat(format);
    setExportStep('preview');
  }

  // ขั้น 2 (ยืนยันจริง) — เรียก Endpoint เดิมทุกประการ (ไม่แก้ Logic จาก Dashboard.jsx)
  // ต่างแค่ format มาจาก pendingFormat ที่เลือกไว้ตอนขั้น 1 แทนที่จะรับ Param ตรงๆ
  async function confirmExport() {
    const format = pendingFormat;
    setExportError(null);
    setExportUpgrade(false);
    setExporting(true);
    try {
      const params = new URLSearchParams({ format, range: exportRange });
      if (exportRange === 'custom') {
        params.set('from', exportFrom);
        params.set('to', exportTo);
      }

      const { blob, filename } = await apiDownload(`/api/v1/reports/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowExport(false);
    } catch (err) {
      if (err.message === 'EXPORT_PREMIUM_REQUIRED') {
        setExportError('การส่งออกรายงานเป็นฟีเจอร์สำหรับสมาชิก Premium — อัพเกรดเพื่อปลดล็อกการส่งออก PDF/Excel');
        setExportUpgrade(true);
      } else if (err.message === 'EXPORT_INVALID_RANGE') {
        setExportError('ช่วงเวลาที่เลือกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
      } else {
        setExportError('สร้างรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
      // กดยืนยันไม่สำเร็จ — กลับไปหน้าเลือกช่วง/รูปแบบใหม่ (ไม่ค้างที่ Preview เฉยๆ)
      setExportStep('choose');
    } finally {
      setExporting(false);
    }
  }

  const rangeLabel = { month: 'เดือนนี้', year: 'ปีนี้', custom: `กำหนดเอง (${exportFrom} – ${exportTo})` }[
    exportRange
  ];
  const formatLabel = pendingFormat === 'pdf' ? 'PDF' : 'Excel';

  return (
    <section className="dh-card" id="dh-legacy-tabs">
      <div className="dh-card-h">
        <h2>รายละเอียดพอร์ต</h2>
        <div className="dh-sp" />
        <button type="button" className="dh-btn-ghost" onClick={openExportModal} title="ส่งออกรายงาน PDF/Excel">
          📑 Export
        </button>
      </div>

      <div className="dh-legacy-tabnav">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dh-tab${activeTab === t.id ? ' dh-tab-on' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadError ? (
        <p className="dh-empty-msg">{loadError}</p>
      ) : !portfolio ? (
        <p className="dh-empty-msg">กำลังโหลดข้อมูล...</p>
      ) : (
        <div className="dh-legacy-panel">
          {/* ── พอร์ตของฉัน — ตาราง P&L รายสินทรัพย์ (Copy ตรงจาก Dashboard.jsx) ── */}
          {activeTab === 'portfolio' && (
            <>
              {portfolio.isEmpty ? (
                <p className="dh-empty-msg">ยังไม่มีสินทรัพย์ในพอร์ต</p>
              ) : (
                <>
                  <div className="dh-table-wrap">
                    <table className="dh-table">
                      <thead>
                        <tr>
                          <th>สินทรัพย์</th>
                          <th>จำนวนถือ</th>
                          <th>ต้นทุนเฉลี่ย</th>
                          <th>มูลค่าปัจจุบัน</th>
                          <th>กำไร/ขาดทุน</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portfolio.holdings.map((h) => {
                          const profit = profitBySymbol[h.symbol];
                          const isProfit = profit && profit.profitLoss >= 0;
                          return (
                            <tr key={h.symbol}>
                              <td>
                                {h.symbol}
                                {h.currency === 'USD' ? ' (USD)' : ''}
                              </td>
                              <td>{formatNumber(h.heldQuantity, 8)}</td>
                              <td>{h.averageCost === null ? '-' : formatMoneyCur(h.averageCost, h.currency, 8)}</td>
                              <td>{profit ? formatMoneyCur(profit.currentValue, h.currency) : 'ไม่มีราคาตลาด'}</td>
                              <td className={profit ? (isProfit ? 'dh-up' : 'dh-down') : ''}>
                                {profit
                                  ? `${isProfit ? '+' : ''}${formatMoneyCur(profit.profitLoss, h.currency)} (${
                                      isProfit ? '+' : ''
                                    }${formatNumber(profit.profitLossPercent)}%)`
                                  : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {excludedCount > 0 && (
                    <p className="dh-stat-note">
                      * ไม่รวม {excludedCount} สินทรัพย์ที่ยังไม่มีราคาตลาด (เช่น หุ้นไทย) ตัวเลขนี้จึงไม่ใช่ทั้งพอร์ต
                    </p>
                  )}

                  <p className="dh-chart-note">
                    รวมเงินลงทุนทั้งพอร์ต (บาท): {formatNumber(portfolio.investedByCurrency?.THB ?? portfolio.totalInvested)} บาท
                  </p>
                  {(portfolio.investedByCurrency?.USD ?? 0) > 0 && (
                    <p className="dh-chart-note">
                      รวมเงินลงทุนทั้งพอร์ต (USD): {formatNumber(portfolio.investedByCurrency.USD)} USD
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {/* ── ประวัติรายการ — Filter ได้ (Copy ตรงจาก Dashboard.jsx) ──────────── */}
          {activeTab === 'history' && (
            <>
              <div className="dh-history-filter">
                <label htmlFor="dh-symbol-filter">กรองตามสินทรัพย์:</label>
                <select id="dh-symbol-filter" value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)}>
                  <option value="all">ทั้งหมด</option>
                  {portfolio.holdings.map((h) => (
                    <option key={h.symbol} value={h.symbol}>
                      {h.symbol}
                    </option>
                  ))}
                </select>
              </div>

              {/* ผลการแนบสลิป (งานที่ 2.1) — วางเหนือตารางให้เห็นชัด ไม่ซ่อนในแถว */}
              {attachError && <p className="dh-modal-error">{attachError}</p>}

              {filteredTransactions.length === 0 ? (
                <p className="dh-empty-msg">ยังไม่มีประวัติธุรกรรม</p>
              ) : (
                <div className="dh-table-wrap">
                  <table className="dh-table">
                    <thead>
                      <tr>
                        <th>สินทรัพย์</th>
                        <th>ประเภท</th>
                        <th>จำนวนเงิน</th>
                        <th>ราคาต่อหน่วย</th>
                        <th>จำนวน</th>
                        <th>วันที่</th>
                        <th>รายละเอียด</th>
                        <th>สลิป</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{tx.symbol}</td>
                          <td className={tx.type === 'buy' ? 'dh-up' : 'dh-down'}>
                            {tx.type === 'buy' ? 'ซื้อ' : 'ขาย'}
                          </td>
                          <td>{formatMoneyCur(tx.amountThb, tx.currency)}</td>
                          <td>{formatMoneyCur(tx.pricePerUnit, tx.currency, 8)}</td>
                          <td>{formatNumber(tx.quantity, 8)}</td>
                          <td>{tx.date}</td>
                          <td>{formatTransactionNote(tx.note) ?? '-'}</td>
                          {/* สลิป (S8) — รายการที่มีสลิปแล้ว (hasSlip หรือเพิ่งแนบสำเร็จ
                              ในรอบนี้) แสดงปุ่มดูเหมือนเดิมทุกประการ
                              รายการที่ยังไม่มีสลิป: Premium เห็นปุ่ม "แนบสลิป" (งานที่ 2.1)
                              — ผู้ใช้ Free เห็น '-' เหมือนเดิม ไม่ล่อให้กดแล้วโดนปฏิเสธ */}
                          <td>
                            {tx.hasSlip || justAttachedIds.has(tx.id) ? (
                              <button
                                type="button"
                                className="dh-link-btn"
                                onClick={() => openSlip(tx.id)}
                                disabled={slipLoadingId === tx.id}
                              >
                                {slipLoadingId === tx.id ? 'กำลังเปิด…' : '🧾 ดูสลิป'}
                              </button>
                            ) : isPremiumActive && !isReversalNote(tx.note) ? (
                              <label className="dh-slip-attach-cell">
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp,image/gif"
                                  hidden
                                  disabled={attachingId === tx.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] ?? null;
                                    // Reset input ทันที เพื่อให้เลือก "ไฟล์เดิม" ซ้ำได้
                                    // หลังแนบพลาด (onChange ไม่ยิงถ้าค่าเดิมไม่เปลี่ยน)
                                    e.target.value = '';
                                    handleAttachSlip(tx.id, file);
                                  }}
                                />
                                <span className="dh-link-btn">
                                  {attachingId === tx.id ? 'กำลังแนบ…' : '📎 แนบสลิป'}
                                </span>
                              </label>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── วิธีใช้งาน — Static ล้วน (Copy ตรงจาก Dashboard.jsx) ─────────────── */}
          {activeTab === 'howto' && (
            <>
              <h3 className="dh-legacy-subhead">💬 ใช้งานผ่าน LINE ได้เลย</h3>
              <div className="dh-howto-steps">
                <div className="dh-howto-step">
                  <div className="dh-howto-num">1</div>
                  <div>
                    <h4>บันทึกรายการซื้อ/ขาย</h4>
                    <p>ระบุสินทรัพย์ จำนวนหน่วย และราคารวมที่ซื้อ/ขาย</p>
                    <pre className="dh-cmd">
{`ซื้อ BTC 0.01 หุ้น ราคา 3400000
ขาย PTT 50 หุ้น ราคา 34`}
                    </pre>
                  </div>
                </div>
                <div className="dh-howto-step">
                  <div className="dh-howto-num">2</div>
                  <div>
                    <h4>พอต</h4>
                    <p>ดูสรุปพอร์ตทางแชท (มูลค่ารวม เงินต้นรวม)</p>
                    <pre className="dh-cmd">พอต</pre>
                  </div>
                </div>
                <div className="dh-howto-step">
                  <div className="dh-howto-num">3</div>
                  <div>
                    <h4>ประวัติ</h4>
                    <p>ดูประวัติธุรกรรมล่าสุดทางแชท</p>
                    <pre className="dh-cmd">ประวัติ</pre>
                  </div>
                </div>
                <div className="dh-howto-step">
                  <div className="dh-howto-num">4</div>
                  <div>
                    <h4>กำไร &lt;สินทรัพย์&gt;</h4>
                    <p>ดูกำไร/ขาดทุนของสินทรัพย์นั้น</p>
                    <pre className="dh-cmd">กำไร BTC</pre>
                  </div>
                </div>
                <div className="dh-howto-step">
                  <div className="dh-howto-num">5</div>
                  <div>
                    {/* fix/undo-command-aliases: การ์ดยืนยัน/ปุ่มบนเว็บเขียนว่า "ย้อน
                        รายการ" มาตั้งแต่ fix/misleading-messages (d89c2b6) — สอนคำที่
                        ตรงกับที่ระบบพูดเอง คำเดิม "ยกเลิกล่าสุด" ยังใช้ได้จริง (Backward
                        Compat) จึงระบุไว้เป็นทางเลือกคู่กัน ไม่ใช่แทนที่ */}
                    <h4>ย้อนล่าสุด</h4>
                    <p>
                      ย้อนรายการซื้อ-ขายล่าสุดที่เพิ่งบันทึก (พิมพ์ "ยกเลิกล่าสุด" ก็ได้เหมือนกัน)
                    </p>
                    <pre className="dh-cmd">ย้อนล่าสุด</pre>
                  </div>
                </div>
              </div>

              <h3 className="dh-legacy-subhead">🎛️ เมนู Rich Menu ใน LINE</h3>
              <div className="dh-richmenu-grid">
                <div>
                  <div className="dh-richmenu-ico">➕</div>
                  <div className="dh-richmenu-label">เพิ่มรายการ</div>
                  <div className="dh-richmenu-desc">ส่งคำแนะนำวิธีพิมพ์คำสั่งซื้อ/ขาย</div>
                </div>
                <div>
                  <div className="dh-richmenu-ico">📊</div>
                  <div className="dh-richmenu-label">พอร์ต</div>
                  <div className="dh-richmenu-desc">ดูสรุปพอร์ตทันที (เท่ากับพิมพ์ "พอต")</div>
                </div>
                <div>
                  <div className="dh-richmenu-ico">📋</div>
                  <div className="dh-richmenu-label">ประวัติ</div>
                  <div className="dh-richmenu-desc">ดูประวัติธุรกรรมล่าสุดทันที</div>
                </div>
                <div>
                  <div className="dh-richmenu-ico">📈</div>
                  <div className="dh-richmenu-label">Dashboard</div>
                  <div className="dh-richmenu-desc">เปิดหน้าเว็บนี้ (Web Dashboard เต็มรูปแบบ)</div>
                </div>
                <div>
                  <div className="dh-richmenu-ico">⏰</div>
                  <div className="dh-richmenu-label">ตั้งเตือน DCA</div>
                  <div className="dh-richmenu-desc">ตั้งเตือนให้มาพิมพ์คำสั่งซื้อเองตามรอบ (ไม่ซื้ออัตโนมัติ)</div>
                </div>
                <div>
                  <div className="dh-richmenu-ico">👑</div>
                  <div className="dh-richmenu-label">Premium</div>
                  <div className="dh-richmenu-desc">ดู/อัพเกรด หรือต่ออายุสมาชิก Premium</div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Modal Export (Reuse Endpoint เดิม + เพิ่ม Preview ก่อนยืนยัน 1 จังหวะ) ── */}
      {/* ── Modal ดูรูปสลิปต้นฉบับ (S8) ─────────────────────────────────────
          แสดง Signed URL ที่เพิ่งขอมา (อายุ 5 นาที) — ปิด Modal แล้ว State ถูกล้าง
          ทำให้กดดูรอบหน้าได้ URL ใหม่เสมอ ไม่ค้าง URL ที่หมดอายุไว้ */}
      {(slipUrl || slipError) && (
        <div
          className="dh-modal-overlay"
          onClick={() => {
            setSlipUrl(null);
            setSlipError(null);
          }}
        >
          <div className="dh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dh-modal-header">
              <h3>🧾 สลิปต้นฉบับ</h3>
            </div>
            <div className="dh-modal-body">
              {slipError ? (
                <p className="dh-modal-error">{slipError}</p>
              ) : (
                <>
                  <img src={slipUrl} alt="รูปสลิปต้นฉบับของรายการนี้" className="dh-slip-img" />
                  <p className="dh-modal-hint">
                    ลิงก์รูปนี้มีอายุ 5 นาทีเพื่อความปลอดภัย หากหมดอายุให้กด "ดูสลิป" ใหม่อีกครั้ง
                  </p>
                </>
              )}
              <div className="dh-modal-actions">
                <button
                  type="button"
                  className="dh-btn-ghost"
                  onClick={() => {
                    setSlipUrl(null);
                    setSlipError(null);
                  }}
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExport && (
        <div className="dh-modal-overlay" onClick={closeExportModal}>
          <div className="dh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dh-modal-header">
              <h3>📑 ส่งออกรายงาน</h3>
            </div>

            <div className="dh-modal-body">
              {exportStep === 'choose' && (
                <>
                  <p className="dh-form-note" style={{ fontWeight: 700, color: 'var(--ink2)' }}>
                    ช่วงเวลา (ประวัติธุรกรรม)
                  </p>
                  <div className="dh-chips">
                    {[
                      { id: 'month', label: 'เดือนนี้' },
                      { id: 'year', label: 'ปีนี้' },
                      { id: 'custom', label: 'กำหนดเอง' },
                    ].map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`dh-chip${exportRange === r.id ? ' dh-chip-on' : ''}`}
                        onClick={() => setExportRange(r.id)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>

                  {exportRange === 'custom' && (
                    <div className="dh-export-dates">
                      <label>
                        ตั้งแต่
                        <input type="date" className="dh-inp" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
                      </label>
                      <label>
                        ถึง
                        <input type="date" className="dh-inp" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
                      </label>
                    </div>
                  )}

                  <p className="dh-modal-hint">
                    * สรุปพอร์ตปัจจุบันจะแสดงมูลค่า ณ ตอนนี้เสมอ — ช่วงเวลานี้ใช้กรองเฉพาะประวัติธุรกรรม
                  </p>

                  {exportError && (
                    <div className="dh-modal-error">
                      {exportError}
                      {exportUpgrade && onUpgrade && (
                        <div style={{ marginTop: 8 }}>
                          <button type="button" className="dh-btn-main" onClick={onUpgrade}>
                            👑 อัพเกรด Premium
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="dh-form-note" style={{ fontWeight: 700, color: 'var(--ink2)', marginTop: 14 }}>
                    รูปแบบไฟล์
                  </p>
                  <div className="dh-modal-actions">
                    <button type="button" className="dh-btn-ghost" onClick={() => goToPreview('pdf')}>
                      📄 PDF
                    </button>
                    <button type="button" className="dh-btn-ghost" onClick={() => goToPreview('excel')}>
                      📊 Excel
                    </button>
                  </div>
                </>
              )}

              {exportStep === 'preview' && (
                <>
                  {/* Read-only Summary — ผู้ใช้แก้ไขตรงนี้ไม่ได้ (ไม่ใช่ฟอร์ม) กด "← แก้ไข"
                      เพื่อย้อนกลับไปเลือกใหม่แทน (Requirement ใหม่รอบนี้) */}
                  <table className="dh-modal-summary">
                    <tbody>
                      <tr>
                        <td>ช่วงเวลา</td>
                        <td>{rangeLabel}</td>
                      </tr>
                      <tr>
                        <td>รูปแบบไฟล์</td>
                        <td>{formatLabel}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="dh-modal-hint">
                    * สรุปพอร์ตปัจจุบันจะแสดงมูลค่า ณ ตอนนี้เสมอ — ช่วงเวลานี้ใช้กรองเฉพาะประวัติธุรกรรม
                    ตรวจสอบให้แน่ใจก่อนกดยืนยัน
                  </p>
                  {exportError && <p className="dh-modal-error">{exportError}</p>}
                  <div className="dh-modal-actions">
                    <button type="button" className="dh-btn-ghost" onClick={() => setExportStep('choose')} disabled={exporting}>
                      ← แก้ไข
                    </button>
                    <button type="button" className="dh-btn-main" onClick={confirmExport} disabled={exporting}>
                      {exporting ? 'กำลังสร้าง...' : '✅ ยืนยัน Export'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default PortfolioDetailSection;
