import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getToken, apiGet, apiPost, clearToken, stashReturnTo } from '../lib/api.js';
import { getAssetSymbols } from '../lib/symbolsCache.js';
import { undoErrorMessage } from '../lib/dcaErrors.js';
import { buildHoldings } from '../lib/sellForm.js';
import DcaForm from '../components/dashboard/DcaForm.jsx';
import DcaPlansSection from '../components/dashboard/DcaPlansSection.jsx';
import StatCards from '../components/dashboard/StatCards.jsx';
import AllocationCard from '../components/dashboard/AllocationCard.jsx';
import RecentList from '../components/dashboard/RecentList.jsx';
import InvestedChart from '../components/dashboard/InvestedChart.jsx';
import SidePanels from '../components/dashboard/SidePanels.jsx';
import UndoConfirmModal from '../components/dashboard/UndoConfirmModal.jsx';
import PortfolioDetailSection from '../components/dashboard/PortfolioDetailSection.jsx';
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

// จัดรูปวันที่ใดๆ เป็นภาษาไทย/พ.ศ. — Copy ตรงจาก Dashboard.jsx เดิม (ใช้กับวันหมดอายุ
// Premium ในการ์ด Banner ที่ย้ายมารอบนี้ — S8 R3 รอบ 2)
function formatThaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
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

  // S8 R3 รอบ 3 — แผน DCA ทั้งหมด (Active+Paused) จาก GET /api/v1/dca-plans ใช้ทั้ง
  // ในหน้าจัดการแผน (DcaPlansSection) และ Panel "วันนี้ถึงรอบ DCA" (SidePanels — ต้อง
  // รู้ว่ามีแผน Active อยู่ไหมเพื่อเลือกข้อความ Empty State ให้ตรง)
  const [plans, setPlans] = useState([]);
  // prefillSignal: Object ใหม่ทุกครั้งที่กด "บันทึกเลย" บนการ์ดแผนที่ถึงรอบวันนี้
  // (nonce กันเคสกดค่าเดิมซ้ำ — ดู frontend/src/lib/dcaPlanPrefill.js)
  const [prefillSignal, setPrefillSignal] = useState(null);

  // ── S8 R3 รอบ 2 — ฟีเจอร์ที่ย้ายมาจาก Dashboard.jsx เดิม (พอร์ตของฉัน/ประวัติ/
  // วิธีใช้งาน) — Shape ข้อมูลชุดนี้เป็นคนละชุดกับ `overview` ด้านบน (มาจาก
  // /dashboard/portfolio, /dashboard/profit/:symbol, /dashboard/history — Endpoint
  // เดิมที่ Dashboard.jsx ใช้อยู่แล้ว ไม่ใช่ Endpoint ใหม่) — แยก State/Error ต่างหาก
  // โดยตั้งใจ เพื่อไม่ให้ Endpoint ชุดนี้ล่มแล้วบล็อกฟอร์มบันทึก DCA/สถิติด้านบนที่
  // ไม่ได้พึ่งข้อมูลชุดนี้เลย (ดู Report: เหตุผลที่แยก Error Path จาก Dashboard.jsx เดิม)
  const [legacyPortfolio, setLegacyPortfolio] = useState(null);
  const [profitBySymbol, setProfitBySymbol] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [legacyLoadError, setLegacyLoadError] = useState(null);
  const [legacyActiveTab, setLegacyActiveTab] = useState('portfolio');

  // Scroll-Spy — ไฮไลต์เมนู Sidebar/Bottom-nav ตาม Section ที่กำลังมองเห็นจริง
  // ('dashboard' | 'dca-plans' | 'legacy-tabs' — ตรงกับ 3 กลุ่ม Section ที่มี Sidebar
  // Item ชี้มา ไม่รวม #dh-dca เพราะไม่มี Sidebar Item ไหนถือว่ามันเป็น "ปลายทาง" ของ
  // ตัวเอง (มีแค่ปุ่ม + ตรงกลาง Bottom Nav ที่เป็นปุ่ม Action ไม่ใช่ Nav Destination)
  // ค่าเริ่มต้น 'dashboard' ตรงกับตำแหน่ง Scroll บนสุดตอนโหลดหน้าเสมอ
  const [activeSection, setActiveSection] = useState('dashboard');

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const refetchOverview = useCallback(async () => {
    const data = await apiGet('/api/v1/dashboard/overview');
    setOverview(data);
  }, []);

  const refetchPlans = useCallback(async () => {
    const data = await apiGet('/api/v1/dca-plans');
    setPlans(data.plans);
  }, []);

  // หลัง Create/Pause/Resume/Delete แผนสำเร็จ ต้อง Refetch ทั้งคู่ — todayDuePlans
  // ใน overview อาจเปลี่ยนถ้าแผนที่แก้ตรงกับวันนี้พอดี (S8 R3 รอบ 3)
  const refetchDcaPlansAndOverview = useCallback(
    () => Promise.all([refetchPlans(), refetchOverview()]),
    [refetchPlans, refetchOverview]
  );

  useEffect(() => {
    if (!getToken()) {
      // จำหน้านี้ไว้ (ปกติ /dashboard) ให้ Login พากลับหลัง Re-auth ตาม Path เดิม
      stashReturnTo(window.location.pathname + window.location.search);
      navigate('/', { replace: true });
      return;
    }

    async function load() {
      try {
        const [symbolsData, overviewData, meData, plansData] = await Promise.all([
          getAssetSymbols(),
          apiGet('/api/v1/dashboard/overview'),
          // Endpoint แยก + catch เอง (Pattern เดียวกับ Dashboard.jsx เดิม) — ถ้า /me
          // ล่ม ไม่ให้กระทบการโหลดหน้าหลัก Fallback ครบทุก Field ที่ใช้จริง (role=
          // undefined = ไม่ใช่ Admin ตาม Fail-safe เดิม / isPremiumActive=false,
          // assetLimit=2 = Free Plan ตาม Fallback เดิมของ Dashboard.jsx พอดี — S8 R3
          // รอบ 2 เพิ่ม Banner Free/Premium ที่ย้ายมาใหม่ต้องมี Field พวกนี้ด้วย)
          apiGet('/api/v1/dashboard/me').catch(() => ({
            role: undefined,
            isPremiumActive: false,
            assetLimit: 2,
            planExpiresAt: null,
          })),
          // S8 R3 รอบ 3 — รายการแผน DCA ทั้งหมด แยก catch เหมือน /me: ถ้า Endpoint นี้
          // ล่ม (เช่น Migration 020 ยังไม่ Apply ในบางสภาพแวดล้อม) ไม่บล็อกหน้าหลัก
          // แค่ Panel/Section ที่พึ่งข้อมูลนี้จะโชว่ Empty State ไปก่อน
          apiGet('/api/v1/dca-plans').catch(() => ({ plans: [] })),
        ]);
        setSymbols(symbolsData);
        setOverview(overviewData);
        setPlanInfo(meData);
        setPlans(plansData.plans);
        setReady(true);
      } catch (err) {
        setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }

      // ── S8 R3 รอบ 2: โหลดข้อมูลของ Section "รายละเอียดพอร์ต" ที่ย้ายมาจาก
      // Dashboard.jsx เดิม — Sequence เดิมทุกประการ (profit ต้องรู้ holdings ก่อน
      // จึงเรียกต่อจาก portfolio ไม่ใช่ Promise.all พร้อมกัน) แยก try/catch ต่างหาก
      // จากด้านบน: endpoint ชุดนี้ (/portfolio, /profit/:symbol, /history) ล่มแล้ว
      // ต้องไม่ทำให้ฟอร์มบันทึก DCA/สถิติหลักด้านบน (ซึ่งโหลดสำเร็จแล้ว) ใช้งานไม่ได้ไปด้วย
      try {
        const portfolioData = await apiGet('/api/v1/dashboard/portfolio');
        setLegacyPortfolio(portfolioData);

        const profitEntries = await Promise.all(
          portfolioData.holdings.map((h) =>
            apiGet(`/api/v1/dashboard/profit/${h.symbol}`)
              .then((profit) => [h.symbol, profit])
              .catch(() => [h.symbol, null])
          )
        );
        setProfitBySymbol(Object.fromEntries(profitEntries));

        const historyData = await apiGet('/api/v1/dashboard/history?limit=1000');
        setTransactions(historyData.transactions);
      } catch (err) {
        setLegacyLoadError('โหลดข้อมูลรายละเอียดพอร์ตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
    }

    load();

    return () => clearTimeout(toastTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll-Spy จริง — คอย Sync activeSection ตอน User Scroll เอง (ไม่ใช่แค่ตอนกด
  // เมนู) ใช้ IntersectionObserver กับ rootMargin ที่หด Viewport เหลือแถบแคบๆ ใกล้
  // ขอบบนจอ (แทนดูว่าทั้ง Section โผล่กี่ % ของจอ) เพราะบาง Section (พอร์ตของฉัน/
  // ประวัติรายการ) สูงกว่าจอมาก ถ้าใช้เกณฑ์ % ของทั้ง Section จะไม่มีทาง Trigger ถูก
  // จังหวะ — Pattern เดียวกับ TOC Highlight ของเว็บเอกสารทั่วไป
  //
  // ไม่ Reset activeSection เมื่อ isIntersecting เป็น false — ตั้งใจให้ค่าค้างไว้จนกว่า
  // Section ถัดไปจะเข้าแถบแทน (แถบเดียวมีได้แค่ 1 Section ที่ "กำลังผ่าน" ในแต่ละจังหวะ
  // ทั้ง Scroll ขึ้น/ลง) ต้องรอ ready ก่อนเพราะ Section เหล่านี้ยังไม่ Mount ตอน Loading
  useEffect(() => {
    if (!ready) return undefined;

    const sections = [
      { key: 'dashboard', id: 'dh-dashboard-top' },
      { key: 'dca-plans', id: 'dh-dca-plans' },
      { key: 'legacy-tabs', id: 'dh-legacy-tabs' },
    ]
      .map(({ key, id }) => ({ key, el: document.getElementById(id) }))
      .filter(({ el }) => el);

    if (sections.length === 0) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const matched = sections.find(({ el }) => el === entry.target);
          if (matched) setActiveSection(matched.key);
        }
      },
      { rootMargin: '-15% 0px -75% 0px', threshold: 0 }
    );

    sections.forEach(({ el }) => observer.observe(el));

    return () => observer.disconnect();
  }, [ready]);

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  // response.transaction.side มาจาก Backend (ทิศทางที่บันทึกจริง) ไม่ใช่โหมดของฟอร์ม
  function handleRecorded(response) {
    showToast(response?.transaction?.side === 'sell' ? '✅ บันทึกการขายสำเร็จ' : '✅ บันทึกสำเร็จ');
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

  // S8 R3 รอบ 3 — กด "บันทึกเลย" บนการ์ดแผนที่ถึงรอบวันนี้ (SidePanels) → Prefill
  // ฟอร์มบันทึก DCA ด้วยข้อมูลแผนนั้น แล้ว Scroll ไปหาฟอร์ม (nonce กันเคสกดค่าเดิมซ้ำ)
  function handleQuickRecord(plan) {
    setPrefillSignal({
      symbol: plan.symbol,
      amountTotal: plan.amountTotal,
      currency: plan.currency,
      nonce: Date.now(),
    });
    document.getElementById('dh-dca')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // S8 R3 รอบ 3 — Sidebar "ตั้งเตือน DCA": Scroll ไปหน้าจัดการแผนในหน้าเดียวกัน
  // (Pattern เดียวกับ handleLegacyNavClick — ไม่ Navigate ข้ามหน้า)
  function handleDcaPlansNavClick(e) {
    e.preventDefault();
    // Optimistic — ตั้งไฮไลต์ทันทีตอนกด ไม่รอ IntersectionObserver ตามทัน (ซึ่งจะ
    // ล่าช้ากว่านี้เพราะ Scroll แบบ smooth ใช้เวลา + Observer ต้องรอ Section เข้าแถบก่อน)
    setActiveSection('dca-plans');
    document.getElementById('dh-dca-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // S8 R3 รอบ 2 — Sidebar/Bottom-nav "พอร์ตของฉัน"/"ประวัติรายการ": สลับแท็บใน
  // PortfolioDetailSection แล้ว Scroll มาที่ Section นั้น (Anchor ภายในหน้าเดียวกัน
  // ไม่ Navigate ข้ามหน้า — Pattern เดียวกับ handleBottomNavRecordClick ด้านบน)
  function handleLegacyNavClick(e, tab) {
    e.preventDefault();
    setLegacyActiveTab(tab);
    // Optimistic — เหตุผลเดียวกับ handleDcaPlansNavClick ด้านบน
    setActiveSection('legacy-tabs');
    document.getElementById('dh-legacy-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Sidebar/Bottom-nav "แดชบอร์ด"/"หน้าหลัก": เดิมเป็น <Link to="/dashboard"> เฉยๆ —
  // กดตอนอยู่ที่ /dashboard อยู่แล้วไม่ทำอะไรเลย (Route เดิม) ตอนนี้มี activeSection
  // จริงแล้ว จึงต้อง Scroll กลับขึ้นบนสุด + คืนไฮไลต์ด้วย ไม่งั้นกด "แดชบอร์ด" จะไม่มี
  // ทางกลับมาไฮไลต์ Section นี้ได้อีกเลยหลัง Scroll ผ่านไปแล้ว
  function handleDashboardNavClick(e) {
    e.preventDefault();
    setActiveSection('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // สินทรัพย์ที่ถืออยู่จริง (โหมดขายของ DcaForm) — มาจาก allocation ชุดเดียวกับด้านบน
  // ที่ Backend คำนวณยอดคงเหลือจาก Ledger มาแล้ว (ไม่ยิง Endpoint เพิ่ม ไม่คำนวณเอง)
  // Refetch overview หลังบันทึกทุกครั้งอยู่แล้ว รายการนี้จึงอัพเดตตามเองหลังขาย
  const holdings = buildHoldings(overview.allocation);

  return (
    <div className="dh-app">
      <div className="dh-shell">
        {/* ════ SIDEBAR (ซ่อนที่ ≤820px) ════ */}
        <aside className="dh-sidebar">
          <div className="dh-side-card">
            <div className="dh-brand">
              <img className="dh-brand-logo" src="/logo/easydca-icon-192.png" alt="EasyDCA" />
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
              <Link
                className={`dh-nav-item${activeSection === 'dashboard' ? ' dh-nav-active' : ''}`}
                to="/dashboard"
                onClick={handleDashboardNavClick}
              >
                <span className="dh-ic">🏠</span> แดชบอร์ด
              </Link>
              {/* S8 R3 รอบ 2: ฟีเจอร์ "พอร์ตของฉัน"/"ประวัติรายการ" ย้ายเข้ามาอยู่ใน
                  หน้าเดียวกันแล้ว (PortfolioDetailSection, #dh-legacy-tabs) — เดิมชี้ไป
                  /dashboard/classic (Cross-route) เปลี่ยนเป็น Anchor + Scroll + สลับแท็บ
                  ในหน้าเดียวกัน (Pattern เดียวกับ #dh-dca) ไม่ Navigate ข้ามหน้าอีกต่อไป
                  ทั้งสอง Item ชี้ Anchor เดียวกัน (#dh-legacy-tabs) ต่างกันแค่ Tab ที่เปิด
                  จึงต้องเช็ค legacyActiveTab ร่วมด้วยตอนตัดสินว่าอันไหนควรไฮไลต์ —
                  IntersectionObserver แยกไม่ได้เองเพราะเป็น Section เดียวกันจริงๆ */}
              <a
                className={`dh-nav-item${
                  activeSection === 'legacy-tabs' && legacyActiveTab === 'portfolio' ? ' dh-nav-active' : ''
                }`}
                href="#dh-legacy-tabs"
                onClick={(e) => handleLegacyNavClick(e, 'portfolio')}
              >
                <span className="dh-ic">💼</span> พอร์ตของฉัน
              </a>
              <a
                className={`dh-nav-item${
                  activeSection === 'legacy-tabs' && legacyActiveTab === 'history' ? ' dh-nav-active' : ''
                }`}
                href="#dh-legacy-tabs"
                onClick={(e) => handleLegacyNavClick(e, 'history')}
              >
                <span className="dh-ic">🕐</span> ประวัติรายการ
              </a>
              {/* S8 R3 รอบ 3: เดิมเป็น Dead Link ชี้ไปตั้งเตือนผ่าน LINE เท่านั้น
                  (dh-nav-disabled) — ตอนนี้มีหน้าจัดการแผนจริงในเว็บแล้ว (#dh-dca-plans)
                  เปลี่ยนเป็น Anchor + Scroll เหมือน Pattern อื่นในไฟล์นี้ */}
              <a
                className={`dh-nav-item${activeSection === 'dca-plans' ? ' dh-nav-active' : ''}`}
                href="#dh-dca-plans"
                onClick={handleDcaPlansNavClick}
              >
                <span className="dh-ic">🔔</span> ตั้งเตือน DCA
              </a>
              <div className="dh-nav-sep" />
              {/* "โปรไฟล์ / Premium" — เดิมเป็น Anchor Scroll ไปที่ Banner ในหน้านี้ (#dh-plan-banner)
                  เพราะตอนนั้น /premium ยังไม่มีเนื้อหาจริง ตอนนี้ Premium.jsx มีตารางเทียบ Feature +
                  CTA ต่ออายุแล้ว (TODO #5) จึงเปลี่ยนเป็น <Link to="/premium"> ให้ไปหน้าจริงเสมอ
                  ไม่ว่า Free หรือ Premium (บั๊กเดิม: Premium user ไม่มีปุ่มให้กดต่อในบั๊กเดิม เพราะ
                  Path เดียวที่เคย navigate('/premium') ได้อยู่ใน Banner Free-only branch) — Pattern
                  เดียวกับ "แดชบอร์ด" ด้านบน (Client-side Navigate, ไม่ Reload ทั้งหน้า) */}
              <Link className="dh-nav-item" to="/premium">
                <span className="dh-ic">👤</span> โปรไฟล์ / Premium
              </Link>
              {/* ติดต่อ Admin/Support (ก่อนเปิด Closed Beta Wave 1) — แทนที่ Flow LINE
                  Chat เดิมที่ชนกับ Admin ตอบมือใน Chat Mode เดียวกัน (Bot ทับคำตอบของ
                  Admin) — Client-side Navigate เหมือนปุ่มอื่นในเมนูนี้ */}
              <Link className="dh-nav-item" to="/support">
                <span className="dh-ic">🆘</span> ติดต่อซัพพอต
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
            <img className="dh-brand-logo" src="/logo/easydca-icon-192.png" alt="EasyDCA" />
            <div>
              <b>EasyDCA</b>
              <small>by JaydeX</small>
            </div>
            <div className="dh-sp" />
            {/* Logout มือถือ — ย้ายมาจากแท็บ "โปรไฟล์" ในแถบล่าง (เดิม Bottom Nav
                ใช้ช่อง "โปรไฟล์" ผูกกับ handleLogout เป็น Logout ตัวเดียวที่มือถือ
                กดได้ เพราะ .dh-sidebar ที่มีปุ่ม "ออกจากระบบ" จริงถูกซ่อนบนมือถือ —
                ตอนนี้แท็บ "โปรไฟล์" เปลี่ยนไปพาไปหน้า /premium แล้ว (แก้บั๊กเมนูโปรไฟล์
                มือถือ) จึงต้องมีทางออกจากระบบสำรองไว้ที่นี่แทน กันมือถือไม่มีปุ่ม
                Logout เหลือเลย) */}
            {/* ติดต่อ Admin/Support มือถือ — Bottom Nav มี 5 ช่องตายตัวเต็มพอดีแล้ว
                (หน้าหลัก/พอร์ต/บันทึก/ประวัติ/โปรไฟล์) ไม่มีที่เพิ่มไอคอนที่ 6 จึงเพิ่ม
                ที่ dh-m-brand แทน (Pattern เดียวกับปุ่ม Logout 🚪 ที่อยู่ตรงนี้อยู่แล้ว)
                — มือถือ/LIFF คือช่องทางหลักของ User ส่วนใหญ่ ถ้ามีแค่ Sidebar Desktop
                (ซ่อนบนมือถือ) กลุ่มเป้าหมายหลักจะหาเมนูนี้ไม่เจอเลย */}
            <Link className="dh-m-icon-btn" to="/support" aria-label="ติดต่อซัพพอต">
              🆘
            </Link>
            <button
              type="button"
              className="dh-m-logout-btn"
              onClick={handleLogout}
              aria-label="ออกจากระบบ"
            >
              🚪
            </button>
          </div>

          {/* id นี้เป็น Marker สำหรับ Scroll-Spy เท่านั้น (ดู useEffect ด้านบน) — ไม่มี
              Section เดียวที่ครอบคลุมทั้งพื้นที่ "แดชบอร์ด" (กระจายหลาย <section> พี่น้อง
              กัน) จึงใช้ Element บนสุดนี้เป็นจุดอ้างอิงแทน */}
          <div className="dh-topbar" id="dh-dashboard-top">
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

          {/* S8 R3 รอบ 2 — Banner Free/Premium ที่ย้ายมาจาก Dashboard.jsx เดิม (planInfo
              ถูก Fetch ไว้แล้วตอน load() สำหรับปุ่ม Admin อยู่แล้ว ไม่ยิง Endpoint ซ้ำ)
              แสดงเสมอไม่ว่าจะสลับไป Section ไหน (ต่างจากพอร์ต/ประวัติที่อยู่ในแท็บ) */}
          {planInfo && (
            <section
              id="dh-plan-banner"
              className={`dh-plan-banner${planInfo.isPremiumActive ? ' dh-plan-premium' : ''}`}
            >
              {planInfo.isPremiumActive ? (
                <p>👑 คุณเป็นสมาชิก Premium (หมดอายุ {formatThaiDate(planInfo.planExpiresAt)})</p>
              ) : (
                <p>
                  คุณใช้แผน Free (จำกัด {planInfo.assetLimit} สินทรัพย์) — อัพเกรดเป็น Premium เพื่อปลดล็อกสินทรัพย์
                  ไม่จำกัด แผน DCA ไม่จำกัด และส่งออกรายงาน{' '}
                  <button
                    type="button"
                    className="dh-btn-main"
                    style={{ marginLeft: 8 }}
                    onClick={() => navigate('/premium')}
                  >
                    👑 อัพเกรด Premium
                  </button>
                </p>
              )}
            </section>
          )}

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
              <h2>บันทึกรายการ</h2>
              <span className="dh-tag">ซื้อ / ขาย จบในกล่องเดียว</span>
              <div className="dh-sp" />
              <span className="dh-link-static" title="พิมพ์คำสั่งซื้อ/ขายในแชท LINE ได้เหมือนกัน">
                หรือพิมพ์ในแชท LINE ก็ได้
              </span>
            </div>
            <DcaForm
              symbols={symbols}
              holdings={holdings}
              pickerOpenSignal={pickerOpenSignal}
              onRecorded={handleRecorded}
              onRequestUndo={setUndoTarget}
              prefillSignal={prefillSignal}
              // แนบสลิปหลักฐาน (Premium) — planInfo มาจาก GET /dashboard/me (Fetch แล้ว
              // ตอน load()) / onUpgrade พาไป /premium เหมือนปุ่มอัพเกรดจุดอื่นในหน้านี้
              isPremiumActive={planInfo?.isPremiumActive ?? false}
              onUpgrade={() => navigate('/premium')}
            />
          </section>

          {/* S8 R3 รอบ 3 — หน้าจัดการแผน DCA (สร้าง/หยุดชั่วคราว/เปิดใช้/ลบ) แทนที่
              Sidebar Item "ตั้งเตือน DCA" ที่เดิมเป็น Dead Link ชี้ไป LINE อย่างเดียว */}
          <section className="dh-card" id="dh-dca-plans">
            <div className="dh-card-h">
              <h2>ตั้งเตือน DCA</h2>
              <span className="dh-tag">จัดการแผนของคุณ</span>
            </div>
            <DcaPlansSection
              plans={plans}
              symbols={symbols}
              loadError={null}
              onChanged={refetchDcaPlansAndOverview}
              showToast={showToast}
              onUpgrade={() => navigate('/premium')}
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

          {/* S8 R3 รอบ 2 — พอร์ตของฉัน (P&L Table) / ประวัติรายการ (Filter ได้) /
              วิธีใช้งาน LINE + Export PDF/Excel (มี Preview ก่อนยืนยัน) — ย้ายมาจาก
              Dashboard.jsx เดิมทั้งหมด (ดู Report: ฟีเจอร์ไหนย้ายมา/ไม่ย้ายมาเพราะอะไร) */}
          <PortfolioDetailSection
            portfolio={legacyPortfolio}
            profitBySymbol={profitBySymbol}
            transactions={transactions}
            loadError={legacyLoadError}
            activeTab={legacyActiveTab}
            onTabChange={setLegacyActiveTab}
            onUpgrade={() => navigate('/premium')}
            // แนบสลิปเข้ารายการเดิมจากตารางประวัติ (งานที่ 2.1) — planInfo Fetch ไว้แล้ว
            // ตอน load() ไม่ยิง Endpoint เพิ่ม
            isPremiumActive={planInfo?.isPremiumActive ?? false}
          />

          <p className="dh-disclaimer-bottom">
            EasyDCA by JaydeX เป็นผู้ช่วยบันทึกและติดตามพอร์ตการลงทุนเท่านั้น ไม่ใช่โบรกเกอร์หรือที่ปรึกษาการลงทุน
            ไม่มีการส่งคำสั่งซื้อขายจริงผ่านระบบนี้ และไม่มีเนื้อหาใดในหน้านี้เป็นคำแนะนำให้ซื้อ ขาย
            หรือถือครองสินทรัพย์รายตัวใดๆ ข้อมูลที่แสดงเป็นการประมวลผลจากรายการที่ผู้ใช้บันทึกเองเท่านั้น
          </p>
        </main>

        <SidePanels overview={overview} symbols={symbols} plans={plans} onQuickRecord={handleQuickRecord} />
      </div>

      {/* ════ Bottom Nav — เฉพาะมือถือแนวตั้ง (LIFF — ช่องทางหลัก) ════ */}
      <nav className="dh-bottomnav">
        <Link
          className={`dh-bn-item${activeSection === 'dashboard' ? ' dh-bn-active' : ''}`}
          to="/dashboard"
          onClick={handleDashboardNavClick}
        >
          <span className="dh-bn-i">🏠</span>หน้าหลัก
        </Link>
        {/* S8 R3 รอบ 2 — เดิมชี้ไป /dashboard/classic (Cross-route) เปลี่ยนเป็น
            Anchor + Scroll + สลับแท็บใน PortfolioDetailSection (Pattern เดียวกับ
            #dh-dca ด้านล่าง — ไม่ Navigate ข้ามหน้าอีกต่อไป) */}
        <a
          className={`dh-bn-item${
            activeSection === 'legacy-tabs' && legacyActiveTab === 'portfolio' ? ' dh-bn-active' : ''
          }`}
          href="#dh-legacy-tabs"
          onClick={(e) => handleLegacyNavClick(e, 'portfolio')}
        >
          <span className="dh-bn-i">💼</span>พอร์ต
        </a>
        {/* Anchor ภายในหน้าเดียวกัน (Scroll ไปฟอร์ม ไม่ใช่นำทางข้ามหน้า) — ไม่ใช้ Link
            ตามที่ระบุไว้ชัดเจนว่าไม่ต้องแก้จุดนี้ — ปุ่ม Action ตรงกลาง ไม่ใช่ Nav
            Destination จึงไม่มี Logic ไฮไลต์ (ไม่มี Sidebar Item ไหนชี้มาที่ #dh-dca ด้วย) */}
        <a className="dh-bn-item dh-bn-rec" href="#dh-dca" onClick={handleBottomNavRecordClick}>
          <span className="dh-bn-btn">＋</span>
          <span className="dh-bn-lbl">บันทึก</span>
        </a>
        <a
          className={`dh-bn-item${
            activeSection === 'legacy-tabs' && legacyActiveTab === 'history' ? ' dh-bn-active' : ''
          }`}
          href="#dh-legacy-tabs"
          onClick={(e) => handleLegacyNavClick(e, 'history')}
        >
          <span className="dh-bn-i">🕐</span>ประวัติ
        </a>
        {/* เดิมผูกกับ handleLogout (บั๊ก: แท็บชื่อ "โปรไฟล์" แต่กด Logout จริง — ดูเหมือน
            "โหลดกลับหน้าหลัก" เพราะ LIFF Auto-login คืน Session ทันทีหลัง Logout)
            เปลี่ยนเป็น Link ไปหน้า /premium ตรงๆ (Client-side Navigate ตามกฎข้อ 12
            ไม่ Reload ทั้งหน้า) — Logout ย้ายไปปุ่ม 🚪 ที่ Header มือถือแทนแล้ว (ดูด้านบน) */}
        <Link className="dh-bn-item" to="/premium">
          <span className="dh-bn-i">👤</span>โปรไฟล์
        </Link>
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
