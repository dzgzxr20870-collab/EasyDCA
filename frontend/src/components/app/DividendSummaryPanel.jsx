// ═══════════════════════════════════════════════════════════════════════════
// DividendSummaryPanel — สรุปเงินปันผลที่เคยได้รับ (พอร์ตที่เปิดอยู่ หรือทั้งบัญชี)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ **ห้ามคำนวณเงินในไฟล์นี้แม้แต่บรรทัดเดียว** (กฎยืนข้อ 1 — เหมือน
// PortfolioHoldingsTable) — ทุกยอดมาจาก GET /dashboard/dividend-summary ตรงๆ
// (Backend Reuse dividendService.calculateTotalDividend() แล้ว) ไฟล์นี้ทำแค่
// จัดรูปแบบตัวเลขให้อ่านง่าย (toLocaleString)
//
// ⚠️ **ห้ามรวมยอดข้ามสกุลเงินเอง** — totalDividendByCurrency แยก THB/USD มาให้
// แล้ว แสดงเป็นบรรทัดของตัวเองเสมอ ไม่บวกรวมกัน (เหตุผลเดียวกับ InvestedChart
// ที่แยกเส้น THB/USD — ไม่มี Historical FX Rate ให้แปลงย้อนหลัง)
function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TYPE_LABEL = {
  dividend: 'ปันผลรับ',
  dividend_reversal: 'ยกเลิกปันผล',
};

function DividendSummaryPanel({ summary }) {
  const totalByCurrency = summary?.totalDividendByCurrency ?? { THB: 0, USD: 0 };
  const bySymbol = summary?.bySymbol ?? [];
  const recent = summary?.recent ?? [];

  const isEmpty = totalByCurrency.THB === 0 && totalByCurrency.USD === 0 && bySymbol.length === 0;

  return (
    <section className="dh-card">
      <div className="dh-card-h">
        <h2>เงินปันผลสะสม</h2>
        <span className="dh-tag">คำนวณจากรายการจริงของคุณ</span>
      </div>

      {isEmpty ? (
        <div className="app-state app-state--empty">
          <strong>ยังไม่มีเงินปันผลที่บันทึกไว้</strong>
          <p>เมื่อบันทึกรายการปันผลรับแล้ว ยอดสะสมจะแสดงที่นี่</p>
        </div>
      ) : (
        <>
          <p className="demo-total">
            {totalByCurrency.THB !== 0 && (
              <>
                <strong>{formatMoney(totalByCurrency.THB)}</strong> บาท
              </>
            )}
            {totalByCurrency.THB !== 0 && totalByCurrency.USD !== 0 && ' + '}
            {totalByCurrency.USD !== 0 && (
              <>
                <strong>{formatMoney(totalByCurrency.USD)}</strong> USD
              </>
            )}
          </p>

          <div className="app-table-scroll">
            <table className="app-table">
              <thead>
                <tr>
                  <th>สินทรัพย์</th>
                  <th className="app-table__num">ปันผลสะสม</th>
                </tr>
              </thead>
              <tbody>
                {bySymbol.map((row) => (
                  <tr key={row.symbol}>
                    <td>{row.symbol}</td>
                    <td className="app-table__num">
                      {formatMoney(row.total)} {row.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {recent.length > 0 && (
            <>
              <h3 className="app-section-title">รายการปันผลล่าสุด</h3>
              <div className="app-table-scroll">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>วันที่</th>
                      <th>สินทรัพย์</th>
                      <th className="app-table__num">จำนวนเงิน</th>
                      <th>ประเภท</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((row, i) => (
                      <tr key={`${row.date}|${row.symbol}|${i}`}>
                        <td>{row.date}</td>
                        <td>{row.symbol}</td>
                        <td className="app-table__num">
                          {formatMoney(row.amountThb)} {row.currency}
                        </td>
                        <td>{TYPE_LABEL[row.type] ?? row.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default DividendSummaryPanel;
