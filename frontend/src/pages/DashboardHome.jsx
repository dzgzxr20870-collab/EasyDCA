import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getToken, apiGet, apiPost, clearToken } from '../lib/api.js';
import { getAssetSymbols } from '../lib/symbolsCache.js';
import { undoErrorMessage } from '../lib/dcaErrors.js';
import DcaForm from '../components/dashboard/DcaForm.jsx';
import StatCards from '../components/dashboard/StatCards.jsx';
import AllocationCard from '../components/dashboard/AllocationCard.jsx';
import RecentList from '../components/dashboard/RecentList.jsx';
import InvestedChart from '../components/dashboard/InvestedChart.jsx';
import SidePanels from '../components/dashboard/SidePanels.jsx';
import UndoConfirmModal from '../components/dashboard/UndoConfirmModal.jsx';
import './DashboardHome.css';

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// วันที่วันนี้แบบเต็ม (Presentation ล้วน) — "17 กรกฎาคม 2569" ตามเวลาไทย
function todayLabel() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return `${get('day')} ${THAI_MONTHS_FULL[get('month') - 1]} ${get('year') + 543}`;
}

// ═══════════════════════════════════════════════════════════════════════
// DashboardHome — หน้า Dashboard ใหม่ (S8 R1b) — Route หลักที่ /dashboard
// ═══════════════════════════════════════════════════════════════════════
// หลักการเดียวของหน้านี้: ไม่คำนวณเงินเองแม้แต่บรรทัดเดียว — ทุกตัวเลขมาจาก
// GET /api/v1/dashboard/overview (API.md §15.4) โดยตรง หน้าที่ของหน้านี้คือ
// "ประกอบร่าง" (Fetch + Layout + Refetch หลัง Mutation) เท่านั้น
//
// Route Guard: Pattern เดียวกับ frontend/src/pages/Admin.jsx (ไม่แก้ Logic เดิม
// ที่นั่น) — ไม่มี Token → เด้งกลับ Login ทันที ห้าม window.location (Full Reload
// จะทำให้ JWT ใน Memory หาย — SECURITY.md § 1.1)
function DashboardHome() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [overview, setOverview] = useState(null);
  const [symbols, setSymbols] = useState([]);
  // role มาจาก GET /api/v1/dashboard/me เท่านั้น — ตรวจสอบแล้วว่า overview
  // (API.md §15.4 / backend/src/services/dashboardOverview.service.js) ไม่มี
  // Field role ติดมาเลย (role มาจาก JWT req.user.role ที่ Backend แนบไว้เฉพาะ
  // getMe — dashboard.controller.js บรรทัด ~113-115) จึงต้อง Fetch แยกอีก Endpoint
  // เข้า Promise.all เดียวกับ symbols/overview ไม่ยิงซ้ำสองรอบ
  const [planInfo, setPlanInfo] = useState(null);
  const [undoTarget, setUndoTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [pickerOpenSignal, setPickerOpenSignal] = useState(0);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const refetchOverview = useCallback(async () => {
    const data = await apiGet('/api/v1/dashboard/overview');
    setOverview(data);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      navigate('/', { replace: true });
      return;
    }

    async function load() {
      try {
        const [symbolsData, overviewData, meData] = await Promise.all([
          getAssetSymbols(),
          apiGet('/api/v1/dashboard/overview'),
          // Endpoint แยก + catch เอง (Pattern เดียวกับ Dashboard.jsx เดิม) — ถ้า /me
          // ล่ม ไม่ให้กระทบการโหลดหน้าหลัก (Fallback role=undefined = ไม่ใช่ Admin
          // ตาม Fail-safe เดิม ไม่ใช่การเดาสิทธิ์)
          apiGet('/api/v1/dashboard/me').catch(() => ({ role: undefined })),
        ]);
        setSymbols(symbolsData);
        setOverview(overviewData);
        setPlanInfo(meData);
        setReady(true);
      } catch (err) {
        setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
    }

    load();

    return () => clearTimeout(toastTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  function handleRecorded() {
    showToast('✅ บันทึกสำเร็จ');
    refetchOverview();
  }

  async function handleConfirmUndo() {
    try {
      const response = await apiPost('/api/v1/transactions/undo-last', {});
      setUndoTarget(null);
      showToast(response.message ?? 'ยกเลิกรายการเรียบร้อยแล้ว');
      await refetchOverview();
    } catch (err) {
      throw new Error(undoErrorMessage(err.message));
    }
  }

  function handleBottomNavRecordClick(e) {
    e.preventDefault();
    document.getElementById('dh-dca')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => setPickerOpenSignal((s) => s + 1), 420);
  }

  if (loadError) {
    return (
      <div className="dh-app">
        <div className="dh-load-error">{loadError}</div>
      </div>
    );
  }

  if (!ready || !overview) {
    return (
      <div className="dh-app">
        <div className="dh-load-error">กำลังโหลดข้อมูล...</div>
      </div>
    );
  }

  // Flatten allocation[].assets → Map<symbol,type> สำหรับให้ RecentList เลือกสี Avatar
  // ตรงกับประเภทจริง (recent[] ของ overview ไม่มี Field type ติดมาเอง)
  const assetTypeBySymbol = new Map();
  for (const group of overview.allocation) {
    for (const asset of group.assets) {
      assetTypeBySymbol.set(asset.symbol, group.type);
    }
  }

  return (
    <div className="dh-app">
      <div className="dh-shell">
        {/* ════ SIDEBAR (ซ่อนที่ ≤820px) ════ */}
        <aside className="dh-sidebar">
          <div className="dh-side-card">
            <div className="dh-brand">
              <div className="dh-brand-logo">🌱</div>
              <div>
                <b>EasyDCA</b>
                <small>by JaydeX · Investment Companion</small>
              </div>
            </div>
            <nav>
              {/* P0: เดิมใช้ <a href> ธรรมดา → Full Page Reload → JWT ใน Memory หาย
                  (SECURITY.md § 1.1) → Auth Guard เด้งไป Login → LIFF Auto-login คืน
                  Session → navigate('/dashboard') ค่า Default เสมอ → ผู้ใช้เห็นเป็น
                  "กดเมนูอื่นแล้ววนกลับ /dashboard" (Root Cause ยืนยันจาก Railway Log:
                  GET /dashboard/classic ตามด้วย GET / ภายใน 1 วินาที) — เปลี่ยนทุกจุด
                  ที่นำทางข้ามหน้าเป็น <Link to> (Client-side Route, ไม่ Reload)
                  Pattern เดียวกับที่เคยแก้บั๊กนี้ให้ปุ่ม Admin ใน Dashboard.jsx มาก่อน */}
              <Link className="dh-nav-item dh-nav-active" to="/dashboard">
                <span className="dh-ic">🏠</span> แดชบอร์ด
              </Link>
              {/* พอร์ตของฉัน/ประวัติรายการ: Mockup ระบุเป็น Phase A2 (หน้าใหม่ที่ยังไม่
                  ออกแบบ) — เชื่อมไปหน้า Dashboard เดิม (/dashboard/classic) เป็นทางเชื่อม
                  ชั่วคราวก่อนมี Phase A2 จริง แทนที่จะเป็น Dead Link "#" (ดู Report) */}
              <Link className="dh-nav-item" to="/dashboard/classic" title="รายละเอียดเต็มรูปแบบ (มุมมองเดิม)">
                <span className="dh-ic">💼</span> พอร์ตของฉัน
              </Link>
              <Link className="dh-nav-item" to="/dashboard/classic" title="รายละเอียดเต็มรูปแบบ (มุมมองเดิม)">
                <span className="dh-ic">🕐</span> ประวัติรายการ
              </Link>
              {/* Anchor ภายในหน้าเดียวกัน (ไม่ใช่นำทางข้ามหน้า) — ไม่ใช้ Link. แก้ id
                  ที่ผูกผิดจาก "#dca" เป็น "#dh-dca" ให้ตรงกับ id จริงของ Section DCA
                  ด้านล่าง (พบระหว่างไล่เช็คจุดนี้ — Element ไม่มี id="dca" อยู่จริง) */}
              <a className="dh-nav-item dh-nav-disabled" href="#dh-dca" title="ตั้งเตือน DCA ผ่าน LINE ได้แล้ววันนี้">
                <span className="dh-ic">🔔</span> ตั้งเตือน DCA
              </a>
              <div className="dh-nav-sep" />
              <Link className="dh-nav-item" to="/dashboard/classic">
                <span className="dh-ic">👤</span> โปรไฟล์ / Premium
              </Link>
              {/* เฉพาะ Admin (role มาจาก GET /dashboard/me — Fetch ไว้แล้วตอน load())
                  — ใช้ onClick={() => navigate('/admin')} ตรงตาม Pattern เดิมของ
                  Dashboard.jsx (บรรทัด 393-405 ที่นั่น) ไม่ใช้ <Link> แม้จุดอื่นในไฟล์
                  นี้เปลี่ยนเป็น Link ไปแล้ว (P0 รอบก่อน) — ตามคำสั่งชัดเจนของรอบนี้
                  ให้ทำตาม Dashboard.jsx เป๊ะ (ดู Report: คอมเมนต์ต้นฉบับอธิบายแค่เรื่อง
                  ห้าม window.location/Full Reload ซึ่ง Link ก็ไม่ทำแบบนั้นเหมือนกัน —
                  ไม่มีเหตุผลทางเทคนิคที่ต่างจาก Link จริงๆ แต่ทำตามคำสั่งเพื่อความ
                  สอดคล้องกับพฤติกรรมเดิมที่มีอยู่แล้ว) */}
              {planInfo?.role === 'admin' && (
                <button type="button" className="dh-nav-item dh-nav-btn" onClick={() => navigate('/admin')}>
                  <span className="dh-ic">🛠️</span> Admin
                </button>
              )}
              <button type="button" className="dh-nav-item dh-nav-btn" onClick={handleLogout}>
                <span className="dh-ic">🚪</span> ออกจากระบบ
              </button>
            </nav>
            {/* Streak: "🔥 ต่อเนื่อง N เดือน" เท่านั้น — ไม่มี Level/XP/Progress Bar
                (ผู้ใช้สั่งตัดแล้ว — ดู Report) ใช้ค่า streakMonths เดียวกับการ์ดสถิติ
                ไม่มีความหมายซ้ำซ้อนกันคนละที่ */}
            <div className="dh-garden">
              {overview.streakMonths > 0 ? (
                <p>🔥 ต่อเนื่อง {overview.streakMonths} เดือน — วินัยการ DCA ของคุณ</p>
              ) : (
                <p>เริ่มต้น DCA เดือนแรกของคุณวันนี้</p>
              )}
            </div>
          </div>
        </aside>

        {/* ════ MAIN ════ */}
        <main className="dh-main">
          <div className="dh-m-brand">
            <div className="dh-brand-logo">🌱</div>
            <div>
              <b>EasyDCA</b>
              <small>by JaydeX</small>
            </div>
            <div className="dh-sp" />
          </div>

          <div className="dh-topbar">
            <div className="dh-hello">
              <h1>
                สวัสดีครับ <span className="dh-leaf">🌱</span>
              </h1>
              <p>การลงทุนที่ดี เริ่มจากวินัยที่สม่ำเสมอ</p>
            </div>
            <div className="dh-sp" />
            <button type="button" className="dh-chip-btn">
              📅 {todayLabel()}
            </button>
          </div>

          {/* Multi-Currency (Round 10): มี USD ในพอร์ตแต่ backend ดึงอัตราแลกเปลี่ยน
              ไม่สำเร็จ (overview.fxUnavailableForUsd) — ยอดรวม/Allocation ด้านล่าง
              "ไม่รวม" ส่วน USD ในการแปลงเทียบบาท ต้องเตือนตรงๆ ไม่ปล่อยให้ผู้ใช้เข้าใจ
              ว่าตัวเลขครบถ้วน (Pattern เดียวกับ frontend/src/pages/Dashboard.jsx เดิม) */}
          {overview.fxUnavailableForUsd && (
            <p className="dh-fx-warning">
              * มีสินทรัพย์สกุล USD ในพอร์ต แต่ดึงอัตราแลกเปลี่ยนไม่สำเร็จในขณะนี้ — ยอด "เทียบบาท"
              ด้านล่างยังไม่รวมส่วนที่เป็น USD กรุณาลองรีเฟรชอีกครั้งภายหลัง
            </p>
          )}

          <StatCards overview={overview} />

          <section className="dh-card" id="dh-dca">
            <div className="dh-card-h">
              <h2>บันทึก DCA</h2>
              <span className="dh-tag">ง่าย ครบ จบในกล่องเดียว</span>
              <div className="dh-sp" />
              <span className="dh-link-static" title="พิมพ์คำสั่งซื้อในแชท LINE ได้เหมือนกัน">
                หรือพิมพ์ในแชท LINE ก็ได้
              </span>
            </div>
            <DcaForm
              symbols={symbols}
              pickerOpenSignal={pickerOpenSignal}
              onRecorded={handleRecorded}
              onRequestUndo={setUndoTarget}
            />
          </section>

          <section className="dh-two-col">
            <AllocationCard allocation={overview.allocation} />
            <RecentList
              recent={overview.recent}
              assetTypeBySymbol={assetTypeBySymbol}
              onRequestUndo={setUndoTarget}
            />
          </section>

          <InvestedChart monthlyInvested={overview.monthlyInvested} />

          <p className="dh-disclaimer-bottom">
            EasyDCA by JaydeX เป็นผู้ช่วยบันทึกและติดตามพอร์ตการลงทุนเท่านั้น ไม่ใช่โบรกเกอร์หรือที่ปรึกษาการลงทุน
            ไม่มีการส่งคำสั่งซื้อขายจริงผ่านระบบนี้ และไม่มีเนื้อหาใดในหน้านี้เป็นคำแนะนำให้ซื้อ ขาย
            หรือถือครองสินทรัพย์รายตัวใดๆ ข้อมูลที่แสดงเป็นการประมวลผลจากรายการที่ผู้ใช้บันทึกเองเท่านั้น
          </p>
        </main>

        <SidePanels overview={overview} />
      </div>

      {/* ════ Bottom Nav — เฉพาะมือถือแนวตั้ง (LIFF — ช่องทางหลัก) ════ */}
      <nav className="dh-bottomnav">
        <Link className="dh-bn-item dh-bn-active" to="/dashboard">
          <span className="dh-bn-i">🏠</span>หน้าหลัก
        </Link>
        <Link className="dh-bn-item" to="/dashboard/classic">
          <span className="dh-bn-i">💼</span>พอร์ต
        </Link>
        {/* Anchor ภายในหน้าเดียวกัน (Scroll ไปฟอร์ม ไม่ใช่นำทางข้ามหน้า) — ไม่ใช้ Link
            ตามที่ระบุไว้ชัดเจนว่าไม่ต้องแก้จุดนี้ */}
        <a className="dh-bn-item dh-bn-rec" href="#dh-dca" onClick={handleBottomNavRecordClick}>
          <span className="dh-bn-btn">＋</span>
          <span className="dh-bn-lbl">บันทึก</span>
        </a>
        <Link className="dh-bn-item" to="/dashboard/classic">
          <span className="dh-bn-i">🕐</span>ประวัติ
        </Link>
        <button type="button" className="dh-bn-item dh-bn-plain-btn" onClick={handleLogout}>
          <span className="dh-bn-i">👤</span>โปรไฟล์
        </button>
      </nav>

      <div className={`dh-toast${toast ? ' dh-toast-show' : ''}`}>{toast}</div>

      <UndoConfirmModal
        target={undoTarget}
        onConfirm={handleConfirmUndo}
        onClose={() => setUndoTarget(null)}
      />
    </div>
  );
}

export default DashboardHome;
