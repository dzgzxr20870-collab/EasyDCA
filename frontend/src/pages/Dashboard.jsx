import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { apiGet, apiDownload } from '../lib/api.js';
import './Dashboard.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend
);

const TOKEN_KEY = 'easydca_token';
const THEME_KEY = 'easydca_theme';

// ชื่อเดือนไทยเต็ม — Pattern เดียวกับ backend/src/utils/thaiDate.util.js
// formatThaiDate (ไม่ import ข้าม Backend/Frontend ได้ จึงเขียน inline ที่นี่)
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// ชื่อเดือนไทยแบบย่อ — ใช้เป็น Label แกน X ของกราฟเท่านั้น (Presentation ล้วน
// ไม่กระทบข้อมูลจริงที่มาจาก API)
const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

// Palette สำหรับ Donut สัดส่วนสินทรัพย์ — วนใช้ตามจำนวน Holding จริง (ไม่ผูกกับ
// สินทรัพย์เฉพาะตัวเหมือน Mockup ที่ Hardcode สี เพราะสินทรัพย์จริงมีได้ไม่จำกัด)
const CHART_PALETTE = ['#06c755', '#38bdf8', '#f5c518', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#eab308'];

const TABS = [
  { id: 'overview', label: '📊 ภาพรวม' },
  { id: 'assets', label: '💼 สินทรัพย์' },
  { id: 'history', label: '📋 ประวัติ' },
  { id: 'how', label: '💬 วิธีใช้งาน' },
];

function formatNumber(value, maxDecimals = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDecimals }).format(num);
}

// จัดรูปวันหมดอายุ Premium เป็นภาษาไทย/พ.ศ. เช่น "4 กรกฎาคม 2569" ตามเขตเวลา
// Asia/Bangkok (คำนวณผ่าน Intl ก่อนบวก 543 กันคลาดวันใกล้เที่ยงคืน UTC)
function formatThaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');

  return `${day} ${THAI_MONTH_NAMES[month - 1]} ${year + 543}`;
}

// ตัวเลขเงินสำหรับการ์ดสรุป — null = ไม่มีข้อมูล Profit เลย (แสดง "ไม่มีข้อมูล")
function formatCardMoney(value) {
  if (value === null) return 'ไม่มีข้อมูล';
  return `${formatNumber(value)} บาท`;
}

// Label แกน X กราฟการเติบโต: "YYYY-MM-DD" (จาก tx.date จริง) → "4 ก.ค." (Presentation ล้วน)
function shortThaiDateLabel(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${day} ${THAI_MONTH_SHORT[month - 1]}`;
}

// Label แกน X กราฟเงินออมรายเดือน: "YYYY-MM" → "ก.ค. 69" (เดือนย่อไทย + ปี พ.ศ. 2 หลัก)
function monthLabelShort(key) {
  const [yearStr, monthStr] = key.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const beYear = (year + 543) % 100;
  return `${THAI_MONTH_SHORT[month - 1]} ${String(beYear).padStart(2, '0')}`;
}

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [profitBySymbol, setProfitBySymbol] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [planInfo, setPlanInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [growthRangeMonths, setGrowthRangeMonths] = useState(3);
  // ใช้ได้ปกติ เพราะเป็น Production Web App จริงที่ผู้ใช้เข้าเว็บผ่าน Browser
  // ไม่ใช่ Sandbox Artifact ของ Claude ที่ห้ามใช้ Browser Storage
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');

  // Export รายงาน (Round 8) — Modal เลือกช่วงเวลา + รูปแบบไฟล์ แล้วดาวน์โหลด Blob
  const [showExport, setShowExport] = useState(false);
  const [exportRange, setExportRange] = useState('month');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    async function load() {
      try {
        // Endpoint แยกต่างหาก + catch เอง — ถ้า /me ล่ม ไม่ให้กระทบการโหลด
        // Portfolio/History เดิม (Fallback เป็น Free assetLimit 2 ตาม Default จริง)
        const planData = await apiGet('/api/v1/dashboard/me').catch(() => ({
          isPremiumActive: false,
          assetLimit: 2,
        }));
        setPlanInfo(planData);

        const portfolioData = await apiGet('/api/v1/dashboard/portfolio');
        setPortfolio(portfolioData);

        // ยิงหา Profit ของทุก Holding พร้อมกัน — Endpoint ไหน Error (เช่นหุ้นไทย
        // ที่ยังไม่มี Price Feed → PRICE_FEED_NOT_IMPLEMENTED) จับไว้เฉยๆ เป็น
        // null ไม่ให้ทั้งหน้าพัง (Pattern เดียวกับ Portfolio Summary Push ทาง LINE)
        const profitEntries = await Promise.all(
          portfolioData.holdings.map((h) =>
            apiGet(`/api/v1/dashboard/profit/${h.symbol}`)
              .then((profit) => [h.symbol, profit])
              .catch(() => [h.symbol, null])
          )
        );
        setProfitBySymbol(Object.fromEntries(profitEntries));

        // limit=1000 (เดิม 100) — พอสำหรับคำนวณกราฟการเติบโตย้อนหลัง 1 ปี
        // โดยไม่ตัดข้อมูลทิ้ง
        const historyData = await apiGet('/api/v1/dashboard/history?limit=1000');
        setTransactions(historyData.transactions);
      } catch (err) {
        setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const excludedCount = useMemo(() => {
    if (!portfolio) return 0;
    return portfolio.holdings.filter((h) => !profitBySymbol[h.symbol]).length;
  }, [portfolio, profitBySymbol]);

  const filteredTransactions = useMemo(() => {
    if (symbolFilter === 'all') return transactions;
    return transactions.filter((tx) => tx.symbol === symbolFilter);
  }, [transactions, symbolFilter]);

  // มูลค่าพอตรวม + กำไร/ขาดทุนรวม — รวมเฉพาะ Holding ที่มีข้อมูล Profit จริง
  // (Pattern เดียวกับ excludedCount) null ทั้งคู่ถ้าไม่มี Holding ไหนมีข้อมูลเลย
  const aggregatedProfit = useMemo(() => {
    if (!portfolio || portfolio.isEmpty) return { currentValue: null, profitLoss: null };

    let currentValue = 0;
    let profitLoss = 0;
    let hasAny = false;

    portfolio.holdings.forEach((h) => {
      const profit = profitBySymbol[h.symbol];
      if (profit) {
        currentValue += profit.currentValue;
        profitLoss += profit.profitLoss;
        hasAny = true;
      }
    });

    return hasAny ? { currentValue, profitLoss } : { currentValue: null, profitLoss: null };
  }, [portfolio, profitBySymbol]);

  // ออมเดือนนี้ = ผลรวม amountThb ของธุรกรรม buy ที่ date อยู่ในเดือนปฏิทิน
  // ปัจจุบันจริงของ Browser (เทียบ String ตรงๆ ตาม Requirement)
  const currentMonthSavings = useMemo(() => {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return transactions
      .filter((tx) => tx.type === 'buy' && tx.date.startsWith(monthPrefix))
      .reduce((sum, tx) => sum + tx.amountThb, 0);
  }, [transactions]);

  // กราฟการเติบโต — เส้นเดียว "เงินต้นสะสม" คำนวณ Cumulative Sum จากธุรกรรมจริง
  // ทั้งหมดก่อน (บวก buy / ลบ sell) แล้วค่อย Filter ช่วงที่แสดง เพื่อให้จุดเริ่มต้น
  // กราฟถูกต้อง ไม่เริ่มจาก 0 ถ้ามีประวัติเก่ากว่าช่วงที่เลือก
  const growthChartData = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;

    const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let running = 0;
    const cumulativePoints = sorted.map((tx) => {
      running += tx.type === 'buy' ? tx.amountThb : -tx.amountThb;
      return { date: tx.date, cumulative: running };
    });

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - growthRangeMonths);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(
      cutoff.getDate()
    ).padStart(2, '0')}`;

    const pointsInRange = cumulativePoints.filter((p) => p.date >= cutoffStr);
    if (pointsInRange.length === 0) return null;

    return {
      labels: pointsInRange.map((p) => shortThaiDateLabel(p.date)),
      datasets: [
        {
          label: 'เงินต้นสะสม',
          data: pointsInRange.map((p) => p.cumulative),
          borderColor: '#06c755',
          backgroundColor: 'rgba(6, 199, 85, 0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    };
  }, [transactions, growthRangeMonths]);

  // Donut สัดส่วนสินทรัพย์ — ข้อมูล = totalInvested ตรงๆ ตาม Requirement (ไม่ใช่
  // currentValue เพราะไม่ต้องพึ่งข้อมูล Profit ที่อาจไม่มีสำหรับบาง Holding)
  const donutChartData = useMemo(() => {
    if (!portfolio || portfolio.isEmpty) return null;
    return {
      labels: portfolio.holdings.map((h) => h.symbol),
      datasets: [
        {
          data: portfolio.holdings.map((h) => h.totalInvested),
          backgroundColor: portfolio.holdings.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    };
  }, [portfolio]);

  // Bar เงินออมรายเดือน — 6 เดือนปฏิทินล่าสุด (รวมเดือนปัจจุบัน) เดือนที่ไม่มี
  // ธุรกรรมเป็น 0 (ไม่ข้าม เพื่อให้กราฟต่อเนื่อง)
  const monthlySavingsChartData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const sumsByMonth = Object.fromEntries(months.map((m) => [m, 0]));
    transactions.forEach((tx) => {
      if (tx.type !== 'buy') return;
      const key = tx.date.slice(0, 7);
      if (key in sumsByMonth) sumsByMonth[key] += tx.amountThb;
    });

    return {
      labels: months.map(monthLabelShort),
      datasets: [
        {
          label: 'เงินออม (บาท)',
          data: months.map((m) => sumsByMonth[m]),
          backgroundColor: '#06c755',
          borderRadius: 6,
        },
      ],
    };
  }, [transactions]);

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    navigate('/');
  }

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  // สร้างรายงานตามช่วง/รูปแบบที่เลือก → รับ Blob → Trigger ดาวน์โหลดด้วย <a> ชั่วคราว
  // format = 'pdf' | 'excel' (ปุ่มส่งค่ามาตรงๆ) — Backend เช็ค Premium เอง (403 ถ้าไม่ใช่)
  async function handleExport(format) {
    setExportError(null);

    if (exportRange === 'custom' && (!exportFrom || !exportTo)) {
      setExportError('กรุณาเลือกวันเริ่มต้นและวันสิ้นสุด');
      return;
    }
    if (exportRange === 'custom' && exportFrom > exportTo) {
      setExportError('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
      return;
    }

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
        setExportError('การส่งออกรายงานเป็นฟีเจอร์สำหรับสมาชิก Premium — กรุณาอัพเกรดผ่านเมนู Premium ใน LINE');
      } else if (err.message === 'EXPORT_INVALID_RANGE') {
        setExportError('ช่วงเวลาที่เลือกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
      } else {
        setExportError('สร้างรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-message">กำลังโหลดข้อมูล...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-message error">{loadError}</div>
      </div>
    );
  }

  const plClass =
    aggregatedProfit.profitLoss === null ? '' : aggregatedProfit.profitLoss >= 0 ? 'pos' : 'neg';

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-logo">EasyDCA</div>
        <div className="dashboard-header-actions">
          <button
            type="button"
            className="dashboard-export-btn"
            onClick={() => {
              setExportError(null);
              setShowExport(true);
            }}
            title="ส่งออกรายงาน PDF/Excel"
          >
            📑 Export
          </button>
          <button
            type="button"
            className="dashboard-theme-btn"
            onClick={toggleTheme}
            title="สลับธีม"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button type="button" className="dashboard-logout-btn" onClick={handleLogout}>
            ออกจากระบบ
          </button>
        </div>
      </header>

      <div className="dashboard-container">
        {/* Banner Free/Premium — แสดงเหนือแท็บทั้งหมดเสมอ ไม่ว่าจะสลับไปแท็บไหน */}
        {planInfo && (
          <section className={`dashboard-plan-banner ${planInfo.isPremiumActive ? 'premium' : 'free'}`}>
            {planInfo.isPremiumActive ? (
              <p>👑 คุณเป็นสมาชิก Premium (หมดอายุ {formatThaiDate(planInfo.planExpiresAt)})</p>
            ) : (
              <p>
                คุณใช้แผน Free (จำกัด {planInfo.assetLimit} สินทรัพย์) — อัพเกรดเป็น Premium
                เพื่อไม่จำกัดจำนวนสินทรัพย์
              </p>
            )}
          </section>
        )}

        <nav className="dashboard-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`dashboard-tab${activeTab === t.id ? ' on' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* ── แท็บ ภาพรวม (Overview) ──────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="dashboard-tab-panel">
            <div className="dashboard-summary-cards">
              <div className="dashboard-card">
                <div className="dashboard-card-label">มูลค่าพอตรวม</div>
                <div className="dashboard-card-value">
                  {portfolio.isEmpty ? '–' : formatCardMoney(aggregatedProfit.currentValue)}
                </div>
                <div className="dashboard-card-sub">เฉพาะสินทรัพย์ที่มีราคาตลาด</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-card-label">เงินต้นรวม</div>
                <div className="dashboard-card-value">
                  {portfolio.isEmpty ? '–' : formatCardMoney(portfolio.totalInvested)}
                </div>
                <div className="dashboard-card-sub">ลงทุนสะสมทั้งพอร์ต</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-card-label">กำไร / ขาดทุน</div>
                <div className={`dashboard-card-value ${portfolio.isEmpty ? '' : plClass}`}>
                  {portfolio.isEmpty ? '–' : formatCardMoney(aggregatedProfit.profitLoss)}
                </div>
                <div className="dashboard-card-sub">รวมเฉพาะสินทรัพย์ที่มีราคาตลาด</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-card-label">ออมเดือนนี้</div>
                <div className="dashboard-card-value gold">
                  {portfolio.isEmpty ? '–' : formatCardMoney(currentMonthSavings)}
                </div>
                <div className="dashboard-card-sub">ยอดซื้อสะสมเดือนปัจจุบัน</div>
              </div>
            </div>

            <section className="dashboard-box">
              <div className="dashboard-box-header">
                <h3>📈 การเติบโตของพอร์ต (เงินต้นสะสม)</h3>
                <div className="dashboard-chip-group">
                  {[3, 6, 12].map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`dashboard-chip${growthRangeMonths === m ? ' on' : ''}`}
                      onClick={() => setGrowthRangeMonths(m)}
                    >
                      {m} เดือน
                    </button>
                  ))}
                </div>
              </div>

              {growthChartData ? (
                <div className="dashboard-chart">
                  <Line
                    data={growthChartData}
                    options={{
                      responsive: true,
                      plugins: { legend: { display: false } },
                      scales: { y: { beginAtZero: true } },
                    }}
                  />
                </div>
              ) : (
                <p className="dashboard-message">ยังไม่มีประวัติธุรกรรมในช่วงเวลานี้</p>
              )}

              <p className="dashboard-hint">
                * เส้นมูลค่าพอตตามราคาตลาดย้อนหลัง จะเปิดให้ใช้งานเร็วๆ นี้
              </p>
            </section>

            <div className="dashboard-grid-2">
              <section className="dashboard-box">
                <h3>🥧 สัดส่วนสินทรัพย์</h3>
                {donutChartData ? (
                  <div className="dashboard-donut-wrap">
                    <Doughnut
                      data={donutChartData}
                      options={{ cutout: '66%', plugins: { legend: { position: 'bottom' } } }}
                    />
                  </div>
                ) : (
                  <p className="dashboard-message">ยังไม่มีสินทรัพย์ในพอร์ต</p>
                )}
              </section>

              <section className="dashboard-box">
                <h3>📅 เงินออมรายเดือน (6 เดือนล่าสุด)</h3>
                <div className="dashboard-chart">
                  <Bar
                    data={monthlySavingsChartData}
                    options={{
                      responsive: true,
                      plugins: { legend: { display: false } },
                      scales: { y: { beginAtZero: true } },
                    }}
                  />
                </div>
              </section>
            </div>
          </div>
        )}

        {/* ── แท็บ สินทรัพย์ — ตารางภาพรวมพอร์ตเดิม Copy มาตรงๆ ไม่แก้ Logic ──── */}
        {activeTab === 'assets' && (
          <div className="dashboard-tab-panel">
            <section className="dashboard-section">
              <h2>ภาพรวมพอร์ต</h2>

              {portfolio.isEmpty ? (
                <p className="dashboard-message">ยังไม่มีสินทรัพย์ในพอร์ต</p>
              ) : (
                <>
                  <div className="dashboard-table-wrap">
                    <table className="dashboard-table">
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
                              <td>{h.symbol}</td>
                              <td>{formatNumber(h.heldQuantity, 8)}</td>
                              <td>{h.averageCost === null ? '-' : `${formatNumber(h.averageCost, 8)} บาท`}</td>
                              <td>{profit ? `${formatNumber(profit.currentValue)} บาท` : 'ไม่มีราคาตลาด'}</td>
                              <td className={profit ? (isProfit ? 'profit-positive' : 'profit-negative') : ''}>
                                {profit
                                  ? `${isProfit ? '+' : ''}${formatNumber(profit.profitLoss)} บาท (${
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
                    <p className="dashboard-warning">
                      * ไม่รวม {excludedCount} สินทรัพย์ที่ยังไม่มีราคาตลาด (เช่น หุ้นไทย)
                      ตัวเลขนี้จึงไม่ใช่ทั้งพอร์ต
                    </p>
                  )}

                  <p className="dashboard-total">
                    รวมเงินลงทุนทั้งพอร์ต: {formatNumber(portfolio.totalInvested)} บาท
                  </p>
                </>
              )}
            </section>
          </div>
        )}

        {/* ── แท็บ ประวัติ — Section ประวัติธุรกรรมเดิม Copy มาตรงๆ ไม่แก้ Logic ── */}
        {activeTab === 'history' && (
          <div className="dashboard-tab-panel">
            <section className="dashboard-section">
              <h2>ประวัติธุรกรรม</h2>

              <div className="dashboard-filter">
                <label htmlFor="symbol-filter">กรองตามสินทรัพย์:</label>
                <select
                  id="symbol-filter"
                  value={symbolFilter}
                  onChange={(e) => setSymbolFilter(e.target.value)}
                >
                  <option value="all">ทั้งหมด</option>
                  {portfolio.holdings.map((h) => (
                    <option key={h.symbol} value={h.symbol}>
                      {h.symbol}
                    </option>
                  ))}
                </select>
              </div>

              {filteredTransactions.length === 0 ? (
                <p className="dashboard-message">ยังไม่มีประวัติธุรกรรม</p>
              ) : (
                <div className="dashboard-table-wrap">
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th>สินทรัพย์</th>
                        <th>ประเภท</th>
                        <th>จำนวนเงิน</th>
                        <th>ราคาต่อหน่วย</th>
                        <th>จำนวน</th>
                        <th>วันที่</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{tx.symbol}</td>
                          <td className={tx.type === 'buy' ? 'profit-positive' : 'profit-negative'}>
                            {tx.type === 'buy' ? 'ซื้อ' : 'ขาย'}
                          </td>
                          <td>{formatNumber(tx.amountThb)} บาท</td>
                          <td>{formatNumber(tx.pricePerUnit, 8)} บาท</td>
                          <td>{formatNumber(tx.quantity, 8)}</td>
                          <td>{tx.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── แท็บ วิธีใช้งาน — Static ล้วน ไม่มี API Call ─────────────────────── */}
        {activeTab === 'how' && (
          <div className="dashboard-tab-panel">
            <section className="dashboard-section">
              <h2>💬 ใช้งานผ่าน LINE ได้เลย</h2>

              <div className="dashboard-howto-steps">
                <div className="dashboard-howto-step">
                  <div className="dashboard-howto-num">1</div>
                  <div>
                    <h3>บันทึกรายการซื้อ/ขาย</h3>
                    <p>ระบุสินทรัพย์ จำนวนหน่วย และราคารวมที่ซื้อ/ขาย</p>
                    <pre className="dashboard-cmd">
{`ซื้อ BTC 0.01 หุ้น ราคา 3400000
ขาย PTT 50 หุ้น ราคา 34`}
                    </pre>
                  </div>
                </div>

                <div className="dashboard-howto-step">
                  <div className="dashboard-howto-num">2</div>
                  <div>
                    <h3>พอต</h3>
                    <p>ดูสรุปพอร์ตทางแชท (มูลค่ารวม เงินต้นรวม)</p>
                    <pre className="dashboard-cmd">พอต</pre>
                  </div>
                </div>

                <div className="dashboard-howto-step">
                  <div className="dashboard-howto-num">3</div>
                  <div>
                    <h3>ประวัติ</h3>
                    <p>ดูประวัติธุรกรรมล่าสุดทางแชท</p>
                    <pre className="dashboard-cmd">ประวัติ</pre>
                  </div>
                </div>

                <div className="dashboard-howto-step">
                  <div className="dashboard-howto-num">4</div>
                  <div>
                    <h3>กำไร &lt;สินทรัพย์&gt;</h3>
                    <p>ดูกำไร/ขาดทุนของสินทรัพย์นั้น</p>
                    <pre className="dashboard-cmd">กำไร BTC</pre>
                  </div>
                </div>

                <div className="dashboard-howto-step">
                  <div className="dashboard-howto-num">5</div>
                  <div>
                    <h3>ยกเลิกล่าสุด</h3>
                    <p>ยกเลิก/ย้อนรายการซื้อ-ขายล่าสุดที่เพิ่งบันทึก</p>
                    <pre className="dashboard-cmd">ยกเลิกล่าสุด</pre>
                  </div>
                </div>
              </div>
            </section>

            <section className="dashboard-section">
              <h2>🎛️ เมนู Rich Menu ใน LINE</h2>
              <div className="dashboard-richmenu-grid">
                <div>
                  <div className="dashboard-richmenu-ico">➕</div>
                  <div className="dashboard-richmenu-label">เพิ่มรายการ</div>
                  <div className="dashboard-richmenu-desc">ส่งคำแนะนำวิธีพิมพ์คำสั่งซื้อ/ขาย</div>
                </div>
                <div>
                  <div className="dashboard-richmenu-ico">📊</div>
                  <div className="dashboard-richmenu-label">พอร์ต</div>
                  <div className="dashboard-richmenu-desc">ดูสรุปพอร์ตทันที (เท่ากับพิมพ์ "พอต")</div>
                </div>
                <div>
                  <div className="dashboard-richmenu-ico">📋</div>
                  <div className="dashboard-richmenu-label">ประวัติ</div>
                  <div className="dashboard-richmenu-desc">ดูประวัติธุรกรรมล่าสุดทันที</div>
                </div>
                <div>
                  <div className="dashboard-richmenu-ico">📈</div>
                  <div className="dashboard-richmenu-label">Dashboard</div>
                  <div className="dashboard-richmenu-desc">เปิดหน้าเว็บนี้ (Web Dashboard เต็มรูปแบบ)</div>
                </div>
                <div>
                  <div className="dashboard-richmenu-ico">⏰</div>
                  <div className="dashboard-richmenu-label">ตั้งเตือน DCA</div>
                  <div className="dashboard-richmenu-desc">
                    ตั้งเตือนให้มาพิมพ์คำสั่งซื้อเองตามรอบ (ไม่ซื้ออัตโนมัติ)
                  </div>
                </div>
                <div>
                  <div className="dashboard-richmenu-ico">👑</div>
                  <div className="dashboard-richmenu-label">Premium</div>
                  <div className="dashboard-richmenu-desc">ดู/อัพเกรด หรือต่ออายุสมาชิก Premium</div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ── Modal Export รายงาน (Round 8) ──────────────────────────────────── */}
      {showExport && (
        <div className="dashboard-modal-overlay" onClick={() => !exporting && setShowExport(false)}>
          <div className="dashboard-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dashboard-modal-header">
              <h3>📑 ส่งออกรายงาน</h3>
              <button
                type="button"
                className="dashboard-modal-close"
                onClick={() => setShowExport(false)}
                disabled={exporting}
              >
                ✕
              </button>
            </div>

            <div className="dashboard-modal-body">
              <p className="dashboard-modal-label">ช่วงเวลา (ประวัติธุรกรรม)</p>
              <div className="dashboard-chip-group">
                {[
                  { id: 'month', label: 'เดือนนี้' },
                  { id: 'year', label: 'ปีนี้' },
                  { id: 'custom', label: 'กำหนดเอง' },
                ].map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`dashboard-chip${exportRange === r.id ? ' on' : ''}`}
                    onClick={() => setExportRange(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {exportRange === 'custom' && (
                <div className="dashboard-modal-dates">
                  <label>
                    ตั้งแต่
                    <input
                      type="date"
                      value={exportFrom}
                      onChange={(e) => setExportFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    ถึง
                    <input
                      type="date"
                      value={exportTo}
                      onChange={(e) => setExportTo(e.target.value)}
                    />
                  </label>
                </div>
              )}

              <p className="dashboard-modal-hint">
                * สรุปพอร์ตปัจจุบันจะแสดงมูลค่า ณ ตอนนี้เสมอ — ช่วงเวลานี้ใช้กรองเฉพาะประวัติธุรกรรม
              </p>

              {exportError && <p className="dashboard-modal-error">{exportError}</p>}

              <p className="dashboard-modal-label">รูปแบบไฟล์</p>
              <div className="dashboard-modal-formats">
                <button
                  type="button"
                  className="dashboard-format-btn pdf"
                  onClick={() => handleExport('pdf')}
                  disabled={exporting}
                >
                  {exporting ? 'กำลังสร้าง...' : '📄 ดาวน์โหลด PDF'}
                </button>
                <button
                  type="button"
                  className="dashboard-format-btn excel"
                  onClick={() => handleExport('excel')}
                  disabled={exporting}
                >
                  {exporting ? 'กำลังสร้าง...' : '📊 ดาวน์โหลด Excel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
