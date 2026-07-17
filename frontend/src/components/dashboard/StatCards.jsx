// ═══════════════════════════════════════════════════════════════════════
// StatCards — การ์ดสถิติ 3 ใบ (งานที่ 3) — ทุกตัวเลขมาจาก overview ตรงๆ
// ═══════════════════════════════════════════════════════════════════════
// ห้ามคำนวณเงินเองแม้แต่บรรทัดเดียว — Component นี้แค่จัดรูปแบบตัวเลขที่ backend
// ส่งมาให้อ่านง่าย (toLocaleString ไม่เปลี่ยนค่า) ไม่มีการบวก/ลบ/คูณ/หารใดๆ เอง

function fmt(n, decimals = 2) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtInt(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('th-TH') : '-';
}

// props: overview = ผลลัพธ์ดิบจาก GET /api/v1/dashboard/overview (API.md §15.4)
function StatCards({ overview }) {
  const { portfolio, lifetime, thisMonth, streakMonths } = overview;

  return (
    <section className="dh-stats">
      <div className="dh-stat">
        <div className="dh-stat-t">
          <span>มูลค่าพอร์ตรวม</span>
          <span className="dh-stat-ico">💰</span>
        </div>
        {portfolio.isEmpty ? (
          <>
            <div className="dh-stat-v">–</div>
            <div className="dh-stat-sub dh-mut">ยังไม่มีรายการ — บันทึก DCA แรกของคุณเลย</div>
          </>
        ) : (
          <>
            <div className="dh-stat-v">
              {fmt(portfolio.totalCurrentValue)}
              <small> THB</small>
            </div>
            <div className={`dh-stat-sub ${portfolio.unrealizedPnL >= 0 ? 'dh-up' : 'dh-down'}`}>
              {portfolio.unrealizedPnL >= 0 ? '▲' : '▼'} {fmt(Math.abs(portfolio.unrealizedPnL))} THB
              {portfolio.unrealizedPnLPercent !== null
                ? ` (${portfolio.unrealizedPnL >= 0 ? '+' : ''}${fmt(portfolio.unrealizedPnLPercent)}%)`
                : ''}{' '}
              จากต้นทุน
            </div>
            {portfolio.excludedCount > 0 && (
              <div className="dh-stat-note">
                * ไม่รวม {portfolio.excludedCount} สินทรัพย์ที่ยังไม่มีราคาตลาด
              </div>
            )}
          </>
        )}
      </div>

      <div className="dh-stat">
        <div className="dh-stat-t">
          <span>เงินลงทุนสะสม</span>
          <span className="dh-stat-ico">🪙</span>
        </div>
        <div className="dh-stat-v">
          {fmt(lifetime.amountByCurrency.THB)}
          <small> THB</small>
        </div>
        {lifetime.amountByCurrency.USD > 0 && (
          <div className="dh-stat-sub dh-mut">+ {fmt(lifetime.amountByCurrency.USD)} USD</div>
        )}
        <div className="dh-stat-sub dh-mut">จากการบันทึก DCA ทั้งหมด {fmtInt(lifetime.count)} ครั้ง</div>
      </div>

      <div className="dh-stat">
        <div className="dh-stat-t">
          <span>DCA เดือนนี้</span>
          <span className="dh-stat-ico">📅</span>
        </div>
        <div className="dh-stat-v">
          {fmtInt(thisMonth.count)} <small>ครั้ง</small>
        </div>
        <div className="dh-stat-sub dh-streak">
          {streakMonths > 0 ? `🔥 ต่อเนื่อง ${streakMonths} เดือน` : 'เริ่มบันทึก DCA เดือนนี้เลย'}
        </div>
      </div>
    </section>
  );
}

export default StatCards;
