import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, apiGet } from '../lib/api.js';
// Reuse Style Pattern เดียวกับ Dashboard ปกติ (การ์ด/ตาราง) — Admin เป็น Internal Tool
// จึงไม่ทำ CSS ใหม่ ใช้คลาส dashboard-* เดิมผ่าน wrapper .dashboard-page
import './Dashboard.css';

// หน้า /admin — Round 4b: Admin Dashboard จริง (Read-only)
// Route Guard 3 ชั้น (คงตาม Round 4a ทุกประการ ห้ามแก้ Logic):
//   1) ยังไม่ Login (ไม่มี Token) → กลับหน้า Login เดิม (/)
//   2) Login แล้วแต่ role !== 'admin' → กลับ Dashboard ปกติ (/dashboard)
//      ไม่ใช่หน้า Error ที่บอกใบ้ว่ามี Route ลับอยู่
//   3) Login แล้วและเป็น Admin → แสดงหน้า Dashboard จริง
//
// role อ่านจาก Endpoint /api/v1/dashboard/me (Backend คืนมาจาก JWT) — ไม่ Decode
// JWT เองฝั่ง Client เพื่อไม่ให้มี Logic ตีความ Token กระจายหลายที่

// สถานะ Payment สำหรับ Dropdown กรอง — value ตรงกับค่าจริงใน DB ('confirmed' =
// อนุมัติแล้ว ไม่มี 'approved') | 'all' = ไม่ส่ง Query Param (คืนทุกสถานะ)
const PAYMENT_STATUS_OPTIONS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'pending', label: 'รอตรวจสอบ' },
  { value: 'confirmed', label: 'อนุมัติแล้ว' },
  { value: 'rejected', label: 'ปฏิเสธ' },
  { value: 'expired', label: 'หมดอายุ' },
];

const STATUS_LABEL = Object.fromEntries(PAYMENT_STATUS_OPTIONS.map((o) => [o.value, o.label]));

function formatBaht(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num.toLocaleString('en-US', { maximumFractionDigits: 2 })} บาท`;
}

// วันที่แบบสั้น (YYYY-MM-DD ตามเขตเวลาไทย) พอสำหรับ Internal Tool — null = '-'
function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function Admin() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loadError, setLoadError] = useState(null);

  // ── Route Guard (เหมือน Round 4a ทุกประการ) ──────────────────────────────
  useEffect(() => {
    // ยังไม่ Login → กลับหน้า Login (replace: ไม่ให้กด Back กลับมาหน้านี้ค้าง)
    if (!getToken()) {
      navigate('/', { replace: true });
      return;
    }

    async function verify() {
      try {
        const me = await apiGet('/api/v1/dashboard/me');
        if (me.role !== 'admin') {
          // ไม่ใช่ Admin → กลับ Dashboard ปกติ
          navigate('/dashboard', { replace: true });
          return;
        }

        setReady(true);
      } catch (err) {
        // apiGet จัดการ 401 (Token หมดอายุ/ไม่ถูกต้อง) ด้วยการ Redirect ไป Login ให้แล้ว
        // Error อื่น (รวม 403 ถ้า role เพี้ยน) → ถือว่าไม่มีสิทธิ์ กลับ Dashboard ปกติ
        navigate('/dashboard', { replace: true });
      }
    }

    verify();
  }, [navigate]);

  // โหลด stats + users ครั้งเดียวหลังผ่าน Guard
  useEffect(() => {
    if (!ready) return;

    async function loadCore() {
      try {
        const [statsData, usersData] = await Promise.all([
          apiGet('/api/v1/admin/stats'),
          apiGet('/api/v1/admin/users'),
        ]);
        setStats(statsData);
        setUsers(usersData.users);
      } catch (err) {
        setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
    }

    loadCore();
  }, [ready]);

  // โหลด Payment ใหม่ทุกครั้งที่เปลี่ยน Filter (และครั้งแรกหลัง ready) — เรียก
  // Endpoint เดิมพร้อม Query Param ?status= ตามที่เลือก
  useEffect(() => {
    if (!ready) return;

    async function loadPayments() {
      try {
        const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
        const data = await apiGet(`/api/v1/admin/payments${query}`);
        setPayments(data.payments);
      } catch (err) {
        setLoadError('โหลดข้อมูลการชำระเงินไม่สำเร็จ');
      }
    }

    loadPayments();
  }, [ready, statusFilter]);

  if (!ready) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-message">กำลังตรวจสอบสิทธิ์...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-logo">EasyDCA · Admin</div>
        <button
          type="button"
          className="dashboard-logout-btn"
          onClick={() => navigate('/dashboard')}
        >
          ← กลับ Dashboard
        </button>
      </header>

      <div className="dashboard-container">
        {loadError && <div className="dashboard-message error">{loadError}</div>}

        {/* การ์ดสรุป 4 ใบ */}
        <div className="dashboard-summary-cards">
          <div className="dashboard-card">
            <div className="dashboard-card-label">User ทั้งหมด</div>
            <div className="dashboard-card-value">{stats ? stats.totalUsers : '–'}</div>
            <div className="dashboard-card-sub">ผู้ใช้ที่ลงทะเบียนทั้งหมด</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-label">Free</div>
            <div className="dashboard-card-value">{stats ? stats.freeUsers : '–'}</div>
            <div className="dashboard-card-sub">ผู้ใช้แผนฟรี</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-label">Premium</div>
            <div className="dashboard-card-value">{stats ? stats.premiumUsers : '–'}</div>
            <div className="dashboard-card-sub">Premium ที่ยัง Active</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-label">รายได้</div>
            <div className="dashboard-card-value gold">
              {stats ? formatBaht(stats.totalRevenue) : '–'}
            </div>
            <div className="dashboard-card-sub">
              เดือนนี้: {stats ? formatBaht(stats.revenueThisMonth) : '–'}
            </div>
          </div>
        </div>

        {/* ตาราง User */}
        <section className="dashboard-section">
          <h2>ผู้ใช้ทั้งหมด ({users.length})</h2>
          {users.length === 0 ? (
            <p className="dashboard-message">ยังไม่มีผู้ใช้</p>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>ชื่อ</th>
                    <th>แพลน</th>
                    <th>วันหมดอายุ</th>
                    <th>จำนวนสินทรัพย์</th>
                    <th>วันที่สมัคร</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.displayName}</td>
                      <td>{u.isPremiumActive ? '👑 Premium' : 'Free'}</td>
                      <td>{u.isPremiumActive ? formatDate(u.planExpiresAt) : '-'}</td>
                      <td>{u.assetCount}</td>
                      <td>{formatDate(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ตาราง Payment + Dropdown กรอง Status */}
        <section className="dashboard-section">
          <h2>การชำระเงิน ({payments.length})</h2>

          <div className="dashboard-filter">
            <label htmlFor="payment-status-filter">กรองตามสถานะ:</label>
            <select
              id="payment-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {PAYMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {payments.length === 0 ? (
            <p className="dashboard-message">ไม่มีรายการชำระเงินตามเงื่อนไขนี้</p>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th>จำนวนเงิน</th>
                    <th>แพลน</th>
                    <th>สถานะ</th>
                    <th>วันที่แจ้ง</th>
                    <th>วันที่อนุมัติ</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.displayName ?? p.userId}</td>
                      <td>{formatBaht(p.amountThb)}</td>
                      <td>{p.billingPeriod === 'yearly' ? 'รายปี' : 'รายเดือน'}</td>
                      <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                      <td>{formatDate(p.createdAt)}</td>
                      <td>{formatDate(p.confirmedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Admin;
