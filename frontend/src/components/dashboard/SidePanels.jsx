import { typeMeta } from '../../lib/assetTypeMeta.js';

function fmt(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : '-';
}

// ═══════════════════════════════════════════════════════════════════════
// SidePanels — คอลัมน์ขวา (Rail): สรุปเดือนนี้ / ปฏิทิน DCA / สินทรัพย์ที่ถือ
// ═══════════════════════════════════════════════════════════════════════
// S8 R3 รอบ 3: "ปฏิทิน DCA" ใช้ overview.todayDuePlans จริงแล้ว (Backend เพิ่ม Field
// นี้ให้แล้วรอบก่อน) — dayLabel เป็นข้อความที่ Backend สร้างให้แล้ว ใช้ตรงๆ ห้าม
// คำนวณ/Format วันเอง (ตาม Requirement) ส่วน "ตามแผนที่ตั้งไว้ N/M รอบ" + Progress
// Bar ใน Mockup ยังคงตัดออก (overview ไม่มีข้อมูลเป้ารายเดือนให้ใช้จริง)

function MonthSummaryPanel({ thisMonth, streakMonths }) {
  return (
    <div className="dh-month-summary-card">
      <h3>📈 สรุปเดือนนี้</h3>
      <div className="dh-msum-row">
        <span>บันทึก DCA แล้ว</span>
        <b>{thisMonth.count.toLocaleString('th-TH')} ครั้ง</b>
      </div>
      <div className="dh-msum-row">
        <span>เงินลงทุนเดือนนี้</span>
        <b>
          ฿{fmt(thisMonth.amountByCurrency.THB)}
          {thisMonth.amountByCurrency.USD > 0 ? ` + $${fmt(thisMonth.amountByCurrency.USD)}` : ''}
        </b>
      </div>
      <div className="dh-msum-row">
        <span>ความต่อเนื่อง</span>
        <b>{streakMonths > 0 ? `🔥 ${streakMonths} เดือนติด` : '—'}</b>
      </div>
    </div>
  );
}

function CalendarPlaceholder({ todayDuePlans, hasActivePlans, symbolTypeBySymbol, onQuickRecord }) {
  if (todayDuePlans.length > 0) {
    return (
      <div className="dh-card dh-rail-card">
        <h3>📅 วันนี้ถึงรอบ DCA</h3>
        <div className="dh-hold-list">
          {todayDuePlans.map((plan) => {
            const meta = typeMeta(symbolTypeBySymbol.get(plan.symbol));
            return (
              <div className="dh-hrow" key={plan.id}>
                <span className="dh-avatar" style={{ background: meta.color }}>
                  {plan.symbol.slice(0, 4)}
                </span>
                <span className="dh-hrow-nm">
                  <b>{plan.symbol}</b>
                  <small>{plan.dayLabel}</small>
                </span>
                <span className="dh-hrow-val">
                  {fmt(plan.amountTotal)} {plan.currency}
                </span>
                <button
                  type="button"
                  className="dh-quick-record-btn"
                  onClick={() => onQuickRecord(plan)}
                >
                  บันทึกเลย
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="dh-card dh-rail-card">
      <h3>📅 ปฏิทิน DCA</h3>
      <div className="dh-cal-empty">
        {hasActivePlans ? (
          <p>วันนี้ไม่มีรอบ DCA ถึงกำหนด</p>
        ) : (
          <>
            <p>ยังไม่ได้ตั้งเตือน DCA</p>
            <p className="dh-cal-empty-hint">
              ตั้งเตือนได้ที่เมนู <b>"ตั้งเตือน DCA"</b> ด้านซ้าย หรือผ่าน LINE พิมพ์{' '}
              <b>"ตั้งเตือน"</b> ในแชท EasyDCA
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// สินทรัพย์ที่ถือ — Flatten จาก allocation[].assets ตรงๆ (API.md §15.4)
// ⚠️ ไม่แสดงกำไร/ขาดทุน % ต่อสินทรัพย์เหมือน Mockup เพราะ overview ไม่มี Field
// ต้นทุน/กำไรรายตัว (มีแต่ P&L รวมทั้งพอร์ตในการ์ดสถิติใบแรก) — การคำนวณ % เอง
// ที่นี่จะขัดกับกฎ "ห้ามคำนวณเงินเองที่ Frontend" จึงแสดงแค่มูลค่า + Badge
// "ที่ต้นทุน" (จาก priceUnavailable) ตามข้อมูลที่มีจริงเท่านั้น
function HoldingsPanel({ allocation }) {
  const holdings = allocation
    .flatMap((a) => a.assets.map((asset) => ({ ...asset, type: a.type })))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="dh-card dh-rail-card">
      <h3>💼 สินทรัพย์ที่ถือ</h3>
      {holdings.length === 0 ? (
        <p className="dh-empty-msg">ยังไม่มีสินทรัพย์ในพอร์ต</p>
      ) : (
        <div className="dh-hold-list">
          {holdings.map((h) => {
            const meta = typeMeta(h.type);
            return (
              <div className="dh-hrow" key={h.symbol}>
                <span className="dh-avatar" style={{ background: meta.color }}>
                  {h.symbol.slice(0, 4)}
                </span>
                <span className="dh-hrow-nm">
                  <b>{h.symbol}</b> {h.priceUnavailable && <span className="dh-nofeed">ที่ต้นทุน</span>}
                  <small>{h.name}</small>
                </span>
                <span className="dh-hrow-val">
                  ฿{fmt(h.value)}
                  {h.currency === 'USD' ? ' *' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="dh-disclaimer">
        ราคาหุ้นไทยยังไม่มีแหล่งข้อมูลสด — แสดงมูลค่าที่ต้นทุนไปก่อน
      </div>
    </div>
  );
}

function SidePanels({ overview, symbols, plans, onQuickRecord }) {
  const symbolTypeBySymbol = new Map(symbols.map((s) => [s.symbol, s.type]));
  const hasActivePlans = plans.some((p) => p.active);

  return (
    <aside className="dh-rail">
      <MonthSummaryPanel thisMonth={overview.thisMonth} streakMonths={overview.streakMonths} />
      <CalendarPlaceholder
        todayDuePlans={overview.todayDuePlans}
        hasActivePlans={hasActivePlans}
        symbolTypeBySymbol={symbolTypeBySymbol}
        onQuickRecord={onQuickRecord}
      />
      <HoldingsPanel allocation={overview.allocation} />
    </aside>
  );
}

export default SidePanels;
