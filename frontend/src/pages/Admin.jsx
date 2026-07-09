import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, apiGet, apiPost } from '../lib/api.js';
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

// ── Broadcast (Round 4c) ────────────────────────────────────────────────
// value ตรงกับที่ Backend รับ (targetGroup/messageType) — Backend Validate ซ้ำอีกชั้น
const BROADCAST_TARGET_OPTIONS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'free', label: 'เฉพาะ Free' },
  { value: 'premium', label: 'เฉพาะ Premium' },
];

const BROADCAST_TYPE_OPTIONS = [
  { value: 'news', label: 'ข่าว' },
  { value: 'system_update', label: 'อัพเดทระบบ' },
  { value: 'promotion', label: 'โปรโมชั่น' },
  { value: 'other', label: 'อื่นๆ' },
];

// ร่าง Template ภาษาไทยสั้นๆ ตามประเภท — เมื่อเลือกประเภทจะใส่ลง Textarea ให้อัตโนมัติ
// (User แก้ไขต่อได้อิสระ) 'other' เว้นว่างให้พิมพ์เอง
const BROADCAST_TEMPLATES = {
  news: '📢 ข่าวสารจาก EasyDCA\n\n[พิมพ์เนื้อหาข่าวที่นี่]',
  system_update: '🔧 อัพเดทระบบ EasyDCA\n\nเราได้ปรับปรุง [ฟีเจอร์] เพื่อให้ใช้งานได้ดียิ่งขึ้น ขอบคุณที่ใช้บริการครับ',
  promotion: '🎉 โปรโมชั่นพิเศษจาก EasyDCA!\n\n[รายละเอียดโปรโมชั่น / โค้ดส่วนลด]',
  other: '',
};

// LINE Text Message จำกัด 5,000 อักขระ (ตรงกับ backend broadcast.service.MAX_MESSAGE_LENGTH)
const MAX_BROADCAST_LENGTH = 5000;

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

  // ── Broadcast State (Round 4c) ───────────────────────────────────────────
  const [bcTarget, setBcTarget] = useState('all');
  const [bcType, setBcType] = useState('news');
  const [bcMessage, setBcMessage] = useState(BROADCAST_TEMPLATES.news);
  const [bcShowPreview, setBcShowPreview] = useState(false);
  const [bcSending, setBcSending] = useState(false);
  const [bcResult, setBcResult] = useState(null);
  const [bcError, setBcError] = useState(null);

  // นับจำนวนผู้รับล่วงหน้าจาก users ที่โหลดมาแล้ว (Round 4b) — ไม่ยิง Request ใหม่
  // ใช้ isPremiumActive ที่ Backend คำนวณมาให้ (ไม่ตัดสิน Premium เองฝั่ง Client)
  function countRecipients(target) {
    return users.filter((u) => {
      if (target === 'premium') return u.isPremiumActive;
      if (target === 'free') return !u.isPremiumActive;
      return true; // 'all'
    }).length;
  }

  // เปลี่ยนประเภทข้อความ → เติม Template ให้อัตโนมัติ (ล้าง Preview/ผลเดิม)
  function handleTypeChange(e) {
    const type = e.target.value;
    setBcType(type);
    setBcMessage(BROADCAST_TEMPLATES[type] ?? '');
    setBcShowPreview(false);
    setBcResult(null);
  }

  // ส่งจริง — เป็นขั้นที่ 2 ของ 2-Step Confirm (ขั้นแรก = ปุ่ม Preview ให้ตรวจข้อความ)
  // ต้องผ่าน window.confirm ที่ระบุจำนวนคนก่อน ถึงจะยิง POST จริง (กันมือลั่น)
  async function handleBroadcastSend() {
    setBcError(null);

    if (bcMessage.trim().length === 0) {
      setBcError('กรุณาพิมพ์ข้อความก่อนส่ง');
      return;
    }
    if (bcMessage.length > MAX_BROADCAST_LENGTH) {
      setBcError(`ข้อความยาวเกิน ${MAX_BROADCAST_LENGTH} อักขระ`);
      return;
    }

    const count = countRecipients(bcTarget);
    const ok = window.confirm(`ยืนยันส่งข้อความหาผู้ใช้ ${count} คน?`);
    if (!ok) return;

    setBcSending(true);
    setBcResult(null);
    try {
      const result = await apiPost('/api/v1/admin/broadcast', {
        targetGroup: bcTarget,
        messageType: bcType,
        message: bcMessage,
      });
      setBcResult(result);
    } catch (err) {
      setBcError(`ส่งไม่สำเร็จ: ${err.message}`);
    } finally {
      setBcSending(false);
    }
  }

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

        {/* Section ประชาสัมพันธ์ / Broadcast (Round 4c) */}
        <section className="dashboard-section">
          <h2>📢 ประชาสัมพันธ์ / Broadcast</h2>

          <div className="dashboard-filter">
            <label htmlFor="bc-target">กลุ่มเป้าหมาย:</label>
            <select
              id="bc-target"
              value={bcTarget}
              onChange={(e) => {
                setBcTarget(e.target.value);
                setBcResult(null);
              }}
            >
              {BROADCAST_TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <label htmlFor="bc-type">ประเภทข้อความ:</label>
            <select id="bc-type" value={bcType} onChange={handleTypeChange}>
              {BROADCAST_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <p className="dashboard-card-sub">
            จะส่งหาผู้ใช้ในกลุ่มนี้ประมาณ <strong>{countRecipients(bcTarget)}</strong> คน
            (นับจากรายชื่อที่โหลดในหน้านี้)
          </p>

          <textarea
            rows={7}
            value={bcMessage}
            onChange={(e) => {
              setBcMessage(e.target.value);
              setBcResult(null);
            }}
            placeholder="พิมพ์ข้อความที่จะส่ง..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '0.75rem',
              fontFamily: 'inherit',
              fontSize: '0.95rem',
              borderRadius: 8,
              resize: 'vertical',
            }}
          />
          <div className="dashboard-card-sub">
            {bcMessage.length} / {MAX_BROADCAST_LENGTH} อักขระ
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="dashboard-chip"
              onClick={() => setBcShowPreview((v) => !v)}
            >
              {bcShowPreview ? 'ซ่อน Preview' : 'Preview'}
            </button>
            <button
              type="button"
              className="dashboard-logout-btn"
              onClick={handleBroadcastSend}
              disabled={bcSending || bcMessage.trim().length === 0}
            >
              {bcSending ? 'กำลังส่ง...' : 'ยืนยันส่ง'}
            </button>
          </div>

          {bcShowPreview && (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="dashboard-card-sub">ตัวอย่างข้อความที่จะส่งจริง:</div>
              <pre className="dashboard-cmd" style={{ whiteSpace: 'pre-wrap' }}>
                {bcMessage}
              </pre>
            </div>
          )}

          {bcError && <p className="dashboard-message error">{bcError}</p>}

          {bcResult && (
            <p className="dashboard-message">
              ✅ ส่งเสร็จแล้ว — ผู้รับทั้งหมด {bcResult.totalRecipients} คน (สำเร็จ{' '}
              {bcResult.successCount} / ล้มเหลว {bcResult.failureCount})
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export default Admin;
