import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { apiGet } from '../../lib/api.js';
import { listPortfolios, setDefaultPortfolio } from '../../lib/portfolioApi.js';
import {
  fromMeResponse,
  canCreatePortfolio,
  UNKNOWN_ENTITLEMENTS,
  LOCKED_PORTFOLIO_NOTICE,
} from '../../lib/entitlements.js';
import RecordTransactionModal from './RecordTransactionModal.jsx';
import './appShell.css';

// ═══════════════════════════════════════════════════════════════════════════
// AppShell — Shell กลางของ Dashboard แบบแยกหน้า (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `components/demo/DemoShell.jsx` ทีละไฟล์ (**ไม่ได้ merge branch demo**
// เพราะ `git diff main..demo` มี 6,872 deletions ซึ่งจะลบงาน Slip OCR + มาสคอต +
// Premium fixes ที่ Deploy ไปแล้วทิ้งทั้งหมด)
//
// ── สิ่งที่ต่างจาก Demo อย่างมีนัยสำคัญ (ไม่ใช่แค่เปลี่ยนชื่อไฟล์) ──────────
//   1. พอร์ตมาจาก `GET /api/v1/portfolios` จริง ไม่ใช่ `mockData.PORTFOLIOS`
//   2. สิทธิ์มาจาก `GET /api/v1/dashboard/me` จริง — **ตัด Toggle "ดูแบบ Free /
//      ดูแบบ Premium" ของ Demo ออกทั้งหมด** เพราะเป็นของปลอมที่ไม่ผูกกับ Auth
//   3. มี Loading state + Error state ทุกหน้า (Demo ไม่มีเลยเพราะข้อมูลเป็น Mock
//      ที่พร้อมใช้ทันที) — **ห้าม Silent Default**: โหลดไม่ได้ต้องบอกผู้ใช้
//   4. รองรับกติกา "พอร์ตที่ถูกล็อก" ตามมติ Founder 24 ส.ค. 2569
//
// ⚠️ **Frontend ซ่อนปุ่มคือ UX ไม่ใช่ Gate** — ด่านจริงอยู่ Backend เสมอ
// (`assertCanAddToPortfolio` + `create_portfolio_locked`) ถ้าผู้ใช้ยิง API ตรงๆ
// Backend ปฏิเสธเองได้อยู่แล้ว ที่นี่ทำเพื่อไม่ให้ผู้ใช้กดแล้วเจอ Error เปล่าๆ
//
// ⚠️ Internal Navigation ใช้ `<NavLink>` ของ React Router เท่านั้น **ห้าม `<a href>`**
// เพราะ JWT เก็บใน Memory — full page reload จะทำให้ Token หายแล้วเด้งกลับ Login

const NAV_ITEMS = [
  { to: '/app/dashboard', icon: '🏠', label: 'แดชบอร์ด' },
  { to: '/app/portfolio', icon: '📊', label: 'พอร์ต' },
  { to: '/app/transactions', icon: '🕐', label: 'ธุรกรรม' },
  { to: '/app/dca', icon: '🔔', label: 'DCA' },
  { to: '/app/profile', icon: '👤', label: 'โปรไฟล์' },
];

// ตัวเลือก "ทั้งหมด" ของ Switcher — ไม่ใช่ id ของพอร์ตจริง
export const ALL_PORTFOLIOS = 'all';

function PortfolioSwitcher({ portfolios, portfolioId, onChange, disabled }) {
  return (
    <select
      className="demo-portfolio-switcher"
      value={portfolioId}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="สลับพอร์ตที่กำลังดู"
    >
      <option value={ALL_PORTFOLIOS}>🗂️ ทั้งหมด (รวมทุกพอร์ต)</option>
      {portfolios.map((p) => (
        <option key={p.id} value={p.id}>
          {p.isDefault ? '⭐' : '🗂️'} {p.name}
          {/* ⚠️ ต้องเห็นตั้งแต่ใน Switcher ว่าพอร์ตไหนถูกล็อก ไม่ใช่ให้ผู้ใช้
              สลับเข้าไปแล้วค่อยเจอ — จะได้ไม่งงว่าทำไมปุ่มบันทึกกดไม่ได้ */}
          {p.canWrite === false ? ' (เพิ่มรายการใหม่ไม่ได้)' : ''}
        </option>
      ))}
    </select>
  );
}

// ── แถบแจ้งสถานะพอร์ตที่ถูกล็อก ────────────────────────────────────────────
// ⭐ ต้องบอก "ทางออกที่ยังทำได้จริง" ให้ครบ — ถ้าเขียนแค่ "อ่านอย่างเดียว"
// ผู้ใช้จะเข้าใจว่าติดกับ แล้ว **ไม่บันทึกการขายที่เกิดขึ้นจริงในโลกจริง**
// ทำให้ยอดในพอร์ตผิดถาวร ซึ่งเป็นสิ่งที่มติ 24 ส.ค. 2569 ตั้งใจกันตั้งแต่แรก
export function LockedPortfolioBanner({ portfolioName }) {
  const n = LOCKED_PORTFOLIO_NOTICE;

  return (
    <div className="app-locked-banner" role="status">
      <strong>
        🔒 {n.title}
        {portfolioName ? ` — ${portfolioName}` : ''}
      </strong>
      <p>{n.reason}</p>
      <p>ยังทำสิ่งเหล่านี้ได้ตามปกติ:</p>
      <ul>
        {n.stillAllowed.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="app-locked-banner__safety">
        {n.dataSafety} · {n.recovery}
      </p>
      <NavLink to="/premium" className="demo-btn demo-btn--primary">
        ต่ออายุ Premium
      </NavLink>
    </div>
  );
}

function AppShell() {
  const [portfolios, setPortfolios] = useState([]);
  const [portfolioId, setPortfolioId] = useState(ALL_PORTFOLIOS);
  const [entitlements, setEntitlements] = useState(UNKNOWN_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRecord, setShowRecord] = useState(false);

  // โหลดพอร์ต + สิทธิ์พร้อมกันครั้งเดียวตอน mount
  //
  // ⚠️ ยิงสองอันขนานกันด้วย Promise.all — ทั้งคู่ไม่ขึ้นต่อกัน การยิงต่อกันเป็น
  // ทอดๆ จะเพิ่มเวลารอหน้าแรกโดยไม่จำเป็น (กฎยืนข้อ 10)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, me] = await Promise.all([
        listPortfolios(),
        apiGet('/api/v1/dashboard/me'),
      ]);
      setPortfolios(list);
      setEntitlements(fromMeResponse(me));
    } catch (err) {
      // ⚠️ ห้ามกลืน Error แล้วแสดงหน้าว่างเปล่า — ผู้ใช้ต้องรู้ว่าโหลดไม่สำเร็จ
      // ไม่ใช่เข้าใจว่า "ไม่มีพอร์ตเลย" ซึ่งเป็นคนละเรื่องกันสิ้นเชิง
      setError(err?.message ?? 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected =
    portfolioId === ALL_PORTFOLIOS ? null : portfolios.find((p) => p.id === portfolioId) ?? null;

  const createGate = canCreatePortfolio(entitlements, portfolios.length);

  async function handleSetDefault(id) {
    try {
      await setDefaultPortfolio(id);
      await load(); // โหลดใหม่เพื่อให้ canWrite ของทุกพอร์ตอัปเดตตามพอร์ตหลักใหม่
    } catch (err) {
      setError(err?.message ?? 'ตั้งพอร์ตหลักไม่สำเร็จ');
    }
  }

  return (
    <div className="demo-shell">
      <header className="demo-topbar">
        <NavLink to="/dashboard" className="demo-brand">
          EasyDCA
        </NavLink>

        <PortfolioSwitcher
          portfolios={portfolios}
          portfolioId={portfolioId}
          onChange={setPortfolioId}
          disabled={loading || portfolios.length === 0}
        />

        {/* ปุ่มสร้างพอร์ต — Disable พร้อมบอกเหตุผลเสมอ ไม่ซ่อนหาย
            (ซ่อนไปเลยทำให้ผู้ใช้ Free ไม่รู้ว่ามีฟีเจอร์นี้อยู่) */}
        <NavLink
          to={createGate.allowed ? '/app/portfolio?new=1' : '/premium'}
          className="demo-btn"
          aria-disabled={createGate.reason === 'unknown'}
          title={
            createGate.allowed
              ? 'สร้างพอร์ตใหม่'
              : createGate.reason === 'cap'
                ? 'จำนวนพอร์ตถึงขีดจำกัดของระบบแล้ว (ลบพอร์ตที่ไม่ได้ใช้ก่อน)'
                : createGate.reason === 'limit'
                  ? 'แพ็กเกจ Free ใช้ได้ 1 พอร์ต — อัปเกรดเพื่อแยกหลายพอร์ต'
                  : 'กำลังตรวจสอบสิทธิ์...'
          }
        >
          ＋ สร้างพอร์ตใหม่
        </NavLink>

        {/* ⭐ ปุ่มบันทึกรายการ — เปิดได้เสมอ ไม่ว่าพอร์ตที่กำลังดูจะถูกล็อกหรือไม่
            เพราะ Modal มีทั้ง "ซื้อ" (ปิดเมื่อล็อก) และ "ขาย" (เปิดเสมอ) อยู่ข้างใน
            ถ้าปิดปุ่มนี้ทั้งปุ่ม ผู้ใช้จะบันทึกการขายไม่ได้เลย = ยอดผิดถาวร */}
        <button
          type="button"
          className="demo-btn demo-btn--primary"
          onClick={() => setShowRecord(true)}
          disabled={loading}
        >
          ＋ บันทึกรายการ
        </button>
      </header>

      {/* ── Loading / Error state (Demo ไม่มีทั้งคู่เพราะใช้ Mock) ───────── */}
      {loading && (
        <div className="app-state app-state--loading" role="status">
          กำลังโหลดข้อมูลพอร์ต...
        </div>
      )}

      {error && !loading && (
        <div className="app-state app-state--error" role="alert">
          <strong>โหลดข้อมูลไม่สำเร็จ</strong>
          <p>{error}</p>
          <button type="button" className="demo-btn" onClick={load}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}

      {/* พอร์ตที่กำลังดูถูกล็อก → แจ้งพร้อมทางออกที่ยังทำได้ */}
      {!loading && !error && selected?.canWrite === false && (
        <LockedPortfolioBanner portfolioName={selected.name} />
      )}

      <main className="demo-main">
        {/* ส่ง Context ให้หน้าลูกใช้ — หน้าลูกไม่ต้องยิง /portfolios หรือ /me ซ้ำ
            (Demo ส่ง isPremiumDemo ที่เป็นของปลอม ที่นี่ส่งของจริงทั้งชุด) */}
        <Outlet
          context={{
            portfolios,
            portfolioId,
            selectedPortfolio: selected,
            entitlements,
            reload: load,
            setDefault: handleSetDefault,
            loading,
          }}
        />
      </main>

      {showRecord && (
        <RecordTransactionModal
          selectedPortfolio={selected}
          /* รายการพอร์ตเต็ม — Modal ใช้สร้างช่อง "บันทึกลงพอร์ต" (โหลดมาแล้ว
             ตั้งแต่ต้น ไม่ต้องยิง GET /portfolios ซ้ำ) · ปุ่มนี้เปิดไม่ได้ตอน
             loading อยู่แล้ว จึงมั่นใจได้ว่า portfolios ถูกเติมค่าแล้วเสมอ */
          portfolios={portfolios}
          /* ⭐ `selected` เป็น null เมื่อ Switcher = "ทั้งหมด" (ALL_PORTFOLIOS)
             → scopePortfolioId เป็น undefined → Dropdown สินทรัพย์โหลดทุกพอร์ต
             เหมือนเดิมทุกประการ (Use Case เดิมที่ต้องไม่พัง) · ถ้า Switcher เจาะจง
             พอร์ตอยู่แล้ว ก็กรอง Dropdown ตามพอร์ตนั้นด้วยเหตุผลเดียวกับหน้า
             รายละเอียดพอร์ต (ดู RecordTransactionModal.jsx) */
          scopePortfolioId={selected?.id}
          onClose={() => setShowRecord(false)}
          onSaved={async () => {
            setShowRecord(false);
            // โหลดพอร์ตใหม่ — ยอด/สิทธิ์อาจเปลี่ยนหลังบันทึก (เช่นชนเพดาน Free)
            await load();
          }}
        />
      )}

      <nav className="demo-bottomnav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive ? 'demo-navitem demo-navitem--active' : 'demo-navitem'
            }
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
