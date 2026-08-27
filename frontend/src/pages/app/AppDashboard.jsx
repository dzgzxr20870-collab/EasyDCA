import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiGet } from '../../lib/api.js';

// ═══════════════════════════════════════════════════════════════════════════
// AppDashboard — หน้าแดชบอร์ดต่อ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `pages/demo/DemoDashboard.jsx` — ใช้ `GET /api/v1/dashboard/overview`
// ซึ่งรวมข้อมูลทั้งหน้ามาให้ในครั้งเดียว (Endpoint นี้มีอยู่แล้วตั้งแต่ S8 R1a)
//
// ⚠️ **ไม่คำนวณตัวเลขเงินเองเลยแม้แต่ค่าเดียว** — ทุกยอดมาจาก Backend ที่คำนวณ
// ด้วย portfolio.service/portfolioSummary.service ตัวเดียวกับที่ LINE ใช้
// (กฎยืนข้อ 1 — Single Source of Truth ต่อ 1 สูตรเงิน)
//
// ⚠️ ธงที่ต้องรองรับให้ครบ (Demo ไม่มีเลย):
//   isEmpty · excludedCount · fxStale · fxUnavailableForUsd
//
// ⚠️ **ห้ามใช้ภาษาชี้นำการลงทุน** (กฎเหล็กข้อ 1) — รายงานข้อเท็จจริงเท่านั้น
// ห้ามมีข้อความประเภท "พอร์ตคุณเสี่ยงเกินไป" / "ควรซื้อเพิ่ม" ที่ใดก็ตาม

function formatThb(n) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n));
}

function StatTile({ label, value, unit = 'บาท', note }) {
  return (
    <div className="demo-stat">
      <span className="demo-stat__label">{label}</span>
      <strong className="demo-stat__value">
        {value}
        {unit ? <small> {unit}</small> : null}
      </strong>
      {note ? <small className="app-note">{note}</small> : null}
    </div>
  );
}

function AppDashboard() {
  const { loading: shellLoading } = useOutletContext();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await apiGet('/api/v1/dashboard/overview'));
    } catch (err) {
      setError(err?.message ?? 'โหลดข้อมูลแดชบอร์ดไม่สำเร็จ');
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || shellLoading) {
    return (
      <section className="demo-page">
        <div className="app-state app-state--loading" role="status">
          กำลังโหลดแดชบอร์ด...
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="demo-page">
        <div className="app-state app-state--error" role="alert">
          <strong>โหลดข้อมูลแดชบอร์ดไม่สำเร็จ</strong>
          <p>{error}</p>
          <button type="button" className="demo-btn" onClick={load}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </section>
    );
  }

  const p = overview?.portfolio ?? { isEmpty: true };

  return (
    <section className="demo-page">
      <header className="demo-page__head">
        <h1>ภาพรวม</h1>
      </header>

      {/* ⚠️ มี USD แต่ดึงเรตไม่ได้ → ห้ามแสดงยอดรวมเทียบบาทเป็นความจริง ต้องเตือนก่อน */}
      {overview?.fxUnavailableForUsd && (
        <div className="app-state app-state--warn" role="alert">
          <strong>ยอดรวมยังไม่รวมสินทรัพย์สกุล USD</strong>
          <p>ตอนนี้ดึงอัตราแลกเปลี่ยน USD→THB ไม่ได้ ระบบจึงไม่รวมยอดข้ามสกุลเงินให้</p>
        </div>
      )}

      {overview?.fxStale && !overview?.fxUnavailableForUsd && (
        <p className="app-note">⏱️ อัตราแลกเปลี่ยนที่ใช้เป็นข้อมูลของวันที่ {overview.fxAsOf}</p>
      )}

      {p.isEmpty ? (
        <div className="app-state app-state--empty">
          <strong>ยังไม่มีสินทรัพย์ในพอร์ต</strong>
          <p>เมื่อบันทึกรายการซื้อรายการแรกแล้ว ภาพรวมพอร์ตจะแสดงที่นี่</p>
          <Link to="/app/portfolio" className="demo-btn demo-btn--primary">
            ไปหน้าพอร์ต
          </Link>
        </div>
      ) : (
        <>
          <div className="demo-stats">
            <StatTile label="มูลค่าพอร์ตปัจจุบัน" value={formatThb(p.totalCurrentValue)} />
            <StatTile
              label="กำไร/ขาดทุนที่ยังไม่รับรู้"
              value={formatThb(p.unrealizedPnL)}
              note={
                p.unrealizedPnLPercent !== null && p.unrealizedPnLPercent !== undefined
                  ? `${p.unrealizedPnLPercent}%`
                  : undefined
              }
            />
            <StatTile
              label="กำไร/ขาดทุนที่รับรู้แล้ว"
              value={formatThb(p.realizedPnLThbEquivalent)}
            />
          </div>

          {/* ⚠️ ต้องบอกเสมอเมื่อมีสินทรัพย์ที่ยังไม่มีราคาตลาด ไม่งั้นผู้ใช้จะเข้าใจว่า
              ยอดกำไร/ขาดทุนครอบคลุมทั้งพอร์ตทั้งที่ไม่ใช่ */}
          {p.excludedCount > 0 && (
            <p className="app-note">
              ℹ️ ตัวเลขกำไร/ขาดทุนด้านบนยังไม่รวมสินทรัพย์ {p.excludedCount} รายการที่ยังไม่มี
              ราคาตลาด (เช่นหุ้นไทยบางตัว) — มูลค่าพอร์ตในหน้า “พอร์ต” จะตีรายการเหล่านั้นที่ราคาทุน
            </p>
          )}
        </>
      )}

      <div className="demo-stats">
        <StatTile label="เงินลงทุนสะสมทั้งหมด" value={formatThb(overview?.lifetime?.totalThb)} />
        <StatTile
          label="จำนวนครั้งที่บันทึก"
          value={overview?.lifetime?.count ?? '—'}
          unit="ครั้ง"
        />
        <StatTile label="DCA เดือนนี้" value={formatThb(overview?.thisMonth?.totalThb)} />
        <StatTile
          label="ต่อเนื่อง"
          value={overview?.streakMonths ?? 0}
          unit="เดือน"
        />
      </div>

      {/* แผน DCA ที่ถึงรอบวันนี้ — ข้อความเป็นข้อเท็จจริงล้วน ไม่ชี้นำว่าควรซื้อไหม */}
      {Array.isArray(overview?.todayDuePlans) && overview.todayDuePlans.length > 0 && (
        <section className="demo-card">
          <h2>วันนี้ถึงรอบ DCA ของคุณ</h2>
          <ul>
            {overview.todayDuePlans.map((plan) => (
              <li key={plan.id ?? plan.symbol}>
                {plan.symbol} · {formatThb(plan.amountTotal)} {plan.currency ?? 'บาท'}
              </li>
            ))}
          </ul>
          <Link to="/app/dca" className="demo-btn">
            ดูแผน DCA ทั้งหมด
          </Link>
        </section>
      )}

      <section className="demo-card">
        <h2>รายการล่าสุด</h2>
        {(overview?.recent ?? []).length === 0 ? (
          <p className="app-note">ยังไม่มีรายการ</p>
        ) : (
          <ul className="demo-recent">
            {overview.recent.map((tx) => (
              <li key={tx.id}>
                <span>{tx.symbol}</span>
                <span>{formatThb(tx.amountTotal)} {tx.currency ?? 'บาท'}</span>
                <small>{tx.date}</small>
              </li>
            ))}
          </ul>
        )}
        <Link to="/app/transactions" className="demo-btn">
          ดูธุรกรรมทั้งหมด
        </Link>
      </section>
    </section>
  );
}

export default AppDashboard;
