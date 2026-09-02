import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { apiGet } from '../../lib/api.js';
// ⚠️ **Reuse ตัวเดิมของ DashboardHome ห้ามเขียนกราฟใหม่** — Component นี้รับ
// `overview.monthlyInvested` Shape เดียวกันเป๊ะ (API.md §15.4) และมีเรื่องที่ทำถูกไว้
// แล้วซึ่งเขียนใหม่แล้วมักพลาด: แยกเส้น THB/USD (ไม่มี Historical FX ให้แปลงย้อนหลัง)
// · ขึ้น "ยังไม่มีรายการในช่วงเวลานี้" แทนเส้นแบนที่ 0 · Footnote ว่านี่คือ
// "เงินที่ลงไปสะสม" ไม่ใช่มูลค่าพอร์ตย้อนหลัง
import InvestedChart from '../../components/dashboard/InvestedChart.jsx';
// ⭐ เชื่อมโลโก้สินทรัพย์เข้าหน้าใหม่ (30 ส.ค. 2569) — Import ตรงจากตำแหน่งเดิม
// ที่ DashboardHome ใช้อยู่แล้ว ห้าม Copy Logic ไปสร้างไฟล์ซ้ำใน components/app/
import AssetAvatar from '../../components/dashboard/AssetAvatar.jsx';
// 🔴 บั๊กที่แก้ (E2E Chrome Test — บั๊กที่ 3): ดู dashboardStats.js สำหรับ Root
// Cause เต็ม — สรุปสั้น: เดิมอ่าน overview.lifetime.totalThb/thisMonth.totalThb
// ซึ่งไม่มีจริงใน Response (Backend ส่ง amountByCurrency.THB) ทำให้ขึ้น "—" ค้าง
import { investedAmount } from '../../lib/dashboardStats.js';
// ⭐ Widget "รายการล่าสุด" ขาดป้ายกำกับซื้อ/ขาย + ป้าย "ยกเลิกรายการ" (พรอมต์แยก
// หลัง E2E Chrome Test) — Reuse Logic เดียวกับ AppTransactions.jsx เป๊ะ (ทั้ง
// TYPE_LABEL และ isReversalNote) ไม่เขียนกฎซ้ำ · ยืนยันแล้วว่า overview.recent[]
// มี side/note มาให้ครบอยู่แล้ว (dashboardOverview.service.buildRecent บรรทัด
// 102, 107) จึงไม่ต้องแตะ Backend เลย
import { isReversalNote } from '../../lib/transactionNote.js';

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

// ⭐ Label ประเภทธุรกรรม — สำเนาจาก AppTransactions.jsx เป๊ะ (ทั้งสองจุด Render
// ธุรกรรมจาก Shape เดียวกัน `{ side | type }` แต่คนละหน้า/คนละ Component จึงไม่
// รวมเป็น Shared Module ตอนนี้ — Pattern เดียวกับที่ recordTransactionLogic.js
// อธิบายไว้สำหรับ assetOptionLabel ที่ซ้ำกับ PortfolioSettingsPanel.jsx)
const TYPE_LABEL = {
  buy: 'ซื้อ',
  sell: 'ขาย',
  dividend: 'ปันผล',
  dividend_reversal: 'ยกเลิกปันผล',
};

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

  // ── Flatten allocation[].assets → Map<symbol,type> สำหรับ AssetAvatar ──────
  // Pattern เดียวกับ DashboardHome.jsx เป๊ะ — `todayDuePlans[]`/`recent[]` ของ
  // overview ไม่มี Field type ติดมาเอง (dashboardOverview.service.buildRecent /
  // dcaReminder.service.toPlanView ไม่ส่ง type) ต้อง Flatten จาก allocation
  // (ซึ่งมี type ต่อกลุ่มอยู่แล้ว) แทน — ไม่ยิง API เพิ่ม ใช้ overview ก้อนเดียวกัน
  const assetTypeBySymbol = new Map();
  for (const group of overview?.allocation ?? []) {
    for (const asset of group.assets ?? []) {
      assetTypeBySymbol.set(asset.symbol, group.type);
    }
  }

  // 🔴 บั๊กที่แก้ (E2E Chrome Test — บั๊กที่ 3) — ดู Comment ตรง import ด้านบน
  const lifetimeInvested = investedAmount(overview?.lifetime);
  const thisMonthInvested = investedAmount(overview?.thisMonth);

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
        <StatTile
          label="เงินลงทุนสะสมทั้งหมด"
          value={formatThb(lifetimeInvested.thb)}
          note={lifetimeInvested.usd > 0 ? `+ ${formatThb(lifetimeInvested.usd)} USD` : undefined}
        />
        <StatTile
          label="จำนวนครั้งที่บันทึก"
          value={overview?.lifetime?.count ?? '—'}
          unit="ครั้ง"
        />
        <StatTile
          label="DCA เดือนนี้"
          value={formatThb(thisMonthInvested.thb)}
          note={thisMonthInvested.usd > 0 ? `+ ${formatThb(thisMonthInvested.usd)} USD` : undefined}
        />
        <StatTile
          label="ต่อเนื่อง"
          value={overview?.streakMonths ?? 0}
          unit="เดือน"
        />
      </div>

      {/* ── กราฟเส้นเงินลงทุนสะสม ─────────────────────────────────────────
          ⚠️ Render เฉพาะเมื่อ Backend ส่ง monthlyInvested มาจริงเป็น Array —
          InvestedChart เรียก .slice()/.some() ตรงๆ จึงพังทันทีถ้าได้ undefined
          (Endpoint เก่าที่ยังไม่มี Field นี้ / Response ที่ถูกตัดทอน)
          ⚠️ **ห้ามใส่ `?? []` แทน** — Array ว่างจะวาดกราฟเปล่าที่ดูเหมือนว่า
          "ผู้ใช้ไม่เคยลงทุน" ทั้งที่ความจริงคือ "ระบบไม่มีข้อมูลส่วนนี้" */}
      {Array.isArray(overview?.monthlyInvested) && overview.monthlyInvested.length > 0 && (
        <InvestedChart monthlyInvested={overview.monthlyInvested} />
      )}

      {/* แผน DCA ที่ถึงรอบวันนี้ — ข้อความเป็นข้อเท็จจริงล้วน ไม่ชี้นำว่าควรซื้อไหม */}
      {Array.isArray(overview?.todayDuePlans) && overview.todayDuePlans.length > 0 && (
        <section className="demo-card">
          <h2>วันนี้ถึงรอบ DCA ของคุณ</h2>
          <ul>
            {overview.todayDuePlans.map((plan) => (
              <li key={plan.id ?? plan.symbol} className="app-dueplan-item">
                <AssetAvatar symbol={plan.symbol} type={assetTypeBySymbol.get(plan.symbol)} />
                <span>
                  {plan.symbol} · {formatThb(plan.amountTotal)} {plan.currency ?? 'บาท'}
                </span>
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
            {overview.recent.map((tx) => {
              // ⭐ ป้ายกำกับซื้อ/ขาย + ป้าย "ยกเลิกรายการ" (Reuse Logic เดียวกับ
              // AppTransactions.jsx — ดู Comment ตรง import ด้านบนของไฟล์นี้)
              const isReversal = isReversalNote(tx.note);
              return (
                <li key={tx.id} className={isReversal ? 'demo-txitem--reversal' : undefined}>
                  {/* ⚠️ Reuse .demo-txitem__type ตรงๆ (ไม่สร้าง Class ใหม่) — .demo-recent
                      li เดิมเป็น Grid 3 คอลัมน์ (1fr auto auto) ต้องขยายเป็น 4
                      คอลัมน์ให้ตรงกับ .demo-txitem ของ AppTransactions.jsx เป๊ะ
                      (ดู appShell.css) ไม่งั้นแถวจะเอียง/ล้นเหมือนบั๊กที่เคยแก้ไปแล้ว */}
                  <span className="demo-txitem__type">
                    {/* type ที่ระบบยังไม่รู้จักต้องแสดงเป็นค่าดิบ ห้าม Fallback
                        เป็น "ขาย" — Pattern เดียวกับ AppTransactions.jsx */}
                    {TYPE_LABEL[tx.side] ?? tx.side}
                  </span>
                  <span className="demo-recent__asset">
                    <AssetAvatar symbol={tx.symbol} type={assetTypeBySymbol.get(tx.symbol)} />
                    {tx.symbol}
                    {isReversal && (
                      <small
                        className="demo-txitem__badge"
                        title="รายการนี้เกิดจากการกดยกเลิกรายการล่าสุด — ระบบสร้างรายการหักล้างเข้า Ledger ไม่ได้ลบรายการเดิม"
                      >
                        ↩︎ ยกเลิกรายการ
                      </small>
                    )}
                  </span>
                  <span>{formatThb(tx.amountTotal)} {tx.currency ?? 'บาท'}</span>
                  <small>{tx.date}</small>
                </li>
              );
            })}
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
