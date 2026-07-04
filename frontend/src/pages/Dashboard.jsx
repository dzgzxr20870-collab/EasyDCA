import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { apiGet } from '../lib/api.js';
import './Dashboard.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const TOKEN_KEY = 'easydca_token';

// ชื่อเดือนไทยเต็ม — Pattern เดียวกับ backend/src/utils/thaiDate.util.js
// formatThaiDate (ไม่ import ข้าม Backend/Frontend ได้ จึงเขียน inline ที่นี่)
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
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

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [profitBySymbol, setProfitBySymbol] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [planInfo, setPlanInfo] = useState(null);

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

        const historyData = await apiGet('/api/v1/dashboard/history?limit=100');
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

  const chartData = useMemo(() => {
    if (!portfolio || portfolio.isEmpty) return null;
    return {
      labels: portfolio.holdings.map((h) => h.symbol),
      datasets: [
        {
          label: 'เงินลงทุนสะสม (บาท)',
          data: portfolio.holdings.map((h) => h.totalInvested),
          backgroundColor: '#06c755',
        },
      ],
    };
  }, [portfolio]);

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    navigate('/');
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

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-logo">EasyDCA</div>
        <button type="button" className="dashboard-logout-btn" onClick={handleLogout}>
          ออกจากระบบ
        </button>
      </header>

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

      {chartData && (
        <section className="dashboard-section">
          <h2>เงินลงทุนสะสมแยกตามสินทรัพย์</h2>
          <div className="dashboard-chart">
            <Bar
              data={chartData}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } },
              }}
            />
          </div>
        </section>
      )}

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
  );
}

export default Dashboard;
